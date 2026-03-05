import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AnalyzeInput,
  AnalyzeInputSchema,
  AttemptCheckpoint,
  ContextTier,
  FailureSummary,
  ImplementOutput,
  ImplementOutputSchema,
  PlanOutput,
  PlanOutputSchema,
  RuntimeSnapshot,
  RuntimeState,
  RunManifest,
  VerifyOutput,
  VerifyOutputSchema
} from "../core/types.js";
import { RuntimeStateMachine } from "../core/state-machine.js";
import { inspectContext, packContext, persistPackedContext } from "../context/packer.js";
import {
  appendFailureSummary,
  failed,
  finalizeVerifyOutput,
  listVerifyProfiles,
  runQualityGates,
  summarizeFailures
} from "../gates/verify.js";
import { runObjectiveContractGate } from "../gates/objective-contract.js";
import { LlmClient, OpenAICompatibleLlmClient } from "../llm/client.js";
import { resolveModePolicy } from "../modes/policies.js";
import {
  acquireRunLock,
  appendTransition,
  createInitialManifest,
  ensureRunArtifacts,
  loadManifest,
  readOutput,
  releaseRunLock,
  resolveRunArtifacts,
  RunArtifacts,
  saveManifest,
  updateManifest,
  writeOutput,
  writePrompt
} from "./run-state.js";
import {
  executeImplementationActions,
  PatchTransaction,
  rollbackTransaction
} from "../tools/executor.js";
import { PluginManager } from "../plugins/manager.js";
import { PluginContribution } from "../core/types.js";

const PATCH_STRATEGIES: Array<{ name: string; tier: ContextTier }> = [
  { name: "focused-fix", tier: "small" },
  { name: "wider-context", tier: "mid" },
  { name: "broad-recovery", tier: "big" }
];

export interface RunLoopEvent {
  kind: "transition" | "progress";
  runId: string;
  state: RuntimeState;
  reason: string;
  patchAttempts: number;
  strategy: string;
  timestamp: string;
}

export interface RunLoopResult {
  runId: string;
  artifactDir: string;
  finalState: RuntimeSnapshot["state"];
  snapshot: RuntimeSnapshot;
  failed: boolean;
  failureSummary?: string;
  persistedArtifacts: string[];
}

export interface RunLoopOptions {
  runId?: string;
  cwd?: string;
  resume?: boolean;
  llmClient?: LlmClient;
  onEvent?: (event: RunLoopEvent) => Promise<void> | void;
  dryRun?: boolean;
}

function makeRunId(): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function strategyIndexForTier(tier: ContextTier): number {
  const index = PATCH_STRATEGIES.findIndex((entry) => entry.tier === tier);
  return index >= 0 ? index : 0;
}

function inferGateProfileFromObjective(objective: string): string | undefined {
  const normalized = objective.toLowerCase();
  if (/\bgradle\b|gradlew/.test(normalized)) {
    return "gradle";
  }

  if (/\bmaven\b|\bmvn\b/.test(normalized)) {
    return "maven";
  }

  if (/spring\s*boot|springboot|\bjava\b/.test(normalized)) {
    return "maven";
  }

  return undefined;
}

function normalizeLibraryTokens(list?: string[]): string[] {
  if (!Array.isArray(list)) {
    return [];
  }

  return unique(
    list
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.toLowerCase())
  );
}

const DEFAULT_AVAILABLE_LIBRARY_FILES = [
  ".ohmyqwen/available-libraries.json",
  ".ohmyqwen/available-libraries.txt",
  "config/available-libraries.json",
  "config/available-libraries.txt",
  "available-libraries.json",
  "available-libraries.txt"
];

function parseLibraryListFromUnknown(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is string => typeof entry === "string");
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const fromKeys = [record.availableLibraries, record.libraries, record.items];
  for (const value of fromKeys) {
    if (Array.isArray(value)) {
      const mapped = value
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (entry && typeof entry === "object") {
            const name = (entry as Record<string, unknown>).name;
            return typeof name === "string" ? name : "";
          }
          return "";
        })
        .filter(Boolean);
      if (mapped.length > 0) {
        return mapped;
      }
    }
  }

  return [];
}

function parseLibrariesFromText(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return parseLibraryListFromUnknown(JSON.parse(trimmed));
    } catch {
      // fallback to line parser
    }
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.replace(/,$/, "").trim())
    .filter(Boolean);
}

