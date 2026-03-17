import type { OntologyNode } from "./ontology-graph.js";
import type { RankedOntologyNode } from "./ontology-planner.js";

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function tokenizeOntologyText(value: string): string[] {
  return unique(
    String(value ?? "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([가-힣])([A-Za-z0-9])/g, "$1 $2")
      .replace(/([A-Za-z0-9])([가-힣])/g, "$1 $2")
      .replace(/[\\/_:.-]+/g, " ")
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s]+/gi, " ")
      .split(/\s+/)
      .filter((item) => item.length >= 2)
  );
}

export function isCrossLayerFlowQuestion(question: string): boolean {
  return /(프론트|frontend|화면|버튼|vue|screen|ui|api|gateway)/i.test(question) && /(백엔드|backend|service|controller|route|흐름|trace|추적|거쳐)/i.test(question);
}

export function extractOntologyTextSignalsFromTexts(
  values: Array<string | undefined>,
  _options?: unknown
): string[] {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (!text) {
    return [];
  }

  const signals = new Set<string>();
  const add = (signal: string) => {
    if (signal.trim()) signals.add(signal.trim());
  };

  if (/(login|signin|auth|authenticate|cert|verify|인증|로그인|본인확인|회원 인증)/.test(text)) add("action-auth");
  if (/(register|regist|signup|join|enroll|등록|가입)/.test(text)) add("action-register");
  if (/(status|state|info|lookup|상태|현황|정보)/.test(text)) add("action-status-read");
  if (/(select|get|load|read|inquiry|inqury|query|조회|확인|가져오)/.test(text)) add("action-read");
  if (/(save|insert|create|add|persist|write|set|저장|생성|추가|기록|submit|apply|request|proc)/.test(text)) add("action-write");
  if (/(update|modify|change|patch|갱신|수정|변경)/.test(text)) add("action-update");
  if (/(delete|remove|clear|expire|evict|삭제|제거|만료)/.test(text)) add("action-delete");
  if (/(callback|webhook|notify|event|콜백|웹훅|알림|이벤트)/.test(text)) add("action-callback");
  if (/(session|redis|cache|세션|캐시)/.test(text)) add("action-state-store");
  if (/(token|refresh|issue|토큰|재발급|발급)/.test(text)) add("action-token");
  if (/(doc|document|agreement|pdf|upload|attachment|file|문서|동의서|약관|첨부|파일)/.test(text)) add("action-document");

  if (/(src\/views|\.vue\b|frontend|화면|screen|ui\b|router\/|route\.js)/.test(text)) add("frontend-flow");
  if (/(\/gw\/api\/|routecontroller\.route|gateway|프록시|proxy)/.test(text)) add("gateway-routing");
  if (/(controller|requestmapping|@restcontroller|@controller)/.test(text)) add("backend-controller");
  if (/(service|manager|orchestrat|facade)/.test(text)) add("service-layer");
  if (/(mapper|repository|dao|jdbc|sql|table|entity|model|database|db\b|jpa)/.test(text)) add("data-persistence");
  if (/(queue|worker|dispatcher|processor|consumer|batch|job|tasklet|step|scheduler|async)/.test(text)) add("async-process");
  if (/(validator|valid|guard|check|verify|throwif|assert)/.test(text)) add("control-guard");
  if (/(eai|interfaceid|interface|전문|연계)/.test(text)) add("external-integration");

  if (/monimo/.test(text)) add("channel:monimo");

  const tokens = tokenizeOntologyText(text);
  for (const token of tokens) {
    add(token);
  }
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index];
    const right = tokens[index + 1];
    if (!left || !right) continue;
    add(`${left}-${right}`);
  }

  return Array.from(signals);
}

export function buildQuestionOntologySignals(options: {
  question: string;
  moduleCandidates?: string[];
  matchedKnowledgeIds?: string[];
  matchedOntologyNodes?: OntologyNode[];
  matchedOntologyNodeIds?: string[];
  matchedOntologyLabels?: string[];
  matchedRetrievalUnitTerms?: string[];
}): string[] {
  const signals = new Set<string>();
  for (const signal of extractOntologyTextSignalsFromTexts([options.question])) {
    signals.add(signal);
  }
  for (const moduleCandidate of options.moduleCandidates ?? []) {
    signals.add(`module:${moduleCandidate}`);
  }
  for (const knowledgeId of options.matchedKnowledgeIds ?? []) {
    signals.add(knowledgeId);
    const normalized = knowledgeId.replace(/^graph:/, "").replace(/^unit:/, "").replace(/^knowledge:/, "");
    for (const token of tokenizeOntologyText(normalized)) {
      signals.add(token);
    }
  }
  for (const label of options.matchedOntologyLabels ?? []) {
    for (const token of tokenizeOntologyText(label)) {
      signals.add(token);
    }
  }
  for (const term of options.matchedRetrievalUnitTerms ?? []) {
    for (const token of tokenizeOntologyText(term)) {
      signals.add(token);
    }
  }
  for (const node of options.matchedOntologyNodes ?? []) {
    for (const action of node.metadata.actions) signals.add(action);
    for (const channel of node.metadata.channels) signals.add(`channel:${channel}`);
    for (const role of node.metadata.moduleRoles) signals.add(`module-role:${role}`);
    for (const role of node.metadata.processRoles) signals.add(`process:${role}`);
    for (const domain of node.metadata.domains) signals.add(`concept:${domain}`);
    for (const subdomain of node.metadata.subdomains) signals.add(`concept:${subdomain}`);
    for (const token of tokenizeOntologyText(node.label)) signals.add(token);
  }
  return Array.from(signals);
}

