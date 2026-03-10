export interface AskRetryEvidenceState {
  queryCandidates: string[];
  matchedKnowledgeIds: string[];
  mergedHitPaths: string[];
  hydratedPaths: string[];
  linkedFlowKeys: string[];
  linkedEaiIds: string[];
  downstreamKeys: string[];
}

export interface AskRetryEvidenceDelta {
  changed: boolean;
  changeCount: number;
  reasons: string[];
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function diffList(prefix: string, previous: string[], next: string[]): string[] {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  const added = next.filter((item) => !previousSet.has(item)).map((item) => `${prefix}:added:${item}`);
  const removed = previous.filter((item) => !nextSet.has(item)).map((item) => `${prefix}:removed:${item}`);
  return [...added, ...removed];
}

export function summarizeAskRetryEvidence(input: AskRetryEvidenceState): AskRetryEvidenceState {
  return {
    queryCandidates: unique(input.queryCandidates),
    matchedKnowledgeIds: unique(input.matchedKnowledgeIds),
    mergedHitPaths: unique(input.mergedHitPaths),
    hydratedPaths: unique(input.hydratedPaths),
    linkedFlowKeys: unique(input.linkedFlowKeys),
    linkedEaiIds: unique(input.linkedEaiIds),
    downstreamKeys: unique(input.downstreamKeys)
  };
}

export function compareAskRetryEvidence(
  previous: AskRetryEvidenceState,
  next: AskRetryEvidenceState
): AskRetryEvidenceDelta {
  const reasons = unique([
    ...diffList("query", previous.queryCandidates, next.queryCandidates),
    ...diffList("knowledge", previous.matchedKnowledgeIds, next.matchedKnowledgeIds),
    ...diffList("hits", previous.mergedHitPaths, next.mergedHitPaths),
    ...diffList("hydrated", previous.hydratedPaths, next.hydratedPaths),
    ...diffList("flow", previous.linkedFlowKeys, next.linkedFlowKeys),
    ...diffList("eai", previous.linkedEaiIds, next.linkedEaiIds),
    ...diffList("downstream", previous.downstreamKeys, next.downstreamKeys)
  ]);
  return {
    changed: reasons.length > 0,
    changeCount: reasons.length,
    reasons
  };
}

export function decideAskRetry(options: {
  attempt: number;
  maxAttempts: number;
  previousConfidence?: number;
  currentConfidence: number;
  evidenceDelta: AskRetryEvidenceDelta;
  minConfidenceGain?: number;
}): {
  shouldRetry: boolean;
  reason: string;
  confidenceGain: number;
} {
  const minConfidenceGain = options.minConfidenceGain ?? 0.04;
  const confidenceGain =
    options.previousConfidence == null ? Number.POSITIVE_INFINITY : options.currentConfidence - options.previousConfidence;

  if (options.attempt >= options.maxAttempts) {
    return {
      shouldRetry: false,
      reason: "max-attempts-reached",
      confidenceGain
    };
  }
  if (!options.evidenceDelta.changed) {
    return {
      shouldRetry: false,
      reason: "no-new-evidence",
      confidenceGain
    };
  }
  if (options.previousConfidence != null && confidenceGain < minConfidenceGain) {
    return {
      shouldRetry: false,
      reason: "low-confidence-gain",
      confidenceGain
    };
  }
  return {
    shouldRetry: true,
    reason: "retry-allowed",
    confidenceGain
  };
}
