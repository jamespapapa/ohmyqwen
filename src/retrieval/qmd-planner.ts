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

const GENERIC_SYNONYM_PATTERNS: Array<[RegExp, string[]]> = [
  [/(보험)/i, ["insurance"]],
  [/(보험금)/i, ["benefit"]],
  [/(청구|claim)/i, ["claim", "submit", "receipt"]],
  [/(사고|accident)/i, ["accident"]],
  [/(대출|loan)/i, ["loan"]],
  [/(담보|collateral)/i, ["collateral"]],
  [/(주택|house|home)/i, ["house", "home"]],
  [/(회원|member)/i, ["member"]],
  [/(인증|auth|verify)/i, ["auth", "verify"]],
  [/(로그인|login|signin)/i, ["login", "signin"]],
  [/(등록|register|regist|signup|join)/i, ["register", "regist"]],
  [/(조회|inquiry|inqury|query|read|select|load|get)/i, ["inquiry", "query", "read", "select", "load"]],
  [/(저장|save|insert|write|create|persist)/i, ["save", "insert", "write"]],
  [/(수정|update|modify|change)/i, ["update", "modify"]],
  [/(삭제|delete|remove|clear)/i, ["delete", "remove"]],
  [/(문서|document|doc|agreement|pdf)/i, ["document", "doc", "agreement", "pdf"]],
  [/(파일|첨부|upload|attachment|file)/i, ["upload", "attachment", "file"]],
  [/(세션|session)/i, ["session"]],
  [/(캐시|cache)/i, ["cache"]],
  [/(리디스|redis)/i, ["redis"]],
  [/(토큰|token|refresh|issue)/i, ["token", "refresh", "issue"]],
  [/(채널|channel|partner|제휴|연계|integration|bridge|브릿지|callback|콜백)/i, ["channel", "partner", "integration", "bridge", "callback"]],
  [/(탑다운|topdown|큰 그림|overview|아키텍처|architecture)/i, ["topdown", "architecture", "overview"]],
  [/(로직|흐름|실행|구현|처리|오케스트레이션|orchestration)/i, ["flow", "execution", "controller", "service", "downstream"]],
  [/(컨트롤러|controller|endpoint|requestmapping|handler)/i, ["controller", "endpoint", "requestmapping", "handler"]],
  [/(서비스|service|domain|facade|manager|helper|support)/i, ["service", "domain", "facade", "manager", "helper", "support"]],
  [/(매퍼|mapper|mybatis|dao|repository|query|entity|model|table|sql)/i, ["mapper", "mybatis", "dao", "repository", "query", "entity", "model", "table", "sql"]],
  [/(eai|인터페이스|전문|external)/i, ["eai", "interface", "integration", "external"]],
  [/(오류|에러|error|exception|typeerror|fail)/i, ["error", "exception", "typeerror", "failure"]],
  [/(검증|verify|validation|guard|validator|check)/i, ["verify", "validation", "guard", "validator", "check"]]
];

const ROLE_TERMS = new Set([
  "controller",
  "service",
  "mapper",
  "repository",
  "dao",
  "client",
  "handler",
  "support",
  "helper",
  "manager",
  "facade"
]);

const ACTION_TERMS = new Set([
  "auth",
  "verify",
  "login",
  "signin",
  "register",
  "regist",
  "request",
  "apply",
  "inquiry",
  "query",
  "read",
  "select",
  "load",
  "save",
  "insert",
  "write",
  "update",
  "modify",
  "delete",
  "remove",
  "check",
  "status",
  "state",
  "document",
  "doc",
  "upload",
  "attachment",
  "file",
  "token",
  "callback",
  "bridge"
]);

const GENERIC_TERMS = new Set([
  "flow",
  "logic",
  "execution",
  "downstream",
  "architecture",
  "overview",
  "endpoint",
  "requestmapping",
  "domain",
  "external",
  "integration",
  "topdown",
  "error",
  "exception",
  "typeerror",
  "failure"
]);

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
      return /[A-Z]/.test(token) || /(Service|Controller|Mapper|Repository|Client|Handler|Support|Helper|Manager|Facade|Async|save|submit|insert|update|check|query|register|auth)/.test(token);
    })
  ).slice(0, 8);
}

function expandSemanticTerms(values: string[]): string[] {
  const combined = values.join(" ");
  const expanded: string[] = [];
  for (const [pattern, synonyms] of GENERIC_SYNONYM_PATTERNS) {
    if (pattern.test(combined)) {
      expanded.push(...synonyms);
    }
  }
  for (const token of extractTokens(combined).map((entry) => entry.toLowerCase())) {
    expanded.push(token);
  }
  return unique(expanded.filter((entry) => entry.length >= 2));
}

