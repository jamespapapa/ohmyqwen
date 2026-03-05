import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ResolvedRetrievalConfig, RetrievalProviderName } from "./types.js";

const ProviderNameSchema = z.enum(["qmd", "lexical", "semantic", "hybrid"]);

const RetrievalConfigFileSchema = z.object({
  providerPriority: z.array(ProviderNameSchema).min(1).max(4).optional(),
  topK: z
    .object({
      qmd: z.number().int().min(1).max(200).optional(),
      lexical: z.number().int().min(1).max(200).optional(),
      semantic: z.number().int().min(1).max(200).optional(),
      hybrid: z.number().int().min(1).max(200).optional(),
      final: z.number().int().min(1).max(200).optional()
    })
    .optional(),
  timeoutMs: z
    .object({
      qmd: z.number().int().min(100).max(20000).optional(),
      semantic: z.number().int().min(100).max(20000).optional(),
      provider: z.number().int().min(100).max(20000).optional()
    })
    .optional(),
  stageTokenCaps: z
    .object({
      PLAN: z.number().int().min(200).max(12000).optional(),
      IMPLEMENT: z.number().int().min(200).max(12000).optional(),
      VERIFY: z.number().int().min(200).max(12000).optional()
    })
    .optional(),
  embedding: z
    .object({
      enabled: z.boolean().optional(),
      endpoint: z.string().url().optional(),
      healthPath: z.string().min(1).optional(),
      embedPath: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      timeoutMs: z.number().int().min(100).max(20000).optional(),
      maxBatchSize: z.number().int().min(1).max(512).optional(),
      cachePath: z.string().min(1).optional()
    })
    .optional(),
  lifecycle: z
    .object({
      chunkVersion: z.string().min(1).optional(),
      retrievalVersion: z.string().min(1).optional(),
      autoReindexOnStale: z.boolean().optional()
    })
    .optional(),
  qmd: z
    .object({
      enabled: z.boolean().optional(),
      command: z.string().min(1).optional(),
      collectionName: z.string().min(1).optional(),
      indexName: z.string().min(1).optional(),
      mask: z.string().min(1).optional(),
      queryMode: z.enum(["query_then_search", "search_only", "query_only"]).optional(),
      configDir: z.string().min(1).optional(),
      cacheHome: z.string().min(1).optional(),
      indexPath: z.string().min(1).optional(),
      syncIntervalMs: z.number().int().min(1000).max(3600_000).optional(),
      forceFailure: z.boolean().optional()
    })
    .optional()
});

type RetrievalConfigFile = z.infer<typeof RetrievalConfigFileSchema>;

const DEFAULT_CONFIG: ResolvedRetrievalConfig = {
  providerPriority: ["qmd", "hybrid", "lexical", "semantic"],
  topK: {
    qmd: 24,
    lexical: 32,
    semantic: 24,
    hybrid: 32,
    final: 40
  },
  timeoutMs: {
    qmd: 5000,
    semantic: 2500,
    provider: 3000
  },
  stageTokenCaps: {},
  embedding: {
    enabled: false,
    endpoint: undefined,
    healthPath: "/health",
    embedPath: "/embed",
    model: "local-embedding",
    timeoutMs: 2000,
    maxBatchSize: 64,
    cachePath: ".ohmyqwen/cache/embedding-cache.json"
  },
  lifecycle: {
    chunkVersion: "v1",
    retrievalVersion: "v3-qmd-cli",
    autoReindexOnStale: true
  },
  qmd: {
    enabled: true,
    command: "qmd",
    collectionName: "workspace",
    indexName: undefined,
    mask: "**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,java,kt,kts,xml,yml,yaml,py,go,rs,sql,sh}",
    queryMode: "query_then_search",
    configDir: undefined,
    cacheHome: undefined,
    indexPath: undefined,
    syncIntervalMs: 60_000,
    forceFailure: false
  }
};

