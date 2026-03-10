import { describe, expect, it } from "vitest";
import type { DomainPack } from "../src/server/domain-packs.js";
import {
  expandCapabilitySearchTerms,
  extractFlowCapabilityTagsFromTexts,
  extractQuestionCapabilityTags,
  resolveQuestionCapabilityTags,
  seedCapabilityTagsFromDomainPacks,
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
      kind: "domain",
      aliases: ["대출", "loan"],
      questionPatterns: ["대출", "loan"],
      textPatterns: ["Loan", "/loan/", "loan"],
      searchTerms: ["LoanController", "LoanService", "LoanApply"],
      pathHints: ["dcp-loan/"],
      symbolHints: ["LoanController", "LoanService"],
      apiHints: ["/loan/"]
    },
    {
      tag: "sunshine-loan",
      kind: "subdomain",
      aliases: ["햇살론", "모바일햇살론", "sunshine loan"],
      questionPatterns: ["햇살론", "모바일햇살론", "sunshine\\s*loan"],
      textPatterns: ["CreditLowWorkerLoan", "low/worker", "MYLOT0213"],
      searchTerms: ["CreditLowWorkerLoanReauestController", "CreditLowWorkerLoanReauestService"],
      pathHints: ["MYLOT0213"],
      symbolHints: ["CreditLowWorkerLoanReauestController", "CreditLowWorkerLoanReauestService"],
      apiHints: ["/loan/credit/low/worker/request/"],
      parents: ["loan"]
    }
  ],
  rankingPriors: [
    {
      whenQuestionHas: ["loan"],
      whenLinkHas: ["loan"],
      whenApiMatches: ["/loan/"],
      weight: 35,
      reason: "domain:loan"
    },
    {
      whenQuestionHas: ["sunshine-loan"],
      whenLinkHas: ["sunshine-loan"],
      whenApiMatches: ["/loan/credit/low/worker/request/"],
      weight: 45,
      reason: "domain:sunshine-loan"
    }
  ],
  exemplars: [],
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
  builtIn: false
};

