import path from "node:path";
import type { QmdSearchHit } from "./qmd-cli.js";

const NOISE_PREFIXES = ["memory/", ".ohmyqwen/", "tmp/", "temp/"];
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".java", ".kt", ".kts", ".py", ".go", ".rs", ".vue", ".jsp", ".html"]);
const PATH_SIGNAL_STOP_WORDS = new Set([
  "src",
  "main",
  "test",
  "tests",
  "java",
  "kotlin",
  "resources",
  "views",
  "view",
  "pages",
  "page",
  "components",
  "component",
  "controller",
  "service",
  "services",
  "mapper",
  "mappers",
  "repository",
  "repositories",
  "dao",
  "model",
  "models",
  "entity",
  "entities",
  "com",
  "org",
  "net",
  "api",
  "gw"
]);

export interface QmdRerankContext {
  preferredPathTokens?: string[];
  preferredPathPrefixes?: string[];
  preferredTextTokens?: string[];
  evidencePaths?: string[];
}

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

function extractPathSignalTokens(value: string): string[] {
  return unique(
    toForwardSlash(value)
      .toLowerCase()
      .split(/[^a-z0-9가-힣]+/i)
      .map((item) => item.trim())
      .filter((item) => item.length >= 3 && !PATH_SIGNAL_STOP_WORDS.has(item))
  );
}

function normalizePrefix(value: string): string {
  const normalized = toForwardSlash(value).toLowerCase().replace(/^\/+/, "");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function countTokenOverlap(tokens: string[], preferred: Set<string>): number {
  let overlap = 0;
  for (const token of tokens) {
    if (preferred.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
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
  rerankContext?: QmdRerankContext;
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

  const preferredPathTokens = new Set(
    (options.rerankContext?.preferredPathTokens ?? []).flatMap((item) => extractPathSignalTokens(item))
  );
  const preferredPathPrefixes = unique((options.rerankContext?.preferredPathPrefixes ?? []).map(normalizePrefix));
  const preferredTextTokens = unique(
    (options.rerankContext?.preferredTextTokens ?? [])
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length >= 3)
  );
  const evidencePaths = unique(
    (options.rerankContext?.evidencePaths ?? []).map((item) => toForwardSlash(item).toLowerCase())
  );

  const hitPathTokens = extractPathSignalTokens(normalizedPath);
  const preferredTokenOverlap = countTokenOverlap(hitPathTokens, preferredPathTokens);
  if (preferredTokenOverlap > 0) {
    score += Math.min(180, preferredTokenOverlap * 32);
  }

  const prefixMatches = preferredPathPrefixes.filter((prefix) => normalizedPath.startsWith(prefix)).length;
  if (prefixMatches > 0) {
    score += Math.min(220, prefixMatches * 120);
  }

  const evidenceMatch = evidencePaths.some((entry) => entry === normalizedPath);
  if (evidenceMatch) {
    score += 260;
  }

  const combinedText = `${options.hit.title ?? ""} ${options.hit.context ?? ""} ${options.hit.snippet ?? ""}`.toLowerCase();
  for (const token of preferredTextTokens.slice(0, 8)) {
    if (combinedText.includes(token)) {
      score += 14;
    }
  }

  if (
    preferredPathTokens.size > 0 &&
    preferredTokenOverlap === 0 &&
    prefixMatches === 0 &&
    !evidenceMatch &&
    hitPathTokens.filter((item) => item.length >= 4).length >= 2
  ) {
    score -= 95;
  }

  return score * (options.corpusWeight ?? 1);
}

export function postprocessQmdHits(options: {
  hits: QmdSearchHit[];
  query: string;
  limit: number;
  rerankContext?: QmdRerankContext;
}): QmdSearchHit[] {
  return options.hits
    .filter((hit) => !isQmdNoisePath(hit.path))
    .map((hit) => ({
      hit,
      score: scoreQmdHit({
        hit,
        query: options.query,
        rerankContext: options.rerankContext
      })
    }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.hit.path.localeCompare(b.hit.path)))
    .map((item) => item.hit)
    .slice(0, Math.max(1, options.limit));
}