export function extractSpecificOntologySignals(signals: string[]): string[] {
  const genericSignals = new Set([
    "frontend-flow",
    "gateway-routing",
    "backend-controller",
    "service-layer",
    "data-persistence",
    "async-process",
    "control-guard",
    "external-integration"
  ]);
  const genericTokens = new Set([
    "frontend",
    "backend",
    "screen",
    "route",
    "router",
    "gateway",
    "controller",
    "service",
    "manager",
    "module",
    "method",
    "api",
    "flow",
    "logic",
    "trace",
    "path",
    "config",
    "resource",
    "state",
    "store",
    "session",
    "redis",
    "cache",
    "table",
    "entity",
    "model",
    "query",
    "validator",
    "guard",
    "process",
    "worker",
    "async",
    "batch",
    "job",
    "task",
    "step",
    "data",
    "code",
    "view",
    "page",
    "file"
  ]);
  return unique(
    signals.filter((signal) => {
      if (!signal) return false;
      if (signal.startsWith("action-")) return false;
      if (genericSignals.has(signal)) return false;
      if (
        signal.startsWith("channel:") ||
        signal.startsWith("module-role:") ||
        signal.startsWith("process:") ||
        signal.startsWith("concept:") ||
        signal.startsWith("module:")
      ) {
        return true;
      }
      if (signal.includes(":")) {
        return false;
      }
      if (genericTokens.has(signal)) {
        return false;
      }
      if (/^[a-z]+$/.test(signal) && signal.length < 4) {
        return false;
      }
      if (signal.includes("-")) {
        return signal
          .split("-")
          .some((part) => part && !genericTokens.has(part) && part.length >= 2);
      }
      return true;
    })
  );
}

export function scoreOntologySignalAlignment(
  questionSignals: string[],
  candidateSignals: string[],
  options?: { question?: string; pathText?: string; apiText?: string; methodText?: string }
): { score: number; reasons: string[] } {
  const questionSet = new Set(questionSignals);
  const candidateSet = new Set(candidateSignals);
  const reasons: string[] = [];
  let score = 0;

  for (const signal of questionSet) {
    if (!candidateSet.has(signal)) continue;
    if (signal.startsWith("action-")) {
      score += 12;
      reasons.push(`action:${signal}`);
    } else if (signal.startsWith("channel:") || signal.startsWith("module-role:") || signal.startsWith("process:") || signal.startsWith("concept:")) {
      score += 22;
      reasons.push(`signal:${signal}`);
    } else if (signal.startsWith("module:")) {
      score += 16;
      reasons.push(`module:${signal.replace(/^module:/, "")}`);
    } else {
      score += 8;
      reasons.push(`token:${signal}`);
    }
  }

  const desiredActions = questionSignals.filter((signal) => signal.startsWith("action-"));
  const candidateActions = candidateSignals.filter((signal) => signal.startsWith("action-"));
  if (desiredActions.length > 0 && candidateActions.length > 0 && !desiredActions.some((signal) => candidateSet.has(signal))) {
    score -= 20;
    reasons.push("action-mismatch");
  }

  const questionTokens = tokenizeOntologyText([options?.question, options?.pathText, options?.apiText, options?.methodText].filter(Boolean).join(" "));
  const candidateTokens = tokenizeOntologyText(candidateSignals.join(" "));
  const candidateTokenSet = new Set(candidateTokens);
  const tokenOverlap = questionTokens.filter((token) => candidateTokenSet.has(token)).length;
  if (tokenOverlap > 0) {
    score += Math.min(24, tokenOverlap * 3);
    reasons.push(`token-overlap:${tokenOverlap}`);
  }

  return {
    score,
    reasons: unique(reasons)
  };
}

export function hasStrongOntologySignalAlignment(
  questionSignals: string[],
  candidateSignals: string[],
  options?: { question?: string; pathText?: string; apiText?: string; methodText?: string }
): boolean {
  const alignment = scoreOntologySignalAlignment(questionSignals, candidateSignals, options);
  if (alignment.score >= 16) {
    return true;
  }
  const specificSignals = extractSpecificOntologySignals(questionSignals);
  const candidateSet = new Set(candidateSignals);
  return specificSignals.some((signal) => candidateSet.has(signal));
}

export function collectOntologyNodeSignals(matches: RankedOntologyNode[]): string[] {
  const signals: string[] = [];
  for (const match of matches) {
    signals.push(...match.node.metadata.actions);
    signals.push(...match.node.metadata.channels.map((channel) => `channel:${channel}`));
    signals.push(...match.node.metadata.moduleRoles.map((role) => `module-role:${role}`));
    signals.push(...match.node.metadata.processRoles.map((role) => `process:${role}`));
    signals.push(...match.node.metadata.domains.map((domain) => `concept:${domain}`));
    signals.push(...match.node.metadata.subdomains.map((subdomain) => `concept:${subdomain}`));
    signals.push(match.node.label);
  }
  return unique(signals);
}
