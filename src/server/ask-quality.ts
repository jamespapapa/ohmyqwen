import type { DomainPack } from "./domain-packs.js";
import {
  extractFlowCapabilityTagsFromTexts,
  extractSpecificQuestionCapabilityTags,
  extractQuestionCapabilityTags,
  hasStrongFlowCapabilityAlignment,
  isCrossLayerFlowQuestion
} from "./flow-capabilities.js";
import {
  classifyAskQuestionType,
  getAskQuestionTypeContract,
  type AskQuestionType,
  type AskStrategyLike
} from "./question-types.js";

export type AskQualityStrategy = AskStrategyLike;

export interface AskQualityOutput {
  answer: string;
  confidence: number;
  evidence: string[];
  caveats: string[];
}

export interface AskHydratedQualityEvidence {
  path: string;
  reason: string;
  codeFile: boolean;
  moduleMatched: boolean;
}

export interface AskLinkedEaiQualityEvidence {
  interfaceId: string;
  interfaceName: string;
}

export interface AskLinkedFlowQualityEvidence {
  routePath?: string;
  screenCode?: string;
  apiUrl: string;
  gatewayPath?: string;
  gatewayControllerMethod?: string;
  backendPath: string;
  backendControllerMethod: string;
  serviceHints?: string[];
  capabilityTags?: string[];
}

