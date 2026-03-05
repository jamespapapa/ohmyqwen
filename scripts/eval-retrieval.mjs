#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArg(name, fallback) {
  const index = process.argv.findIndex((entry) => entry === name);
  if (index < 0) {
    return fallback;
  }

  return process.argv[index + 1] ?? fallback;
}

function parseJsonFromStdout(stdout) {
  const trimmed = (stdout ?? "").trim();
  if (!trimmed) {
    throw new Error("empty stdout");
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("stdout does not contain JSON object");
  }

  return JSON.parse(trimmed.slice(start, end + 1));
}

function runNode(args, cwd) {
  const result = spawnSync("node", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      OHMYQWEN_EMBEDDING_ENABLED: process.env.OHMYQWEN_EMBEDDING_ENABLED ?? "0"
    }
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function ensureDist() {
  const command = runNode(["dist/cli.js", "--version"], process.cwd());
  if (command.code !== 0) {
    throw new Error(
      "dist/cli.js is required. Run `pnpm build` first before running eval:retrieval."
    );
  }
}

async function main() {
  ensureDist();

  const tasksPath = path.resolve(
    process.cwd(),
    parseArg("--tasks", "./samples/retrieval-eval.tasks.json")
  );
  const raw = await readFile(tasksPath, "utf8");
  const parsed = JSON.parse(raw);
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

  if (tasks.length === 0) {
    throw new Error(`no tasks found: ${tasksPath}`);
  }

  const taskResults = [];
  for (const task of tasks) {
    const workspaceDir = path.resolve(process.cwd(), task.workspaceDir ?? ".");
    const files = Array.isArray(task.files) ? task.files : [];
    const expectedRelevantFiles = Array.isArray(task.expectedRelevantFiles)
      ? task.expectedRelevantFiles
      : [];

    const inspect = runNode(
      [
        "dist/cli.js",
        "context",
        "inspect",
        "--task",
        task.task,
        "--files",
        files.join(","),
        "--tier",
        task.tier ?? "small",
        "--budget",
        String(task.tokenBudget ?? 1200),
        "--stage",
        task.stage ?? "IMPLEMENT"
      ],
      workspaceDir
    );

    const inspectOutput = inspect.code === 0 ? parseJsonFromStdout(inspect.stdout) : null;
    const topFragments = Array.isArray(inspectOutput?.fragments)
      ? inspectOutput.fragments.slice(0, 5).map((entry) => entry.path)
      : [];
    const retrievalHit = expectedRelevantFiles.some((file) => topFragments.includes(file));

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-eval-"));
    const inputPath = path.join(tmpDir, "input.json");
    const input = {
      taskId: task.id,
      objective: task.task,
      constraints: ["short-session", "state-machine-control"],
      files,
      symbols: task.symbols ?? [],
      errorLogs: task.errorLogs ?? [],
      diffSummary: task.diffSummary ?? [],
      contextTier: task.tier ?? "small",
      contextTokenBudget: task.tokenBudget ?? 1200,
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 0,
        sameFailureLimit: 2,
        rollbackOnVerifyFail: false
      },
      mode: task.mode ?? "feature",
      clarificationAnswers: [],
      dryRun: true
    };

    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");

    const run = runNode(["dist/cli.js", "run", "--dry-run", "--input", inputPath], workspaceDir);
    await rm(tmpDir, { recursive: true, force: true });

    const runOutput = run.code === 0 ? parseJsonFromStdout(run.stdout) : null;

    taskResults.push({
      id: task.id,
      inspectCode: inspect.code,
      runCode: run.code,
      retrievalHit,
      topFragments,
      expectedRelevantFiles,
      runFinalState: runOutput?.finalState,
      verifyPassed: runOutput?.snapshot?.verifyOutput?.passed,
      patchAttempts: runOutput?.snapshot?.patchAttempts ?? null,
      loopCount: runOutput?.snapshot?.patchAttempts === undefined ? null : runOutput.snapshot.patchAttempts + 1,
      runError: run.code === 0 ? undefined : run.stderr.trim().slice(0, 800),
      inspectError: inspect.code === 0 ? undefined : inspect.stderr.trim().slice(0, 800)
    });
  }

  const total = taskResults.length;
  const successRuns = taskResults.filter((entry) => entry.runFinalState === "FINISH").length;
  const firstPass = taskResults.filter(
    (entry) => entry.runFinalState === "FINISH" && entry.patchAttempts === 0
  ).length;
  const retrievalHits = taskResults.filter((entry) => entry.retrievalHit).length;
  const loopValues = taskResults
    .map((entry) => entry.loopCount)
    .filter((value) => typeof value === "number");
  const averageLoops =
    loopValues.length > 0
      ? Number((loopValues.reduce((sum, value) => sum + value, 0) / loopValues.length).toFixed(2))
      : null;

  const report = {
    generatedAt: new Date().toISOString(),
    tasksPath,
    metrics: {
      taskCount: total,
      runSuccessRate: total === 0 ? 0 : Number(((successRuns / total) * 100).toFixed(2)),
      averageLoopCount: averageLoops,
      verifyFirstPassRate: total === 0 ? 0 : Number(((firstPass / total) * 100).toFixed(2)),
      retrievalHitRateAt5: total === 0 ? 0 : Number(((retrievalHits / total) * 100).toFixed(2))
    },
    results: taskResults
  };

  const outputDir = path.resolve(process.cwd(), ".ohmyqwen", "eval");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `retrieval-eval-${Date.now()}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(`${JSON.stringify({ outputPath, metrics: report.metrics }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`eval-retrieval error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
