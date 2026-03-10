import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveInternalQmdRuntimePaths } from "./qmd-runtime.js";
import type { ResolvedRetrievalConfig } from "./types.js";

export interface QmdDependencyHealth {
  name: string;
  ok: boolean;
  error?: string;
}

export interface QmdModelHealth {
  role: "embed" | "rerank" | "generate";
  path: string;
  exists: boolean;
}

export interface InternalQmdHealth {
  integrationMode: "external-cli" | "internal-runtime";
  offlineStrict: boolean;
  targetPlatform: "win32-x64" | "darwin-arm64" | "linux-x64";
  currentPlatform: string;
  contextSyncEnabled: boolean;
  runtimeRoot: string;
  vendorRoot: string;
  vendorRuntimeBuilt: boolean;
  vendorCliBuilt: boolean;
  nativeDependencies: QmdDependencyHealth[];
  models: QmdModelHealth[];
  searchReady: boolean;
  queryReady: boolean;
  warnings: string[];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function checkDependency(name: string): Promise<QmdDependencyHealth> {
  try {
    await import(name);
    return { name, ok: true };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function currentPlatformId(): string {
  return `${process.platform}-${process.arch}`;
}

export async function getInternalQmdHealth(
  cwd: string,
  qmd: ResolvedRetrievalConfig["qmd"]
): Promise<InternalQmdHealth> {
  const paths = resolveInternalQmdRuntimePaths(cwd, qmd);
  const vendorRuntimeBuilt = await fileExists(paths.vendorRuntimeEntry);
  const vendorCliBuilt = await fileExists(paths.vendorCliEntry);
  const nativeDependencies = await Promise.all(
    ["better-sqlite3", "sqlite-vec", "node-llama-cpp"].map((name) => checkDependency(name))
  );
  const models: QmdModelHealth[] = [
    { role: "embed", path: paths.embedModelPath, exists: await fileExists(paths.embedModelPath) },
    { role: "rerank", path: paths.rerankModelPath, exists: await fileExists(paths.rerankModelPath) },
    { role: "generate", path: paths.generateModelPath, exists: await fileExists(paths.generateModelPath) },
  ];

  const warnings: string[] = [];
  if (!vendorRuntimeBuilt) {
    warnings.push(`vendor runtime is not built: ${path.relative(cwd, paths.vendorRuntimeEntry)}`);
  }
  if (!vendorCliBuilt) {
    warnings.push(`vendor CLI entry is not built: ${path.relative(cwd, paths.vendorCliEntry)}`);
  }
  for (const dependency of nativeDependencies) {
    if (!dependency.ok) {
      warnings.push(`native dependency unavailable: ${dependency.name}`);
    }
  }
  for (const model of models) {
    if (!model.exists) {
      warnings.push(`missing ${model.role} model: ${path.relative(cwd, model.path)}`);
    }
  }
  if (paths.targetPlatform !== currentPlatformId()) {
    warnings.push(`current runtime platform ${currentPlatformId()} differs from target ${paths.targetPlatform}`);
  }

  const searchReady = vendorRuntimeBuilt && nativeDependencies.every((entry) => entry.ok);
  const queryReady = searchReady && models.every((entry) => entry.exists);

  return {
    integrationMode: paths.integrationMode,
    offlineStrict: paths.offlineStrict,
    targetPlatform: paths.targetPlatform,
    currentPlatform: currentPlatformId(),
    contextSyncEnabled: paths.contextSyncEnabled,
    runtimeRoot: paths.runtimeRoot,
    vendorRoot: paths.vendorRoot,
    vendorRuntimeBuilt,
    vendorCliBuilt,
    nativeDependencies,
    models,
    searchReady,
    queryReady,
    warnings,
  };
}
