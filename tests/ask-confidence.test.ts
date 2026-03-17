import { describe, expect, it } from "vitest";
import { capAskConfidence } from "../src/server/ask-confidence.js";

describe("ask confidence", () => {
  it("caps static-only cross-layer confidence for multi-step flows", () => {
    expect(
      capAskConfidence({
        confidence: 0.84,
        questionType: "cross_layer_flow",
        linkedFlowEvidenceCount: 3,
        downstreamTraceCount: 0,
        caveats: ["static-flow-evidence"]
      })
    ).toBeLessThanOrEqual(0.64);
  });

  it("caps mixed-namespace cross-layer confidence more aggressively", () => {
    expect(
      capAskConfidence({
        confidence: 0.79,
        questionType: "cross_layer_flow",
        linkedFlowEvidenceCount: 3,
        downstreamTraceCount: 1,
        caveats: ["mixed-namespace-evidence", "static-flow-evidence"]
      })
    ).toBeLessThanOrEqual(0.58);
  });

  it("does not cap unrelated question types with the cross-layer policy", () => {
    expect(
      capAskConfidence({
        confidence: 0.79,
        questionType: "module_role_explanation",
        linkedFlowEvidenceCount: 3,
        downstreamTraceCount: 0,
        caveats: ["static-flow-evidence"]
      })
    ).toBe(0.79);
  });
});

