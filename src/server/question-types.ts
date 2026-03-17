import { z } from "zod";
import { isCrossLayerFlowQuestion } from "./ontology-signals.js";

export const AskQuestionTypeSchema = z.enum([
  "cross_layer_flow",
  "business_capability_trace",
  "domain_capability_overview",
  "module_role_explanation",
  "process_or_batch_trace",
  "channel_or_partner_integration",
  "state_store_schema",
  "config_or_resource_explanation",
  "symbol_deep_trace"
]);

export type AskQuestionType = z.infer<typeof AskQuestionTypeSchema>;

export type AskStrategyLike =
  | "method_trace"
  | "module_flow_topdown"
  | "cross_layer_flow"
  | "architecture_overview"
  | "eai_interface"
  | "config_resource"
  | "general";

export interface AskQuestionTypeDecision {
  type: AskQuestionType;
  confidence: number;
  reason: string;
  signals: string[];
}

export interface AskQuestionTypeContract {
  minEvidenceCount: number;
  requireCodeEvidence: boolean;
  requireCodeBodyEvidence: boolean;
  requireResourceSchemaDetail?: boolean;
  requireRoleDetail?: boolean;
  requireProcessDetail?: boolean;
  requireChannelDetail?: boolean;
  requireTargetSymbolDetail?: boolean;
  requireOverviewStructure?: boolean;
  requireBusinessTraceDetail?: boolean;
}

