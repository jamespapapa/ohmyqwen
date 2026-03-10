import type { FrontBackGraphLink, FrontBackGraphSnapshot } from "./front-back-graph.js";
import {
  extractFlowCapabilityTagsFromTexts,
  extractQuestionCapabilityTags,
  hasStrongFlowCapabilityAlignment,
  isCrossLayerFlowQuestion,
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

function tokenize(value: string): string[] {
  return unique(value.toLowerCase().match(/[a-z0-9가-힣._/-]+/g) ?? []);
}

function resolveLinkCapabilityTags(link: FrontBackGraphLink): string[] {
  return Array.from(new Set([
    ...(link.capabilityTags ?? []),
    ...extractFlowCapabilityTagsFromTexts([
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
    ])
  ]));
}

export function buildLinkedFlowEvidence(options: {
  question: string;
  hits?: SearchLikeHit[];
  snapshot: FrontBackGraphSnapshot;
  limit?: number;
}): LinkedFlowEvidence[] {
  const tokens = tokenize(options.question);
  const questionTags = extractQuestionCapabilityTags(options.question);
  const hitPaths = (options.hits ?? []).map((hit) => hit.path.toLowerCase());
  const crossLayer = isCrossLayerFlowQuestion(options.question);

  return options.snapshot.links
    .map((link) => {
      const capabilityTags = resolveLinkCapabilityTags(link);
      const capabilityAlignment = scoreFlowCapabilityAlignment(questionTags, capabilityTags);
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
        if (/insert|save|submit|proc/.test(flowText)) {
          score += 8;
          reasons.push("benefit-claim-submit-preference");
        } else if (/inqury|inquiry|check|load/.test(flowText)) {
          score += 4;
          reasons.push("benefit-claim-inquiry-preference");
        }
      }
      if (questionTags.length > 0 && !hasStrongFlowCapabilityAlignment(questionTags, capabilityTags)) {
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
    .map(({ _score: _unusedScore, ...item }) => item)
    .slice(0, Math.max(1, options.limit ?? 6));
}

export function buildDeterministicFlowAnswer(options: {
  question: string;
  linkedFlowEvidence: LinkedFlowEvidence[];
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

  const gatewayPhrase = primary.gatewayControllerMethod
    ? `${primary.gatewayControllerMethod}${primary.gatewayPath ? `(${primary.gatewayPath})` : ""}를 거쳐 `
    : "";
  const answer = [
    `${primary.screenCode ?? primary.routePath ?? "프론트 화면"}에서 시작해 ${primary.apiUrl} API를 호출한다.`,
    `${gatewayPhrase}${primary.backendControllerMethod}(${primary.backendPath})로 연결되며,`,
    primary.serviceHints.length > 0
      ? `이후 서비스 레이어에서는 ${primary.serviceHints.slice(0, 3).join(", ")} 순으로 이어지는 정적 근거가 확인된다.`
      : "이후 서비스 레이어로 이어지는 정적 근거가 확인된다.",
    "현재 근거는 front -> API -> gateway/controller -> backend service 체인 중심이며, 그 이하 DAO/EAI 세부 호출 순서는 추가 코드 확인이 필요하다."
  ].join(" ");

  const evidence = [
    `${primary.screenCode ?? primary.routePath ?? "(unknown screen)"} -> ${primary.routePath ?? primary.screenPath ?? "(route unknown)"}`,
    `${primary.apiUrl}${primary.gatewayControllerMethod ? ` -> ${primary.gatewayControllerMethod}` : ""} -> ${primary.backendControllerMethod}`,
    `${primary.backendPath}${primary.serviceHints.length > 0 ? ` -> ${primary.serviceHints.slice(0, 3).join(", ")}` : ""}`
  ];

  return {
    answer,
    confidence: primary.serviceHints.length > 0 ? 0.8 : 0.73,
    evidence,
    caveats: ["static-flow-evidence"]
  };
}

export type { FrontBackGraphSnapshot } from "./front-back-graph.js";
