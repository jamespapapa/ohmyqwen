import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { inspectContext } from "../context/packer.js";
import { RetrievalConfigOverrideSchema, RunModeSchema } from "../core/types.js";
import { OpenAICompatibleLlmClient } from "../llm/client.js";
import { resolveRetrievalConfig } from "../retrieval/config.js";
import {
  deriveStageTokenCapsFromModel,
  loadLlmRuntimeSettings,
  resolveLlmModelProfile
} from "../llm/settings.js";
import {
  getProjectPresetById,
  listProjectPresets,
  matchProjectPreset,
  ProjectPreset,
  removeProjectPreset,
  UpsertProjectPresetInput,
  upsertProjectPreset
} from "./presets.js";
import {
  detectQuestionDomainPacks,
  getDomainPackById,
  listDomainPacks,
  removeDomainPack,
  resolveDomainPacksByIds,
  type DomainPack,
  type UpsertDomainPackInput,
  upsertDomainPack
} from "./domain-packs.js";
import {
  runQmdMultiCorpusSearch,
  type QmdCorpusAttempt
} from "../retrieval/qmd-search.js";
import { qualityGateForAskOutput } from "./ask-quality.js";
import {
  buildEaiDictionaryEntries,
  rankEaiDictionaryEntriesForSummary,
  type EaiDictionaryEntry
} from "./eai-dictionary.js";
import { buildLinkedEaiEvidence } from "./eai-links.js";
import {
  buildFrontBackGraph,
  type FrontBackGraphSnapshot
} from "./front-back-graph.js";
import { buildDeterministicFlowAnswer, buildLinkedFlowEvidence } from "./flow-links.js";
import { traceLinkedFlowDownstream } from "./flow-trace.js";
import { computeDomainMaturity, type DomainMaturityOutput, type DomainMaturityResult } from "./domain-maturity.js";
import {
  expandCapabilitySearchTerms,
  extractQuestionCapabilityTags,
  isCrossLayerFlowQuestion,
  resolveQuestionCapabilityTags
} from "./flow-capabilities.js";

const ServerProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  workspaceDir: z.string().min(1),
  linkedWorkspaceDirs: z.array(z.string().min(1)).default([]),
  description: z.string().default(""),
  presetId: z.string().min(1).optional(),
  defaultMode: RunModeSchema.default("feature"),
  defaultDryRun: z.boolean().default(false),
  retrieval: RetrievalConfigOverrideSchema.optional(),
  llm: z
    .object({
      modelId: z.string().min(1).optional()
    })
    .optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastIndexedAt: z.string().optional(),
  lastIndexSummary: z.string().optional()
});

const ServerProjectStoreSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().min(1),
  projects: z.array(ServerProjectSchema)
});

const UpsertServerProjectInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  workspaceDir: z.string().min(1),
  linkedWorkspaceDirs: z.array(z.string().min(1)).optional(),
  description: z.string().optional(),
  presetId: z.string().min(1).optional(),
  defaultMode: RunModeSchema.optional(),
  defaultDryRun: z.boolean().optional(),
  retrieval: RetrievalConfigOverrideSchema.optional(),
  llm: z
    .object({
      modelId: z.string().min(1).optional()
    })
    .optional()
});

export type ServerProject = z.infer<typeof ServerProjectSchema>;
export type UpsertServerProjectInput = z.infer<typeof UpsertServerProjectInputSchema>;

export interface ProjectWarmupResult {
  project: ServerProject;
  fileCount: number;
  changedFiles: number;
  reusedFiles: number;
  selectedProvider: string;
  fallbackUsed: boolean;
  providerResults: Array<{
    provider: string;
    status: string;
    tookMs: number;
    error?: string;
  }>;
}

export interface ProjectSearchHit {
  path: string;
  score: number;
  source: "qmd" | "lexical";
  reasons?: string[];
  title?: string;
  snippet?: string;
}

export interface ProjectSearchResult {
  project: ServerProject;
  query: string;
  provider: "qmd" | "lexical";
  fallbackUsed: boolean;
  modeUsed?: "query" | "search";
  hits: ProjectSearchHit[];
  diagnostics: {
    qmdStatus?: "ok" | "empty" | "failed" | "skipped";
    qmdErrors?: string[];
    qmdIndexMethod?: "add" | "update" | "cached";
    qmdQueryMode?: "query_then_search" | "search_only" | "query_only";
    qmdQuery?: string;
    qmdQueriesTried?: string[];
    qmdCommand?: string;
    qmdCorporaTried?: string[];
    qmdCorpusResults?: QmdCorpusAttempt[];
    fileCount?: number;
  };
}

export interface ProjectFileDetailResult {
  project: ServerProject;
  path: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
}

export interface ProjectAnalysisResult {
  project: ServerProject;
  analyzedAt: string;
  memoryHome: string;
  memoryFiles: string[];
  projectPreset?: {
    id?: string;
    name: string;
    summary: string;
    domainPackIds?: string[];
  };
  domains?: DomainMaturityResult[];
  maturitySummary?: DomainMaturityOutput["summary"];
  eaiCatalog?: {
    asOfDate: string;
    interfaceCount: number;
    manualOverridesApplied: number;
    source: "preset-enabled" | "disabled";
    topInterfaces: Array<{
      interfaceId: string;
      interfaceName: string;
      purpose: string;
      usagePaths: string[];
      moduleUsagePaths: string[];
      javaCallSiteMethods: string[];
    }>;
  };
  frontCatalog?: {
    generatedAt: string;
    workspaceCount: number;
    screenCount: number;
    routeCount: number;
    apiCount: number;
    topScreens: Array<{
      screenCode?: string;
      filePath: string;
      routePaths: string[];
      apiPaths: string[];
      labels?: string[];
      capabilityTags?: string[];
    }>;
  };
  frontBackGraph?: {
    generatedAt: string;
    workspaceCount: number;
    linkCount: number;
    topLinks: Array<{
      screenCode?: string;
      routePath?: string;
      apiUrl: string;
      gatewayControllerMethod?: string;
      backendPath: string;
      controllerMethod: string;
      confidence: number;
      capabilityTags?: string[];
    }>;
  };
  structureCatalog?: {
    generatedAt: string;
    fileCount: number;
    packageCount: number;
    classCount: number;
    methodCount: number;
    topPackages: Array<{
      name: string;
      fileCount: number;
      methodCount: number;
    }>;
  };
  summary: string;
  architecture: string[];
  keyModules: Array<{
    name: string;
    path: string;
    role: string;
    confidence: number;
  }>;
  risks: string[];
  confidence: number;
  evidence: string[];
  diagnostics: {
    warmup: ProjectWarmupResult;
    lowConfidenceSignals: string[];
    usedFallback: boolean;
    llmCallCount: number;
    profileApplied: boolean;
    eaiCatalogCount: number;
    structureIndexCount: number;
    frontCatalogCount?: number;
    frontBackLinkCount?: number;
    activeDomainCount?: number;
    overallDomainMaturityScore?: number;
  };
}

export interface ProjectAskResponse {
  project: ServerProject;
  question: string;
  answer: string;
  confidence: number;
  qualityGatePassed: boolean;
  attempts: number;
  evidence: string[];
  caveats: string[];
  retrieval: {
    provider: "qmd" | "lexical";
    fallbackUsed: boolean;
    hitCount: number;
    topConfidence: number;
  };
  diagnostics: {
    lowConfidenceMode: boolean;
    qualityGateFailures: string[];
    usedFallback: boolean;
    llmCallCount: number;
    llmCallBudget: number;
    strategyType?: AskStrategyType;
    strategyConfidence?: number;
    strategyLlmUsed?: boolean;
    strategyReason?: string;
    scopeModules?: string[];
    hydratedEvidenceCount?: number;
    linkedEaiEvidenceCount?: number;
    downstreamTraceCount?: number;
    domainSelectionMode?: "auto" | "lock";
    activeDomainIds?: string[];
    matchedDomainIds?: string[];
    lockedDomainIds?: string[];
    frontBackGraphLoaded?: boolean;
    frontBackLinkCount?: number;
    frontBackEvidenceUsedCount?: number;
    deterministicUsed?: boolean;
    deterministicSymbol?: string;
    memoryFiles: string[];
  };
}

export interface ServerLlmModelOption {
  id: string;
  label: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
}

export interface ServerLlmSettingsResult {
  defaultModelId: string;
  continuationUsageRatio: number;
  retryPolicy: {
    sameTaskRetries: number;
    changedTaskRetries: number;
  };
  models: ServerLlmModelOption[];
}

type AskStrategyType =
  | "method_trace"
  | "module_flow_topdown"
  | "cross_layer_flow"
  | "architecture_overview"
  | "eai_interface"
  | "config_resource"
  | "general";

interface AskHydratedEvidenceItem {
  path: string;
  reason: string;
  snippet: string;
  kind: "method_block" | "line_window" | "resource_snippet";
  codeFile: boolean;
  moduleMatched: boolean;
  lineStart?: number;
  lineEnd?: number;
}

interface StructureSymbolRef {
  name: string;
  line: number;
  className?: string;
}

interface StructureFileEntry {
  path: string;
  size: number;
  mtimeMs: number;
  hash: string;
  packageName?: string;
  classes: StructureSymbolRef[];
  methods: StructureSymbolRef[];
  functions: StructureSymbolRef[];
  calls: string[];
  summary: string;
}

interface StructureIndexPackageSummary {
  name: string;
  fileCount: number;
  classCount: number;
  methodCount: number;
}

interface StructureIndexSnapshot {
  version: 1;
  generatedAt: string;
  workspaceDir: string;
  stats: {
    fileCount: number;
    packageCount: number;
    classCount: number;
    methodCount: number;
    changedFiles: number;
    reusedFiles: number;
  };
  topPackages: StructureIndexPackageSummary[];
  topMethods: Array<{ name: string; count: number }>;
  entries: Record<string, StructureFileEntry>;
}

interface ServerProjectStore {
  version: 1;
  updatedAt: string;
  projects: ServerProject[];
}

interface ProjectDebugEvent {
  timestamp: string;
  projectId: string;
  stage: "analyze" | "ask" | "search" | "index" | "file";
  status: "start" | "success" | "failure" | "info";
  message: string;
  metadata?: Record<string, unknown>;
}

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".pnpm-store",
  ".ohmyqwen",
  ".idea",
  ".vscode"
]);

const SEARCHABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".vue",
  ".jsp",
  ".html",
  ".css",
  ".scss",
  ".sass",
  ".java",
  ".kt",
  ".kts",
  ".xml",
  ".yml",
  ".yaml",
  ".py",
  ".go",
  ".rs",
  ".sql",
  ".sh",
  ".txt",
  ".toml",
  ".ini"
]);
const STRUCTURE_PARSE_EXTENSIONS = new Set([
  ".java",
  ".kt",
  ".kts",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".rs"
]);
const JAVA_LIKE_EXTENSIONS = new Set([".java", ".kt", ".kts"]);
const JAVASCRIPT_LIKE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const PYTHON_LIKE_EXTENSIONS = new Set([".py"]);
const GO_LIKE_EXTENSIONS = new Set([".go"]);
const RUST_LIKE_EXTENSIONS = new Set([".rs"]);

const MAX_FILE_SIZE_BYTES = 512 * 1024;
const MAX_DETAIL_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_ASK_MAX_ATTEMPTS = 3;
const DEFAULT_PROJECT_MAX_FILES = 20_000;
const ANALYSIS_CACHE_MAX_AGE_MS = Number.parseInt(
  process.env.OHMYQWEN_ANALYSIS_CACHE_MAX_AGE_MS ?? "1800000",
  10
);
const ANALYSIS_MEMORY_DIR = "project-analysis";
const PROFILE_MEMORY_DIR = "project-profile";
const EAI_MEMORY_DIR = "eai-dictionary";
const FRONT_CATALOG_MEMORY_DIR = "front-catalog";
const FRONT_BACK_GRAPH_MEMORY_DIR = "front-back-graph";
const DOMAIN_MATURITY_MEMORY_DIR = "domain-maturity";
const QUERY_MEMORY_DIR = "query-reports";
const STRUCTURE_MEMORY_DIR = "structure-index";
const RETRIEVAL_NOISE_PATH_PREFIXES = ["memory/", ".ohmyqwen/", "tmp/", "temp/"];
const STRUCTURE_INDEX_PROGRESS_INTERVAL = Math.max(
  100,
  Number.parseInt(process.env.OHMYQWEN_STRUCTURE_INDEX_PROGRESS_INTERVAL ?? "500", 10) || 500
);
const STRUCTURE_INDEX_SLOW_FILE_MS = Math.max(
  50,
  Number.parseInt(process.env.OHMYQWEN_STRUCTURE_INDEX_SLOW_FILE_MS ?? "250", 10) || 250
);
const STRUCTURE_LARGE_FILE_BYTES = Math.max(
  64 * 1024,
  Number.parseInt(process.env.OHMYQWEN_STRUCTURE_LARGE_FILE_BYTES ?? "100000", 10) || 100000
);
const STRUCTURE_INDEX_YIELD_INTERVAL = Math.max(
  25,
  Number.parseInt(process.env.OHMYQWEN_STRUCTURE_INDEX_YIELD_INTERVAL ?? "100", 10) || 100
);
const EAI_PROGRESS_INTERVAL = Math.max(
  25,
  Number.parseInt(process.env.OHMYQWEN_EAI_PROGRESS_INTERVAL ?? "100", 10) || 100
);
const CODE_FILE_EXTENSIONS = new Set([
  ".java",
  ".kt",
  ".kts",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".rs",
  ".vue",
  ".jsp",
  ".html"
]);
const CALL_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "new",
  "return",
  "throw",
  "else",
  "super",
  "this",
  "case",
  "synchronized"
]);

let cachedStore: ServerProjectStore | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function storePath(): string {
  return path.resolve(process.cwd(), ".ohmyqwen", "server", "projects.json");
}

function debugLogPath(): string {
  return path.resolve(process.cwd(), ".ohmyqwen", "server", "project-debug-events.jsonl");
}

async function appendProjectDebugEvent(event: ProjectDebugEvent): Promise<void> {
  const line = `${JSON.stringify(event)}\n`;
  const filePath = debugLogPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, line, "utf8");
  if (process.env.OHMYQWEN_SERVER_TRACE === "1") {
    const metadata = event.metadata ? ` ${JSON.stringify(event.metadata)}` : "";
    process.stdout.write(
      `[project-trace] ${event.timestamp} project=${event.projectId} ${event.stage}/${event.status} ${event.message}${metadata}\n`
    );
  }
}

async function loadStore(): Promise<ServerProjectStore> {
  if (cachedStore) {
    return {
      version: cachedStore.version,
      updatedAt: cachedStore.updatedAt,
      projects: [...cachedStore.projects]
    };
  }

  const filePath = storePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = ServerProjectStoreSchema.parse(JSON.parse(raw));
    const normalized: ServerProjectStore = {
      version: 1,
      updatedAt: parsed.updatedAt,
      projects: parsed.projects
    };
    cachedStore = normalized;
    return {
      version: normalized.version,
      updatedAt: normalized.updatedAt,
      projects: [...normalized.projects]
    };
  } catch {
    const fallback: ServerProjectStore = {
      version: 1,
      updatedAt: nowIso(),
      projects: []
    };
    cachedStore = fallback;
    return {
      version: fallback.version,
      updatedAt: fallback.updatedAt,
      projects: []
    };
  }
}

async function saveStore(store: ServerProjectStore): Promise<void> {
  const next: ServerProjectStore = {
    version: 1,
    updatedAt: nowIso(),
    projects: [...store.projects].sort((a, b) =>
      a.updatedAt === b.updatedAt ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt)
    )
  };

  const filePath = storePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  cachedStore = next;
}

async function ensureWorkspaceDir(workspaceDir: string): Promise<string> {
  const trimmed = workspaceDir.trim();
  if (!trimmed) {
    throw new Error("workspaceDir is required");
  }

  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(process.cwd(), trimmed);

  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`workspaceDir is not a directory: ${resolved}`);
  }

  return resolved;
}

async function ensureLinkedWorkspaceDirs(linkedWorkspaceDirs?: string[]): Promise<string[]> {
  const uniqueDirs = unique((linkedWorkspaceDirs ?? []).map((entry) => entry.trim()).filter(Boolean));
  const resolved: string[] = [];
  for (const dir of uniqueDirs) {
    resolved.push(await ensureWorkspaceDir(dir));
  }
  return resolved;
}

async function isFrontendWorkspace(workspaceDir: string): Promise<boolean> {
  const candidates = [
    path.resolve(workspaceDir, "src/views"),
    path.resolve(workspaceDir, "src/router"),
    path.resolve(workspaceDir, "src/plugins/com/Axios.js")
  ];
  for (const candidate of candidates) {
    try {
      await fs.stat(candidate);
      return true;
    } catch {
      // ignore
    }
  }
  return false;
}

function sanitizeProjectHomeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || "project";
}

function defaultExternalProjectHome(workspaceDir: string): string {
  const resolvedWorkspace = path.resolve(workspaceDir);
  const slug = sanitizeProjectHomeSegment(path.basename(resolvedWorkspace));
  const hash = createHash("sha1").update(resolvedWorkspace).digest("hex").slice(0, 10);
  return path.resolve(process.cwd(), ".ohmyqwen", "server", "project-homes", `${slug}-${hash}`);
}

function toProject(value: ServerProject): ServerProject {
  return {
    ...value,
    linkedWorkspaceDirs: [...(value.linkedWorkspaceDirs ?? [])],
    retrieval: value.retrieval ? { ...value.retrieval } : undefined,
    llm: value.llm ? { ...value.llm } : undefined
  };
}

export function resolveServerProjectHome(workspaceDir: string): string {
  const envProjectHome = process.env.OHMYQWEN_PROJECT_HOME?.trim();
  if (!envProjectHome) {
    return isInsideParent(process.cwd(), workspaceDir)
      ? path.resolve(workspaceDir)
      : defaultExternalProjectHome(workspaceDir);
  }

  return path.isAbsolute(envProjectHome)
    ? path.resolve(envProjectHome)
    : path.resolve(workspaceDir, envProjectHome);
}

export function resolveServerProjectMemoryHome(workspaceDir: string): string {
  const projectHome = resolveServerProjectHome(workspaceDir);
  const envMemoryHome = process.env.OHMYQWEN_MEMORY_HOME?.trim();
  if (!envMemoryHome) {
    return path.resolve(projectHome, "memory");
  }

  return path.isAbsolute(envMemoryHome)
    ? path.resolve(envMemoryHome)
    : path.resolve(projectHome, envMemoryHome);
}

export function resolveServerProjectContextCachePath(workspaceDir: string): string {
  return path.resolve(resolveServerProjectHome(workspaceDir), ".ohmyqwen", "cache", "context-index.json");
}

export function resolveServerProjectStructureSnapshotPath(workspaceDir: string): string {
  return path.resolve(resolveServerProjectHome(workspaceDir), ".ohmyqwen", "cache", "structure-index.v1.json");
}

function resolveMemoryHome(workspaceDir: string): string {
  return resolveServerProjectMemoryHome(workspaceDir);
}

async function resolveProjectLlmContext(project: ServerProject): Promise<{
  settings: Awaited<ReturnType<typeof loadLlmRuntimeSettings>>;
  model: ReturnType<typeof resolveLlmModelProfile>;
  stageTokenCaps: { PLAN: number; IMPLEMENT: number; VERIFY: number };
}> {
  const settings = await loadLlmRuntimeSettings();
  const model = resolveLlmModelProfile(settings, project.llm?.modelId);
  const stageTokenCaps = deriveStageTokenCapsFromModel({
    model,
    usageRatio: settings.continuationUsageRatio
  });
  return {
    settings,
    model,
    stageTokenCaps
  };
}

