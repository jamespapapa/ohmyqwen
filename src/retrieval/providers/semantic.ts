import { promises as fs } from "node:fs";
import path from "node:path";
import { RetrievalHit, RetrievalProvider, RetrievalProviderResult } from "../types.js";
import { baseDocumentText, cosineSimilarity, sortHits, textHash, withTimeout } from "../utils.js";

interface SemanticCacheEntry {
  vector: number[];
  updatedAt: string;
}

interface SemanticCacheFile {
  version: 1;
  model: string;
  updatedAt: string;
  entries: Record<string, SemanticCacheEntry>;
}

interface EmbedResponse {
  embeddings?: number[][];
  data?: Array<{ embedding?: number[] }>;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function loadCache(filePath: string, model: string): Promise<SemanticCacheFile> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as SemanticCacheFile;
    if (parsed.version !== 1 || typeof parsed.entries !== "object") {
      throw new Error("invalid semantic cache schema");
    }

    if (parsed.model !== model) {
      return {
        version: 1,
        model,
        updatedAt: nowIso(),
        entries: {}
      };
    }

    return parsed;
  } catch {
    return {
      version: 1,
      model,
      updatedAt: nowIso(),
      entries: {}
    };
  }
}

async function saveCache(filePath: string, cache: SemanticCacheFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function normalizePathSegment(segment: string): string {
  if (!segment.startsWith("/")) {
    return `/${segment}`;
  }
  return segment;
}

class LocalEmbeddingClient {
  constructor(
    private readonly endpoint: string,
    private readonly healthPath: string,
    private readonly embedPath: string,
    private readonly timeoutMs: number,
    private readonly model: string
  ) {}

  private resolveUrl(relativePath: string): string {
    return `${this.endpoint}${normalizePathSegment(relativePath)}`;
  }

  private async request(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  public async preflight(): Promise<{ ok: boolean; message: string }> {
    const healthUrl = this.resolveUrl(this.healthPath);
    try {
      const response = await this.request(healthUrl, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        return {
          ok: false,
          message: `healthcheck failed status=${response.status}`
        };
      }

      return {
        ok: true,
        message: "ok"
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  public async embed(inputs: string[]): Promise<number[][]> {
    const embedUrl = this.resolveUrl(this.embedPath);
    const response = await this.request(embedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        input: inputs
      })
    });

    if (!response.ok) {
      throw new Error(`embedding request failed status=${response.status}`);
    }

    const payload = (await response.json()) as EmbedResponse;
    const fromEmbeddings = payload.embeddings;
    if (Array.isArray(fromEmbeddings) && fromEmbeddings.every((row) => Array.isArray(row))) {
      return fromEmbeddings.map((row) => row.map((value) => Number(value)));
    }

    const fromData = payload.data;
    if (Array.isArray(fromData)) {
      const vectors = fromData
        .map((entry) => entry.embedding)
        .filter((embedding): embedding is number[] => Array.isArray(embedding));
      if (vectors.length === inputs.length) {
        return vectors.map((row) => row.map((value) => Number(value)));
      }
    }

    throw new Error("embedding response parsing failed");
  }
}

export class SemanticRetrievalProvider implements RetrievalProvider {
  public readonly name = "semantic" as const;

  public async run(context: Parameters<RetrievalProvider["run"]>[0]): Promise<RetrievalProviderResult> {
    const startedAt = Date.now();
    const embedding = context.config.embedding;

    if (!embedding.enabled) {
      return {
        provider: this.name,
        status: "skipped",
        tookMs: Date.now() - startedAt,
        hits: [],
        metadata: {
          reason: "embedding-disabled"
        }
      };
    }

    if (!embedding.endpoint) {
      return {
        provider: this.name,
        status: "skipped",
        tookMs: Date.now() - startedAt,
        hits: [],
        metadata: {
          reason: "embedding-endpoint-missing"
        }
      };
    }

    const client = new LocalEmbeddingClient(
      embedding.endpoint,
      embedding.healthPath,
      embedding.embedPath,
      embedding.timeoutMs,
      embedding.model
    );

    const health = await withTimeout(
      client.preflight(),
      context.config.timeoutMs.semantic,
      "semantic provider timeout at preflight"
    );

    if (!health.ok) {
      return {
        provider: this.name,
        status: "degraded",
        tookMs: Date.now() - startedAt,
        hits: [],
        error: health.message,
        metadata: {
          reason: "semantic-preflight-failed"
        }
      };
    }

    const cachePath = path.isAbsolute(embedding.cachePath)
      ? embedding.cachePath
      : path.resolve(context.cwd, embedding.cachePath);
    const cache = await loadCache(cachePath, embedding.model);
    let cacheUpdated = false;

    const queryText = [
      context.query.task,
      ...context.query.diffSummary,
      ...context.query.errorLogs,
      ...context.query.verifyFeedback,
      ...context.query.targetFiles
    ]
      .filter(Boolean)
      .join("\n");

    const queryKey = textHash(`query:${embedding.model}:${queryText}`);
    const queryVector = await this.resolveVector({
      cache,
      cacheKey: queryKey,
      text: queryText,
      client,
      timeoutMs: context.config.timeoutMs.semantic
    });
    cacheUpdated ||= queryVector.cacheHit === false;

    const hits: RetrievalHit[] = [];
    const missingTexts: Array<{ key: string; text: string }> = [];
    const perDocText = new Map<string, string>();

    for (const document of context.documents) {
      const text = baseDocumentText(document);
      perDocText.set(document.path, text);
      const key = textHash(`doc:${embedding.model}:${document.hash}`);
      if (!cache.entries[key]) {
        missingTexts.push({ key, text });
      }
    }

    for (let index = 0; index < missingTexts.length; index += embedding.maxBatchSize) {
      const batch = missingTexts.slice(index, index + embedding.maxBatchSize);
      const vectors = await withTimeout(
        client.embed(batch.map((entry) => entry.text)),
        context.config.timeoutMs.semantic,
        "semantic provider timeout at embedding"
      );

      if (vectors.length !== batch.length) {
        throw new Error("semantic embedding count mismatch");
      }

      for (let vectorIndex = 0; vectorIndex < batch.length; vectorIndex += 1) {
        const entry = batch[vectorIndex] as { key: string };
        const vector = vectors[vectorIndex] as number[];
        cache.entries[entry.key] = {
          vector,
          updatedAt: nowIso()
        };
      }
      cacheUpdated = true;
    }

    for (const document of context.documents) {
      const cacheKey = textHash(`doc:${embedding.model}:${document.hash}`);
      const cached = cache.entries[cacheKey];
      if (!cached) {
        continue;
      }

      const similarity = cosineSimilarity(queryVector.vector, cached.vector);
      if (similarity <= 0) {
        continue;
      }

      let score = similarity * 100;
      const reasons = [`cosine=${similarity.toFixed(4)}`];
      const lowerText = (perDocText.get(document.path) ?? "").toLowerCase();
      const lowerPath = document.path.toLowerCase();

      if (context.query.targetFiles.map((file) => file.toLowerCase()).includes(lowerPath)) {
        score += 8;
        reasons.push("target-file-boost");
      }

      if (context.query.verifyFeedback.some((line) => line.toLowerCase().includes(lowerPath))) {
        score += 6;
        reasons.push("verify-feedback-boost");
      }

      if (context.query.errorLogs.some((line) => line.toLowerCase().includes(lowerPath))) {
        score += 4;
        reasons.push("error-feedback-boost");
      }

      if (document.changed) {
        score += 3;
        reasons.push("changed-boost");
      }

      if (
        context.query.verifyFeedback.some((line) => lowerText.includes(line.toLowerCase())) ||
        context.query.errorLogs.some((line) => lowerText.includes(line.toLowerCase()))
      ) {
        score += 2;
        reasons.push("semantic-evidence-boost");
      }

      hits.push({
        path: document.path,
        score,
        reasons
      });
    }

    if (cacheUpdated) {
      cache.updatedAt = nowIso();
      await saveCache(cachePath, cache);
    }

    const sorted = sortHits(hits).slice(0, context.config.topK.semantic);

    return {
      provider: this.name,
      status: sorted.length > 0 ? "ok" : "empty",
      tookMs: Date.now() - startedAt,
      hits: sorted,
      metadata: {
        endpoint: embedding.endpoint,
        model: embedding.model,
        cachePath,
        cacheEntries: Object.keys(cache.entries).length
      }
    };
  }

  private async resolveVector(options: {
    cache: SemanticCacheFile;
    cacheKey: string;
    text: string;
    client: LocalEmbeddingClient;
    timeoutMs: number;
  }): Promise<{ vector: number[]; cacheHit: boolean }> {
    const existing = options.cache.entries[options.cacheKey];
    if (existing) {
      return { vector: existing.vector, cacheHit: true };
    }

    const vectors = await withTimeout(
      options.client.embed([options.text]),
      options.timeoutMs,
      "semantic provider timeout while embedding query"
    );

    const vector = vectors[0];
    if (!Array.isArray(vector)) {
      throw new Error("semantic query embedding missing");
    }

    options.cache.entries[options.cacheKey] = {
      vector,
      updatedAt: nowIso()
    };

    return { vector, cacheHit: false };
  }
}
