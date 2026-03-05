#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  inspectContextMode,
  parseMode,
  planMode,
  readAnalyzeInput,
  runMode,
  verifyMode
} from "./modes/index.js";
import { startServer } from "./server/app.js";

function loadLocalEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");

  try {
    const raw = readFileSync(envPath, "utf8");
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const eq = trimmed.indexOf("=");
      if (eq <= 0) {
        continue;
      }

      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (!key) {
        continue;
      }

      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // optional .env file
  }
}

loadLocalEnv();

const program = new Command();

program
  .name("ohmyqwen")
  .description("Closed-network local agentic coding runtime skeleton for Qwen3")
  .version("0.1.0-alpha");

program
  .command("run")
  .description("Run full state-machine loop: ANALYZE -> PLAN -> IMPLEMENT -> VERIFY")
  .option("-i, --input <path>", "Analyze input JSON file path")
  .option("--resume <runId>", "Resume an existing run by runId")
  .option("--run-id <runId>", "Explicit runId for new run")
  .option("--mode <mode>", "Run mode: auto|feature|refactor|medium|microservice")
  .option("--dry-run", "Simulate write/patch/command execution without changing files", false)
  .action(async (opts: { input?: string; resume?: string; runId?: string; mode?: string; dryRun?: boolean }) => {
    const input = await readAnalyzeInput(opts.input);
    const mode = parseMode(opts.mode);

    await runMode(
      {
        ...input,
        ...(mode ? { mode } : {})
      },
      {
        runId: opts.resume ?? opts.runId,
        resume: Boolean(opts.resume),
        mode,
        dryRun: opts.dryRun
      }
    );
  });

program
  .command("plan")
  .description("Run PLAN stage only")
  .option("-i, --input <path>", "Analyze input JSON file path")
  .action(async (opts: { input?: string }) => {
    const input = await readAnalyzeInput(opts.input);
    await planMode(input);
  });

program
  .command("verify")
  .description("Run quality gates only")
  .option("--profile <name>", "Verify profile name (default|strict|service)")
  .option("--dry-run", "Simulate verify command execution", false)
  .action(async (opts: { profile?: string; dryRun?: boolean }) => {
    await verifyMode({ profileName: opts.profile, dryRun: opts.dryRun });
  });

const context = program.command("context").description("Context inspection utilities");

context
  .command("inspect")
  .requiredOption("--task <task>", "Task/objective for relevance scoring")
  .requiredOption("--files <paths>", "Comma-separated file paths")
  .option("--tier <tier>", "Context tier: small|mid|big", "small")
  .option("--budget <tokens>", "Token budget", "1200")
  .option("--stage <stage>", "Stage: PLAN|IMPLEMENT|VERIFY", "PLAN")
  .action(
    async (opts: {
      task: string;
      files: string;
      tier?: "small" | "mid" | "big";
      budget?: string;
      stage?: "PLAN" | "IMPLEMENT" | "VERIFY";
    }) => {
      const files = opts.files
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      await inspectContextMode({
        task: opts.task,
        files,
        tier: opts.tier ?? "small",
        tokenBudget: Number.parseInt(opts.budget ?? "1200", 10),
        stage: opts.stage ?? "PLAN"
      });
    }
  );

program
  .command("serve")
  .description("Run localhost runtime API + minimal web console")
  .option("--host <host>", "Host", "127.0.0.1")
  .option("--port <port>", "Port", "4311")
  .action(async (opts: { host?: string; port?: string }) => {
    await startServer({
      host: opts.host ?? "127.0.0.1",
      port: Number.parseInt(opts.port ?? "4311", 10)
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ohmyqwen error: ${message}\n`);
  process.exitCode = 1;
});
