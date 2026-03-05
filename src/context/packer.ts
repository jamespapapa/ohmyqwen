import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ContextTier, ContextTierSchema } from "../core/types.js";
import {
  ResolvedRetrievalConfig,
  RetrievalDiagnostics,
  RetrievalDocument,
  resolveRetrievalConfig,
  runRetrievalChain
} from "../retrieval/index.js";
import { unique as uniqueStrings } from "../retrieval/utils.js";

export interface PackContextInput {
  objective: string;
  constraints: string[];
  symbols: string[];
  errorLogs: string[];
  diffSummary: string[];
  tier: ContextTier;
  tokenBudget?: number;
  stage?: "PLAN" | "IMPLEMENT" | "VERIFY";
  stageTokenCaps?: Partial<Record<"PLAN" | "IMPLEMENT" | "VERIFY", number>>;
}

export interface PackedContext {
  tier: ContextTier;
  hardCapTokens: number;
  usedTokens: number;
  truncated: boolean;
  stage: "PLAN" | "IMPLEMENT" | "VERIFY";
  payload: {
    objective: string;
    constraints: string[];
    symbols: string[];
    recentErrors: string[];
    diffSummary: string[];
  };
}

export interface PersistPackedContextInput {
  outputPath: string;
  runId: string;
  stage: "PLAN" | "IMPLEMENT" | "VERIFY";
  patchAttempt: number;
  packed: PackedContext;
  selectedSymbols?: string[];
  constraintFlags?: string[];
}

export interface PersistPackedContextResult {
  hash: string;
  outputPath: string;
}

interface ContextIndexEntry {
  path: string;
  hash: string;
  symbols: string[];
  dependencies: string[];
  fileSummary: string;
  moduleSummary: string;
  architectureSummary: string;
  updatedAt: string;
}

interface ContextIndexMetadata {
  chunkVersion: string;
  retrievalVersion: string;
  providerFingerprint: string;
  embeddingModel: string;
}

interface ContextIndexFile {
  version: 2;
  updatedAt: string;
  entries: Record<string, ContextIndexEntry>;
  metadata: ContextIndexMetadata;
}

export interface ContextLifecycleDiagnostics {
  stale: boolean;
  reasons: string[];
  reindexed: boolean;
  expected: ContextIndexMetadata;
  current: ContextIndexMetadata | null;
}

export interface ContextFragment {
  path: string;
  score: number;
  small: string;
  mid: string;
  big: string;
  symbols: string[];
  dependencies: string[];
  changed: boolean;
}

export interface ContextInspection {
  cachePath: string;
  changedFiles: string[];
  reusedFiles: string[];
  fragments: ContextFragment[];
  packed: PackedContext;
  retrieval: RetrievalDiagnostics;
  lifecycle: ContextLifecycleDiagnostics;
}

export interface ContextIndexDiagnosis {
  cachePath: string;
  stale: boolean;
  reasons: string[];
  expected: ContextIndexMetadata;
  current: ContextIndexMetadata | null;
  reindexCommand: string;
}

const DEFAULT_BUDGET: Record<ContextTier, number> = {
  small: 700,
  mid: 1400,
  big: 2600
};

const HARD_CAP_MAX = 6000;

const STAGE_BUDGET_FACTOR: Record<"PLAN" | "IMPLEMENT" | "VERIFY", number> = {
  PLAN: 0.8,
  IMPLEMENT: 1,
  VERIFY: 0.7
};

