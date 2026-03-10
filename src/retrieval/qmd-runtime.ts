import path from "node:path";
import type { ResolvedRetrievalConfig } from "./types.js";

export interface InternalQmdRuntimePaths {
  integrationMode: "external-cli" | "internal-runtime";
  offlineStrict: boolean;
  targetPlatform: "win32-x64" | "darwin-arm64" | "linux-x64";
  runtimeRoot: string;
  vendorRoot: string;
  vendorEntry: string;
  modelsDir: string;
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
  const vendorEntry = path.resolve(vendorRoot, "dist", "qmd.js");

  return {
    integrationMode: qmd.integrationMode,
    offlineStrict: qmd.offlineStrict,
    targetPlatform: qmd.targetPlatform,
    runtimeRoot,
    vendorRoot,
    vendorEntry,
    modelsDir,
    cacheHome,
    configDir,
    indexesDir
  };
}