export interface AskQuestionTypeRetrievalContract {
  preferredMemoryFiles: string[];
  preferredUnitTypes: Array<"symbol-block" | "module-overview" | "flow" | "knowledge-cluster" | "eai-link" | "resource-schema">;
  queryHints: string[];
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function normalizeSignals(options: {
  questionTags?: string[];
  matchedKnowledgeIds?: string[];
}): string[] {
  return unique([...(options.questionTags ?? []), ...(options.matchedKnowledgeIds ?? [])]);
}

function hasSpecificCapabilitySignal(signals: string[]): boolean {
  return signals.some((signal) => {
    if (/^(channel:|module:|process:)/.test(signal)) {
      return false;
    }
    return !/^(loan|fund|benefit-claim|retire-pension|member-auth|general|gateway-api)$/.test(signal);
  });
}

function looksLikeSymbolQuestion(question: string): boolean {
  return /([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)|save[A-Z]|callF1[A-Z0-9]+|메서드|함수|method|symbol|심볼|호출흐름|콜트리/.test(
    question
  );
}

function looksLikeModuleRoleQuestion(question: string): boolean {
  return /(어떤 역할|무슨 역할|뭐하는|무엇을 하는|용도|책임|담당|프로젝트는|모듈은|역할을 하는지)/.test(question);
}

function looksLikeProcessQuestion(question: string, signals: string[]): boolean {
  return (
    /(batch|job|scheduler|tasklet|step|processor|dispatcher|queue|worker|consumer|배치|스케줄러|태스크렛|잡|큐|워커|프로세스)/i.test(
      question
    ) || signals.some((signal) => signal.startsWith("process:"))
  );
}

function looksLikeChannelQuestion(question: string, signals: string[]): boolean {
  return (
    /(monimo|모니모|partner|제휴|channel|채널|bridge|브릿지|callback|콜백|webhook|임베디드|embedded|embeded|외부연계|외부 채널)/i.test(
      question
    ) || signals.some((signal) => signal.startsWith("channel:"))
  );
}

function looksLikeConfigQuestion(question: string): boolean {
  return /(xml|yml|yaml|config|설정|resource|리소스|properties|menu|applicationcontext|인터페이스 설정)/i.test(question);
}

function looksLikeStateStoreQuestion(question: string, signals: string[]): boolean {
  return (
    /(redis|세션|session|cache|ttl|만료|serializer|직렬화|payload|field|필드|key|키|db\s|database|데이터베이스|table|테이블|entity|엔티티|model|모델|repository|mapper|dao|어떤 값|무슨 값|저장되|저장되는|저장돼|저장하)/i.test(
      question
    ) ||
    signals.some((signal) => /(?:redis|session|cache|store|table|entity|model|repository|mapper|dao|state-store|data-persistence)/i.test(signal))
  );
}

function looksLikeBroadOverview(question: string): boolean {
  return /(관련 로직|전반|전체|어떻게 구현|구현되어 있는지|구성|개요|구조|아키텍처|큰 그림|전반적으로|전체적으로)/i.test(
    question
  );
}

export function inferQuestionActionHints(question: string, extraSignals: string[] = []): string[] {
  const text = `${question} ${extraSignals.join(" ")}`.toLowerCase();
  const actions: string[] = [];

  if (/(login|signin|auth|authenticate|cert|verify|인증|로그인|본인확인|회원 인증)/.test(text)) {
    actions.push("action-auth");
  }
  if (/(register|regist|signup|join|enroll|등록|가입)/.test(text)) {
    actions.push("action-register");
  }
  if (/(status|state|info|lookup|상태|현황|정보)/.test(text)) {
    actions.push("action-status-read");
  }
  if (/(select|get|load|read|inquiry|inqury|query|조회|확인|가져오)/.test(text)) {
    actions.push("action-read");
  }
  if (/(save|insert|create|add|persist|write|set|저장|생성|추가|기록)/.test(text)) {
    actions.push("action-write");
  }
  if (/(update|modify|change|patch|갱신|수정|변경)/.test(text)) {
    actions.push("action-update");
  }
  if (/(delete|remove|clear|expire|evict|삭제|제거|만료)/.test(text)) {
    actions.push("action-delete");
  }
  if (/(callback|webhook|notify|event|콜백|웹훅|알림|이벤트)/.test(text)) {
    actions.push("action-callback");
  }
  if (/(session|redis|cache|세션|캐시)/.test(text)) {
    actions.push("action-state-store");
  }
  if (/(token|refresh|토큰|재발급)/.test(text)) {
    actions.push("action-token");
  }

  return unique(actions);
}

export function classifyAskQuestionType(options: {
  question: string;
  strategy?: AskStrategyLike;
  moduleCandidates?: string[];
  questionTags?: string[];
  matchedKnowledgeIds?: string[];
}): AskQuestionTypeDecision {
  const question = options.question.trim();
  const strategy = options.strategy;
  const moduleCandidates = options.moduleCandidates ?? [];
  const signals = normalizeSignals(options);
  const specificCapability = hasSpecificCapabilitySignal(signals);

  if (isCrossLayerFlowQuestion(question) || strategy === "cross_layer_flow") {
    return {
      type: "cross_layer_flow",
      confidence: 0.95,
      reason: "explicit frontend/backend or screen/API/controller flow question",
      signals: unique(["cross-layer", ...signals])
    };
  }

  if (looksLikeStateStoreQuestion(question, signals)) {
    return {
      type: "state_store_schema",
      confidence: 0.87,
      reason: "state-store / persistence schema keywords detected",
      signals: unique(["state-store-schema", ...signals])
    };
  }

  if (looksLikeConfigQuestion(question) || strategy === "config_resource") {
    return {
      type: "config_or_resource_explanation",
      confidence: 0.84,
      reason: "config/resource keywords detected",
      signals: unique(["config-resource", ...signals])
    };
  }

  if (looksLikeModuleRoleQuestion(question) || (moduleCandidates.length > 0 && /(역할|용도|책임|뭐하는)/.test(question))) {
    return {
      type: "module_role_explanation",
      confidence: 0.88,
      reason: "module/project role explanation question detected",
      signals: unique([`modules=${moduleCandidates.join(",") || "none"}`, ...signals])
    };
  }

  if (looksLikeProcessQuestion(question, signals)) {
    return {
      type: "process_or_batch_trace",
      confidence: 0.86,
      reason: "batch/process keywords or learned process signals detected",
      signals: unique(["process-batch", ...signals])
    };
  }

  if (looksLikeChannelQuestion(question, signals)) {
    return {
      type: "channel_or_partner_integration",
      confidence: 0.85,
      reason: "channel/partner integration keywords detected",
      signals: unique(["channel-integration", ...signals])
    };
  }

  if (looksLikeSymbolQuestion(question) || strategy === "method_trace") {
    return {
      type: "symbol_deep_trace",
      confidence: 0.83,
      reason: "symbol/method-specific trace question detected",
      signals: unique(["symbol-trace", ...signals])
    };
  }

  if (strategy === "architecture_overview" || looksLikeBroadOverview(question)) {
    return {
      type: "domain_capability_overview",
      confidence: 0.78,
      reason: "broad domain/capability overview question detected",
      signals: unique(["domain-overview", ...signals])
    };
  }

  if (strategy === "module_flow_topdown" || specificCapability || strategy === "eai_interface") {
    return {
      type: "business_capability_trace",
      confidence: 0.8,
      reason: "business-capability execution trace question detected",
      signals: unique(["business-trace", ...signals])
    };
  }

  return {
    type: "domain_capability_overview",
    confidence: 0.58,
    reason: "fallback to broad capability overview",
    signals
  };
}

export function getAskQuestionTypeContract(type: AskQuestionType): AskQuestionTypeContract {
  switch (type) {
    case "cross_layer_flow":
      return {
        minEvidenceCount: 2,
        requireCodeEvidence: true,
        requireCodeBodyEvidence: false,
        requireBusinessTraceDetail: true
      };
    case "symbol_deep_trace":
      return {
        minEvidenceCount: 2,
        requireCodeEvidence: true,
        requireCodeBodyEvidence: true,
        requireTargetSymbolDetail: true,
        requireBusinessTraceDetail: true
      };
    case "module_role_explanation":
      return {
        minEvidenceCount: 2,
        requireCodeEvidence: true,
        requireCodeBodyEvidence: true,
        requireRoleDetail: true
      };
    case "process_or_batch_trace":
      return {
        minEvidenceCount: 2,
        requireCodeEvidence: true,
        requireCodeBodyEvidence: true,
        requireProcessDetail: true
      };
    case "channel_or_partner_integration":
      return {
        minEvidenceCount: 2,
        requireCodeEvidence: true,
        requireCodeBodyEvidence: true,
        requireChannelDetail: true
      };
    case "state_store_schema":
      return {
        minEvidenceCount: 2,
        requireCodeEvidence: true,
        requireCodeBodyEvidence: true,
        requireResourceSchemaDetail: true
      };
    case "business_capability_trace":
      return {
        minEvidenceCount: 2,
        requireCodeEvidence: true,
        requireCodeBodyEvidence: true,
        requireBusinessTraceDetail: true
      };
    case "config_or_resource_explanation":
      return {
        minEvidenceCount: 2,
        requireCodeEvidence: false,
        requireCodeBodyEvidence: false
      };
    case "domain_capability_overview":
      return {
        minEvidenceCount: 2,
        requireCodeEvidence: true,
        requireCodeBodyEvidence: true,
        requireOverviewStructure: true
      };
  }
}

export function getAskQuestionTypeRetrievalContract(type: AskQuestionType): AskQuestionTypeRetrievalContract {
  switch (type) {
    case "cross_layer_flow":
      return {
        preferredMemoryFiles: [
          "ontology-projections/latest.md",
          "ontology-graph/latest.md",
          "ontology-inputs/latest.md",
          "front-back-graph/latest.md",
          "front-catalog/latest.md",
          "retrieval-units/latest.md",
          "learned-knowledge/latest.md",
          "project-analysis/latest.md",
          "structure-index/latest.md"
        ],
        preferredUnitTypes: ["flow", "knowledge-cluster", "module-overview"],
        queryHints: ["frontend", "route", "api", "gateway", "controller", "service"]
      };
    case "symbol_deep_trace":
      return {
        preferredMemoryFiles: [
          "ontology-graph/latest.md",
          "ontology-review/latest.md",
          "structure-index/latest.md",
          "retrieval-units/latest.md",
          "learned-knowledge/latest.md",
          "project-analysis/latest.md",
          "eai-dictionary/latest.md"
        ],
        preferredUnitTypes: ["symbol-block", "eai-link", "flow"],
        queryHints: ["callee", "calls", "downstream", "service", "dao", "eai"]
      };
    case "module_role_explanation":
      return {
        preferredMemoryFiles: [
          "ontology-projections/latest.md",
          "ontology-graph/latest.md",
          "ontology-inputs/latest.md",
          "retrieval-units/latest.md",
          "learned-knowledge/latest.md",
          "project-analysis/latest.md",
          "structure-index/latest.md"
        ],
        preferredUnitTypes: ["module-overview", "knowledge-cluster", "flow"],
        queryHints: ["role", "responsibility", "dispatcher", "queue", "processor", "callback"]
      };
    case "process_or_batch_trace":
      return {
        preferredMemoryFiles: [
          "ontology-projections/latest.md",
          "ontology-graph/latest.md",
          "ontology-review/latest.md",
          "retrieval-units/latest.md",
          "structure-index/latest.md",
          "learned-knowledge/latest.md",
          "project-analysis/latest.md"
        ],
        preferredUnitTypes: ["flow", "module-overview", "knowledge-cluster", "symbol-block"],
        queryHints: ["batch", "job", "step", "tasklet", "scheduler", "processor", "queue"]
      };
    case "channel_or_partner_integration":
      return {
        preferredMemoryFiles: [
          "ontology-projections/latest.md",
          "ontology-graph/latest.md",
          "ontology-inputs/latest.md",
          "front-back-graph/latest.md",
          "front-catalog/latest.md",
          "retrieval-units/latest.md",
          "learned-knowledge/latest.md",
          "project-analysis/latest.md"
        ],
        preferredUnitTypes: ["flow", "knowledge-cluster", "module-overview"],
        queryHints: ["channel", "partner", "bridge", "callback", "webhook", "integration"]
      };
    case "state_store_schema":
      return {
        preferredMemoryFiles: [
          "ontology-graph/latest.md",
          "ontology-projections/latest.md",
          "ontology-review/latest.md",
          "retrieval-units/latest.md",
          "structure-index/latest.md",
          "project-analysis/latest.md"
        ],
        preferredUnitTypes: ["resource-schema", "symbol-block", "module-overview", "knowledge-cluster"],
        queryHints: ["redis", "session", "cache", "key", "field", "ttl", "serializer", "entity", "table", "repository", "mapper", "dao"]
      };
    case "business_capability_trace":
      return {
        preferredMemoryFiles: [
          "ontology-graph/latest.md",
          "ontology-review/latest.md",
          "retrieval-units/latest.md",
          "learned-knowledge/latest.md",
          "structure-index/latest.md",
          "project-analysis/latest.md",
          "eai-dictionary/latest.md"
        ],
        preferredUnitTypes: ["flow", "symbol-block", "eai-link", "knowledge-cluster"],
        queryHints: ["controller", "service", "orchestration", "mapper", "eai", "downstream"]
      };
    case "config_or_resource_explanation":
      return {
        preferredMemoryFiles: [
          "ontology-inputs/latest.md",
          "ontology-graph/latest.md",
          "project-profile/latest.md",
          "retrieval-units/latest.md",
          "eai-dictionary/latest.md",
          "structure-index/latest.md"
        ],
        preferredUnitTypes: ["resource-schema", "knowledge-cluster", "eai-link", "module-overview"],
        queryHints: ["xml", "config", "resource", "properties", "applicationcontext", "table", "entity", "model", "cache", "session"]
      };
    case "domain_capability_overview":
      return {
        preferredMemoryFiles: [
          "ontology-projections/latest.md",
          "ontology-graph/latest.md",
          "ontology-inputs/latest.md",
          "project-analysis/latest.md",
          "retrieval-units/latest.md",
          "project-profile/latest.md",
          "learned-knowledge/latest.md",
          "structure-index/latest.md",
          "eai-dictionary/latest.md"
        ],
        preferredUnitTypes: ["module-overview", "knowledge-cluster", "flow", "eai-link"],
        queryHints: ["architecture", "module", "service", "domain", "capability", "overview"]
      };
  }
}
