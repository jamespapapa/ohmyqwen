import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getInternalQmdHealth } from "../src/retrieval/qmd-health.js";
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

describe("getInternalQmdHealth", () => {
  it("reports missing vendor runtime and models", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-qmd-health-"));
    tempDirs.push(workspace);

    const config = defaultRetrievalConfig();
    config.qmd.integrationMode = "internal-runtime";
    config.qmd.offlineStrict = true;
    config.qmd.vendorRoot = "vendor/qmd";

    const health = await getInternalQmdHealth(workspace, config.qmd);

    expect(health.integrationMode).toBe("internal-runtime");
    expect(health.vendorRuntimeBuilt).toBe(false);
    expect(health.searchReady).toBe(false);
    expect(health.queryReady).toBe(false);
    expect(health.models.every((entry) => entry.exists === false)).toBe(true);
    expect(health.warnings.some((entry) => entry.includes("vendor runtime is not built"))).toBe(true);
  });

  it("reports queryReady when runtime and model files exist", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-qmd-health-ready-"));
    tempDirs.push(workspace);

    await mkdir(path.join(workspace, "vendor", "qmd", "dist"), { recursive: true });
    await mkdir(path.join(workspace, ".ohmyqwen", "runtime", "qmd", "models"), { recursive: true });
    await writeFile(path.join(workspace, "vendor", "qmd", "dist", "runtime.js"), "export {};\n", "utf8");
    await writeFile(path.join(workspace, "vendor", "qmd", "dist", "qmd.js"), "export {};\n", "utf8");
    await writeFile(
      path.join(workspace, ".ohmyqwen", "runtime", "qmd", "models", "embeddinggemma-300M-Q8_0.gguf"),
      "x",
      "utf8"
    );
    await writeFile(
      path.join(workspace, ".ohmyqwen", "runtime", "qmd", "models", "qwen3-reranker-0.6b-q8_0.gguf"),
      "x",
      "utf8"
    );
    await writeFile(
      path.join(workspace, ".ohmyqwen", "runtime", "qmd", "models", "qmd-query-expansion-1.7B-q4_k_m.gguf"),
      "x",
      "utf8"
    );

    const config = defaultRetrievalConfig();
    config.qmd.integrationMode = "internal-runtime";
    config.qmd.offlineStrict = true;

    const health = await getInternalQmdHealth(workspace, config.qmd);

    expect(health.vendorRuntimeBuilt).toBe(true);
    expect(health.vendorCliBuilt).toBe(true);
    expect(health.models.every((entry) => entry.exists)).toBe(true);
    expect(health.queryReady).toBe(true);
  });
});