function asInt(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asBool(value: string | undefined): boolean | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  if (["1", "true", "yes", "on"].includes(trimmed)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(trimmed)) {
    return false;
  }

  return undefined;
}

function uniqueProviders(value: RetrievalProviderName[]): RetrievalProviderName[] {
  const seen = new Set<RetrievalProviderName>();
  const ordered: RetrievalProviderName[] = [];
  for (const provider of value) {
    if (!seen.has(provider)) {
      seen.add(provider);
      ordered.push(provider);
    }
  }

  if (!seen.has("lexical")) {
    ordered.push("lexical");
  }

  return ordered;
}

function parseProviderPriority(value: string | undefined): RetrievalProviderName[] | undefined {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
  }

  const items = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (items.length === 0) {
    return undefined;
  }

  const parsed = items
    .map((entry) => {
      try {
        return ProviderNameSchema.parse(entry);
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is RetrievalProviderName => Boolean(entry));

  if (parsed.length === 0) {
    return undefined;
  }

  return uniqueProviders(parsed);
}

async function readConfigFile(cwd: string): Promise<RetrievalConfigFile> {
  const configPath = path.resolve(cwd, "config", "retrieval.json");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return RetrievalConfigFileSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

function normalizeEndpoint(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/\/+$/, "");
}

function normalizeOptionalPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function parseQmdQueryMode(
  value: string | undefined
): "query_then_search" | "search_only" | "query_only" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "query_then_search" || normalized === "search_only" || normalized === "query_only") {
    return normalized;
  }

  return undefined;
}

function mergeConfig(base: ResolvedRetrievalConfig, patch: RetrievalConfigFile): ResolvedRetrievalConfig {
  return {
    providerPriority: uniqueProviders(patch.providerPriority ?? base.providerPriority),
    topK: {
      ...base.topK,
      ...(patch.topK ?? {})
    },
    timeoutMs: {
      ...base.timeoutMs,
      ...(patch.timeoutMs ?? {})
    },
    stageTokenCaps: {
      ...base.stageTokenCaps,
      ...(patch.stageTokenCaps ?? {})
    },
    embedding: {
      ...base.embedding,
      ...(patch.embedding ?? {})
    },
    lifecycle: {
      ...base.lifecycle,
      ...(patch.lifecycle ?? {})
    },
    qmd: {
      ...base.qmd,
      ...(patch.qmd ?? {})
    }
  };
}

