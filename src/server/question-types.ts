import { z } from "zod";
import { isCrossLayerFlowQuestion } from "./flow-capabilities.js";

export const AskQuestionTypeSchema = z.enum([
  "cross_layer_flow",
  "business_capability_trace",
  "domain_capability_overview",
  "module_role_explanation",
  "process_or_batch_trace",
  "channel_or_partner_integration",
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
  requireRoleDetail?: boolean;
  requireProcessDetail?: boolean;
  requireChannelDetail?: boolean;
  requireTargetSymbolDetail?: boolean;
  requireOverviewStructure?: boolean;
  requireBusinessTraceDetail?: boolean;
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

function looksLikeBroadOverview(question: string): boolean {
  return /(관련 로직|전반|전체|어떻게 구현|구현되어 있는지|구성|개요|구조|아키텍처|큰 그림|전반적으로|전체적으로)/i.test(
    question
  );
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
