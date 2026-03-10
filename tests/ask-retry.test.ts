import { describe, expect, it } from "vitest";
import {
  compareAskRetryEvidence,
  decideAskRetry,
  summarizeAskRetryEvidence
} from "../src/server/ask-retry.js";

describe("ask retry", () => {
  it("detects evidence changes across retry rounds", () => {
    const previous = summarizeAskRetryEvidence({
      queryCandidates: ["loan flow"],
      matchedKnowledgeIds: ["graph:loan-credit-low-worker-request"],
      mergedHitPaths: ["dcp-loan/A.java"],
      hydratedPaths: ["dcp-loan/A.java"],
      linkedFlowKeys: ["MDP-A|/loan/a|LoanController.a"],
      linkedEaiIds: ["F1AAA0001"],
      downstreamKeys: []
    });
    const next = summarizeAskRetryEvidence({
      queryCandidates: ["loan flow", "sunshine loan request"],
      matchedKnowledgeIds: ["graph:loan-credit-low-worker-request", "graph:loan-credit-low-worker-request-apply"],
      mergedHitPaths: ["dcp-loan/A.java", "dcp-loan/B.java"],
      hydratedPaths: ["dcp-loan/A.java", "dcp-loan/B.java"],
      linkedFlowKeys: ["MDP-A|/loan/a|LoanController.a", "MDP-B|/loan/b|LoanController.b"],
      linkedEaiIds: ["F1AAA0001"],
      downstreamKeys: ["LoanService.apply"]
    });

    const delta = compareAskRetryEvidence(previous, next);
    expect(delta.changed).toBe(true);
    expect(delta.changeCount).toBeGreaterThan(0);
    expect(delta.reasons).toEqual(
      expect.arrayContaining([
        "query:added:sunshine loan request",
        "hits:added:dcp-loan/B.java",
        "downstream:added:LoanService.apply"
      ])
    );
  });

  it("stops retry when evidence did not change", () => {
    const state = summarizeAskRetryEvidence({
      queryCandidates: ["same"],
      matchedKnowledgeIds: ["k1"],
      mergedHitPaths: ["a"],
      hydratedPaths: ["a"],
      linkedFlowKeys: ["flow1"],
      linkedEaiIds: [],
      downstreamKeys: []
    });
    const delta = compareAskRetryEvidence(state, state);
    const decision = decideAskRetry({
      attempt: 1,
      maxAttempts: 5,
      currentConfidence: 0.42,
      evidenceDelta: delta
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe("no-new-evidence");
  });

  it("stops retry when confidence gain is too small even if evidence changed", () => {
    const decision = decideAskRetry({
      attempt: 2,
      maxAttempts: 5,
      previousConfidence: 0.61,
      currentConfidence: 0.63,
      evidenceDelta: {
        changed: true,
        changeCount: 2,
        reasons: ["hits:added:b", "flow:added:c"]
      },
      minConfidenceGain: 0.04
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe("low-confidence-gain");
  });

  it("stops retry when max attempts is reached", () => {
    const decision = decideAskRetry({
      attempt: 5,
      maxAttempts: 5,
      previousConfidence: 0.5,
      currentConfidence: 0.61,
      evidenceDelta: {
        changed: true,
        changeCount: 3,
        reasons: ["hits:added:c", "flow:added:d", "eai:added:F1AAA0002"]
      }
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe("max-attempts-reached");
  });

  it("allows retry on first failed attempt when evidence changed", () => {
    const decision = decideAskRetry({
      attempt: 1,
      maxAttempts: 5,
      currentConfidence: 0.41,
      evidenceDelta: {
        changed: true,
        changeCount: 2,
        reasons: ["query:added:sunshine-loan", "flow:added:MDP-X|/loan/apply|LoanController.apply"]
      }
    });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.reason).toBe("retry-allowed");
  });
});
