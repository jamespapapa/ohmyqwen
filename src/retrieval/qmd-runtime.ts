import path from "node:path";
import type { ResolvedRetrievalConfig } from "./types.js";

export interface InternalQmdRuntimePaths {
  integrationMode: "external-cli" | "internal-runtime";
  offlineStrict: boolean;
  contextSyncEnabled: boolean;
  targetPlatform: "win32-x64" | "darwin-arm64" | "linux-x64";
  runtimeRoot: string;
  vendorRoot: string;
  vendorCliEntry: string;
  vendorRuntimeEntry: string;
  modelsDir: string;
  embedModelPath: string;
  rerankModelPath: string;
  generateModelPath: string;
  cacheHome: string;
  configDir: string;
  indexesDir: string;
}

function resolveConfigPath(cwd: string, value: string | undefined, fallback: string): string {
  const raw = value?.trim();
  if (!raw) {
    return path.resolve(cwd, fallback);
  }
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

export function resolveInternalQmdRuntimePaths(
  cwd: string,
  qmd: ResolvedRetrievalConfig["qmd"]
): InternalQmdRuntimePaths {
  const runtimeRoot = resolveConfigPath(cwd, qmd.runtimeRoot, ".ohmyqwen/runtime/qmd");
  const vendorRoot = resolveConfigPath(cwd, qmd.vendorRoot, "vendor/qmd");
  const cacheHome = resolveConfigPath(cwd, qmd.cacheHome, path.join(runtimeRoot, "cache"));
  const configDir = resolveConfigPath(cwd, qmd.configDir, path.join(runtimeRoot, "config"));
  const modelsDir = resolveConfigPath(cwd, qmd.modelsDir, path.join(runtimeRoot, "models"));
  const indexesDir = resolveConfigPath(cwd, undefined, path.join(runtimeRoot, "indexes"));
  const embedModelPath = resolveConfigPath(
    cwd,
    qmd.embedModelPath,
    path.join(modelsDir, "embeddinggemma-300M-Q8_0.gguf")
  );
  const rerankModelPath = resolveConfigPath(
    cwd,
    qmd.rerankModelPath,
    path.join(modelsDir, "qwen3-reranker-0.6b-q8_0.gguf")
  );
  const generateModelPath = resolveConfigPath(
    cwd,
    qmd.generateModelPath,
    path.join(modelsDir, "qmd-query-expansion-1.7B-q4_k_m.gguf")
  );
  const vendorCliEntry = path.resolve(vendorRoot, "dist", "qmd.js");
  const vendorRuntimeEntry = path.resolve(vendorRoot, "dist", "runtime.js");

  return {
    integrationMode: qmd.integrationMode,
    offlineStrict: qmd.offlineStrict,
    contextSyncEnabled: qmd.contextSyncEnabled,
    targetPlatform: qmd.targetPlatform,
    runtimeRoot,
    vendorRoot,
    vendorCliEntry,
    vendorRuntimeEntry,
    modelsDir,
    embedModelPath,
    rerankModelPath,
    generateModelPath,
    cacheHome,
    configDir,
    indexesDir
  };
}
