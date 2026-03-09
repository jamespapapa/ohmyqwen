import type { FrontBackGraphSnapshot } from "./front-back-graph.js";

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
  backendPath: string;
  backendControllerMethod: string;
  serviceHints: string[];
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

function isCrossLayerQuestion(question: string): boolean {
  return /(프론트|frontend|화면|버튼|vue|screen|ui|api|gateway)/i.test(question) && /(백엔드|backend|service|controller|route|흐름|trace|추적|거쳐)/i.test(question);
}

export function buildLinkedFlowEvidence(options: {
  question: string;
  hits?: SearchLikeHit[];
  snapshot: FrontBackGraphSnapshot;
  limit?: number;
}): LinkedFlowEvidence[] {
  const tokens = tokenize(options.question);
  const hitPaths = (options.hits ?? []).map((hit) => hit.path.toLowerCase());
  const crossLayer = isCrossLayerQuestion(options.question);

  return options.snapshot.links
    .map((link) => {
      let score = link.confidence * 100;
      const reasons: string[] = [];
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
      return {
        routePath: link.frontend.routePath,
        screenCode: link.frontend.screenCode,
        screenPath: link.frontend.screenPath,
        apiUrl: link.api.rawUrl,
        backendPath: link.backend.path,
        backendControllerMethod: link.backend.controllerMethod,
        serviceHints: link.backend.serviceHints,
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

  const answer = [
    `${primary.screenCode ?? primary.routePath ?? "프론트 화면"}에서 시작해 ${primary.apiUrl} API를 호출한다.`,
    `${primary.backendControllerMethod}(${primary.backendPath})로 연결되며,`,
    primary.serviceHints.length > 0
      ? `이후 서비스 레이어에서는 ${primary.serviceHints.slice(0, 3).join(", ")} 순으로 이어지는 정적 근거가 확인된다.`
      : "이후 서비스 레이어로 이어지는 정적 근거가 확인된다.",
    "현재 근거는 front -> API -> backend controller/service 체인 중심이며, 그 이하 DAO/EAI 세부 호출 순서는 추가 코드 확인이 필요하다."
  ].join(" ");

  const evidence = [
    `${primary.screenCode ?? primary.routePath ?? "(unknown screen)"} -> ${primary.routePath ?? primary.screenPath ?? "(route unknown)"}`,
    `${primary.apiUrl} -> ${primary.backendControllerMethod}`,
    `${primary.backendPath}${primary.serviceHints.length > 0 ? ` -> ${primary.serviceHints.slice(0, 3).join(", ")}` : ""}`
  ];

  return {
    answer,
    confidence: primary.serviceHints.length > 0 ? 0.78 : 0.71,
    evidence,
    caveats: ["static-flow-evidence"]
  };
}
