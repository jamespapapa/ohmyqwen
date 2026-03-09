export type AskQualityStrategy =
  | "method_trace"
  | "module_flow_topdown"
  | "architecture_overview"
  | "eai_interface"
  | "config_resource"
  | "general";

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

function hasCodeFileEvidenceFromPaths(paths: string[]): boolean {
  return paths.some((entry) => /\.(java|kt|kts|ts|tsx|js|jsx|py|go|rs|cs)$/i.test(entry));
}

function extractHydratedCalleeNames(hydratedEvidence: AskHydratedQualityEvidence[]): string[] {
  return hydratedEvidence
    .map((item) => {
      const match = item.reason.match(/^callee:([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
      return match?.[2];
    })
    .filter((item): item is string => Boolean(item));
}

export function qualityGateForAskOutput(options: {
  output: AskQualityOutput;
  question: string;
  hitPaths: string[];
  strategy?: AskQualityStrategy;
  hydratedEvidence?: AskHydratedQualityEvidence[];
  linkedEaiEvidence?: AskLinkedEaiQualityEvidence[];
  moduleCandidates?: string[];
}): {
  passed: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  const hydratedEvidence = options.hydratedEvidence ?? [];
  const linkedEaiEvidence = options.linkedEaiEvidence ?? [];
  const moduleCandidates = options.moduleCandidates ?? [];

  if (options.output.answer.trim().length < 80) {
    failures.push("answer-too-short");
  }
  if (options.output.evidence.length < 2) {
    failures.push("missing-evidence");
  }
  if (options.output.confidence < 0.45) {
    failures.push("confidence-too-low");
  }

  const logicQuestion = /(로직|흐름|어떻게|처리|구현|검증|계산|상태전이|service|controller|domain)/i.test(
    options.question
  );
  if (logicQuestion && !hasCodeFileEvidenceFromPaths(options.hitPaths)) {
    failures.push("missing-code-evidence");
  }
  if (logicQuestion && hydratedEvidence.filter((item) => item.codeFile).length === 0) {
    failures.push("missing-code-body-evidence");
  }
  if (moduleCandidates.length > 0 && hydratedEvidence.filter((item) => item.moduleMatched && item.codeFile).length === 0) {
    failures.push("missing-module-scoped-code-evidence");
  }
  if (
    options.strategy === "module_flow_topdown" &&
    !/(controller|service|entry|진입|호출|downstream|eai|mapper|dao)/i.test(options.output.answer)
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

  return {
    passed: failures.length === 0,
    failures
  };
}

export { extractHydratedCalleeNames, hasCodeFileEvidenceFromPaths };
