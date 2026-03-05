import { RetrievalHit, RetrievalProvider, RetrievalProviderResult } from "../types.js";
import { sortHits, tokenizeQuery } from "../utils.js";

function includePath(lines: string[], path: string): boolean {
  const normalizedPath = path.toLowerCase();
  return lines.some((line) => line.toLowerCase().includes(normalizedPath));
}

function includeAny(text: string, tokens: string[]): string[] {
  const lower = text.toLowerCase();
  return tokens.filter((token) => lower.includes(token));
}

export class LexicalRetrievalProvider implements RetrievalProvider {
  public readonly name = "lexical" as const;

  public async run(context: Parameters<RetrievalProvider["run"]>[0]): Promise<RetrievalProviderResult> {
    const startedAt = Date.now();
    const queryTokens = tokenizeQuery(context.query);
    const targetFiles = context.query.targetFiles.map((file) => file.toLowerCase());
    const diffSignals = context.query.diffSummary;
    const errorSignals = context.query.errorLogs;
    const verifySignals = context.query.verifyFeedback;

    const hits: RetrievalHit[] = [];

    for (const document of context.documents) {
      let score = 0;
      const reasons: string[] = [];
      const normalizedPath = document.path.toLowerCase();

      if (targetFiles.includes(normalizedPath)) {
        score += 15;
        reasons.push("target-file");
      }

      if (document.changed) {
        score += 6;
        reasons.push("recent-change");
      }

      if (includePath(diffSignals, document.path)) {
        score += 5;
        reasons.push("diff-signal");
      }

      if (includePath(errorSignals, document.path)) {
        score += 6;
        reasons.push("error-path-match");
      }

      if (includePath(verifySignals, document.path)) {
        score += 8;
        reasons.push("verify-feedback-path-match");
      }

      const pathMatches = includeAny(document.path, queryTokens);
      if (pathMatches.length > 0) {
        score += Math.min(8, pathMatches.length * 2);
        reasons.push(`path-token:${pathMatches.slice(0, 3).join(",")}`);
      }

      const symbolMatches = document.symbols
        .filter((symbol) => queryTokens.some((token) => symbol.toLowerCase().includes(token)))
        .slice(0, 5);
      if (symbolMatches.length > 0) {
        score += symbolMatches.length * 2.5;
        reasons.push(`symbol-match:${symbolMatches.join(",")}`);
      }

      const dependencyMatches = document.dependencies
        .filter((dependency) => queryTokens.some((token) => dependency.toLowerCase().includes(token)))
        .slice(0, 5);
      if (dependencyMatches.length > 0) {
        score += dependencyMatches.length * 1.5;
        reasons.push(`dependency-match:${dependencyMatches.join(",")}`);
      }

      if (score <= 0) {
        continue;
      }

      hits.push({
        path: document.path,
        score,
        reasons
      });
    }

    const sorted = sortHits(hits).slice(0, context.config.topK.lexical);

    return {
      provider: this.name,
      status: sorted.length > 0 ? "ok" : "empty",
      tookMs: Date.now() - startedAt,
      hits: sorted,
      metadata: {
        queryTokenCount: queryTokens.length
      }
    };
  }
}