function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trimByTokens(text: string, tokenBudget: number): { value: string; used: number; truncated: boolean } {
  const normalized = normalizeText(text);
  if (tokenBudget <= 0 || !normalized) {
    return { value: "", used: 0, truncated: Boolean(normalized) };
  }

  if (estimateTokens(normalized) <= tokenBudget) {
    return { value: normalized, used: estimateTokens(normalized), truncated: false };
  }

  let low = 0;
  let high = normalized.length;
  let best = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${normalized.slice(0, mid).trim()}...`;
    const tokens = estimateTokens(candidate);

    if (tokens <= tokenBudget) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return {
    value: best,
    used: estimateTokens(best),
    truncated: true
  };
}

function packList(
  items: string[],
  tokenBudget: number,
  maxItems: number
): { values: string[]; used: number; truncated: boolean } {
  if (tokenBudget <= 0 || maxItems <= 0) {
    return { values: [], used: 0, truncated: items.length > 0 };
  }

  const selected: string[] = [];
  let used = 0;
  let truncated = false;

  for (const raw of items) {
    if (selected.length >= maxItems) {
      truncated = true;
      break;
    }

    const normalized = normalizeText(raw);
    if (!normalized) {
      continue;
    }

    const rest = tokenBudget - used;
    if (rest <= 0) {
      truncated = true;
      break;
    }

    const trimmed = trimByTokens(normalized, rest);
    if (!trimmed.value) {
      truncated = true;
      break;
    }

    selected.push(trimmed.value);
    used += trimmed.used;

    if (trimmed.truncated) {
      truncated = true;
      break;
    }
  }

  if (items.length > selected.length) {
    truncated = true;
  }

  return { values: selected, used, truncated };
}

function withStageBudget(tokenBudget: number, stage: "PLAN" | "IMPLEMENT" | "VERIFY"): number {
  const adjusted = Math.floor(tokenBudget * STAGE_BUDGET_FACTOR[stage]);
  return Math.max(200, adjusted);
}

function clampBudget(value: number): number {
  return Math.max(200, Math.min(value, HARD_CAP_MAX));
}

export function packContext(input: PackContextInput): PackedContext {
  const tier = ContextTierSchema.parse(input.tier);
  const stage = input.stage ?? "IMPLEMENT";
  const requestedBudget = input.tokenBudget ?? DEFAULT_BUDGET[tier];
  const stageCap = input.stageTokenCaps?.[stage];
  const hardCapTokens = clampBudget(stageCap ?? withStageBudget(requestedBudget, stage));

  let usedTokens = 0;
  let truncated = false;

  const objectiveBudget = Math.max(40, Math.floor(hardCapTokens * 0.2));
  const constraintsBudget = Math.max(20, Math.floor(hardCapTokens * 0.1));
  const symbolsBudget = Math.max(40, Math.floor(hardCapTokens * 0.3));
  const errorsBudget = Math.max(40, Math.floor(hardCapTokens * 0.2));
  const diffBudget = Math.max(
    40,
    hardCapTokens - (objectiveBudget + constraintsBudget + symbolsBudget + errorsBudget)
  );

  const objective = trimByTokens(input.objective, objectiveBudget);
  usedTokens += objective.used;
  truncated ||= objective.truncated;

  const constraints = packList(
    input.constraints,
    constraintsBudget,
    tier === "small" ? 4 : tier === "mid" ? 8 : 12
  );
  usedTokens += constraints.used;
  truncated ||= constraints.truncated;

  const symbols = packList(
    input.symbols,
    symbolsBudget,
    tier === "small" ? 20 : tier === "mid" ? 50 : 120
  );
  usedTokens += symbols.used;
  truncated ||= symbols.truncated;

  const recentErrors = packList(
    input.errorLogs,
    errorsBudget,
    tier === "small" ? 4 : tier === "mid" ? 10 : 20
  );
  usedTokens += recentErrors.used;
  truncated ||= recentErrors.truncated;

  const diffSummary = packList(
    input.diffSummary,
    diffBudget,
    tier === "small" ? 8 : tier === "mid" ? 20 : 40
  );
  usedTokens += diffSummary.used;
  truncated ||= diffSummary.truncated;

  return {
    tier,
    stage,
    hardCapTokens,
    usedTokens: Math.min(usedTokens, hardCapTokens),
    truncated,
    payload: {
      objective: objective.value,
      constraints: constraints.values,
      symbols: symbols.values,
      recentErrors: recentErrors.values,
      diffSummary: diffSummary.values
    }
  };
}

export async function persistPackedContext(
  input: PersistPackedContextInput
): Promise<PersistPackedContextResult> {
  const payload = {
    runId: input.runId,
    stage: input.stage,
    patchAttempt: input.patchAttempt,
    payload: input.packed.payload,
    selectedSymbols: unique(input.selectedSymbols ?? input.packed.payload.symbols),
    constraintFlags: unique(input.constraintFlags ?? []),
    tokenBudget: {
      tier: input.packed.tier,
      hardCapTokens: input.packed.hardCapTokens,
      usedTokens: input.packed.usedTokens,
      truncated: input.packed.truncated
    },
    generatedAt: new Date().toISOString()
  };

  const serialized = JSON.stringify(payload);
  const hash = createHash("sha256").update(serialized).digest("hex").slice(0, 16);

  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  await fs.writeFile(
    input.outputPath,
    `${JSON.stringify(
      {
        ...payload,
        hash
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    hash,
    outputPath: input.outputPath
  };
}

export function renderPackedContext(context: PackedContext): string {
  return [
    `tier=${context.tier}`,
    `stage=${context.stage}`,
    `tokenCap=${context.hardCapTokens}`,
    `used=${context.usedTokens}`,
    `truncated=${context.truncated}`,
    `objective=${context.payload.objective}`,
    `constraints=${context.payload.constraints.join(" | ")}`,
    `symbols=${context.payload.symbols.join(", ")}`,
    `recentErrors=${context.payload.recentErrors.join(" | ")}`,
    `diffSummary=${context.payload.diffSummary.join(" | ")}`
  ].join("\n");
}

function extractSymbols(content: string): string[] {
  const symbols = new Set<string>();
  const pattern =
    /(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

  for (const match of content.matchAll(pattern)) {
    if (match[1]) {
      symbols.add(match[1]);
    }
  }

  return Array.from(symbols).slice(0, 40);
}

function extractDependencies(content: string): string[] {
  const deps = new Set<string>();
  const pattern = /from\s+["']([^"']+)["']/g;
  for (const match of content.matchAll(pattern)) {
    if (match[1]) {
      deps.add(match[1]);
    }
  }

  return Array.from(deps).slice(0, 20);
}

function summarizeFile(content: string): string {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("/*"));

  return normalizeText(lines.slice(0, 3).join(" ")).slice(0, 280) || "(empty file)";
}

function buildModuleSummary(filePath: string, symbols: string[], deps: string[]): string {
  const symbolPreview = symbols.slice(0, 8).join(", ") || "no exported symbols";
  const depPreview = deps.slice(0, 5).join(", ") || "no imports";
  return `${filePath}: symbols[${symbolPreview}], deps[${depPreview}]`;
}

function buildArchitectureSummary(filePath: string, deps: string[]): string {
  const dir = path.dirname(filePath);
  const depPreview = deps.slice(0, 8).join(", ") || "none";
  return `module=${filePath}, layer=${dir}, runtime-links=${depPreview}`;
}

function computeHash(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

function buildProviderFingerprint(config: ResolvedRetrievalConfig): string {
  const payload = JSON.stringify({
    providerPriority: config.providerPriority,
    topK: config.topK,
    timeoutMs: config.timeoutMs,
    stageTokenCaps: config.stageTokenCaps
  });
  return createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

function buildLifecycleMetadata(config: ResolvedRetrievalConfig): ContextIndexMetadata {
  return {
    chunkVersion: config.lifecycle.chunkVersion,
    retrievalVersion: config.lifecycle.retrievalVersion,
    providerFingerprint: buildProviderFingerprint(config),
    embeddingModel: config.embedding.enabled ? config.embedding.model : "disabled"
  };
}

function createEmptyIndex(metadata: ContextIndexMetadata): ContextIndexFile {
  return {
    version: 2,
    updatedAt: new Date(0).toISOString(),
    entries: {},
    metadata
  };
}

function sameMetadata(a: ContextIndexMetadata, b: ContextIndexMetadata): boolean {
  return (
    a.chunkVersion === b.chunkVersion &&
    a.retrievalVersion === b.retrievalVersion &&
    a.providerFingerprint === b.providerFingerprint &&
    a.embeddingModel === b.embeddingModel
  );
}

async function loadIndex(
  cachePath: string,
  expectedMetadata: ContextIndexMetadata
): Promise<{ index: ContextIndexFile; staleReasons: string[]; currentMetadata: ContextIndexMetadata | null }> {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as
      | ContextIndexFile
      | { version?: number; entries?: Record<string, ContextIndexEntry> };

    if (parsed && typeof parsed === "object" && parsed.version === 2 && "entries" in parsed) {
      const typed = parsed as ContextIndexFile;
      const metadata = typed.metadata;
      const staleReasons: string[] = [];

      if (!metadata || !sameMetadata(metadata, expectedMetadata)) {
        staleReasons.push("context-index-metadata-mismatch");
      }

      return {
        index: {
          ...typed,
          metadata: metadata ?? expectedMetadata
        },
        staleReasons,
        currentMetadata: metadata ?? null
      };
    }

    if (parsed && typeof parsed === "object" && parsed.version === 1 && "entries" in parsed) {
      return {
        index: createEmptyIndex(expectedMetadata),
        staleReasons: ["context-index-schema-v1-detected"],
        currentMetadata: null
      };
    }

    return {
      index: createEmptyIndex(expectedMetadata),
      staleReasons: ["context-index-invalid-schema"],
      currentMetadata: null
    };
  } catch {
    return {
      index: createEmptyIndex(expectedMetadata),
      staleReasons: [],
      currentMetadata: null
    };
  }
}

async function saveIndex(cachePath: string, index: ContextIndexFile): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function safeRelative(filePath: string, cwd: string): string {
  const absolute = path.resolve(cwd, filePath);
  const root = path.resolve(cwd);
  if (absolute === root || absolute.startsWith(`${root}${path.sep}`)) {
    return path.relative(root, absolute) || path.basename(absolute);
  }

  throw new Error(`file path escapes workspace: ${filePath}`);
}

async function buildContextIndexEntry(
  cwd: string,
  relativePath: string
): Promise<ContextIndexEntry | undefined> {
  const absolute = path.resolve(cwd, relativePath);
  let content = "";
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) {
      return undefined;
    }
    content = await fs.readFile(absolute, "utf8");
  } catch {
    return undefined;
  }

  const symbols = extractSymbols(content);
  const dependencies = extractDependencies(content);

  return {
    path: relativePath,
    hash: computeHash(content),
    symbols,
    dependencies,
    fileSummary: summarizeFile(content),
    moduleSummary: buildModuleSummary(relativePath, symbols, dependencies),
    architectureSummary: buildArchitectureSummary(relativePath, dependencies),
    updatedAt: new Date().toISOString()
  };
}

function unique(items: string[]): string[] {
  return uniqueStrings(items);
}

export async function inspectContext(options: {
  cwd?: string;
  files: string[];
  task: string;
  tier: ContextTier;
  tokenBudget: number;
  stage?: "PLAN" | "IMPLEMENT" | "VERIFY";
  targetFiles?: string[];
  diffSummary?: string[];
  errorLogs?: string[];
  verifyFeedback?: string[];
  patchAttempt?: number;
  retrievalConfig?: ResolvedRetrievalConfig;
  cachePath?: string;
}): Promise<ContextInspection> {
  const cwd = options.cwd ?? process.cwd();
  const retrievalConfig = options.retrievalConfig ?? (await resolveRetrievalConfig(cwd));
  const stage = options.stage ?? "IMPLEMENT";
  const cachePath =
    options.cachePath ?? path.resolve(cwd, ".ohmyqwen", "cache", "context-index.json");
  const files = unique(options.files);
  const expectedMetadata = buildLifecycleMetadata(retrievalConfig);

  const loaded = await loadIndex(cachePath, expectedMetadata);
  const index = loaded.index;
  const lifecycle: ContextLifecycleDiagnostics = {
    stale: loaded.staleReasons.length > 0,
    reasons: [...loaded.staleReasons],
    reindexed: false,
    expected: expectedMetadata,
    current: loaded.currentMetadata
  };

  if (lifecycle.stale && retrievalConfig.lifecycle.autoReindexOnStale) {
    index.entries = {};
    lifecycle.reindexed = true;
  }

  const changedFiles: string[] = [];
  const reusedFiles: string[] = [];

  for (const file of files) {
    let relative = file;
    try {
      relative = safeRelative(file, cwd);
    } catch {
      continue;
    }

    const nextEntry = await buildContextIndexEntry(cwd, relative);
    if (!nextEntry) {
      continue;
    }

    const hash = nextEntry.hash;
    const existing = index.entries[relative];

    if (existing && existing.hash === hash) {
      reusedFiles.push(relative);
      continue;
    }

    index.entries[relative] = nextEntry;

    changedFiles.push(relative);
  }

  index.updatedAt = new Date().toISOString();
  index.metadata = expectedMetadata;
  await saveIndex(cachePath, index);

  const documents: RetrievalDocument[] = Object.values(index.entries).map((entry) => ({
      path: entry.path,
      hash: entry.hash,
      symbols: entry.symbols,
      dependencies: entry.dependencies,
      fileSummary: entry.fileSummary,
      moduleSummary: entry.moduleSummary,
      architectureSummary: entry.architectureSummary,
      changed: changedFiles.includes(entry.path)
    }));

  const retrieval = await runRetrievalChain({
    cwd,
    query: {
      stage,
      task: options.task,
      targetFiles: unique(options.targetFiles ?? []),
      diffSummary: unique(options.diffSummary ?? []),
      errorLogs: unique(options.errorLogs ?? []),
      verifyFeedback: unique(options.verifyFeedback ?? []),
      patchAttempt: Math.max(0, options.patchAttempt ?? 0)
    },
    documents,
    config: retrievalConfig
  });

  const docByPath = new Map(documents.map((document) => [document.path, document]));
  let indexAugmentedByRetrieval = false;
  for (const hit of retrieval.hits) {
    if (docByPath.has(hit.path)) {
      continue;
    }

    let safePath: string;
    try {
      safePath = safeRelative(hit.path, cwd);
    } catch {
      continue;
    }

    const extraEntry = await buildContextIndexEntry(cwd, safePath);
    if (!extraEntry) {
      continue;
    }

    index.entries[safePath] = extraEntry;
    docByPath.set(safePath, {
      path: extraEntry.path,
      hash: extraEntry.hash,
      symbols: extraEntry.symbols,
      dependencies: extraEntry.dependencies,
      fileSummary: extraEntry.fileSummary,
      moduleSummary: extraEntry.moduleSummary,
      architectureSummary: extraEntry.architectureSummary,
      changed: false
    });
    indexAugmentedByRetrieval = true;
  }

  if (indexAugmentedByRetrieval) {
    index.updatedAt = new Date().toISOString();
    await saveIndex(cachePath, index);
  }

  const fragments: ContextFragment[] = retrieval.hits
    .map((hit) => {
      const entry = docByPath.get(hit.path);
      if (!entry) {
        return undefined;
      }

      return {
        path: entry.path,
        score: hit.score,
        small: `${entry.path}: ${entry.fileSummary}`,
        mid: `${entry.moduleSummary} | retrieval=${hit.reasons.join(", ")}`,
        big: `${entry.architectureSummary} | retrieval=${hit.reasons.join(", ")}`,
        symbols: entry.symbols,
        dependencies: entry.dependencies,
        changed: entry.changed
      };
    })
    .filter((entry): entry is ContextFragment => Boolean(entry))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.path.localeCompare(b.path)));

  const tier = ContextTierSchema.parse(options.tier);

  const signalErrors = unique([...(options.errorLogs ?? []), ...(options.verifyFeedback ?? [])]);

  const targetEvidence = fragments.slice(0, tier === "small" ? 8 : tier === "mid" ? 16 : 24).map((fragment) => {
    if (tier === "small") {
      return `TARGET:${fragment.small}`;
    }
    if (tier === "mid") {
      return `TARGET:${fragment.mid}`;
    }
    return `TARGET:${fragment.big}`;
  });

  const errorEvidence = signalErrors.slice(0, tier === "small" ? 6 : tier === "mid" ? 12 : 20).map((line) => `ERROR:${line}`);
  const recentChangeEvidence = changedFiles.map((file) => `RECENT:${file}`);
  const summaryEvidence = fragments.map((fragment) => `SUMMARY:${fragment.path} score=${fragment.score.toFixed(2)}`);
  const selectedText = unique([...targetEvidence, ...errorEvidence, ...recentChangeEvidence, ...summaryEvidence]);

  const selectedSymbols = unique(fragments.flatMap((fragment) => fragment.symbols)).slice(
    0,
    tier === "small" ? 24 : tier === "mid" ? 80 : 180
  );

  const packed = packContext({
    objective: options.task,
    constraints: [],
    symbols: selectedSymbols,
    errorLogs: signalErrors,
    diffSummary: selectedText,
    tier,
    tokenBudget: options.tokenBudget,
    stage,
    stageTokenCaps: retrievalConfig.stageTokenCaps
  });

  return {
    cachePath,
    changedFiles,
    reusedFiles,
    fragments,
    packed,
    retrieval: retrieval.diagnostics,
    lifecycle
  };
}

export async function diagnoseContextIndex(options?: {
  cwd?: string;
  cachePath?: string;
  retrievalConfig?: ResolvedRetrievalConfig;
}): Promise<ContextIndexDiagnosis> {
  const cwd = options?.cwd ?? process.cwd();
  const cachePath =
    options?.cachePath ?? path.resolve(cwd, ".ohmyqwen", "cache", "context-index.json");
  const retrievalConfig = options?.retrievalConfig ?? (await resolveRetrievalConfig(cwd));
  const expected = buildLifecycleMetadata(retrievalConfig);
  const loaded = await loadIndex(cachePath, expected);

  return {
    cachePath,
    stale: loaded.staleReasons.length > 0,
    reasons: loaded.staleReasons,
    expected,
    current: loaded.currentMetadata,
    reindexCommand: "ohmyqwen context doctor --reindex"
  };
}

export async function reindexContextCache(options?: { cwd?: string; cachePath?: string }): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const cachePath =
    options?.cachePath ?? path.resolve(cwd, ".ohmyqwen", "cache", "context-index.json");
  await fs.rm(cachePath, { force: true });
}
