export type RetrievalProviderName = "qmd" | "lexical" | "semantic" | "hybrid";

export type RetrievalStage = "PLAN" | "IMPLEMENT" | "VERIFY";

export interface RetrievalDocument {
  path: string;
  hash: string;
  symbols: string[];
  dependencies: string[];
  fileSummary: string;
  moduleSummary: string;
  architectureSummary: string;
  changed: boolean;
}

export interface RetrievalQuery {
  stage: RetrievalStage;
  task: string;
  targetFiles: string[];
  diffSummary: string[];
  errorLogs: string[];
  verifyFeedback: string[];
  patchAttempt: number;
}

export interface RetrievalHit {
  path: string;
  score: number;
  reasons: string[];
}

export type RetrievalProviderStatus = "ok" | "empty" | "failed" | "skipped" | "degraded";

export interface RetrievalProviderResult {
  provider: RetrievalProviderName;
  status: RetrievalProviderStatus;
  tookMs: number;
  hits: RetrievalHit[];
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievalDiagnostics {
  selectedProvider: RetrievalProviderName;
  fallbackUsed: boolean;
  fallbackReason?: string;
  providerResults: RetrievalProviderResult[];
  querySignals: {
    task: string;
    diffSummary: string[];
    errorLogs: string[];
    verifyFeedback: string[];
    targetFiles: string[];
    stage: RetrievalStage;
    patchAttempt: number;
  };
}

export interface RetrievalProviderContext {
  cwd: string;
  query: RetrievalQuery;
  documents: RetrievalDocument[];
  previous: Map<RetrievalProviderName, RetrievalProviderResult>;
  config: ResolvedRetrievalConfig;
}

export interface RetrievalProvider {
  name: RetrievalProviderName;
  run(context: RetrievalProviderContext): Promise<RetrievalProviderResult>;
}

export interface RetrievalLifecycleConfig {
  chunkVersion: string;
  retrievalVersion: string;
  autoReindexOnStale: boolean;
}

export interface EmbeddingServiceConfig {
  enabled: boolean;
  endpoint?: string;
  healthPath: string;
  embedPath: string;
  model: string;
  timeoutMs: number;
  maxBatchSize: number;
  cachePath: string;
}

export interface ResolvedRetrievalConfig {
  providerPriority: RetrievalProviderName[];
  topK: {
    qmd: number;
    lexical: number;
    semantic: number;
    hybrid: number;
    final: number;
  };
  timeoutMs: {
    qmd: number;
    semantic: number;
    provider: number;
  };
  stageTokenCaps: Partial<Record<RetrievalStage, number>>;
  embedding: EmbeddingServiceConfig;
  lifecycle: RetrievalLifecycleConfig;
  qmd: {
    enabled: boolean;
    integrationMode: "external-cli" | "internal-runtime";
    offlineStrict: boolean;
    targetPlatform: "win32-x64" | "darwin-arm64" | "linux-x64";
    command: string;
    collectionName: string;
    indexName?: string;
    mask: string;
    queryMode: "query_then_search" | "search_only" | "query_only";
    runtimeRoot?: string;
    vendorRoot?: string;
    modelsDir?: string;
    configDir?: string;
    cacheHome?: string;
    indexPath?: string;
    syncIntervalMs: number;
    forceFailure: boolean;
  };
}

export interface RetrievalChainResult {
  hits: RetrievalHit[];
  diagnostics: RetrievalDiagnostics;
}
