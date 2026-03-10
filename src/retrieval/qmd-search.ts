import { buildQmdCorpusQueryCandidates, planQmdCorpusSearch, type QmdCorpusId } from "./qmd-corpora.js";
import { ensureQmdIndexed, queryQmd, resolveQmdRuntime, type QmdSearchHit } from "./qmd-cli.js";
import { ensureInternalQmdIndexed, queryInternalQmd, resolveInternalQmdRuntime } from "./qmd-internal.js";
import { postprocessQmdHits, scoreQmdHit, selectEffectiveQmdQueryMode } from "./qmd-strategy.js";
import type { ResolvedRetrievalConfig } from "./types.js";

interface QmdSignalInput {
  task: string;
  targetFiles?: string[];
  diffSummary?: string[];
  errorLogs?: string[];
  verifyFeedback?: string[];
}

interface RunQmdMultiCorpusOptions {
  cwd: string;
  signals: QmdSignalInput;
  config: ResolvedRetrievalConfig["qmd"];
  timeoutMs: number;
  limit: number;
}

export interface QmdCorpusAttempt {
  id: QmdCorpusId;
  weight: number;
  status: "ok" | "empty" | "failed";
  query?: string;
  queriesTried: string[];
  errors: string[];
  mode?: "query" | "search";
  indexMethod?: "add" | "update" | "cached";
  embeddingStatus?: "ok" | "skipped" | "missing-models" | "failed";
  collectionName: string;
  indexName: string;
}

