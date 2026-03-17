import { describe, expect, it } from "vitest";
import {
  buildQuestionOntologySignals,
  extractOntologyTextSignalsFromTexts,
  extractSpecificOntologySignals,
  hasStrongOntologySignalAlignment,
  scoreOntologySignalAlignment
} from "../src/server/ontology-signals.js";

describe("ontology signals", () => {
  it("extracts generic action, layer, token, and bigram signals from code-facing text", () => {
    const signals = extractOntologyTextSignalsFromTexts([
      "MDP-MYINT020210M",
      "/gw/api/insurance/benefit/claim/insert",
      "BenefitClaimController.insertBenefitClaim",
      "BenefitClaimService.saveBenefitClaim"
    ]);

    expect(signals).toEqual(
      expect.arrayContaining([
        "action-write",
        "gateway-routing",
        "backend-controller",
        "service-layer",
        "insurance",
        "benefit",
        "claim",
        "insert",
        "benefit-claim",
        "claim-insert"
      ])
    );
  });

  it("builds question signals without relying on domain-pack metadata", () => {
    const signals = buildQuestionOntologySignals({
      question: "보험금 청구 로직이 프론트부터 백엔드까지 어떻게 돌아가는지 분석해줘."
    });

    expect(signals).toEqual(
      expect.arrayContaining([
        "보험금",
        "청구",
        "프론트부터",
        "백엔드까지",
        "보험금-청구"
      ])
    );
  });

  it("keeps business-specific tokens in specific ontology signals while dropping structural noise", () => {
    const specific = extractSpecificOntologySignals([
      "frontend-flow",
      "gateway-routing",
      "backend-controller",
      "action-write",
      "benefit",
      "claim",
      "benefit-claim",
      "insurance"
    ]);

    expect(specific).toEqual(expect.arrayContaining(["benefit", "claim", "benefit-claim", "insurance"]));
    expect(specific).not.toContain("frontend-flow");
    expect(specific).not.toContain("action-write");
  });

  it("scores and recognizes strong alignment from shared ontology tokens and actions", () => {
    const questionSignals = buildQuestionOntologySignals({
      question: "loan credit low worker request apply 흐름이 프론트에서 백엔드까지 어떻게 이어지는지 알려줘."
    });
    const candidateSignals = extractOntologyTextSignalsFromTexts([
      "/gw/api/loan/credit/low/worker/request/apply",
      "CreditLowWorkerLoanRequestController.apply",
      "CreditLowWorkerLoanRequestService.apply"
    ]);

    const alignment = scoreOntologySignalAlignment(questionSignals, candidateSignals, {
      question: "햇살론 신청 로직이 프론트에서 백엔드까지 어떻게 이어지는지 알려줘.",
      apiText: "/gw/api/loan/credit/low/worker/request/apply",
      methodText: "CreditLowWorkerLoanRequestController.apply CreditLowWorkerLoanRequestService.apply"
    });

    expect(alignment.score).toBeGreaterThan(0);
    expect(hasStrongOntologySignalAlignment(questionSignals, candidateSignals)).toBe(true);
  });
});
