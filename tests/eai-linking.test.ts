import { describe, expect, it } from "vitest";
import type { EaiDictionaryEntry } from "../src/server/eai-dictionary.js";
import { rankEaiDictionaryEntriesForSummary } from "../src/server/eai-dictionary.js";
import { buildLinkedEaiEvidence } from "../src/server/eai-links.js";

function entry(input: Partial<EaiDictionaryEntry> & Pick<EaiDictionaryEntry, "interfaceId" | "interfaceName" | "purpose" | "sourcePath">): EaiDictionaryEntry {
  return {
    envPaths: [],
    usagePaths: [],
    moduleUsagePaths: [],
    reqSystemIds: [],
    javaCallSites: [],
    ...input
  };
}

describe("eai linking", () => {
  it("prefers directly linked dcp-insurance interfaces over unrelated xml-only interfaces", () => {
    const entries: EaiDictionaryEntry[] = [
      entry({
        interfaceId: "F10480011",
        interfaceName: "퇴직보험금 청구대상자 조회",
        purpose: "퇴직보험금 청구 대상 조회",
        sourcePath: "resources/eai/io/sli/ea2/F10480011_service.xml"
      }),
      entry({
        interfaceId: "F1FCZ0045",
        interfaceName: "홈페이지 사고보험금접수 명세 반영",
        purpose: "사고보험금 청구 반영",
        sourcePath: "resources/eai/io/sli/ea2/F1FCZ0045_service.xml",
        moduleUsagePaths: [
          "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java"
        ],
        javaCallSites: [
          {
            path: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java",
            className: "AccBenefitClaimService",
            methodName: "callF1FCZ0045",
            direct: true
          },
          {
            path: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java",
            className: "AccBenefitClaimService",
            methodName: "saveBenefitClaimDoc",
            direct: false
          }
        ]
      })
    ];

    const linked = buildLinkedEaiEvidence({
      question: "dcp-insurance 내부에서 보험금 청구 로직이 어떻게 실행되는지 탑다운으로 설명해줘.",
      moduleCandidates: ["dcp-insurance"],
      hydratedEvidence: [
        {
          path: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java",
          reason: "callee:AccBenefitClaimService.saveBenefitClaimDoc",
          snippet: "this.callF1FCZ0045(parameters);",
          codeFile: true,
          moduleMatched: true
        }
      ],
      hits: [
        {
          path: "resources/eai/io/sli/ea2/F10480011_service.xml",
          reason: "keyword:보험금",
          snippet: "퇴직보험금 청구대상자 조회"
        }
      ],
      entries
    });

    expect(linked[0]?.interfaceId).toBe("F1FCZ0045");
    expect(linked[0]?.reasons).toContain("direct-interface-id");
    expect(linked[0]?.reasons).toContain("module-scoped-usage");
  });

  it("ranks module-linked interfaces ahead of unrelated low-signal entries for summary exposure", () => {
    const ranked = rankEaiDictionaryEntriesForSummary([
      entry({
        interfaceId: "F10480011",
        interfaceName: "퇴직보험금 청구대상자 조회",
        purpose: "퇴직보험금 청구 대상 조회",
        sourcePath: "resources/eai/io/sli/ea2/F10480011_service.xml"
      }),
      entry({
        interfaceId: "F1FCZ0045",
        interfaceName: "홈페이지 사고보험금접수 명세 반영",
        purpose: "사고보험금 청구 반영",
        sourcePath: "resources/eai/io/sli/ea2/F1FCZ0045_service.xml",
        moduleUsagePaths: [
          "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java"
        ],
        javaCallSites: [
          {
            path: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java",
            methodName: "callF1FCZ0045",
            direct: true
          }
        ]
      })
    ]);

    expect(ranked[0]?.interfaceId).toBe("F1FCZ0045");
  });
});
