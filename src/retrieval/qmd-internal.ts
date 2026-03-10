import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveInternalQmdRuntimePaths, type InternalQmdRuntimePaths } from "./qmd-runtime.js";
import type { QmdSearchHit } from "./qmd-cli.js";
import type { ResolvedRetrievalConfig } from "./types.js";

export interface InternalQmdRuntime {
  cwd: string;
  indexName: string;
  collectionName: string;
  mask: string;
  queryMode: "query_then_search" | "search_only" | "query_only";
  timeoutMs: number;
  syncIntervalMs: number;
  indexPath: string;
  paths: InternalQmdRuntimePaths;
}

export interface InternalQmdContextEntry {
  pathPrefix: string;
  contextText: string;
}

interface InternalQmdSyncCacheEntry {
  signature: string;
  syncedAt: number;
}

const syncCache = new Map<string, InternalQmdSyncCacheEntry>();

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function resolveInternalQmdRuntime(options: {
  cwd: string;
  config: ResolvedRetrievalConfig["qmd"];
  collectionName: string;
  indexName?: string;
  mask: string;
  queryMode: "query_then_search" | "search_only" | "query_only";
  timeoutMs: number;
  syncIntervalMs: number;
}): InternalQmdRuntime {
  const cwdHash = createHash("sha1").update(path.resolve(options.cwd)).digest("hex").slice(0, 12);
  const maskHash = createHash("sha1").update(options.mask.trim()).digest("hex").slice(0, 6);
  const indexName = options.indexName?.trim() || `ohmyqwen-${cwdHash}-${maskHash}`;
  const paths = resolveInternalQmdRuntimePaths(options.cwd, options.config);
  const indexPath = path.resolve(paths.indexesDir, `${indexName}.sqlite`);
  return {
    cwd: options.cwd,
    indexName,
    collectionName: options.collectionName.trim(),
    mask: options.mask.trim(),
    queryMode: options.queryMode,
    timeoutMs: options.timeoutMs,
    syncIntervalMs: options.syncIntervalMs,
    indexPath,
    paths,
  };
}

async function loadInternalRuntimeModule(runtime: InternalQmdRuntime): Promise<any> {
  const runtimeEntry = runtime.paths.vendorRuntimeEntry.replace(/\\/g, "/");
  try {
    await fs.access(runtimeEntry);
  } catch {
    throw new Error(
      `internal qmd runtime is not built: ${runtimeEntry}. Install qmd dependencies and build vendor/qmd first.`
    );
  }

  return import(pathToFileURL(runtimeEntry).href);
}

function normalizeInternalPath(inputPath: string, runtime: InternalQmdRuntime): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return trimmed;
  }
  const qmdPrefix = `qmd://${runtime.collectionName}/`;
  if (trimmed.startsWith(qmdPrefix)) {
    return trimmed.slice(qmdPrefix.length).replace(/^\/+/, "");
  }
  if (trimmed.startsWith("qmd://")) {
    const rest = trimmed.replace(/^qmd:\/\/[A-Za-z0-9_.-]+\//, "");
    return rest.replace(/^\/+/, "");
  }
  if (path.isAbsolute(trimmed)) {
    const relative = path.relative(runtime.cwd, trimmed);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative;
    }
  }
  return trimmed.replace(/^\.\//, "");
}