function toPascalCase(parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function buildCompositeSymbolHints(semanticTerms: string[], symbols: string[], pathTokens: string[]): string[] {
  const hints = new Set<string>();
  const lower = unique(semanticTerms.map((item) => item.toLowerCase()));
  const lowerSet = new Set(lower);
  const nounTerms = lower.filter((item) => !ROLE_TERMS.has(item) && !ACTION_TERMS.has(item) && !GENERIC_TERMS.has(item));
  const roleTerms = lower.filter((item) => ROLE_TERMS.has(item));
  const symbolRoles = symbols
    .map((symbol) => {
      const match = symbol.match(/(Controller|Service|Mapper|Repository|Client|Handler|Support|Helper|Manager|Facade)$/);
      return match?.[1]?.toLowerCase();
    })
    .filter((item): item is string => Boolean(item));
  const combinedRoles = unique([...roleTerms, ...symbolRoles]);

  const englishStemCandidates = nounTerms
    .filter((item) => /^[a-z][a-z0-9-]*$/.test(item))
    .flatMap((item) => item.split(/[-_]/).filter((part) => part.length >= 3));
  const rawStemCandidates = nounTerms.flatMap((item) => item.split(/[-_]/).filter((part) => part.length >= 2));
  const stemCandidates = unique([
    ...englishStemCandidates,
    ...rawStemCandidates,
    ...pathTokens.map((item) => item.toLowerCase()).flatMap((item) => item.split(/[-_]/)).filter((part) => part.length >= 3)
  ]).filter((item) => !ROLE_TERMS.has(item) && !ACTION_TERMS.has(item) && !GENERIC_TERMS.has(item));

  for (let size = Math.min(3, stemCandidates.length); size >= 2; size -= 1) {
    const composite = stemCandidates.slice(0, size);
    if (composite.length >= 2) {
      hints.add(toPascalCase(composite));
    }
  }
  if (stemCandidates.length >= 2 && lowerSet.has("insurance") && !stemCandidates.includes("insurance")) {
    hints.add(toPascalCase(["insurance", ...stemCandidates.slice(0, 2)]));
  }

  for (const base of Array.from(hints)) {
    for (const role of combinedRoles.slice(0, 4)) {
      hints.add(`${base}${toPascalCase([role])}`);
    }
  }

  for (const symbol of symbols) {
    if (/(Service|Controller|Mapper|Repository|Client)$/.test(symbol)) {
      hints.add(symbol);
    }
  }

  return Array.from(hints);
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
  const semanticTerms = expandSemanticTerms(allValues);
  const compactTaskTokens = signalTokens.slice(0, 10);
  const compositeSymbols = buildCompositeSymbolHints(semanticTerms, symbols, pathTokens);
  const errorTerms = expandSemanticTerms([...(signals.errorLogs ?? []), ...(signals.verifyFeedback ?? [])]);
  const logicTerms = unique(
    semanticTerms.filter((entry) =>
      ["controller", "service", "downstream", "mapper", "mybatis", "dao", "repository", "save", "submit", "insert", "check", "status", "query", "verify", "error", "exception"].includes(entry)
    )
  );

  const explicitPrimary = buildCandidate([modules, symbols.slice(0, 4), pathTokens.slice(0, 4)]);
  const domainPrimary = buildCandidate([modules, compositeSymbols.slice(0, 4)], ["controller", "service"]);
  const hybridPrimary = buildCandidate([modules, symbols.slice(0, 4), compositeSymbols.slice(0, 4)]);

  const candidates = unique(
    [
      explicitPrimary,
      domainPrimary,
      hybridPrimary,
      buildCandidate([modules, pathTokens.slice(0, 6), compositeSymbols.slice(0, 4), logicTerms.slice(0, 4)]),
      buildCandidate([compositeSymbols.slice(0, 5), symbols.slice(0, 5), logicTerms.slice(0, 4)]),
      buildCandidate([pathTokens.slice(0, 8), errorTerms.slice(0, 4), compositeSymbols.slice(0, 4), symbols.slice(0, 4)]),
      buildCandidate([compactTaskTokens.slice(0, 8), compositeSymbols.slice(0, 4), errorTerms.slice(0, 4), semanticTerms.slice(0, 4)])
    ].filter(Boolean)
  );

  return candidates.filter(Boolean).slice(0, 6);
}

export function buildQmdQueryFromSignals(signals: QmdPlannerSignals): string {
  return buildQmdQueryCandidates(signals)[0] ?? "";
}
