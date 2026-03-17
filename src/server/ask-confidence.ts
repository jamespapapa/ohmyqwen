import type { AskQuestionType } from "./question-types.js";

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function capAskConfidence(options: {
  confidence: number;
  questionType: AskQuestionType;
  linkedFlowEvidenceCount?: number;
  downstreamTraceCount?: number;
  caveats?: string[];
}): number {
  let capped = options.confidence;
  const caveats = unique(options.caveats ?? []);
  const linkedFlowEvidenceCount = options.linkedFlowEvidenceCount ?? 0;
  const downstreamTraceCount = options.downstreamTraceCount ?? 0;

  if (["cross_layer_flow", "channel_or_partner_integration"].includes(options.questionType)) {
    if (caveats.includes("mixed-namespace-evidence")) {
      capped = Math.min(capped, 0.58);
    }
    if (caveats.includes("specific-capability-mismatch")) {
      capped = Math.min(capped, 0.52);
    }
    if (linkedFlowEvidenceCount >= 3 && downstreamTraceCount === 0) {
      capped = Math.min(capped, 0.64);
    } else if (linkedFlowEvidenceCount >= 2 && downstreamTraceCount <= 1) {
      capped = Math.min(capped, 0.68);
    }
    if (caveats.includes("static-flow-evidence") && downstreamTraceCount <= 1) {
      capped = Math.min(capped, 0.66);
    }
  }

  return Math.max(0, Math.min(1, Number(capped.toFixed(2))));
}

