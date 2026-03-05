import { createHash } from "node:crypto";
import { RetrievalDocument, RetrievalHit, RetrievalQuery } from "./types.js";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "when",
  "then",
  "true",
  "false",
  "null",
  "undefined",
  "error",
  "issue",
  "fix",
  "patch",
  "verify",
  "plan",
  "implement",
  "stage"
]);

export function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[^a-z0-9_./-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !STOPWORDS.has(token));
}

export function tokenizeQuery(query: RetrievalQuery): string[] {
  const merged = [
    query.task,
    ...query.diffSummary,
    ...query.errorLogs,
    ...query.verifyFeedback,
    ...query.targetFiles
  ].join(" ");

  return unique(tokenize(merged));
}

export function baseDocumentText(document: RetrievalDocument): string {
  return [
    document.path,
    document.fileSummary,
    document.moduleSummary,
    document.architectureSummary,
    ...document.symbols,
    ...document.dependencies
  ]
    .filter(Boolean)
    .join(" ");
}

export function textHash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeoutMessage: string
): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(onTimeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    const av = a[index] as number;
    const bv = b[index] as number;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA <= 0 || normB <= 0) {
    return 0;
  }

  return dot / Math.sqrt(normA * normB);
}

export function sortHits(hits: RetrievalHit[]): RetrievalHit[] {
  return [...hits].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.path.localeCompare(b.path);
  });
}
