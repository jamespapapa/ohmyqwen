import type { FrontBackGraphLink, FrontBackGraphSnapshot } from "./front-back-graph.js";
import type { DownstreamFlowTrace } from "./flow-trace.js";
import type { LearnedKnowledgeSnapshot } from "./learned-knowledge.js";
import { extractLearnedKnowledgeTagsFromTexts } from "./learned-knowledge.js";
import { inferQuestionActionHints } from "./question-types.js";
import {
  buildQuestionOntologySignals,
  extractOntologyTextSignalsFromTexts,
  extractSpecificOntologySignals,
  hasStrongOntologySignalAlignment,
  isCrossLayerFlowQuestion,
  scoreOntologySignalAlignment,
  tokenizeOntologyText
} from "./ontology-signals.js";

interface SearchLikeHit {
  path: string;
  score?: number;
  reasons?: string[];
}

export interface LinkedFlowEvidence {
  routePath?: string;
  screenCode?: string;
  screenPath?: string;
  apiUrl: string;
  gatewayPath?: string;
  gatewayControllerMethod?: string;
  backendPath: string;
  backendControllerMethod: string;
  serviceHints: string[];
  capabilityTags?: string[];
  confidence: number;
  reasons: string[];
}

export interface DeterministicFlowAnswer {
  answer: string;
  confidence: number;
  evidence: string[];
  caveats: string[];
}

