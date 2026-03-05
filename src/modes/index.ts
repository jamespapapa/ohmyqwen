import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AnalyzeInput,
  AnalyzeInputSchema,
  PlanOutputSchema,
  RunMode,
  RunModeSchema,
  VerifyOutputSchema
} from "../core/types.js";
import { inspectContext, packContext } from "../context/packer.js";
import { runQualityGates } from "../gates/verify.js";
import { OpenAICompatibleLlmClient } from "../llm/client.js";
import { runLoop } from "../loop/runner.js";
import { resolveModePolicy } from "./policies.js";
import { listVerifyProfiles } from "../gates/verify.js";

interface RunModeOptions {
  runId?: string;
  resume?: boolean;
  mode?: RunMode;
  dryRun?: boolean;
}

export async function runMode(payload: AnalyzeInput, options?: RunModeOptions): Promise<void> {
  const parsed = AnalyzeInputSchema.parse({
    ...payload,
    mode: options?.mode ?? payload.mode,
    dryRun: options?.dryRun ?? payload.dryRun
  });

  const result = await runLoop(parsed, {
    runId: options?.runId,
    resume: options?.resume,
    dryRun: options?.dryRun ?? payload.dryRun
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function planMode(payload: AnalyzeInput): Promise<void> {
  const parsed = AnalyzeInputSchema.parse(payload);
  const client = new OpenAICompatibleLlmClient();
  const mode = resolveModePolicy(parsed);

  const inspection = await inspectContext({
    cwd: process.cwd(),
    files: parsed.files,
    task: parsed.objective,
    tier: parsed.contextTier,
    tokenBudget: parsed.contextTokenBudget,
    stage: "PLAN",
    targetFiles: parsed.files,
    diffSummary: parsed.diffSummary,
    errorLogs: parsed.errorLogs
  });

  const context = packContext({
    objective: parsed.objective,
    constraints: [...parsed.constraints, `mode=${mode.mode}`, `guidance=${mode.policy.planningGuidance}`],
    symbols: Array.from(new Set([...parsed.symbols, ...inspection.packed.payload.symbols])),
    errorLogs: parsed.errorLogs,
    diffSummary: Array.from(
      new Set([...parsed.diffSummary, ...inspection.packed.payload.diffSummary])
    ),
    tier: parsed.contextTier,
    tokenBudget: parsed.contextTokenBudget,
    stage: "PLAN"
  });

  const planCall = await client.proposePlan({
    input: parsed,
    context,
    planningTemplate: mode.policy.planningGuidance
  });
  const plan = PlanOutputSchema.parse(planCall.output);

  process.stdout.write(
    `${JSON.stringify(
      {
        plan,
        trace: {
          mode: planCall.trace.mode,
          model: planCall.trace.model,
          endpoint: planCall.trace.endpoint
        },
        mode,
        inspection,
        context
      },
      null,
      2
    )}\n`
  );
}

export async function verifyMode(options?: {
  profileName?: string;
  dryRun?: boolean;
}): Promise<void> {
  const verifyLogPath = path.resolve(process.cwd(), ".ohmyqwen", "verify.latest.log");
  await fs.mkdir(path.dirname(verifyLogPath), { recursive: true });

  const verify = VerifyOutputSchema.parse(
    await runQualityGates({
      cwd: process.cwd(),
      verifyLogPath,
      profileName: options?.profileName,
      profiles: listVerifyProfiles(),
      dryRun: options?.dryRun
    })
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        verify,
        verifyLogPath
      },
      null,
      2
    )}\n`
  );
}

export async function inspectContextMode(options: {
  task: string;
  files: string[];
  tier: AnalyzeInput["contextTier"];
  tokenBudget: number;
  stage?: "PLAN" | "IMPLEMENT" | "VERIFY";
}): Promise<void> {
  const inspection = await inspectContext({
    cwd: process.cwd(),
    files: options.files,
    task: options.task,
    tier: options.tier,
    tokenBudget: options.tokenBudget,
    stage: options.stage,
    targetFiles: options.files
  });

  process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
}

export async function readAnalyzeInput(filePath?: string): Promise<AnalyzeInput> {
  if (!filePath) {
    return AnalyzeInputSchema.parse({
      taskId: "sample-v01",
      objective: "Run one controlled coding loop end-to-end",
      constraints: [
        "short-session",
        "state-machine-control",
        "structured-json-io",
        "quality-gate-before-finish"
      ],
      files: ["src/loop/runner.ts", "src/gates/verify.ts"],
      symbols: ["runLoop", "runQualityGates"],
      errorLogs: [],
      diffSummary: [],
      contextTier: "small",
      contextTokenBudget: 1200,
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 0,
        sameFailureLimit: 2,
        rollbackOnVerifyFail: false
      },
      mode: "auto",
      clarificationAnswers: [],
      dryRun: false
    });
  }

  const raw = await fs.readFile(filePath, "utf8");
  return AnalyzeInputSchema.parse(JSON.parse(raw));
}

export function parseMode(mode?: string): RunMode | undefined {
  if (!mode) {
    return undefined;
  }

  return RunModeSchema.parse(mode);
}
