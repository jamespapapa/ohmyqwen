import {
  buildQmdQueryFromSignals,
  ensureQmdIndexed,
  queryQmd,
  resolveQmdRuntime
} from "../qmd-cli.js";
import { RetrievalHit, RetrievalProvider, RetrievalProviderResult } from "../types.js";
import { tokenizeQuery } from "../utils.js";

function nowIso(): string {
  return new Date().toISOString();
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function buildQueryString(context: Parameters<RetrievalProvider["run"]>[0]): string {
  const queryTokens = tokenizeQuery(context.query);
  const explicitPaths = context.query.targetFiles.map((file) => file.trim()).filter(Boolean);
  const query = buildQmdQueryFromSignals({
    task: context.query.task,
    targetFiles: context.query.targetFiles,
    diffSummary: context.query.diffSummary,
    errorLogs: context.query.errorLogs,
    verifyFeedback: context.query.verifyFeedback
  });

  return unique([...query.split(/\s+/), ...queryTokens.slice(0, 32), ...explicitPaths.slice(0, 10)])
    .join(" ")
    .slice(0, 900)
    .trim();
}

function toRetrievalHits(
  hits: Awaited<ReturnType<typeof queryQmd>>["hits"]
): RetrievalHit[] {
  return hits.map((hit) => ({
    path: hit.path,
    score: hit.score,
    reasons: unique([
      "qmd-cli",
      hit.docid ? `docid=${hit.docid}` : "",
      hit.title ? `title=${hit.title}` : "",
      hit.context ? `context=${hit.context}` : "",
      hit.snippet ? `snippet=${hit.snippet.split("\n")[0]?.slice(0, 80)}` : ""
    ])
  }));
}

export class QmdRetrievalProvider implements RetrievalProvider {
  public readonly name = "qmd" as const;

  public async run(context: Parameters<RetrievalProvider["run"]>[0]): Promise<RetrievalProviderResult> {
    const startedAt = Date.now();

    if (context.config.qmd.forceFailure) {
      return {
        provider: this.name,
        status: "failed",
        tookMs: Date.now() - startedAt,
        hits: [],
        error: "qmd provider forced failure by config"
      };
    }

    if (!context.config.qmd.enabled) {
      return {
        provider: this.name,
        status: "skipped",
        tookMs: Date.now() - startedAt,
        hits: [],
        metadata: {
          reason: "qmd-disabled"
        }
      };
    }

    const query = buildQueryString(context);
    if (!query) {
      return {
        provider: this.name,
        status: "empty",
        tookMs: Date.now() - startedAt,
        hits: [],
        metadata: {
          reason: "empty-query"
        }
      };
    }

    let runtime: ReturnType<typeof resolveQmdRuntime>;
    try {
      runtime = resolveQmdRuntime({
        cwd: context.cwd,
        command: context.config.qmd.command,
        collectionName: context.config.qmd.collectionName,
        indexName: context.config.qmd.indexName,
        mask: context.config.qmd.mask,
        queryMode: context.config.qmd.queryMode,
        configDir: context.config.qmd.configDir,
        cacheHome: context.config.qmd.cacheHome,
        indexPath: context.config.qmd.indexPath,
        timeoutMs: context.config.timeoutMs.qmd,
        syncIntervalMs: context.config.qmd.syncIntervalMs
      });
    } catch (error) {
      return {
        provider: this.name,
        status: "failed",
        tookMs: Date.now() - startedAt,
        hits: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }

    let indexMethod: "add" | "update" | "cached" | undefined;
    try {
      const indexed = await ensureQmdIndexed(runtime);
      indexMethod = indexed.method;
    } catch (error) {
      return {
        provider: this.name,
        status: "failed",
        tookMs: Date.now() - startedAt,
        hits: [],
        error: `qmd indexing failed: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          command: runtime.command,
          query,
          queryMode: runtime.queryMode,
          indexName: runtime.indexName,
          indexPath: runtime.indexPath,
          configPath: runtime.configPath,
          attemptedAt: nowIso()
        }
      };
    }

    const qmdResult = await queryQmd({
      runtime,
      query,
      limit: context.config.topK.qmd
    });

    const hits = toRetrievalHits(qmdResult.hits).slice(0, context.config.topK.qmd);

    if (qmdResult.status === "failed") {
      return {
        provider: this.name,
        status: "failed",
        tookMs: Date.now() - startedAt,
        hits: [],
        error: qmdResult.errors.join(" | ") || "qmd query failed",
        metadata: {
          command: runtime.command,
          query,
          mode: qmdResult.mode,
          queryMode: runtime.queryMode,
          indexMethod,
          indexName: runtime.indexName,
          indexPath: runtime.indexPath,
          collectionName: runtime.collectionName,
          attemptedAt: nowIso()
        }
      };
    }

    return {
      provider: this.name,
      status: hits.length > 0 ? "ok" : "empty",
      tookMs: Date.now() - startedAt,
      hits,
      metadata: {
        command: runtime.command,
        query,
        mode: qmdResult.mode,
        queryMode: runtime.queryMode,
        indexMethod,
        errors: qmdResult.errors,
        indexName: runtime.indexName,
        indexPath: runtime.indexPath,
        collectionName: runtime.collectionName,
        attemptedAt: nowIso()
      }
    };
  }
}