function mergeRetrievalWithModelCaps(
  retrieval: ServerProject["retrieval"] | undefined,
  stageTokenCaps: { PLAN: number; IMPLEMENT: number; VERIFY: number }
): ServerProject["retrieval"] {
  return {
    ...(retrieval ?? {}),
    stageTokenCaps: {
      ...stageTokenCaps,
      ...(retrieval?.stageTokenCaps ?? {})
    }
  };
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function toSearchTokens(query: string): string[] {
  return Array.from(
    new Set(
      (query.toLowerCase().match(/[a-z0-9가-힣._/-]+/g) ?? [])
        .map((entry) => entry.trim())
        .filter((entry) => entry.length >= 2)
    )
  ).slice(0, 24);
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function isRetrievalNoisePath(relativePath: string): boolean {
  const normalized = toForwardSlash(relativePath).toLowerCase();
  return RETRIEVAL_NOISE_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function compactQueryForSearch(query: string): string {
  const stopwords = new Set([
    "어떻게",
    "어디",
    "확인",
    "확인해줘",
    "해줘",
    "이루어지는지",
    "please",
    "check",
    "how",
    "where",
    "what",
    "the",
    "and",
    "or"
  ]);

  const tokens = toSearchTokens(query)
    .filter((token) => !stopwords.has(token))
    .slice(0, 5);
  return tokens.join(" ");
}

function buildAskQueryCandidates(options: {
  question: string;
  strategy: AskStrategyType;
  targetSymbols?: string[];
  moduleCandidates?: string[];
  domainPacks?: DomainPack[];
  questionTags?: string[];
}): string[] {
  const question = options.question;
  const compact = compactQueryForSearch(question);
  const hasInsuranceClaim = /(보험금|청구|claim|benefit)/i.test(question);
  const hasLogicIntent =
    /(로직|흐름|어떻게|구현|처리|service|controller|domain|transaction|dao|mybatis)/i.test(question);
  const targetSymbols = unique((options.targetSymbols ?? []).slice(0, 5));
  const moduleCandidates = unique((options.moduleCandidates ?? []).slice(0, 3));
  const questionTags =
    options.questionTags ??
    extractQuestionCapabilityTags(question, {
      domainPacks: options.domainPacks
    });
  const capabilityTerms = expandCapabilitySearchTerms(questionTags, {
    domainPacks: options.domainPacks
  }).slice(0, 8);

  const candidates = [
    question,
    compact,
    targetSymbols.length > 0 ? `${targetSymbols.join(" ")} ${compact}` : "",
    moduleCandidates.length > 0 ? `${moduleCandidates.join(" ")} ${compact}` : ""
  ];

  if (options.strategy === "method_trace" || hasLogicIntent) {
    candidates.push(`${compact} controller service domain mapper mybatis`);
  } else if (options.strategy === "module_flow_topdown") {
    candidates.push(`${compact} controller service requestmapping orchestration mapper eai`);
  } else if (options.strategy === "cross_layer_flow") {
    candidates.push(`${compact} frontend vue route api gateway controller service`);
  } else if (options.strategy === "eai_interface") {
    candidates.push(`${compact} eai interface service xml`);
  } else if (options.strategy === "config_resource") {
    candidates.push(`${compact} xml config applicationcontext`);
  } else if (options.strategy === "architecture_overview") {
    candidates.push(`${compact} architecture module package service`);
  }

  if (capabilityTerms.length > 0) {
    candidates.push(`${capabilityTerms.join(" ")} ${compact}`.trim());
  }

  if (hasInsuranceClaim) {
    candidates.push(`${compact} 보험금 청구 dcp-insurance`);
  }
  for (const moduleName of moduleCandidates) {
    candidates.push(`${moduleName} ${compact} controller service`);
    if (hasLogicIntent) {
      candidates.push(`${moduleName} benefit claim controller service submit save`);
    }
  }

  return unique(candidates.filter(Boolean));
}

function isSearchableFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SEARCHABLE_EXTENSIONS.has(ext);
}

function isStructureParseTarget(filePath: string): boolean {
  if (isStructureAssetNoisePath(filePath)) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  return STRUCTURE_PARSE_EXTENSIONS.has(ext);
}

function isStructureAssetNoisePath(filePath: string): boolean {
  const normalized = toForwardSlash(filePath).toLowerCase();
  const ext = path.extname(normalized);
  if (!JAVASCRIPT_LIKE_EXTENSIONS.has(ext)) {
    return false;
  }

  const baseName = path.basename(normalized);
  if (baseName.endsWith(".min.js")) {
    return true;
  }

  return (
    normalized.startsWith("resources/") ||
    normalized.includes("/resources/") ||
    normalized.includes("/webapp/js/ext-lib/") ||
    normalized.includes("/vendor/") ||
    normalized.includes("/third_party/") ||
    normalized.includes("/third-party/")
  );
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function collectProjectFiles(workspaceDir: string, maxFiles = 10_000): Promise<string[]> {
  const queue: string[] = [workspaceDir];
  const results: string[] = [];

  while (queue.length > 0 && results.length < maxFiles) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= maxFiles) {
        break;
      }

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }

        if (entry.name.startsWith(".")) {
          continue;
        }

        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!isSearchableFile(entry.name)) {
        continue;
      }

      const relative = path.relative(workspaceDir, fullPath);
      if (isRetrievalNoisePath(relative)) {
        continue;
      }

      results.push(relative);
    }
  }

  return results;
}

async function readTextFileSafe(filePath: string): Promise<string | undefined> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return undefined;
  }

  if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) {
    return undefined;
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw;
  } catch {
    return undefined;
  }
}

function makeSnippet(content: string, token: string): string | undefined {
  const lines = content.split("\n");
  const index = lines.findIndex((line) => line.toLowerCase().includes(token));
  if (index < 0) {
    return undefined;
  }

  return lines[index]?.trim().slice(0, 180);
}

function summarizeContentLine(content: string): string {
  return (
    content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*"))
      .slice(0, 3)
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 260) || "(empty file)"
  );
}

function normalizeHitConfidence(hit: ProjectSearchHit): number {
  const divisor = hit.source === "qmd" ? 10 : 20;
  const normalized = hit.score / divisor;
  return Math.max(0, Math.min(1, Number.isFinite(normalized) ? normalized : 0));
}

function summarizeLowConfidenceSignals(hits: ProjectSearchHit[]): string[] {
  if (hits.length === 0) {
    return ["검색 결과가 비어있어 누락 가능성이 높습니다."];
  }

  const topConfidence = normalizeHitConfidence(hits[0]);
  const avgConfidence =
    hits.reduce((sum, hit) => sum + normalizeHitConfidence(hit), 0) / Math.max(1, hits.length);
  const warnings: string[] = [];

  if (topConfidence < 0.35) {
    warnings.push("상위 결과 confidence가 낮아 핵심 근거 누락 가능성이 있습니다.");
  }
  if (avgConfidence < 0.25) {
    warnings.push("전체 평균 confidence가 낮아 검색 미스가 있을 수 있습니다.");
  }
  if (hits.length < 3) {
    warnings.push("검색 결과 수가 적어 판단 근거가 제한적입니다.");
  }

  return warnings;
}

async function fileExistsUnderWorkspace(workspaceDir: string, relativePath: string): Promise<boolean> {
  try {
    const resolved = resolveProjectFilePath(workspaceDir, relativePath);
    const stat = await fs.stat(resolved.absolutePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function lexicalSearch(options: {
  workspaceDir: string;
  files: string[];
  query: string;
  limit: number;
}): Promise<ProjectSearchHit[]> {
  const tokens = toSearchTokens(options.query);
  if (tokens.length === 0) {
    return [];
  }

  const logicIntent = /(로직|흐름|어떻게|구현|처리|service|controller|domain|transaction|mapper|mybatis)/i.test(
    options.query
  );
  const insuranceClaimIntent = /(보험금|청구|claim|benefit)/i.test(options.query);

  const hits: ProjectSearchHit[] = [];

  for (const relativePath of options.files) {
    if (isRetrievalNoisePath(relativePath)) {
      continue;
    }

    const normalizedPath = relativePath.toLowerCase();
    let score = 0;
    const pathMatches: string[] = [];
    const contentMatches: string[] = [];

    for (const token of tokens) {
      if (normalizedPath.includes(token)) {
        score += 4;
        pathMatches.push(token);
      }
    }

    const absolutePath = path.resolve(options.workspaceDir, relativePath);
    const content = await readTextFileSafe(absolutePath);
    const ext = path.extname(relativePath).toLowerCase();
    const isCodeFile = /\.(java|kt|kts|js|jsx|ts|tsx|py|go|rs)$/i.test(ext);
    if (logicIntent) {
      if (isCodeFile) {
        score += 2.5;
      } else if (ext === ".xml") {
        score -= 0.75;
      }
    }
    if (insuranceClaimIntent && normalizedPath.includes("dcp-insurance/")) {
      score += 3.5;
    }

    if (content) {
      const lowered = content.toLowerCase();
      for (const token of tokens) {
        if (lowered.includes(token)) {
          score += 1.5;
          contentMatches.push(token);
        }
      }

      if (score > 0) {
        hits.push({
          path: relativePath,
          score,
          source: "lexical",
          reasons: unique([
            pathMatches.length > 0 ? `path-match:${unique(pathMatches).slice(0, 6).join(",")}` : "",
            contentMatches.length > 0
              ? `content-match:${unique(contentMatches).slice(0, 8).join(",")}`
              : ""
          ]),
          snippet: makeSnippet(content, tokens[0])
        });
      }
      continue;
    }

    if (score > 0) {
      hits.push({
        path: relativePath,
        score,
        source: "lexical",
        reasons: unique([
          pathMatches.length > 0 ? `path-match:${unique(pathMatches).slice(0, 6).join(",")}` : ""
        ])
      });
    }
  }

  hits.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.path.localeCompare(b.path)));
  return hits.slice(0, options.limit);
}

export async function listServerProjects(): Promise<ServerProject[]> {
  const store = await loadStore();
  return store.projects.map((project) => toProject(project));
}

export async function getServerLlmSettings(): Promise<ServerLlmSettingsResult> {
  const settings = await loadLlmRuntimeSettings();
  return {
    defaultModelId: settings.defaultModelId,
    continuationUsageRatio: settings.continuationUsageRatio,
    retryPolicy: {
      sameTaskRetries: settings.retryPolicy.sameTaskRetries,
      changedTaskRetries: settings.retryPolicy.changedTaskRetries
    },
    models: settings.models.map((model) => ({
      id: model.id,
      label: model.label ?? model.id,
      contextWindowTokens: model.contextWindowTokens,
      maxOutputTokens: model.maxOutputTokens
    }))
  };
}

export async function getServerProject(id: string): Promise<ServerProject | undefined> {
  const store = await loadStore();
  const found = store.projects.find((project) => project.id === id);
  return found ? toProject(found) : undefined;
}

export async function listServerProjectPresets(): Promise<ProjectPreset[]> {
  return listProjectPresets();
}

export async function upsertServerProjectPreset(input: UpsertProjectPresetInput): Promise<ProjectPreset> {
  return upsertProjectPreset(input);
}

export async function removeServerProjectPreset(id: string): Promise<void> {
  await removeProjectPreset(id);
}

export async function listServerDomainPacks(): Promise<DomainPack[]> {
  return listDomainPacks();
}

export async function getServerDomainPack(id: string): Promise<DomainPack | undefined> {
  return getDomainPackById(id);
}

export async function upsertServerDomainPack(input: UpsertDomainPackInput): Promise<DomainPack> {
  return upsertDomainPack(input);
}

export async function removeServerDomainPack(id: string): Promise<void> {
  await removeDomainPack(id);
}

export async function listProjectDebugEvents(options: {
  projectId: string;
  limit?: number;
}): Promise<ProjectDebugEvent[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
  try {
    const raw = await fs.readFile(debugLogPath(), "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const events: ProjectDebugEvent[] = [];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line) {
        continue;
      }

      try {
        const parsed = JSON.parse(line) as ProjectDebugEvent;
        if (parsed.projectId !== options.projectId) {
          continue;
        }
        events.push(parsed);
        if (events.length >= limit) {
          break;
        }
      } catch {
        // ignore malformed line
      }
    }

    return events.reverse();
  } catch {
    return [];
  }
}

export async function upsertServerProject(input: UpsertServerProjectInput): Promise<ServerProject> {
  const parsed = UpsertServerProjectInputSchema.parse(input);
  const resolvedWorkspace = await ensureWorkspaceDir(parsed.workspaceDir);
  const hasLinkedWorkspaceUpdate = Array.isArray(parsed.linkedWorkspaceDirs);
  const resolvedLinkedWorkspaces = await ensureLinkedWorkspaceDirs(parsed.linkedWorkspaceDirs);
  const normalizedPresetId = parsed.presetId?.trim() || undefined;
  const normalizedModelId = parsed.llm?.modelId?.trim() || undefined;
  if (normalizedPresetId) {
    const preset = await getProjectPresetById(normalizedPresetId);
    if (!preset) {
      throw new Error(`preset not found: ${normalizedPresetId}`);
    }
  }

  if (normalizedModelId) {
    const settings = await loadLlmRuntimeSettings();
    if (!settings.models.some((model) => model.id === normalizedModelId)) {
      throw new Error(`llm model not found: ${normalizedModelId}`);
    }
  }

  const store = await loadStore();
  const now = nowIso();

  const index = parsed.id
    ? store.projects.findIndex((project) => project.id === parsed.id)
    : -1;

  if (index >= 0) {
    const existing = store.projects[index];
    const updated: ServerProject = {
      ...existing,
      name: parsed.name,
      workspaceDir: resolvedWorkspace,
      linkedWorkspaceDirs: hasLinkedWorkspaceUpdate
        ? resolvedLinkedWorkspaces
        : (existing.linkedWorkspaceDirs ?? []),
      description: parsed.description ?? existing.description,
      presetId: normalizedPresetId ?? existing.presetId,
      defaultMode: parsed.defaultMode ?? existing.defaultMode,
      defaultDryRun: parsed.defaultDryRun ?? existing.defaultDryRun,
      retrieval: parsed.retrieval ?? existing.retrieval,
      llm: normalizedModelId ? { modelId: normalizedModelId } : (parsed.llm ?? existing.llm),
      updatedAt: now
    };

    store.projects[index] = ServerProjectSchema.parse(updated);
    await saveStore(store);
    return toProject(store.projects[index]);
  }

  const created: ServerProject = ServerProjectSchema.parse({
    id: parsed.id ?? randomUUID().slice(0, 12),
    name: parsed.name,
    workspaceDir: resolvedWorkspace,
    linkedWorkspaceDirs: resolvedLinkedWorkspaces,
    description: parsed.description ?? "",
    presetId: normalizedPresetId,
    defaultMode: parsed.defaultMode ?? "feature",
    defaultDryRun: parsed.defaultDryRun ?? false,
    retrieval: parsed.retrieval,
    llm: normalizedModelId ? { modelId: normalizedModelId } : undefined,
    createdAt: now,
    updatedAt: now
  });

  store.projects.push(created);
  await saveStore(store);
  return toProject(created);
}

export async function removeServerProject(id: string): Promise<void> {
  const store = await loadStore();
  const nextProjects = store.projects.filter((project) => project.id !== id);
  if (nextProjects.length === store.projects.length) {
    throw new Error(`project not found: ${id}`);
  }

  store.projects = nextProjects;
  await saveStore(store);
}

async function patchProject(id: string, patch: Partial<ServerProject>): Promise<ServerProject> {
  const store = await loadStore();
  const index = store.projects.findIndex((project) => project.id === id);
  if (index < 0) {
    throw new Error(`project not found: ${id}`);
  }

  const current = store.projects[index];
  const next = ServerProjectSchema.parse({
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: nowIso()
  });

  store.projects[index] = next;
  await saveStore(store);
  return toProject(next);
}

function resolveProjectFilePath(workspaceDir: string, rawPath: string): {
  absolutePath: string;
  relativePath: string;
} {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error("file path is required");
  }

  const absolutePath = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceDir, trimmed);
  const relativePath = path.relative(workspaceDir, absolutePath);

  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`file path escapes workspace: ${rawPath}`);
  }

  return {
    absolutePath,
    relativePath: relativePath.replace(/\\/g, "/")
  };
}

export async function readServerProjectFile(options: {
  projectId: string;
  filePath: string;
  maxBytes?: number;
}): Promise<ProjectFileDetailResult> {
  const project = await getServerProject(options.projectId);
  if (!project) {
    throw new Error(`project not found: ${options.projectId}`);
  }

  await appendProjectDebugEvent({
    timestamp: nowIso(),
    projectId: options.projectId,
    stage: "file",
    status: "start",
    message: "file detail read requested",
    metadata: {
      path: options.filePath
    }
  });

  const resolved = resolveProjectFilePath(project.workspaceDir, options.filePath);
  const maxBytes = Math.max(16 * 1024, Math.min(options.maxBytes ?? MAX_DETAIL_FILE_BYTES, 8 * 1024 * 1024));
  let stat;
  try {
    stat = await fs.stat(resolved.absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "file",
        status: "failure",
        message: "file detail path missing (stale index candidate)",
        metadata: {
          path: resolved.relativePath
        }
      });
      throw new Error(
        `파일을 찾을 수 없습니다(이동/삭제 가능성). 재색인 후 다시 시도하세요: ${resolved.relativePath}`
      );
    }
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "file",
      status: "failure",
      message: error instanceof Error ? error.message : String(error),
      metadata: {
        path: resolved.relativePath
      }
    });
    throw error;
  }
  if (!stat.isFile()) {
    throw new Error(`not a file: ${resolved.relativePath}`);
  }

  if (stat.size <= maxBytes) {
    const content = await fs.readFile(resolved.absolutePath, "utf8");
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "file",
      status: "success",
      message: "file detail read completed",
      metadata: {
        path: resolved.relativePath,
        sizeBytes: stat.size,
        truncated: false
      }
    });
    return {
      project,
      path: resolved.relativePath,
      content,
      sizeBytes: stat.size,
      truncated: false
    };
  }

  const handle = await fs.open(resolved.absolutePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "file",
      status: "info",
      message: "file detail truncated due maxBytes",
      metadata: {
        path: resolved.relativePath,
        sizeBytes: stat.size,
        maxBytes
      }
    });
    return {
      project,
      path: resolved.relativePath,
      content: buffer.toString("utf8", 0, bytesRead),
      sizeBytes: stat.size,
      truncated: true
    };
  } finally {
    await handle.close();
  }
}

const ProjectAnalysisOutputSchema = z.object({
  summary: z.string().min(1),
  architecture: z.array(z.string()).min(1),
  keyModules: z
    .array(
      z.object({
        name: z.string().min(1),
        path: z.string().min(1),
        role: z.string().min(1),
        confidence: z.number().min(0).max(1).default(0.5)
      })
    )
    .default([]),
  risks: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([])
});

const ProjectAskOutputSchema = z.object({
  answer: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([]),
  caveats: z.array(z.string()).default([])
});

const AskStrategyDecisionSchema = z.object({
  strategy: z.enum([
    "method_trace",
    "module_flow_topdown",
    "cross_layer_flow",
    "architecture_overview",
    "eai_interface",
    "config_resource",
    "general"
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).default(""),
  targetSymbols: z.array(z.string()).default([])
});

function buildFileExtensionStats(files: string[]): Array<{ ext: string; count: number }> {
  const map = new Map<string, number>();
  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || "(no-ext)";
    map.set(ext, (map.get(ext) ?? 0) + 1);
  }

  return Array.from(map.entries())
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.ext.localeCompare(b.ext)))
    .slice(0, 12);
}

