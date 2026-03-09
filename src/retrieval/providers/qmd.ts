import { runQmdMultiCorpusSearch } from "../qmd-search.js";
import type { QmdSearchHit } from "../qmd-cli.js";
import { RetrievalHit, RetrievalProvider, RetrievalProviderResult } from "../types.js";
import { tokenizeQuery } from "../utils.js";

function nowIso(): string {
  return new Date().toISOString();
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function toRetrievalHits(
  hits: QmdSearchHit[]
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

    const taskText = context.query.task.trim();
    const queryTokens = tokenizeQuery(context.query);
    if (!taskText && queryTokens.length === 0 && context.query.targetFiles.length === 0) {
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

    try {
      const qmdResult = await runQmdMultiCorpusSearch({
        cwd: context.cwd,
        signals: {
          task: context.query.task,
          targetFiles: context.query.targetFiles,
          diffSummary: context.query.diffSummary,
          errorLogs: context.query.errorLogs,
          verifyFeedback: context.query.verifyFeedback
        },
        config: context.config.qmd,
        timeoutMs: context.config.timeoutMs.qmd,
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
            command: context.config.qmd.command,
            query: qmdResult.corpusResults.find((entry) => entry.status === "ok")?.query ?? "",
            queriesTried: qmdResult.queriesTried,
            corporaTried: qmdResult.corporaTried,
            corpusResults: qmdResult.corpusResults,
            mode: qmdResult.mode,
            queryMode: qmdResult.queryMode,
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
          command: context.config.qmd.command,
          query: qmdResult.corpusResults.find((entry) => entry.status === "ok")?.query ?? "",
          queriesTried: qmdResult.queriesTried,
          corporaTried: qmdResult.corporaTried,
          corpusResults: qmdResult.corpusResults,
          mode: qmdResult.mode,
          queryMode: qmdResult.queryMode,
          errors: qmdResult.errors,
          attemptedAt: nowIso()
        }
      };
    } catch (error) {
      return {
        provider: this.name,
        status: "failed",
        tookMs: Date.now() - startedAt,
        hits: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
