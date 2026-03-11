import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function writeFakeQmdCommand(workspace: string, programSource: string): Promise<string> {
  const runnerPath = path.join(workspace, "fake-qmd.mjs");
  await writeFile(runnerPath, programSource, "utf8");

  if (process.platform === "win32") {
    const commandPath = path.join(workspace, "qmd.cmd");
    const nodePath = process.execPath.replace(/"/g, "\"\"");
    await writeFile(
      commandPath,
      `@echo off\r\n"${nodePath}" "%~dp0fake-qmd.mjs" %*\r\n`,
      "utf8"
    );
    return commandPath;
  }

  const commandPath = path.join(workspace, "qmd");
  const nodePath = process.execPath.replace(/"/g, "\\\"");
  await writeFile(
    commandPath,
    `#!/bin/sh\nexec "${nodePath}" "$(dirname "$0")/fake-qmd.mjs" "$@"\n`,
    "utf8"
  );
  await chmod(commandPath, 0o755);
  return commandPath;
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

  it("uses qmd CLI adapter and accepts search-mode output", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-qmd-cli-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "seed.ts"), "export const seed = 1;", "utf8");
    await writeFile(path.join(workspace, "extra.ts"), "export const extraSignal = 2;", "utf8");

    const logPath = path.join(workspace, "qmd-args.log");
    const fakeQmdPath = await writeFakeQmdCommand(
      workspace,
      `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, \`\${args.join(" ")}\\n\`);
const mode = args[2];
if (mode === "collection" || mode === "update") {
  process.exit(0);
}
if (mode === "query") {
  console.error("query unavailable");
  process.exit(1);
}
if (mode === "search") {
  process.stdout.write(JSON.stringify([
    {
      docid: "#abc123",
      score: 8.4,
      file: "qmd://workspace/extra.ts",
      title: "extra",
      snippet: "export const extraSignal = 2;"
    }
  ]));
  process.exit(0);
}
console.error("unsupported command");
process.exit(1);
`
    );

    const config = makeConfig();
    config.providerPriority = ["qmd", "lexical"];
    config.qmd.integrationMode = "external-cli";
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
    expect(logRaw).toContain(" search ");
  });

  it("retries qmd with multiple planned queries before falling back to lexical", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-qmd-retry-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "claim.ts"), "export const saveBenefitClaimDoc = 1;", "utf8");

    const logPath = path.join(workspace, "qmd-retry.log");
    const countPath = path.join(workspace, "qmd-count.txt");
    const fakeQmdPath = await writeFakeQmdCommand(
      workspace,
      `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, \`\${args.join(" ")}\\n\`);
const mode = args[2];
if (mode === "collection" || mode === "update") {
  process.exit(0);
}
if (mode === "query") {
  let count = 0;
  if (existsSync(${JSON.stringify(countPath)})) {
    count = Number.parseInt(readFileSync(${JSON.stringify(countPath)}, "utf8"), 10) || 0;
  }
  count += 1;
  writeFileSync(${JSON.stringify(countPath)}, String(count), "utf8");
  if (count === 1) {
    console.error("no result");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify([
    {
      docid: "#claim-1",
      score: 9.1,
      file: "qmd://workspace/claim.ts",
      title: "claim",
      snippet: "export const saveBenefitClaimDoc = 1;"
    }
  ]));
  process.exit(0);
}
console.error("unsupported command");
process.exit(1);
`
    );

    const config = makeConfig();
    config.providerPriority = ["qmd", "lexical"];
    config.qmd.integrationMode = "external-cli";
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
    expect(
      (qmdMetadata.queriesTried as unknown[]).some((entry) => String(entry).includes("saveBenefitClaimDoc"))
    ).toBe(true);
    const logRaw = await readFile(logPath, "utf8");
    const queryLines = logRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(" query "));
    expect(queryLines.length).toBeGreaterThanOrEqual(2);
  });

  it("uses internal qmd runtime in search_only mode without requiring local models", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-qmd-internal-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "claim.ts"), "export const lowWorkerLoan = 1;", "utf8");

    const vendorRuntimeDir = path.join(workspace, "vendor", "qmd", "dist");
    await mkdir(vendorRuntimeDir, { recursive: true });
    await writeFile(
      path.join(vendorRuntimeDir, "runtime.js"),
      `export function ensureCollection() { return { added: true }; }
export async function indexCollection() {}
export async function embedPending() { throw new Error("embed should not run in search_only"); }
export async function queryRuntime(options) {
  if (options.mode !== "search") {
    throw new Error("query path should not run in search_only");
  }
  return [{ path: "qmd://workspace-backend-code/claim.ts", score: 7.7, title: "claim" }];
}
`,
      "utf8"
    );

    const config = makeConfig();
    config.providerPriority = ["qmd", "lexical"];
    config.qmd.integrationMode = "internal-runtime";
    config.qmd.queryMode = "search_only";
    config.qmd.offlineStrict = true;
    config.qmd.vendorRoot = "vendor/qmd";
    config.qmd.syncIntervalMs = 1;

    const inspection = await inspectContext({
      cwd: workspace,
      files: ["claim.ts"],
      task: "햇살론 대출 흐름 분석",
      tier: "small",
      tokenBudget: 900,
      stage: "IMPLEMENT",
      retrievalConfig: config
    });

    expect(inspection.retrieval.selectedProvider).toBe("qmd");
    expect(inspection.fragments[0]?.path).toBe("claim.ts");
    const qmdProvider = inspection.retrieval.providerResults.find((result) => result.provider === "qmd");
    const metadata = (qmdProvider?.metadata ?? {}) as Record<string, unknown>;
    const corpusResults = Array.isArray(metadata.corpusResults) ? metadata.corpusResults : [];
    expect(corpusResults.length).toBeGreaterThan(0);
    expect(String((corpusResults[0] as Record<string, unknown>).embeddingStatus)).toBe("skipped");
  });

  it("falls back from internal qmd query to search when offline models are missing", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-qmd-internal-fallback-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "loan.ts"), "export const sunshineLoan = 1;", "utf8");

    const vendorRuntimeDir = path.join(workspace, "vendor", "qmd", "dist");
    await mkdir(vendorRuntimeDir, { recursive: true });
    await writeFile(
      path.join(vendorRuntimeDir, "runtime.js"),
      `export function ensureCollection() { return { added: true }; }
export async function indexCollection() {}
export async function embedPending() { throw new Error("qmd offlineStrict is enabled but local GGUF models are missing under /tmp/models"); }
export async function queryRuntime(options) {
  if (options.mode === "query") {
    throw new Error("offlineStrict is enabled and model is not available locally");
  }
  return [{ path: "qmd://workspace-backend-code/loan.ts", score: 8.1, title: "loan" }];
}
`,
      "utf8"
    );

    const config = makeConfig();
    config.providerPriority = ["qmd", "lexical"];
    config.qmd.integrationMode = "internal-runtime";
    config.qmd.queryMode = "query_then_search";
    config.qmd.offlineStrict = true;
    config.qmd.vendorRoot = "vendor/qmd";
    config.qmd.syncIntervalMs = 1;

    const inspection = await inspectContext({
      cwd: workspace,
      files: ["loan.ts"],
      task: "sunshine loan",
      tier: "small",
      tokenBudget: 900,
      stage: "IMPLEMENT",
      retrievalConfig: config
    });

    expect(inspection.retrieval.selectedProvider).toBe("qmd");
    expect(inspection.fragments[0]?.path).toBe("loan.ts");
    const qmdProvider = inspection.retrieval.providerResults.find((result) => result.provider === "qmd");
    const metadata = (qmdProvider?.metadata ?? {}) as Record<string, unknown>;
    expect(metadata.mode).toBe("search");
    const corpusResults = Array.isArray(metadata.corpusResults) ? metadata.corpusResults : [];
    expect(corpusResults.length).toBeGreaterThan(0);
    expect(String((corpusResults[0] as Record<string, unknown>).embeddingStatus)).toBe("missing-models");
  });



  it("fans out qmd search across frontend/backend corpora for frontend logic questions", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-qmd-corpora-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "ClaimPage.vue"), "<template><button>claim</button></template>", "utf8");
    await writeFile(path.join(workspace, "ClaimController.java"), "class ClaimController {}", "utf8");

    const logPath = path.join(workspace, "qmd-corpora.log");
    const fakeQmdPath = await writeFakeQmdCommand(
      workspace,
      `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, \`\${args.join(" ")}\\n\`);
const mode = args[2];
if (mode === "collection" || mode === "update") {
  process.exit(0);
}
if (mode === "search") {
  const collectionIndex = args.indexOf("-c");
  const collection = collectionIndex >= 0 ? args[collectionIndex + 1] ?? "" : "";
  if (collection.includes("frontend-code")) {
    process.stdout.write(JSON.stringify([
      {
        docid: "#front-1",
        score: 0.61,
        file: "qmd://workspace-frontend-code/ClaimPage.vue",
        title: "ClaimPage",
        snippet: "button click submit"
      }
    ]));
    process.exit(0);
  }
  if (collection.includes("backend-code")) {
    process.stdout.write(JSON.stringify([
      {
        docid: "#back-1",
        score: 0.89,
        file: "qmd://workspace-backend-code/ClaimController.java",
        title: "ClaimController",
        snippet: "post /claims"
      }
    ]));
    process.exit(0);
  }
  process.stdout.write("[]");
  process.exit(0);
}
console.error("unsupported command");
process.exit(1);
`
    );

    const config = makeConfig();
    config.providerPriority = ["qmd", "lexical"];
    config.qmd.integrationMode = "external-cli";
    config.qmd.command = fakeQmdPath;
    config.qmd.queryMode = "query_then_search";
    config.qmd.syncIntervalMs = 1;

    const inspection = await inspectContext({
      cwd: workspace,
      files: ["ClaimPage.vue", "ClaimController.java"],
      task: "청구 버튼 클릭 후 프론트에서 어떤 검증을 하고 어떤 API를 호출하는지 분석해줘",
      tier: "small",
      tokenBudget: 900,
      stage: "IMPLEMENT",
      retrievalConfig: config
    });

    const qmdProvider = inspection.retrieval.providerResults.find((result) => result.provider === "qmd");
    expect(inspection.retrieval.selectedProvider).toBe("qmd");
    expect(qmdProvider?.hits.map((hit) => hit.path)).toContain("ClaimPage.vue");
    expect(qmdProvider?.hits.map((hit) => hit.path)).toContain("ClaimController.java");
    expect(qmdProvider?.hits[0]?.path).toBe("ClaimPage.vue");
    const qmdMetadata = (qmdProvider?.metadata ?? {}) as Record<string, unknown>;
    expect(Array.isArray(qmdMetadata.corporaTried)).toBe(true);
    expect((qmdMetadata.corporaTried as unknown[]).map(String)).toEqual(
      expect.arrayContaining(["frontend-code", "backend-code"])
    );

    const logRaw = await readFile(logPath, "utf8");
    expect(logRaw).toContain("workspace-frontend-code");
    expect(logRaw).toContain("workspace-backend-code");
  });


  it("keeps qmd selected when one corpus fails but another corpus succeeds", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-qmd-corpora-degrade-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "ClaimPage.vue"), "<template><button>claim</button></template>", "utf8");

    const logPath = path.join(workspace, "qmd-corpora-degrade.log");
    const fakeQmdPath = await writeFakeQmdCommand(
      workspace,
      `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, \`\${args.join(" ")}\\n\`);
const mode = args[2];
if (mode === "collection" || mode === "update") {
  process.exit(0);
}
if (mode === "search") {
  const collectionIndex = args.indexOf("-c");
  const collection = collectionIndex >= 0 ? args[collectionIndex + 1] ?? "" : "";
  if (collection.includes("frontend-code")) {
    process.stdout.write(JSON.stringify([
      {
        docid: "#front-1",
        score: 0.74,
        file: "qmd://workspace-frontend-code/ClaimPage.vue",
        title: "ClaimPage",
        snippet: "button click submit"
      }
    ]));
    process.exit(0);
  }
  if (collection.includes("backend-code")) {
    console.error("backend timeout");
    process.exit(1);
  }
  process.stdout.write("[]");
  process.exit(0);
}
console.error("unsupported command");
process.exit(1);
`
    );

    const config = makeConfig();
    config.providerPriority = ["qmd", "lexical"];
    config.qmd.integrationMode = "external-cli";
    config.qmd.command = fakeQmdPath;
    config.qmd.queryMode = "query_then_search";
    config.qmd.syncIntervalMs = 1;

    const inspection = await inspectContext({
      cwd: workspace,
      files: ["ClaimPage.vue"],
      task: "청구 버튼 클릭 후 프론트 검증 로직을 분석해줘",
      tier: "small",
      tokenBudget: 900,
      stage: "IMPLEMENT",
      retrievalConfig: config
    });
    expect(inspection.retrieval.selectedProvider).toBe("qmd");
    const qmdProvider = inspection.retrieval.providerResults.find((result) => result.provider === "qmd");
    expect(qmdProvider?.status).toBe("ok");
    expect(qmdProvider?.hits[0]?.path).toBe("ClaimPage.vue");
    const qmdMetadata = (qmdProvider?.metadata ?? {}) as Record<string, unknown>;
    expect(Array.isArray(qmdMetadata.corpusResults)).toBe(true);
    expect((qmdMetadata.corpusResults as Array<Record<string, unknown>>).some((entry) => entry.id === "backend-code" && entry.status === "failed")).toBe(true);
  });

  it("forces qmd search_only for long natural-language queries to avoid query timeouts", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-retrieval-qmd-mode-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "claim.ts"), "export const saveBenefitClaimDoc = 1;", "utf8");

    const logPath = path.join(workspace, "qmd-mode.log");
    const fakeQmdPath = await writeFakeQmdCommand(
      workspace,
      `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, \`\${args.join(" ")}\\n\`);
const mode = args[2];
if (mode === "collection" || mode === "update") {
  process.exit(0);
}
if (mode === "query") {
  console.error("query should not be called for long NL queries");
  process.exit(1);
}
if (mode === "search") {
  process.stdout.write(JSON.stringify([
    {
      docid: "#claim-1",
      score: 9.4,
      file: "qmd://workspace/claim.ts",
      title: "claim",
      snippet: "export const saveBenefitClaimDoc = 1;"
    }
  ]));
  process.exit(0);
}
console.error("unsupported command");
process.exit(1);
`
    );

    const config = makeConfig();
    config.providerPriority = ["qmd", "lexical"];
    config.qmd.integrationMode = "external-cli";
    config.qmd.command = fakeQmdPath;
    config.qmd.queryMode = "query_then_search";
    config.qmd.syncIntervalMs = 1;

    const inspection = await inspectContext({
      cwd: workspace,
      files: ["claim.ts"],
      task: "dcp-insurance 내부에서 보험금 청구 로직이 어떻게 실행되는지, 큰 그림에서 탑다운 방식으로 파악해줘.",
      tier: "small",
      tokenBudget: 900,
      stage: "IMPLEMENT",
      retrievalConfig: config
    });

    expect(inspection.retrieval.selectedProvider).toBe("qmd");
    expect(inspection.fragments[0]?.path).toBe("claim.ts");

    const logRaw = await readFile(logPath, "utf8");
    expect(logRaw).toContain(" search ");
    expect(logRaw).not.toContain(" query ");
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
