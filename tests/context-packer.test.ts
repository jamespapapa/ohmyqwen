import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectContext, packContext, persistPackedContext } from "../src/context/packer.js";
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

describe("packContext", () => {
  function makeLexicalOnlyRetrievalConfig() {
    const config = defaultRetrievalConfig();
    config.providerPriority = ["lexical"];
    return config;
  }

  it("enforces hard cap and truncates oversized payload", () => {
    const oversized = "symbol ".repeat(2000);

    const packed = packContext({
      objective: "Implement controlled loop",
      constraints: ["short-session", "state-machine"],
      symbols: [oversized],
      errorLogs: ["error ".repeat(2000)],
      diffSummary: ["diff ".repeat(2000)],
      tier: "small",
      tokenBudget: 600,
      stage: "IMPLEMENT"
    });

    expect(packed.hardCapTokens).toBe(600);
    expect(packed.usedTokens).toBeLessThanOrEqual(600);
    expect(packed.truncated).toBe(true);
  });

  it("supports three context tiers", () => {
    const small = packContext({
      objective: "obj",
      constraints: [],
      symbols: ["A", "B", "C"],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      stage: "PLAN"
    });

    const big = packContext({
      objective: "obj",
      constraints: [],
      symbols: ["A", "B", "C"],
      errorLogs: [],
      diffSummary: [],
      tier: "big",
      stage: "IMPLEMENT"
    });

    expect(small.tier).toBe("small");
    expect(big.tier).toBe("big");
    expect(big.hardCapTokens).toBeGreaterThan(small.hardCapTokens);
  });

  it("uses incremental indexing cache and tracks changed files", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-packer-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "a.ts"), "export const A = 1;", "utf8");
    await writeFile(path.join(workspace, "b.ts"), "export const B = 2;", "utf8");

    const first = await inspectContext({
      cwd: workspace,
      files: ["a.ts", "b.ts"],
      task: "update feature",
      tier: "small",
      tokenBudget: 1000,
      stage: "PLAN",
      retrievalConfig: makeLexicalOnlyRetrievalConfig()
    });

    expect(first.changedFiles.sort()).toEqual(["a.ts", "b.ts"]);
    expect(first.reusedFiles).toEqual([]);

    const second = await inspectContext({
      cwd: workspace,
      files: ["a.ts", "b.ts"],
      task: "update feature",
      tier: "small",
      tokenBudget: 1000,
      stage: "PLAN",
      retrievalConfig: makeLexicalOnlyRetrievalConfig()
    });

    expect(second.changedFiles).toEqual([]);
    expect(second.reusedFiles.sort()).toEqual(["a.ts", "b.ts"]);

    await writeFile(path.join(workspace, "a.ts"), "export const A = 3;", "utf8");

    const third = await inspectContext({
      cwd: workspace,
      files: ["a.ts", "b.ts"],
      task: "update feature",
      tier: "small",
      tokenBudget: 1000,
      stage: "PLAN",
      retrievalConfig: makeLexicalOnlyRetrievalConfig()
    });

    expect(third.changedFiles).toEqual(["a.ts"]);
    expect(third.reusedFiles).toEqual(["b.ts"]);
  });

  it("sorts relevance using task/diff/error signals", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-packer-score-"));
    tempDirs.push(workspace);

    await writeFile(
      path.join(workspace, "hot.ts"),
      "export function runLoop() { return 'hot'; }",
      "utf8"
    );
    await writeFile(
      path.join(workspace, "cold.ts"),
      "export function helper() { return 'cold'; }",
      "utf8"
    );

    const inspection = await inspectContext({
      cwd: workspace,
      files: ["hot.ts", "cold.ts"],
      task: "fix runLoop verification issue",
      tier: "small",
      tokenBudget: 1200,
      stage: "IMPLEMENT",
      targetFiles: ["hot.ts"],
      diffSummary: ["+++ hot.ts"],
      errorLogs: ["error in hot.ts"],
      retrievalConfig: makeLexicalOnlyRetrievalConfig()
    });

    expect(inspection.fragments[0]?.path).toBe("hot.ts");
    expect(inspection.fragments[0]?.score).toBeGreaterThan(inspection.fragments[1]?.score ?? 0);
  });

  it("persists packed context with stable hash and payload fields", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-packer-persist-"));
    tempDirs.push(workspace);

    const packed = packContext({
      objective: "single controlled loop",
      constraints: ["short-session", "state-machine-control"],
      symbols: ["runLoop", "packContext"],
      errorLogs: [],
      diffSummary: ["src/loop/runner.ts"],
      tier: "small",
      tokenBudget: 800,
      stage: "IMPLEMENT"
    });

    const outputPath = path.join(workspace, "context.packed.json");
    const persisted = await persistPackedContext({
      outputPath,
      runId: "run-ctx",
      stage: "IMPLEMENT",
      patchAttempt: 0,
      packed,
      selectedSymbols: ["runLoop"],
      constraintFlags: ["short-session", "state-machine-control"]
    });

    const raw = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(raw) as {
      hash: string;
      payload: { objective: string };
      selectedSymbols: string[];
      constraintFlags: string[];
    };

    expect(persisted.hash).toHaveLength(16);
    expect(parsed.hash).toBe(persisted.hash);
    expect(parsed.payload.objective).toContain("single controlled loop");
    expect(parsed.selectedSymbols).toContain("runLoop");
    expect(parsed.constraintFlags).toContain("state-machine-control");
  });
});