function hasCodeFileEvidenceFromPaths(paths: string[]): boolean {
  return paths.some((entry) => /\.(java|kt|kts|ts|tsx|js|jsx|py|go|rs|cs)$/i.test(entry));
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function extractHydratedCalleeNames(hydratedEvidence: AskHydratedQualityEvidence[]): string[] {
  return hydratedEvidence
    .map((item) => {
      const match = item.reason.match(/^callee:([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
      return match?.[2];
    })
    .filter((item): item is string => Boolean(item));
}

function extractTargetSymbolNames(question: string): string[] {
  const candidates = new Set<string>();
  for (const match of question.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    candidates.add(match[1]);
    candidates.add(match[2]);
  }
  for (const match of question.matchAll(/\b([A-Z][A-Za-z0-9_]*(?:Controller|Service|Manager|Processor|Tasklet|Job|Step|Mapper|Dao))\b/g)) {
    candidates.add(match[1]);
  }
  for (const match of question.matchAll(/\b([a-z][A-Za-z0-9_]*(?:Service|Controller|Manager|Processor|Tasklet|Job|Step|Mapper|Dao|Flow|Trace|Check|Insert|Select|Save)[A-Za-z0-9_]*)\b/g)) {
    candidates.add(match[1]);
  }
  return Array.from(candidates);
}

function answerMentionsAny(answer: string, values: string[]): boolean {
  return values.some((value) => value && answer.includes(value));
}

function topLevelModulesFromPaths(paths: string[]): string[] {
  return unique(paths.map((entry) => entry.replace(/\\/g, "/").split("/")[0] ?? ""));
}

export function qualityGateForAskOutput(options: {
  output: AskQualityOutput;
  question: string;
  hitPaths: string[];
  strategy?: AskQualityStrategy;
  questionType?: AskQuestionType;
  hydratedEvidence?: AskHydratedQualityEvidence[];
  linkedEaiEvidence?: AskLinkedEaiQualityEvidence[];
  linkedFlowEvidence?: AskLinkedFlowQualityEvidence[];
  moduleCandidates?: string[];
  domainPacks?: DomainPack[];
  questionTags?: string[];
  matchedKnowledgeIds?: string[];
  matchedRetrievalUnitStatuses?: Array<"candidate" | "validated" | "derived" | "stale">;
}): {
  passed: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  const hydratedEvidence = options.hydratedEvidence ?? [];
  const linkedEaiEvidence = options.linkedEaiEvidence ?? [];
  const linkedFlowEvidence = options.linkedFlowEvidence ?? [];
  const moduleCandidates = options.moduleCandidates ?? [];
  const questionType =
    options.questionType ??
    classifyAskQuestionType({
      question: options.question,
      strategy: options.strategy,
      moduleCandidates,
      questionTags: options.questionTags,
      matchedKnowledgeIds: options.matchedKnowledgeIds
    }).type;
  const contract = getAskQuestionTypeContract(questionType);

  if (options.output.answer.trim().length < 80) {
    failures.push("answer-too-short");
  }
  if (options.output.evidence.length < contract.minEvidenceCount) {
    failures.push("missing-evidence");
  }
  if (options.output.confidence < 0.45) {
    failures.push("confidence-too-low");
  }

  if (contract.requireCodeEvidence && !hasCodeFileEvidenceFromPaths(options.hitPaths)) {
    failures.push("missing-code-evidence");
  }
  if (contract.requireCodeBodyEvidence && hydratedEvidence.filter((item) => item.codeFile).length === 0) {
    failures.push("missing-code-body-evidence");
  }
  if (moduleCandidates.length > 0 && hydratedEvidence.filter((item) => item.moduleMatched && item.codeFile).length === 0) {
    failures.push("missing-module-scoped-code-evidence");
  }
  if (
    (options.strategy === "module_flow_topdown" || options.strategy === "cross_layer_flow") &&
    !/(controller|service|entry|진입|호출|downstream|eai|mapper|dao|frontend|gateway|api)/i.test(options.output.answer)
  ) {
    failures.push("missing-topdown-structure");
  }

  const calleeNames = extractHydratedCalleeNames(hydratedEvidence);
  if (
    options.strategy === "module_flow_topdown" &&
    calleeNames.length > 0 &&
    !calleeNames.some((name) => options.output.answer.includes(name))
  ) {
    failures.push("missing-service-callee-detail");
  }

  if (
    (options.strategy === "module_flow_topdown" || options.strategy === "eai_interface") &&
    linkedEaiEvidence.length > 0 &&
    !linkedEaiEvidence.some(
      (item) => options.output.answer.includes(item.interfaceId) || options.output.answer.includes(item.interfaceName)
    )
  ) {
    failures.push("missing-linked-eai-detail");
  }

  if (questionType === "symbol_deep_trace") {
    const targetSymbols = extractTargetSymbolNames(options.question);
    if (targetSymbols.length > 0 && !answerMentionsAny(options.output.answer, targetSymbols)) {
      failures.push("missing-target-symbol-detail");
    }
    if (calleeNames.length > 0 && !answerMentionsAny(options.output.answer, calleeNames)) {
      failures.push("missing-symbol-callee-detail");
    }
    if (!/(호출|callee|service|controller|dao|mapper|eai|이후|다음|entry|return|downstream)/i.test(options.output.answer)) {
      failures.push("missing-symbol-trace-structure");
    }
  }

  if (questionType === "business_capability_trace") {
    const directTraceSignals = unique([
      ...calleeNames,
      ...linkedEaiEvidence.flatMap((item) => [item.interfaceId, item.interfaceName]),
      ...linkedFlowEvidence.flatMap((item) => [
        item.apiUrl,
        item.backendControllerMethod,
        ...(item.serviceHints ?? [])
      ])
    ]);
    if (contract.requireBusinessTraceDetail && directTraceSignals.length > 0 && !answerMentionsAny(options.output.answer, directTraceSignals)) {
      failures.push("missing-business-trace-detail");
    }
  }

  if (questionType === "module_role_explanation") {
    if (
      !/(역할|책임|담당|용도|dispatcher|queue|processor|callback|worker|routing|gateway|shared platform|render|mail|upload|bridge|scheduler|tasklet|비동기|후속 작업|오케스트레이션)/i.test(
        options.output.answer
      )
    ) {
      failures.push("missing-module-role-detail");
    }
    if (moduleCandidates.length > 0 && !moduleCandidates.some((candidate) => options.output.answer.includes(candidate))) {
      const moduleHits = topLevelModulesFromPaths(options.hitPaths);
      if (!moduleHits.some((candidate) => moduleCandidates.includes(candidate))) {
        failures.push("missing-module-role-scope");
      }
    }
  }

  const matchedRetrievalUnitStatuses = options.matchedRetrievalUnitStatuses ?? [];
  if (
    matchedRetrievalUnitStatuses.length > 0 &&
    matchedRetrievalUnitStatuses.every((status) => status === "stale") &&
    ["module_role_explanation", "channel_or_partner_integration", "process_or_batch_trace", "domain_capability_overview"].includes(
      questionType
    )
  ) {
    failures.push("stale-retrieval-only");
  }

  if (questionType === "process_or_batch_trace") {
    if (!/(job|scheduler|tasklet|step|processor|dispatcher|queue|worker|consumer|스케줄러|태스크렛|스텝|큐|워커|디스패처|프로세서)/i.test(options.output.answer)) {
      failures.push("missing-process-structure-detail");
    }
    if (calleeNames.length > 0 && !answerMentionsAny(options.output.answer, calleeNames)) {
      failures.push("missing-process-callee-detail");
    }
  }

  if (questionType === "channel_or_partner_integration") {
    const channelSignals = unique([
      ...(options.questionTags ?? [])
        .filter((item) => item.startsWith("channel:"))
        .flatMap((item) => [item, item.replace(/^channel:/, "")]),
      ...(options.matchedKnowledgeIds ?? [])
        .filter((item) => item.startsWith("channel:"))
        .flatMap((item) => [item, item.replace(/^channel:/, "")]),
      ...linkedFlowEvidence.flatMap((item) => [item.routePath ?? "", item.apiUrl, item.backendControllerMethod])
    ]);
    if (!/(monimo|모니모|partner|제휴|channel|채널|bridge|브릿지|callback|콜백|webhook|embedded|embeded|연계|외부)/i.test(options.output.answer)) {
      failures.push("missing-channel-integration-detail");
    }
    if (channelSignals.length > 0 && !answerMentionsAny(options.output.answer, channelSignals)) {
      failures.push("missing-channel-boundary-detail");
    }
  }

  if (questionType === "config_or_resource_explanation") {
    if (!/(xml|yml|yaml|config|설정|resource|리소스|menu|property|properties|interface)/i.test(options.output.answer)) {
      failures.push("missing-config-resource-detail");
    }
  }

  const crossLayerQuestion = isCrossLayerFlowQuestion(options.question);
  if (crossLayerQuestion && linkedFlowEvidence.length === 0) {
    failures.push("missing-linked-flow-evidence");
  }
  if (crossLayerQuestion && linkedFlowEvidence.length > 0) {
    const questionCapabilities =
      options.questionTags ??
      extractQuestionCapabilityTags(options.question, {
        domainPacks: options.domainPacks
      });
    const specificQuestionCapabilities = extractSpecificQuestionCapabilityTags(questionCapabilities, {
      domainPacks: options.domainPacks
    });
    const alignedFlowEvidence = questionCapabilities.length > 0
      ? linkedFlowEvidence.filter((item) =>
          hasStrongFlowCapabilityAlignment(
            questionCapabilities,
            item.capabilityTags ??
              extractFlowCapabilityTagsFromTexts([
                item.screenCode,
                item.routePath,
                item.apiUrl,
                item.gatewayPath,
                item.gatewayControllerMethod,
                item.backendPath,
                item.backendControllerMethod,
                ...(item.serviceHints ?? [])
              ], {
                domainPacks: options.domainPacks
              })
            ,
            {
              domainPacks: options.domainPacks,
              question: options.question,
              pathText: [item.routePath, item.backendPath].join(" "),
              apiText: item.apiUrl,
              methodText: [item.gatewayControllerMethod, item.backendControllerMethod, ...(item.serviceHints ?? [])].join(" ")
            }
          )
        )
      : linkedFlowEvidence;

    if (questionCapabilities.length > 0 && alignedFlowEvidence.length === 0) {
      failures.push("missing-question-capability-match");
    }
    if (
      specificQuestionCapabilities.length > 0 &&
      !linkedFlowEvidence.some((item) =>
        specificQuestionCapabilities.some((tag) => (item.capabilityTags ?? []).includes(tag))
      )
    ) {
      failures.push("missing-specific-business-capability-evidence");
    }
    const answerAlignedFlow = alignedFlowEvidence.some(
      (item) =>
        (item.screenCode && options.output.answer.includes(item.screenCode)) ||
        (item.routePath && options.output.answer.includes(item.routePath)) ||
        options.output.answer.includes(item.apiUrl) ||
        options.output.answer.includes(item.backendPath) ||
        options.output.answer.includes(item.backendControllerMethod) ||
        (item.serviceHints ?? []).some((hint) => options.output.answer.includes(hint))
    );
    const answerSpecificFlow = specificQuestionCapabilities.length === 0
      ? true
      : linkedFlowEvidence.some(
          (item) =>
            specificQuestionCapabilities.some((tag) => (item.capabilityTags ?? []).includes(tag)) &&
            (
              (item.screenCode && options.output.answer.includes(item.screenCode)) ||
              (item.routePath && options.output.answer.includes(item.routePath)) ||
              options.output.answer.includes(item.apiUrl) ||
              options.output.answer.includes(item.backendPath) ||
              options.output.answer.includes(item.backendControllerMethod) ||
              (item.serviceHints ?? []).some((hint) => options.output.answer.includes(hint))
            )
        );

    if (!linkedFlowEvidence.some((item) => (item.screenCode && options.output.answer.includes(item.screenCode)) || (item.routePath && options.output.answer.includes(item.routePath)))) {
      failures.push("missing-frontend-route-evidence");
    }
    if (!linkedFlowEvidence.some((item) => options.output.answer.includes(item.apiUrl))) {
      failures.push("missing-api-url-evidence");
    }
    if (
      linkedFlowEvidence.some((item) => item.gatewayControllerMethod || item.gatewayPath) &&
      !linkedFlowEvidence.some(
        (item) =>
          (item.gatewayControllerMethod && options.output.answer.includes(item.gatewayControllerMethod)) ||
          (item.gatewayPath && options.output.answer.includes(item.gatewayPath))
      )
    ) {
      failures.push("missing-gateway-evidence");
    }
    if (!linkedFlowEvidence.some((item) => options.output.answer.includes(item.backendPath) || options.output.answer.includes(item.backendControllerMethod) || (item.serviceHints ?? []).some((hint) => options.output.answer.includes(hint)))) {
      failures.push("missing-backend-route-evidence");
    }
    if (questionCapabilities.length > 0 && !answerAlignedFlow) {
      failures.push("missing-aligned-flow-detail");
    }
    if (specificQuestionCapabilities.length > 0 && !answerSpecificFlow) {
      failures.push("missing-specific-business-capability-detail");
    }
    if (!/(->|거쳐|호출|이어|gateway|controller|service|route)/i.test(options.output.answer)) {
      failures.push("missing-cross-layer-chain-detail");
    }
  }

  return {
    passed: failures.length === 0,
    failures
  };
}

export { extractHydratedCalleeNames, hasCodeFileEvidenceFromPaths };
