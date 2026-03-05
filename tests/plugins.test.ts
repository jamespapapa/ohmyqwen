import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AnalyzeInput } from "../src/core/types.js";
import { PluginManager } from "../src/plugins/manager.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function sampleInput(): AnalyzeInput {
  return {
    taskId: "plugin-test",
    objective: "Implement feature",
    constraints: [],
    files: [],
    symbols: [],
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
    mode: "feature",
    clarificationAnswers: [],
    dryRun: true
  };
}

describe("plugin manager", () => {
  it("loads context preload when enabled", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-plugin-preload-"));
    tempDirs.push(workspace);

    await mkdir(path.join(workspace, "config"), { recursive: true });
    await mkdir(path.join(workspace, ".ohmyqwen", "cache"), { recursive: true });

    await writeFile(
      path.join(workspace, "config", "plugins.json"),
      JSON.stringify({
        plugins: [{ name: "context-preload", enabled: true, options: {} }]
      }),
      "utf8"
    );

    await writeFile(
      path.join(workspace, ".ohmyqwen", "cache", "context-preload.json"),
      JSON.stringify({ small: ["line-1", "line-2"] }),
      "utf8"
    );

    const manager = await PluginManager.create(workspace);
    const result = await manager.runHook("beforePlan", {
      cwd: workspace,
      runId: "r1",
      input: sampleInput(),
      stageAttempt: 0
    });

    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]?.plugin).toBe("context-preload");
    expect(result.contributions[0]?.context).toContain("line-1");
  });

  it("gracefully degrades gitlab plugin when env is missing", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-plugin-gitlab-"));
    tempDirs.push(workspace);

    await mkdir(path.join(workspace, "config"), { recursive: true });
    await writeFile(
      path.join(workspace, "config", "plugins.json"),
      JSON.stringify({
        plugins: [{ name: "gitlab-logs", enabled: true, options: {} }]
      }),
      "utf8"
    );

    delete process.env.OHMYQWEN_GITLAB_BASE_URL;
    delete process.env.OHMYQWEN_GITLAB_PROJECT_ID;
    delete process.env.OHMYQWEN_GITLAB_TOKEN;

    const manager = await PluginManager.create(workspace);
    const result = await manager.runHook("beforeImplement", {
      cwd: workspace,
      runId: "r1",
      input: sampleInput(),
      stageAttempt: 0
    });

    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]?.summary).toContain("disabled");
    expect(result.warnings.join(" ")).toContain("missing");
  });

  it("supports plugin on/off via config", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-plugin-off-"));
    tempDirs.push(workspace);

    await mkdir(path.join(workspace, "config"), { recursive: true });
    await writeFile(
      path.join(workspace, "config", "plugins.json"),
      JSON.stringify({
        plugins: [{ name: "context-preload", enabled: false, options: {} }]
      }),
      "utf8"
    );

    const manager = await PluginManager.create(workspace);
    const result = await manager.runHook("beforePlan", {
      cwd: workspace,
      runId: "r1",
      input: sampleInput(),
      stageAttempt: 0
    });

    expect(result.contributions).toHaveLength(0);
  });
});
