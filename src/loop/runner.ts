import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AnalyzeInput,
  AnalyzeInputSchema,
  ContextTier,
  ImplementOutputSchema,
  PlanOutputSchema,
  RuntimeSnapshot,
  VerifyOutputSchema
} from "../core/types.js";
import { RuntimeStateMachine } from "../core/state-machine.js";
import { packContext } from "../context/packer.js";
import { runQualityGates } from "../gates/verify.js";
import { OpenAICompatibleLlmClient } from "../llm/client.js";
import { executeCommand, executeImplementationActions, readWorkspaceFile } from "../tools/executor.js";

interface RunArtifacts {
  runId: string;
  runDir: string;
  transitionsPath: string;
  promptsDir: string;
  outputsDir: string;
  verifyLogPath: string;
}

const PATCH_STRATEGIES: Array<{ name: string; tier: ContextTier }> = [
  { name: "focused-fix", tier: "small" },
  { name: "wider-context", tier: "mid" },
  { name: "broad-recovery", tier: "big" }
];

export interface RunLoopResult {
  runId: string;
  artifactDir: string;
  finalState: RuntimeSnapshot["state"];
  snapshot: RuntimeSnapshot;
}

function makeRunId(): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

async function initArtifacts(cwd: string, runId?: string): Promise<RunArtifacts> {
  const safeRunId = (runId ?? makeRunId()).replace(/[^a-zA-Z0-9_-]/g, "-");
  const runDir = path.resolve(cwd, ".ohmyqwen", "runs", safeRunId);
  const promptsDir = path.join(runDir, "prompts");
  const outputsDir = path.join(runDir, "outputs");
  const transitionsPath = path.join(runDir, "state-transitions.jsonl");
  const verifyLogPath = path.join(runDir, "verify.log");

  await fs.mkdir(promptsDir, { recursive: true });
  await fs.mkdir(outputsDir, { recursive: true });
  await fs.writeFile(transitionsPath, "", "utf8");
  await fs.writeFile(verifyLogPath, "", "utf8");

  return {
    runId: safeRunId,
    runDir,
    transitionsPath,
    promptsDir,
    outputsDir,
    verifyLogPath
  };
}

async function appendTransition(
  artifacts: RunArtifacts,
  payload: Record<string, unknown>
): Promise<void> {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...payload });
  await fs.appendFile(artifacts.transitionsPath, `${line}\n`, "utf8");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writePrompt(
  artifacts: RunArtifacts,
  fileName: string,
  payload: unknown
): Promise<void> {
  await writeJson(path.join(artifacts.promptsDir, fileName), payload);
}

