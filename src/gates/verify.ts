import { executeTool } from "../tools/executor.js";
import { VerifyOutput } from "../core/types.js";

const DEFAULT_GATES = [
  { name: "lint", args: ["run", "lint"] },
  { name: "typecheck", args: ["run", "typecheck"] },
  { name: "test", args: ["run", "test"] }
] as const;

export async function runQualityGates(): Promise<VerifyOutput> {
  const gateResults = [] as VerifyOutput["gateResults"];

  for (const gate of DEFAULT_GATES) {
    const result = await executeTool("pnpm", [...gate.args]);
    gateResults.push({
      name: gate.name,
      passed: result.code === 0,
      details:
        result.code === 0
          ? result.stdout.trim() || "ok"
          : (result.stderr || result.stdout || "failed").trim()
    });
  }

  return {
    passed: gateResults.every((gate) => gate.passed),
    gateResults,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 }
  };
}
