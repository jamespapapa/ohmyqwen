import path from "node:path";
import type { QmdSearchHit } from "./qmd-cli.js";

const NOISE_PREFIXES = ["memory/", ".ohmyqwen/", "tmp/", "temp/"];
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".java", ".kt", ".kts", ".py", ".go", ".rs", ".vue", ".jsp", ".html"]);

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function extractModuleCandidates(query: string): string[] {
  return unique((query.match(/\bdcp-[a-z0-9-]+\b/gi) ?? []).map((item) => item.toLowerCase()));
}

function extractQueryTokens(query: string): string[] {
  return unique((query.match(/[A-Za-z0-9가-힣._/-]+/g) ?? []).map((item) => item.trim()).filter(Boolean));
}

function isVendorNoisePath(filePath: string): boolean {
  const normalized = toForwardSlash(filePath).toLowerCase();
  const ext = path.extname(normalized);
  if (![".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
    return false;
  }
  const baseName = path.basename(normalized);
  if (baseName.endsWith(".min.js")) {
    return true;
  }
  return (
    normalized.startsWith("resources/inspinia/") ||
    normalized.startsWith("resources/chrome/") ||
    normalized.includes("/vendor/") ||
    normalized.includes("/third_party/") ||
    normalized.includes("/third-party/") ||
    normalized.includes("/webapp/js/ext-lib/")
  );
}

export function isQmdNoisePath(filePath: string): boolean {
  const normalized = toForwardSlash(filePath).toLowerCase();
  if (NOISE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return isVendorNoisePath(normalized);
}

export function selectEffectiveQmdQueryMode(options: {
  configuredMode: "query_then_search" | "search_only" | "query_only";
  query: string;
}): "query_then_search" | "search_only" | "query_only" {
  if (options.configuredMode !== "query_then_search") {
    return options.configuredMode;
  }

  const query = options.query.trim();
  const tokens = extractQueryTokens(query);
  const hasKorean = /[가-힣]/.test(query);
  const hasQuestionTone = /\?|해줘|설명|파악|어떻게|why|how|what|where/i.test(query);
  const hasInterfaceId = /\b[A-Z][0-9A-Z]{8}\b/.test(query);
  const camelCaseTokens = tokens.filter((token) => /[a-z][A-Z]/.test(token) || /(Service|Controller|Mapper|Repository|Client)$/.test(token));

  if (hasKorean || hasQuestionTone || tokens.length >= 3 || hasInterfaceId || camelCaseTokens.length >= 2) {
    return "search_only";
  }

  return options.configuredMode;
}

export function scoreQmdHit(options: {
  hit: QmdSearchHit;
  query: string;
  corpusId?: string;
  corpusWeight?: number;
}): number {
  const modules = extractModuleCandidates(options.query);
  const queryTokens = extractQueryTokens(options.query).map((item) => item.toLowerCase());
  const normalizedPath = toForwardSlash(options.hit.path).toLowerCase();
  const ext = path.extname(normalizedPath);
  let score = options.hit.score * 100;

  if (CODE_EXTENSIONS.has(ext)) {
    score += 80;
  }
  if (modules.some((moduleName) => normalizedPath.startsWith(`${moduleName}/`))) {
    score += 180;
  }
  if (/controller|service|mapper|repository|dao|component|page|view/.test(normalizedPath)) {
    score += 40;
  }
  if (options.corpusId === "frontend-code" && /\.(vue|jsp|html|tsx|jsx)$/.test(normalizedPath)) {
    score += 110;
  }
  if (options.corpusId === "config-xml" && /\.(xml|yml|yaml|properties)$/.test(normalizedPath)) {
    score += 65;
  }
  if (options.corpusId === "backend-code" && /\.(java|kt|kts|ts|js|py|go|rs)$/.test(normalizedPath)) {
    score += 55;
  }
  for (const token of queryTokens.slice(0, 10)) {
    if (token.length < 3) {
      continue;
    }
    if (normalizedPath.includes(token.toLowerCase())) {
      score += 18;
    }
  }

  return score * (options.corpusWeight ?? 1);
}

export function postprocessQmdHits(options: {
  hits: QmdSearchHit[];
  query: string;
  limit: number;
}): QmdSearchHit[] {
  return options.hits
    .filter((hit) => !isQmdNoisePath(hit.path))
    .map((hit) => ({
      hit,
      score: scoreQmdHit({
        hit,
        query: options.query
      })
    }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.hit.path.localeCompare(b.hit.path)))
    .map((item) => item.hit)
    .slice(0, Math.max(1, options.limit));
}