async function writeOutput(
  artifacts: RunArtifacts,
  fileName: string,
  payload: unknown
): Promise<void> {
  await writeJson(path.join(artifacts.outputsDir, fileName), payload);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectSymbols(files: string[], cwd: string): Promise<string[]> {
  const symbols = new Set<string>();

  for (const file of files) {
    const absolute = path.resolve(cwd, file);
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    let content = "";
    try {
      content = await readWorkspaceFile(file, cwd);
    } catch {
      continue;
    }

    const pattern = /(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    for (const match of content.matchAll(pattern)) {
      if (match[1]) {
        symbols.add(match[1]);
      }
    }
  }

  return Array.from(symbols).slice(0, 200);
}

async function collectDiffSummary(files: string[], cwd: string): Promise<string[]> {
  const args = ["diff", "--unified=0"];
  if (files.length > 0) {
    args.push("--", ...files.slice(0, 30));
  }

  const result = await executeCommand("git", args, { cwd });
  if (result.code !== 0 && !result.stdout.trim()) {
    return [`git diff unavailable: ${result.stderr.trim() || "unknown error"}`];
  }

  return result.stdout
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("@@") ||
        (line.startsWith("+") && !line.startsWith("+++")) ||
        (line.startsWith("-") && !line.startsWith("---"))
    )
    .slice(0, 120)
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function strategyIndexForTier(tier: ContextTier): number {
  const index = PATCH_STRATEGIES.findIndex((entry) => entry.tier === tier);
  return index >= 0 ? index : 0;
}

function summarizeFailures(details: RuntimeSnapshot["verifyOutput"]): string {
  if (!details) {
    return "verification failed";
  }

  const failed = details.gateResults.filter((gate) => !gate.passed);
  if (failed.length === 0) {
    return "verification failed without failing gate details";
  }

  return failed
    .map((gate) => `${gate.name}: ${(gate.details || "failed").slice(0, 400)}`)
    .join("\n");
}

export async function runLoop(
  rawAnalyzeInput: unknown,
  options?: { runId?: string; cwd?: string }
): Promise<RunLoopResult> {
  const analyzeInput: AnalyzeInput = AnalyzeInputSchema.parse(rawAnalyzeInput);
  const cwd = options?.cwd ?? process.cwd();
  const artifacts = await initArtifacts(cwd, options?.runId);

  const machine = new RuntimeStateMachine();
  const llm = new OpenAICompatibleLlmClient();

  const snapshot: RuntimeSnapshot = {
    runId: artifacts.runId,
    artifactDir: artifacts.runDir,
    state: machine.current,
    analyzeInput,
    patchAttempts: 0,
    sameFailureCount: 0
  };

  let strategyIndex = strategyIndexForTier(analyzeInput.contextTier);
  let patchAttempts = 0;
  let sameFailureCount = 0;
  let lastFailureSignature = "";
  const symbols = unique([...analyzeInput.symbols, ...(await collectSymbols(analyzeInput.files, cwd))]);
  const diffSummary = unique([
    ...analyzeInput.diffSummary,
    ...(await collectDiffSummary(analyzeInput.files, cwd))
  ]);
  let errorLogs = unique(analyzeInput.errorLogs);

  await appendTransition(artifacts, {
    from: null,
    to: "ANALYZE",
    reason: "run initialized"
  });

  const transition = async (next: RuntimeSnapshot["state"], reason: string): Promise<void> => {
    const from = machine.current;
    machine.transition(next);
    snapshot.state = machine.current;

    await appendTransition(artifacts, {
      from,
      to: next,
      reason,
      patchAttempts,
      strategy: PATCH_STRATEGIES[strategyIndex]?.name ?? PATCH_STRATEGIES[0].name
    });
  };

  try {
    await writeOutput(artifacts, "analyze.input.json", analyzeInput);

    await transition("PLAN", "analyze complete");

    const planContext = packContext({
      objective: analyzeInput.objective,
      constraints: analyzeInput.constraints,
      symbols,
      errorLogs,
      diffSummary,
      tier: PATCH_STRATEGIES[strategyIndex].tier,
      tokenBudget: analyzeInput.contextTokenBudget
    });

    const planCall = await llm.proposePlan({ input: analyzeInput, context: planContext });
    const planOutput = PlanOutputSchema.parse(planCall.output);
    snapshot.planOutput = planOutput;

    await writePrompt(artifacts, "plan.prompt.json", {
      model: planCall.trace.model,
      endpoint: planCall.trace.endpoint,
      mode: planCall.trace.mode,
      systemPrompt: planCall.trace.systemPrompt,
      userPrompt: planCall.trace.userPrompt,
      rawResponse: planCall.trace.rawResponse
    });
    await writeOutput(artifacts, "plan.output.json", {
      context: planContext,
      output: planOutput
    });

    await transition("IMPLEMENT", "plan complete");

    while (true) {
      const strategy = PATCH_STRATEGIES[strategyIndex];
      const implementContext = packContext({
        objective: analyzeInput.objective,
        constraints: analyzeInput.constraints,
        symbols: unique([...symbols, ...planOutput.targetSymbols]),
        errorLogs,
        diffSummary,
        tier: strategy.tier,
        tokenBudget: analyzeInput.contextTokenBudget
      });

      const implementCall = await llm.proposeImplementation({
        input: analyzeInput,
        plan: planOutput,
        context: implementContext,
        patchAttempt: patchAttempts,
        strategy: strategy.name,
        lastFailure: errorLogs[0]
      });

      const implementOutput = ImplementOutputSchema.parse(implementCall.output);
      snapshot.implementOutput = implementOutput;

      await writePrompt(artifacts, `implement.prompt.attempt-${patchAttempts}.json`, {
        model: implementCall.trace.model,
        endpoint: implementCall.trace.endpoint,
        mode: implementCall.trace.mode,
        systemPrompt: implementCall.trace.systemPrompt,
        userPrompt: implementCall.trace.userPrompt,
        rawResponse: implementCall.trace.rawResponse
      });
      await writeOutput(artifacts, `implement.output.attempt-${patchAttempts}.json`, {
        strategy: strategy.name,
        context: implementContext,
        output: implementOutput
      });

      const actionResults = await executeImplementationActions(implementOutput.actions, cwd);
      await writeOutput(artifacts, `implement.actions.attempt-${patchAttempts}.json`, actionResults);

      await transition("VERIFY", `implementation attempt ${patchAttempts}`);

      const verifyOutput = VerifyOutputSchema.parse(
        await runQualityGates({ cwd, verifyLogPath: artifacts.verifyLogPath })
      );
      snapshot.verifyOutput = verifyOutput;

      await writeOutput(artifacts, `verify.output.attempt-${patchAttempts}.json`, verifyOutput);

      if (verifyOutput.passed) {
        await transition("FINISH", "all quality gates passed");
        break;
      }

      const failureSignature = verifyOutput.failureSignature ?? "unknown-failure";
      sameFailureCount = failureSignature === lastFailureSignature ? sameFailureCount + 1 : 1;
      lastFailureSignature = failureSignature;

      snapshot.sameFailureCount = sameFailureCount;

      const failureSummary = summarizeFailures(verifyOutput);
      errorLogs = unique([failureSummary, ...errorLogs]).slice(0, 20);

      if (patchAttempts >= analyzeInput.retryPolicy.maxAttempts) {
        snapshot.failReason = `Verification failed after ${patchAttempts + 1} attempt(s)`;
        await transition("FAIL", snapshot.failReason);
        break;
      }

      let switchedStrategy = false;
      if (sameFailureCount >= analyzeInput.retryPolicy.sameFailureLimit) {
        const nextStrategy = Math.min(strategyIndex + 1, PATCH_STRATEGIES.length - 1);
        if (nextStrategy > strategyIndex) {
          strategyIndex = nextStrategy;
          sameFailureCount = 0;
          snapshot.sameFailureCount = sameFailureCount;
          switchedStrategy = true;
        } else {
          snapshot.failReason = `Repeated failure signature ${failureSignature} with no remaining strategy`;
          await transition("FAIL", snapshot.failReason);
          break;
        }
      }

      await transition(
        "PATCH",
        switchedStrategy
          ? `verify failed (${failureSignature}), strategy switched to ${PATCH_STRATEGIES[strategyIndex].name}`
          : `verify failed (${failureSignature}), retry patch`
      );

      patchAttempts += 1;
      snapshot.patchAttempts = patchAttempts;

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

    await writeOutput(artifacts, "runtime.error.json", {
      message,
      stack
    });
  }

  snapshot.state = machine.current;
  snapshot.patchAttempts = patchAttempts;
  snapshot.sameFailureCount = sameFailureCount;

  await writeOutput(artifacts, "final.snapshot.json", snapshot);

  return {
    runId: artifacts.runId,
    artifactDir: artifacts.runDir,
    finalState: snapshot.state,
    snapshot
  };
}