async function findAvailableLibrariesFile(
  cwd: string,
  explicitPath?: string
): Promise<string | undefined> {
  const candidates = explicitPath
    ? [path.isAbsolute(explicitPath) ? explicitPath : path.resolve(cwd, explicitPath)]
    : DEFAULT_AVAILABLE_LIBRARY_FILES.map((entry) => path.resolve(cwd, entry));

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

async function loadAvailableLibrariesFromFile(options: {
  cwd: string;
  explicitPath?: string;
}): Promise<{ libraries: string[]; source?: string; notes: string[] }> {
  const notes: string[] = [];
  const foundFile = await findAvailableLibrariesFile(options.cwd, options.explicitPath);
  if (!foundFile) {
    return { libraries: [], notes };
  }

  try {
    const raw = await fs.readFile(foundFile, "utf8");
    const libraries = normalizeLibraryTokens(parseLibrariesFromText(raw));
    if (libraries.length === 0) {
      notes.push(`available library file is empty: ${foundFile}`);
      return { libraries: [], source: foundFile, notes };
    }
    return { libraries, source: foundFile, notes };
  } catch (error) {
    notes.push(
      `failed to read available library file (${foundFile}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return { libraries: [], source: foundFile, notes };
  }
}

async function fetchAvailableLibrariesFromUrl(
  url: string
): Promise<{ libraries: string[]; notes: string[] }> {
  const notes: string[] = [];

  try {
    const response = await fetch(url);
    if (!response.ok) {
      notes.push(`available library URL fetch failed: status=${response.status}`);
      return { libraries: [], notes };
    }

    const raw = await response.text();
    const libraries = normalizeLibraryTokens(parseLibrariesFromText(raw));
    if (libraries.length === 0) {
      notes.push("available library URL returned empty payload");
      return { libraries: [], notes };
    }

    return { libraries, notes };
  } catch (error) {
    notes.push(`available library URL fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return { libraries: [], notes };
  }
}

async function resolveAvailableLibraries(
  input: AnalyzeInput,
  cwd: string
): Promise<{ libraries: string[]; notes: string[] }> {
  const notes: string[] = [];
  const direct = normalizeLibraryTokens(input.availableLibraries);
  if (direct.length > 0) {
    return { libraries: direct, notes: ["available libraries loaded from input"] };
  }

  const fromFile = await loadAvailableLibrariesFromFile({
    cwd,
    explicitPath: input.availableLibrariesFile
  });
  notes.push(...fromFile.notes);
  if (fromFile.libraries.length > 0) {
    notes.push(`available libraries loaded from file: ${fromFile.source}`);
    return { libraries: fromFile.libraries, notes };
  }

  const fallbackUrl =
    input.availableLibrariesUrl?.trim() ||
    process.env.OHMYQWEN_AVAILABLE_LIBRARIES_URL?.trim() ||
    process.env.OHMYQWEN_LIBRARY_INDEX_URL?.trim();
  if (fallbackUrl) {
    const fromUrl = await fetchAvailableLibrariesFromUrl(fallbackUrl);
    notes.push(...fromUrl.notes);
    if (fromUrl.libraries.length > 0) {
      notes.push(`available libraries loaded from URL: ${fallbackUrl}`);
      return { libraries: fromUrl.libraries, notes };
    }
  }

  notes.push("available library source not found; skipping allowlist");
  return { libraries: [], notes };
}

function extractObjectiveDependencyTokens(objective: string): string[] {
  const normalized = objective.toLowerCase();
  const hits: string[] = [];

  if (/\bexpress\b/.test(normalized)) {
    hits.push("express");
  }
  if (/spring\s*boot|springboot/.test(normalized)) {
    hits.push("spring-boot-starter-web");
  }
  if (/\bjpa\b|spring-data-jpa|hibernate/.test(normalized)) {
    hits.push("spring-boot-starter-data-jpa");
  }
  if (/\bh2\b|h2db|h2 db/.test(normalized)) {
    hits.push("com.h2database:h2");
  }

  return unique(hits);
}

function libraryTokenMatches(token: string, candidate: string): boolean {
  const normalizedToken = token.trim().toLowerCase();
  const normalizedCandidate = candidate.trim().toLowerCase();
  if (!normalizedToken || !normalizedCandidate) {
    return false;
  }

  if (normalizedToken === normalizedCandidate) {
    return true;
  }

  if (normalizedToken.endsWith(`:${normalizedCandidate}`)) {
    return true;
  }

  if (normalizedCandidate.endsWith(`:${normalizedToken}`)) {
    return true;
  }

  return false;
}

function tuneAnalyzeInput(
  input: AnalyzeInput,
  options?: { availableLibraries?: string[]; notes?: string[] }
): { tuned: AnalyzeInput; notes: string[] } {
  const availableLibraries = normalizeLibraryTokens(options?.availableLibraries ?? input.availableLibraries);
  const notes: string[] = [...(options?.notes ?? [])];

  const constraints = [...input.constraints];
  if (availableLibraries.length > 0 && !constraints.includes("dependency-allowlist-only")) {
    constraints.push("dependency-allowlist-only");
    notes.push(`dependency allowlist enabled (${availableLibraries.length})`);
  }

  const requestedLibraries = extractObjectiveDependencyTokens(input.objective);
  const unavailable = requestedLibraries.filter(
    (required) => !availableLibraries.some((candidate) => libraryTokenMatches(candidate, required))
  );

  const errorLogs = [...input.errorLogs];
  if (availableLibraries.length > 0 && unavailable.length > 0) {
    const summary = `objective-requested libraries not in allowlist: ${unavailable.join(", ")}`;
    errorLogs.unshift(summary);
    notes.push(`allowlist mismatch detected (${unavailable.join(", ")})`);
  }

  return {
    tuned: {
      ...input,
      availableLibraries,
      constraints: unique(constraints),
      errorLogs: unique(errorLogs).slice(0, 20)
    },
    notes
  };
}

function findAttempt(manifest: RunManifest, attempt: number): AttemptCheckpoint | undefined {
  return manifest.checkpoints.attempts.find((entry) => entry.attempt === attempt);
}

async function upsertAttempt(
  artifacts: RunArtifacts,
  manifest: RunManifest,
  payload: AttemptCheckpoint
): Promise<RunManifest> {
  const attempts = manifest.checkpoints.attempts.filter((entry) => entry.attempt !== payload.attempt);
  attempts.push(payload);
  attempts.sort((a, b) => a.attempt - b.attempt);

  return updateManifest(artifacts, manifest, {
    checkpoints: {
      ...manifest.checkpoints,
      attempts
    }
  });
}

function buildPatchFailurePrompt(
  verifyOutput: VerifyOutput | undefined,
  fallback: string
): { summary: string; relatedFiles: string[]; instruction: string } {
  const failureSummary = verifyOutput?.failureSummary;
  if (!failureSummary) {
    return {
      summary: fallback,
      relatedFiles: [],
      instruction: "Apply minimal patch only to directly related files and avoid unrelated refactors"
    };
  }

  return {
    summary: [failureSummary.category, ...failureSummary.coreLines].join(" | "),
    relatedFiles: failureSummary.relatedFiles,
    instruction: failureSummary.recommendation
  };
}

function summarizeActionFailureLines(lines: string[]): { coreLines: string[]; relatedFiles: string[] } {
  const coreLines = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  const relatedFiles = Array.from(
    new Set(
      coreLines.flatMap((line) => line.match(/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md)/g) ?? [])
    )
  ).slice(0, 10);

  return { coreLines, relatedFiles };
}

type ActionFailureKind =
  | "allowlist"
  | "port-in-use"
  | "missing-script"
  | "inline-script-syntax"
  | "jvm-implement-command"
  | "patch-miss"
  | "unknown";

function classifyActionFailure(target: string, details: string): ActionFailureKind {
  const normalized = `${target}\n${details}`.toLowerCase();

  if (normalized.includes("command not allowed") || normalized.includes("args not allowed by allowlist")) {
    return "allowlist";
  }
  if (normalized.includes("eaddrinuse") || normalized.includes("address already in use")) {
    return "port-in-use";
  }
  if (normalized.includes("missing script") || normalized.includes("no_script")) {
    return "missing-script";
  }
  if (normalized.includes("unterminated string constant") || normalized.includes("syntaxerror")) {
    return "inline-script-syntax";
  }
  if (
    /(gradle|\.\/gradlew|mvn|\.\/mvnw)\b/.test(normalized) &&
    (normalized.includes("failed (exit code=") ||
      normalized.includes("permission denied") ||
      normalized.includes("enoent") ||
      normalized.includes("command not found"))
  ) {
    return "jvm-implement-command";
  }
  if (normalized.includes("patch_file could not find target text")) {
    return "patch-miss";
  }

  return "unknown";
}

function recommendationForActionFailureKinds(kinds: ActionFailureKind[]): string {
  const tips: string[] = [];

  if (kinds.includes("allowlist")) {
    tips.push(
      "Use allowlisted commands only (npm/pnpm/node/git/npx/gradle/maven) and avoid raw shell/environment-prefixed forms."
    );
  }
  if (kinds.includes("port-in-use")) {
    tips.push("Avoid long-running server start commands; prefer one-shot CLI verification (node index.js).");
  }
  if (kinds.includes("missing-script")) {
    tips.push("Ensure package.json scripts exist before run_command, or execute direct node command.");
  }
  if (kinds.includes("inline-script-syntax")) {
    tips.push("Do not use complex inline node -e code; write a file and run it directly.");
  }
  if (kinds.includes("jvm-implement-command")) {
    tips.push("For Spring/JVM tasks, avoid running gradle/maven commands in IMPLEMENT; write files first and run gates in VERIFY.");
  }
  if (kinds.includes("patch-miss")) {
    tips.push("Use write_file overwrite strategy when target text is unstable instead of brittle patch_file find strings.");
  }

  if (tips.length === 0) {
    tips.push("Keep actions minimal, workspace-relative, and deterministic.");
  }

  return tips.join(" ");
}

function buildImplementationActionFailureOutput(actionFailures: Array<{ target: string; details: string }>): VerifyOutput {
  const lines = actionFailures.map((failure) => `${failure.target}: ${failure.details}`);
  const details = lines.join("\n");
  const { coreLines, relatedFiles } = summarizeActionFailureLines(lines);
  const kinds = Array.from(
    new Set(actionFailures.map((failure) => classifyActionFailure(failure.target, failure.details)))
  ).sort();
  const signatureInput = ["tooling", ...kinds, ...relatedFiles].join("|");
  const signature = createHash("sha256").update(signatureInput || "tooling-action-failure").digest("hex").slice(0, 16);

  const failureSummary: FailureSummary = {
    category: "tooling",
    signature,
    coreLines,
    relatedFiles,
    recommendation: recommendationForActionFailureKinds(kinds)
  };

  return {
    passed: false,
    gateResults: [
      {
        name: "implement-actions",
        passed: false,
        command: "runtime",
        args: [],
        details: details || "implementation actions failed",
        durationMs: 0,
        category: "tooling"
      }
    ],
    failureSignature: signature,
    failureSummary
  };
}

function firstMeaningfulLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? text.trim()
  );
}

