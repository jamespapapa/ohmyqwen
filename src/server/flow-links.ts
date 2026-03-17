import type { FrontBackGraphLink, FrontBackGraphSnapshot } from "./front-back-graph.js";
import type { DownstreamFlowTrace } from "./flow-trace.js";
import type { DomainPack } from "./domain-packs.js";
import type { LearnedKnowledgeSnapshot } from "./learned-knowledge.js";
import { extractLearnedKnowledgeTagsFromTexts } from "./learned-knowledge.js";
import { inferQuestionActionHints } from "./question-types.js";
import {
  extractFlowCapabilityTagsFromTexts,
  extractSpecificQuestionCapabilityTags,
  extractQuestionCapabilityTags,
  hasStrongFlowCapabilityAlignment,
  isCrossLayerFlowQuestion,
  resolveQuestionCapabilityTags,
  scoreSpecificCapabilityCoverage,
  scoreFlowCapabilityAlignment
} from "./flow-capabilities.js";

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

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function flowHasCapability(flow: LinkedFlowEvidence, capability: string): boolean {
  return (flow.capabilityTags ?? []).includes(capability);
}

function tokenize(value: string): string[] {
  return unique(value.toLowerCase().match(/[a-z0-9가-힣._/-]+/g) ?? []);
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
  const inferred = extractFlowCapabilityTagsFromTexts(
    [item.apiUrl, item.backendControllerMethod, ...(item.serviceHints ?? [])],
    {}
  ).filter(isActionCapabilityTag);
  return unique([...direct, ...inferred]);
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
  domainPacks?: DomainPack[],
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
    ...extractFlowCapabilityTagsFromTexts(texts, { domainPacks }),
    ...extractLearnedKnowledgeTagsFromTexts(texts, learnedKnowledge)
  ]);
}

