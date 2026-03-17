import { describe, expect, it } from "vitest";
import { selectPreferredAskOutput } from "../src/server/ask-output-selection.js";

describe("ask output selection", () => {
  const deterministic = {
    output: {
      answer: "대표 경로) A -> B -> C",
      confidence: 0.68,
      evidence: ["A", "B", "C"],
      caveats: ["static-flow-evidence"]
    },
    gatePassed: true,
    failures: []
  };

  it("prefers deterministic output when generated cross-layer answer fails gate", () => {
    const choice = selectPreferredAskOutput({
      questionType: "cross_layer_flow",
      retryTargetConfidence: 0.65,
      deterministic,
      generated: {
        output: {
          answer: "loan path ...",
          confidence: 0.77,
          evidence: ["loan"],
          caveats: []
        },
        gatePassed: false,
        failures: ["contains-unaligned-flow-detail"]
      }
    });

    expect(choice.source).toBe("deterministic");
    expect(choice.reason).toBe("deterministic-gate-fallback");
  });

  it("prefers deterministic output when generated answer misses canonical path semantics", () => {
    const choice = selectPreferredAskOutput({
      questionType: "cross_layer_flow",
      retryTargetConfidence: 0.65,
      deterministic,
      generated: {
        output: {
          answer: "보조 단계만 설명",
          confidence: 0.72,
          evidence: ["doc insert"],
          caveats: []
        },
        gatePassed: true,
        failures: ["missing-representative-flow-detail"]
      }
    });

    expect(choice.source).toBe("deterministic");
    expect(choice.reason).toBe("deterministic-canonical-fallback");
  });

  it("keeps generated output for non cross-layer question types", () => {
    const choice = selectPreferredAskOutput({
      questionType: "module_role_explanation",
      retryTargetConfidence: 0.65,
      deterministic,
      generated: {
        output: {
          answer: "module role answer",
          confidence: 0.73,
          evidence: ["module"],
          caveats: []
        },
        gatePassed: true,
        failures: []
      }
    });

    expect(choice.source).toBe("generated");
  });

  it("prefers deterministic output under high replay pressure for canonical issues", () => {
    const choice = selectPreferredAskOutput({
      questionType: "cross_layer_flow",
      retryTargetConfidence: 0.65,
      replayPressure: {
        level: "high",
        questionTypeCandidateCount: 5,
        canonicalIssueCount: 3,
        mixedNamespaceCount: 1,
        highRiskCount: 2
      },
      deterministic,
      generated: {
        output: {
          answer: "some generated answer",
          confidence: 0.76,
          evidence: ["A", "B"],
          caveats: []
        },
        gatePassed: true,
        failures: []
      }
    });

    expect(choice.source).toBe("deterministic");
    expect(choice.reason).toBe("deterministic-replay-pressure");
  });

  it("keeps generated output when replay pressure is low and generated is materially stronger", () => {
    const choice = selectPreferredAskOutput({
      questionType: "cross_layer_flow",
      retryTargetConfidence: 0.65,
      replayPressure: {
        level: "low",
        questionTypeCandidateCount: 1,
        canonicalIssueCount: 0,
        mixedNamespaceCount: 0,
        highRiskCount: 0
      },
      deterministic,
      generated: {
        output: {
          answer: "materially stronger generated answer",
          confidence: 0.89,
          evidence: ["A", "B", "C", "D"],
          caveats: []
        },
        gatePassed: true,
        failures: []
      }
    });

    expect(choice.source).toBe("generated");
  });
});
