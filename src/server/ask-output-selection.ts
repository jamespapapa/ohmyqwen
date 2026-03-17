import type { AskQuestionType } from "./question-types.js";
import type { AskQualityOutput } from "./ask-quality.js";

export interface AskOutputChoice {
  output: AskQualityOutput;
  gatePassed: boolean;
  failures: string[];
  source: "generated" | "deterministic";
  reason:
    | "generated-default"
    | "deterministic-gate-fallback"
    | "deterministic-canonical-fallback"
    | "deterministic-confidence-fallback"
    | "deterministic-stronger";
}

function isCanonicalCrossLayerType(questionType: AskQuestionType): boolean {
  return questionType === "cross_layer_flow" || questionType === "channel_or_partner_integration";
}

function hasCanonicalFlowFailure(failures: string[]): boolean {
  return failures.some((failure) =>
    [
      "contains-unaligned-flow-detail",
      "missing-representative-flow-detail",
      "missing-canonical-flow-detail",
      "missing-aligned-flow-detail",
      "missing-specific-ontology-signal-detail"
    ].includes(failure)
  );
}

export function selectPreferredAskOutput(options: {
  questionType: AskQuestionType;
  retryTargetConfidence: number;
  generated: {
    output: AskQualityOutput;
    gatePassed: boolean;
    failures: string[];
  };
  deterministic?: {
    output: AskQualityOutput;
    gatePassed: boolean;
    failures: string[];
  } | null;
}): AskOutputChoice {
  const generated = options.generated;
  const deterministic = options.deterministic;

  if (!deterministic || !deterministic.gatePassed || !isCanonicalCrossLayerType(options.questionType)) {
    return {
      output: generated.output,
      gatePassed: generated.gatePassed,
      failures: generated.failures,
      source: "generated",
      reason: "generated-default"
    };
  }

  if (!generated.gatePassed) {
    return {
      output: deterministic.output,
      gatePassed: deterministic.gatePassed,
      failures: deterministic.failures,
      source: "deterministic",
      reason: "deterministic-gate-fallback"
    };
  }

  if (hasCanonicalFlowFailure(generated.failures)) {
    return {
      output: deterministic.output,
      gatePassed: deterministic.gatePassed,
      failures: deterministic.failures,
      source: "deterministic",
      reason: "deterministic-canonical-fallback"
    };
  }

  if (
    generated.output.confidence < options.retryTargetConfidence &&
    deterministic.output.confidence >= options.retryTargetConfidence
  ) {
    return {
      output: deterministic.output,
      gatePassed: deterministic.gatePassed,
      failures: deterministic.failures,
      source: "deterministic",
      reason: "deterministic-confidence-fallback"
    };
  }

  if (
    deterministic.output.confidence >= generated.output.confidence &&
    deterministic.output.evidence.length >= generated.output.evidence.length &&
    deterministic.output.caveats.length <= generated.output.caveats.length
  ) {
    return {
      output: deterministic.output,
      gatePassed: deterministic.gatePassed,
      failures: deterministic.failures,
      source: "deterministic",
      reason: "deterministic-stronger"
    };
  }

  return {
    output: generated.output,
    gatePassed: generated.gatePassed,
    failures: generated.failures,
    source: "generated",
    reason: "generated-default"
  };
}

