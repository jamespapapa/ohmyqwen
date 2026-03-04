import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { VerifyOutput } from "../core/types.js";
import { executeCommand } from "../tools/executor.js";

const DEFAULT_GATES = [
  { name: "build", command: "pnpm", args: ["run", "build"] },
  { name: "test", command: "pnpm", args: ["run", "test"] },
  { name: "lint", command: "pnpm", args: ["run", "lint"] }
] as const;

export async function runQualityGates(options?: {
  cwd?: string;
  verifyLogPath?: string;
}): Promise<VerifyOutput> {
  const gateResults: VerifyOutput["gateResults"] = [];

  for (const gate of DEFAULT_GATES) {
    const result = await executeCommand(gate.command, [...gate.args], {
      cwd: options?.cwd
    });

    const details = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");

    gateResults.push({
      name: gate.name,
      passed: result.code === 0,
      command: gate.command,
      args: [...gate.args],
      details: details || "ok"
    });

    if (options?.verifyLogPath) {
      await fs.appendFile(
        options.verifyLogPath,
        [
          `[${new Date().toISOString()}] gate=${gate.name} code=${result.code}`,
          details || "ok",
          ""
        ].join("\n"),
        "utf8"
      );
    }
  }

  const failures = gateResults.filter((gate) => !gate.passed);
  const failureSignature = failures.length
    ? createHash("sha256")
        .update(
          failures
            .map((failure) => `${failure.name}:${failure.details.slice(0, 500)}`)
            .join("\n---\n")
        )
        .digest("hex")
        .slice(0, 16)
    : undefined;

  return {
    passed: failures.length === 0,
    gateResults,
    failureSignature
  };
}
