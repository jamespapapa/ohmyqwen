import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AnalyzeInput, AnalyzeInputSchema, RuntimeSnapshot, RunMode } from "../core/types.js";
import { OpenAICompatibleLlmClient } from "../llm/client.js";
import { RunLoopEvent, runLoop } from "../loop/runner.js";

export type ServerRunStatus = "queued" | "running" | "waiting" | "finished" | "failed";

export interface ServerRunRecord {
  runId: string;
  taskId: string;
  objective: string;
  mode: RunMode;
  status: ServerRunStatus;
  workspaceDir: string;
  currentState?: string;
  currentSummary?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  finalState?: string;
  failReason?: string;
  artifactDir?: string;
  changedFiles?: Array<{ path: string; summary: string }>;
  report?: {
    planSummary?: string;
    planSteps?: string[];
    implementSummary?: string;
    verifyPassed?: boolean;
    failureSignature?: string;
    failureSummary?: {
      category: string;
      coreLines: string[];
      recommendation: string;
    };
    failureDiagnosis?: {
      code: string;
      message: string;
      evidence: string[];
    };
    gateResults?: Array<{
      name: string;
      passed: boolean;
      category?: string;
      details: string;
      durationMs: number;
    }>;
  };
  events: RunLoopEvent[];
}

export interface StartRunPayload {
  task?: string;
  mode?: RunMode;
  input?: Partial<AnalyzeInput>;
  availableLibraries?: string[];
  availableLibrariesFile?: string;
  availableLibrariesUrl?: string;
  files?: string[];
  constraints?: string[];
  symbols?: string[];
  contextTier?: AnalyzeInput["contextTier"];
  contextTokenBudget?: number;
  retryPolicy?: AnalyzeInput["retryPolicy"];
  retrieval?: AnalyzeInput["retrieval"];
  llm?: {
    model?: string;
    maxTokens?: number;
    contextWindowTokens?: number;
    contextUsageRatio?: number;
    retrySameTask?: number;
    retryChangedTask?: number;
  };
  dryRun?: boolean;
  workspaceDir?: string;
}

const runStore = new Map<string, ServerRunRecord>();
const debugEnabled = process.env.OHMYQWEN_DEBUG === "1";

function debugLog(message: string, payload?: unknown): void {
  if (!debugEnabled) {
    return;
  }

  const suffix =
    payload === undefined ? "" : ` ${typeof payload === "string" ? payload : JSON.stringify(payload)}`;
  process.stdout.write(`[ohmyqwen:debug] ${new Date().toISOString()} ${message}${suffix}\n`);
}

async function tryHydratePlanReport(
  record: ServerRunRecord,
  runId: string,
  workspaceDir: string
): Promise<void> {
  if (record.report?.planSteps?.length) {
    return;
  }

  const planPath = path.join(
    workspaceDir,
    ".ohmyqwen",
    "runs",
    runId,
    "outputs",
    "plan.output.json"
  );

  try {
    const raw = await fs.readFile(planPath, "utf8");
    const parsed = JSON.parse(raw) as {
      output?: {
        summary?: string;
        steps?: string[];
      };
    };

    record.report = {
      ...(record.report ?? {}),
      planSummary: parsed.output?.summary ?? record.report?.planSummary,
      planSteps: parsed.output?.steps ?? record.report?.planSteps ?? []
    };
  } catch {
    // ignore; artifact may not exist yet
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? text.trim()
  );
}

function extractMissingScripts(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /missing script:?\s*([a-zA-Z0-9:_-]+)/gi,
    /script\s+([a-zA-Z0-9:_-]+)\s+not found/gi
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const script = (match[1] ?? "").trim().toLowerCase();
      if (script) {
        found.add(script);
      }
    }
  }

  return Array.from(found);
}

function detectSingleTopDirectory(paths: string[]): string | undefined {
  const topDirs = Array.from(
    new Set(
      paths
        .map((entry) => entry.replace(/\\/g, "/").split("/").filter(Boolean))
        .map((parts) => (parts.length >= 2 ? parts[0] : ""))
        .filter(Boolean)
    )
  );

  if (topDirs.length !== 1) {
    return undefined;
  }

  return topDirs[0];
}