export interface RunQmdMultiCorpusResult {
  status: "ok" | "empty" | "failed";
  hits: QmdSearchHit[];
  errors: string[];
  mode?: "query" | "search";
  queryMode: "query_then_search" | "search_only" | "query_only";
  queriesTried: string[];
  corporaTried: QmdCorpusId[];
  corpusResults: QmdCorpusAttempt[];
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function withCorpusSuffix(base: string | undefined, suffix: string): string | undefined {
  const trimmed = base?.trim();
  if (!trimmed) {
    return undefined;
  }
  return `${trimmed}-${suffix}`;
}

function resolveEmbeddingStatus(indexed: { method: "add" | "update" | "cached" } | {
  method: "add" | "update" | "cached";
  embedding: "ok" | "skipped" | "missing-models" | "failed";
}): "ok" | "skipped" | "missing-models" | "failed" | undefined {
  return "embedding" in indexed ? indexed.embedding : undefined;
}

export async function runQmdMultiCorpusSearch(options: RunQmdMultiCorpusOptions): Promise<RunQmdMultiCorpusResult> {
  const queryMode = selectEffectiveQmdQueryMode({
    configuredMode: options.config.queryMode,
    query: options.signals.task
  });
  const corpusPlan = planQmdCorpusSearch(options.signals);
  const attempts: QmdCorpusAttempt[] = [];
  const merged = new Map<string, { hit: QmdSearchHit; score: number }>();
  const allErrors: string[] = [];
  let overallMode: "query" | "search" | undefined;

  for (const corpus of corpusPlan.activeCorpora) {
    const collectionName =
      withCorpusSuffix(options.config.collectionName, corpus.collectionSuffix) ?? corpus.collectionSuffix;
    const indexName = withCorpusSuffix(options.config.indexName, corpus.collectionSuffix);

    try {
      const indexed =
        options.config.integrationMode === "internal-runtime"
          ? await ensureInternalQmdIndexed(
              resolveInternalQmdRuntime({
                cwd: options.cwd,
                config: options.config,
                collectionName,
                indexName,
                mask: corpus.mask,
                queryMode,
                timeoutMs: options.timeoutMs,
                syncIntervalMs: options.config.syncIntervalMs,
              })
            )
          : await ensureQmdIndexed(
              resolveQmdRuntime({
                cwd: options.cwd,
                command: options.config.command,
                collectionName,
                indexName,
                mask: corpus.mask,
                queryMode,
                configDir: options.config.configDir,
                cacheHome: options.config.cacheHome,
                indexPath: options.config.indexPath,
                timeoutMs: options.timeoutMs,
                syncIntervalMs: options.config.syncIntervalMs,
              })
            );
      const queries = buildQmdCorpusQueryCandidates(corpus.id, options.signals);
      let usedQuery = "";
      let qmdResult: Awaited<ReturnType<typeof queryQmd>> = {
        status: "empty",
        hits: [],
        errors: []
      };

      for (const candidate of queries) {
        const query = candidate.trim();
        if (!query) {
          continue;
        }
        const result =
          options.config.integrationMode === "internal-runtime"
            ? await queryInternalQmd({
                runtime: resolveInternalQmdRuntime({
                  cwd: options.cwd,
                  config: options.config,
                  collectionName,
                  indexName,
                  mask: corpus.mask,
                  queryMode,
                  timeoutMs: options.timeoutMs,
                  syncIntervalMs: options.config.syncIntervalMs,
                }),
                query,
                limit: options.limit,
              })
            : await queryQmd({
                runtime: resolveQmdRuntime({
                  cwd: options.cwd,
                  command: options.config.command,
                  collectionName,
                  indexName,
                  mask: corpus.mask,
                  queryMode,
                  configDir: options.config.configDir,
                  cacheHome: options.config.cacheHome,
                  indexPath: options.config.indexPath,
                  timeoutMs: options.timeoutMs,
                  syncIntervalMs: options.config.syncIntervalMs,
                }),
                query,
                limit: options.limit,
              });
        usedQuery = query;
        qmdResult = {
          ...result,
          errors: unique([...qmdResult.errors, ...result.errors])
        };
        if (result.status === "ok" && result.hits.length > 0) {
          break;
        }
      }

      attempts.push({
        id: corpus.id,
        weight: corpus.weight,
        status: qmdResult.status,
        query: usedQuery,
        queriesTried: queries,
        errors: qmdResult.errors,
        mode: qmdResult.mode,
        indexMethod: indexed.method,
        embeddingStatus: resolveEmbeddingStatus(indexed),
        collectionName,
        indexName: indexName ?? ""
      });
      allErrors.push(...qmdResult.errors);
      if (!overallMode && qmdResult.mode) {
        overallMode = qmdResult.mode;
      }

      if (qmdResult.status !== "ok") {
        continue;
      }

      const rankedHits = postprocessQmdHits({
        hits: qmdResult.hits,
        query: options.signals.task,
        limit: options.limit
      });
      for (const hit of rankedHits) {
        const score = scoreQmdHit({
          hit,
          query: options.signals.task,
          corpusId: corpus.id,
          corpusWeight: corpus.weight
        });
        const existing = merged.get(hit.path);
        if (!existing || score > existing.score) {
          merged.set(hit.path, { hit, score });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({
        id: corpus.id,
        weight: corpus.weight,
        status: "failed",
        query: "",
        queriesTried: buildQmdCorpusQueryCandidates(corpus.id, options.signals),
        errors: [message],
        collectionName,
        indexName: indexName ?? ""
      });
      allErrors.push(message);
    }
  }

  const hits = Array.from(merged.entries())
    .sort((a, b) => (b[1].score !== a[1].score ? b[1].score - a[1].score : a[0].localeCompare(b[0])))
    .map((entry) => entry[1].hit)
    .slice(0, Math.max(1, options.limit));

  const okAttempts = attempts.filter((entry) => entry.status === "ok");
  return {
    status: hits.length > 0 ? "ok" : okAttempts.length > 0 ? "empty" : attempts.some((entry) => entry.status === "failed") ? "failed" : "empty",
    hits,
    errors: unique(allErrors),
    mode: overallMode,
    queryMode,
    queriesTried: unique(attempts.flatMap((entry) => entry.queriesTried)),
    corporaTried: attempts.map((entry) => entry.id),
    corpusResults: attempts
  };
}
