import { describe, expect, it } from "vitest";
import { buildQmdQueryCandidates, buildQmdQueryFromSignals } from "../src/retrieval/qmd-planner.js";

describe("qmd planner", () => {
  it("builds module-aware semantic query candidates for business logic questions", () => {
    const candidates = buildQmdQueryCandidates({
      task: "dcp-insurance 내부에서 보험금 청구 로직이 어떻게 실행되는지 saveBenefitClaimDoc 기준으로 파악해줘.",
      targetFiles: ["dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java"],
      verifyFeedback: ["saveBenefitClaimDoc 이후 EAI 호출 흐름이 보이지 않음"]
    });

    expect(candidates.length).toBeGreaterThan(2);
    expect(candidates.length).toBeLessThanOrEqual(6);
    expect(candidates[0]).toContain("dcp-insurance");
    expect(candidates.some((entry) => entry.includes("saveBenefitClaimDoc"))).toBe(true);
    expect(candidates.some((entry) => /\bclaim\b/i.test(entry))).toBe(true);
    expect(candidates.some((entry) => /\bcontroller\b/i.test(entry))).toBe(true);
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates.every((entry) => entry.length <= 220)).toBe(true);
  });

  it("pulls target file and verification/error signals into compact fallback candidates", () => {
    const candidates = buildQmdQueryCandidates({
      task: "보험금 청구 오류 수정",
      targetFiles: ["src/main/java/com/acme/ClaimFlowService.java"],
      diffSummary: ["ClaimFlowService updated around submitAccBenefitClaimDocAsync"],
      errorLogs: ["TypeError in ClaimFlowService line 88"],
      verifyFeedback: ["submitAccBenefitClaimDocAsync call chain missing"]
    });

    expect(candidates.some((entry) => entry.includes("ClaimFlowService"))).toBe(true);
    expect(candidates.some((entry) => entry.includes("submitAccBenefitClaimDocAsync"))).toBe(true);
    expect(candidates.some((entry) => /\berror\b/i.test(entry) || /\btypeerror\b/i.test(entry))).toBe(true);
  });

  it("derives module scope from target file paths even when the task text is generic", () => {
    const candidates = buildQmdQueryCandidates({
      task: "보험금 청구 흐름 분석",
      targetFiles: [
        "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/BenefitClaimService.java"
      ]
    });

    expect(candidates[0]).toContain("dcp-insurance");
    expect(candidates.some((entry) => entry.includes("BenefitClaimService"))).toBe(true);
  });

  it("uses the highest-priority candidate as the primary qmd query string", () => {
    const primary = buildQmdQueryFromSignals({
      task: "dcp-insurance 보험금 청구 saveBenefitClaimDoc 흐름 분석"
    });
    const candidates = buildQmdQueryCandidates({
      task: "dcp-insurance 보험금 청구 saveBenefitClaimDoc 흐름 분석"
    });

    expect(primary).toBe(candidates[0]);
  });
});