export async function resolveRetrievalConfig(
  cwd: string,
  overrides?: RetrievalConfigFile
): Promise<ResolvedRetrievalConfig> {
  const fromFile = await readConfigFile(cwd);
  let config = mergeConfig(DEFAULT_CONFIG, fromFile);

  const envProviderPriority = parseProviderPriority(process.env.OHMYQWEN_RETRIEVAL_PROVIDERS);
  if (envProviderPriority) {
    config.providerPriority = envProviderPriority;
  }

  const envStageCaps = {
    PLAN: asInt(process.env.OHMYQWEN_RETRIEVAL_STAGE_CAP_PLAN),
    IMPLEMENT: asInt(process.env.OHMYQWEN_RETRIEVAL_STAGE_CAP_IMPLEMENT),
    VERIFY: asInt(process.env.OHMYQWEN_RETRIEVAL_STAGE_CAP_VERIFY)
  };
  config.stageTokenCaps = {
    ...config.stageTokenCaps,
    ...(envStageCaps.PLAN ? { PLAN: envStageCaps.PLAN } : {}),
    ...(envStageCaps.IMPLEMENT ? { IMPLEMENT: envStageCaps.IMPLEMENT } : {}),
    ...(envStageCaps.VERIFY ? { VERIFY: envStageCaps.VERIFY } : {})
  };

  const embeddingEnabledFromEnv = asBool(process.env.OHMYQWEN_EMBEDDING_ENABLED);
  const embeddingEndpoint = normalizeEndpoint(process.env.OHMYQWEN_EMBEDDING_ENDPOINT);

  config.embedding = {
    ...config.embedding,
    enabled: embeddingEnabledFromEnv ?? config.embedding.enabled,
    endpoint: embeddingEndpoint ?? config.embedding.endpoint,
    healthPath: process.env.OHMYQWEN_EMBEDDING_HEALTH_PATH?.trim() || config.embedding.healthPath,
    embedPath: process.env.OHMYQWEN_EMBEDDING_EMBED_PATH?.trim() || config.embedding.embedPath,
    model: process.env.OHMYQWEN_EMBEDDING_MODEL?.trim() || config.embedding.model,
    timeoutMs: asInt(process.env.OHMYQWEN_EMBEDDING_TIMEOUT_MS) ?? config.embedding.timeoutMs,
    maxBatchSize: asInt(process.env.OHMYQWEN_EMBEDDING_MAX_BATCH) ?? config.embedding.maxBatchSize,
    cachePath: process.env.OHMYQWEN_EMBEDDING_CACHE_PATH?.trim() || config.embedding.cachePath
  };

  if (embeddingEndpoint && embeddingEnabledFromEnv === undefined) {
    config.embedding.enabled = true;
  }

  config.timeoutMs = {
    ...config.timeoutMs,
    qmd: asInt(process.env.OHMYQWEN_QMD_TIMEOUT_MS) ?? config.timeoutMs.qmd,
    semantic: asInt(process.env.OHMYQWEN_SEMANTIC_TIMEOUT_MS) ?? config.timeoutMs.semantic,
    provider: asInt(process.env.OHMYQWEN_RETRIEVAL_PROVIDER_TIMEOUT_MS) ?? config.timeoutMs.provider
  };

  config.lifecycle = {
    ...config.lifecycle,
    chunkVersion: process.env.OHMYQWEN_CONTEXT_CHUNK_VERSION?.trim() || config.lifecycle.chunkVersion,
    retrievalVersion:
      process.env.OHMYQWEN_RETRIEVAL_VERSION?.trim() || config.lifecycle.retrievalVersion,
    autoReindexOnStale:
      asBool(process.env.OHMYQWEN_REINDEX_ON_STALE) ?? config.lifecycle.autoReindexOnStale
  };

  config.qmd = {
    ...config.qmd,
    enabled: asBool(process.env.OHMYQWEN_QMD_ENABLED) ?? config.qmd.enabled,
    command: process.env.OHMYQWEN_QMD_COMMAND?.trim() || config.qmd.command,
    collectionName: process.env.OHMYQWEN_QMD_COLLECTION?.trim() || config.qmd.collectionName,
    indexName: process.env.OHMYQWEN_QMD_INDEX_NAME?.trim() || config.qmd.indexName,
    mask: process.env.OHMYQWEN_QMD_MASK?.trim() || config.qmd.mask,
    queryMode: parseQmdQueryMode(process.env.OHMYQWEN_QMD_QUERY_MODE) ?? config.qmd.queryMode,
    configDir: normalizeOptionalPath(process.env.OHMYQWEN_QMD_CONFIG_DIR) ?? config.qmd.configDir,
    cacheHome: normalizeOptionalPath(process.env.OHMYQWEN_QMD_CACHE_HOME) ?? config.qmd.cacheHome,
    indexPath: normalizeOptionalPath(process.env.OHMYQWEN_QMD_INDEX_PATH) ?? config.qmd.indexPath,
    syncIntervalMs:
      asInt(process.env.OHMYQWEN_QMD_SYNC_INTERVAL_MS) ?? config.qmd.syncIntervalMs,
    forceFailure: asBool(process.env.OHMYQWEN_QMD_FORCE_FAIL) ?? config.qmd.forceFailure
  };

  if (overrides) {
    config = mergeConfig(config, overrides);
  }

  config.providerPriority = uniqueProviders(config.providerPriority);

  return config;
}

export function defaultRetrievalConfig(): ResolvedRetrievalConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as ResolvedRetrievalConfig;
}
