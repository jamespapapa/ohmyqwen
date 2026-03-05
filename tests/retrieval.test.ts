import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectContext } from "../src/context/packer.js";
import { defaultRetrievalConfig } from "../src/retrieval/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function makeConfig() {
  return defaultRetrievalConfig();
}

describe("retrieval chain", () => {
  it("falls back to lexical when qmd fails", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-fallback-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "hot.ts"), "export const hotSignal = 1;", "utf8");
    await writeFile(path.join(workspace, "cold.ts"), "export const coldSignal = 2;", "utf8");

    const config = makeConfig();
    config.providerPriority = ["qmd", "lexical"];
    config.qmd.forceFailure = true;

    const inspection = await inspectContext({
      cwd: workspace,
      files: ["hot.ts", "cold.ts"],
      task: "fix hotSignal issue",
      tier: "small",
      tokenBudget: 900,
      stage: "IMPLEMENT",
      retrievalConfig: config
    });

    expect(inspection.retrieval.fallbackUsed).toBe(true);
    expect(inspection.retrieval.selectedProvider).toBe("lexical");
    expect(
      inspection.retrieval.providerResults.some(
        (result) => result.provider === "qmd" && result.status === "failed"
      )
    ).toBe(true);
  });

  it("degrades semantic provider when local embedding preflight fails", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-semantic-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "a.ts"), "export const a = 1;", "utf8");
    await writeFile(path.join(workspace, "b.ts"), "export const b = 2;", "utf8");

    const config = makeConfig();
    config.providerPriority = ["qmd", "semantic", "lexical", "hybrid"];
    config.embedding.enabled = true;
    config.embedding.endpoint = "http://127.0.0.1:65534";
    config.embedding.timeoutMs = 300;

    const inspection = await inspectContext({
      cwd: workspace,
      files: ["a.ts", "b.ts"],
      task: "update module",
      tier: "small",
      tokenBudget: 900,
      stage: "PLAN",
      retrievalConfig: config
    });

    const semantic = inspection.retrieval.providerResults.find((result) => result.provider === "semantic");
    expect(semantic).toBeTruthy();
    expect(["degraded", "failed", "skipped"]).toContain(semantic?.status);
  });

  it("injects verify feedback signal into ranking", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-feedback-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "api.ts"), "export function apiHandler() { return 1; }", "utf8");
    await writeFile(path.join(workspace, "util.ts"), "export function helperUtil() { return 2; }", "utf8");

    const config = makeConfig();
    config.providerPriority = ["lexical"];

    const inspection = await inspectContext({
      cwd: workspace,
      files: ["api.ts", "util.ts"],
      task: "apply patch",
      tier: "small",
      tokenBudget: 900,
      stage: "IMPLEMENT",
      verifyFeedback: ["TypeError from api.ts line 1"],
      retrievalConfig: config
    });

    expect(inspection.fragments[0]?.path).toBe("api.ts");
  });

  it("detects stale index lifecycle metadata and reindexes incrementally", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-lifecycle-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "m1.ts"), "export const one = 1;", "utf8");
    await writeFile(path.join(workspace, "m2.ts"), "export const two = 2;", "utf8");

    const configV1 = makeConfig();
    configV1.providerPriority = ["lexical"];
    configV1.lifecycle.chunkVersion = "v1";

    await inspectContext({
      cwd: workspace,
      files: ["m1.ts", "m2.ts"],
      task: "index modules",
      tier: "small",
      tokenBudget: 900,
      stage: "PLAN",
      retrievalConfig: configV1
    });

    const configV2 = makeConfig();
    configV2.providerPriority = ["lexical"];
    configV2.lifecycle.chunkVersion = "v2";

    const second = await inspectContext({
      cwd: workspace,
      files: ["m1.ts", "m2.ts"],
      task: "index modules",
      tier: "small",
      tokenBudget: 900,
      stage: "PLAN",
      retrievalConfig: configV2
    });

    expect(second.lifecycle.stale).toBe(true);
    expect(second.lifecycle.reindexed).toBe(true);
    expect(second.changedFiles.sort()).toEqual(["m1.ts", "m2.ts"]);
  });
});
