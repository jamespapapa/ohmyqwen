import { promises as fs } from "node:fs";
import {
  AnalyzeInput,
  AnalyzeInputSchema,
  PlanOutputSchema,
  VerifyOutputSchema
} from "../core/types.js";
import { runLoop } from "../loop/runner.js";
import { StubLlmClient } from "../llm/client.js";
import { packContext } from "../context/packer.js";
import { runQualityGates } from "../gates/verify.js";

export async function runMode(payload: AnalyzeInput): Promise<void> {
  const parsed = AnalyzeInputSchema.parse(payload);
  const result = await runLoop(parsed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function planMode(payload: AnalyzeInput): Promise<void> {
  const parsed = AnalyzeInputSchema.parse(payload);
  const client = new StubLlmClient();
  const context = packContext({
    taskId: parsed.taskId,
    objective: parsed.objective,
    shortSession: true,
    files: parsed.files
  });

  const plan = PlanOutputSchema.parse(await client.proposePlan(parsed, context));
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

export async function verifyMode(): Promise<void> {
  const verify = VerifyOutputSchema.parse(await runQualityGates());
  process.stdout.write(`${JSON.stringify(verify, null, 2)}\n`);
}

export async function readAnalyzeInput(filePath?: string): Promise<AnalyzeInput> {
  if (!filePath) {
    return AnalyzeInputSchema.parse({
      taskId: "demo-task",
      objective: "Bootstrap runtime loop",
      constraints: ["short-session", "state-machine", "quality-gate"],
      files: ["src/"],
      retryPolicy: { maxAttempts: 1, backoffMs: 0 }
    });
  }

  const raw = await fs.readFile(filePath, "utf8");
  return AnalyzeInputSchema.parse(JSON.parse(raw));
}
