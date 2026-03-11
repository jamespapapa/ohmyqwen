import { describe, expect, it } from "vitest";
import { resolveInternalQmdRuntimePaths } from "../src/retrieval/qmd-runtime.js";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

describe("resolveInternalQmdRuntimePaths", () => {
  it("derives app-local qmd runtime paths for windows offline target", () => {
    const paths = resolveInternalQmdRuntimePaths("/workspace/ohmyqwen", {
      enabled: true,
      integrationMode: "internal-runtime",
      offlineStrict: true,
      targetPlatform: "win32-x64",
      contextSyncEnabled: true,
      command: "qmd",
      collectionName: "workspace",
      indexName: undefined,
      mask: "**/*.ts",
      queryMode: "query_then_search",
      runtimeRoot: ".ohmyqwen/runtime/qmd",
      vendorRoot: "vendor/qmd",
      modelsDir: ".ohmyqwen/runtime/qmd/models",
      configDir: undefined,
      cacheHome: undefined,
      indexPath: undefined,
      syncIntervalMs: 60000,
      forceFailure: false,
    });

    expect(paths.integrationMode).toBe("internal-runtime");
    expect(paths.offlineStrict).toBe(true);
    expect(paths.contextSyncEnabled).toBe(true);
    expect(paths.targetPlatform).toBe("win32-x64");
    expect(normalizePath(paths.runtimeRoot)).toContain(".ohmyqwen/runtime/qmd");
    expect(normalizePath(paths.vendorRoot)).toContain("vendor/qmd");
    expect(normalizePath(paths.vendorCliEntry)).toContain("vendor/qmd/dist/qmd.js");
    expect(normalizePath(paths.vendorRuntimeEntry)).toContain("vendor/qmd/dist/runtime.js");
    expect(normalizePath(paths.modelsDir)).toContain(".ohmyqwen/runtime/qmd/models");
    expect(normalizePath(paths.embedModelPath)).toContain(".ohmyqwen/runtime/qmd/models/embeddinggemma-300M-Q8_0.gguf");
    expect(normalizePath(paths.rerankModelPath)).toContain(".ohmyqwen/runtime/qmd/models/qwen3-reranker-0.6b-q8_0.gguf");
    expect(normalizePath(paths.generateModelPath)).toContain(".ohmyqwen/runtime/qmd/models/qmd-query-expansion-1.7B-q4_k_m.gguf");
    expect(normalizePath(paths.configDir)).toContain(".ohmyqwen/runtime/qmd/config");
    expect(normalizePath(paths.cacheHome)).toContain(".ohmyqwen/runtime/qmd/cache");
    expect(normalizePath(paths.indexesDir)).toContain(".ohmyqwen/runtime/qmd/indexes");
  });

  it("resolves explicit local model paths when configured", () => {
    const paths = resolveInternalQmdRuntimePaths("/workspace/ohmyqwen", {
      enabled: true,
      integrationMode: "internal-runtime",
      offlineStrict: true,
      targetPlatform: "win32-x64",
      contextSyncEnabled: true,
      command: "qmd",
      collectionName: "workspace",
      indexName: undefined,
      mask: "**/*.ts",
      queryMode: "query_then_search",
      runtimeRoot: ".ohmyqwen/runtime/qmd",
      vendorRoot: "vendor/qmd",
      modelsDir: ".ohmyqwen/runtime/qmd/models",
      embedModelPath: "artifacts/models/embed.gguf",
      rerankModelPath: "artifacts/models/rerank.gguf",
      generateModelPath: "artifacts/models/generate.gguf",
      configDir: undefined,
      cacheHome: undefined,
      indexPath: undefined,
      syncIntervalMs: 60000,
      forceFailure: false,
    });

    expect(normalizePath(paths.embedModelPath)).toContain("/workspace/ohmyqwen/artifacts/models/embed.gguf");
    expect(normalizePath(paths.rerankModelPath)).toContain("/workspace/ohmyqwen/artifacts/models/rerank.gguf");
    expect(normalizePath(paths.generateModelPath)).toContain("/workspace/ohmyqwen/artifacts/models/generate.gguf");
  });
});
