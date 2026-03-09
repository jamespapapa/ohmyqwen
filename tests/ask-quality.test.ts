import { describe, expect, it } from "vitest";
import { qualityGateForAskOutput } from "../src/server/ask-quality.js";

describe("ask quality gate", () => {
  it("passes module topdown answers only when module-scoped code evidence is present", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "Entry -> Controller -> Service -> downstream 흐름이며 saveBenefitClaimDoc 가 서비스 핵심 메서드로 실행된다.",
        confidence: 0.72,
        evidence: ["controller evidence", "service evidence"],
        caveats: []
      },
      question: "dcp-insurance 내부에서 보험금 청구 로직을 탑다운으로 설명해줘.",
      hitPaths: [
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java",
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java"
      ],
      strategy: "module_flow_topdown",
      moduleCandidates: ["dcp-insurance"],
      hydratedEvidence: [
        {
          path: "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java",
          reason: "method:AccBenefitClaimController.insertBenefitClaimDoc",
          codeFile: true,
          moduleMatched: true
        },
        {
          path: "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java",
          reason: "callee:AccBenefitClaimService.saveBenefitClaimDoc",
          codeFile: true,
          moduleMatched: true
        }
      ]
    });

    expect(gate.passed).toBe(true);
    expect(gate.failures).toEqual([]);
  });

  it("fails module topdown answers when hydrated service callee detail is omitted", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "Entry -> Controller -> Service -> downstream 흐름이다.",
        confidence: 0.72,
        evidence: ["controller evidence", "service evidence"],
        caveats: []
      },
      question: "dcp-insurance 내부에서 보험금 청구 로직을 탑다운으로 설명해줘.",
      hitPaths: [
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java",
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java"
      ],
      strategy: "module_flow_topdown",
      moduleCandidates: ["dcp-insurance"],
      hydratedEvidence: [
        {
          path: "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java",
          reason: "callee:AccBenefitClaimService.saveBenefitClaimDoc",
          codeFile: true,
          moduleMatched: true
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-service-callee-detail");
  });

  it("fails logic answers when only resource/xml evidence exists", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "보험금 청구는 XML과 설정 중심으로 보인다.",
        confidence: 0.51,
        evidence: ["xml evidence", "menu evidence"],
        caveats: []
      },
      question: "보험금 청구 로직이 어떻게 실행되는지 설명해줘.",
      hitPaths: ["resources/eai/env/dev/io/sli/ea2/F10480013_service.xml"],
      strategy: "architecture_overview",
      hydratedEvidence: []
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-code-evidence");
    expect(gate.failures).toContain("missing-code-body-evidence");
  });

  it("fails module-scoped answers when hydrated evidence does not stay inside the requested module", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "Controller -> Service -> mapper 흐름이며 saveBenefitClaimDoc 가 핵심이다.",
        confidence: 0.71,
        evidence: ["controller evidence", "service evidence"],
        caveats: []
      },
      question: "dcp-insurance 내부에서 보험금 청구 로직을 탑다운으로 설명해줘.",
      hitPaths: [
        "dcp-core/src/main/java/com/acme/CommonClaimService.java",
        "dcp-core/src/main/java/com/acme/CommonClaimMapper.java"
      ],
      strategy: "module_flow_topdown",
      moduleCandidates: ["dcp-insurance"],
      hydratedEvidence: [
        {
          path: "dcp-core/src/main/java/com/acme/CommonClaimService.java",
          reason: "callee:CommonClaimService.saveBenefitClaimDoc",
          codeFile: true,
          moduleMatched: false
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-module-scoped-code-evidence");
  });
});
