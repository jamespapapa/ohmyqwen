import type { FrontBackGraphLink, FrontBackGraphSnapshot } from "./front-back-graph.js";
import type { DownstreamFlowTrace } from "./flow-trace.js";
import type { DomainPack } from "./domain-packs.js";
import type { LearnedKnowledgeSnapshot } from "./learned-knowledge.js";
import { extractLearnedKnowledgeTagsFromTexts } from "./learned-knowledge.js";
import {
  extractFlowCapabilityTagsFromTexts,
  extractQuestionCapabilityTags,
  hasStrongFlowCapabilityAlignment,
  isCrossLayerFlowQuestion,
  resolveQuestionCapabilityTags,
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
  const hitPaths = (options.hits ?? []).map((hit) => hit.path.toLowerCase());
  const crossLayer = isCrossLayerFlowQuestion(options.question);

  return options.snapshot.links
    .map((link) => {
      const capabilityTags = resolveLinkCapabilityTags(link, options.domainPacks, options.learnedKnowledge);
      const capabilityAlignment = scoreFlowCapabilityAlignment(questionTags, capabilityTags, {
        domainPacks: options.domainPacks,
        question: options.question,
        pathText: [link.frontend.screenPath, link.frontend.routePath, link.backend.filePath, link.backend.path].join(" "),
        apiText: [link.api.rawUrl, link.api.normalizedUrl].join(" "),
        methodText: [link.gateway.controllerMethod, link.backend.controllerMethod, ...link.backend.serviceHints].join(" ")
      });
      let score = link.confidence * 100 + capabilityAlignment.score;
      const reasons: string[] = [...capabilityAlignment.reasons];
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
      if (questionTags.includes("benefit-claim") && capabilityTags.includes("insurance-internet")) {
        score += 10;
        reasons.push("insurance-internet-match");
      }
      if (questionTags.includes("benefit-claim") && /(?:^|\.)(BenefitClaimController|AccBenefitClaimController)\./i.test(link.backend.controllerMethod)) {
        score += 24;
        reasons.push("benefit-claim-controller-match");
      } else if (questionTags.includes("benefit-claim") && /benefitclaim|accbenefitclaim/i.test(link.backend.controllerMethod)) {
        score += 16;
        reasons.push("benefit-claim-controller-match");
      }
      if (questionTags.includes("benefit-claim") && /\/((acc)?benefit)\/claim\//i.test(link.api.normalizedUrl)) {
        score += 22;
        reasons.push("benefit-claim-api-match");
      } else if (questionTags.includes("benefit-claim") && /\/((agent|diff)benefit)\/claim\//i.test(link.api.normalizedUrl)) {
        score += 8;
        reasons.push("benefit-claim-api-match");
      }
      if (questionTags.includes("benefit-claim")) {
        const flowText = `${link.api.normalizedUrl} ${link.backend.controllerMethod}`.toLowerCase();
        if (!/(취소|cancel|delete)/i.test(options.question) && /delete|cancel/.test(flowText)) {
          score -= 16;
          reasons.push("benefit-claim-delete-penalty");
        }
        if (/spotsave|spotload/.test(flowText)) {
          score -= 10;
          reasons.push("benefit-claim-draft-penalty");
        }
        if (/\/doc\/insert|insertbenefitclaimdoc/.test(flowText)) {
          score += 14;
          reasons.push("benefit-claim-doc-submit-match");
        }
        if (/insert|save|submit|proc/.test(flowText)) {
          score += 8;
          reasons.push("benefit-claim-submit-preference");
        } else if (/inqury|inquiry|check|load/.test(flowText)) {
          score += 4;
          reasons.push("benefit-claim-inquiry-preference");
        }
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

  const questionTags = options.questionTags ?? extractQuestionCapabilityTags(options.question);
  const questionIsClaim = questionTags.includes("benefit-claim") || /(보험금|청구|benefit|claim)/i.test(options.question);
  const questionIsSunshineLoan =
    questionTags.includes("sunshine-loan") || questionTags.includes("credit-low-worker-loan") || /햇살론/i.test(options.question);

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
    if (questionIsSunshineLoan && /\/loan\/contract\/inqury\//i.test(item.apiUrl)) {
      score -= 160;
    }
    if (questionIsClaim && /\/loan\//i.test(item.apiUrl)) {
      score -= 120;
    }
    return score;
  };

  const pickBestFlow = (criteria: Parameters<typeof scorePhaseCandidate>[1]): LinkedFlowEvidence | undefined =>
    [...options.linkedFlowEvidence]
      .map((item) => ({ item, score: scorePhaseCandidate(item, criteria) }))
      .sort((a, b) => b.score - a.score)
      .find((entry) => entry.score >= 120)?.item;

  const checkFlow = questionIsSunshineLoan
    ? pickBestFlow({
        tags: ["low-worker-loan-check"],
        apiPatterns: [/\/checktime$/i, /\/selectCustInfo$/i, /\/customer\/check$/i],
        methodPatterns: [/checkTimeService/i, /selectCustInfo/i, /checkCustomer/i]
      })
    : pickBestFlow({
        tags: ["claim-inquiry", "action-check"],
        apiPatterns: [/\/claim\/check$/i],
        methodPatterns: [/benefitClaimCheck/i, /checkApply/i]
      });

  const inquiryFlow = questionIsSunshineLoan
    ? pickBestFlow({
        tags: ["low-worker-loan-limit"],
        apiPatterns: [/\/limit\/amount(?:\/tmp)?$/i, /\/lowWorker\/getInput$/i],
        methodPatterns: [/limitAmount/i, /getLoanMemberInfo/i]
      })
    : pickBestFlow({
        tags: ["claim-inquiry", "action-inquiry"],
        apiPatterns: [/\/claim\/inqury$/i, /\/claim\/inquiry$/i],
        methodPatterns: [/benefitClaimInqr/i, /claimInq/i]
      });

  const accountFlow = questionIsSunshineLoan
    ? pickBestFlow({
        tags: ["low-worker-loan-account"],
        apiPatterns: [/\/insertAccntNo$/i, /\/getAccntNo$/i],
        methodPatterns: [/insertAccntNo/i, /getAccntNo/i]
      })
    : pickBestFlow({
        tags: ["action-account-register"],
        apiPatterns: [/insertAccntNo/i, /getAccntNo/i]
      });

  const insertFlow = questionIsSunshineLoan
    ? pickBestFlow({
        tags: ["low-worker-loan-apply"],
        apiPatterns: [
          /\/requestLoanMember$/i,
          /\/loanAdmit$/i,
          /\/apply$/i,
          /\/lowWorker\/saveInput$/i,
          /\/lowWorker\/saveInputInfo$/i
        ],
        methodPatterns: [/registLoanMember/i, /loanAdmit/i, /saveLoanMemberInfo/i, /saveLoanInputInfo/i]
      })
    : pickBestFlow({
        tags: ["claim-submit", "action-submit"],
        apiPatterns: [/\/claim\/insert$/i],
        methodPatterns: [/saveBenefitClaim/i, /insertBenefitClaim/i]
      });

  const docInsertFlow = questionIsSunshineLoan
    ? pickBestFlow({
        tags: ["low-worker-loan-doc"],
        apiPatterns: [/\/make\/owner\/agreement$/i],
        methodPatterns: [/makeOwnerAgreement/i, /makeDocListBeforeApply/i]
      })
    : pickBestFlow({
        tags: ["claim-doc", "action-doc"],
        apiPatterns: [/\/doc\/insert$/i],
        methodPatterns: [/saveBenefitClaimDoc/i, /insertBenefitClaimDoc/i]
      });

  const orderedFlows: LinkedFlowEvidence[] = [];
  const seenFlowKeys = new Set<string>();
  for (const candidate of [checkFlow, inquiryFlow, accountFlow, insertFlow, docInsertFlow, primary]) {
    if (!candidate) {
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
    confidence: (options.downstreamTraces ?? []).length > 0 ? 0.86 : primary.serviceHints.length > 0 ? 0.8 : 0.73,
    evidence,
    caveats: [
      "static-flow-evidence",
      ...((options.downstreamTraces ?? []).some((trace) => trace.steps.length > 0)
        ? ["downstream-static-trace"]
        : [])
    ]
  };
}

export type { FrontBackGraphSnapshot } from "./front-back-graph.js";
