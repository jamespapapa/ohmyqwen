import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    config.providerPriority = ["semantic", "lexical", "hybrid"];
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

  it("uses qmd CLI adapter and falls back from query to search output", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-qmd-cli-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "seed.ts"), "export const seed = 1;", "utf8");
    await writeFile(path.join(workspace, "extra.ts"), "export const extraSignal = 2;", "utf8");

    const logPath = path.join(workspace, "qmd-args.log");
    const fakeQmdPath = path.join(workspace, "qmd");
    await writeFile(
      fakeQmdPath,
      `#!/bin/sh
echo "$@" >> "${logPath}"
if [ "$3" = "collection" ]; then
  exit 0
fi
if [ "$3" = "update" ]; then
  exit 0
fi
if [ "$3" = "query" ]; then
  echo "query unavailable" 1>&2
  exit 1
fi
if [ "$3" = "search" ]; then
  cat <<'JSON'
[
  {
    "docid": "#abc123",
    "score": 8.4,
    "file": "qmd://workspace/extra.ts",
    "title": "extra",
    "snippet": "export const extraSignal = 2;"
  }
]
JSON
  exit 0
fi
echo "unsupported command" 1>&2
exit 1
`,
      "utf8"
    );
    await chmod(fakeQmdPath, 0o755);

    const config = makeConfig();
    config.providerPriority = ["qmd", "lexical"];
    config.qmd.command = fakeQmdPath;
    config.qmd.queryMode = "query_then_search";
    config.qmd.syncIntervalMs = 1;

    const inspection = await inspectContext({
      cwd: workspace,
      files: ["seed.ts"],
      task: "find extraSignal implementation",
      tier: "small",
      tokenBudget: 900,
      stage: "IMPLEMENT",
      retrievalConfig: config
    });

    expect(inspection.retrieval.selectedProvider).toBe("qmd");
    expect(inspection.fragments[0]?.path).toBe("extra.ts");
    expect(
      inspection.retrieval.providerResults.some(
        (result) => result.provider === "qmd" && result.status === "ok"
      )
    ).toBe(true);

    const logRaw = await readFile(logPath, "utf8");
    expect(logRaw).toContain("collection add");
    expect(logRaw).toContain(" query ");
    expect(logRaw).toContain(" search ");
  });

  it("retries qmd with multiple planned queries before falling back to lexical", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-qmd-retry-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "claim.ts"), "export const saveBenefitClaimDoc = 1;", "utf8");

    const logPath = path.join(workspace, "qmd-retry.log");
    const countPath = path.join(workspace, "qmd-count.txt");
    const fakeQmdPath = path.join(workspace, "qmd");
    await writeFile(
      fakeQmdPath,
      `#!/bin/sh
echo "$@" >> "${logPath}"
if [ "$3" = "collection" ]; then
  exit 0
fi
if [ "$3" = "update" ]; then
  exit 0
fi
if [ "$3" = "query" ]; then
  count=0
  if [ -f "${countPath}" ]; then
    count=$(cat "${countPath}")
  fi
  count=$((count + 1))
  echo "$count" > "${countPath}"
  if [ "$count" -eq 1 ]; then
    echo "no result" 1>&2
    exit 1
  fi
  cat <<'JSON'
[
  {
    "docid": "#claim-1",
    "score": 9.1,
    "file": "qmd://workspace/claim.ts",
    "title": "claim",
    "snippet": "export const saveBenefitClaimDoc = 1;"
  }
]
JSON
  exit 0
fi
echo "unsupported command" 1>&2
exit 1
`,
      "utf8"
    );
    await chmod(fakeQmdPath, 0o755);

    const config = makeConfig();
    config.providerPriority = ["qmd", "lexical"];
    config.qmd.command = fakeQmdPath;
    config.qmd.queryMode = "query_only";
    config.qmd.syncIntervalMs = 1;

    const inspection = await inspectContext({
      cwd: workspace,
      files: ["claim.ts"],
      task: "dcp-insurance 보험금 청구 saveBenefitClaimDoc 흐름 분석",
      tier: "small",
      tokenBudget: 900,
      stage: "IMPLEMENT",
      retrievalConfig: config
    });

    expect(inspection.retrieval.selectedProvider).toBe("qmd");
    const qmdProvider = inspection.retrieval.providerResults.find((result) => result.provider === "qmd");
    const qmdMetadata = (qmdProvider?.metadata ?? {}) as Record<string, unknown>;
    expect(Array.isArray(qmdMetadata.queriesTried)).toBe(true);
    expect((qmdMetadata.queriesTried as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(String(qmdMetadata.query ?? "")).toContain("saveBenefitClaimDoc");
    const logRaw = await readFile(logPath, "utf8");
    const queryLines = logRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(" query "));
    expect(queryLines.length).toBeGreaterThanOrEqual(2);
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
