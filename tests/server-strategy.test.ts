import { describe, expect, it } from "vitest";
import {
  classifyQuestionIntentFallback,
  normalizeAskStrategyForQuestion,
  shouldShortCircuitDeterministicMethodAnswer
} from "../src/server/projects.js";

describe("server ask strategy normalization", () => {
  it("prioritizes cross-layer flow over generic method-flow keywords in fallback classification", () => {
    const result = classifyQuestionIntentFallback(
      "보험금 청구 로직이 frontend부터 backend까지 어떤 흐름으로 진행되는지 면밀히 분석해줘."
    );

    expect(result.strategy).toBe("cross_layer_flow");
  });

  it("normalizes any explicit frontend-backend question to cross_layer_flow", () => {
    const question = "frontend부터 backend까지 보험금 청구 흐름을 추적해줘.";

    expect(normalizeAskStrategyForQuestion(question, "method_trace")).toBe("cross_layer_flow");
    expect(normalizeAskStrategyForQuestion(question, "architecture_overview")).toBe("cross_layer_flow");
    expect(normalizeAskStrategyForQuestion(question, "cross_layer_flow")).toBe("cross_layer_flow");
  });

  it("normalizes storage/schema questions to config_resource", () => {
    const question = "redis 세션 정보는 어떤 값들이 저장되는지 확인해줘.";

    expect(normalizeAskStrategyForQuestion(question, "method_trace")).toBe("config_resource");
    expect(normalizeAskStrategyForQuestion(question, "general")).toBe("config_resource");
  });

  it("normalizes channel integration questions away from raw method_trace", () => {
    const question = "xpay bridge 회원 인증 로직이 어떻게 구현되는지 면밀히 분석해줘.";

    expect(normalizeAskStrategyForQuestion(question, "method_trace")).toBe("module_flow_topdown");
  });

  it("normalizes explicit endpoint/controller trace questions to method_trace instead of cross_layer_flow", () => {
    const question =
      "AccBenefitClaimController 안의 claim/doc/insert api가 하는 일을 분석하고, spotSave, validate, insert, doc/insert 순으로 호출하는 흐름도 봐줘.";

    expect(normalizeAskStrategyForQuestion(question, "cross_layer_flow")).toBe("method_trace");
    expect(classifyQuestionIntentFallback(question).strategy).toBe("method_trace");
  });

  it("does not short-circuit deterministic method answers for endpoint+sequence questions", () => {
    expect(
      shouldShortCircuitDeterministicMethodAnswer({
        question:
          "AccBenefitClaimController 안의 claim/doc/insert api가 있고, spotSave, validate, insert, doc/insert 순으로 호출하는 흐름도 분석해줘.",
        questionType: "symbol_deep_trace",
        strategy: "method_trace",
        gatePassed: true
      })
    ).toBe(false);
  });

  it("allows exact-trace deterministic answers to short-circuit when the gate passes", () => {
    expect(
      shouldShortCircuitDeterministicMethodAnswer({
        question:
          "AccBenefitClaimController 안의 claim/doc/insert api가 있고, spotSave, validate, insert, doc/insert 순으로 호출하는 흐름도 분석해줘.",
        questionType: "symbol_deep_trace",
        strategy: "method_trace",
        gatePassed: true,
        answerKind: "exact-trace"
      })
    ).toBe(true);
  });
});
