import path from "node:path";

interface QmdPlannerSignals {
  task: string;
  targetFiles?: string[];
  diffSummary?: string[];
  errorLogs?: string[];
  verifyFeedback?: string[];
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "check",
  "for",
  "from",
  "how",
  "internal",
  "into",
  "is",
  "it",
  "or",
  "please",
  "the",
  "to",
  "what",
  "where",
  "가",
  "기준으로",
  "내부에서",
  "대한",
  "로",
  "를",
  "이",
  "의",
  "은",
  "을",
  "잘",
  "좀",
  "파악",
  "파악해줘",
  "해줘",
  "어디",
  "어떻게",
  "이루어지는지",
  "설명",
  "설명해줘",
  "확인",
  "확인해줘"
]);

const DOMAIN_EXPANSIONS: Array<[RegExp, string[]]> = [
  [/(보험금|benefit)/i, ["benefit", "insurance", "claim"]],
  [/(청구|claim)/i, ["claim", "submit", "receipt"]],
  [/(사고|accident)/i, ["accident"]],
  [/(대출|loan)/i, ["loan"]],
  [/(회원|member|auth)/i, ["member", "auth"]],
  [/(탑다운|topdown|큰 그림|overview|아키텍처|architecture)/i, ["topdown", "architecture", "overview"]],
  [/(로직|흐름|실행|구현|처리|오케스트레이션|orchestration)/i, ["flow", "execution", "controller", "service", "downstream"]],
  [/(컨트롤러|controller|endpoint|requestmapping)/i, ["controller", "endpoint", "requestmapping"]],
  [/(서비스|service|domain)/i, ["service", "domain"]],
  [/(매퍼|mapper|mybatis|dao|repository)/i, ["mapper", "mybatis", "dao"]],
  [/(eai|인터페이스|연계|전문)/i, ["eai", "interface", "integration"]],
  [/(오류|에러|error|exception|typeerror)/i, ["error", "exception", "typeerror"]],
  [/(검증|verify|validation)/i, ["verify", "validation"]],
  [/(저장|save|submit)/i, ["save", "submit"]]
];

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function limitQuery(value: string, max = 220): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

function extractTokens(text: string): string[] {
  return (text.match(/[A-Za-z0-9가-힣._/-]+/g) ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2)
    .filter((entry) => !STOPWORDS.has(entry.toLowerCase()));
}

function extractModuleCandidates(values: string[]): string[] {
  return unique(
    values.flatMap((value) => value.match(/\bdcp-[a-z0-9-]+\b/gi) ?? []).map((entry) => entry.toLowerCase())
  );
}

function extractPathTokens(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, "/");
  const base = path.basename(normalized, path.extname(normalized));
  const segments = normalized
    .split("/")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !/\.(java|kt|kts|ts|tsx|js|jsx|py|go|rs|cs|xml|sql|md)$/i.test(entry));
  return unique([base, ...segments.filter((entry) => entry.length >= 3)]).slice(0, 8);
}

function extractSignalTokens(signals: QmdPlannerSignals): string[] {
  const values = [
    signals.task,
    ...(signals.targetFiles ?? []),
    ...(signals.diffSummary ?? []),
    ...(signals.errorLogs ?? []),
    ...(signals.verifyFeedback ?? [])
  ];
  return unique(values.flatMap((value) => extractTokens(value)));
}

function extractSymbolCandidates(tokens: string[]): string[] {
  return unique(
    tokens.filter((token) => {
      if (token.includes("/")) {
        return false;
      }
      if (token.includes(".")) {
        return false;
      }
      return /[A-Z]/.test(token) || /(Service|Controller|Mapper|Repository|Client|Async|Claim|save|submit|insert)/.test(token);
    })
  ).slice(0, 8);
}

function expandDomainTerms(values: string[]): string[] {
  const combined = values.join(" ");
  const expanded: string[] = [];
  for (const [pattern, synonyms] of DOMAIN_EXPANSIONS) {
    if (pattern.test(combined)) {
      expanded.push(...synonyms);
    }
  }
  return unique(expanded);
}

function buildCandidate(parts: Array<string | string[]>, extras: string[] = []): string {
  const flat = parts.flatMap((part) => (Array.isArray(part) ? part : [part]));
  return limitQuery(unique([...flat, ...extras]).join(" "));
}

export function buildQmdQueryCandidates(signals: QmdPlannerSignals): string[] {
  const allValues = [
    signals.task,
    ...(signals.targetFiles ?? []),
    ...(signals.diffSummary ?? []),
    ...(signals.errorLogs ?? []),
    ...(signals.verifyFeedback ?? [])
  ].filter(Boolean);
  const modules = extractModuleCandidates(allValues);
  const signalTokens = extractSignalTokens(signals);
  const symbols = extractSymbolCandidates(signalTokens);
  const pathTokens = unique((signals.targetFiles ?? []).flatMap((entry) => extractPathTokens(entry)));
  const domainTerms = expandDomainTerms(allValues);
  const compactTaskTokens = signalTokens.slice(0, 10);
  const errorTerms = expandDomainTerms([...(signals.errorLogs ?? []), ...(signals.verifyFeedback ?? [])]);
  const logicTerms = unique(
    domainTerms.filter((entry) =>
      ["controller", "service", "downstream", "mapper", "mybatis", "dao", "claim", "benefit", "save", "submit", "error", "exception"].includes(entry)
    )
  );

  const candidates = unique(
    [
      buildCandidate([modules, symbols.slice(0, 4), domainTerms.slice(0, 6)], ["controller", "service"]),
      buildCandidate([modules, pathTokens.slice(0, 6), symbols.slice(0, 4), logicTerms.slice(0, 4)]),
      buildCandidate([symbols.slice(0, 5), compactTaskTokens.slice(0, 8), logicTerms.slice(0, 4)]),
      buildCandidate([modules, compactTaskTokens.slice(0, 8), ["controller", "service", "mapper"]]),
      buildCandidate([pathTokens.slice(0, 8), errorTerms.slice(0, 4), symbols.slice(0, 4)]),
      buildCandidate([compactTaskTokens.slice(0, 10), errorTerms.slice(0, 4), domainTerms.slice(0, 4)])
    ].filter(Boolean)
  );

  return candidates.filter(Boolean).slice(0, 6);
}

export function buildQmdQueryFromSignals(signals: QmdPlannerSignals): string {
  return buildQmdQueryCandidates(signals)[0] ?? "";
}
