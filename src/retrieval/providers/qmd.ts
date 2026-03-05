import { RetrievalHit, RetrievalProvider, RetrievalProviderResult } from "../types.js";
import { sortHits, tokenize, tokenizeQuery } from "../utils.js";

interface ParsedQmdQuery {
  must: string[];
  should: string[];
  verify: string[];
  paths: string[];
}

function parseQmdQuery(params: {
  task: string;
  diffSummary: string[];
  errorLogs: string[];
  verifyFeedback: string[];
}): ParsedQmdQuery {
  if ((params.task.match(/"/g)?.length ?? 0) % 2 === 1) {
    throw new Error("qmd query parse error: unmatched quote");
  }

  const must = tokenize(params.task);
  const should = tokenize([...params.diffSummary, ...params.errorLogs].join(" "));
  const verify = tokenize(params.verifyFeedback.join(" "));
  const paths = Array.from(
    new Set(
      [...params.diffSummary, ...params.errorLogs, ...params.verifyFeedback]
        .flatMap((line) => line.match(/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md|java|kt|xml)/g) ?? [])
        .map((file) => file.trim().toLowerCase())
    )
  );

  return {
    must,
    should,
    verify,
    paths
  };
}

function includesAny(text: string, tokens: string[]): string[] {
  const lower = text.toLowerCase();
  return tokens.filter((token) => lower.includes(token));
}

export class QmdRetrievalProvider implements RetrievalProvider {
  public readonly name = "qmd" as const;

  public async run(context: Parameters<RetrievalProvider["run"]>[0]): Promise<RetrievalProviderResult> {
    const startedAt = Date.now();

    if (context.config.qmd.forceFailure) {
      throw new Error("qmd provider forced failure by config");
    }

    const parsed = parseQmdQuery({
      task: context.query.task,
      diffSummary: context.query.diffSummary,
      errorLogs: context.query.errorLogs,
      verifyFeedback: context.query.verifyFeedback
    });

    const allTokens = tokenizeQuery(context.query);
    if (allTokens.length === 0) {
      return {
        provider: this.name,
        status: "empty",
        tookMs: Date.now() - startedAt,
        hits: [],
        metadata: {
          reason: "empty-token-set"
        }
      };
    }

    const hits: RetrievalHit[] = [];
    for (const document of context.documents) {
      let score = 0;
      const reasons: string[] = [];
      const joined = [
        document.path,
        document.fileSummary,
        document.moduleSummary,
        document.architectureSummary,
        ...document.symbols,
        ...document.dependencies
      ].join(" ");

      const mustHits = includesAny(joined, parsed.must);
      if (mustHits.length > 0) {
        score += mustHits.length * 3.2;
        reasons.push(`must:${mustHits.slice(0, 3).join(",")}`);
      }

      const shouldHits = includesAny(joined, parsed.should);
      if (shouldHits.length > 0) {
        score += shouldHits.length * 1.7;
        reasons.push(`should:${shouldHits.slice(0, 3).join(",")}`);
      }

      const verifyHits = includesAny(joined, parsed.verify);
      if (verifyHits.length > 0) {
        score += verifyHits.length * 2.6;
        reasons.push(`verify:${verifyHits.slice(0, 3).join(",")}`);
      }

      const normalizedPath = document.path.toLowerCase();
      if (parsed.paths.some((pathToken) => normalizedPath.endsWith(pathToken) || normalizedPath.includes(pathToken))) {
        score += 7;
        reasons.push("path-evidence");
      }

      if (context.query.targetFiles.map((entry) => entry.toLowerCase()).includes(normalizedPath)) {
        score += 10;
        reasons.push("target-file");
      }

      if (document.changed) {
        score += 4;
        reasons.push("changed");
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

    const sorted = sortHits(hits).slice(0, context.config.topK.qmd);

    return {
      provider: this.name,
      status: sorted.length > 0 ? "ok" : "empty",
      tookMs: Date.now() - startedAt,
      hits: sorted,
      metadata: {
        mustTokens: parsed.must.length,
        shouldTokens: parsed.should.length,
        verifyTokens: parsed.verify.length
      }
    };
  }
}