function buildFailureDiagnosis(snapshot: RuntimeSnapshot): {
  code: string;
  message: string;
  evidence: string[];
} | undefined {
  const verifyOutput = snapshot.verifyOutput;
  if (!verifyOutput || verifyOutput.passed) {
    return undefined;
  }

  const failingGates = verifyOutput.gateResults.filter((gate) => !gate.passed);
  const combined = failingGates
    .map((gate) => `${gate.name}: ${gate.details}`)
    .join("\n")
    .toLowerCase();
  const evidence = failingGates
    .map((gate) => `${gate.name}: ${firstLine(gate.details)}`)
    .filter(Boolean)
    .slice(0, 5);
  const missingScripts = extractMissingScripts(combined);

  if (/unterminated string constant|syntaxerror|invalid or unexpected token/.test(combined)) {
    return {
      code: "INLINE_NODE_EVAL_SYNTAX",
      message:
        "LLM이 생성한 inline node -e 스크립트 문자열이 깨져 SyntaxError가 발생했습니다. 파일 작성 + 직접 실행 방식으로 바꿔야 합니다.",
      evidence
    };
  }

  if (/args not allowed by allowlist|command not allowed/.test(combined)) {
    return {
      code: "ALLOWLIST_BLOCKED",
      message: "허용되지 않은 명령/인자 조합을 실행해 allowlist에 의해 차단되었습니다.",
      evidence
    };
  }

  if (/eaddrinuse|address already in use/.test(combined)) {
    return {
      code: "PORT_IN_USE",
      message: "기존 프로세스가 포트를 점유하고 있어 서버 실행 명령이 실패했습니다.",
      evidence
    };
  }

  if (missingScripts.length > 0) {
    const hasBuild = missingScripts.includes("build");
    const hasTest = missingScripts.includes("test");
    const hasLint = missingScripts.includes("lint");
    const topDir = detectSingleTopDirectory(snapshot.implementOutput?.changes.map((entry) => entry.path) ?? []);

    if (hasBuild && hasTest && hasLint) {
      const workspaceHint = topDir
        ? ` (생성 결과는 '${topDir}' 하위로 보이며, verify는 워크스페이스 루트 기준으로 실행됩니다)`
        : "";
      return {
        code: "VERIFY_SCRIPTS_MISSING",
        message: `검증 단계에서 build/test/lint 스크립트를 찾지 못했습니다${workspaceHint}.`,
        evidence
      };
    }

    return {
      code: "PNPM_SCRIPT_MISSING",
      message: `필수 스크립트가 누락되었습니다: ${missingScripts.join(", ")}.`,
      evidence
    };
  }

  if (/patch_file could not find target text/.test(combined)) {
    return {
      code: "PATCH_TARGET_NOT_FOUND",
      message: "patch_file 대상 문자열을 찾지 못해 액션이 실패했습니다. write_file 기반으로 재작성해야 합니다.",
      evidence
    };
  }

  return {
    code: "UNKNOWN",
    message:
      snapshot.failReason?.trim() || "정확한 원인 분류에 실패했습니다. failure-summary/core lines를 확인하세요.",
    evidence
  };
}

function toAnalyzeInput(payload: StartRunPayload, runId: string): AnalyzeInput {
  const base: AnalyzeInput = AnalyzeInputSchema.parse({
    taskId: payload.input?.taskId ?? `web-${runId}`,
    objective: payload.input?.objective ?? payload.task ?? "",
    constraints: payload.input?.constraints ?? payload.constraints ?? [],
    availableLibraries: payload.input?.availableLibraries ?? payload.availableLibraries,
    availableLibrariesFile: payload.input?.availableLibrariesFile ?? payload.availableLibrariesFile,
    availableLibrariesUrl: payload.input?.availableLibrariesUrl ?? payload.availableLibrariesUrl,
    files: payload.input?.files ?? payload.files ?? [],
    symbols: payload.input?.symbols ?? payload.symbols ?? [],
    errorLogs: payload.input?.errorLogs ?? [],
    diffSummary: payload.input?.diffSummary ?? [],
    contextTier: payload.input?.contextTier ?? payload.contextTier ?? "small",
    contextTokenBudget: payload.input?.contextTokenBudget ?? payload.contextTokenBudget ?? 1200,
    retryPolicy: payload.input?.retryPolicy ??
      payload.retryPolicy ?? {
        maxAttempts: 2,
        backoffMs: 0,
        sameFailureLimit: 2,
        rollbackOnVerifyFail: false
      },
    retrieval: payload.input?.retrieval ?? payload.retrieval,
    mode: payload.input?.mode ?? payload.mode ?? "auto",
    clarificationAnswers: payload.input?.clarificationAnswers ?? [],
    gateProfile: payload.input?.gateProfile,
    dryRun: payload.input?.dryRun ?? payload.dryRun ?? false
  });

  return base;
}

async function resolveWorkspaceDir(workspaceDir?: string): Promise<string> {
  const candidate = workspaceDir?.trim();
  const absolute = candidate
    ? path.isAbsolute(candidate)
      ? candidate
      : path.resolve(process.cwd(), candidate)
    : process.cwd();

  await fs.mkdir(absolute, { recursive: true });
  const stat = await fs.stat(absolute);
  if (!stat.isDirectory()) {
    throw new Error(`workspaceDir is not a directory: ${absolute}`);
  }

  return absolute;
}

