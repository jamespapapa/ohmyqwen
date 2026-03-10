import { existsSync } from "fs";
import path from "path";
import {
  addCollection,
  addContext,
  getCollection,
  getContexts,
  getGlobalContext,
  listCollections as listConfiguredCollections,
  removeContext,
  setGlobalContext,
  setConfigIndexName,
  type NamedCollection,
} from "./collections.js";
import {
  createStore,
  hybridQuery,
  vectorSearchQuery,
  type HybridQueryResult,
  type VectorSearchResult,
} from "./store.js";
import {
  closeDb,
  indexFiles,
  setIndexName,
  vectorIndex,
} from "./qmd.js";
import {
  DEFAULT_EMBED_MODEL_URI,
  DEFAULT_GENERATE_MODEL_URI,
  DEFAULT_RERANK_MODEL_URI,
  LlamaCpp,
  setDefaultLlamaCpp,
} from "./llm.js";

export interface RuntimePaths {
  indexName?: string;
  configDir?: string;
  cacheHome?: string;
  indexPath?: string;
  modelsDir?: string;
  embedModelPath?: string;
  rerankModelPath?: string;
  generateModelPath?: string;
  offlineStrict?: boolean;
  requireModels?: boolean;
}

export interface RuntimeSearchHit {
  path: string;
  score: number;
  docid?: string;
  title?: string;
  context?: string | null;
  snippet?: string;
}

export interface RuntimeContextEntry {
  pathPrefix: string;
  contextText: string;
}

type SearchMode = "search" | "query" | "vsearch";

function setEnvIfPresent(key: string, value: string | undefined): void {
  if (value) {
    process.env[key] = value;
  }
}

async function withSuppressedOutput<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.QMD_VERBOSE === "1") {
    return fn();
  }

  const originalWrite = process.stderr.write.bind(process.stderr);
  const originalLog = console.log;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  console.log = (() => undefined) as typeof console.log;
  try {
    return await fn();
  } finally {
    process.stderr.write = originalWrite;
    console.log = originalLog;
  }
}

function defaultModelFileName(modelUri: string): string {
  return modelUri.split("/").pop() ?? modelUri;
}

function configureOfflineModels(paths: RuntimePaths): void {
  if (!paths.modelsDir && !paths.embedModelPath && !paths.rerankModelPath && !paths.generateModelPath) {
    return;
  }

  const embedPath = paths.embedModelPath
    ? path.resolve(paths.embedModelPath)
    : path.resolve(paths.modelsDir!, defaultModelFileName(DEFAULT_EMBED_MODEL_URI));
  const rerankPath = paths.rerankModelPath
    ? path.resolve(paths.rerankModelPath)
    : path.resolve(paths.modelsDir!, defaultModelFileName(DEFAULT_RERANK_MODEL_URI));
  const generatePath = paths.generateModelPath
    ? path.resolve(paths.generateModelPath)
    : path.resolve(paths.modelsDir!, defaultModelFileName(DEFAULT_GENERATE_MODEL_URI));

  const hasAllModels = [embedPath, rerankPath, generatePath].every((candidate) => existsSync(candidate));
  if (!hasAllModels) {
    if (paths.offlineStrict && paths.requireModels) {
      throw new Error(
        `qmd offlineStrict is enabled but local GGUF models are missing under ${paths.modelsDir}`
      );
    }
    return;
  }

  setDefaultLlamaCpp(
    new LlamaCpp({
      embedModel: embedPath,
      rerankModel: rerankPath,
      generateModel: generatePath,
      modelCacheDir: paths.modelsDir ?? path.dirname(embedPath),
    })
  );
}

export function initializeRuntime(paths: RuntimePaths): void {
  setEnvIfPresent("QMD_CONFIG_DIR", paths.configDir);
  setEnvIfPresent("XDG_CACHE_HOME", paths.cacheHome);
  setEnvIfPresent("INDEX_PATH", paths.indexPath);
  setEnvIfPresent("QMD_MODEL_CACHE_DIR", paths.modelsDir);
  setEnvIfPresent("QMD_EMBED_MODEL", paths.embedModelPath);
  setEnvIfPresent("QMD_RERANK_MODEL", paths.rerankModelPath);
  setEnvIfPresent("QMD_GENERATE_MODEL", paths.generateModelPath);
  setEnvIfPresent("QMD_OFFLINE_STRICT", paths.offlineStrict ? "1" : undefined);
  if (paths.indexName) {
    setIndexName(paths.indexName);
    setConfigIndexName(paths.indexName);
  }
  configureOfflineModels(paths);
}

export function listCollections(paths: RuntimePaths): NamedCollection[] {
  initializeRuntime(paths);
  return listConfiguredCollections();
}

