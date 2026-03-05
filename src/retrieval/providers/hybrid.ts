import { RetrievalHit, RetrievalProvider, RetrievalProviderResult } from "../types.js";
import { sortHits } from "../utils.js";

function indexByPath(hits: RetrievalHit[]): Map<string, RetrievalHit> {
  const map = new Map<string, RetrievalHit>();
  for (const hit of hits) {
    const existing = map.get(hit.path);
    if (!existing || existing.score < hit.score) {
      map.set(hit.path, hit);
    }
  }
  return map;
}

export class HybridRetrievalProvider implements RetrievalProvider {
  public readonly name = "hybrid" as const;

  public async run(context: Parameters<RetrievalProvider["run"]>[0]): Promise<RetrievalProviderResult> {
    const startedAt = Date.now();
    const lexical = context.previous.get("lexical");
    const semantic = context.previous.get("semantic");

    if ((!lexical || lexical.hits.length === 0) && (!semantic || semantic.hits.length === 0)) {
      return {
        provider: this.name,
        status: "empty",
        tookMs: Date.now() - startedAt,
        hits: [],
        metadata: {
          reason: "missing-inputs"
        }
      };
    }

    const lexicalMap = indexByPath(lexical?.hits ?? []);
    const semanticMap = indexByPath(semantic?.hits ?? []);
    const merged = new Map<string, RetrievalHit>();

    for (const [path, hit] of lexicalMap) {
      merged.set(path, {
        path,
        score: hit.score * 0.65,
        reasons: [...hit.reasons, "hybrid:lexical"]
      });
    }

    for (const [path, hit] of semanticMap) {
      const existing = merged.get(path);
      const semanticScore = hit.score * 0.35;
      if (!existing) {
        merged.set(path, {
          path,
          score: semanticScore,
          reasons: [...hit.reasons, "hybrid:semantic"]
        });
      } else {
        merged.set(path, {
          path,
          score: existing.score + semanticScore,
          reasons: [...existing.reasons, ...hit.reasons, "hybrid:semantic"]
        });
      }
    }

    const hits = sortHits(Array.from(merged.values())).slice(0, context.config.topK.hybrid);

    return {
      provider: this.name,
      status: hits.length > 0 ? "ok" : "empty",
      tookMs: Date.now() - startedAt,
      hits,
      metadata: {
        lexicalHits: lexical?.hits.length ?? 0,
        semanticHits: semantic?.hits.length ?? 0
      }
    };
  }
}
