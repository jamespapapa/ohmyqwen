import { describe, expect, it } from "vitest";
import type { QmdSearchHit } from "../src/retrieval/qmd-cli.js";
import { buildQmdQueryCandidates } from "../src/retrieval/qmd-planner.js";
import { postprocessQmdHits, selectEffectiveQmdQueryMode } from "../src/retrieval/qmd-strategy.js";

describe("qmd strategy", () => {
  it("switches natural-language and symbol-heavy queries to search_only for latency safety", () => {
    expect(
      selectEffectiveQmdQueryMode({
        configuredMode: "query_then_search",
        query: "dcp-insurance 내부에서 보험금 청구 로직이 어떻게 실행되는지, 큰 그림에서 탑다운 방식으로 파악해줘."
      })
    ).toBe("search_only");

    expect(
      selectEffectiveQmdQueryMode({
        configuredMode: "query_then_search",
        query: "AccBenefitClaimService saveBenefitClaimDoc callF1FCZ0045"
      })
    ).toBe("search_only");

    expect(
      selectEffectiveQmdQueryMode({
        configuredMode: "query_then_search",
        query: "extraSignal implementation"
      })
    ).toBe("query_then_search");
  });

  it("filters memory/vendor noise and promotes module-scoped code hits", () => {
    const hits: QmdSearchHit[] = [
      {
        path: "memory/query-reports/latest.md",
        score: 0.96,
        title: "Query Report"
      },
      {
        path: "resources/inspinia/js/plugins/pwstrength/zxcvbn.js",
        score: 0.95,
        title: "zxcvbn"
      },
      {
        path: "dcp-insurance/src/main/java/com/acme/BenefitClaimController.java",
        score: 0.72,
        title: "BenefitClaimController"
      },
      {
        path: "resources/eai/io/sli/ea2/F1FCZ0045_service.xml",
        score: 0.68,
        title: "F1FCZ0045"
      }
    ];

    const ranked = postprocessQmdHits({
      hits,
      query: "dcp-insurance benefit claim flow",
      limit: 10
    });

    expect(ranked.map((hit) => hit.path)).toEqual([
      "dcp-insurance/src/main/java/com/acme/BenefitClaimController.java",
      "resources/eai/io/sli/ea2/F1FCZ0045_service.xml"
    ]);
  });

  it("prefers ontology-aligned hits over unrelated higher raw-score paths", () => {
    const hits: QmdSearchHit[] = [
      {
        path: "dcp-loan/src/main/java/com/acme/LoanRequestController.java",
        score: 0.91,
        title: "LoanRequestController",
        snippet: "loan request status update"
      },
      {
        path: "dcp-insurance/src/main/java/com/acme/BenefitClaimController.java",
        score: 0.73,
        title: "BenefitClaimController",
        snippet: "benefit claim insert submit"
      }
    ];

    const ranked = postprocessQmdHits({
      hits,
      query: "프론트부터 백엔드까지 엔드투엔드 흐름을 분석해줘",
      limit: 10,
      rerankContext: {
        evidencePaths: [
          "dcp-insurance/src/main/java/com/acme/BenefitClaimController.java"
        ],
        preferredPathPrefixes: ["dcp-insurance/"],
        preferredPathTokens: ["insurance", "benefit", "claim", "insert", "submit"],
        preferredTextTokens: ["benefit", "claim", "insert"]
      }
    });

    expect(ranked[0]?.path).toBe("dcp-insurance/src/main/java/com/acme/BenefitClaimController.java");
  });

  it("suppresses mixed-namespace hits when ontology context is coherent", () => {
    const hits: QmdSearchHit[] = [
      {
        path: "dcp-member/src/main/java/com/acme/MemberRegisterController.java",
        score: 0.89,
        title: "MemberRegisterController"
      },
      {
        path: "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java",
        score: 0.74,
        title: "AccBenefitClaimService"
      }
    ];

    const ranked = postprocessQmdHits({
      hits,
      query: "보험금 청구 저장 흐름을 코드 기준으로 분석해줘",
      limit: 10,
      rerankContext: {
        preferredPathPrefixes: ["dcp-insurance/"],
        preferredPathTokens: ["insurance", "benefit", "claim", "save"],
        preferredTextTokens: ["benefit", "claim", "save"]
      }
    });

    expect(ranked[0]?.path).toBe("dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java");
  });

  it("adds code-shaped English composite symbols for business-domain Korean questions", () => {
    const candidates = buildQmdQueryCandidates({
      task: "dcp-insurance 보험금 청구 로직을 탑다운으로 분석해줘"
    });

    expect(candidates.some((entry) => /BenefitClaim(Service|Controller)/.test(entry))).toBe(true);
  });
});