describe("domain-backed capability extraction", () => {
  it("extracts sunshine-loan question tags and search terms from configured domain packs", () => {
    const tags = extractQuestionCapabilityTags("햇살론 대출 로직이 어떻게 실행되는지 알려줘.", {
      domainPacks: [loanDomainPack]
    });
    const textTags = extractFlowCapabilityTagsFromTexts(
      [
        "dcp-loan/src/main/java/com/acme/CreditLowWorkerLoanReauestController.java",
        "/gw/api/loan/credit/low/worker/request/selectCustInfo"
      ],
      {
        domainPacks: [loanDomainPack]
      }
    );
    const terms = expandCapabilitySearchTerms(tags, {
      domainPacks: [loanDomainPack]
    });

    expect(tags).toEqual(expect.arrayContaining(["loan", "sunshine-loan"]));
    expect(textTags).toEqual(expect.arrayContaining(["loan", "sunshine-loan"]));
    expect(terms).toEqual(
      expect.arrayContaining([
        "LoanController",
        "LoanService",
        "CreditLowWorkerLoanReauestController",
        "CreditLowWorkerLoanReauestService"
      ])
    );
  });

  it("applies configured domain ranking priors to sunshine-loan flow alignment", () => {
    const alignment = scoreFlowCapabilityAlignment(["loan", "sunshine-loan"], ["loan", "sunshine-loan"], {
      domainPacks: [loanDomainPack],
      apiText: "/gw/api/loan/credit/low/worker/request/selectCustInfo",
      methodText: "CreditLowWorkerLoanReauestController.selectCustInfo CreditLowWorkerLoanReauestService.selectCustInfo"
    });

    expect(alignment.score).toBeGreaterThan(120);
    expect(alignment.reasons).toEqual(expect.arrayContaining(["domain:loan", "domain:sunshine-loan"]));
  });

  it("ranks sunshine-loan cross-layer flows ahead of unrelated flows", () => {
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
          confidence: 0.91,
          capabilityTags: ["loan"],
          frontend: {
            screenCode: "MDP-PRLOP000010M",
            screenPath: "src/views/display/loanProduct.vue",
            routePath: "/display/loan/product"
          },
          api: {
            rawUrl: "/display/loan/product/basic",
            normalizedUrl: "/display/loan/product/basic",
            source: "http-call"
          },
          gateway: {},
          backend: {
            path: "/display/loan/product/basic",
            controllerMethod: "DisplayLoanProductController.selectLoanBasicList",
            filePath: "dcp-display/src/main/java/com/acme/DisplayLoanProductController.java",
            serviceHints: ["DisplayLoanProductService.selectLoanBasicList"]
          },
          evidence: ["frontend-http-call"]
        },
        {
          confidence: 0.69,
          capabilityTags: ["loan", "sunshine-loan", "action-inquiry"],
          frontend: {
            screenCode: "MDP-MYLOT021320M",
            screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021320M.vue",
            routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021320M"
          },
          api: {
            rawUrl: "/gw/api/loan/credit/low/worker/request/selectCustInfo",
            normalizedUrl: "/loan/credit/low/worker/request/selectCustInfo",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/loan/credit/low/worker/request/selectCustInfo",
            controllerMethod: "CreditLowWorkerLoanReauestController.selectCustInfo",
            filePath: "dcp-loan/src/main/java/com/acme/CreditLowWorkerLoanReauestController.java",
            serviceHints: ["CreditLowWorkerLoanReauestService.selectCustInfo"]
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
      question: "햇살론 대출 로직이 frontend부터 backend까지 어떤 흐름으로 가는지 분석해줘.",
      snapshot,
      domainPacks: [loanDomainPack]
    });

    expect((linked[0] as LinkedFlowEvidence).backendControllerMethod).toBe(
      "CreditLowWorkerLoanReauestController.selectCustInfo"
    );
    expect(linked[0]?.capabilityTags).toEqual(expect.arrayContaining(["loan", "sunshine-loan"]));
  });

  it("does not leak benefit-claim tags into sunshine-loan check flows", () => {
    const tags = extractFlowCapabilityTagsFromTexts(
      [
        "MDP-MYLOT021301C",
        "/gw/api/loan/credit/low/worker/request/checktime",
        "CreditLowWorkerLoanReauestController.checkTimeService"
      ],
      {
        domainPacks: [loanDomainPack]
      }
    );

    expect(tags).toEqual(expect.arrayContaining(["loan", "sunshine-loan", "action-check"]));
    expect(tags).not.toContain("benefit-claim");
    expect(tags).not.toContain("claim-inquiry");
  });

  it("does not over-tag agreement flows as sunshine-loan check/apply phases", () => {
    const tags = extractFlowCapabilityTagsFromTexts(
      [
        "MDP-MYLOT021370M",
        "/gw/api/loan/credit/low/worker/request/make/owner/agreement",
        "CreditLowWorkerLoanReauestController.makeOwnerAgreement",
        "CreditLowWorkerLoanPdfReauestService.makeDocListBeforeApply",
        "CreditLowWorkerLoanPdfReauestService.convertDownloadModel"
      ],
      {
        domainPacks: [loanDomainPack]
      }
    );

    expect(tags).toEqual(expect.arrayContaining(["loan", "sunshine-loan", "credit-low-worker-loan", "action-doc", "action-agreement"]));
    expect(tags).not.toContain("low-worker-loan-check");
    expect(tags).not.toContain("low-worker-loan-apply");
  });

  it("adds pinned domain seed tags when the user locks a domain", () => {
    const tags = resolveQuestionCapabilityTags({
      question: "check 흐름을 프론트부터 백엔드까지 추적해줘.",
      domainPacks: [loanDomainPack],
      pinnedDomainPacks: [loanDomainPack]
    });

    expect(seedCapabilityTagsFromDomainPacks([loanDomainPack])).toContain("loan");
    expect(tags).toContain("loan");
  });
});