function summarizeRootCause(verifyOutput: VerifyOutput | undefined): string {
  if (!verifyOutput) {
    return "unknown";
  }

  const firstCoreLine = verifyOutput.failureSummary?.coreLines?.find((line) => line.trim().length > 0);
  if (firstCoreLine) {
    return firstCoreLine.trim().slice(0, 220);
  }

  const firstFailingGate = verifyOutput.gateResults.find((gate) => !gate.passed);
  if (!firstFailingGate) {
    return "unknown";
  }

  const detailLine = firstMeaningfulLine(firstFailingGate.details);
  return `${firstFailingGate.name}: ${detailLine}`.slice(0, 220);
}

async function readAnalyzeInputFromArtifacts(artifacts: RunArtifacts): Promise<AnalyzeInput | undefined> {
  const existing = await readOutput<AnalyzeInput>(artifacts, "analyze.input.json");
  if (!existing) {
    return undefined;
  }

  return AnalyzeInputSchema.parse(existing);
}

export async function runLoop(
  rawAnalyzeInput: unknown,
  options?: RunLoopOptions
): Promise<RunLoopResult> {
  const parsed = AnalyzeInputSchema.parse(rawAnalyzeInput);
  const cwd = options?.cwd ?? process.cwd();

  const runId =
    options?.runId ??
    (options?.resume
      ? (() => {
          throw new Error("resume mode requires explicit runId");
        })()
      : makeRunId());

  const artifacts = resolveRunArtifacts(cwd, runId);
  await ensureRunArtifacts(artifacts, Boolean(options?.resume));

  await acquireRunLock(artifacts.lockPath);

  const llm = options?.llmClient ?? new OpenAICompatibleLlmClient();
  const pluginManager = await PluginManager.create(cwd);
  const machine = new RuntimeStateMachine();

  const loadedManifest = await loadManifest(artifacts);
  if (options?.resume && !loadedManifest) {
    await releaseRunLock(artifacts.lockPath);
    throw new Error(`Cannot resume: run manifest not found for runId=${artifacts.runId}`);
  }

  const resumeAnalyzeInput = loadedManifest
    ? await readAnalyzeInputFromArtifacts(artifacts)
    : undefined;
  let manifest: RunManifest;
  let analyzeInput =
    options?.resume && loadedManifest && resumeAnalyzeInput
      ? AnalyzeInputSchema.parse({
          ...resumeAnalyzeInput,
          clarificationAnswers:
            parsed.clarificationAnswers.length > 0
              ? parsed.clarificationAnswers
              : resumeAnalyzeInput.clarificationAnswers
        })
      : parsed;

  const resolvedLibraries = await resolveAvailableLibraries(analyzeInput, cwd);
  const tuning = tuneAnalyzeInput(analyzeInput, {
    availableLibraries: resolvedLibraries.libraries,
    notes: resolvedLibraries.notes
  });
  analyzeInput = tuning.tuned;

  const resolvedMode = resolveModePolicy({
    ...analyzeInput,
    mode: analyzeInput.mode
  });

  if (!loadedManifest) {
    manifest = await createInitialManifest({
      artifacts,
      analyzeInput,
      mode: resolvedMode.mode,
      modeReason: resolvedMode.reason
    });

    await appendTransition(artifacts, {
      from: null,
      to: "ANALYZE",
      reason: "run initialized"
    });
  } else {
    manifest = loadedManifest;
  }

  machine.reset(manifest.currentState);

  const snapshot: RuntimeSnapshot = {
    runId: artifacts.runId,
    artifactDir: artifacts.runDir,
    state: manifest.currentState,
    analyzeInput,
    mode: manifest.mode,
    modeReason: manifest.modeReason,
    waitingQuestions: manifest.waitingQuestions,
    patchAttempts: manifest.patchAttempts,
    sameFailureCount: manifest.sameFailureCount,
    lastFailureSignature: manifest.lastFailureSignature
  };
  const controlledSingleLoop =
    analyzeInput.constraints.includes("short-session") &&
    analyzeInput.constraints.includes("state-machine-control");
  const persistedArtifacts: string[] = [];

  const notifyEvent = async (reason: string): Promise<void> => {
    if (!options?.onEvent) {
      return;
    }

    await options.onEvent({
      kind: "transition",
      runId: artifacts.runId,
      state: machine.current,
      reason,
      patchAttempts: manifest.patchAttempts,
      strategy: PATCH_STRATEGIES[manifest.strategyIndex]?.name ?? PATCH_STRATEGIES[0].name,
      timestamp: timestamp()
    });
  };

  const emitProgress = async (
    reason: string,
    metadata?: { patchAttempts?: number; strategy?: string }
  ): Promise<void> => {
    if (!options?.onEvent) {
      return;
    }

    await options.onEvent({
      kind: "progress",
      runId: artifacts.runId,
      state: machine.current,
      reason,
      patchAttempts: metadata?.patchAttempts ?? manifest.patchAttempts,
      strategy: metadata?.strategy ?? PATCH_STRATEGIES[manifest.strategyIndex]?.name ?? PATCH_STRATEGIES[0].name,
      timestamp: timestamp()
    });
  };

  const transition = async (
    next: RuntimeSnapshot["state"],
    reason: string,
    metadata?: Record<string, unknown>
  ): Promise<void> => {
    const from = machine.current;
    machine.transition(next);

    snapshot.state = machine.current;

    await appendTransition(artifacts, {
      from,
      to: next,
      reason,
      patchAttempts: manifest.patchAttempts,
      strategy: PATCH_STRATEGIES[manifest.strategyIndex]?.name ?? PATCH_STRATEGIES[0].name,
      idempotent: from === next,
      ...metadata
    });

    manifest = await updateManifest(artifacts, manifest, {
      currentState: machine.current,
      loopCount: manifest.loopCount + 1
    });

    await notifyEvent(reason);
  };

  const pluginContributions: PluginContribution[] = [];
  const pluginWarnings: string[] = [];

  try {
    await writeOutput(artifacts, "analyze.input.json", analyzeInput);
    await writeOutput(artifacts, "analyze.tuning.json", {
      notes: tuning.notes,
      availableLibraries: analyzeInput.availableLibraries ?? [],
      constraints: analyzeInput.constraints
    });
    if (tuning.notes.length > 0) {
      await emitProgress(`analyze tuning applied: ${tuning.notes.join(" | ")}`);
    }

    const beforeAnalyze = await pluginManager.runHook("beforeAnalyze", {
      cwd,
      runId: artifacts.runId,
      input: analyzeInput,
      stageAttempt: manifest.patchAttempts
    });
    pluginContributions.push(...beforeAnalyze.contributions);
    pluginWarnings.push(...beforeAnalyze.warnings);

    if (
      (machine.current === "ANALYZE" || machine.current === "WAIT_CLARIFICATION") &&
      resolvedMode.waitingRequired &&
      analyzeInput.clarificationAnswers.length === 0
    ) {
      await transition("WAIT_CLARIFICATION", "awaiting clarification answers");

      manifest = await updateManifest(artifacts, manifest, {
        status: "waiting",
        waitingQuestions: resolvedMode.questions
      });

      snapshot.waitingQuestions = resolvedMode.questions;
      await writeOutput(artifacts, "clarification.questions.json", {
        mode: resolvedMode.mode,
        reason: resolvedMode.reason,
        questions: resolvedMode.questions
      });

      await writeOutput(artifacts, "plugins.output.json", {
        contributions: pluginContributions,
        warnings: pluginWarnings
      });

      await writeOutput(artifacts, "final.snapshot.json", snapshot);
      await saveManifest(artifacts, manifest);

      return {
        runId: artifacts.runId,
        artifactDir: artifacts.runDir,
        finalState: snapshot.state,
        snapshot,
        failed: false,
        persistedArtifacts
      };
    }

    if (machine.current === "ANALYZE" || machine.current === "WAIT_CLARIFICATION") {
      await transition("PLAN", "analyze complete");
    }

    const planOutputFile = "plan.output.json";
    let planOutput: PlanOutput;

    if (manifest.checkpoints.planCompleted) {
      const cachedPlan = await readOutput<{ output: PlanOutput }>(artifacts, planOutputFile);
      if (!cachedPlan) {
        throw new Error("Manifest indicates PLAN complete but plan.output.json is missing");
      }
      planOutput = PlanOutputSchema.parse(cachedPlan.output);
      snapshot.planOutput = planOutput;
    } else {
      const inspection = await inspectContext({
        cwd,
        files: analyzeInput.files,
        task: analyzeInput.objective,
        tier: analyzeInput.contextTier,
        tokenBudget: analyzeInput.contextTokenBudget,
        stage: "PLAN",
        targetFiles: analyzeInput.files,
        diffSummary: analyzeInput.diffSummary,
        errorLogs: analyzeInput.errorLogs
      });

      const beforePlan = await pluginManager.runHook("beforePlan", {
        cwd,
        runId: artifacts.runId,
        input: analyzeInput,
        stageAttempt: manifest.patchAttempts
      });
      pluginContributions.push(...beforePlan.contributions);
      pluginWarnings.push(...beforePlan.warnings);

      const pluginContext = unique(beforePlan.contributions.flatMap((entry) => entry.context ?? []));

      const planContext = packContext({
        objective: analyzeInput.objective,
        constraints: [
          ...analyzeInput.constraints,
          `mode=${resolvedMode.mode}`,
          `mode-guidance=${resolvedMode.policy.planningGuidance}`
        ],
        symbols: unique([...analyzeInput.symbols, ...inspection.packed.payload.symbols]),
        errorLogs: analyzeInput.errorLogs,
        diffSummary: unique([
          ...analyzeInput.diffSummary,
          ...inspection.packed.payload.diffSummary,
          ...pluginContext
        ]),
        tier: analyzeInput.contextTier,
        tokenBudget: analyzeInput.contextTokenBudget,
        stage: "PLAN"
      });
      const planContextArtifact = path.join(
        artifacts.outputsDir,
        `context.packed.plan.attempt-${manifest.patchAttempts}.json`
      );
      await persistPackedContext({
        outputPath: planContextArtifact,
        runId: artifacts.runId,
        stage: "PLAN",
        patchAttempt: manifest.patchAttempts,
        packed: planContext,
        selectedSymbols: planContext.payload.symbols,
        constraintFlags: analyzeInput.constraints
      });
      persistedArtifacts.push(planContextArtifact);

      await emitProgress("planning response generation started");
      const planCall = await llm.proposePlan({
        input: analyzeInput,
        context: planContext,
        planningTemplate: resolvedMode.policy.planningGuidance
      });
      planOutput = PlanOutputSchema.parse(planCall.output);
      snapshot.planOutput = planOutput;

      await writePrompt(artifacts, "plan.prompt.json", {
        model: planCall.trace.model,
        endpoint: planCall.trace.endpoint,
        mode: planCall.trace.mode,
        systemPrompt: planCall.trace.systemPrompt,
        userPrompt: planCall.trace.userPrompt,
        rawResponse: planCall.trace.rawResponse,
        modeReason: resolvedMode.reason
      });

      await writeOutput(artifacts, planOutputFile, {
        inspection,
        context: planContext,
        output: planOutput
      });

      manifest = await updateManifest(artifacts, manifest, {
        checkpoints: {
          ...manifest.checkpoints,
          planCompleted: true
        },
        mode: resolvedMode.mode,
        modeReason: resolvedMode.reason
      });
    }

    if (machine.current !== "IMPLEMENT") {
      await transition("IMPLEMENT", "plan complete");
    }

    let patchAttempts = manifest.patchAttempts;
    let sameFailureCount = manifest.sameFailureCount;
    let lastFailureSignature = manifest.lastFailureSignature;
    let strategyIndex = manifest.strategyIndex || strategyIndexForTier(analyzeInput.contextTier);
    let errorLogs = unique(analyzeInput.errorLogs);
    const maxPatchAttempts = controlledSingleLoop
      ? patchAttempts
      : Math.min(analyzeInput.retryPolicy.maxAttempts, resolvedMode.policy.maxPatchRetries);

    while (true) {
      snapshot.patchAttempts = patchAttempts;
      snapshot.sameFailureCount = sameFailureCount;
      snapshot.lastFailureSignature = lastFailureSignature;

      if (patchAttempts > maxPatchAttempts) {
        snapshot.failReason = `FAIL_WITH_ARTIFACT: patch retries exceeded max attempts(${maxPatchAttempts})`;
        await transition("FAIL", snapshot.failReason);
        manifest = await updateManifest(artifacts, manifest, {
          status: "failed"
        });
        break;
      }

      const strategy = PATCH_STRATEGIES[strategyIndex] ?? PATCH_STRATEGIES[0];
      const attempt = patchAttempts;
      const implementOutputFile = `implement.output.attempt-${attempt}.json`;
      const actionsFile = `implement.actions.attempt-${attempt}.json`;
      const verifyFile = `verify.output.attempt-${attempt}.json`;

      let attemptCheckpoint =
        findAttempt(manifest, attempt) ??
        ({
          attempt,
          strategy: strategy.name,
          implementOutputFile,
          actionsFile,
          verifyFile,
          actionsApplied: false,
          verifyCompleted: false,
          rolledBack: false
        } as AttemptCheckpoint);

      manifest = await upsertAttempt(artifacts, manifest, attemptCheckpoint);

      const beforeImplement = await pluginManager.runHook("beforeImplement", {
        cwd,
        runId: artifacts.runId,
        input: analyzeInput,
        plan: planOutput,
        stageAttempt: attempt
      });
      pluginContributions.push(...beforeImplement.contributions);
      pluginWarnings.push(...beforeImplement.warnings);

      const relatedFailureFiles = snapshot.verifyOutput?.failureSummary?.relatedFiles ?? [];
      const implementInspection = await inspectContext({
        cwd,
        files: unique([...analyzeInput.files, ...relatedFailureFiles]),
        task: `${analyzeInput.objective} ${planOutput.steps.join(" ")}`,
        tier: strategy.tier,
        tokenBudget: analyzeInput.contextTokenBudget,
        stage: "IMPLEMENT",
        targetFiles: analyzeInput.files,
        diffSummary: analyzeInput.diffSummary,
        errorLogs
      });

      const pluginImplementContext = unique(
        beforeImplement.contributions.flatMap((entry) => entry.context ?? [])
      );

      const implementContext = packContext({
        objective: analyzeInput.objective,
        constraints: [
          ...analyzeInput.constraints,
          `mode=${resolvedMode.mode}`,
          `strategy=${strategy.name}`,
          `patch-attempt=${attempt}`,
          ...pluginImplementContext.slice(0, 10)
        ],
        symbols: unique([
          ...analyzeInput.symbols,
          ...planOutput.targetSymbols,
          ...implementInspection.packed.payload.symbols
        ]),
        errorLogs,
        diffSummary: unique([
          ...analyzeInput.diffSummary,
          ...implementInspection.packed.payload.diffSummary,
          ...pluginImplementContext
        ]),
        tier: strategy.tier,
        tokenBudget: analyzeInput.contextTokenBudget,
        stage: "IMPLEMENT"
      });
      const implementContextArtifact = path.join(
        artifacts.outputsDir,
        `context.packed.implement.attempt-${attempt}.json`
      );
      await persistPackedContext({
        outputPath: implementContextArtifact,
        runId: artifacts.runId,
        stage: "IMPLEMENT",
        patchAttempt: attempt,
        packed: implementContext,
        selectedSymbols: unique([...analyzeInput.symbols, ...planOutput.targetSymbols]),
        constraintFlags: analyzeInput.constraints
      });
      persistedArtifacts.push(implementContextArtifact);

      let implementOutput: ImplementOutput;

      const cachedImplement = await readOutput<{ output: ImplementOutput }>(
        artifacts,
        implementOutputFile
      );
      if (cachedImplement) {
        implementOutput = ImplementOutputSchema.parse(cachedImplement.output);
      } else {
        const patchHint = buildPatchFailurePrompt(snapshot.verifyOutput, errorLogs[0] ?? "");
        if (planOutput.steps.length > 0) {
          await emitProgress(
            `plan-step 1/${planOutput.steps.length} in-progress: ${planOutput.steps[0]}`
          );
        }
        await emitProgress(
          `implementation proposal generation started (attempt=${attempt}, strategy=${strategy.name})`
        );

        const implementCall = await llm.proposeImplementation({
          input: analyzeInput,
          plan: {
            ...planOutput,
            risks: unique([
              ...planOutput.risks,
              `patch-summary=${patchHint.summary}`,
              `patch-files=${patchHint.relatedFiles.join(",") || "n/a"}`,
              `patch-instruction=${patchHint.instruction}`
            ])
          },
          context: implementContext,
          patchAttempt: attempt,
          strategy: strategy.name,
          lastFailure: patchHint.summary
        });

        implementOutput = ImplementOutputSchema.parse(implementCall.output);
        snapshot.implementOutput = implementOutput;

        await writePrompt(artifacts, `implement.prompt.attempt-${attempt}.json`, {
          model: implementCall.trace.model,
          endpoint: implementCall.trace.endpoint,
          mode: implementCall.trace.mode,
          systemPrompt: implementCall.trace.systemPrompt,
          userPrompt: implementCall.trace.userPrompt,
          rawResponse: implementCall.trace.rawResponse,
          patchHint
        });

        await writeOutput(artifacts, implementOutputFile, {
          strategy: strategy.name,
          strategyIndex,
          index: attempt,
          inspection: implementInspection,
          context: implementContext,
          output: implementOutput
        });
      }

      const transaction = new PatchTransaction(cwd);

      if (!attemptCheckpoint.actionsApplied) {
        await emitProgress(
          `implementation action execution started (${implementOutput.actions.length} action${
            implementOutput.actions.length === 1 ? "" : "s"
          })`
        );
        const actionResults = await executeImplementationActions(implementOutput.actions, cwd, {
          dryRun: options?.dryRun ?? analyzeInput.dryRun,
          transaction,
          toolLogPath: artifacts.toolLogPath,
          allowlistPath: path.resolve("config", "commands.allowlist.json"),
          onActionEvent: async (event) => {
            if (event.phase === "start") {
              if (planOutput.steps.length > 0) {
                const planStepIndex = Math.min(event.index, planOutput.steps.length - 1);
                await emitProgress(
                  `plan-step ${planStepIndex + 1}/${planOutput.steps.length} in-progress: ${
                    planOutput.steps[planStepIndex]
                  }`
                );
              }
              await emitProgress(
                `action ${event.index + 1}/${event.total} started: ${event.action.type}`
              );
              return;
            }

            if (planOutput.steps.length > 0) {
              const planStepIndex = Math.min(event.index, planOutput.steps.length - 1);
              await emitProgress(
                `plan-step ${planStepIndex + 1}/${planOutput.steps.length} ${
                  event.result?.ok ? "completed" : "failed"
                }: ${planOutput.steps[planStepIndex]}`
              );
            }

            await emitProgress(
              `action ${event.index + 1}/${event.total} ${
                event.result?.ok ? "completed" : "failed"
              }: ${event.result?.details ?? "done"}`
            );
          }
        });

        const hasActionFailure = actionResults.some((result) => !result.ok);
        await writeOutput(artifacts, actionsFile, actionResults);

        if (hasActionFailure) {
          const failedActions = actionResults
            .filter((result) => !result.ok)
            .map((result) => ({
              target: result.target,
              details: result.details
            }));
          const actionFailureVerify = buildImplementationActionFailureOutput(failedActions);
          await writeOutput(artifacts, verifyFile, actionFailureVerify);

          snapshot.verifyOutput = actionFailureVerify;
          await appendFailureSummary({
            filePath: artifacts.failureSummaryPath,
            verifyOutput: actionFailureVerify,
            patchAttempt: attempt
          });
          persistedArtifacts.push(artifacts.failureSummaryPath);

          attemptCheckpoint = {
            ...attemptCheckpoint,
            verifyCompleted: true,
            verifyPassed: false,
            failureSignature: actionFailureVerify.failureSignature
          };
          manifest = await upsertAttempt(artifacts, manifest, attemptCheckpoint);

          await emitProgress("implementation actions failed; moving to PATCH strategy");

          if (machine.current !== "VERIFY") {
            await transition("VERIFY", `implementation attempt ${attempt} action failures`);
          }

          const failureSignature = actionFailureVerify.failureSignature ?? "unknown-action-failure";
          sameFailureCount =
            failureSignature === lastFailureSignature ? sameFailureCount + 1 : 1;
          lastFailureSignature = failureSignature;
          const failureSummary = summarizeFailures(actionFailureVerify);
          errorLogs = unique([failureSummary, ...errorLogs]).slice(0, 20);
          if (actionFailureVerify.failureSummary?.recommendation) {
            await emitProgress(`retry-guidance: ${actionFailureVerify.failureSummary.recommendation}`);
          }

          if (controlledSingleLoop) {
            const rootCause = summarizeRootCause(actionFailureVerify);
            snapshot.failReason =
              `FAIL_WITH_ARTIFACT: implementation actions failed in controlled attempt ${attempt}; cause=${rootCause}`;
            await transition("FAIL", snapshot.failReason, {
              controlledSingleLoop: true,
              failureSummary
            });
            manifest = await updateManifest(artifacts, manifest, {
              status: "failed",
              patchAttempts,
              sameFailureCount,
              strategyIndex,
              lastFailureSignature
            });
            break;
          }

          patchAttempts += 1;

          if (patchAttempts > maxPatchAttempts) {
            const rootCause = summarizeRootCause(actionFailureVerify);
            snapshot.failReason =
              `FAIL_WITH_ARTIFACT: implementation actions failed after ${attempt + 1} attempt(s); cause=${rootCause}`;
            await transition("FAIL", snapshot.failReason);
            manifest = await updateManifest(artifacts, manifest, {
              status: "failed",
              patchAttempts,
              sameFailureCount,
              strategyIndex,
              lastFailureSignature
            });
            break;
          }

          let switchedStrategy = false;
          const nextStrategy = Math.min(strategyIndex + 1, PATCH_STRATEGIES.length - 1);
          if (nextStrategy > strategyIndex) {
            strategyIndex = nextStrategy;
            sameFailureCount = 0;
            switchedStrategy = true;
          } else if (sameFailureCount >= analyzeInput.retryPolicy.sameFailureLimit) {
            const rootCause = summarizeRootCause(actionFailureVerify);
            snapshot.failReason =
              `FAIL_WITH_ARTIFACT: repeated implementation action failure signature ${failureSignature}; cause=${rootCause}`;
            await transition("FAIL", snapshot.failReason);
            manifest = await updateManifest(artifacts, manifest, {
              status: "failed",
              patchAttempts,
              sameFailureCount,
              strategyIndex,
              lastFailureSignature
            });
            break;
          }

          await transition(
            "PATCH",
            switchedStrategy
              ? `implementation actions failed (${failureSignature}), strategy switched to ${
                  PATCH_STRATEGIES[strategyIndex].name
                }`
              : `implementation actions failed (${failureSignature}), retry patch`
          );

          manifest = await updateManifest(artifacts, manifest, {
            patchAttempts,
            sameFailureCount,
            strategyIndex,
            lastFailureSignature
          });

          if (analyzeInput.retryPolicy.backoffMs > 0) {
            await sleep(analyzeInput.retryPolicy.backoffMs);
          }

          await transition(
            "IMPLEMENT",
            `patch retry #${patchAttempts} (${PATCH_STRATEGIES[strategyIndex].name})`
          );
          continue;
        }

        attemptCheckpoint = {
          ...attemptCheckpoint,
          actionsApplied: true
        };
        manifest = await upsertAttempt(artifacts, manifest, attemptCheckpoint);
      }

      if (machine.current !== "VERIFY") {
        await transition("VERIFY", `implementation attempt ${attempt}`);
      }

      const beforeVerify = await pluginManager.runHook("beforeVerify", {
        cwd,
        runId: artifacts.runId,
        input: analyzeInput,
        plan: planOutput,
        implement: implementOutput,
        stageAttempt: attempt
      });
      pluginContributions.push(...beforeVerify.contributions);
      pluginWarnings.push(...beforeVerify.warnings);

      const cachedVerify = await readOutput<VerifyOutput>(artifacts, verifyFile);
      let verifyOutput: VerifyOutput;

      if (cachedVerify && attemptCheckpoint.verifyCompleted) {
        verifyOutput = VerifyOutputSchema.parse(cachedVerify);
      } else {
        if (planOutput.steps.length > 0) {
          await emitProgress(
            `plan-step ${planOutput.steps.length}/${planOutput.steps.length} in-progress: ${
              planOutput.steps[planOutput.steps.length - 1]
            }`
          );
        }
        await emitProgress("quality gate verification started");
        const requestedGateProfile =
          analyzeInput.gateProfile ??
          inferGateProfileFromObjective(analyzeInput.objective) ??
          resolvedMode.policy.gateProfile;
        await emitProgress(`verify profile selected: ${requestedGateProfile}`);
        verifyOutput = VerifyOutputSchema.parse(
          await runQualityGates({
            cwd,
            verifyLogPath: artifacts.verifyLogPath,
            profileName: requestedGateProfile,
            profiles: listVerifyProfiles(),
            dryRun: options?.dryRun ?? analyzeInput.dryRun,
            allowlistPath: path.resolve("config", "commands.allowlist.json"),
            toolLogPath: artifacts.toolLogPath,
            onGateEvent: async (event) => {
              if (event.phase === "start") {
                await emitProgress(
                  `verify gate ${event.index + 1}/${event.total} started: ${event.gate.name}`
                );
                return;
              }

              await emitProgress(
                `verify gate ${event.index + 1}/${event.total} ${
                  event.passed ? "passed" : "failed"
                }: ${event.gate.name}`
              );
            }
          })
        );

        const objectiveGate = await runObjectiveContractGate({
          objective: analyzeInput.objective,
          cwd,
          availableLibraries: analyzeInput.availableLibraries,
          verifyLogPath: artifacts.verifyLogPath
        });
        if (objectiveGate) {
          verifyOutput = VerifyOutputSchema.parse(
            finalizeVerifyOutput([...verifyOutput.gateResults, objectiveGate])
          );
          await emitProgress(
            `verify gate ${verifyOutput.gateResults.length}/${verifyOutput.gateResults.length} ${
              objectiveGate.passed ? "passed" : "failed"
            }: ${objectiveGate.name}`
          );
        }

        await writeOutput(artifacts, verifyFile, verifyOutput);
      }

      snapshot.verifyOutput = verifyOutput;
      await appendFailureSummary({
        filePath: artifacts.failureSummaryPath,
        verifyOutput,
        patchAttempt: attempt
      });
      persistedArtifacts.push(artifacts.failureSummaryPath);

      attemptCheckpoint = {
        ...attemptCheckpoint,
        verifyCompleted: true,
        verifyPassed: verifyOutput.passed,
        failureSignature: verifyOutput.failureSignature
      };
      manifest = await upsertAttempt(artifacts, manifest, attemptCheckpoint);

      if (!failed(verifyOutput)) {
        await transition("FINISH", "all quality gates passed");
        manifest = await updateManifest(artifacts, manifest, {
          status: "finished",
          patchAttempts,
          sameFailureCount,
          strategyIndex,
          lastFailureSignature
        });
        break;
      }

      const failureSignature = verifyOutput.failureSignature ?? "unknown-failure";
      sameFailureCount = failureSignature === lastFailureSignature ? sameFailureCount + 1 : 1;
      lastFailureSignature = failureSignature;
      const failureSummary = summarizeFailures(verifyOutput);
      errorLogs = unique([failureSummary, ...errorLogs]).slice(0, 20);

      if (controlledSingleLoop) {
        const rootCause = summarizeRootCause(verifyOutput);
        snapshot.failReason = `FAIL_WITH_ARTIFACT: verification failed after controlled attempt ${attempt}; cause=${rootCause}`;
        await transition("FAIL", snapshot.failReason, {
          controlledSingleLoop: true,
          failureSummary
        });
        manifest = await updateManifest(artifacts, manifest, {
          status: "failed",
          patchAttempts,
          sameFailureCount,
          strategyIndex,
          lastFailureSignature
        });
        break;
      }

      if ((analyzeInput.retryPolicy.rollbackOnVerifyFail || attempt === 0) && !attemptCheckpoint.rolledBack) {
        await rollbackTransaction(transaction, { toolLogPath: artifacts.toolLogPath });
        attemptCheckpoint = {
          ...attemptCheckpoint,
          rolledBack: true
        };
        manifest = await upsertAttempt(artifacts, manifest, attemptCheckpoint);
      }

      patchAttempts += 1;

      if (patchAttempts > maxPatchAttempts) {
        const rootCause = summarizeRootCause(verifyOutput);
        snapshot.failReason = `FAIL_WITH_ARTIFACT: verification failed after ${attempt + 1} attempt(s); cause=${rootCause}`;
        await transition("FAIL", snapshot.failReason);
        manifest = await updateManifest(artifacts, manifest, {
          status: "failed",
          patchAttempts,
          sameFailureCount,
          strategyIndex,
          lastFailureSignature
        });
        break;
      }

      let switchedStrategy = false;
      if (sameFailureCount >= analyzeInput.retryPolicy.sameFailureLimit) {
        const nextStrategy = Math.min(strategyIndex + 1, PATCH_STRATEGIES.length - 1);
        if (nextStrategy > strategyIndex) {
          strategyIndex = nextStrategy;
          sameFailureCount = 0;
          switchedStrategy = true;
        } else {
          const rootCause = summarizeRootCause(verifyOutput);
          snapshot.failReason = `FAIL_WITH_ARTIFACT: repeated failure signature ${failureSignature} with no remaining strategy; cause=${rootCause}`;
          await transition("FAIL", snapshot.failReason);
          manifest = await updateManifest(artifacts, manifest, {
            status: "failed",
            patchAttempts,
            sameFailureCount,
            strategyIndex,
            lastFailureSignature
          });
          break;
        }
      }

      await transition(
        "PATCH",
        switchedStrategy
          ? `verify failed (${failureSignature}), strategy switched to ${PATCH_STRATEGIES[strategyIndex].name}`
          : `verify failed (${failureSignature}), retry patch`
      );

      manifest = await updateManifest(artifacts, manifest, {
        patchAttempts,
        sameFailureCount,
        strategyIndex,
        lastFailureSignature
      });

      if (analyzeInput.retryPolicy.backoffMs > 0) {
        await sleep(analyzeInput.retryPolicy.backoffMs);
      }

      await transition(
        "IMPLEMENT",
        `patch retry #${patchAttempts} (${PATCH_STRATEGIES[strategyIndex].name})`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    snapshot.failReason = message;

    if (machine.current !== "FAIL" && machine.current !== "FINISH") {
      try {
        await transition("FAIL", `runtime error: ${message}`);
      } catch {
        snapshot.state = machine.current;
      }
    }

    if (manifest) {
      manifest = await updateManifest(artifacts, manifest, {
        status: "failed"
      });
    }

    await writeOutput(artifacts, "runtime.error.json", {
      message,
      stack
    });
  } finally {
    await writeOutput(artifacts, "plugins.output.json", {
      contributions: pluginContributions,
      warnings: pluginWarnings
    });

    await releaseRunLock(artifacts.lockPath);
  }

  snapshot.state = machine.current;
  snapshot.patchAttempts = manifest.patchAttempts;
  snapshot.sameFailureCount = manifest.sameFailureCount;
  snapshot.lastFailureSignature = manifest.lastFailureSignature;

  await writeOutput(artifacts, "final.snapshot.json", snapshot);
  await saveManifest(artifacts, manifest);

  const failedRun = snapshot.state === "FAIL";
  const failureSummary = snapshot.verifyOutput ? summarizeFailures(snapshot.verifyOutput) : undefined;

  return {
    runId: artifacts.runId,
    artifactDir: artifacts.runDir,
    finalState: snapshot.state,
    snapshot,
    failed: failedRun,
    failureSummary,
    persistedArtifacts: unique(persistedArtifacts)
  };
}