export function ensureCollection(options: RuntimePaths & {
  collectionName: string;
  workspacePath: string;
  mask: string;
}): { added: boolean } {
  initializeRuntime(options);
  const existing = getCollection(options.collectionName);
  if (existing) {
    return { added: false };
  }
  addCollection(options.collectionName, options.workspacePath, options.mask);
  return { added: true };
}

export async function indexCollection(options: RuntimePaths & {
  collectionName: string;
  workspacePath: string;
  mask: string;
  suppressEmbedNotice?: boolean;
}): Promise<void> {
  initializeRuntime(options);
  await withSuppressedOutput(() =>
    indexFiles(
      options.workspacePath,
      options.mask,
      options.collectionName,
      options.suppressEmbedNotice ?? false
    )
  );
}

export async function embedPending(options: RuntimePaths & {
  force?: boolean;
}): Promise<void> {
  initializeRuntime({
    ...options,
    requireModels: true,
  });
  await withSuppressedOutput(() => vectorIndex(undefined, options.force ?? false));
}

export function syncContexts(options: RuntimePaths & {
  collectionName: string;
  workspacePath: string;
  mask: string;
  globalContext?: string;
  contexts?: RuntimeContextEntry[];
}): {
  added: number;
  updated: number;
  removed: number;
  globalUpdated: boolean;
} {
  initializeRuntime(options);
  if (!getCollection(options.collectionName)) {
    addCollection(options.collectionName, options.workspacePath, options.mask);
  }

  const desired = new Map(
    (options.contexts ?? [])
      .map((entry) => [entry.pathPrefix.trim(), entry.contextText.trim()] as const)
      .filter(([pathPrefix, contextText]) => pathPrefix && contextText)
  );
  const existing = getContexts(options.collectionName) ?? {};

  let added = 0;
  let updated = 0;
  let removed = 0;
  let globalUpdated = false;

  for (const pathPrefix of Object.keys(existing)) {
    if (!desired.has(pathPrefix)) {
      if (removeContext(options.collectionName, pathPrefix)) {
        removed += 1;
      }
    }
  }

  for (const [pathPrefix, contextText] of desired.entries()) {
    const previous = existing[pathPrefix];
    if (previous === contextText) {
      continue;
    }
    addContext(options.collectionName, pathPrefix, contextText);
    if (previous === undefined) {
      added += 1;
    } else {
      updated += 1;
    }
  }

  const normalizedGlobal = options.globalContext?.trim() || undefined;
  if (getGlobalContext() !== normalizedGlobal) {
    setGlobalContext(normalizedGlobal);
    globalUpdated = true;
  }

  return {
    added,
    updated,
    removed,
    globalUpdated,
  };
}

function toSearchHit(entry: {
  title: string;
  docid?: string;
  context?: string | null;
  score: number;
  body?: string;
  filepath?: string;
  file?: string;
  bestChunk?: string;
}): RuntimeSearchHit {
  const resolvedPath = entry.file ?? entry.filepath ?? "";
  return {
    path: resolvedPath,
    score: entry.score,
    docid: entry.docid,
    title: entry.title,
    context: entry.context ?? null,
    snippet: entry.bestChunk ?? entry.body,
  };
}

export async function queryRuntime(options: RuntimePaths & {
  mode: SearchMode;
  query: string;
  limit: number;
  collectionName?: string;
}): Promise<RuntimeSearchHit[]> {
  initializeRuntime({
    ...options,
    requireModels: options.mode !== "search",
  });
  const store = createStore(options.indexPath);
  try {
    if (options.mode === "search") {
      return store.searchFTS(options.query, options.limit, options.collectionName).map((entry) =>
        toSearchHit(entry)
      );
    }
    if (options.mode === "vsearch") {
      const results = await withSuppressedOutput(() =>
        vectorSearchQuery(store, options.query, {
          collection: options.collectionName,
          limit: options.limit,
        })
      );
      return results.map((entry: VectorSearchResult) =>
        toSearchHit({
          file: entry.file,
          score: entry.score,
          title: entry.title,
          context: entry.context,
          body: entry.body,
          docid: entry.docid,
        })
      );
    }
    const results = await withSuppressedOutput(() =>
      hybridQuery(store, options.query, {
        collection: options.collectionName,
        limit: options.limit,
      })
    );
    return results.map((entry: HybridQueryResult) =>
      toSearchHit({
        file: entry.file,
        score: entry.score,
        title: entry.title,
        context: entry.context,
        bestChunk: entry.bestChunk,
        docid: entry.docid,
      })
    );
  } finally {
    store.close();
    closeDb();
  }
}
