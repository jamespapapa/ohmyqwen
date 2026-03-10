import { describe, expect, it } from "vitest";
import type { DomainPack } from "../src/server/domain-packs.js";
import {
  expandCapabilitySearchTerms,
  extractFlowCapabilityTagsFromTexts,
  extractQuestionCapabilityTags,
  scoreFlowCapabilityAlignment
} from "../src/server/flow-capabilities.js";
import { buildLinkedFlowEvidence, type LinkedFlowEvidence } from "../src/server/flow-links.js";
import type { FrontBackGraphSnapshot } from "../src/server/front-back-graph.js";

const loanDomainPack: DomainPack = {
  id: "loan",
  name: "대출",
  description: "대출 capability pack",
  families: ["loan"],
  enabledByDefault: true,
  capabilityTags: [
    {
      tag: "loan",
      aliases: ["대출", "loan"],
      questionPatterns: ["대출", "loan"],
      textPatterns: ["Loan", "/loan/", "loan"],
      searchTerms: ["LoanController", "LoanService", "LoanApply"],
      pathHints: ["dcp-loan/"],
      symbolHints: ["LoanController", "LoanService"],
      apiHints: ["/loan/"]
    }
  ],
  rankingPriors: [
    {
      whenQuestionHas: ["loan"],
      whenLinkHas: ["loan"],
      whenApiMatches: ["/loan/"],
      weight: 35,
      reason: "domain:loan"
    }
  ],
  exemplars: [],
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
  builtIn: false
};

describe("domain-backed capability extraction", () => {
  it("extracts question tags and search terms from configured domain packs", () => {
    const tags = extractQuestionCapabilityTags("대출 로직이 어떻게 실행되는지 알려줘.", {
      domainPacks: [loanDomainPack]
    });
    const textTags = extractFlowCapabilityTagsFromTexts([
      "dcp-loan/src/main/java/com/acme/LoanController.java",
      "/gw/api/loan/apply"
    ], {
      domainPacks: [loanDomainPack]
    });
    const terms = expandCapabilitySearchTerms(tags, {
      domainPacks: [loanDomainPack]
    });

    expect(tags).toContain("loan");
    expect(textTags).toContain("loan");
    expect(terms).toEqual(expect.arrayContaining(["LoanController", "LoanService", "LoanApply"]));
  });

  it("applies configured domain ranking priors to flow alignment", () => {
    const alignment = scoreFlowCapabilityAlignment(["loan"], ["loan"], {
      domainPacks: [loanDomainPack],
      apiText: "/gw/api/loan/apply",
      methodText: "LoanController.apply LoanService.submit"
    });

    expect(alignment.score).toBeGreaterThan(80);
    expect(alignment.reasons).toContain("domain:loan");
  });

  it("ranks domain-aligned cross-layer flows ahead of unrelated flows", () => {
    const snapshot: FrontBackGraphSnapshot = {
      version: 1,
      generatedAt: "2026-03-10T00:00:00.000Z",
      meta: {
        backendWorkspaceDir: "/work/backend",
        frontendWorkspaceDirs: ["/work/frontend"],
        asOfDate: "2026-03-10"
      },
      frontend: {
        routeCount: 2,
        screenCount: 2,
        apiCount: 2,
        routes: [],
        screens: []
      },
      backend: {
        routeCount: 2,
        gatewayRoutes: [],
        routes: []
      },
      links: [
        {
          confidence: 0.72,
          capabilityTags: ["benefit-claim"],
          frontend: {
            screenCode: "MDP-MYINT020220M",
            screenPath: "src/views/claim.vue",
            routePath: "/claim"
          },
          api: {
            rawUrl: "/gw/api/insurance/benefit/claim/insert",
            normalizedUrl: "/insurance/benefit/claim/insert",
            source: "http-call"
          },
          gateway: {},
          backend: {
            path: "/insurance/benefit/claim/insert",
            controllerMethod: "BenefitClaimController.insertBenefitClaim",
            filePath: "dcp-insurance/src/main/java/com/acme/BenefitClaimController.java",
            serviceHints: ["BenefitClaimService.saveBenefitClaim"]
          },
          evidence: ["frontend-http-call"]
        },
        {
          confidence: 0.69,
          capabilityTags: ["loan"],
          frontend: {
            screenCode: "MDP-MYLOAN010100M",
            screenPath: "src/views/loan.vue",
            routePath: "/loan"
          },
          api: {
            rawUrl: "/gw/api/loan/apply",
            normalizedUrl: "/loan/apply",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/loan/apply",
            controllerMethod: "LoanController.apply",
            filePath: "dcp-loan/src/main/java/com/acme/LoanController.java",
            serviceHints: ["LoanService.submit"]
          },
          evidence: ["frontend-http-call", "gateway-api-proxy"]
        }
      ],
      diagnostics: {
        parseFailures: [],
        unmatchedFrontendApis: [],
        unmatchedFrontendScreens: []
      }
    };

    const linked = buildLinkedFlowEvidence({
      question: "대출 로직이 frontend부터 backend까지 어떤 흐름으로 가는지 분석해줘.",
      snapshot,
      domainPacks: [loanDomainPack]
    });

    expect((linked[0] as LinkedFlowEvidence).backendControllerMethod).toBe("LoanController.apply");
    expect(linked[0]?.capabilityTags).toContain("loan");
  });
});