export async function startBackgroundRun(payload: StartRunPayload): Promise<ServerRunRecord> {
  const runId = randomUUID().slice(0, 12);
  const analyzeInput = toAnalyzeInput(payload, runId);
  const workspaceDir = await resolveWorkspaceDir(payload.workspaceDir);

  const record: ServerRunRecord = {
    runId,
    taskId: analyzeInput.taskId,
    objective: analyzeInput.objective,
    mode: analyzeInput.mode,
    status: "queued",
    workspaceDir,
    currentState: "ANALYZE",
    currentSummary: "run queued",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    events: []
  };

  runStore.set(runId, record);
  debugLog("run queued", {
    runId,
    taskId: analyzeInput.taskId,
    mode: analyzeInput.mode,
    workspaceDir
  });

  void (async () => {
    record.status = "running";
    record.startedAt = nowIso();
    record.updatedAt = nowIso();
    record.currentState = "ANALYZE";
    record.currentSummary = "analyze started";
    debugLog("run started", { runId, objective: analyzeInput.objective, workspaceDir });

    try {
      const llmClient = payload.llm
        ? new OpenAICompatibleLlmClient({
            model: payload.llm.model,
            maxTokens: payload.llm.maxTokens,
            contextWindowTokens: payload.llm.contextWindowTokens,
            contextUsageRatio: payload.llm.contextUsageRatio,
            retrySameTask: payload.llm.retrySameTask,
            retryChangedTask: payload.llm.retryChangedTask
          })
        : undefined;
      const result = await runLoop(analyzeInput, {
        runId,
        cwd: workspaceDir,
        llmClient,
        onEvent: async (event) => {
          record.events.push(event);
          record.updatedAt = nowIso();
          record.currentState = event.state;
          record.currentSummary = `${event.kind}: ${event.reason}`;

          if (event.state === "IMPLEMENT" || event.state === "VERIFY" || event.state === "PATCH") {
            await tryHydratePlanReport(record, runId, workspaceDir);
          }

          if (event.state === "WAIT_CLARIFICATION") {
            record.status = "waiting";
          }

          debugLog("run event", {
            runId,
            kind: event.kind,
            state: event.state,
            reason: event.reason
          });
        },
        dryRun: analyzeInput.dryRun
      });

      record.completedAt = nowIso();
      record.updatedAt = nowIso();
      record.finalState = result.finalState;
      record.currentState = result.finalState;
      record.artifactDir = result.artifactDir;
      record.failReason = result.snapshot.failReason;
      record.changedFiles = result.snapshot.implementOutput?.changes ?? [];
      record.report = {
        planSummary: result.snapshot.planOutput?.summary,
        planSteps: result.snapshot.planOutput?.steps ?? [],
        implementSummary: result.snapshot.implementOutput?.summary,
        verifyPassed: result.snapshot.verifyOutput?.passed,
        failureSignature: result.snapshot.verifyOutput?.failureSignature,
        failureSummary: result.snapshot.verifyOutput?.failureSummary
          ? {
              category: result.snapshot.verifyOutput.failureSummary.category,
              coreLines: result.snapshot.verifyOutput.failureSummary.coreLines,
              recommendation: result.snapshot.verifyOutput.failureSummary.recommendation
            }
          : undefined,
        failureDiagnosis: buildFailureDiagnosis(result.snapshot),
        gateResults: result.snapshot.verifyOutput?.gateResults.map((gate) => ({
          name: gate.name,
          passed: gate.passed,
          category: gate.category,
          details: gate.details,
          durationMs: gate.durationMs
        }))
      };
      record.currentSummary = result.snapshot.failReason
        ? `completed with failure: ${result.snapshot.failReason}`
        : `completed: ${result.finalState}`;

      if (result.finalState === "FAIL") {
        record.status = "failed";
      } else if (result.finalState === "WAIT_CLARIFICATION") {
        record.status = "waiting";
      } else {
        record.status = "finished";
      }

      debugLog("run completed", {
        runId,
        finalState: result.finalState,
        status: record.status,
        failReason: record.failReason
      });
    } catch (error) {
      record.status = "failed";
      record.completedAt = nowIso();
      record.updatedAt = nowIso();
      record.failReason = error instanceof Error ? error.message : String(error);
      record.currentSummary = `runtime failure: ${record.failReason}`;
      record.currentState = "FAIL";
      debugLog("run crashed", { runId, error: record.failReason });
    }
  })();

  return record;
}

export function getRunRecord(runId: string): ServerRunRecord | undefined {
  return runStore.get(runId);
}

export async function getRunArtifacts(runId: string, cwd = process.cwd()): Promise<{
  runId: string;
  artifactDir: string;
  files: Array<{ path: string; size: number }>;
}> {
  const record = runStore.get(runId);
  const artifactDir = record?.artifactDir ?? path.resolve(cwd, ".ohmyqwen", "runs", runId);

  const stat = await fs.stat(artifactDir);
  if (!stat.isDirectory()) {
    throw new Error("artifact directory not found");
  }

  const files: Array<{ path: string; size: number }> = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const fileStat = await fs.stat(full);
        files.push({
          path: path.relative(artifactDir, full),
          size: fileStat.size
        });
      }
    }
  }

  await walk(artifactDir);
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    runId,
    artifactDir,
    files
  };
}

export function listRunEvents(runId: string): RunLoopEvent[] {
  const record = runStore.get(runId);
  if (!record) {
    return [];
  }

  return [...record.events];
}