export async function ensureInternalQmdIndexed(runtime: InternalQmdRuntime): Promise<{
  indexed: boolean;
  method: "add" | "update" | "cached";
  embedding: "ok" | "skipped" | "missing-models" | "failed";
}> {
  await fs.mkdir(runtime.paths.runtimeRoot, { recursive: true });
  await fs.mkdir(runtime.paths.cacheHome, { recursive: true });
  await fs.mkdir(runtime.paths.configDir, { recursive: true });
  await fs.mkdir(runtime.paths.indexesDir, { recursive: true });
  await fs.mkdir(runtime.paths.modelsDir, { recursive: true });

  const signature = createHash("sha1")
    .update(
      JSON.stringify({
        cwd: runtime.cwd,
        collection: runtime.collectionName,
        mask: runtime.mask,
        indexPath: runtime.indexPath,
        configDir: runtime.paths.configDir,
        integrationMode: runtime.paths.integrationMode,
        targetPlatform: runtime.paths.targetPlatform,
      })
    )
    .digest("hex");

  const cached = syncCache.get(runtime.indexPath);
  if (cached && cached.signature === signature && Date.now() - cached.syncedAt < runtime.syncIntervalMs) {
    return {
      indexed: true,
      method: "cached",
      embedding: runtime.queryMode === "search_only" ? "skipped" : "ok",
    };
  }

  const runtimeModule = await loadInternalRuntimeModule(runtime);
  const ensureResult = runtimeModule.ensureCollection({
    indexName: runtime.indexName,
    configDir: runtime.paths.configDir,
    cacheHome: runtime.paths.cacheHome,
    indexPath: runtime.indexPath,
    modelsDir: runtime.paths.modelsDir,
    embedModelPath: runtime.paths.embedModelPath,
    rerankModelPath: runtime.paths.rerankModelPath,
    generateModelPath: runtime.paths.generateModelPath,
    offlineStrict: runtime.paths.offlineStrict,
    collectionName: runtime.collectionName,
    workspacePath: runtime.cwd,
    mask: runtime.mask,
  }) as { added: boolean };

  await runtimeModule.indexCollection({
    indexName: runtime.indexName,
    configDir: runtime.paths.configDir,
    cacheHome: runtime.paths.cacheHome,
    indexPath: runtime.indexPath,
    modelsDir: runtime.paths.modelsDir,
    embedModelPath: runtime.paths.embedModelPath,
    rerankModelPath: runtime.paths.rerankModelPath,
    generateModelPath: runtime.paths.generateModelPath,
    offlineStrict: runtime.paths.offlineStrict,
    collectionName: runtime.collectionName,
    workspacePath: runtime.cwd,
    mask: runtime.mask,
    suppressEmbedNotice: runtime.queryMode === "search_only",
  });

  let embedding: "ok" | "skipped" | "missing-models" | "failed" =
    runtime.queryMode === "search_only" ? "skipped" : "ok";
  if (runtime.queryMode !== "search_only") {
    try {
      await runtimeModule.embedPending({
        indexName: runtime.indexName,
        configDir: runtime.paths.configDir,
        cacheHome: runtime.paths.cacheHome,
        indexPath: runtime.indexPath,
        modelsDir: runtime.paths.modelsDir,
        embedModelPath: runtime.paths.embedModelPath,
        rerankModelPath: runtime.paths.rerankModelPath,
        generateModelPath: runtime.paths.generateModelPath,
        offlineStrict: runtime.paths.offlineStrict,
        force: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/offlineStrict.*missing|model is not available locally|Cannot find package 'node-llama-cpp'/i.test(message)) {
        embedding = "missing-models";
      } else {
        embedding = "failed";
      }
    }
  }

  syncCache.set(runtime.indexPath, {
    signature,
    syncedAt: Date.now(),
  });

  return {
    indexed: true,
    method: ensureResult.added ? "add" : "update",
    embedding,
  };
}

export async function queryInternalQmd(options: {
  runtime: InternalQmdRuntime;
  query: string;
  limit: number;
}): Promise<{
  status: "ok" | "empty" | "failed";
  mode?: "query" | "search";
  hits: QmdSearchHit[];
  errors: string[];
}> {
  const trimmedQuery = options.query.trim();
  if (!trimmedQuery) {
    return {
      status: "empty",
      hits: [],
      errors: [],
    };
  }

  const runtimeModule = await loadInternalRuntimeModule(options.runtime);
  const modes: Array<"query" | "search"> =
    options.runtime.queryMode === "query_only"
      ? ["query"]
      : options.runtime.queryMode === "search_only"
        ? ["search"]
        : ["query", "search"];

  const errors: string[] = [];
  for (const mode of modes) {
    try {
      const rows = (await runtimeModule.queryRuntime({
        indexName: options.runtime.indexName,
        configDir: options.runtime.paths.configDir,
        cacheHome: options.runtime.paths.cacheHome,
        indexPath: options.runtime.indexPath,
        modelsDir: options.runtime.paths.modelsDir,
        embedModelPath: options.runtime.paths.embedModelPath,
        rerankModelPath: options.runtime.paths.rerankModelPath,
        generateModelPath: options.runtime.paths.generateModelPath,
        offlineStrict: options.runtime.paths.offlineStrict,
        mode,
        query: trimmedQuery,
        limit: options.limit,
        collectionName: options.runtime.collectionName,
      })) as Array<{
        path: string;
        score: number;
        docid?: string;
        title?: string;
        context?: string | null;
        snippet?: string;
      }>;

      const hits = rows
        .map((row) => ({
          path: normalizeInternalPath(row.path, options.runtime),
          score: row.score,
          docid: row.docid,
          title: row.title,
          context: row.context ?? undefined,
          snippet: row.snippet,
        }))
        .filter((row) => row.path)
        .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.path.localeCompare(b.path)));

      if (hits.length === 0) {
        errors.push(`${mode}:empty`);
        continue;
      }

      return {
        status: "ok",
        mode,
        hits,
        errors,
      };
    } catch (error) {
      errors.push(`${mode}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    status: "failed",
    hits: [],
    errors: unique(errors),
  };
}

export async function syncInternalQmdContexts(options: {
  runtime: InternalQmdRuntime;
  globalContext?: string;
  contexts: InternalQmdContextEntry[];
}): Promise<{
  added: number;
  updated: number;
  removed: number;
  globalUpdated: boolean;
}> {
  if (!options.runtime.paths.contextSyncEnabled) {
    return {
      added: 0,
      updated: 0,
      removed: 0,
      globalUpdated: false,
    };
  }

  await fs.mkdir(options.runtime.paths.runtimeRoot, { recursive: true });
  await fs.mkdir(options.runtime.paths.cacheHome, { recursive: true });
  await fs.mkdir(options.runtime.paths.configDir, { recursive: true });
  await fs.mkdir(options.runtime.paths.indexesDir, { recursive: true });
  await fs.mkdir(options.runtime.paths.modelsDir, { recursive: true });

  const runtimeModule = await loadInternalRuntimeModule(options.runtime);
  return runtimeModule.syncContexts({
    indexName: options.runtime.indexName,
    configDir: options.runtime.paths.configDir,
    cacheHome: options.runtime.paths.cacheHome,
    indexPath: options.runtime.indexPath,
    modelsDir: options.runtime.paths.modelsDir,
    embedModelPath: options.runtime.paths.embedModelPath,
    rerankModelPath: options.runtime.paths.rerankModelPath,
    generateModelPath: options.runtime.paths.generateModelPath,
    offlineStrict: options.runtime.paths.offlineStrict,
    collectionName: options.runtime.collectionName,
    workspacePath: options.runtime.cwd,
    mask: options.runtime.mask,
    globalContext: options.globalContext,
    contexts: options.contexts,
  }) as {
    added: number;
    updated: number;
    removed: number;
    globalUpdated: boolean;
  };
}