export function buildLinkedFlowEvidence(options: {
  question: string;
  questionTags?: string[];
  hits?: SearchLikeHit[];
  snapshot: FrontBackGraphSnapshot;
  limit?: number;
  domainPacks?: DomainPack[];
  learnedKnowledge?: LearnedKnowledgeSnapshot;
}): LinkedFlowEvidence[] {
  const tokens = tokenize(options.question);
  const questionTags = options.questionTags ?? resolveQuestionCapabilityTags({
    question: options.question,
    domainPacks: options.domainPacks
  });
  const specificQuestionTags = extractSpecificQuestionCapabilityTags(questionTags, {
    domainPacks: options.domainPacks
  });
  const desiredActions = expandDesiredActionTags(inferQuestionActionHints(options.question, questionTags));
  const nonActionQuestionTags = questionTags.filter((tag) => !isActionCapabilityTag(tag));
  const minSharedNonActionTags =
    nonActionQuestionTags.length >= 3 ? 2 : nonActionQuestionTags.length >= 1 ? 1 : 0;
  const hitPaths = (options.hits ?? []).map((hit) => hit.path.toLowerCase());
  const crossLayer = isCrossLayerFlowQuestion(options.question);

  return options.snapshot.links
    .map((link) => {
      const capabilityTags = resolveLinkCapabilityTags(link, options.domainPacks, options.learnedKnowledge);
      const flowActions = inferFlowActionTags({
        apiUrl: link.api.normalizedUrl,
        backendControllerMethod: link.backend.controllerMethod,
        serviceHints: link.backend.serviceHints,
        capabilityTags
      });
      const capabilityAlignment = scoreFlowCapabilityAlignment(questionTags, capabilityTags, {
        domainPacks: options.domainPacks,
        question: options.question,
        pathText: [link.frontend.screenPath, link.frontend.routePath, link.backend.filePath, link.backend.path].join(" "),
        apiText: [link.api.rawUrl, link.api.normalizedUrl].join(" "),
        methodText: [link.gateway.controllerMethod, link.backend.controllerMethod, ...link.backend.serviceHints].join(" ")
      });
      const specificCoverage = scoreSpecificCapabilityCoverage(questionTags, capabilityTags, {
        domainPacks: options.domainPacks
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
      if (specificCoverage.matchedSpecificTags.length > 0) {
        score += Math.min(28, specificCoverage.matchedSpecificTags.length * 16);
        reasons.push(
          ...specificCoverage.matchedSpecificTags.slice(0, 3).map((tag) => `specific-capability:${tag}`)
        );
      }
      if (specificCoverage.sharedDomainParents.length > 0) {
        score += Math.min(10, specificCoverage.sharedDomainParents.length * 4);
        reasons.push(
          ...specificCoverage.sharedDomainParents.slice(0, 2).map((tag) => `shared-domain-parent:${tag}`)
        );
      }
      if (specificQuestionTags.length > 0 && specificCoverage.matchedSpecificTags.length === 0) {
        score -= 18;
        reasons.push("missing-specific-capability-match");
      }
      if (specificCoverage.adjacentConfusers.length > 0) {
        score -= Math.min(32, specificCoverage.adjacentConfusers.length * 12);
        reasons.push(
          ...specificCoverage.adjacentConfusers.slice(0, 3).map((tag) => `adjacent-capability:${tag}`)
        );
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
        !hasStrongFlowCapabilityAlignment(questionTags, capabilityTags, {
          domainPacks: options.domainPacks,
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
  domainPacks?: DomainPack[];
}): DeterministicFlowAnswer {
  const primary = options.linkedFlowEvidence[0];
  if (!primary) {
    return {
      answer: "충분한 근거를 확보하지 못해 확정 답변을 제공하기 어렵습니다. 재색인 후 다시 질의하세요.",
      confidence: 0.2,
      evidence: [],
      caveats: ["low-evidence"]
    };
  }

  const questionTags =
    options.questionTags ?? extractQuestionCapabilityTags(options.question, { domainPacks: options.domainPacks });
  const specificQuestionTags = extractSpecificQuestionCapabilityTags(questionTags, {
    domainPacks: options.domainPacks
  });
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
        score -= 120;
      }
    }
    const specificCoverage = scoreSpecificCapabilityCoverage(questionTags, item.capabilityTags ?? [], {
      domainPacks: options.domainPacks
    });
    if (specificCoverage.matchedSpecificTags.length > 0) {
      score += specificCoverage.matchedSpecificTags.length * 60;
    }
    if (specificQuestionTags.length > 0 && specificCoverage.matchedSpecificTags.length === 0) {
      score -= 140;
    }
    if (specificCoverage.adjacentConfusers.length > 0) {
      score -= specificCoverage.adjacentConfusers.length * 90;
    }
    return score;
  };

  const pickBestFlow = (criteria: Parameters<typeof scorePhaseCandidate>[1]): LinkedFlowEvidence | undefined =>
    [...options.linkedFlowEvidence]
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

  const accountFlow = pickBestFlow({
    tags: ["action-account-register"],
    apiPatterns: [/account/i, /accnt/i],
    methodPatterns: [/account/i, /accnt/i]
  });

  const insertFlow = pickBestFlow({
    tags: ["action-submit", "action-write", "action-register"],
    apiPatterns: [/\/insert(?:\/|$)/i, /\/apply(?:\/|$)/i, /\/submit(?:\/|$)/i, /\/save/i, /\/proc(?:\/|$)/i],
    methodPatterns: [/insert/i, /apply/i, /submit/i, /save/i, /regist/i, /register/i]
  });

  const docInsertFlow = pickBestFlow({
    tags: ["action-doc", "action-agreement"],
    apiPatterns: [/\/doc(?:\/|$)/i, /agreement/i, /owner\/agreement/i, /upload/i, /pdf/i],
    methodPatterns: [/doc/i, /agreement/i, /upload/i, /pdf/i]
  });

  const orderedFlows: LinkedFlowEvidence[] = [];
  const seenFlowKeys = new Set<string>();
  for (const candidate of [checkFlow, inquiryFlow, accountFlow, insertFlow, docInsertFlow, primary]) {
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
    if (trace.phase === "doc-insert") {
      const priorityPatterns = [/getRedisInfo/i, /selectClamDocument/i, /callMODC/i, /callF/i, /saveClamDocumentFile/i, /updateSubmitdate/i];
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
    const stepPrefix = `${index + 1}) `;
    const phaseTrace =
      (/\/doc\/insert/i.test(flow.apiUrl) ? traceByPhase.get("doc-insert") : undefined) ??
      (/\/claim\/insert/i.test(flow.apiUrl) && !/\/doc\/insert/i.test(flow.apiUrl) ? traceByPhase.get("claim-insert") : undefined) ??
      (/\/claim\/check/i.test(flow.apiUrl) ? traceByPhase.get("check") : undefined) ??
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

  const mentionedEaiIds = unique((options.downstreamTraces ?? []).flatMap((trace) => trace.eaiInterfaces)).slice(0, 4);
  const primarySpecificCoverage = scoreSpecificCapabilityCoverage(questionTags, primary.capabilityTags ?? [], {
    domainPacks: options.domainPacks
  });
  const primaryFlowActions = inferFlowActionTags(primary);
  const flowSpecificMatches = unique(
    orderedFlows.flatMap((flow) =>
      scoreSpecificCapabilityCoverage(questionTags, flow.capabilityTags ?? [], {
        domainPacks: options.domainPacks
      }).matchedSpecificTags
    )
  );
  const distinctFlowActions = unique(orderedFlows.flatMap((flow) => inferFlowActionTags(flow)));
  let confidence = 0.34;
  confidence += Math.min(0.16, Math.max(0, primary.confidence) * 0.12);
  confidence += orderedFlows.length >= 2 ? 0.08 : 0.03;
  confidence += primary.serviceHints.length > 0 ? 0.08 : 0;
  confidence += (options.downstreamTraces ?? []).length > 0 ? 0.12 : 0;
  confidence += mentionedEaiIds.length > 0 ? 0.06 : 0;
  confidence += Math.min(0.08, distinctFlowActions.length * 0.02);
  if (primarySpecificCoverage.matchedSpecificTags.length > 0) {
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
  if (specificQuestionTags.length > 0 && primarySpecificCoverage.matchedSpecificTags.length === 0) {
    confidence -= 0.26;
  }
  if (primarySpecificCoverage.adjacentConfusers.length > 0) {
    confidence -= Math.min(0.24, primarySpecificCoverage.adjacentConfusers.length * 0.12);
  }
  if ((options.downstreamTraces ?? []).length === 0) {
    confidence = Math.min(confidence, 0.78);
  }
  if (specificQuestionTags.length > 0 && primarySpecificCoverage.matchedSpecificTags.length === 0) {
    confidence = Math.min(confidence, 0.62);
  }
  confidence = Math.max(0.18, Math.min(0.86, Number(confidence.toFixed(2))));
  const answer = [
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
      ...(specificQuestionTags.length > 0 && primarySpecificCoverage.matchedSpecificTags.length === 0
        ? ["specific-capability-mismatch"]
        : []),
      ...((options.downstreamTraces ?? []).some((trace) => trace.steps.length > 0)
        ? ["downstream-static-trace"]
        : [])
    ]
  };
}

export type { FrontBackGraphSnapshot } from "./front-back-graph.js";