function buildTopDirectoryStats(files: string[]): Array<{ dir: string; count: number }> {
  const map = new Map<string, number>();
  for (const file of files) {
    const normalized = toForwardSlash(file);
    const rootDir = normalized.includes("/") ? normalized.split("/")[0] : "(root)";
    map.set(rootDir, (map.get(rootDir) ?? 0) + 1);
  }

  return Array.from(map.entries())
    .map(([dir, count]) => ({ dir, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.dir.localeCompare(b.dir)))
    .slice(0, 20);
}

function buildDeterministicProjectSummary(options: {
  project: ServerProject;
  files: string[];
  warmup: ProjectWarmupResult;
}): {
  summary: string;
  architecture: string[];
  keyModules: Array<{ name: string; path: string; role: string; confidence: number }>;
  risks: string[];
  confidence: number;
  evidence: string[];
} {
  const extStats = buildFileExtensionStats(options.files);
  const topDirs = buildTopDirectoryStats(options.files);
  const keyModules = options.files.slice(0, 12).map((file) => ({
    name: path.basename(file),
    path: toForwardSlash(file),
    role: "candidate-module",
    confidence: 0.35
  }));

  return {
    summary: `${options.project.name} 프로젝트는 총 ${options.files.length}개 파일이 감지되었고, 주요 디렉터리는 ${topDirs
      .slice(0, 3)
      .map((entry) => `${entry.dir}(${entry.count})`)
      .join(", ")} 입니다.`,
    architecture: topDirs.slice(0, 8).map((entry) => `${entry.dir}: ${entry.count} files`),
    keyModules,
    risks: summarizeLowConfidenceSignals([]),
    confidence: 0.42,
    evidence: [
      `fileCount=${options.files.length}`,
      `provider=${options.warmup.selectedProvider}`,
      `fallbackUsed=${options.warmup.fallbackUsed}`,
      `topExt=${extStats
        .slice(0, 5)
        .map((entry) => `${entry.ext}:${entry.count}`)
        .join(",")}`
    ]
  };
}

function formatTs(value: Date): string {
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(
    value.getHours()
  )}${pad(value.getMinutes())}${pad(value.getSeconds())}`;
}

function buildAnalysisMarkdown(input: {
  project: ServerProject;
  analyzedAt: string;
  summary: string;
  architecture: string[];
  keyModules: Array<{ name: string; path: string; role: string; confidence: number }>;
  risks: string[];
  confidence: number;
  evidence: string[];
  lowConfidenceSignals: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# Project Analysis Memory`);
  lines.push("");
  lines.push(`- projectId: ${input.project.id}`);
  lines.push(`- projectName: ${input.project.name}`);
  lines.push(`- workspaceDir: ${input.project.workspaceDir}`);
  lines.push(`- analyzedAt: ${input.analyzedAt}`);
  lines.push(`- confidence: ${input.confidence.toFixed(2)}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(input.summary);
  lines.push("");
  lines.push("## Architecture");
  for (const item of input.architecture) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Key Modules");
  for (const module of input.keyModules) {
    lines.push(
      `- ${module.path} | role=${module.role} | confidence=${module.confidence.toFixed(2)} | name=${module.name}`
    );
  }
  lines.push("");
  lines.push("## Evidence");
  for (const item of input.evidence) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Risks");
  for (const risk of input.risks) {
    lines.push(`- ${risk}`);
  }
  lines.push("");
  lines.push("## Low Confidence Signals");
  for (const signal of input.lowConfidenceSignals) {
    lines.push(`- ${signal}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildProjectPresetMarkdown(input: {
  project: ServerProject;
  preset: ProjectPreset;
  updatedAt: string;
  activeDomains?: DomainPack[];
  maturity?: DomainMaturityOutput;
}): string {
  const lines: string[] = [];
  lines.push("# Project Preset Context");
  lines.push("");
  lines.push(`- projectId: ${input.project.id}`);
  lines.push(`- projectName: ${input.project.name}`);
  lines.push(`- preset: ${input.preset.name}`);
  lines.push(`- updatedAt: ${input.updatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(input.preset.summary);
  lines.push("");
  lines.push("## Key Facts");
  for (const fact of input.preset.keyFacts) {
    lines.push(`- ${fact}`);
  }
  lines.push("");
  if ((input.activeDomains ?? []).length > 0) {
    lines.push("## Active Domains");
    for (const domain of input.activeDomains ?? []) {
      lines.push(`- ${domain.name} (${domain.id})`);
    }
    lines.push("");
  }
  if (input.maturity && input.maturity.domains.length > 0) {
    lines.push("## Domain Maturity");
    for (const domain of input.maturity.domains.slice(0, 12)) {
      lines.push(`- ${domain.name} | score=${domain.score} | band=${domain.band} | signals=${domain.strongestSignals.join(", ") || "-"}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function resolveProjectDomainPacks(preset?: ProjectPreset): Promise<DomainPack[]> {
  const allDomainPacks = await listDomainPacks();
  if (!preset) {
    return [];
  }
  return resolveDomainPacksByIds(allDomainPacks, preset.domainPackIds);
}

function uniqueText(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function resolveAskDomainSelection(options: {
  question: string;
  activeDomainPacks: DomainPack[];
  requestedDomainIds?: string[];
  mode?: "auto" | "lock";
}): {
  effectiveDomainPacks: DomainPack[];
  matchedDomains: Array<{ id: string; name: string; score: number; matchedTags: string[]; reasons: string[] }>;
  lockedDomainIds: string[];
  mode: "auto" | "lock";
} {
  const mode = options.mode === "lock" ? "lock" : "auto";
  const lockedDomainIds = uniqueText(options.requestedDomainIds ?? []).filter((id) =>
    options.activeDomainPacks.some((domainPack) => domainPack.id === id)
  );
  const matchedDomains = detectQuestionDomainPacks(options.question, options.activeDomainPacks);

  if (mode === "lock" && lockedDomainIds.length > 0) {
    return {
      effectiveDomainPacks: resolveDomainPacksByIds(options.activeDomainPacks, lockedDomainIds),
      matchedDomains,
      lockedDomainIds,
      mode
    };
  }

  const autoMatchedIds = matchedDomains.map((domain) => domain.id);
  return {
    effectiveDomainPacks:
      autoMatchedIds.length > 0
        ? resolveDomainPacksByIds(options.activeDomainPacks, autoMatchedIds)
        : options.activeDomainPacks,
    matchedDomains,
    lockedDomainIds: [],
    mode: "auto"
  };
}

function buildDomainMaturityMarkdown(input: {
  project: ServerProject;
  analyzedAt: string;
  maturity: DomainMaturityOutput;
}): string {
  const lines: string[] = [];
  lines.push("# Domain Maturity");
  lines.push("");
  lines.push(`- projectId: ${input.project.id}`);
  lines.push(`- projectName: ${input.project.name}`);
  lines.push(`- analyzedAt: ${input.analyzedAt}`);
  lines.push(`- overallScore: ${input.maturity.summary.overallScore}`);
  lines.push(`- activeCount: ${input.maturity.summary.activeCount}`);
  lines.push(`- matureCount: ${input.maturity.summary.matureCount}`);
  lines.push("");
  lines.push("## Domains");
  for (const domain of input.maturity.domains) {
    lines.push(`- ${domain.name} (${domain.id}) | score=${domain.score} | band=${domain.band}`);
    lines.push(
      `  - counts: capabilities=${domain.counts.capabilitiesMatched}, screens=${domain.counts.screenCount}, backend=${domain.counts.backendRouteCount}, links=${domain.counts.linkCount}, downstream=${domain.counts.downstreamTraceCount}, eai=${domain.counts.eaiCount}, exemplars=${domain.counts.exemplarPassed}/${domain.counts.exemplarTotal}`
    );
    lines.push(
      `  - breakdown: vocab=${domain.breakdown.vocabularyCoverage}, front=${domain.breakdown.frontendCoverage}, back=${domain.breakdown.backendCoverage}, link=${domain.breakdown.crossLayerCoverage}, downstream=${domain.breakdown.downstreamCoverage}, integration=${domain.breakdown.integrationCoverage}, regression=${domain.breakdown.regressionCoverage}`
    );
    if (domain.strongestSignals.length > 0) {
      lines.push(`  - strongest: ${domain.strongestSignals.join(", ")}`);
    }
    if (domain.weakestSignals.length > 0) {
      lines.push(`  - weakest: ${domain.weakestSignals.join(", ")}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function parseXmlTag(content: string, tagName: string): string | undefined {
  const matched = content.match(new RegExp(`<${tagName}>\\s*([^<]+?)\\s*<\\/${tagName}>`, "i"));
  return matched?.[1]?.trim();
}

function inferEaiPurpose(content: string): string {
  const candidates = [
    parseXmlTag(content, "description"),
    parseXmlTag(content, "serviceDesc"),
    parseXmlTag(content, "serviceName"),
    parseXmlTag(content, "interfaceDesc")
  ].filter(Boolean) as string[];

  return candidates[0] ?? "purpose-not-found";
}

const EaiOverrideItemSchema = z.object({
  op: z.enum(["upsert", "delete"]),
  interfaceId: z.string().min(1),
  interfaceName: z.string().optional(),
  purpose: z.string().optional(),
  sourcePath: z.string().optional(),
  usagePaths: z.array(z.string()).optional()
});

const EaiOverrideFileSchema = z.object({
  asOfDate: z.string().optional(),
  entries: z.array(EaiOverrideItemSchema).default([])
});

async function loadEaiOverrides(options: {
  workspaceDir: string;
  manualOverridesFile?: string;
}): Promise<{ asOfDate?: string; entries: Array<z.infer<typeof EaiOverrideItemSchema>>; sourcePath?: string }> {
  const rawPath = options.manualOverridesFile?.trim();
  if (!rawPath) {
    return { entries: [] };
  }

  const resolvedPath = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(options.workspaceDir, rawPath);
  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    const parsed = EaiOverrideFileSchema.parse(JSON.parse(raw));
    return {
      asOfDate: parsed.asOfDate?.trim() || undefined,
      entries: parsed.entries,
      sourcePath: resolvedPath
    };
  } catch {
    return {
      entries: [],
      sourcePath: resolvedPath
    };
  }
}

function applyEaiOverrides(options: {
  baseEntries: EaiDictionaryEntry[];
  overrides: Array<z.infer<typeof EaiOverrideItemSchema>>;
}): { entries: EaiDictionaryEntry[]; appliedCount: number } {
  const map = new Map<string, EaiDictionaryEntry>();
  for (const entry of options.baseEntries) {
    map.set(entry.interfaceId, entry);
  }

  let appliedCount = 0;
  for (const override of options.overrides) {
    if (override.op === "delete") {
      if (map.delete(override.interfaceId)) {
        appliedCount += 1;
      }
      continue;
    }

    const existing = map.get(override.interfaceId);
    map.set(override.interfaceId, {
      interfaceId: override.interfaceId,
      interfaceName: override.interfaceName?.trim() || existing?.interfaceName || override.interfaceId,
      purpose: override.purpose?.trim() || existing?.purpose || "manual-override",
      sourcePath: override.sourcePath?.trim() || existing?.sourcePath || "(manual)",
      envPaths: existing?.envPaths ?? [],
      usagePaths: override.usagePaths?.length
        ? unique(override.usagePaths.map((item) => toForwardSlash(item)))
        : existing?.usagePaths ?? [],
      moduleUsagePaths: existing?.moduleUsagePaths ?? [],
      reqSystemIds: existing?.reqSystemIds ?? [],
      respSystemId: existing?.respSystemId,
      targetType: existing?.targetType,
      parameterName: existing?.parameterName,
      serviceId: existing?.serviceId,
      javaCallSites: existing?.javaCallSites ?? []
    });
    appliedCount += 1;
  }

  const entries = Array.from(map.values()).sort((a, b) =>
    a.interfaceId === b.interfaceId
      ? a.sourcePath.localeCompare(b.sourcePath)
      : a.interfaceId.localeCompare(b.interfaceId)
  );

  return { entries, appliedCount };
}

function buildEaiMaintenanceGuideMarkdown(input: {
  project: ServerProject;
  generatedAt: string;
  asOfDate: string;
  manualOverridesFile?: string;
}): string {
  const lines: string[] = [];
  lines.push("# EAI Dictionary Maintenance Guide");
  lines.push("");
  lines.push(`- projectId: ${input.project.id}`);
  lines.push(`- generatedAt: ${input.generatedAt}`);
  lines.push(`- asOfDate: ${input.asOfDate}`);
  lines.push(`- manualOverridesFile: ${input.manualOverridesFile ?? "(not configured)"}`);
  lines.push("");
  lines.push("## Change Policy");
  lines.push("- EAI 목록은 가변 정보이므로 기준일자(asOfDate)를 항상 확인한다.");
  lines.push("- 신규/수정/삭제는 manual overrides 파일을 통해 우선 반영한다.");
  lines.push("- 코드 기준 자동 스캔 결과와 override 결과를 함께 검토한다.");
  lines.push("");
  lines.push("## Override File Example (JSON)");
  lines.push("```json");
  lines.push("{");
  lines.push('  \"asOfDate\": \"2026-03-06\",');
  lines.push('  \"entries\": [');
  lines.push("    {");
  lines.push('      \"op\": \"upsert\",');
  lines.push('      \"interfaceId\": \"F10480011\",');
  lines.push('      \"interfaceName\": \"퇴직보험금 청구대상자 조회\",');
  lines.push('      \"purpose\": \"퇴직보험금 청구 대상자 조회\",');
  lines.push('      \"sourcePath\": \"resources/eai/env/dev/io/sli/ea2/F10480011_service.xml\",');
  lines.push('      \"usagePaths\": [\"dcp-insurance/src/main/java/.../Service.java\"]');
  lines.push("    },");
  lines.push("    {");
  lines.push('      \"op\": \"delete\",');
  lines.push('      \"interfaceId\": \"F00000000\"');
  lines.push("    }");
  lines.push("  ]");
  lines.push("}");
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function buildEaiDictionary(options: {
  workspaceDir: string;
  files: string[];
  servicePathIncludes?: string[];
  maxEntries?: number;
  onProgress?: (progress: {
    phase: "searchable-content" | "entry-build";
    processed: number;
    total: number;
    currentFile?: string;
  }) => Promise<void> | void;
}): Promise<EaiDictionaryEntry[]> {
  return buildEaiDictionaryEntries(options);
}

function buildEaiDictionaryMarkdown(input: {
  project: ServerProject;
  generatedAt: string;
  asOfDate: string;
  entries: EaiDictionaryEntry[];
}): string {
  const lines: string[] = [];
  lines.push("# EAI Interface Dictionary");
  lines.push("");
  lines.push(`- projectId: ${input.project.id}`);
  lines.push(`- projectName: ${input.project.name}`);
  lines.push(`- generatedAt: ${input.generatedAt}`);
  lines.push(`- asOfDate: ${input.asOfDate}`);
  lines.push(`- interfaceCount: ${input.entries.length}`);
  lines.push("");

  lines.push("## Entries");
  for (const entry of input.entries) {
    lines.push(`### ${entry.interfaceId} - ${entry.interfaceName}`);
    lines.push(`- purpose: ${entry.purpose}`);
    lines.push(`- source: ${entry.sourcePath}`);
    if (entry.envPaths.length > 0) {
      lines.push(`- envPaths: ${entry.envPaths.slice(0, 6).join(", ")}`);
    }
    if (entry.reqSystemIds.length > 0) {
      lines.push(`- reqSystemIds: ${entry.reqSystemIds.join(", ")}`);
    }
    if (entry.respSystemId) {
      lines.push(`- respSystemId: ${entry.respSystemId}`);
    }
    if (entry.targetType) {
      lines.push(`- targetType: ${entry.targetType}`);
    }
    if (entry.parameterName) {
      lines.push(`- parameterName: ${entry.parameterName}`);
    }
    if (entry.moduleUsagePaths.length > 0) {
      lines.push("- moduleUsages:");
      for (const usage of entry.moduleUsagePaths.slice(0, 6)) {
        lines.push(`  - ${usage}`);
      }
    }
    if (entry.javaCallSites.length > 0) {
      lines.push("- javaCallSites:");
      for (const site of entry.javaCallSites.slice(0, 6)) {
        lines.push(
          `  - ${site.path}${site.className || site.methodName ? ` :: ${site.className ?? "?"}.${site.methodName ?? "?"}` : ""}${site.direct ? " [direct]" : " [indirect]"}`
        );
      }
    }
    if (entry.usagePaths.length > 0) {
      lines.push("- usages:");
      for (const usage of entry.usagePaths.slice(0, 8)) {
        lines.push(`  - ${usage}`);
      }
    } else {
      lines.push("- usages: (no direct usage match found)");
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function writeMemoryDocs(options: {
  memoryRoot: string;
  groupDir: string;
  latestFileName: string;
  content: string;
}): Promise<{ latestPath: string; snapshotPath: string; relativePaths: string[] }> {
  const groupRoot = path.resolve(options.memoryRoot, options.groupDir);
  await fs.mkdir(groupRoot, { recursive: true });

  const now = new Date();
  const snapshotName = `${formatTs(now)}.md`;
  const latestPath = path.resolve(groupRoot, options.latestFileName);
  const snapshotPath = path.resolve(groupRoot, snapshotName);

  await fs.writeFile(snapshotPath, options.content, "utf8");
  await fs.writeFile(latestPath, options.content, "utf8");

  return {
    latestPath,
    snapshotPath,
    relativePaths: [
      toForwardSlash(path.relative(options.memoryRoot, latestPath)),
      toForwardSlash(path.relative(options.memoryRoot, snapshotPath))
    ]
  };
}

async function writeMemoryJson(options: {
  memoryRoot: string;
  groupDir: string;
  fileName: string;
  payload: unknown;
}): Promise<string> {
  const groupRoot = path.resolve(options.memoryRoot, options.groupDir);
  await fs.mkdir(groupRoot, { recursive: true });
  const targetPath = path.resolve(groupRoot, options.fileName);
  await fs.writeFile(targetPath, `${JSON.stringify(options.payload, null, 2)}\n`, "utf8");
  return targetPath;
}

function analysisSnapshotPath(memoryRoot: string): string {
  return path.resolve(memoryRoot, ANALYSIS_MEMORY_DIR, "latest.json");
}

async function readAnalysisSnapshot(memoryRoot: string): Promise<ProjectAnalysisResult | undefined> {
  const snapshotPath = analysisSnapshotPath(memoryRoot);
  try {
    const raw = await fs.readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(raw) as ProjectAnalysisResult;
    const analyzedAt = new Date(parsed.analyzedAt).getTime();
    if (!Number.isFinite(analyzedAt)) {
      return undefined;
    }
    const ageMs = Date.now() - analyzedAt;
    if (ageMs > Math.max(30_000, ANALYSIS_CACHE_MAX_AGE_MS)) {
      return undefined;
    }
    return {
      ...parsed,
      diagnostics: {
        ...parsed.diagnostics,
        llmCallCount: Number(parsed.diagnostics?.llmCallCount || 0),
        structureIndexCount: Number(parsed.diagnostics?.structureIndexCount || 0),
        frontCatalogCount: Number(parsed.diagnostics?.frontCatalogCount || 0),
        frontBackLinkCount: Number(parsed.diagnostics?.frontBackLinkCount || 0)
      }
    };
  } catch {
    return undefined;
  }
}

function eaiSnapshotPath(memoryRoot: string): string {
  return path.resolve(memoryRoot, EAI_MEMORY_DIR, "latest.json");
}

async function readEaiDictionarySnapshot(memoryRoot: string): Promise<{
  generatedAt?: string;
  asOfDate?: string;
  interfaceCount: number;
  manualOverridesApplied?: number;
  entries: EaiDictionaryEntry[];
} | undefined> {
  try {
    const raw = await fs.readFile(eaiSnapshotPath(memoryRoot), "utf8");
    const parsed = JSON.parse(raw) as {
      generatedAt?: string;
      asOfDate?: string;
      interfaceCount?: number;
      manualOverridesApplied?: number;
      entries?: EaiDictionaryEntry[];
    };
    return {
      generatedAt: parsed.generatedAt,
      asOfDate: parsed.asOfDate,
      interfaceCount: Number(parsed.interfaceCount ?? parsed.entries?.length ?? 0),
      manualOverridesApplied: parsed.manualOverridesApplied,
      entries: Array.isArray(parsed.entries) ? parsed.entries : []
    };
  } catch {
    return undefined;
  }
}

function frontBackGraphSnapshotPath(memoryRoot: string): string {
  return path.resolve(memoryRoot, FRONT_BACK_GRAPH_MEMORY_DIR, "latest.json");
}

async function readFrontBackGraphSnapshot(memoryRoot: string): Promise<FrontBackGraphSnapshot | undefined> {
  try {
    const raw = await fs.readFile(frontBackGraphSnapshotPath(memoryRoot), "utf8");
    return JSON.parse(raw) as FrontBackGraphSnapshot;
  } catch {
    return undefined;
  }
}

function buildFrontCatalogMarkdown(options: {
  project: ServerProject;
  generatedAt: string;
  graph: FrontBackGraphSnapshot;
}): string {
  const lines = [
    "# Front Catalog",
    "",
    `- project: ${options.project.name}`,
    `- generatedAt: ${options.generatedAt}`,
    `- frontendWorkspaces: ${options.graph.meta.frontendWorkspaceDirs.length}`,
    `- routeCount: ${options.graph.frontend.routeCount}`,
    `- screenCount: ${options.graph.frontend.screenCount}`,
    `- apiCount: ${options.graph.frontend.apiCount}`,
    "",
    "## Top Screens",
    ""
  ];
  for (const screen of options.graph.frontend.screens.slice(0, 20)) {
    lines.push(`- ${screen.screenCode ?? path.basename(screen.filePath)} | ${screen.filePath}`);
    if (screen.routePaths.length > 0) {
      lines.push(`  - routes: ${screen.routePaths.join(", ")}`);
    }
    if (screen.apiPaths.length > 0) {
      lines.push(`  - apis: ${screen.apiPaths.join(", ")}`);
    }
    if ((screen.labels ?? []).length > 0) {
      lines.push(`  - labels: ${(screen.labels ?? []).join(", ")}`);
    }
    if ((screen.capabilityTags ?? []).length > 0) {
      lines.push(`  - capabilities: ${(screen.capabilityTags ?? []).join(", ")}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildFrontBackGraphMarkdown(options: {
  project: ServerProject;
  generatedAt: string;
  graph: FrontBackGraphSnapshot;
}): string {
  const lines = [
    "# Front to Backend Flow Graph",
    "",
    `- project: ${options.project.name}`,
    `- generatedAt: ${options.generatedAt}`,
    `- backendWorkspace: ${options.graph.meta.backendWorkspaceDir}`,
    `- frontendWorkspaces: ${options.graph.meta.frontendWorkspaceDirs.join(", ") || "(none)"}`,
    `- linkCount: ${options.graph.links.length}`,
    "",
    "## Top Links",
    ""
  ];
  for (const link of options.graph.links.slice(0, 20)) {
    lines.push(
      `- ${link.frontend.screenCode ?? path.basename(link.frontend.screenPath)} | ${link.api.rawUrl} -> ${link.backend.controllerMethod} (${link.backend.path}) | confidence=${link.confidence.toFixed(2)}`
    );
    if (link.backend.serviceHints.length > 0) {
      lines.push(`  - services: ${link.backend.serviceHints.join(", ")}`);
    }
    if ((link.capabilityTags ?? []).length > 0) {
      lines.push(`  - capabilities: ${(link.capabilityTags ?? []).join(", ")}`);
    }
  }
  if (options.graph.diagnostics.unmatchedFrontendApis.length > 0) {
    lines.push("", "## Unmatched Frontend APIs");
    for (const item of options.graph.diagnostics.unmatchedFrontendApis.slice(0, 30)) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function structureSnapshotPath(workspaceDir: string): string {
  return resolveServerProjectStructureSnapshotPath(workspaceDir);
}

async function loadStructureSnapshot(workspaceDir: string): Promise<StructureIndexSnapshot | undefined> {
  try {
    const raw = await fs.readFile(structureSnapshotPath(workspaceDir), "utf8");
    const parsed = JSON.parse(raw) as StructureIndexSnapshot;
    if (parsed?.version !== 1 || typeof parsed.entries !== "object") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function hashContent(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

function toLineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function parseStructureFromJavaLikeFile(content: string): Omit<StructureFileEntry, "path" | "size" | "mtimeMs" | "hash"> {
  const lines = content.split(/\r?\n/);
  const classes: StructureSymbolRef[] = [];
  const methods: StructureSymbolRef[] = [];
  const calls = new Set<string>();
  let packageName: string | undefined;
  let primaryClass: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.length > 2000) {
      continue;
    }

    if (!packageName) {
      const packageMatch = line.match(/^\s*package\s+([A-Za-z0-9_.]+)\s*;/);
      if (packageMatch?.[1]) {
        packageName = packageMatch[1].trim();
      }
    }

    const classMatch = line.match(/\b(class|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (classMatch?.[2]) {
      const name = classMatch[2].trim();
      classes.push({
        name,
        line: index + 1
      });
      primaryClass ??= name;
    }

    const methodMatch = line.match(
      /^\s*(?:public|protected|private|static|final|native|synchronized|abstract|default|\s)+(?:<[^>]+>\s*)?(?:[A-Za-z_][A-Za-z0-9_<>\[\],.?& ]*\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}()]*\)\s*(?:throws [^{]+)?\{/
    );
    if (methodMatch?.[1] && !CALL_KEYWORDS.has(methodMatch[1])) {
      methods.push({
        name: methodMatch[1].trim(),
        line: index + 1,
        className: primaryClass
      });
    }

    for (const match of line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const target = match[2]?.trim();
      const owner = match[1]?.trim();
      if (!target || CALL_KEYWORDS.has(target)) {
        continue;
      }
      calls.add(target);
      if (owner) {
        calls.add(`${owner}.${target}`);
      }
    }

    for (const match of line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const target = match[1]?.trim();
      if (!target || CALL_KEYWORDS.has(target)) {
        continue;
      }
      calls.add(target);
    }
  }

  return {
    packageName,
    classes: classes.slice(0, 80),
    methods: methods.slice(0, 240),
    functions: [],
    calls: Array.from(calls).slice(0, 300),
    summary: summarizeContentLine(content)
  };
}

function parseStructureFromJavascriptLikeFile(content: string): Omit<StructureFileEntry, "path" | "size" | "mtimeMs" | "hash"> {
  const lines = content.split(/\r?\n/);
  const classes: StructureSymbolRef[] = [];
  const methods: StructureSymbolRef[] = [];
  const functions: StructureSymbolRef[] = [];
  const calls = new Set<string>();
  let primaryClass: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.length > 2000) {
      continue;
    }

    const classMatch = line.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (classMatch?.[1]) {
      const name = classMatch[1].trim();
      classes.push({
        name,
        line: index + 1
      });
      primaryClass ??= name;
    }

    const functionMatch = line.match(
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/
    );
    if (functionMatch?.[1] && !CALL_KEYWORDS.has(functionMatch[1])) {
      functions.push({
        name: functionMatch[1].trim(),
        line: index + 1
      });
    }

    const prototypeMethodMatch = line.match(
      /^\s*[A-Za-z_$][A-Za-z0-9_$.]*\.prototype\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*function\b/
    );
    if (prototypeMethodMatch?.[1] && !CALL_KEYWORDS.has(prototypeMethodMatch[1])) {
      methods.push({
        name: prototypeMethodMatch[1].trim(),
        line: index + 1,
        className: primaryClass
      });
    }

    const assignedFunctionMatch = line.match(
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s+)?function\b/
    );
    if (assignedFunctionMatch?.[1] && !CALL_KEYWORDS.has(assignedFunctionMatch[1])) {
      functions.push({
        name: assignedFunctionMatch[1].trim(),
        line: index + 1
      });
    }

    const arrowFunctionMatch = line.match(
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>/
    );
    if (arrowFunctionMatch?.[1] && !CALL_KEYWORDS.has(arrowFunctionMatch[1])) {
      functions.push({
        name: arrowFunctionMatch[1].trim(),
        line: index + 1
      });
    }

    for (const match of line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const target = match[2]?.trim();
      const owner = match[1]?.trim();
      if (!target || CALL_KEYWORDS.has(target)) {
        continue;
      }
      calls.add(target);
      if (owner) {
        calls.add(`${owner}.${target}`);
      }
    }

    for (const match of line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const target = match[1]?.trim();
      if (!target || CALL_KEYWORDS.has(target)) {
        continue;
      }
      calls.add(target);
    }
  }

  return {
    packageName: undefined,
    classes: classes.slice(0, 80),
    methods: methods.slice(0, 240),
    functions: functions.slice(0, 120),
    calls: Array.from(calls).slice(0, 300),
    summary: summarizeContentLine(content)
  };
}

function parseStructureFromGenericCodeFile(content: string): Omit<StructureFileEntry, "path" | "size" | "mtimeMs" | "hash"> {
  const lines = content.split(/\r?\n/);
  const functions: StructureSymbolRef[] = [];
  const calls = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.length > 2000) {
      continue;
    }

    const functionMatch = line.match(/^\s*(?:def|fn)\s+([A-Za-z_][A-Za-z0-9_]*)\s*[\(<]/);
    if (functionMatch?.[1] && !CALL_KEYWORDS.has(functionMatch[1])) {
      functions.push({
        name: functionMatch[1].trim(),
        line: index + 1
      });
    }

    for (const match of line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const target = match[1]?.trim();
      if (!target || CALL_KEYWORDS.has(target)) {
        continue;
      }
      calls.add(target);
    }
  }

  return {
    packageName: undefined,
    classes: [],
    methods: [],
    functions: functions.slice(0, 120),
    calls: Array.from(calls).slice(0, 300),
    summary: summarizeContentLine(content)
  };
}

function parseStructureFromFile(relativePath: string, content: string): Omit<StructureFileEntry, "path" | "size" | "mtimeMs" | "hash"> {
  if (!isStructureParseTarget(relativePath)) {
    return {
      packageName: undefined,
      classes: [],
      methods: [],
      functions: [],
      calls: [],
      summary: summarizeContentLine(content)
    };
  }

  const ext = path.extname(relativePath).toLowerCase();
  if (JAVA_LIKE_EXTENSIONS.has(ext)) {
    return parseStructureFromJavaLikeFile(content);
  }
  if (JAVASCRIPT_LIKE_EXTENSIONS.has(ext)) {
    return parseStructureFromJavascriptLikeFile(content);
  }
  if (PYTHON_LIKE_EXTENSIONS.has(ext) || GO_LIKE_EXTENSIONS.has(ext) || RUST_LIKE_EXTENSIONS.has(ext)) {
    return parseStructureFromGenericCodeFile(content);
  }

  return {
    packageName: undefined,
    classes: [],
    methods: [],
    functions: [],
    calls: [],
    summary: summarizeContentLine(content)
  };
}

async function buildProjectStructureIndex(options: {
  workspaceDir: string;
  files: string[];
  memoryRoot?: string;
  onProgress?: (progress: {
    processed: number;
    total: number;
    changedFiles: number;
    reusedFiles: number;
    currentFile?: string;
  }) => Promise<void> | void;
  onSlowFile?: (event: {
    path: string;
    durationMs: number;
    sizeBytes: number;
    parseTarget: boolean;
  }) => Promise<void> | void;
}): Promise<{ snapshot: StructureIndexSnapshot; memoryFiles: string[] }> {
  const previous = await loadStructureSnapshot(options.workspaceDir);
  const previousEntries = previous?.entries ?? {};

  const nextEntries: Record<string, StructureFileEntry> = {};
  let changedFiles = 0;
  let reusedFiles = 0;
  let processed = 0;

  for (const relativePath of options.files) {
    const fileStartedAt = Date.now();
    if (isRetrievalNoisePath(relativePath)) {
      continue;
    }

    const absolutePath = path.resolve(options.workspaceDir, relativePath);
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      continue;
    }

    if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) {
      processed += 1;
      if (options.onProgress && processed % STRUCTURE_INDEX_PROGRESS_INTERVAL === 0) {
        await options.onProgress({
          processed,
          total: options.files.length,
          changedFiles,
          reusedFiles,
          currentFile: relativePath
        });
      }
      if (processed % STRUCTURE_INDEX_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
      continue;
    }

    if (
      options.onSlowFile &&
      isStructureParseTarget(relativePath) &&
      stat.size >= STRUCTURE_LARGE_FILE_BYTES
    ) {
      await options.onSlowFile({
        path: relativePath,
        durationMs: -1,
        sizeBytes: stat.size,
        parseTarget: true
      });
    }

    const cached = previousEntries[relativePath];
    if (
      cached &&
      cached.size === stat.size &&
      Math.floor(cached.mtimeMs) === Math.floor(stat.mtimeMs)
    ) {
      nextEntries[relativePath] = cached;
      reusedFiles += 1;
      processed += 1;
      if (options.onProgress && processed % STRUCTURE_INDEX_PROGRESS_INTERVAL === 0) {
        await options.onProgress({
          processed,
          total: options.files.length,
          changedFiles,
          reusedFiles,
          currentFile: relativePath
        });
      }
      const cachedDurationMs = Date.now() - fileStartedAt;
      if (processed % STRUCTURE_INDEX_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
      if (options.onSlowFile && cachedDurationMs >= STRUCTURE_INDEX_SLOW_FILE_MS) {
        await options.onSlowFile({
          path: relativePath,
          durationMs: cachedDurationMs,
          sizeBytes: stat.size,
          parseTarget: isStructureParseTarget(relativePath)
        });
      }
      continue;
    }

    const content = await readTextFileSafe(absolutePath);
    if (content == null) {
      processed += 1;
      if (options.onProgress && processed % STRUCTURE_INDEX_PROGRESS_INTERVAL === 0) {
        await options.onProgress({
          processed,
          total: options.files.length,
          changedFiles,
          reusedFiles,
          currentFile: relativePath
        });
      }
      if (processed % STRUCTURE_INDEX_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
      continue;
    }

    const hash = hashContent(content);
    if (
      cached &&
      cached.hash === hash &&
      cached.size === stat.size &&
      Math.floor(cached.mtimeMs) === Math.floor(stat.mtimeMs)
    ) {
      nextEntries[relativePath] = cached;
      reusedFiles += 1;
      processed += 1;
      if (options.onProgress && processed % STRUCTURE_INDEX_PROGRESS_INTERVAL === 0) {
        await options.onProgress({
          processed,
          total: options.files.length,
          changedFiles,
          reusedFiles,
          currentFile: relativePath
        });
      }
      const reusedDurationMs = Date.now() - fileStartedAt;
      if (processed % STRUCTURE_INDEX_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
      if (options.onSlowFile && reusedDurationMs >= STRUCTURE_INDEX_SLOW_FILE_MS) {
        await options.onSlowFile({
          path: relativePath,
          durationMs: reusedDurationMs,
          sizeBytes: stat.size,
          parseTarget: isStructureParseTarget(relativePath)
        });
      }
      continue;
    }

    const parsed = parseStructureFromFile(relativePath, content);
    nextEntries[relativePath] = {
      path: relativePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash,
      ...parsed
    };
    changedFiles += 1;
    processed += 1;
    if (options.onProgress && processed % STRUCTURE_INDEX_PROGRESS_INTERVAL === 0) {
      await options.onProgress({
        processed,
        total: options.files.length,
        changedFiles,
        reusedFiles,
        currentFile: relativePath
      });
    }
    const parsedDurationMs = Date.now() - fileStartedAt;
    if (processed % STRUCTURE_INDEX_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
    }
    if (options.onSlowFile && parsedDurationMs >= STRUCTURE_INDEX_SLOW_FILE_MS) {
      await options.onSlowFile({
        path: relativePath,
        durationMs: parsedDurationMs,
        sizeBytes: stat.size,
        parseTarget: isStructureParseTarget(relativePath)
      });
    }
  }

  if (options.onProgress) {
    await options.onProgress({
      processed,
      total: options.files.length,
      changedFiles,
      reusedFiles
    });
  }

  await options.onProgress?.({
    processed,
    total: options.files.length,
    changedFiles,
    reusedFiles,
    currentFile: "aggregation-start"
  });

  const packageMap = new Map<string, StructureIndexPackageSummary>();
  const methodCounter = new Map<string, number>();
  let classCount = 0;
  let methodCount = 0;

  let aggregateIndex = 0;
  for (const entry of Object.values(nextEntries)) {
    const packageName = entry.packageName || "(default)";
    const current = packageMap.get(packageName) ?? {
      name: packageName,
      fileCount: 0,
      classCount: 0,
      methodCount: 0
    };
    current.fileCount += 1;
    current.classCount += entry.classes.length;
    current.methodCount += entry.methods.length + entry.functions.length;
    classCount += entry.classes.length;
    methodCount += entry.methods.length + entry.functions.length;
    packageMap.set(packageName, current);

    for (const method of [...entry.methods, ...entry.functions]) {
      const key = method.className ? `${method.className}.${method.name}` : method.name;
      methodCounter.set(key, (methodCounter.get(key) ?? 0) + 1);
    }

    aggregateIndex += 1;
    if (aggregateIndex % STRUCTURE_INDEX_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
    }
  }

  const topPackages = Array.from(packageMap.values())
    .sort((a, b) =>
      b.methodCount !== a.methodCount ? b.methodCount - a.methodCount : a.name.localeCompare(b.name)
    )
    .slice(0, 30);
  const topMethods = Array.from(methodCounter.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name)))
    .slice(0, 60);

  const snapshot: StructureIndexSnapshot = {
    version: 1,
    generatedAt: nowIso(),
    workspaceDir: options.workspaceDir,
    stats: {
      fileCount: Object.keys(nextEntries).length,
      packageCount: packageMap.size,
      classCount,
      methodCount,
      changedFiles,
      reusedFiles
    },
    topPackages,
    topMethods,
    entries: nextEntries
  };

  await options.onProgress?.({
    processed,
    total: options.files.length,
    changedFiles,
    reusedFiles,
    currentFile: "cache-write-start"
  });

  const cachePath = structureSnapshotPath(options.workspaceDir);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const memoryFiles: string[] = [];
  if (options.memoryRoot) {
    await options.onProgress?.({
      processed,
      total: options.files.length,
      changedFiles,
      reusedFiles,
      currentFile: "memory-doc-write-start"
    });
    const lines: string[] = [];
    lines.push("# Project Structure Index");
    lines.push("");
    lines.push(`- generatedAt: ${snapshot.generatedAt}`);
    lines.push(`- fileCount: ${snapshot.stats.fileCount}`);
    lines.push(`- packageCount: ${snapshot.stats.packageCount}`);
    lines.push(`- classCount: ${snapshot.stats.classCount}`);
    lines.push(`- methodCount: ${snapshot.stats.methodCount}`);
    lines.push(`- changedFiles: ${snapshot.stats.changedFiles}`);
    lines.push(`- reusedFiles: ${snapshot.stats.reusedFiles}`);
    lines.push("");
    lines.push("## Top Packages");
    for (const pack of snapshot.topPackages.slice(0, 20)) {
      lines.push(`- ${pack.name} | files=${pack.fileCount} | methods=${pack.methodCount}`);
    }
    lines.push("");
    lines.push("## Top Methods");
    for (const method of snapshot.topMethods.slice(0, 25)) {
      lines.push(`- ${method.name} | count=${method.count}`);
    }
    lines.push("");

    const structureDocs = await writeMemoryDocs({
      memoryRoot: options.memoryRoot,
      groupDir: STRUCTURE_MEMORY_DIR,
      latestFileName: "latest.md",
      content: `${lines.join("\n")}\n`
    });
    const structureJson = await writeMemoryJson({
      memoryRoot: options.memoryRoot,
      groupDir: STRUCTURE_MEMORY_DIR,
      fileName: "latest.json",
      payload: snapshot
    });
    memoryFiles.push(structureDocs.latestPath, structureDocs.snapshotPath, structureJson);
  }

  return { snapshot, memoryFiles };
}

function extractMethodCandidates(question: string): string[] {
  const tokens = question.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  return unique(
    tokens.filter((token) => /^[a-z]/.test(token) && /[A-Z]/.test(token))
  ).slice(0, 8);
}

function extractClassCandidates(question: string): string[] {
  const tokens = question.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  return unique(
    tokens.filter(
      (token) =>
        /^[A-Z]/.test(token) &&
        /(Service|Controller|Dao|Mapper|Repository|Util|Handler|Manager)$/.test(token)
    )
  ).slice(0, 8);
}

function extractOrderedMethodCalls(snippet: string): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  const pattern = /\b(?:this\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const match of snippet.matchAll(pattern)) {
    const name = match[1]?.trim();
    if (!name || CALL_KEYWORDS.has(name)) {
      continue;
    }
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    output.push(name);
  }
  return output;
}

function extractOwnedCallCandidates(snippet: string): Array<{ owner: string; method: string }> {
  const output: Array<{ owner: string; method: string }> = [];
  const seen = new Set<string>();
  for (const match of snippet.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const owner = match[1]?.trim();
    const method = match[2]?.trim();
    if (!owner || !method || CALL_KEYWORDS.has(method)) {
      continue;
    }
    const key = `${owner}.${method}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push({ owner, method });
  }
  return output;
}

function toProbableClassName(ownerName: string): string {
  return ownerName ? `${ownerName[0].toUpperCase()}${ownerName.slice(1)}` : ownerName;
}

function scoreOwnedCallCandidate(options: { owner: string; method: string; focusTokens: string[] }): number {
  const owner = options.owner.toLowerCase();
  const method = options.method.toLowerCase();
  let score = 0;

  if (/service|dao|mapper|client|support/.test(owner)) {
    score += 20;
  }
  if (/save|submit|claim|benefit|check|apply|insert|delete|cancel|select|callf/.test(method)) {
    score += 40;
  }
  if (/sendlms|debug|log|trace|print/.test(method)) {
    score -= 20;
  }
  for (const token of options.focusTokens) {
    if (owner.includes(token)) {
      score += 8;
    }
    if (method.includes(token)) {
      score += 12;
    }
  }

  return score;
}

function findStructureEntryByClassName(options: {
  structure?: StructureIndexSnapshot;
  className: string;
  moduleCandidates: string[];
}): StructureFileEntry | undefined {
  if (!options.structure) {
    return undefined;
  }
  const normalizedClass = options.className.toLowerCase();
  const candidates = Object.values(options.structure.entries).filter((entry) =>
    entry.classes.some((klass) => klass.name.toLowerCase() === normalizedClass)
  );
  if (candidates.length === 0) {
    return undefined;
  }
  const moduleMatched = candidates.find((entry) => pathMatchesAnyModule(entry.path, options.moduleCandidates));
  return moduleMatched ?? candidates[0];
}

function summarizeMethodSignature(snippet: string): string {
  const firstLine =
    snippet
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.includes("(") && line.includes(")")) ?? "";
  return firstLine.slice(0, 220);
}

function extractModuleCandidates(question: string): string[] {
  return unique(question.match(/\bdcp-[a-z0-9-]+\b/gi) ?? []).map((item) => item.toLowerCase());
}

function buildAskFocusTokens(question: string): string[] {
  const tokens = new Set<string>(toSearchTokens(question).map((item) => item.toLowerCase()));
  const rawWords = question.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  for (const word of rawWords) {
    tokens.add(word.toLowerCase());
  }

  if (/(보험금|benefit)/i.test(question)) {
    ["benefit", "give", "insurance"].forEach((item) => tokens.add(item));
  }
  if (/(청구|claim)/i.test(question)) {
    ["claim", "submit", "save", "recept", "receipt", "doc", "document", "upload", "file"].forEach((item) =>
      tokens.add(item)
    );
  }
  if (/(사고|accident|acc)/i.test(question)) {
    ["acc", "accident"].forEach((item) => tokens.add(item));
  }
  if (/(서류|문서|doc|document|파일|upload)/i.test(question)) {
    ["doc", "document", "file", "upload", "image", "pdf"].forEach((item) => tokens.add(item));
  }

  return Array.from(tokens).filter((item) => item.length >= 2).slice(0, 24);
}

function pathMatchesAnyModule(filePath: string, moduleCandidates: string[]): boolean {
  const normalized = toForwardSlash(filePath).toLowerCase();
  return moduleCandidates.some((moduleName) => normalized.startsWith(`${moduleName}/`));
}

function scoreAskHitRelevance(options: {
  hit: ProjectSearchHit;
  question: string;
  strategy: AskStrategyType;
  moduleCandidates: string[];
  focusTokens: string[];
}): number {
  const normalizedPath = toForwardSlash(options.hit.path).toLowerCase();
  const ext = path.extname(normalizedPath);
  let score = options.hit.score;

  if (pathMatchesAnyModule(normalizedPath, options.moduleCandidates)) {
    score += 200;
  }
  if (CODE_FILE_EXTENSIONS.has(ext)) {
    score += 50;
  }
  if (/controller/i.test(normalizedPath)) {
    score += 35;
  }
  if (/service/i.test(normalizedPath)) {
    score += 30;
  }
  if (options.strategy === "module_flow_topdown" && !pathMatchesAnyModule(normalizedPath, options.moduleCandidates)) {
    score -= 80;
  }
  if (
    /(로직|흐름|어떻게|구현|처리|service|controller|domain)/i.test(options.question) &&
    /\.(xml|yml|yaml|txt|ini)$/i.test(normalizedPath)
  ) {
    score -= 25;
  }

  for (const token of options.focusTokens) {
    if (normalizedPath.includes(token)) {
      score += 12;
    }
  }

  return score;
}

function makeLineWindowSnippet(content: string, lineNumber: number, radius = 4): { snippet: string; lineStart: number; lineEnd: number } {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, lineNumber - 1 - radius);
  const end = Math.min(lines.length, lineNumber + radius);
  return {
    snippet: lines.slice(start, end).join("\n").slice(0, 2200),
    lineStart: start + 1,
    lineEnd: end
  };
}

function scoreStructureSymbolForAsk(options: {
  entry: StructureFileEntry;
  symbol: StructureSymbolRef;
  strategy: AskStrategyType;
  focusTokens: string[];
  targetSymbols: string[];
}): number {
  const symbolName = options.symbol.name.toLowerCase();
  const className = options.symbol.className?.toLowerCase() ?? "";
  const entryPath = options.entry.path.toLowerCase();
  let score = 0;

  if (options.targetSymbols.some((item) => symbolName === item.toLowerCase())) {
    score += 120;
  }
  if (options.strategy === "module_flow_topdown" && /controller|service/.test(entryPath)) {
    score += 24;
  }
  if (/claim|benefit|acc|loan|credit|contract|limit|member|auth|session|pension|fund|submit|save|cancel|upload|doc|file|apply|receipt|account|check|select/.test(symbolName)) {
    score += 20;
  }
  if (/claim|benefit|acc|loan|credit|contract|member|auth|pension|fund/.test(className)) {
    score += 10;
  }

  for (const token of options.focusTokens) {
    if (symbolName.includes(token)) {
      score += 18;
    }
    if (className.includes(token)) {
      score += 12;
    }
    if (entryPath.includes(token)) {
      score += 4;
    }
  }

  return score;
}

async function hydrateAskEvidence(options: {
  project: ServerProject;
  question: string;
  strategy: AskStrategyType;
  targetSymbols: string[];
  moduleCandidates: string[];
  hits: ProjectSearchHit[];
  structure?: StructureIndexSnapshot;
}): Promise<AskHydratedEvidenceItem[]> {
  const focusTokens = buildAskFocusTokens(options.question);
  const rankedHits = [...options.hits]
    .sort(
      (a, b) =>
        scoreAskHitRelevance({
          hit: b,
          question: options.question,
          strategy: options.strategy,
          moduleCandidates: options.moduleCandidates,
          focusTokens
        }) -
        scoreAskHitRelevance({
          hit: a,
          question: options.question,
          strategy: options.strategy,
          moduleCandidates: options.moduleCandidates,
          focusTokens
        })
    )
    .slice(0, 12);

  const hydrated: AskHydratedEvidenceItem[] = [];
  const seenKeys = new Set<string>();
  const contentCache = new Map<string, string>();

  async function loadContent(relativePath: string): Promise<string | undefined> {
    if (contentCache.has(relativePath)) {
      return contentCache.get(relativePath);
    }
    const absolutePath = path.resolve(options.project.workspaceDir, relativePath);
    const content = await readTextFileSafe(absolutePath);
    if (content != null) {
      contentCache.set(relativePath, content);
    }
    return content ?? undefined;
  }

  for (const hit of rankedHits) {
    const content = await loadContent(hit.path);
    if (!content) {
      continue;
    }

    const codeFile = CODE_FILE_EXTENSIONS.has(path.extname(hit.path).toLowerCase());
    const moduleMatched = pathMatchesAnyModule(hit.path, options.moduleCandidates);
    const structureEntry = options.structure?.entries[hit.path];

    if (codeFile && structureEntry) {
      const symbolCandidates = [...structureEntry.methods, ...structureEntry.functions]
        .map((symbol) => ({
          symbol,
          score: scoreStructureSymbolForAsk({
            entry: structureEntry,
            symbol,
            strategy: options.strategy,
            focusTokens,
            targetSymbols: options.targetSymbols
          })
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.symbol.line - b.symbol.line))
        .slice(0, options.strategy === "module_flow_topdown" ? 3 : 2);

      for (const candidate of symbolCandidates) {
        const block = findMethodBlock(content, candidate.symbol.name);
        if (!block) {
          continue;
        }
        const key = `${hit.path}:${candidate.symbol.name}:${block.startLine}:${block.endLine}`;
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        hydrated.push({
          path: hit.path,
          reason: `method:${candidate.symbol.className ? `${candidate.symbol.className}.` : ""}${candidate.symbol.name}`,
          snippet: block.snippet.slice(0, 3600),
          kind: "method_block",
          codeFile: true,
          moduleMatched,
          lineStart: block.startLine,
          lineEnd: block.endLine
        });
        if (options.strategy === "module_flow_topdown" || options.strategy === "method_trace") {
          const externalCalls = extractOwnedCallCandidates(block.snippet)
            .filter((item) => /(service|dao|mapper|support|helper|client)/i.test(item.owner))
            .sort(
              (a, b) =>
                scoreOwnedCallCandidate({ ...b, focusTokens }) - scoreOwnedCallCandidate({ ...a, focusTokens })
            )
            .slice(0, 4);
          for (const externalCall of externalCalls) {
            const probableClassName = toProbableClassName(externalCall.owner);
            const targetEntry = findStructureEntryByClassName({
              structure: options.structure,
              className: probableClassName,
              moduleCandidates: options.moduleCandidates
            });
            if (!targetEntry) {
              continue;
            }
            const targetContent = await loadContent(targetEntry.path);
            if (!targetContent) {
              continue;
            }
            const targetBlock = findMethodBlock(targetContent, externalCall.method);
            if (!targetBlock) {
              continue;
            }
            const externalKey = `${targetEntry.path}:${externalCall.method}:${targetBlock.startLine}:${targetBlock.endLine}`;
            if (seenKeys.has(externalKey)) {
              continue;
            }
            seenKeys.add(externalKey);
            hydrated.push({
              path: targetEntry.path,
              reason: `callee:${probableClassName}.${externalCall.method}`,
              snippet: targetBlock.snippet.slice(0, 3600),
              kind: "method_block",
              codeFile: true,
              moduleMatched: pathMatchesAnyModule(targetEntry.path, options.moduleCandidates),
              lineStart: targetBlock.startLine,
              lineEnd: targetBlock.endLine
            });
            if (hydrated.length >= 10) {
              return hydrated;
            }
          }
        }
        if (hydrated.length >= 10) {
          return hydrated;
        }
      }
    }

    const lines = content.split(/\r?\n/);
    const matchedLineIndex = lines.findIndex((line) => {
      const lower = line.toLowerCase();
      return focusTokens.some((token) => lower.includes(token));
    });
    if (matchedLineIndex >= 0) {
      const window = makeLineWindowSnippet(content, matchedLineIndex + 1, codeFile ? 6 : 3);
      const key = `${hit.path}:window:${window.lineStart}:${window.lineEnd}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        hydrated.push({
          path: hit.path,
          reason: "matched-focus-token",
          snippet: window.snippet,
          kind: codeFile ? "line_window" : "resource_snippet",
          codeFile,
          moduleMatched,
          lineStart: window.lineStart,
          lineEnd: window.lineEnd
        });
      }
    } else if (!codeFile && hydrated.length < 8) {
      const window = makeLineWindowSnippet(content, 1, 8);
      const key = `${hit.path}:window:${window.lineStart}:${window.lineEnd}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        hydrated.push({
          path: hit.path,
          reason: "resource-top-snippet",
          snippet: window.snippet,
          kind: "resource_snippet",
          codeFile: false,
          moduleMatched,
          lineStart: window.lineStart,
          lineEnd: window.lineEnd
        });
      }
    }

    if (hydrated.length >= 10) {
      break;
    }
  }

  return hydrated.slice(0, 10);
}

export function classifyQuestionIntentFallback(question: string): {
  strategy: AskStrategyType;
  confidence: number;
  reason: string;
  targetSymbols: string[];
} {
  const moduleCandidates = extractModuleCandidates(question);
  const crossLayerFocused = isCrossLayerFlowQuestion(question);
  const methodFocused =
    /함수|메서드|method|호출|콜트리|이후|흐름|save[A-Z]|[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/i.test(
      question
    );
  const moduleFlowFocused =
    moduleCandidates.length > 0 &&
    /(내부|모듈|흐름|로직|탑다운|큰 그림|실행|처리|service|controller|domain)/i.test(question);
  const architectureFocused =
    /아키텍처|구조|전체|system|architecture|module|패키지/i.test(question);
  const eaiFocused = /eai|인터페이스|전문|service id|f1[a-z0-9]+/i.test(question);
  const configFocused = /xml|yml|yaml|config|설정|권한|menu|applicationcontext/i.test(question);

  if (crossLayerFocused) {
    return {
      strategy: "cross_layer_flow",
      confidence: 0.76,
      reason: "fallback: cross-layer frontend/backend flow question detected",
      targetSymbols: [...extractClassCandidates(question), ...extractMethodCandidates(question)].slice(0, 8)
    };
  }
  if (methodFocused) {
    return {
      strategy: "method_trace",
      confidence: 0.62,
      reason: "fallback: method/call-flow keywords detected",
      targetSymbols: extractMethodCandidates(question)
    };
  }
  if (moduleFlowFocused) {
    return {
      strategy: "module_flow_topdown",
      confidence: 0.7,
      reason: "fallback: module-scoped flow/top-down question detected",
      targetSymbols: [...extractClassCandidates(question), ...extractMethodCandidates(question)].slice(0, 8)
    };
  }
  if (eaiFocused) {
    return {
      strategy: "eai_interface",
      confidence: 0.57,
      reason: "fallback: eai/interface keywords detected",
      targetSymbols: []
    };
  }
  if (configFocused) {
    return {
      strategy: "config_resource",
      confidence: 0.54,
      reason: "fallback: config/resource keywords detected",
      targetSymbols: []
    };
  }
  if (architectureFocused) {
    return {
      strategy: "architecture_overview",
      confidence: 0.56,
      reason: "fallback: architecture keywords detected",
      targetSymbols: []
    };
  }
  return {
    strategy: "general",
    confidence: 0.45,
    reason: "fallback: generic question",
    targetSymbols: []
  };
}

export function normalizeAskStrategyForQuestion(
  question: string,
  strategy: AskStrategyType
): AskStrategyType {
  if (isCrossLayerFlowQuestion(question)) {
    return "cross_layer_flow";
  }
  return strategy;
}

function strategyToIntent(strategy: AskStrategyType): {
  methodFocused: boolean;
  architectureFocused: boolean;
  moduleFlowFocused: boolean;
  crossLayerFocused: boolean;
} {
  return {
    methodFocused: strategy === "method_trace",
    architectureFocused: strategy === "architecture_overview",
    moduleFlowFocused: strategy === "module_flow_topdown",
    crossLayerFocused: strategy === "cross_layer_flow"
  };
}

function findMethodBlock(content: string, methodName: string): { startLine: number; endLine: number; snippet: string } | undefined {
  const methodPattern = new RegExp(`\\b${methodName}\\s*\\([^;{}]*\\)\\s*(?:throws [^{]+)?\\{`, "m");
  const match = methodPattern.exec(content);
  if (!match || typeof match.index !== "number") {
    return undefined;
  }

  const startIndex = match.index;
  let bodyStart = content.indexOf("{", startIndex);
  if (bodyStart < 0) {
    return undefined;
  }

  let depth = 0;
  let endIndex = -1;
  for (let index = bodyStart; index < content.length; index += 1) {
    const char = content[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }

  if (endIndex < 0) {
    return undefined;
  }

  const startLine = toLineNumber(content, startIndex);
  const endLine = toLineNumber(content, endIndex);
  const snippet = content.slice(startIndex, Math.min(content.length, endIndex + 1)).trim();
  return {
    startLine,
    endLine,
    snippet: snippet.slice(0, 24_000)
  };
}

async function buildDeterministicMethodAnswer(options: {
  project: ServerProject;
  question: string;
  structure: StructureIndexSnapshot;
}): Promise<
  | {
      answer: string;
      confidence: number;
      evidence: string[];
      caveats: string[];
      symbol: string;
      hit: ProjectSearchHit;
    }
  | undefined
> {
  const methodCandidates = extractMethodCandidates(options.question);
  if (methodCandidates.length === 0) {
    return undefined;
  }
  const classCandidates = extractClassCandidates(options.question).map((value) => value.toLowerCase());

  const lowerMethodCandidates = methodCandidates.map((value) => value.toLowerCase());
  let best:
    | { entry: StructureFileEntry; symbol: StructureSymbolRef; methodName: string; className?: string; score: number }
    | undefined;

  for (const entry of Object.values(options.structure.entries)) {
    for (const method of [...entry.methods, ...entry.functions]) {
      const lowerMethod = method.name.toLowerCase();
      if (!lowerMethodCandidates.includes(lowerMethod)) {
        continue;
      }
      const methodClass = method.className?.toLowerCase() ?? "";
      const entryClassNames = entry.classes.map((item) => item.name.toLowerCase());
      const classMatched =
        classCandidates.length === 0 ||
        classCandidates.some((candidate) => methodClass === candidate || entryClassNames.includes(candidate));
      const score = (classMatched ? 3 : 0) + (entry.path.toLowerCase().includes("dcp-insurance") ? 2 : 0);
      if (!best || score > best.score) {
        best = {
          entry,
          symbol: method,
          methodName: method.name,
          className: method.className ?? entry.classes[0]?.name,
          score
        };
      }
    }
  }

  if (!best) {
    return undefined;
  }

  const absolutePath = path.resolve(options.project.workspaceDir, best.entry.path);
  const content = await readTextFileSafe(absolutePath);
  if (!content) {
    return undefined;
  }
  const methodBlock = findMethodBlock(content, best.methodName);
  if (!methodBlock) {
    return undefined;
  }

  const calls = extractOrderedMethodCalls(methodBlock.snippet).slice(0, 24);
  const callFlowLines: string[] = [];
  const nestedEvidence: string[] = [];
  for (const callName of calls.slice(0, 10)) {
    const resolved = findMethodBlock(content, callName);
    if (!resolved || callName === best.methodName) {
      callFlowLines.push(`- ${callName}: 외부/타컴포넌트 호출 또는 동일 파일 미정의`);
      continue;
    }
    const nestedCalls = extractOrderedMethodCalls(resolved.snippet).slice(0, 6);
    const signature = summarizeMethodSignature(resolved.snippet);
    callFlowLines.push(
      `- ${callName} (${resolved.startLine}~${resolved.endLine}): ${signature || "내부 메서드"}${
        nestedCalls.length > 0 ? ` -> calls: ${nestedCalls.join(", ")}` : ""
      }`
    );
    nestedEvidence.push(
      `${best.entry.path}:${resolved.startLine}-${resolved.endLine} - callee ${callName} analyzed`
    );
  }

  const symbol = `${best.className ? `${best.className}.` : ""}${best.methodName}`;
  const stageHints = [
    { key: "callF1FCZ0045", desc: "대외 EAI 제출 실행 단계" },
    { key: "saveClamDocumentFile", desc: "첨부파일 DB 저장 단계" },
    { key: "updateSubmitdate", desc: "제출일자 업데이트 단계" },
    { key: "selectClamDocument", desc: "기존 청구문서 조회/분기 기준 수집 단계" },
    { key: "moveConvertUploadFile", desc: "업로드 파일 변환/NAS 이동 단계" },
    { key: "callMODC0010", desc: "이미지->PDF 변환 단계" }
  ]
    .filter((item) => calls.includes(item.key))
    .map((item) => `- ${item.key}: ${item.desc}`);

  const answerLines = [
    `확정(코드 기준): \`${symbol}\` 메서드는 \`${best.entry.path}:${methodBlock.startLine}\`에서 시작합니다.`,
    `질문하신 '이후 흐름' 기준으로, 본문(${methodBlock.startLine}~${methodBlock.endLine} line)에서 탐지된 호출 순서를 따라 후속 처리 단계를 정리했습니다.`,
    "",
    "### 이후 실행 흐름(정적 분석)",
    ...(callFlowLines.length > 0 ? callFlowLines : ["- 호출 패턴 미검출"]),
    "",
    ...(stageHints.length > 0
      ? ["### 업무 의미 힌트", ...stageHints, ""]
      : []),
    "",
    "요약: 아래 스니펫은 실제 메서드 원문 일부이며, 질문하신 로직 파악의 1차 근거로 사용할 수 있습니다.",
    "```java",
    methodBlock.snippet.slice(0, 5200),
    "```"
  ];

  return {
    answer: answerLines.join("\n"),
    confidence: 0.86,
    evidence: [
      `${best.entry.path}:${methodBlock.startLine} - method declaration: ${symbol}`,
      `${best.entry.path}:${methodBlock.startLine}-${methodBlock.endLine} - method body inspected`,
      calls.length > 0 ? `${best.entry.path} - detected calls: ${calls.slice(0, 8).join(", ")}` : "",
      ...nestedEvidence.slice(0, 6)
    ].filter(Boolean),
    caveats: [
      "호출 대상의 내부 구현(하위 메서드/DAO/EAI 전문)은 별도 추적이 필요합니다.",
      "정적 분석 결과이며 런타임 분기 조건/외부 시스템 응답에 따라 실제 경로가 달라질 수 있습니다."
    ],
    symbol,
    hit: {
      path: best.entry.path,
      score: 18,
      source: "lexical",
      reasons: [`deterministic-symbol-match:${symbol}`]
    }
  };
}

async function collectMemoryMarkdownFiles(memoryRoot: string, maxFiles = 300): Promise<string[]> {
  const files = await collectProjectFiles(memoryRoot, maxFiles);
  return files.filter((file) => path.extname(file).toLowerCase() === ".md");
}

function selectAskMemoryFiles(
  paths: string[],
  intent?: { methodFocused: boolean; architectureFocused: boolean; moduleFlowFocused: boolean; crossLayerFocused: boolean }
): string[] {
  const normalized = paths.map((item) => toForwardSlash(item));
  const preferredOrder = intent?.crossLayerFocused
    ? [
        "front-back-graph/latest.md",
        "front-catalog/latest.md",
        "project-analysis/latest.md",
        "structure-index/latest.md",
        "eai-dictionary/latest.md",
        "project-profile/latest.md"
      ]
    : intent?.methodFocused || intent?.moduleFlowFocused
    ? [
        "structure-index/latest.md",
        "project-analysis/latest.md",
        "project-profile/latest.md",
        "eai-dictionary/latest.md"
      ]
    : [
        "project-analysis/latest.md",
        "project-profile/latest.md",
        "structure-index/latest.md",
        "eai-dictionary/latest.md",
        "eai-dictionary/maintenance-guide.md",
        "query-reports/latest.md"
      ];

  const selected: string[] = [];
  for (const preferred of preferredOrder) {
    if (normalized.includes(preferred)) {
      selected.push(preferred);
    }
  }

  for (const candidate of normalized) {
    if (selected.includes(candidate)) {
      continue;
    }
    if (/\d{8}-\d{6}\.md$/i.test(path.basename(candidate))) {
      continue;
    }
    selected.push(candidate);
  }

  return selected;
}

export async function warmupServerProjectIndex(options: {
  projectId: string;
  maxFiles?: number;
}): Promise<ProjectWarmupResult> {
  await appendProjectDebugEvent({
    timestamp: nowIso(),
    projectId: options.projectId,
    stage: "index",
    status: "start",
    message: "warmup indexing started",
    metadata: {
      maxFiles: options.maxFiles
    }
  });

  try {
    const project = await getServerProject(options.projectId);
    if (!project) {
      throw new Error(`project not found: ${options.projectId}`);
    }

    const files = await collectProjectFiles(project.workspaceDir, options.maxFiles ?? DEFAULT_PROJECT_MAX_FILES);
    if (files.length === 0) {
      const updatedProject = await patchProject(project.id, {
        lastIndexedAt: nowIso(),
        lastIndexSummary: "indexed files=0"
      });

      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "index",
        status: "success",
        message: "warmup indexing finished with zero files"
      });

      return {
        project: updatedProject,
        fileCount: 0,
        changedFiles: 0,
        reusedFiles: 0,
        selectedProvider: "lexical",
        fallbackUsed: false,
        providerResults: []
      };
    }

    const llmContext = await resolveProjectLlmContext(project);
    const retrievalConfig = await resolveRetrievalConfig(
      project.workspaceDir,
      mergeRetrievalWithModelCaps(project.retrieval, llmContext.stageTokenCaps)
    );
    const inspection = await inspectContext({
      cwd: project.workspaceDir,
      cachePath: resolveServerProjectContextCachePath(project.workspaceDir),
      files,
      task: `warmup project index: ${project.name}`,
      tier: "small",
      tokenBudget: 800,
      stage: "PLAN",
      retrievalConfig
    });

    const providerResults = inspection.retrieval.providerResults.map((result) => ({
      provider: result.provider,
      status: result.status,
      tookMs: result.tookMs,
      error: result.error
    }));

    const updatedProject = await patchProject(project.id, {
      lastIndexedAt: nowIso(),
      lastIndexSummary: `indexed files=${files.length} changed=${inspection.changedFiles.length} reused=${inspection.reusedFiles.length}`
    });

    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "index",
      status: "success",
      message: "warmup indexing finished",
      metadata: {
        files: files.length,
        changedFiles: inspection.changedFiles.length,
        selectedProvider: inspection.retrieval.selectedProvider,
        fallbackUsed: inspection.retrieval.fallbackUsed
      }
    });

    return {
      project: updatedProject,
      fileCount: files.length,
      changedFiles: inspection.changedFiles.length,
      reusedFiles: inspection.reusedFiles.length,
      selectedProvider: inspection.retrieval.selectedProvider,
      fallbackUsed: inspection.retrieval.fallbackUsed,
      providerResults
    };
  } catch (error) {
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "index",
      status: "failure",
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function isInsideParent(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function analyzeServerProject(options: {
  projectId: string;
  maxFiles?: number;
}): Promise<ProjectAnalysisResult> {
  await appendProjectDebugEvent({
    timestamp: nowIso(),
    projectId: options.projectId,
    stage: "analyze",
    status: "start",
    message: "project analyze started",
    metadata: {
      maxFiles: options.maxFiles
    }
  });

  try {
    const project = await getServerProject(options.projectId);
    if (!project) {
      throw new Error(`project not found: ${options.projectId}`);
    }

    const warmup = await warmupServerProjectIndex({
      projectId: options.projectId,
      maxFiles: options.maxFiles
    });
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "analyze",
      status: "info",
      message: "collecting project files for analysis",
      metadata: {
        maxFiles: options.maxFiles ?? DEFAULT_PROJECT_MAX_FILES
      }
    });
    const files = await collectProjectFiles(project.workspaceDir, options.maxFiles ?? DEFAULT_PROJECT_MAX_FILES);
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "analyze",
      status: "info",
      message: "project files collected for analysis",
      metadata: {
        fileCount: files.length
      }
    });
    const memoryRoot = resolveMemoryHome(project.workspaceDir);
    await fs.mkdir(memoryRoot, { recursive: true });
    let structure: { snapshot: StructureIndexSnapshot; memoryFiles: string[] };
    try {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "analyze",
        status: "info",
        message: "structure index build started",
        metadata: {
          fileCount: files.length
        }
      });
      structure = await buildProjectStructureIndex({
        workspaceDir: project.workspaceDir,
        files,
        memoryRoot,
        onProgress: async (progress) => {
          await appendProjectDebugEvent({
            timestamp: nowIso(),
            projectId: options.projectId,
            stage: "analyze",
            status: "info",
            message: `structure index build progress ${progress.processed}/${progress.total}`,
            metadata: {
              processed: progress.processed,
              total: progress.total,
              changedFiles: progress.changedFiles,
              reusedFiles: progress.reusedFiles,
              currentFile: progress.currentFile
            }
          });
        },
        onSlowFile: async (event) => {
          await appendProjectDebugEvent({
            timestamp: nowIso(),
            projectId: options.projectId,
            stage: "analyze",
            status: "info",
            message:
              event.durationMs < 0
                ? "structure index large file start"
                : `structure index slow file ${event.durationMs}ms`,
            metadata: {
              path: event.path,
              durationMs: event.durationMs,
              sizeBytes: event.sizeBytes,
              parseTarget: event.parseTarget
            }
          });
        }
      });
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "analyze",
        status: "info",
        message: "structure index build finished",
        metadata: {
          fileCount: structure.snapshot.stats.fileCount,
          changedFiles: structure.snapshot.stats.changedFiles,
          reusedFiles: structure.snapshot.stats.reusedFiles
        }
      });
    } catch (error) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "analyze",
        status: "info",
        message: `structure index build skipped: ${error instanceof Error ? error.message : String(error)}`
      });
      structure = {
        snapshot: {
          version: 1,
          generatedAt: nowIso(),
          workspaceDir: project.workspaceDir,
          stats: {
            fileCount: 0,
            packageCount: 0,
            classCount: 0,
            methodCount: 0,
            changedFiles: 0,
            reusedFiles: 0
          },
          topPackages: [],
          topMethods: [],
          entries: {}
        },
        memoryFiles: []
      };
    }

    const extStats = buildFileExtensionStats(files);
    const topDirs = buildTopDirectoryStats(files);
    const presetList = await listProjectPresets();
    let projectPreset =
      (warmup.project.presetId ? await getProjectPresetById(warmup.project.presetId) : undefined) ??
      matchProjectPreset({
        project: warmup.project,
        files,
        presets: presetList
      });
    if (warmup.project.presetId && !projectPreset) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "analyze",
        status: "info",
        message: `configured preset not found: ${warmup.project.presetId}`
      });
    }
    const generatedAt = nowIso();
    const activeDomainPacks = await resolveProjectDomainPacks(projectPreset);

    let presetMemoryFiles: string[] = [];

    const eaiEnabled = Boolean(projectPreset?.eai?.enabled);
    const eaiPresetAsOfDate = projectPreset?.eai?.asOfDate?.trim();
    let eaiEntries: EaiDictionaryEntry[] = [];
    let eaiMemoryFiles: string[] = [];
    let eaiAsOfDate = eaiPresetAsOfDate || generatedAt.slice(0, 10);
    let eaiManualOverridesApplied = 0;
    let frontBackGraph: FrontBackGraphSnapshot | undefined;
    let frontBackMemoryFiles: string[] = [];

    if (eaiEnabled) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "analyze",
        status: "info",
        message: "eai dictionary build started"
      });
      const autoEaiEntries = await buildEaiDictionary({
        workspaceDir: project.workspaceDir,
        files,
        servicePathIncludes: projectPreset?.eai?.servicePathIncludes,
        onProgress: async (progress) => {
          await appendProjectDebugEvent({
            timestamp: nowIso(),
            projectId: options.projectId,
            stage: "analyze",
            status: "info",
            message: `eai dictionary progress ${progress.phase} ${progress.processed}/${progress.total}`,
            metadata: {
              phase: progress.phase,
              processed: progress.processed,
              total: progress.total,
              currentFile: progress.currentFile
            }
          });
        }
      });
      const overridePayload = await loadEaiOverrides({
        workspaceDir: project.workspaceDir,
        manualOverridesFile: projectPreset?.eai?.manualOverridesFile
      });
      const overridden = applyEaiOverrides({
        baseEntries: autoEaiEntries,
        overrides: overridePayload.entries
      });
      eaiEntries = overridden.entries;
      eaiManualOverridesApplied = overridden.appliedCount;
      if (overridePayload.asOfDate) {
        eaiAsOfDate = overridePayload.asOfDate;
      }

      const eaiMarkdown = buildEaiDictionaryMarkdown({
        project: warmup.project,
        generatedAt,
        asOfDate: eaiAsOfDate,
        entries: eaiEntries
      });
      const eaiDocs = await writeMemoryDocs({
        memoryRoot,
        groupDir: EAI_MEMORY_DIR,
        latestFileName: "latest.md",
        content: eaiMarkdown
      });
      const eaiJsonPath = await writeMemoryJson({
        memoryRoot,
        groupDir: EAI_MEMORY_DIR,
        fileName: "latest.json",
        payload: {
          generatedAt,
          asOfDate: eaiAsOfDate,
          interfaceCount: eaiEntries.length,
          manualOverridesApplied: eaiManualOverridesApplied,
          overridesSource: projectPreset?.eai?.manualOverridesFile ?? null,
          entries: eaiEntries
        }
      });
      const maintenanceMarkdown = buildEaiMaintenanceGuideMarkdown({
        project: warmup.project,
        generatedAt,
        asOfDate: eaiAsOfDate,
        manualOverridesFile: projectPreset?.eai?.manualOverridesFile
      });
      const maintenancePath = path.resolve(memoryRoot, EAI_MEMORY_DIR, "maintenance-guide.md");
      await fs.mkdir(path.dirname(maintenancePath), { recursive: true });
      await fs.writeFile(maintenancePath, maintenanceMarkdown, "utf8");

      eaiMemoryFiles = [eaiDocs.latestPath, eaiDocs.snapshotPath, eaiJsonPath, maintenancePath];
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "analyze",
        status: "info",
        message: "eai dictionary build finished",
        metadata: {
          interfaceCount: eaiEntries.length,
          manualOverridesApplied: eaiManualOverridesApplied
        }
      });
    }

    const linkedWorkspaceDirs = project.linkedWorkspaceDirs ?? [];
    const frontendWorkspaceDirs: string[] = [];
    for (const dir of linkedWorkspaceDirs) {
      if (await isFrontendWorkspace(dir)) {
        frontendWorkspaceDirs.push(dir);
      }
    }
    if (frontendWorkspaceDirs.length > 0) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "analyze",
        status: "info",
        message: "front-back graph build started",
        metadata: {
          frontendWorkspaces: frontendWorkspaceDirs.length
        }
      });
      frontBackGraph = await buildFrontBackGraph({
        backendWorkspaceDir: project.workspaceDir,
        frontendWorkspaceDirs,
        domainPacks: activeDomainPacks
      });
      const frontCatalogDocs = await writeMemoryDocs({
        memoryRoot,
        groupDir: FRONT_CATALOG_MEMORY_DIR,
        latestFileName: "latest.md",
        content: buildFrontCatalogMarkdown({
          project: warmup.project,
          generatedAt,
          graph: frontBackGraph
        })
      });
      const frontCatalogJsonPath = await writeMemoryJson({
        memoryRoot,
        groupDir: FRONT_CATALOG_MEMORY_DIR,
        fileName: "latest.json",
        payload: {
          generatedAt,
          workspaceCount: frontBackGraph.meta.frontendWorkspaceDirs.length,
          routeCount: frontBackGraph.frontend.routeCount,
          screenCount: frontBackGraph.frontend.screenCount,
          apiCount: frontBackGraph.frontend.apiCount,
          screens: frontBackGraph.frontend.screens
        }
      });
      const graphDocs = await writeMemoryDocs({
        memoryRoot,
        groupDir: FRONT_BACK_GRAPH_MEMORY_DIR,
        latestFileName: "latest.md",
        content: buildFrontBackGraphMarkdown({
          project: warmup.project,
          generatedAt,
          graph: frontBackGraph
        })
      });
      const graphJsonPath = await writeMemoryJson({
        memoryRoot,
        groupDir: FRONT_BACK_GRAPH_MEMORY_DIR,
        fileName: "latest.json",
        payload: frontBackGraph
      });
      frontBackMemoryFiles = [
        frontCatalogDocs.latestPath,
        frontCatalogDocs.snapshotPath,
        frontCatalogJsonPath,
        graphDocs.latestPath,
        graphDocs.snapshotPath,
        graphJsonPath
      ];
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "analyze",
        status: "info",
        message: "front-back graph build finished",
        metadata: {
          screenCount: frontBackGraph.frontend.screenCount,
          linkCount: frontBackGraph.links.length
        }
      });
    }

    const domainMaturity = computeDomainMaturity({
      domainPacks: activeDomainPacks,
      frontBackGraph,
      structure: {
        entries: structure.snapshot.entries
      },
      eaiEntries
    });

    if (projectPreset) {
      const presetMarkdown = buildProjectPresetMarkdown({
        project: warmup.project,
        preset: projectPreset,
        updatedAt: generatedAt,
        activeDomains: activeDomainPacks,
        maturity: domainMaturity
      });
      const presetDocs = await writeMemoryDocs({
        memoryRoot,
        groupDir: PROFILE_MEMORY_DIR,
        latestFileName: "latest.md",
        content: presetMarkdown
      });
      presetMemoryFiles = [presetDocs.latestPath, presetDocs.snapshotPath];
    }
    const domainMaturityDocs = await writeMemoryDocs({
      memoryRoot,
      groupDir: DOMAIN_MATURITY_MEMORY_DIR,
      latestFileName: "latest.md",
      content: buildDomainMaturityMarkdown({
        project: warmup.project,
        analyzedAt: generatedAt,
        maturity: domainMaturity
      })
    });
    const domainMaturityJsonPath = await writeMemoryJson({
      memoryRoot,
      groupDir: DOMAIN_MATURITY_MEMORY_DIR,
      fileName: "latest.json",
      payload: domainMaturity
    });
    const domainMaturityMemoryFiles = [
      domainMaturityDocs.latestPath,
      domainMaturityDocs.snapshotPath,
      domainMaturityJsonPath
    ];

    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "analyze",
      status: "info",
      message: "seed retrieval search started"
    });
    const seedSearch = await searchServerProject({
      projectId: options.projectId,
      query: "architecture module service controller repository flow entrypoint",
      limit: 14
    });
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "analyze",
      status: "info",
      message: "seed retrieval search finished",
      metadata: {
        provider: seedSearch.provider,
        hitCount: seedSearch.hits.length
      }
    });
    const hitConfidence = seedSearch.hits.map((hit) => normalizeHitConfidence(hit));
    const topConfidence = hitConfidence[0] ?? 0;
    const avgConfidence =
      hitConfidence.reduce((sum, value) => sum + value, 0) / Math.max(1, hitConfidence.length);
    const lowConfidenceSignals = summarizeLowConfidenceSignals(seedSearch.hits);
    const lowConfidenceMode = topConfidence < 0.4 || avgConfidence < 0.3 || seedSearch.hits.length < 3;

    const deterministic = buildDeterministicProjectSummary({
      project: warmup.project,
      files,
      warmup
    });

    const llmContext = await resolveProjectLlmContext(project);
    const llm = new OpenAICompatibleLlmClient({
      model: llmContext.model.id,
      maxTokens: llmContext.model.maxOutputTokens,
      contextWindowTokens: llmContext.model.contextWindowTokens,
      contextUsageRatio: llmContext.settings.continuationUsageRatio,
      retrySameTask: llmContext.settings.retryPolicy.sameTaskRetries,
      retryChangedTask: llmContext.settings.retryPolicy.changedTaskRetries
    });
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "analyze",
      status: "info",
      message: "analysis llm generation started",
      metadata: {
        lowConfidenceMode,
        seedProvider: seedSearch.provider
      }
    });
    const analysisPromptPayload = {
      project: {
        id: warmup.project.id,
        name: warmup.project.name,
        description: warmup.project.description,
        workspaceDir: warmup.project.workspaceDir
      },
      knownProjectContext: projectPreset
        ? {
            preset: projectPreset.name,
            summary: projectPreset.summary,
            keyFacts: projectPreset.keyFacts,
            domainPackIds: projectPreset.domainPackIds ?? []
          }
        : null,
      domainMaturity: {
        overallScore: domainMaturity.summary.overallScore,
        domains: domainMaturity.domains.slice(0, 12).map((domain) => ({
          id: domain.id,
          name: domain.name,
          score: domain.score,
          band: domain.band,
          strongestSignals: domain.strongestSignals,
          weakestSignals: domain.weakestSignals
        }))
      },
      indexed: {
        fileCount: files.length,
        warmupProvider: warmup.selectedProvider,
        warmupFallbackUsed: warmup.fallbackUsed,
        topExtensions: extStats.slice(0, 12),
        topDirectories: topDirs.slice(0, 15)
      },
      linkedWorkspaces: {
        count: linkedWorkspaceDirs.length,
        frontendCount: frontendWorkspaceDirs.length,
        dirs: linkedWorkspaceDirs.map((item) => toForwardSlash(item))
      },
      structureIndex: {
        generatedAt: structure.snapshot.generatedAt,
        fileCount: structure.snapshot.stats.fileCount,
        packageCount: structure.snapshot.stats.packageCount,
        classCount: structure.snapshot.stats.classCount,
        methodCount: structure.snapshot.stats.methodCount,
        topPackages: structure.snapshot.topPackages.slice(0, 20),
        topMethods: structure.snapshot.topMethods.slice(0, 20)
      },
      eaiDictionary: {
        enabled: eaiEnabled,
        asOfDate: eaiAsOfDate,
        interfaceCount: eaiEntries.length,
        manualOverridesApplied: eaiManualOverridesApplied,
        topInterfaces: eaiEntries.slice(0, 20).map((entry) => ({
          interfaceId: entry.interfaceId,
          interfaceName: entry.interfaceName,
          purpose: entry.purpose,
          usagePaths: entry.usagePaths.slice(0, 5)
        }))
      },
      frontBackGraph: frontBackGraph
        ? {
            frontendWorkspaceCount: frontBackGraph.meta.frontendWorkspaceDirs.length,
            routeCount: frontBackGraph.frontend.routeCount,
            screenCount: frontBackGraph.frontend.screenCount,
            apiCount: frontBackGraph.frontend.apiCount,
            linkCount: frontBackGraph.links.length,
            topLinks: frontBackGraph.links.slice(0, 10).map((link) => ({
              screenCode: link.frontend.screenCode,
              routePath: link.frontend.routePath,
              apiUrl: link.api.rawUrl,
              gatewayControllerMethod: link.gateway.controllerMethod,
              backendPath: link.backend.path,
              controllerMethod: link.backend.controllerMethod,
              serviceHints: link.backend.serviceHints,
              capabilityTags: link.capabilityTags ?? []
            }))
          }
        : null,
      projectContextHints: {
        pairedWorkspaceSetEnabled: frontendWorkspaceDirs.length > 0
      },
      retrievalEvidence: seedSearch.hits.slice(0, 14).map((hit) => ({
        path: hit.path,
        score: hit.score,
        confidence: normalizeHitConfidence(hit),
        reasons: hit.reasons ?? [],
        snippet: hit.snippet ?? ""
      })),
      confidencePolicy: {
        topConfidence,
        averageConfidence: avgConfidence,
        lowConfidenceMode,
        lowConfidenceSignals
      }
    };

    const generation = await llm.generateStructured({
      systemPrompt: [
        "You are an architecture analyst for a local coding runtime.",
        "Return ONLY one JSON object.",
        "Use knownProjectContext as prior domain context when provided.",
        "If confidence is low, explicitly include missing-coverage risks and lower confidence.",
        "Do not fabricate files or dependencies."
      ].join("\n"),
      userPrompt: JSON.stringify(
        {
          task: "Analyze project structure and architecture for memory indexing.",
          outputSchema: {
            summary: "string",
            architecture: ["string"],
            keyModules: [{ name: "string", path: "string", role: "string", confidence: "0..1" }],
            risks: ["string"],
            confidence: "0..1",
            evidence: ["string"]
          },
          input: analysisPromptPayload
        },
        null,
        2
      ),
      fallback: deterministic,
      parse: (value) => ProjectAnalysisOutputSchema.parse(value)
    });
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "analyze",
      status: "info",
      message: "analysis llm generation finished",
      metadata: {
        usedFallback: generation.usedFallback,
        llmCallCount: generation.liveCallCount
      }
    });

    const analyzedAt = nowIso();
    const output = generation.output;
    const normalizedOutput = {
      summary: output.summary,
      architecture: output.architecture.slice(0, 24),
      keyModules: output.keyModules
        .map((module) => ({
          ...module,
          path: toForwardSlash(module.path),
          confidence: Math.max(0, Math.min(1, module.confidence))
        }))
        .slice(0, 32),
      risks: unique([...output.risks, ...lowConfidenceSignals]).slice(0, 30),
      confidence: Math.max(
        0,
        Math.min(
          1,
          output.confidence * (lowConfidenceMode ? 0.85 : 1)
        )
      ),
      evidence: unique([
        ...output.evidence,
        `seedProvider=${seedSearch.provider}`,
        `seedTopConfidence=${topConfidence.toFixed(2)}`,
        `seedAverageConfidence=${avgConfidence.toFixed(2)}`,
        `structureFiles=${structure.snapshot.stats.fileCount}`,
        `structureMethods=${structure.snapshot.stats.methodCount}`,
        projectPreset ? `projectPreset=${projectPreset.name}` : "",
        `eaiCatalogCount=${eaiEntries.length}`,
        `activeDomainCount=${activeDomainPacks.length}`,
        `overallDomainMaturity=${domainMaturity.summary.overallScore}`
      ]).slice(0, 30)
    };

    const markdown = buildAnalysisMarkdown({
      project: warmup.project,
      analyzedAt,
      ...normalizedOutput,
      lowConfidenceSignals
    });
    const analysisFiles = await writeMemoryDocs({
      memoryRoot,
      groupDir: ANALYSIS_MEMORY_DIR,
      latestFileName: "latest.md",
      content: markdown
    });

    if (isInsideParent(project.workspaceDir, memoryRoot)) {
      const relativeToWorkspace = path.relative(project.workspaceDir, memoryRoot);
      const relativeMemoryFiles = analysisFiles.relativePaths.map((item) =>
        toForwardSlash(path.join(relativeToWorkspace, item))
      );
      const extraMemoryFiles = [
        ...structure.memoryFiles,
        ...presetMemoryFiles,
        ...eaiMemoryFiles,
        ...frontBackMemoryFiles,
        ...domainMaturityMemoryFiles
      ].map((entry) => toForwardSlash(path.relative(project.workspaceDir, entry)));
      await inspectContext({
        cwd: project.workspaceDir,
        cachePath: resolveServerProjectContextCachePath(project.workspaceDir),
        files: unique([...files.slice(0, 5_000), ...relativeMemoryFiles, ...extraMemoryFiles]),
        task: `reindex with memory docs: ${project.name}`,
        tier: "small",
        tokenBudget: 700,
        stage: "PLAN"
      });
    }

    const result: ProjectAnalysisResult = {
      project: warmup.project,
      analyzedAt,
      memoryHome: memoryRoot,
      memoryFiles: unique([
        analysisFiles.latestPath,
        analysisFiles.snapshotPath,
        ...structure.memoryFiles,
        ...presetMemoryFiles,
        ...eaiMemoryFiles,
        ...frontBackMemoryFiles,
        ...domainMaturityMemoryFiles
      ]),
      projectPreset: projectPreset
        ? {
            id: projectPreset.id,
            name: projectPreset.name,
            summary: projectPreset.summary,
            domainPackIds: projectPreset.domainPackIds ?? []
          }
        : undefined,
      domains: domainMaturity.domains,
      maturitySummary: domainMaturity.summary,
      eaiCatalog: eaiEnabled
        ? {
            asOfDate: eaiAsOfDate,
            interfaceCount: eaiEntries.length,
            manualOverridesApplied: eaiManualOverridesApplied,
            source: "preset-enabled",
            topInterfaces: rankEaiDictionaryEntriesForSummary(eaiEntries, 20).map((entry) => ({
              interfaceId: entry.interfaceId,
              interfaceName: entry.interfaceName,
              purpose: entry.purpose,
              usagePaths: entry.usagePaths.slice(0, 5),
              moduleUsagePaths: entry.moduleUsagePaths.slice(0, 4),
              javaCallSiteMethods: unique(
                entry.javaCallSites
                  .map((site) => site.methodName ?? "")
                  .filter(Boolean)
              ).slice(0, 4)
            }))
          }
        : {
            asOfDate: eaiAsOfDate,
            interfaceCount: 0,
            manualOverridesApplied: 0,
            source: "disabled",
            topInterfaces: []
          },
      frontCatalog: frontBackGraph
        ? {
            generatedAt: frontBackGraph.generatedAt,
            workspaceCount: frontBackGraph.meta.frontendWorkspaceDirs.length,
            screenCount: frontBackGraph.frontend.screenCount,
            routeCount: frontBackGraph.frontend.routeCount,
            apiCount: frontBackGraph.frontend.apiCount,
            topScreens: frontBackGraph.frontend.screens.slice(0, 12).map((screen) => ({
              screenCode: screen.screenCode,
              filePath: screen.filePath,
              routePaths: screen.routePaths.slice(0, 4),
              apiPaths: screen.apiPaths.slice(0, 4),
              labels: (screen.labels ?? []).slice(0, 4),
              capabilityTags: (screen.capabilityTags ?? []).slice(0, 6)
            }))
          }
        : undefined,
      frontBackGraph: frontBackGraph
        ? {
            generatedAt: frontBackGraph.generatedAt,
            workspaceCount: frontBackGraph.meta.frontendWorkspaceDirs.length,
            linkCount: frontBackGraph.links.length,
            topLinks: frontBackGraph.links.slice(0, 12).map((link) => ({
              screenCode: link.frontend.screenCode,
              routePath: link.frontend.routePath,
              apiUrl: link.api.rawUrl,
              gatewayControllerMethod: link.gateway.controllerMethod,
              backendPath: link.backend.path,
              controllerMethod: link.backend.controllerMethod,
              confidence: link.confidence,
              capabilityTags: (link.capabilityTags ?? []).slice(0, 6)
            }))
          }
        : undefined,
      structureCatalog: {
        generatedAt: structure.snapshot.generatedAt,
        fileCount: structure.snapshot.stats.fileCount,
        packageCount: structure.snapshot.stats.packageCount,
        classCount: structure.snapshot.stats.classCount,
        methodCount: structure.snapshot.stats.methodCount,
        topPackages: structure.snapshot.topPackages.slice(0, 20).map((item) => ({
          name: item.name,
          fileCount: item.fileCount,
          methodCount: item.methodCount
        }))
      },
      ...normalizedOutput,
      diagnostics: {
        warmup,
        lowConfidenceSignals,
        usedFallback: generation.usedFallback,
        llmCallCount: generation.liveCallCount,
        profileApplied: Boolean(projectPreset),
        eaiCatalogCount: eaiEntries.length,
        structureIndexCount: structure.snapshot.stats.fileCount,
        frontCatalogCount: frontBackGraph?.frontend.screenCount ?? 0,
        frontBackLinkCount: frontBackGraph?.links.length ?? 0,
        activeDomainCount: activeDomainPacks.length,
        overallDomainMaturityScore: domainMaturity.summary.overallScore
      }
    };

    await fs.writeFile(
      analysisSnapshotPath(memoryRoot),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8"
    );

    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "analyze",
      status: "success",
      message: "project analyze completed",
      metadata: {
        confidence: result.confidence,
        memoryFiles: result.memoryFiles.length,
        usedFallback: result.diagnostics.usedFallback,
        llmCallCount: result.diagnostics.llmCallCount,
        structureFiles: result.diagnostics.structureIndexCount
      }
    });

    return result;
  } catch (error) {
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "analyze",
      status: "failure",
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function qualityGateForAsk(options: {
  output: z.infer<typeof ProjectAskOutputSchema>;
  question: string;
  hits: ProjectSearchHit[];
  strategy?: AskStrategyType;
  hydratedEvidence?: AskHydratedEvidenceItem[];
  linkedEaiEvidence?: Array<{ interfaceId: string; interfaceName: string }>;
  linkedFlowEvidence?: Array<{
    routePath?: string;
    screenCode?: string;
    apiUrl: string;
    backendPath: string;
    backendControllerMethod: string;
    serviceHints?: string[];
  }>;
  moduleCandidates?: string[];
  domainPacks?: DomainPack[];
  questionTags?: string[];
}): {
  passed: boolean;
  failures: string[];
} {
  return qualityGateForAskOutput({
    output: options.output,
    question: options.question,
    hitPaths: options.hits.map((hit) => hit.path),
    strategy: options.strategy,
    hydratedEvidence: (options.hydratedEvidence ?? []).map((item) => ({
      path: item.path,
      reason: item.reason,
      codeFile: item.codeFile,
      moduleMatched: item.moduleMatched
    })),
    linkedEaiEvidence: options.linkedEaiEvidence,
    linkedFlowEvidence: options.linkedFlowEvidence,
    moduleCandidates: options.moduleCandidates,
    domainPacks: options.domainPacks,
    questionTags: options.questionTags
  });
}

async function decideAskStrategy(options: {
  llm: OpenAICompatibleLlmClient;
  question: string;
  project: ServerProject;
  structure?: StructureIndexSnapshot;
}): Promise<{
  strategy: AskStrategyType;
  confidence: number;
  reason: string;
  targetSymbols: string[];
  llmUsed: boolean;
  llmCalls: number;
  usedFallback: boolean;
}> {
  const fallback = classifyQuestionIntentFallback(options.question);
  const generation = await options.llm.generateStructured({
    systemPrompt: [
      "You are a query-strategy classifier for a code analysis assistant.",
      "Return ONLY one JSON object.",
      "Pick exactly one strategy from: method_trace, module_flow_topdown, cross_layer_flow, architecture_overview, eai_interface, config_resource, general.",
      "Prefer method_trace when a specific function/class flow is requested.",
      "Prefer module_flow_topdown when a module-scoped execution flow is requested (e.g. 'dcp-insurance 내부에서 ... 탑다운').",
      "Prefer cross_layer_flow when the user explicitly asks for frontend -> backend, screen -> API -> controller, or gateway-crossing flow."
    ].join("\n"),
    userPrompt: JSON.stringify(
      {
        task: "Classify the question to one strategy.",
        outputSchema: {
          strategy: "method_trace|module_flow_topdown|cross_layer_flow|architecture_overview|eai_interface|config_resource|general",
          confidence: "0..1",
          reason: "string",
          targetSymbols: ["string"]
        },
        question: options.question,
        project: {
          name: options.project.name,
          description: options.project.description
        },
        explicitModuleCandidates: extractModuleCandidates(options.question),
        structureHint: options.structure
          ? {
              packageCount: options.structure.stats.packageCount,
              topPackages: options.structure.topPackages.slice(0, 5).map((entry) => entry.name),
              topMethods: options.structure.topMethods.slice(0, 8).map((entry) => entry.name)
            }
          : null
      },
      null,
      2
    ),
    fallback,
    parse: (value) => AskStrategyDecisionSchema.parse(value)
  });

  const normalizedStrategy = normalizeAskStrategyForQuestion(options.question, generation.output.strategy);

  return {
    strategy: normalizedStrategy,
    confidence: generation.output.confidence,
    reason: generation.output.reason,
    targetSymbols: generation.output.targetSymbols.slice(0, 6),
    llmUsed: generation.liveCallCount > 0,
    llmCalls: generation.liveCallCount,
    usedFallback: generation.usedFallback
  };
}

export async function askServerProject(options: {
  projectId: string;
  question: string;
  maxAttempts?: number;
  limit?: number;
  maxLlmCalls?: number;
  deterministicOnly?: boolean;
  domainPackIds?: string[];
  domainSelectionMode?: "auto" | "lock";
}): Promise<ProjectAskResponse> {
  await appendProjectDebugEvent({
    timestamp: nowIso(),
    projectId: options.projectId,
    stage: "ask",
    status: "start",
    message: "project ask started",
    metadata: {
      question: options.question,
      deterministicOnly: Boolean(options.deterministicOnly),
      domainSelectionMode: options.domainSelectionMode ?? "auto",
      requestedDomainIds: options.domainPackIds ?? []
    }
  });

  try {
    const project = await getServerProject(options.projectId);
    if (!project) {
      throw new Error(`project not found: ${options.projectId}`);
    }

    const question = options.question.trim();
    if (!question) {
      throw new Error("question is required");
    }

    const llmContext = await resolveProjectLlmContext(project);
    const llm = new OpenAICompatibleLlmClient({
      model: llmContext.model.id,
      maxTokens: llmContext.model.maxOutputTokens,
      contextWindowTokens: llmContext.model.contextWindowTokens,
      contextUsageRatio: llmContext.settings.continuationUsageRatio,
      retrySameTask: llmContext.settings.retryPolicy.sameTaskRetries,
      retryChangedTask: llmContext.settings.retryPolicy.changedTaskRetries
    });
    const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? DEFAULT_ASK_MAX_ATTEMPTS, 5));
    const llmCallBudget = -1;
    let llmCallCount = 0;
    let strategyUsedFallback = false;
    const explicitModuleCandidates = extractModuleCandidates(question);
    let strategyDecision: {
      strategy: AskStrategyType;
      confidence: number;
      reason: string;
      targetSymbols: string[];
      moduleCandidates: string[];
      llmUsed: boolean;
    } = {
      ...classifyQuestionIntentFallback(question),
      moduleCandidates: explicitModuleCandidates,
      llmUsed: false
    };

    const memoryRoot = resolveMemoryHome(project.workspaceDir);
    await fs.mkdir(memoryRoot, { recursive: true });

    const structureSnapshot = await loadStructureSnapshot(project.workspaceDir);
    const structureMemoryFiles: string[] = [];
    if (structureSnapshot) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "loaded cached structure index for deterministic precheck",
        metadata: {
          fileCount: structureSnapshot.stats.fileCount,
          methodCount: structureSnapshot.stats.methodCount
        }
      });
    } else {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "structure index not found; skipping heavy prebuild during ask"
      });
    }

    try {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "ask strategy llm classification started"
      });
      const decided = await decideAskStrategy({
        llm,
        question,
        project,
        structure: structureSnapshot
      });
      strategyDecision = {
        strategy: decided.strategy,
        confidence: decided.confidence,
        reason: decided.reason,
        targetSymbols: decided.targetSymbols,
        moduleCandidates: explicitModuleCandidates,
        llmUsed: decided.llmUsed
      };
      llmCallCount += decided.llmCalls;
      strategyUsedFallback = decided.usedFallback;
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "ask strategy decided",
        metadata: {
          strategy: strategyDecision.strategy,
          confidence: strategyDecision.confidence,
          moduleCandidates: strategyDecision.moduleCandidates,
          llmUsed: strategyDecision.llmUsed,
          llmCallCount
        }
      });
    } catch (error) {
      strategyDecision = {
        ...classifyQuestionIntentFallback(question),
        moduleCandidates: explicitModuleCandidates,
        llmUsed: false
      };
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: `ask strategy fallback used: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          strategy: strategyDecision.strategy
        }
      });
    }

    const intent = strategyToIntent(strategyDecision.strategy);

    if (structureSnapshot) {
      const deterministic = await buildDeterministicMethodAnswer({
        project,
        question,
        structure: structureSnapshot
      });
      if (deterministic) {
        const deterministicHits = [deterministic.hit];
        const deterministicGate = qualityGateForAsk({
          output: {
            answer: deterministic.answer,
            confidence: deterministic.confidence,
            evidence: deterministic.evidence,
            caveats: deterministic.caveats
          },
          question,
          hits: deterministicHits
        });

        const deterministicReportLines: string[] = [
          "# Query Report",
          "",
          `- projectId: ${project.id}`,
          `- projectName: ${project.name}`,
          `- askedAt: ${nowIso()}`,
          `- question: ${question}`,
          `- confidence: ${deterministic.confidence.toFixed(2)}`,
          `- qualityGatePassed: ${deterministicGate.passed}`,
          `- attempts: 0`,
          "",
          "## Answer",
          deterministic.answer,
          "",
          "## Evidence",
          ...deterministic.evidence.map((line) => `- ${line}`),
          "",
          "## Caveats",
          ...deterministic.caveats.map((line) => `- ${line}`),
          "",
          "## Retrieval",
          "- provider=lexical",
          "- fallback=false",
          "- hitCount=1",
          "- topConfidence=0.90",
          ""
        ];
        const queryReportFiles = await writeMemoryDocs({
          memoryRoot,
          groupDir: QUERY_MEMORY_DIR,
          latestFileName: "latest.md",
          content: `${deterministicReportLines.join("\n")}\n`
        });

        const response: ProjectAskResponse = {
          project,
          question,
          answer: deterministic.answer,
          confidence: deterministic.confidence,
          qualityGatePassed: deterministicGate.passed,
          attempts: 0,
          evidence: deterministic.evidence,
          caveats: deterministic.caveats,
          retrieval: {
            provider: "lexical",
            fallbackUsed: false,
            hitCount: 1,
            topConfidence: 0.9
          },
          diagnostics: {
            lowConfidenceMode: false,
            qualityGateFailures: deterministicGate.failures,
            usedFallback: false,
            llmCallCount,
            llmCallBudget,
            strategyType: strategyDecision.strategy,
            strategyConfidence: strategyDecision.confidence,
            strategyLlmUsed: strategyDecision.llmUsed,
            strategyReason: strategyDecision.reason,
            scopeModules: strategyDecision.moduleCandidates,
            deterministicUsed: true,
            deterministicSymbol: deterministic.symbol,
            memoryFiles: unique([
              ...structureMemoryFiles,
              queryReportFiles.latestPath,
              queryReportFiles.snapshotPath
            ])
          }
        };

        await appendProjectDebugEvent({
          timestamp: nowIso(),
          projectId: options.projectId,
          stage: "ask",
          status: "success",
          message: "project ask completed with deterministic symbol analysis",
          metadata: {
            symbol: deterministic.symbol,
            llmCallCount
          }
        });
        return response;
      }
    }

    if (options.deterministicOnly && structureSnapshot) {
      const deterministicCaveats = structureSnapshot
        ? ["LLM 보강 미사용"]
        : ["LLM 보강 미사용", "구조 인덱스가 없어 심볼 매칭 범위가 제한되었습니다."];
      const deterministicEvidence = structureSnapshot
        ? ["deterministic symbol lookup: no exact match"]
        : ["deterministic symbol lookup skipped: structure index missing"];
      const reportLines = [
        "# Query Report",
        "",
        `- projectId: ${project.id}`,
        `- projectName: ${project.name}`,
        `- askedAt: ${nowIso()}`,
        `- question: ${question}`,
        "- confidence: 0.35",
        "- qualityGatePassed: false",
        "- attempts: 0",
        "",
        "## Answer",
        "deterministic-only 모드에서 질문을 처리했지만, 클래스/메서드 심볼을 정확히 매칭하지 못했습니다. LLM 보강을 켜고 재질문하거나, 클래스명/메서드명을 명시해주세요.",
        "",
        "## Evidence",
        ...deterministicEvidence.map((line) => `- ${line}`),
        "",
        "## Caveats",
        ...deterministicCaveats.map((line) => `- ${line}`),
        ""
      ];
      const queryReportFiles = await writeMemoryDocs({
        memoryRoot,
        groupDir: QUERY_MEMORY_DIR,
        latestFileName: "latest.md",
        content: `${reportLines.join("\n")}\n`
      });
      const response: ProjectAskResponse = {
        project,
        question,
        answer:
          "deterministic-only 모드에서는 정확한 심볼 매칭 질문(예: `AccBenefitClaimService.saveBenefitClaimDoc`) 위주로 응답합니다.",
        confidence: 0.35,
        qualityGatePassed: false,
        attempts: 0,
        evidence: deterministicEvidence,
        caveats: deterministicCaveats,
        retrieval: {
          provider: "lexical",
          fallbackUsed: false,
          hitCount: 0,
          topConfidence: 0
        },
        diagnostics: {
          lowConfidenceMode: true,
          qualityGateFailures: ["deterministic-no-symbol-match"],
          usedFallback: false,
          llmCallCount,
          llmCallBudget,
          strategyType: strategyDecision.strategy,
          strategyConfidence: strategyDecision.confidence,
          strategyLlmUsed: strategyDecision.llmUsed,
          strategyReason: strategyDecision.reason,
          scopeModules: strategyDecision.moduleCandidates,
          deterministicUsed: true,
          deterministicSymbol: "none",
          memoryFiles: unique([...structureMemoryFiles, queryReportFiles.latestPath, queryReportFiles.snapshotPath])
        }
      };
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "success",
        message: "deterministic-only ask completed without LLM",
        metadata: {
          llmCallCount
        }
      });
      return response;
    }

    if (options.deterministicOnly && !structureSnapshot) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "deterministic-only requested but structure index missing; fallback to LLM-assisted path"
      });
    }

    let analysis = await readAnalysisSnapshot(memoryRoot);
    if (analysis) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "using cached analysis snapshot",
        metadata: {
          analyzedAt: analysis.analyzedAt
        }
      });
    } else {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "analysis snapshot missing; running project analyze",
        metadata: {
          cacheMaxAgeMs: ANALYSIS_CACHE_MAX_AGE_MS
        }
      });
      const analyzeStartedAt = Date.now();
      analysis = await analyzeServerProject({
        projectId: options.projectId
      });
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "analysis snapshot created for ask",
        metadata: {
          analyzedAt: analysis.analyzedAt,
          tookMs: Date.now() - analyzeStartedAt
        }
      });
    }

    const activeDomainPacks = analysis.projectPreset?.domainPackIds?.length
      ? resolveDomainPacksByIds(await listDomainPacks(), analysis.projectPreset.domainPackIds)
      : await resolveProjectDomainPacks(project.presetId ? await getProjectPresetById(project.presetId) : undefined);
    const domainSelection = resolveAskDomainSelection({
      question,
      activeDomainPacks,
      requestedDomainIds: options.domainPackIds,
      mode: options.domainSelectionMode
    });
    const effectiveDomainPacks = domainSelection.effectiveDomainPacks;
    const pinnedDomainPacks = domainSelection.lockedDomainIds.length > 0
      ? resolveDomainPacksByIds(effectiveDomainPacks, domainSelection.lockedDomainIds)
      : [];
    const questionCapabilityTags = resolveQuestionCapabilityTags({
      question,
      domainPacks: effectiveDomainPacks,
      pinnedDomainPacks
    });
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "ask",
      status: "info",
      message: "resolved ask domains",
      metadata: {
        mode: domainSelection.mode,
        activeDomainIds: activeDomainPacks.map((item) => item.id),
        matchedDomainIds: domainSelection.matchedDomains.map((item) => item.id),
        lockedDomainIds: domainSelection.lockedDomainIds,
        effectiveDomainIds: effectiveDomainPacks.map((item) => item.id),
        questionCapabilityTags
      }
    });

    const eaiSnapshot = await readEaiDictionarySnapshot(memoryRoot);
    if (eaiSnapshot) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "loaded cached eai dictionary for ask",
        metadata: {
          interfaceCount: eaiSnapshot.interfaceCount,
          asOfDate: eaiSnapshot.asOfDate ?? null
        }
      });
    }
    const frontBackGraphSnapshot = await readFrontBackGraphSnapshot(memoryRoot);
    if (frontBackGraphSnapshot) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "loaded cached front-back graph for ask",
        metadata: {
          linkCount: frontBackGraphSnapshot.links.length,
          frontendWorkspaces: frontBackGraphSnapshot.meta.frontendWorkspaceDirs.length
        }
      });
    }

    const expandedQueries = buildAskQueryCandidates({
      question,
      strategy: strategyDecision.strategy,
      targetSymbols: strategyDecision.targetSymbols,
      moduleCandidates: strategyDecision.moduleCandidates,
      domainPacks: effectiveDomainPacks,
      questionTags: questionCapabilityTags
    });
    const searchResults: ProjectSearchResult[] = [];
    for (const [index, expandedQuery] of expandedQueries.entries()) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: `retrieval query ${index + 1}/${expandedQueries.length} started`,
        metadata: {
          query: expandedQuery
        }
      });
      const result = await searchServerProject({
        projectId: options.projectId,
        query: expandedQuery,
        limit: options.limit ?? 14
      });
      searchResults.push(result);

      const topConfidence = result.hits[0] ? normalizeHitConfidence(result.hits[0]) : 0;
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: `retrieval query ${index + 1}/${expandedQueries.length} finished`,
        metadata: {
          provider: result.provider,
          fallbackUsed: result.fallbackUsed,
          hitCount: result.hits.length,
          topConfidence
        }
      });

      if (result.hits.length >= 8 && topConfidence >= 0.72) {
        await appendProjectDebugEvent({
          timestamp: nowIso(),
          projectId: options.projectId,
          stage: "ask",
          status: "info",
          message: "retrieval early-stop: enough high-confidence evidence collected",
          metadata: {
            query: expandedQuery,
            hitCount: result.hits.length,
            topConfidence
          }
        });
        break;
      }
    }

    const mergedHitsMap = new Map<string, ProjectSearchHit>();
    for (const result of searchResults) {
      for (const hit of result.hits) {
        const existing = mergedHitsMap.get(hit.path);
        if (!existing || existing.score < hit.score) {
          mergedHitsMap.set(hit.path, hit);
        }
      }
    }
    const askFocusTokens = buildAskFocusTokens(question);
    const mergedHits = Array.from(mergedHitsMap.values())
      .sort((a, b) => {
        const aScore = scoreAskHitRelevance({
          hit: a,
          question,
          strategy: strategyDecision.strategy,
          moduleCandidates: strategyDecision.moduleCandidates,
          focusTokens: askFocusTokens
        });
        const bScore = scoreAskHitRelevance({
          hit: b,
          question,
          strategy: strategyDecision.strategy,
          moduleCandidates: strategyDecision.moduleCandidates,
          focusTokens: askFocusTokens
        });
        return bScore !== aScore ? bScore - aScore : a.path.localeCompare(b.path);
      })
      .slice(0, options.limit ?? 14);
    const mergedCodeHits = mergedHits.filter((hit) => CODE_FILE_EXTENSIONS.has(path.extname(hit.path).toLowerCase()));
    const hydratedEvidence = await hydrateAskEvidence({
      project,
      question,
      strategy: strategyDecision.strategy,
      targetSymbols: strategyDecision.targetSymbols,
      moduleCandidates: strategyDecision.moduleCandidates,
      hits: intent.methodFocused && mergedCodeHits.length > 0 ? mergedCodeHits : mergedHits,
      structure: structureSnapshot
    });
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "ask",
      status: "info",
      message: "hydrated ask evidence prepared",
      metadata: {
        evidenceCount: hydratedEvidence.length,
        codeEvidenceCount: hydratedEvidence.filter((item) => item.codeFile).length,
        moduleEvidenceCount: hydratedEvidence.filter((item) => item.moduleMatched).length
      }
    });

    const linkedEaiEvidence = buildLinkedEaiEvidence({
      question,
      moduleCandidates: strategyDecision.moduleCandidates,
      hydratedEvidence,
      hits: mergedHits.map((hit) => ({
        path: hit.path,
        reason: (hit.reasons ?? []).join(" | "),
        snippet: hit.snippet ?? ""
      })),
      entries: eaiSnapshot?.entries ?? [],
      limit: 6
    });
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "ask",
      status: "info",
      message: "linked eai evidence prepared",
      metadata: {
        count: linkedEaiEvidence.length,
        topInterfaces: linkedEaiEvidence.slice(0, 3).map((item) => item.interfaceId)
      }
    });
    const linkedFlowEvidence = frontBackGraphSnapshot
      ? buildLinkedFlowEvidence({
          question,
          questionTags: questionCapabilityTags,
          hits: mergedHits.map((hit) => ({
            path: hit.path,
            score: hit.score,
            reasons: hit.reasons
          })),
          snapshot: frontBackGraphSnapshot,
          limit: 10,
          domainPacks: effectiveDomainPacks
        })
      : [];
    if (linkedFlowEvidence.length > 0) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "linked front-back flow evidence prepared",
        metadata: {
          count: linkedFlowEvidence.length,
          topRoutes: linkedFlowEvidence.slice(0, 3).map((item) => item.routePath ?? item.screenCode ?? item.apiUrl)
        }
      });
    }
    const crossLayerFlowQuestion = isCrossLayerFlowQuestion(question);
    const downstreamFlowTraces =
      crossLayerFlowQuestion && linkedFlowEvidence.length > 0
        ? await traceLinkedFlowDownstream({
            workspaceDir: project.workspaceDir,
            linkedFlowEvidence,
            structure: structureSnapshot
              ? {
                  entries: structureSnapshot.entries
                }
              : undefined
          })
        : [];
    if (downstreamFlowTraces.length > 0) {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: "downstream service trace prepared",
        metadata: {
          count: downstreamFlowTraces.length,
          phases: downstreamFlowTraces.map((item) => item.phase)
        }
      });
    }

    const bestSearch =
      [...searchResults].sort((a, b) => {
        const aTop = a.hits[0]?.score ?? 0;
        const bTop = b.hits[0]?.score ?? 0;
        const aWeight = (a.provider === "qmd" ? 4 : 0) + (a.fallbackUsed ? 0 : 1);
        const bWeight = (b.provider === "qmd" ? 4 : 0) + (b.fallbackUsed ? 0 : 1);
        return bTop + bWeight - (aTop + aWeight);
      })[0] ?? searchResults[0]!;
    const lowConfidenceMode =
      mergedHits.length === 0 || normalizeHitConfidence(mergedHits[0]) < 0.45;

    const memoryMarkdownFiles = await collectMemoryMarkdownFiles(memoryRoot, 240);
    const selectedMemoryFiles = selectAskMemoryFiles(memoryMarkdownFiles, intent);
    const memoryPreview: Array<{ path: string; content: string }> = [];
    for (const relativePath of selectedMemoryFiles) {
      const absolutePath = path.resolve(memoryRoot, relativePath);
      const content = await readTextFileSafe(absolutePath);
      if (!content) {
        continue;
      }
      memoryPreview.push({
        path: relativePath,
        content
      });
    }

    const qualityFailures: string[] = [];

    let bestOutput: z.infer<typeof ProjectAskOutputSchema> = crossLayerFlowQuestion && linkedFlowEvidence.length > 0
      ? buildDeterministicFlowAnswer({
          question,
          questionTags: questionCapabilityTags,
          linkedFlowEvidence,
          downstreamTraces: downstreamFlowTraces
        })
      : {
          answer:
            "충분한 근거를 확보하지 못해 확정 답변을 제공하기 어렵습니다. 재색인 후 다시 질의하세요.",
          confidence: 0.2,
          evidence: [],
          caveats: ["low-evidence"]
        };
    let attempts = 0;
    let usedFallback = false;
    let passed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      const priorFailures = qualityFailures.slice(-8);
      const sourceHits =
        (intent.methodFocused || intent.moduleFlowFocused) && mergedCodeHits.length > 0
          ? [...mergedCodeHits, ...mergedHits.filter((hit) => !mergedCodeHits.includes(hit)).slice(0, 2)]
          : mergedHits;
      const llmMergedHits = sourceHits.map((hit) => ({
        path: hit.path,
        score: hit.score,
        confidence: normalizeHitConfidence(hit),
        reasons: (hit.reasons ?? []).slice(0, 3),
        snippet: hit.snippet ?? ""
      }));
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: `ask prompt prepared (attempt ${attempt}/${maxAttempts})`,
        metadata: {
          memoryFiles: memoryPreview.length,
          memoryChars: memoryPreview.reduce((sum, item) => sum + item.content.length, 0),
          retrievalHits: llmMergedHits.length,
          retrievalChars: JSON.stringify(llmMergedHits).length,
          hydratedEvidenceCount: hydratedEvidence.length,
          linkedEaiEvidenceCount: linkedEaiEvidence.length,
          linkedFlowEvidenceCount: linkedFlowEvidence.length,
          downstreamTraceCount: downstreamFlowTraces.length
        }
      });
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: `llm answer generation attempt ${attempt}/${maxAttempts} started`,
        metadata: {
          priorFailures
        }
      });
      const attemptStartedAt = Date.now();
      const generation = await llm.generateStructured({
        systemPrompt: [
          "You are a strict project Q&A engine for implementation logic.",
          "Return ONLY one JSON object.",
          "Use only provided evidence, never fabricate.",
          "For logic questions, prefer code-level evidence over XML-only evidence.",
          "If linkedEaiEvidence is present, prefer those interfaces over unrelated XML-only candidates and cite the interfaceId explicitly.",
          "If linkedFlowEvidence is present for a cross-layer question, explicitly connect frontend screen/route -> API URL -> gateway/controller -> service.",
          "If confidence is low, explicitly say uncertainty and missing coverage.",
          "If hydratedEvidence contains callee:* method blocks, use at least one of them in the answer when explaining the internal flow."
        ].join("\n"),
        userPrompt: JSON.stringify(
          {
            task: "Answer user question using project analysis memory + retrieval evidence.",
            outputSchema: {
              answer: "string",
              confidence: "0..1",
              evidence: ["string with file path and why"],
              caveats: ["string"]
            },
            question,
            qualityGateContext: {
              attempt,
              priorFailures,
              lowConfidenceMode,
              requireCodeEvidence: /(로직|흐름|어떻게|구현|처리|service|controller|domain)/i.test(question),
              requireModuleEvidence: strategyDecision.moduleCandidates.length > 0,
              moduleCandidates: strategyDecision.moduleCandidates,
              requireCrossLayerFlow: crossLayerFlowQuestion,
              domainSelectionMode: domainSelection.mode,
              matchedDomains: domainSelection.matchedDomains.map((item) => item.id),
              lockedDomains: domainSelection.lockedDomainIds,
              effectiveDomains: effectiveDomainPacks.map((item) => item.id)
            },
            projectAnalysis: {
              summary: analysis.summary,
              architecture: analysis.architecture,
              keyModules: analysis.keyModules,
              confidence: analysis.confidence,
              risks: analysis.risks,
              projectPreset: analysis.projectPreset ?? null,
              eaiCatalog: analysis.eaiCatalog ?? null,
              structureCatalog: analysis.structureCatalog ?? null
            },
            retrieval: {
              provider: bestSearch.provider,
              fallbackUsed: bestSearch.fallbackUsed,
              mergedHits: llmMergedHits
            },
            hydratedEvidence,
            linkedEaiEvidence,
            linkedFlowEvidence,
            downstreamFlowTraces,
            memory: memoryPreview,
            instruction:
              intent.methodFocused
                ? "메서드/호출흐름 질문입니다. 코드 파일 근거와 호출 순서를 우선 설명하세요."
                : crossLayerFlowQuestion
                ? "프론트-백엔드 통합 추적 질문입니다. 반드시 frontend screen/route -> /gw/api URL -> gateway/controller -> backend controller/service 순서로 설명하고, linkedFlowEvidence의 route/api/controllerMethod를 직접 언급하세요. 질문의 업무 capability(예: 보험금 청구)와 맞는 flow만 사용하고, 인접 업무 플로우로 대체하지 마세요."
                : intent.moduleFlowFocused
                ? "모듈 내부 탑다운 실행흐름 질문입니다. 반드시 moduleCandidates 범위 안에서 Entry point -> Controller -> Service method -> downstream(EAI/DAO/async) 순서로 설명하고, hydratedEvidence의 callee:* 서비스 메서드가 있으면 최소 1개 이상 직접 언급하세요. linkedEaiEvidence가 있으면 해당 interfaceId와 인터페이스명을 직접 연결해서 설명하세요. 확정 근거와 추정 범위를 분리하세요."
                : lowConfidenceMode
                ? "검색 confidence가 낮으므로 누락 가능성을 명확히 경고하고, 확정/추정 범위를 분리하세요."
                : "근거 중심으로 구체적으로 답변하세요."
          },
          null,
          2
        ),
        fallback: bestOutput,
        parse: (value) => ProjectAskOutputSchema.parse(value)
      });

      usedFallback ||= generation.usedFallback;
      llmCallCount += generation.liveCallCount;
      bestOutput = generation.output;
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "ask",
        status: "info",
        message: `llm answer generation attempt ${attempt}/${maxAttempts} finished`,
        metadata: {
          confidence: generation.output.confidence,
          usedFallback: generation.usedFallback,
          liveCallCount: generation.liveCallCount,
          tookMs: Date.now() - attemptStartedAt
        }
      });

      const gate = qualityGateForAsk({
        output: bestOutput,
        question,
        hits: mergedHits,
        strategy: strategyDecision.strategy,
        hydratedEvidence,
        linkedEaiEvidence,
        linkedFlowEvidence,
        moduleCandidates: strategyDecision.moduleCandidates,
        domainPacks: effectiveDomainPacks,
        questionTags: questionCapabilityTags
      });
      if (gate.passed) {
        passed = true;
        break;
      }

      qualityFailures.push(...gate.failures);
    }

    const reportLines: string[] = [
      `# Query Report`,
      ``,
      `- projectId: ${project.id}`,
      `- projectName: ${project.name}`,
      `- askedAt: ${nowIso()}`,
      `- question: ${question}`,
      `- strategy: ${strategyDecision.strategy}`,
      `- strategyConfidence: ${strategyDecision.confidence.toFixed(2)}`,
      `- domainSelectionMode: ${domainSelection.mode}`,
      `- activeDomains: ${activeDomainPacks.map((item) => item.id).join(", ") || "(none)"}`,
      `- matchedDomains: ${domainSelection.matchedDomains.map((item) => item.id).join(", ") || "(none)"}`,
      `- lockedDomains: ${domainSelection.lockedDomainIds.join(", ") || "(none)"}`,
      `- effectiveDomains: ${effectiveDomainPacks.map((item) => item.id).join(", ") || "(none)"}`,
      `- moduleCandidates: ${
        strategyDecision.moduleCandidates.length > 0 ? strategyDecision.moduleCandidates.join(", ") : "(none)"
      }`,
      `- confidence: ${bestOutput.confidence.toFixed(2)}`,
      `- qualityGatePassed: ${passed}`,
      `- attempts: ${attempts}`,
      ``,
      `## Answer`,
      bestOutput.answer,
      ``,
      `## Evidence`
    ];
    for (const line of bestOutput.evidence) {
      reportLines.push(`- ${line}`);
    }
    reportLines.push("", "## Caveats");
    for (const line of bestOutput.caveats) {
      reportLines.push(`- ${line}`);
    }
    reportLines.push("", "## Retrieval");
    reportLines.push(`- provider=${bestSearch.provider}`);
    reportLines.push(`- fallback=${bestSearch.fallbackUsed}`);
    reportLines.push(`- hitCount=${mergedHits.length}`);
    reportLines.push(`- topConfidence=${(mergedHits[0] ? normalizeHitConfidence(mergedHits[0]) : 0).toFixed(2)}`);
    if (linkedEaiEvidence.length > 0) {
      reportLines.push("", "## Linked EAI Evidence");
      for (const item of linkedEaiEvidence.slice(0, 6)) {
        reportLines.push(
          `- ${item.interfaceId} | ${item.interfaceName} | score=${item.score} | reasons=${item.reasons.join(", ") || "(none)"}`
        );
      }
    }
    if (linkedFlowEvidence.length > 0) {
      reportLines.push("", "## Linked Front-Back Flow Evidence");
      for (const item of linkedFlowEvidence.slice(0, 6)) {
        reportLines.push(
          `- ${item.screenCode ?? item.routePath ?? "(unknown screen)"} | ${item.apiUrl}${item.gatewayControllerMethod ? ` -> ${item.gatewayControllerMethod}` : ""} -> ${item.backendControllerMethod} (${item.backendPath}) | capabilities=${(item.capabilityTags ?? []).join(", ") || "(none)"} | reasons=${item.reasons.join(", ") || "(none)"}`
        );
      }
    }
    if (downstreamFlowTraces.length > 0) {
      reportLines.push("", "## Downstream Service Traces");
      for (const trace of downstreamFlowTraces.slice(0, 6)) {
        reportLines.push(
          `- ${trace.phase} | ${trace.serviceMethod} | ${trace.steps.slice(0, 5).join(" -> ")}${trace.eaiInterfaces.length > 0 ? ` | eai=${trace.eaiInterfaces.join(", ")}` : ""}`
        );
      }
    }
    reportLines.push("");

    const queryReportFiles = await writeMemoryDocs({
      memoryRoot,
      groupDir: QUERY_MEMORY_DIR,
      latestFileName: "latest.md",
      content: `${reportLines.join("\n")}\n`
    });

    const response: ProjectAskResponse = {
      project,
      question,
      answer: bestOutput.answer,
      confidence: bestOutput.confidence,
      qualityGatePassed: passed,
      attempts,
      evidence: bestOutput.evidence,
      caveats: bestOutput.caveats,
      retrieval: {
        provider: bestSearch.provider,
        fallbackUsed: bestSearch.fallbackUsed,
        hitCount: mergedHits.length,
        topConfidence: mergedHits[0] ? normalizeHitConfidence(mergedHits[0]) : 0
      },
      diagnostics: {
        lowConfidenceMode,
        qualityGateFailures: unique(qualityFailures),
        usedFallback: usedFallback || strategyUsedFallback,
        llmCallCount,
        llmCallBudget,
        strategyType: strategyDecision.strategy,
        strategyConfidence: strategyDecision.confidence,
        strategyLlmUsed: strategyDecision.llmUsed,
        strategyReason: strategyDecision.reason,
        domainSelectionMode: domainSelection.mode,
        activeDomainIds: activeDomainPacks.map((item) => item.id),
        matchedDomainIds: domainSelection.matchedDomains.map((item) => item.id),
        lockedDomainIds: domainSelection.lockedDomainIds,
        scopeModules: strategyDecision.moduleCandidates,
        hydratedEvidenceCount: hydratedEvidence.length,
        linkedEaiEvidenceCount: linkedEaiEvidence.length,
        downstreamTraceCount: downstreamFlowTraces.length,
        frontBackGraphLoaded: Boolean(frontBackGraphSnapshot),
        frontBackLinkCount: frontBackGraphSnapshot?.links.length ?? 0,
        frontBackEvidenceUsedCount: linkedFlowEvidence.length,
        memoryFiles: [
          analysis.memoryFiles[0],
          analysis.memoryFiles[1],
          queryReportFiles.latestPath,
          queryReportFiles.snapshotPath
        ]
      }
    };

    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "ask",
      status: "success",
      message: "project ask completed",
      metadata: {
        confidence: response.confidence,
        qualityGatePassed: response.qualityGatePassed,
        attempts: response.attempts,
        hitCount: response.retrieval.hitCount,
        llmCallCount: response.diagnostics.llmCallCount,
        strategy: response.diagnostics.strategyType,
        moduleCandidates: response.diagnostics.scopeModules,
        hydratedEvidenceCount: response.diagnostics.hydratedEvidenceCount
      }
    });

    return response;
  } catch (error) {
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "ask",
      status: "failure",
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export async function searchServerProject(options: {
  projectId: string;
  query: string;
  limit?: number;
  queryMode?: "query_then_search" | "search_only" | "query_only";
  maxFiles?: number;
}): Promise<ProjectSearchResult> {
  await appendProjectDebugEvent({
    timestamp: nowIso(),
    projectId: options.projectId,
    stage: "search",
    status: "start",
    message: "project search started",
    metadata: {
      query: options.query,
      limit: options.limit
    }
  });

  try {
    const project = await getServerProject(options.projectId);
    if (!project) {
      throw new Error(`project not found: ${options.projectId}`);
    }

    const query = String(options.query || "").trim();
    if (!query) {
      throw new Error("query is required");
    }

    const limit = Math.max(1, Math.min(200, options.limit ?? 20));

    const qmdOverrides = options.queryMode
      ? {
          qmd: {
            queryMode: options.queryMode
          }
        }
      : undefined;

    const retrievalOverrides = {
      ...(project.retrieval ?? {}),
      ...(qmdOverrides ?? {}),
      qmd: {
        ...(project.retrieval?.qmd ?? {}),
        ...(qmdOverrides?.qmd ?? {})
      }
    };

    const llmContext = await resolveProjectLlmContext(project);
    const retrievalConfig = await resolveRetrievalConfig(
      project.workspaceDir,
      mergeRetrievalWithModelCaps(retrievalOverrides, llmContext.stageTokenCaps)
    );
    const files = await collectProjectFiles(project.workspaceDir, options.maxFiles ?? DEFAULT_PROJECT_MAX_FILES);

    if (retrievalConfig.qmd.enabled) {
      try {
        const qmdResult = await runQmdMultiCorpusSearch({
          cwd: project.workspaceDir,
          signals: {
            task: query
          },
          config: retrievalConfig.qmd,
          timeoutMs: retrievalConfig.timeoutMs.qmd,
          limit
        });
        const qmdQueries = qmdResult.queriesTried;
        const usedQmdQuery = qmdResult.corpusResults.find((entry) => entry.status === "ok")?.query ?? "";
        const qmdIndexMethods = unique(
          qmdResult.corpusResults.map((entry) => entry.indexMethod ?? "").filter(Boolean)
        );

        if (qmdResult.status === "ok") {
          const existingQmdHits: ProjectSearchHit[] = [];
          const missingQmdPaths: string[] = [];
          for (const hit of qmdResult.hits) {
            if (isRetrievalNoisePath(hit.path)) {
              continue;
            }
            const exists = await fileExistsUnderWorkspace(project.workspaceDir, hit.path);
            if (!exists) {
              missingQmdPaths.push(hit.path);
              continue;
            }

            existingQmdHits.push({
              path: hit.path,
              score: hit.score,
              source: "qmd",
              reasons: unique([
                hit.docid ? `docid=${hit.docid}` : "",
                hit.title ? `title=${hit.title}` : "",
                hit.context ? `context=${hit.context}` : "",
                hit.snippet ? `snippet=${hit.snippet.split("\n")[0]?.slice(0, 120)}` : ""
              ]),
              title: hit.title,
              snippet: hit.snippet
            });
          }

          if (existingQmdHits.length === 0) {
            const lexicalHits = await lexicalSearch({
              workspaceDir: project.workspaceDir,
              files,
              query,
              limit
            });
            const response: ProjectSearchResult = {
              project,
              query,
              provider: "lexical",
              fallbackUsed: true,
              hits: lexicalHits,
              diagnostics: {
                qmdStatus: "empty",
                qmdErrors: [
                  `qmd hits were stale and missing on disk: ${missingQmdPaths.slice(0, 5).join(", ")}`
                ],
                qmdIndexMethod: qmdIndexMethods[0] as "add" | "update" | "cached" | undefined,
                qmdQueryMode: qmdResult.queryMode,
                qmdQuery: usedQmdQuery,
                qmdQueriesTried: qmdQueries,
                qmdCommand: retrievalConfig.qmd.command,
                qmdCorporaTried: qmdResult.corporaTried,
                qmdCorpusResults: qmdResult.corpusResults,
                fileCount: files.length
              }
            };
            await appendProjectDebugEvent({
              timestamp: nowIso(),
              projectId: options.projectId,
              stage: "search",
              status: "info",
              message: "qmd returned stale paths only; fallback to lexical",
              metadata: {
                staleCount: missingQmdPaths.length,
                hitCount: response.hits.length,
                corporaTried: qmdResult.corporaTried
              }
            });
            return response;
          }

          const response: ProjectSearchResult = {
            project,
            query,
            provider: "qmd",
            fallbackUsed: false,
            modeUsed: qmdResult.mode,
            hits: existingQmdHits,
            diagnostics: {
              qmdStatus: qmdResult.status,
              qmdErrors: unique([
                ...qmdResult.errors,
                missingQmdPaths.length > 0
                  ? `stale-path-filtered=${missingQmdPaths.slice(0, 5).join(",")}`
                  : ""
              ]),
              qmdIndexMethod: qmdIndexMethods[0] as "add" | "update" | "cached" | undefined,
              qmdQueryMode: qmdResult.queryMode,
              qmdQuery: usedQmdQuery,
              qmdQueriesTried: qmdQueries,
              qmdCommand: retrievalConfig.qmd.command,
              qmdCorporaTried: qmdResult.corporaTried,
              qmdCorpusResults: qmdResult.corpusResults,
              fileCount: files.length
            }
          };
          await appendProjectDebugEvent({
            timestamp: nowIso(),
            projectId: options.projectId,
            stage: "search",
            status: "success",
            message: "qmd search succeeded",
            metadata: {
              provider: "qmd",
              hitCount: response.hits.length,
              mode: response.modeUsed,
              query: usedQmdQuery,
              corporaTried: qmdResult.corporaTried
            }
          });
          return response;
        }

        const lexicalHits = await lexicalSearch({
          workspaceDir: project.workspaceDir,
          files,
          query,
          limit
        });

        const response: ProjectSearchResult = {
          project,
          query,
          provider: "lexical",
          fallbackUsed: true,
          hits: lexicalHits,
          diagnostics: {
            qmdStatus: qmdResult.status,
            qmdErrors: qmdResult.errors,
            qmdIndexMethod: qmdIndexMethods[0] as "add" | "update" | "cached" | undefined,
            qmdQueryMode: qmdResult.queryMode,
            qmdQuery: usedQmdQuery,
            qmdQueriesTried: qmdQueries,
            qmdCommand: retrievalConfig.qmd.command,
            qmdCorporaTried: qmdResult.corporaTried,
            qmdCorpusResults: qmdResult.corpusResults,
            fileCount: files.length
          }
        };
        await appendProjectDebugEvent({
          timestamp: nowIso(),
          projectId: options.projectId,
          stage: "search",
          status: "info",
          message: "qmd empty/failed; lexical fallback used",
          metadata: {
            qmdStatus: qmdResult.status,
            qmdErrors: qmdResult.errors.slice(0, 3),
            qmdQueriesTried: qmdQueries,
            corporaTried: qmdResult.corporaTried,
            hitCount: response.hits.length
          }
        });
        return response;
      } catch (error) {
        const lexicalHits = await lexicalSearch({
          workspaceDir: project.workspaceDir,
          files,
          query,
          limit
        });

        const response: ProjectSearchResult = {
          project,
          query,
          provider: "lexical",
          fallbackUsed: true,
          hits: lexicalHits,
          diagnostics: {
            qmdStatus: "failed",
            qmdErrors: [error instanceof Error ? error.message : String(error)],
            qmdQueriesTried: [],
            qmdCommand: retrievalConfig.qmd.command,
            fileCount: files.length
          }
        };
        await appendProjectDebugEvent({
          timestamp: nowIso(),
          projectId: options.projectId,
          stage: "search",
          status: "failure",
          message: `qmd search error, lexical fallback used: ${error instanceof Error ? error.message : String(error)}`,
          metadata: {
            hitCount: response.hits.length
          }
        });
        return response;
      }
    }

    const lexicalHits = await lexicalSearch({
      workspaceDir: project.workspaceDir,
      files,
      query,
      limit
    });

    const response: ProjectSearchResult = {
      project,
      query,
      provider: "lexical",
      fallbackUsed: false,
      hits: lexicalHits,
      diagnostics: {
        qmdStatus: "skipped",
        fileCount: files.length
      }
    };
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "search",
      status: "success",
      message: "lexical search used (qmd disabled)",
      metadata: {
        hitCount: response.hits.length
      }
    });
    return response;
  } catch (error) {
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "search",
      status: "failure",
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
