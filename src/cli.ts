#!/usr/bin/env node
import { Command } from "commander";
import { planMode, readAnalyzeInput, runMode, verifyMode } from "./modes/index.js";

const program = new Command();

program
  .name("ohmyqwen")
  .description("Closed-network local agentic coding runtime skeleton for Qwen3")
  .version("0.1.0");

program
  .command("run")
  .description("Run full state-machine loop: ANALYZE -> PLAN -> IMPLEMENT -> VERIFY")
  .option("-i, --input <path>", "Analyze input JSON file path")
  .action(async (opts: { input?: string }) => {
    const input = await readAnalyzeInput(opts.input);
    await runMode(input);
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
  .action(async () => {
    await verifyMode();
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ohmyqwen error: ${message}\n`);
  process.exitCode = 1;
});