export interface CanonicalLinkedFlowPlan {
  primary?: LinkedFlowEvidence;
  canonicalFlows: LinkedFlowEvidence[];
  droppedIncoherentFlowCount: number;
  canonicalNamespaceCount: number;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function flowHasCapability(flow: LinkedFlowEvidence, capability: string): boolean {
  return (flow.capabilityTags ?? []).includes(capability);
}

function tokenize(value: string): string[] {
  return unique(value.toLowerCase().match(/[a-z0-9가-힣._/-]+/g) ?? []);
}

function countOverlap(tokens: string[], text: string): number {
  if (tokens.length === 0) {
    return 0;
  }
  const corpusTokens = new Set(tokenize(text));
  let overlap = 0;
  for (const token of tokens) {
    if (corpusTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function isActionCapabilityTag(tag: string): boolean {
  return tag.startsWith("action-");
}

function flowText(item: {
  screenCode?: string;
  routePath?: string;
  screenPath?: string;
  apiUrl: string;
  gatewayPath?: string;
  gatewayControllerMethod?: string;
  backendPath: string;
  backendControllerMethod: string;
  serviceHints?: string[];
}): string {
  return [
    item.screenCode,
    item.routePath,
    item.screenPath,
    item.apiUrl,
    item.gatewayPath,
    item.gatewayControllerMethod,
    item.backendPath,
    item.backendControllerMethod,
    ...(item.serviceHints ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferFlowActionTags(item: {
  apiUrl: string;
  backendControllerMethod: string;
  serviceHints?: string[];
  capabilityTags?: string[];
}): string[] {
  const direct = (item.capabilityTags ?? []).filter(isActionCapabilityTag);
  const inferred = extractOntologyTextSignalsFromTexts(
    [item.apiUrl, item.backendControllerMethod, ...(item.serviceHints ?? [])],
    {}
  ).filter(isActionCapabilityTag);
  return unique([...direct, ...inferred]);
}

const GENERIC_FLOW_NAMESPACE_TOKENS = new Set([
  "gw",
  "api",
  "mo",
  "pc",
  "mysamsunglife",
  "src",
  "views",
  "view",
  "java",
  "com",
  "samsunglife",
  "dcp",
  "frontend",
  "backend",
  "screen",
  "route",
  "controller",
  "service",
  "request",
  "response",
  "status",
  "check",
  "select",
  "insert",
  "update",
  "delete",
  "remove",
  "save",
  "load",
  "get",
  "set",
  "inqury",
  "inquiry",
  "info",
  "main",
  "proc",
  "process",
  "v1",
  "v2"
]);

function extractFlowNamespaceTokens(item: {
  screenCode?: string;
  routePath?: string;
  screenPath?: string;
  apiUrl: string;
  backendPath: string;
  backendControllerMethod: string;
  serviceHints?: string[];
}): string[] {
  return unique(
    tokenizeOntologyText(
      [
        item.routePath,
        item.screenPath,
        item.apiUrl,
        item.backendPath,
        item.backendControllerMethod,
        ...(item.serviceHints ?? [])
      ]
        .filter(Boolean)
        .join(" ")
    ).filter(
      (token) =>
        token.length >= 3 &&
        !GENERIC_FLOW_NAMESPACE_TOKENS.has(token) &&
        !/\d/.test(token)
    )
  );
}

function topNamespaceFromPath(value?: string): string | undefined {
  if (!value) return undefined;
  const segments = value
    .toLowerCase()
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !["gw", "api", "mo", "pc", "mysamsunglife", "v1", "v2"].includes(segment));
  return segments[0];
}

function classifyFlowPhase(flow: LinkedFlowEvidence): DownstreamFlowTrace["phase"] {
  const text = `${flow.apiUrl} ${flow.backendControllerMethod} ${(flow.serviceHints ?? []).join(" ")}`.toLowerCase();
  if (/\/doc(?:\/|$)|agreement|upload|pdf|file|attachment|document/.test(text)) {
    return "action-document";
  }
  if (/\/insert(?:\/|$)|\/apply(?:\/|$)|\/submit(?:\/|$)|\/save(?:\/|$)|\/proc(?:\/|$)|\/update(?:\/|$)|register|regist|create|write/.test(text)) {
    return "action-write";
  }
  if (/\/check(?:\/|$)|\/status(?:\/|$)|verify|validate|guard/.test(text)) {
    return "action-check";
  }
  if (/inqury|inquiry|query|select|get|load|read/.test(text)) {
    return "action-read";
  }
  return "other";
}

function buildCanonicalFlowCluster(
  flows: LinkedFlowEvidence[],
  questionTags: string[]
): LinkedFlowEvidence[] {
  const anchor = selectCanonicalFlowAnchor(flows, questionTags);
  if (!anchor) {
    return [];
  }
  const anchorNamespace = new Set(extractFlowNamespaceTokens(anchor));
  const anchorTopNamespaces = new Set(
    [topNamespaceFromPath(anchor.apiUrl), topNamespaceFromPath(anchor.backendPath)].filter(Boolean)
  );
  const specificQuestionTags = extractSpecificOntologySignals(questionTags);
  const questionNamespaceTokens = unique(
    specificQuestionTags
      .flatMap((tag) => tokenizeOntologyText(tag))
      .filter((token) => token.length >= 3 && !GENERIC_FLOW_NAMESPACE_TOKENS.has(token))
  );

  const coherent = flows.filter((flow, index) => {
    if (flow === anchor) {
      return true;
    }
    if (index === 0) {
      return false;
    }
    const sharedSpecificSignals = specificQuestionTags.filter((tag) => (flow.capabilityTags ?? []).includes(tag));
    const flowNamespace = extractFlowNamespaceTokens(flow);
    const questionNamespaceOverlap = questionNamespaceTokens.filter((token) => flowNamespace.includes(token)).length;
    if (sharedSpecificSignals.length > 0) {
      return true;
    }
    if (questionNamespaceTokens.length > 0 && questionNamespaceOverlap === 0) {
      return false;
    }
    const namespaceOverlap = flowNamespace.filter((token) => anchorNamespace.has(token)).length;
    if (namespaceOverlap > 0) {
      return true;
    }
    const flowTopNamespaces = [topNamespaceFromPath(flow.apiUrl), topNamespaceFromPath(flow.backendPath)].filter(
      Boolean
    );
    if (flowTopNamespaces.some((token) => anchorTopNamespaces.has(token))) {
      return true;
    }
    return false;
  });

  return coherent.length > 0 ? coherent : [anchor];
}

function selectCanonicalFlowAnchor(
  flows: LinkedFlowEvidence[],
  questionTags: string[]
): LinkedFlowEvidence | undefined {
  const specificQuestionTags = extractSpecificOntologySignals(questionTags);

  return [...flows]
    .map((candidate) => {
      const candidateNamespace = new Set(extractFlowNamespaceTokens(candidate));
      const candidateTopNamespaces = new Set(
        [topNamespaceFromPath(candidate.apiUrl), topNamespaceFromPath(candidate.backendPath)].filter(Boolean)
      );
      const candidateActions = new Set(inferFlowActionTags(candidate));
      const specificMatches = specificQuestionTags.filter((tag) => (candidate.capabilityTags ?? []).includes(tag));
      let score = candidate.confidence * 100;

      if (specificMatches.length > 0) {
        score += specificMatches.length * 38;
      } else if (specificQuestionTags.length > 0) {
        score -= 42;
      }

      for (const peer of flows) {
        if (peer === candidate) {
          continue;
        }
        const peerNamespace = extractFlowNamespaceTokens(peer);
        const namespaceOverlap = peerNamespace.filter((token) => candidateNamespace.has(token)).length;
        const peerTopNamespaces = [topNamespaceFromPath(peer.apiUrl), topNamespaceFromPath(peer.backendPath)].filter(
          Boolean
        );
        const topNamespaceOverlap = peerTopNamespaces.some((token) => candidateTopNamespaces.has(token)) ? 1 : 0;
        const peerSpecificMatches = specificQuestionTags.filter((tag) => (peer.capabilityTags ?? []).includes(tag));
        const peerActions = inferFlowActionTags(peer);
        const actionOverlap = peerActions.filter((action) => candidateActions.has(action)).length;

        if (peerSpecificMatches.length > 0) {
          score += 14;
        }
        if (namespaceOverlap > 0) {
          score += Math.min(18, namespaceOverlap * 6);
        }
        if (topNamespaceOverlap > 0) {
          score += 10;
        }
        if (actionOverlap === 0 && peerActions.length > 0) {
          score += 4;
        } else if (actionOverlap > 0) {
          score += 2;
        }
        if (namespaceOverlap === 0 && topNamespaceOverlap === 0 && peerSpecificMatches.length === 0) {
          score -= 8;
        }
      }

      return { candidate, score };
    })
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : b.candidate.confidence - a.candidate.confidence))
    .map((entry) => entry.candidate)[0];
}

function countIncoherentFlows(flows: LinkedFlowEvidence[], questionTags: string[]): number {
  const anchor = flows[0];
  if (!anchor) {
    return 0;
  }
  const canonical = buildCanonicalFlowCluster(flows, questionTags);
  const canonicalKeys = new Set(canonical.map((flow) => `${flow.apiUrl}|${flow.backendControllerMethod}`));
  return flows.filter((flow) => !canonicalKeys.has(`${flow.apiUrl}|${flow.backendControllerMethod}`)).length;
}

function countDistinctTopNamespaces(flows: LinkedFlowEvidence[]): number {
  return unique(
    flows.flatMap((flow) => [topNamespaceFromPath(flow.apiUrl), topNamespaceFromPath(flow.backendPath)].filter(Boolean) as string[])
  ).length;
}

export function buildCanonicalLinkedFlowPlan(options: {
  question: string;
  questionTags?: string[];
  linkedFlowEvidence: LinkedFlowEvidence[];
}): CanonicalLinkedFlowPlan {
  const effectiveQuestionTags =
    options.questionTags ?? buildQuestionOntologySignals({ question: options.question });
  const canonicalFlows = buildCanonicalFlowCluster(options.linkedFlowEvidence, effectiveQuestionTags);
  return {
    primary: canonicalFlows[0],
    canonicalFlows,
    droppedIncoherentFlowCount: countIncoherentFlows(options.linkedFlowEvidence, effectiveQuestionTags),
    canonicalNamespaceCount: countDistinctTopNamespaces(canonicalFlows)
  };
}

function expandDesiredActionTags(actionHints: string[]): string[] {
  const expanded = new Set<string>();
  for (const action of actionHints) {
    expanded.add(action);
    switch (action) {
      case "action-auth":
        expanded.add("action-check");
        expanded.add("action-token");
        expanded.add("action-register");
        break;
      case "action-register":
        expanded.add("action-submit");
        expanded.add("action-write");
        break;
      case "action-status-read":
        expanded.add("action-read");
        expanded.add("action-inquiry");
        expanded.add("action-check");
        break;
      case "action-read":
        expanded.add("action-status-read");
        expanded.add("action-inquiry");
        expanded.add("action-check");
        break;
      case "action-write":
        expanded.add("action-submit");
        expanded.add("action-register");
        expanded.add("action-doc");
        break;
      case "action-update":
        expanded.add("action-write");
        break;
      case "action-state-store":
        expanded.add("action-check");
        expanded.add("action-read");
        break;
      case "action-token":
        expanded.add("action-auth");
        break;
    }
  }
  return Array.from(expanded);
}

function scoreActionAlignment(flowActions: string[], desiredActions: string[]): { score: number; reasons: string[] } {
  if (flowActions.length === 0 || desiredActions.length === 0) {
    return { score: 0, reasons: [] };
  }
  const overlaps = desiredActions.filter((action) => flowActions.includes(action));
  if (overlaps.length > 0) {
    return {
      score: overlaps.length * 18,
      reasons: overlaps.slice(0, 3).map((action) => `action-match:${action}`)
    };
  }
  return {
    score: -12,
    reasons: ["action-mismatch"]
  };
}

function resolveLinkCapabilityTags(
  link: FrontBackGraphLink,
  learnedKnowledge?: LearnedKnowledgeSnapshot
): string[] {
  const texts = [
    link.frontend.screenCode,
    link.frontend.screenPath,
    link.frontend.routePath,
    link.api.rawUrl,
    link.api.normalizedUrl,
    link.api.functionName,
    link.gateway.path,
    link.gateway.controllerMethod,
    link.backend.path,
    link.backend.controllerMethod,
    ...link.backend.serviceHints
  ];
  return unique([
    ...extractOntologyTextSignalsFromTexts(texts),
    ...extractLearnedKnowledgeTagsFromTexts(texts, learnedKnowledge)
  ]);
}

export function buildLinkedFlowEvidence(options: {
  question: string;
  questionTags?: string[];
  hits?: SearchLikeHit[];
  snapshot: FrontBackGraphSnapshot;
  limit?: number;
  learnedKnowledge?: LearnedKnowledgeSnapshot;
}): LinkedFlowEvidence[] {
  const tokens = tokenize(options.question);
  const questionTags = options.questionTags ?? buildQuestionOntologySignals({ question: options.question });
  const specificQuestionTags = extractSpecificOntologySignals(questionTags);
  const questionNamespaceTokens = unique(
    specificQuestionTags
      .flatMap((tag) => tokenizeOntologyText(tag))
      .filter((token) => token.length >= 3 && !GENERIC_FLOW_NAMESPACE_TOKENS.has(token))
  );
  const desiredActions = expandDesiredActionTags(inferQuestionActionHints(options.question, questionTags));
  const nonActionQuestionTags = questionTags.filter(
    (tag) => !isActionCapabilityTag(tag) && !tag.startsWith("token:")
  );
  const minSharedNonActionTags =
    nonActionQuestionTags.length >= 3 ? 2 : nonActionQuestionTags.length >= 1 ? 1 : 0;
  const hitPaths = (options.hits ?? []).map((hit) => hit.path.toLowerCase());
  const crossLayer = isCrossLayerFlowQuestion(options.question);

  return options.snapshot.links
    .map((link) => {
      const capabilityTags = resolveLinkCapabilityTags(link, options.learnedKnowledge);
      const flowActions = inferFlowActionTags({
        apiUrl: link.api.normalizedUrl,
        backendControllerMethod: link.backend.controllerMethod,
        serviceHints: link.backend.serviceHints,
        capabilityTags
      });
      const capabilityAlignment = scoreOntologySignalAlignment(questionTags, capabilityTags, {
        question: options.question,
        pathText: [link.frontend.screenPath, link.frontend.routePath, link.backend.filePath, link.backend.path].join(" "),
        apiText: [link.api.rawUrl, link.api.normalizedUrl].join(" "),
        methodText: [link.gateway.controllerMethod, link.backend.controllerMethod, ...link.backend.serviceHints].join(" ")
      });
      let score = link.confidence * 100 + capabilityAlignment.score;
      const reasons: string[] = [...capabilityAlignment.reasons];
      const actionAlignment = scoreActionAlignment(flowActions, desiredActions);
      score += actionAlignment.score;
      reasons.push(...actionAlignment.reasons);
      if (crossLayer) {
        score += 25;
        reasons.push("cross-layer-question");
      }
      const screenCode = link.frontend.screenCode ?? "";
      if (screenCode && options.question.includes(screenCode)) {
        score += 24;
        reasons.push("screen-code-match");
      }
      if (screenCode && tokens.some((token) => screenCode.toLowerCase().includes(token))) {
        score += 10;
        reasons.push("screen-code-match");
      }
      if (/(화면|screen|page|뷰|view)/i.test(options.question) && screenCode) {
        score += 6;
        reasons.push("screen-code-match");
      }
      if (
        hitPaths.some(
          (hitPath) =>
            hitPath.includes((link.frontend.screenPath ?? "").toLowerCase()) ||
            hitPath.includes(link.backend.filePath.toLowerCase())
        )
      ) {
        score += 18;
        reasons.push("backend-hit-match");
      }
      if (tokens.some((token) => link.api.normalizedUrl.toLowerCase().includes(token))) {
        score += 12;
        reasons.push("api-token-match");
      }
      if (tokens.some((token) => link.backend.controllerMethod.toLowerCase().includes(token))) {
        score += 10;
        reasons.push("controller-token-match");
      }
      const fullFlowText = flowText({
        screenCode: link.frontend.screenCode,
        routePath: link.frontend.routePath,
        screenPath: link.frontend.screenPath,
        apiUrl: link.api.normalizedUrl,
        gatewayPath: link.gateway.path,
        gatewayControllerMethod: link.gateway.controllerMethod,
        backendPath: link.backend.path,
        backendControllerMethod: link.backend.controllerMethod,
        serviceHints: link.backend.serviceHints
      });
      const tokenHits = tokens.filter((token) => fullFlowText.includes(token));
      if (tokenHits.length > 0) {
        score += Math.min(18, tokenHits.length * 4);
        reasons.push(`question-token-match:${tokenHits.slice(0, 3).join(",")}`);
      }
      const sharedSpecificSignals = specificQuestionTags.filter((tag) => capabilityTags.includes(tag));
      if (sharedSpecificSignals.length > 0) {
        score += Math.min(28, sharedSpecificSignals.length * 16);
        reasons.push(...sharedSpecificSignals.slice(0, 3).map((tag) => `specific-signal:${tag}`));
      }
      const flowNamespaceTokens = extractFlowNamespaceTokens({
        screenCode: link.frontend.screenCode,
        routePath: link.frontend.routePath,
        screenPath: link.frontend.screenPath,
        apiUrl: link.api.normalizedUrl,
        backendPath: link.backend.path,
        backendControllerMethod: link.backend.controllerMethod,
        serviceHints: link.backend.serviceHints
      });
      const sharedNamespaceTokens = questionNamespaceTokens.filter((tag) => flowNamespaceTokens.includes(tag));
      if (sharedNamespaceTokens.length > 0) {
        score += Math.min(42, sharedNamespaceTokens.length * 14);
        reasons.push(`namespace-match:${sharedNamespaceTokens.slice(0, 3).join(",")}`);
      } else if (questionNamespaceTokens.length > 0) {
        score -= 28;
        reasons.push("namespace-mismatch");
      }
      if (specificQuestionTags.length > 0 && sharedSpecificSignals.length === 0) {
        score -= 18;
        reasons.push("missing-specific-signal-match");
      }
      if (!/(취소|cancel|delete)/i.test(options.question) && /delete|cancel/.test(fullFlowText)) {
        score -= 14;
        reasons.push("destructive-action-penalty");
      }
      if (/spotsave|spotload/.test(fullFlowText)) {
        score -= 8;
        reasons.push("draft-flow-penalty");
      }
      if (
        questionTags.length > 0 &&
        !hasStrongOntologySignalAlignment(questionTags, capabilityTags, {
          question: options.question,
          pathText: [link.frontend.screenPath, link.backend.filePath, link.backend.path].join(" "),
          apiText: [link.api.rawUrl, link.api.normalizedUrl].join(" "),
          methodText: [link.backend.controllerMethod, ...link.backend.serviceHints].join(" ")
        })
      ) {
        score -= 24;
        reasons.push("weak-capability-alignment");
      }
      return {
        routePath: link.frontend.routePath,
        screenCode: link.frontend.screenCode,
        screenPath: link.frontend.screenPath,
        apiUrl: link.api.rawUrl,
        gatewayPath: link.gateway.path,
        gatewayControllerMethod: link.gateway.controllerMethod,
        backendPath: link.backend.path,
        backendControllerMethod: link.backend.controllerMethod,
        serviceHints: link.backend.serviceHints,
        capabilityTags,
        confidence: Math.min(0.99, Number((score / 100).toFixed(2))),
        reasons: unique(reasons),
        _score: score
      };
    })
    .sort((a, b) =>
      b._score !== a._score ? b._score - a._score : a.apiUrl.localeCompare(b.apiUrl)
    )
    .filter((item, index, array) =>
      array.findIndex(
        (candidate) =>
          candidate.apiUrl === item.apiUrl &&
          candidate.backendControllerMethod === item.backendControllerMethod &&
          candidate.screenCode === item.screenCode
      ) === index
    )
    .map(({ _score: _unusedScore, ...item }) => item)
    .slice(0, Math.max(1, options.limit ?? 6));
}

export function buildDeterministicFlowAnswer(options: {
  question: string;
  questionTags?: string[];
  linkedFlowEvidence: LinkedFlowEvidence[];
  downstreamTraces?: DownstreamFlowTrace[];
}): DeterministicFlowAnswer {
  const effectiveQuestionTags =
    options.questionTags ?? buildQuestionOntologySignals({ question: options.question });
  const canonicalPlan = buildCanonicalLinkedFlowPlan({
    question: options.question,
    questionTags: effectiveQuestionTags,
    linkedFlowEvidence: options.linkedFlowEvidence
  });
  const canonicalFlows = canonicalPlan.canonicalFlows;
  const primary = canonicalPlan.primary;
  if (!primary) {
    return {
      answer: "충분한 근거를 확보하지 못해 확정 답변을 제공하기 어렵습니다. 재색인 후 다시 질의하세요.",
      confidence: 0.2,
      evidence: [],
      caveats: ["low-evidence"]
    };
  }

  const questionTags = effectiveQuestionTags;
  const specificQuestionTags = extractSpecificOntologySignals(questionTags);
  const desiredActions = expandDesiredActionTags(inferQuestionActionHints(options.question, questionTags));
  const nonActionQuestionTags = questionTags.filter((tag) => !isActionCapabilityTag(tag));
  const minSharedNonActionTags =
    nonActionQuestionTags.length >= 3 ? 2 : nonActionQuestionTags.length >= 1 ? 1 : 0;

  const scorePhaseCandidate = (
    item: LinkedFlowEvidence,
    criteria: {
      tags?: string[];
      apiPatterns?: RegExp[];
      methodPatterns?: RegExp[];
      screenPatterns?: RegExp[];
      avoidApiPatterns?: RegExp[];
    }
  ): number => {
    const haystack = [item.apiUrl, item.backendControllerMethod, ...(item.serviceHints ?? [])].join(" ");
    const lowerApi = item.apiUrl.toLowerCase();
    let score = item.confidence * 100;
    const itemTagSet = new Set(item.capabilityTags ?? []);
    const sharedQuestionTags = questionTags.filter((tag) => itemTagSet.has(tag));
    const actionAlignment = scoreActionAlignment(inferFlowActionTags(item), desiredActions);
    const genericAlignment = scoreOntologySignalAlignment(questionTags, item.capabilityTags ?? [], {
      question: options.question,
      pathText: [item.routePath, item.screenPath, item.backendPath].join(" "),
      apiText: item.apiUrl,
      methodText: [item.gatewayControllerMethod, item.backendControllerMethod, ...(item.serviceHints ?? [])].join(" ")
    });
    score += genericAlignment.score;
    score += actionAlignment.score;
    if (sharedQuestionTags.length > 0) {
      score += Math.min(140, sharedQuestionTags.length * 42);
    } else if (questionTags.length > 0 && (item.capabilityTags ?? []).length > 0) {
      score -= 75;
    }
    for (const tag of criteria.tags ?? []) {
      if (flowHasCapability(item, tag)) {
        score += 70;
      }
    }
    for (const pattern of criteria.apiPatterns ?? []) {
      if (pattern.test(item.apiUrl)) {
        score += 90;
      }
    }
    for (const pattern of criteria.methodPatterns ?? []) {
      if (pattern.test(haystack)) {
        score += 55;
      }
    }
    for (const pattern of criteria.screenPatterns ?? []) {
      if (pattern.test(item.screenCode ?? "") || pattern.test(item.routePath ?? "")) {
        score += 30;
      }
    }
    for (const pattern of criteria.avoidApiPatterns ?? []) {
      if (pattern.test(lowerApi)) {
        return Number.NEGATIVE_INFINITY;
      }
    }
    const specificSignalMatches = specificQuestionTags.filter((tag) => (item.capabilityTags ?? []).includes(tag));
    if (specificSignalMatches.length > 0) {
      score += specificSignalMatches.length * 60;
    }
    if (specificQuestionTags.length > 0 && specificSignalMatches.length === 0) {
      score -= 140;
    }
    return score;
  };

  const pickBestFlow = (criteria: Parameters<typeof scorePhaseCandidate>[1]): LinkedFlowEvidence | undefined =>
    [...canonicalFlows]
      .map((item) => ({ item, score: scorePhaseCandidate(item, criteria) }))
      .sort((a, b) => b.score - a.score)
      .find((entry) => entry.score >= 120)?.item;

  const checkFlow = pickBestFlow({
    tags: ["action-check", "action-status-read"],
    apiPatterns: [/\/check(?:\/|$)/i, /status/i, /verify/i, /validate/i],
    methodPatterns: [/check/i, /verify/i, /valid/i, /status/i]
  });

  const inquiryFlow = pickBestFlow({
    tags: ["action-inquiry", "action-read"],
    apiPatterns: [/\/inqury(?:\/|$)/i, /\/inquiry(?:\/|$)/i, /\/select/i, /\/get/i, /\/load/i],
    methodPatterns: [/inq/i, /inquiry/i, /select/i, /load/i, /get/i]
  });

  const insertFlow = pickBestFlow({
    tags: ["action-submit", "action-write", "action-register"],
    apiPatterns: [/\/insert(?:\/|$)/i, /\/apply(?:\/|$)/i, /\/submit(?:\/|$)/i, /\/save/i, /\/proc(?:\/|$)/i],
    methodPatterns: [/insert/i, /apply/i, /submit/i, /save/i, /regist/i, /register/i],
    avoidApiPatterns: [/\/doc(?:\/|$)/i, /agreement/i, /upload/i, /pdf/i, /file/i, /attachment/i]
  });

  const docInsertFlow = pickBestFlow({
    tags: ["action-document", "action-doc", "action-agreement"],
    apiPatterns: [/\/doc(?:\/|$)/i, /agreement/i, /owner\/agreement/i, /upload/i, /pdf/i],
    methodPatterns: [/doc/i, /agreement/i, /upload/i, /pdf/i]
  });

  const fallbackPhaseFlow = (phase: DownstreamFlowTrace["phase"]): LinkedFlowEvidence | undefined =>
    [...canonicalFlows]
      .filter((candidate) => classifyFlowPhase(candidate) === phase)
      .sort((a, b) => b.confidence - a.confidence)[0];

  const orderedFlowCandidates = unique(
    [
      checkFlow ?? fallbackPhaseFlow("action-check"),
      inquiryFlow ?? fallbackPhaseFlow("action-read"),
      insertFlow ?? (classifyFlowPhase(primary) === "action-write" ? primary : undefined) ?? fallbackPhaseFlow("action-write"),
      docInsertFlow ?? (classifyFlowPhase(primary) === "action-document" ? primary : undefined) ?? fallbackPhaseFlow("action-document"),
      primary,
      ...canonicalFlows
    ]
      .filter((candidate): candidate is LinkedFlowEvidence => Boolean(candidate))
      .map((candidate) => `${candidate.apiUrl}|${candidate.backendControllerMethod}`)
  )
    .map((key) =>
      [
        checkFlow,
        inquiryFlow,
        insertFlow,
        docInsertFlow,
        classifyFlowPhase(primary) === "action-write" ? primary : undefined,
        classifyFlowPhase(primary) === "action-document" ? primary : undefined,
        primary,
        ...canonicalFlows
      ].find((candidate) => candidate && `${candidate.apiUrl}|${candidate.backendControllerMethod}` === key)
    )
    .filter((candidate): candidate is LinkedFlowEvidence => Boolean(candidate));

  const orderedFlows: LinkedFlowEvidence[] = [];
  const seenFlowKeys = new Set<string>();
  for (const candidate of orderedFlowCandidates) {
    if (!candidate) {
      continue;
    }
    const sharedNonActionTagCount = nonActionQuestionTags.filter((tag) =>
      (candidate.capabilityTags ?? []).includes(tag)
    ).length;
    if (
      candidate !== primary &&
      minSharedNonActionTags > 0 &&
      sharedNonActionTagCount < minSharedNonActionTags
    ) {
      continue;
    }
    const key = `${candidate.apiUrl}|${candidate.backendControllerMethod}`;
    if (seenFlowKeys.has(key)) {
      continue;
    }
    seenFlowKeys.add(key);
    orderedFlows.push(candidate);
    if (orderedFlows.length >= 4) {
      break;
    }
  }
  const traceByPhase = new Map<string, DownstreamFlowTrace>();
  for (const trace of options.downstreamTraces ?? []) {
    if (!traceByPhase.has(trace.phase)) {
      traceByPhase.set(trace.phase, trace);
    }
  }
  const traceByService = new Map((options.downstreamTraces ?? []).map((trace) => [trace.serviceMethod, trace] as const));
  const pickTraceSteps = (trace: DownstreamFlowTrace | undefined): string[] => {
    if (!trace) {
      return [];
    }
    if (trace.phase === "action-document") {
      const priorityPatterns = [
        /redis|session|cache/i,
        /select|get|load|read|query/i,
        /callMODC|document|agreement|pdf|upload|attachment|file/i,
        /callF|eai/i,
        /save|insert|persist|write/i,
        /update|modify|change/i
      ];
      const selected: string[] = [];
      for (const pattern of priorityPatterns) {
        const match = trace.steps.find((step) => pattern.test(step));
        if (match && !selected.includes(match)) {
          selected.push(match);
        }
      }
      return selected.slice(0, 6);
    }
    return trace.steps.slice(0, 4);
  };

  const answerLines = orderedFlows.map((flow, index) => {
    const stepPrefix = index === 0 ? "대표 경로) " : `보조 단계 ${index}) `;
    const phaseTrace =
      traceByPhase.get(classifyFlowPhase(flow)) ??
      flow.serviceHints.map((hint) => traceByService.get(hint)).find(Boolean);
    const servicePhrase =
      flow.serviceHints.length > 0
        ? `${flow.serviceHints.slice(0, 3).join(", ")}`
        : "서비스 레이어";
    const selectedSteps = pickTraceSteps(phaseTrace);
    const detailPhrase =
      selectedSteps.length > 0
        ? ` 하위에서는 ${selectedSteps.join(" -> ")} 흐름이 정적으로 확인된다.`
        : "";
    return `${stepPrefix}${flow.screenCode ?? flow.routePath ?? "프론트 화면"} -> ${flow.apiUrl} -> ${flow.gatewayControllerMethod ?? "gateway"} -> ${flow.backendControllerMethod}(${flow.backendPath}) -> ${servicePhrase}.${detailPhrase}`;
  });

  const primaryOverview =
    orderedFlows.length > 1
      ? `정적으로 복원된 대표 E2E 경로군은 ${
          orderedFlows
            .map((flow) => `${flow.screenCode ?? flow.routePath ?? "front"} -> ${flow.apiUrl} -> ${flow.backendControllerMethod}`)
            .join(" | ")
        } 순으로 이어진다.`
      : `정적으로 복원된 대표 E2E 경로는 ${primary.screenCode ?? primary.routePath ?? "front"} -> ${primary.apiUrl} -> ${primary.backendControllerMethod} 이다.`;

  const mentionedEaiIds = unique((options.downstreamTraces ?? []).flatMap((trace) => trace.eaiInterfaces)).slice(0, 4);
  const primarySpecificMatches = specificQuestionTags.filter((tag) => (primary.capabilityTags ?? []).includes(tag));
  const primaryFlowActions = inferFlowActionTags(primary);
  const flowSpecificMatches = unique(orderedFlows.flatMap((flow) => specificQuestionTags.filter((tag) => (flow.capabilityTags ?? []).includes(tag))));
  const distinctFlowActions = unique(orderedFlows.flatMap((flow) => inferFlowActionTags(flow)));
  const droppedIncoherentFlowCount = canonicalPlan.droppedIncoherentFlowCount;
  const canonicalNamespaceCount = canonicalPlan.canonicalNamespaceCount;
  const actionPhaseCount = unique(orderedFlows.map((flow) => classifyFlowPhase(flow))).length;
  const downstreamTraceCount = (options.downstreamTraces ?? []).length;
  let confidence = 0.34;
  confidence += Math.min(0.16, Math.max(0, primary.confidence) * 0.12);
  confidence += orderedFlows.length >= 2 ? 0.08 : 0.03;
  confidence += primary.serviceHints.length > 0 ? 0.08 : 0;
  confidence += downstreamTraceCount > 0 ? 0.12 : 0;
  confidence += mentionedEaiIds.length > 0 ? 0.06 : 0;
  confidence += Math.min(0.08, distinctFlowActions.length * 0.02);
  if (primarySpecificMatches.length > 0) {
    confidence += 0.18;
  } else if (specificQuestionTags.length === 0 && questionTags.some((tag) => (primary.capabilityTags ?? []).includes(tag))) {
    confidence += 0.08;
  }
  if (desiredActions.length > 0 && desiredActions.some((action) => primaryFlowActions.includes(action))) {
    confidence += 0.06;
  }
  if (flowSpecificMatches.length > 1) {
    confidence += 0.05;
  }
  if (specificQuestionTags.length > 0 && primarySpecificMatches.length === 0) {
    confidence -= 0.26;
  }
  if (droppedIncoherentFlowCount > 0) {
    confidence -= Math.min(0.18, droppedIncoherentFlowCount * 0.04);
  }
  if (canonicalNamespaceCount > 1) {
    confidence -= Math.min(0.16, (canonicalNamespaceCount - 1) * 0.08);
  }
  if (orderedFlows.length >= 3 && downstreamTraceCount === 0) {
    confidence -= 0.08;
  }
  if (orderedFlows.length >= 3 && actionPhaseCount >= 3 && downstreamTraceCount <= 1) {
    confidence -= 0.06;
  }
  if (orderedFlows.length <= 1 || distinctFlowActions.length <= 1) {
    confidence = Math.min(confidence, 0.72);
  }
  if (downstreamTraceCount === 0) {
    confidence = Math.min(confidence, 0.74);
  }
  if (downstreamTraceCount <= 1 && orderedFlows.length >= 3) {
    confidence = Math.min(confidence, 0.68);
  }
  if (specificQuestionTags.length > 0 && primarySpecificMatches.length === 0) {
    confidence = Math.min(confidence, 0.62);
  }
  confidence = Math.max(0.18, Math.min(0.82, Number(confidence.toFixed(2))));
  const answer = [
    primaryOverview,
    ...answerLines,
    mentionedEaiIds.length > 0
      ? `정적 근거로 확인된 주요 EAI는 ${mentionedEaiIds.join(", ")}이다.`
      : "현재 근거는 front -> API -> gateway/controller -> backend service 체인 중심이며, 그 이하 DAO/EAI 세부 호출은 일부만 정적으로 복원됐다."
  ].join(" ");

  const evidence = [
    `${primary.screenCode ?? primary.routePath ?? "(unknown screen)"} -> ${primary.routePath ?? primary.screenPath ?? "(route unknown)"}`,
    `${primary.apiUrl}${primary.gatewayControllerMethod ? ` -> ${primary.gatewayControllerMethod}` : ""} -> ${primary.backendControllerMethod}`,
    `${primary.backendPath}${primary.serviceHints.length > 0 ? ` -> ${primary.serviceHints.slice(0, 3).join(", ")}` : ""}`
  ];
  for (const trace of (options.downstreamTraces ?? []).slice(0, 3)) {
    evidence.push(`${trace.serviceMethod} (${trace.filePath}) -> ${trace.steps.slice(0, 4).join(" -> ")}`);
  }

  return {
    answer,
    confidence,
    evidence,
    caveats: [
      "static-flow-evidence",
      ...(specificQuestionTags.length > 0 && primarySpecificMatches.length === 0
        ? ["specific-capability-mismatch"]
        : []),
      ...(canonicalNamespaceCount > 1 ? ["mixed-namespace-evidence"] : []),
      ...(droppedIncoherentFlowCount > 0 ? ["incoherent-flow-filtered"] : []),
      ...((options.downstreamTraces ?? []).some((trace) => trace.steps.length > 0)
        ? ["downstream-static-trace"]
        : [])
    ]
  };
}

export type { FrontBackGraphSnapshot } from "./front-back-graph.js";
