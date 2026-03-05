import { promises as fs } from "node:fs";
import path from "node:path";
import { AnalyzeInput, RunManifest, RunManifestSchema } from "../core/types.js";

export interface RunArtifacts {
  runId: string;
  runDir: string;
  manifestPath: string;
  lockPath: string;
  transitionsPath: string;
  promptsDir: string;
  outputsDir: string;
  verifyLogPath: string;
  failureSummaryPath: string;
  toolLogPath: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isAlivePid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function resolveRunArtifacts(cwd: string, runId: string): RunArtifacts {
  const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const runDir = path.resolve(cwd, ".ohmyqwen", "runs", safeRunId);
  const promptsDir = path.join(runDir, "prompts");
  const outputsDir = path.join(runDir, "outputs");

  return {
    runId: safeRunId,
    runDir,
    manifestPath: path.join(runDir, "run.json"),
    lockPath: path.join(runDir, "run.lock"),
    transitionsPath: path.join(runDir, "state-transitions.jsonl"),
    promptsDir,
    outputsDir,
    verifyLogPath: path.join(runDir, "verify.log"),
    failureSummaryPath: path.join(outputsDir, "failure-summary.json"),
    toolLogPath: path.join(runDir, "tools.log")
  };
}

export async function ensureRunArtifacts(artifacts: RunArtifacts, resume: boolean): Promise<void> {
  await fs.mkdir(artifacts.promptsDir, { recursive: true });
  await fs.mkdir(artifacts.outputsDir, { recursive: true });

  if (!resume) {
    await fs.writeFile(artifacts.transitionsPath, "", "utf8");
    await fs.writeFile(artifacts.verifyLogPath, "", "utf8");
    await fs.writeFile(artifacts.toolLogPath, "", "utf8");
  } else {
    for (const file of [artifacts.transitionsPath, artifacts.verifyLogPath, artifacts.toolLogPath]) {
      try {
        await fs.access(file);
      } catch {
        await fs.writeFile(file, "", "utf8");
      }
    }
  }
}

export async function acquireRunLock(lockPath: string): Promise<void> {
  const payload = {
    pid: process.pid,
    createdAt: nowIso()
  };

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await handle.close();
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw error;
      }

      try {
        const raw = await fs.readFile(lockPath, "utf8");
        const existing = JSON.parse(raw) as { pid?: number };
        if (existing.pid && isAlivePid(existing.pid)) {
          throw new Error(`Run lock already held by pid ${existing.pid}`);
        }
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message.startsWith("Run lock already held")) {
          throw parseError;
        }
      }

      await fs.rm(lockPath, { force: true });
    }
  }
}

export async function releaseRunLock(lockPath: string): Promise<void> {
  await fs.rm(lockPath, { force: true });
}

export async function appendTransition(
  artifacts: RunArtifacts,
  payload: Record<string, unknown>
): Promise<void> {
  const line = JSON.stringify({ timestamp: nowIso(), ...payload });
  await fs.appendFile(artifacts.transitionsPath, `${line}\n`, "utf8");
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writePrompt(
  artifacts: RunArtifacts,
  fileName: string,
  payload: unknown
): Promise<void> {
  await writeJson(path.join(artifacts.promptsDir, fileName), payload);
}

export async function writeOutput(
  artifacts: RunArtifacts,
  fileName: string,
  payload: unknown
): Promise<void> {
  await writeJson(path.join(artifacts.outputsDir, fileName), payload);
}

export async function readOutput<T>(artifacts: RunArtifacts, fileName: string): Promise<T | undefined> {
  const fullPath = path.join(artifacts.outputsDir, fileName);
  try {
    const raw = await fs.readFile(fullPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function loadManifest(artifacts: RunArtifacts): Promise<RunManifest | undefined> {
  try {
    const raw = await fs.readFile(artifacts.manifestPath, "utf8");
    return RunManifestSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export async function createInitialManifest(input: {
  artifacts: RunArtifacts;
  analyzeInput: AnalyzeInput;
  mode: Exclude<AnalyzeInput["mode"], "auto">;
  modeReason: string;
}): Promise<RunManifest> {
  const manifest: RunManifest = {
    runId: input.artifacts.runId,
    taskId: input.analyzeInput.taskId,
    status: "running",
    currentState: "ANALYZE",
    mode: input.mode,
    modeReason: input.modeReason,
    loopCount: 0,
    patchAttempts: 0,
    sameFailureCount: 0,
    strategyIndex: 0,
    lastFailureSignature: "",
    waitingQuestions: [],
    checkpoints: {
      planCompleted: false,
      attempts: []
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  await saveManifest(input.artifacts, manifest);
  return manifest;
}

export async function saveManifest(artifacts: RunArtifacts, manifest: RunManifest): Promise<void> {
  const next: RunManifest = {
    ...manifest,
    updatedAt: nowIso()
  };

  await writeJson(artifacts.manifestPath, next);
}

export async function updateManifest(
  artifacts: RunArtifacts,
  previous: RunManifest,
  patch: Partial<RunManifest>
): Promise<RunManifest> {
  const next: RunManifest = {
    ...previous,
    ...patch,
    checkpoints: {
      ...previous.checkpoints,
      ...(patch.checkpoints ?? {})
    },
    updatedAt: nowIso()
  };

  await saveManifest(artifacts, next);
  return next;
}
