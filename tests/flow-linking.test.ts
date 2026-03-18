import { describe, expect, it } from "vitest";
import {
  buildDeterministicFlowAnswer,
  buildLinkedFlowEvidence,
  type FrontBackGraphSnapshot
} from "../src/server/flow-links.js";

const snapshot: FrontBackGraphSnapshot = {
  version: 1,
  generatedAt: "2026-03-09T00:00:00.000Z",
  meta: {
    backendWorkspaceDir: "/work/dcp-services-mevelop",
    frontendWorkspaceDirs: ["/work/dcp-front-develop"],
    asOfDate: "2026-03-09"
  },
  frontend: {
    routeCount: 2,
    screenCount: 2,
    apiCount: 2,
    routes: [],
    screens: []
  },
  backend: {
    routeCount: 3,
    gatewayRoutes: [
      {
        path: "/api/**",
        controllerClass: "RouteController",
        controllerMethod: "route",
        filePath: "dcp-gateway/src/main/java/com/samsunglife/dcp/gateway/controller/RouteController.java",
        serviceHints: []
      }
    ],
    routes: []
  },
  links: [
    {
      confidence: 0.96,
      frontend: {
        screenCode: "MDP-MYINT022231M",
        screenPath: "src/views/mo/mysamsunglife/insurance/give/MDP-MYINT022231M.vue",
        routePath: "/mo/mysamsunglife/insurance/give/MDP-MYINT022231M"
      },
      api: {
        method: "POST",
        rawUrl: "/gw/api/insurance/division/appexpiry/inqury",
        normalizedUrl: "/insurance/division/appexpiry/inqury",
        functionName: "loadAppSbSearch",
        source: "http-call"
      },
      gateway: {
        path: "/api/**",
        controllerMethod: "RouteController.route"
      },
      backend: {
        path: "/insurance/division/appexpiry/inqury",
        controllerMethod: "DivisionExpController.inqury",
        filePath: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/give/controller/DivisionExpController.java",
        serviceHints: ["DivisionExpService.selectDivisionExpiry"]
      },
      evidence: ["frontend-route", "frontend-http-call", "backend-request-mapping", "gateway-api-proxy"]
    },
    {
      confidence: 0.84,
      frontend: {
        screenCode: "MDP-MYINT020210M",
        screenPath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M.vue",
        routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M"
      },
      api: {
        method: "POST",
        rawUrl: "/gw/api/insurance/benefit/claim/insert",
        normalizedUrl: "/insurance/benefit/claim/insert",
        functionName: "insertBenefitClaim",
        source: "http-call"
      },
      gateway: {
        path: "/api/**",
        controllerMethod: "RouteController.route"
      },
      backend: {
        path: "/insurance/benefit/claim/insert",
        controllerMethod: "BenefitClaimController.insertBenefitClaim",
        filePath: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/controller/BenefitClaimController.java",
        serviceHints: ["BenefitClaimService.saveBenefitClaim"]
      },
      evidence: ["frontend-route", "frontend-http-call", "backend-request-mapping", "gateway-api-proxy"]
    }
  ],
  diagnostics: {
    parseFailures: [],
    unmatchedFrontendApis: [],
    unmatchedFrontendScreens: []
  }
};

describe("flow linking", () => {
  it("builds deterministic cross-layer answers from linked evidence", () => {
    const linked = buildLinkedFlowEvidence({
      question: "MDP-MYINT022231M 화면에서 어떤 API를 거쳐 백엔드 서비스까지 들어가는지 추적해줘.",
      hits: [],
      snapshot
    });

    const output = buildDeterministicFlowAnswer({
      question: "MDP-MYINT022231M 화면에서 어떤 API를 거쳐 백엔드 서비스까지 들어가는지 추적해줘.",
      linkedFlowEvidence: linked
    });

    expect(output.answer).toContain("MDP-MYINT022231M");
    expect(output.answer).toContain("/gw/api/insurance/division/appexpiry/inqury");
    expect(output.answer).toContain("RouteController.route");
    expect(output.answer).toContain("DivisionExpController.inqury");
    expect(output.answer).toContain("DivisionExpService.selectDivisionExpiry");
    expect(output.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it("ranks exact screen-code matches ahead of unrelated high-confidence links", () => {
    const noisySnapshot = {
      ...snapshot,
      links: [
        ...snapshot.links,
        {
          confidence: 0.99,
          frontend: {
            screenCode: "PDC-MRMAN010240M",
            screenPath: "src/views/pc/individual/display/footer/PDC-MRMAN010240M.vue",
            routePath: "/pc/individual/display/footer/PDC-MRMAN010240M"
          },
          api: {
            rawUrl: "/display/agreement/one",
            normalizedUrl: "/display/agreement/one",
            source: "vuedoc-api"
          },
          gateway: {},
          backend: {
            path: "/display/agreement/one",
            controllerMethod: "DisplayAgreementController.selectAgreement",
            filePath: "dcp-display/src/main/java/com/acme/DisplayAgreementController.java",
            serviceHints: ["DisplayAgreementService.selectAgreement"]
          },
          evidence: ["frontend-route", "backend-request-mapping"]
        }
      ]
    } satisfies FrontBackGraphSnapshot;

    const linked = buildLinkedFlowEvidence({
      question: "MDP-MYINT022231M 화면에서 어떤 API를 거쳐 백엔드 서비스까지 들어가는지 추적해줘.",
      hits: [],
      snapshot: noisySnapshot
    });

    expect(linked[0]?.screenCode).toBe("MDP-MYINT022231M");
  });

  it("recomputes ontology tags from path and method text instead of stale snapshot tags", () => {
    const loanSnapshot = {
      ...snapshot,
      links: [
        {
          confidence: 0.88,
          capabilityTags: ["benefit-claim", "claim-insert"],
          frontend: {
            screenCode: "MDP-MYLOT021301C",
            screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021301C.vue",
            routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021301C"
          },
          api: {
            rawUrl: "/gw/api/loan/credit/low/worker/request/checktime",
            normalizedUrl: "/loan/credit/low/worker/request/checktime",
            functionName: "checkTime",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/loan/credit/low/worker/request/checktime",
            controllerMethod: "CreditLowWorkerLoanRequestController.checkTimeService",
            filePath: "dcp-loan/src/main/java/com/acme/CreditLowWorkerLoanRequestController.java",
            serviceHints: ["CreditLowWorkerLoanRequestService.validateAccessTime"]
          },
          evidence: ["frontend-http-call", "gateway-api-proxy"]
        }
      ]
    } satisfies FrontBackGraphSnapshot;

    const linked = buildLinkedFlowEvidence({
      question: "checktime 요청이 프론트에서 백엔드까지 어떻게 이어지는지 분석해줘.",
      hits: [],
      snapshot: loanSnapshot
    });

    expect(linked[0]?.capabilityTags).toEqual(
      expect.arrayContaining(["loan", "request", "checktime", "action-write", "gateway-routing"])
    );
    expect(linked[0]?.capabilityTags).not.toContain("benefit-claim");
  });

  it("prefers direct path-token overlap for claim questions over adjacent insurance flows", () => {
    const linked = buildLinkedFlowEvidence({
      question: "보험금 청구 insert 흐름이 프론트부터 백엔드까지 어떻게 이어지는지 분석해줘.",
      hits: [],
      snapshot
    });

    expect(linked[0]?.screenCode).toBe("MDP-MYINT020210M");
    expect(linked[0]?.backendControllerMethod).toBe("BenefitClaimController.insertBenefitClaim");
  });

  it("prefers workflow-family coherent claim flows over adjacent same-namespace insurance flows", () => {
    const coherentSnapshot = {
      ...snapshot,
      links: [
        {
          confidence: 0.92,
          frontend: {
            screenCode: "MDP-MYINT020100M",
            screenPath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020100M.vue",
            routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020100M"
          },
          api: {
            method: "POST",
            rawUrl: "/gw/api/insurance/premium/payment/proc",
            normalizedUrl: "/insurance/premium/payment/proc",
            functionName: "premiumPaymentProc",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/insurance/premium/payment/proc",
            controllerMethod: "PremiumPaymentController.premiumPaymentProc",
            filePath: "dcp-insurance/src/main/java/com/acme/PremiumPaymentController.java",
            serviceHints: ["PremiumPaymentService.premiumPaymentProc"]
          },
          evidence: ["frontend-http-call", "gateway-api-proxy"]
        },
        {
          confidence: 0.84,
          frontend: {
            screenCode: "MDP-MYINT020200M",
            screenPath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020200M.vue",
            routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020200M"
          },
          api: {
            method: "POST",
            rawUrl: "/gw/api/insurance/benefit/claim/inquiry",
            normalizedUrl: "/insurance/benefit/claim/inquiry",
            functionName: "benefitClaimInquiry",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/insurance/benefit/claim/inquiry",
            controllerMethod: "BenefitClaimController.benefitClaimInquiry",
            filePath: "dcp-insurance/src/main/java/com/acme/BenefitClaimController.java",
            serviceHints: ["BenefitClaimService.loadBenefitClaim"]
          },
          evidence: ["frontend-http-call", "gateway-api-proxy"]
        },
        {
          confidence: 0.85,
          frontend: {
            screenCode: "MDP-MYINT020210M",
            screenPath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M.vue",
            routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M"
          },
          api: {
            method: "POST",
            rawUrl: "/gw/api/insurance/benefit/claim/insert",
            normalizedUrl: "/insurance/benefit/claim/insert",
            functionName: "insertBenefitClaim",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/insurance/benefit/claim/insert",
            controllerMethod: "BenefitClaimController.insertBenefitClaim",
            filePath: "dcp-insurance/src/main/java/com/acme/BenefitClaimController.java",
            serviceHints: ["BenefitClaimService.saveBenefitClaim"]
          },
          evidence: ["frontend-http-call", "gateway-api-proxy"]
        }
      ]
    } satisfies FrontBackGraphSnapshot;

    const linked = buildLinkedFlowEvidence({
      question: "보험금 청구 로직이 프론트부터 백엔드까지 어떻게 돌아가는지 설명해줘.",
      hits: [],
      snapshot: coherentSnapshot
    });

    expect(linked[0]?.backendControllerMethod).not.toBe("PremiumPaymentController.premiumPaymentProc");
    expect(linked.slice(0, 2).map((item) => item.backendControllerMethod)).toEqual(
      expect.arrayContaining([
        "BenefitClaimController.benefitClaimInquiry",
        "BenefitClaimController.insertBenefitClaim"
      ])
    );
  });

  it("filters incoherent cross-layer flows from deterministic answers", () => {
    const output = buildDeterministicFlowAnswer({
      question: "보험금 청구 로직이 프론트부터 백엔드까지 어떻게 돌아가는지 설명해줘.",
      questionTags: ["보험금", "청구", "benefit", "claim", "action-write"],
      linkedFlowEvidence: [
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M",
          screenCode: "MDP-MYINT020210M",
          apiUrl: "/gw/api/insurance/benefit/claim/insert",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/insert",
          backendControllerMethod: "BenefitClaimController.insertBenefitClaim",
          serviceHints: ["BenefitClaimService.saveBenefitClaim"],
          capabilityTags: ["insurance", "benefit", "claim", "insert", "action-write"],
          confidence: 0.88,
          reasons: []
        },
        {
          routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021200M",
          screenCode: "MDP-MYLOT021200M",
          apiUrl: "/gw/api/loan/v2/realty/request/house/collateral/status/check/customer",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/loan/v2/realty/request/house/collateral/status/check/customer",
          backendControllerMethod: "RealtyCollateralLoanV2StatusController.checkCustomer",
          serviceHints: ["RealtyCollateralLoanV2StatusService.callF1CLN0130"],
          capabilityTags: ["loan", "collateral", "customer", "check", "action-check"],
          confidence: 0.97,
          reasons: []
        }
      ]
    });

    expect(output.answer).toContain("/gw/api/insurance/benefit/claim/insert");
    expect(output.answer).not.toContain("/gw/api/loan/v2/realty/request/house/collateral/status/check/customer");
    expect(output.confidence).toBeLessThanOrEqual(0.78);
  });

  it("keeps coherent canonical flow details even when discovery order differs", () => {
    const output = buildDeterministicFlowAnswer({
      question: "보험금 청구 로직이 프론트부터 백엔드까지 어떻게 돌아가는지 설명해줘.",
      questionTags: ["보험금", "청구", "benefit", "claim", "action-read", "action-write", "action-document"],
      linkedFlowEvidence: [
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020220M",
          screenCode: "MDP-MYINT020220M",
          apiUrl: "/gw/api/insurance/benefit/claim/doc/insert",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/doc/insert",
          backendControllerMethod: "BenefitClaimController.insertBenefitClaimDoc",
          serviceHints: ["BenefitClaimService.saveBenefitClaimDoc"],
          capabilityTags: ["insurance", "benefit", "claim", "document", "action-document"],
          confidence: 0.84,
          reasons: []
        },
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M",
          screenCode: "MDP-MYINT020210M",
          apiUrl: "/gw/api/insurance/benefit/claim/insert",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/insert",
          backendControllerMethod: "BenefitClaimController.insertBenefitClaim",
          serviceHints: ["BenefitClaimService.saveBenefitClaim"],
          capabilityTags: ["insurance", "benefit", "claim", "insert", "action-write"],
          confidence: 0.86,
          reasons: []
        },
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020200M",
          screenCode: "MDP-MYINT020200M",
          apiUrl: "/gw/api/insurance/benefit/claim/inquiry",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/inquiry",
          backendControllerMethod: "BenefitClaimController.benefitClaimInquiry",
          serviceHints: ["BenefitClaimService.loadBenefitClaim"],
          capabilityTags: ["insurance", "benefit", "claim", "inquiry", "action-read"],
          confidence: 0.83,
          reasons: []
        }
      ]
    });

    const inquiryIndex = output.answer.indexOf("MDP-MYINT020200M");
    const insertIndex = output.answer.indexOf("MDP-MYINT020210M");
    const docInsertIndex = output.answer.indexOf("MDP-MYINT020220M");

    expect(inquiryIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThanOrEqual(0);
    if (docInsertIndex >= 0) {
      expect(docInsertIndex).toBeGreaterThan(insertIndex);
    }
  });

  it("adds mismatch caveats and lowers confidence when only adjacent flow evidence is available", () => {
    const output = buildDeterministicFlowAnswer({
      question: "보험금 청구 insert 흐름을 프론트부터 백엔드까지 추적해줘.",
      questionTags: ["benefit", "claim", "benefit-claim", "insert"],
      linkedFlowEvidence: [
        {
          routePath: "/mo/mysamsunglife/insurance/give/MDP-MYINT022231M",
          screenCode: "MDP-MYINT022231M",
          apiUrl: "/gw/api/insurance/division/appexpiry/inqury",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/division/appexpiry/inqury",
          backendControllerMethod: "DivisionExpController.inqury",
          serviceHints: ["DivisionExpService.selectDivisionExpiry"],
          capabilityTags: ["insurance", "division", "appexpiry", "inqury", "action-read"],
          confidence: 0.91,
          reasons: []
        }
      ]
    });

    expect(output.caveats).toContain("specific-capability-mismatch");
    expect(output.confidence).toBeLessThanOrEqual(0.62);
  });

  it("chooses a coherent canonical anchor instead of an isolated higher-confidence flow", () => {
    const output = buildDeterministicFlowAnswer({
      question: "보험금 청구 로직이 프론트부터 백엔드까지 어떻게 돌아가는지 설명해줘.",
      questionTags: ["보험금", "청구", "benefit", "claim", "action-read", "action-write"],
      linkedFlowEvidence: [
        {
          routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021200M",
          screenCode: "MDP-MYLOT021200M",
          apiUrl: "/gw/api/loan/v2/realty/request/house/collateral/status/check/customer",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/loan/v2/realty/request/house/collateral/status/check/customer",
          backendControllerMethod: "RealtyCollateralLoanV2StatusController.checkCustomer",
          serviceHints: ["RealtyCollateralLoanV2StatusService.callF1CLN0130"],
          capabilityTags: ["loan", "customer", "action-check"],
          confidence: 0.97,
          reasons: []
        },
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020200M",
          screenCode: "MDP-MYINT020200M",
          apiUrl: "/gw/api/insurance/benefit/claim/inquiry",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/inquiry",
          backendControllerMethod: "BenefitClaimController.benefitClaimInquiry",
          serviceHints: ["BenefitClaimService.loadBenefitClaim"],
          capabilityTags: ["insurance", "benefit", "claim", "action-read"],
          confidence: 0.83,
          reasons: []
        },
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M",
          screenCode: "MDP-MYINT020210M",
          apiUrl: "/gw/api/insurance/benefit/claim/insert",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/insert",
          backendControllerMethod: "BenefitClaimController.insertBenefitClaim",
          serviceHints: ["BenefitClaimService.saveBenefitClaim"],
          capabilityTags: ["insurance", "benefit", "claim", "action-write"],
          confidence: 0.84,
          reasons: []
        }
      ]
    });

    expect(output.answer).toContain("BenefitClaimController.benefitClaimInquiry");
    expect(output.answer).toContain("BenefitClaimController.insertBenefitClaim");
    expect(output.answer).not.toContain("RealtyCollateralLoanV2StatusController.checkCustomer");
  });

  it("caps confidence for static-only multi-step path synthesis", () => {
    const output = buildDeterministicFlowAnswer({
      question: "보험금 청구 로직이 프론트부터 백엔드까지 엔드투엔드로 어떻게 돌아가는지 설명해줘.",
      questionTags: ["보험금", "청구", "benefit", "claim", "action-read", "action-write", "action-document"],
      linkedFlowEvidence: [
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020200M",
          screenCode: "MDP-MYINT020200M",
          apiUrl: "/gw/api/insurance/benefit/claim/inquiry",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/inquiry",
          backendControllerMethod: "BenefitClaimController.benefitClaimInquiry",
          serviceHints: ["BenefitClaimService.loadBenefitClaim"],
          capabilityTags: ["insurance", "benefit", "claim", "action-read"],
          confidence: 0.86,
          reasons: []
        },
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M",
          screenCode: "MDP-MYINT020210M",
          apiUrl: "/gw/api/insurance/benefit/claim/insert",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/insert",
          backendControllerMethod: "BenefitClaimController.insertBenefitClaim",
          serviceHints: ["BenefitClaimService.saveBenefitClaim"],
          capabilityTags: ["insurance", "benefit", "claim", "action-write"],
          confidence: 0.87,
          reasons: []
        },
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020220M",
          screenCode: "MDP-MYINT020220M",
          apiUrl: "/gw/api/insurance/benefit/claim/doc/insert",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/doc/insert",
          backendControllerMethod: "BenefitClaimController.insertBenefitClaimDoc",
          serviceHints: ["BenefitClaimService.saveBenefitClaimDoc"],
          capabilityTags: ["insurance", "benefit", "claim", "action-document"],
          confidence: 0.85,
          reasons: []
        }
      ],
      downstreamTraces: []
    });

    expect(output.confidence).toBeLessThanOrEqual(0.68);
    expect(output.answer).toContain("대표 E2E 경로군");
  });

  it("keeps deterministic phase selection inside the primary workflow family", () => {
    const output = buildDeterministicFlowAnswer({
      question: "보험금 청구 로직이 프론트부터 백엔드까지 엔드투엔드로 어떻게 돌아가는지 설명해줘.",
      questionTags: ["보험금", "청구", "benefit", "claim", "action-read", "action-write", "action-document"],
      linkedFlowEvidence: [
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020540M",
          screenCode: "MDP-MYINT020540M",
          apiUrl: "/gw/api/insurance/accBenefit/claim/spotSave",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/accBenefit/claim/spotSave",
          backendControllerMethod: "AccBenefitClaimController.spotSave",
          serviceHints: ["AccBenefitClaimService.spotSave", "CallAccBenefitClaimService.callAddinsert"],
          capabilityTags: ["insurance", "benefit", "claim", "action-write"],
          confidence: 0.85,
          reasons: []
        },
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020220M",
          screenCode: "MDP-MYINT020220M",
          apiUrl: "/gw/api/insurance/accBenefit/claim/doc/insert",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/accBenefit/claim/doc/insert",
          backendControllerMethod: "AccBenefitClaimController.insertBenefitClaimDoc",
          serviceHints: ["AccBenefitClaimService.saveBenefitClaimDoc"],
          capabilityTags: ["insurance", "benefit", "claim", "action-document"],
          confidence: 0.84,
          reasons: []
        },
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020100M",
          screenCode: "MDP-MYINT020100M",
          apiUrl: "/gw/api/insurance/premium/payment/proc",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/premium/payment/proc",
          backendControllerMethod: "PremiumPaymentController.premiumPaymentProc",
          serviceHints: ["PremiumPaymentService.premiumPaymentProc"],
          capabilityTags: ["insurance", "payment", "action-write"],
          confidence: 0.92,
          reasons: []
        }
      ]
    });

    expect(output.answer).toContain("AccBenefitClaimController.spotSave");
    expect(output.answer).toContain("AccBenefitClaimController.insertBenefitClaimDoc");
    expect(output.answer).not.toContain("PremiumPaymentController.premiumPaymentProc");
  });

  it("prefers coherent namespace clusters during linked flow discovery", () => {
    const coherentSnapshot = {
      ...snapshot,
      links: [
        {
          confidence: 0.97,
          frontend: {
            screenCode: "MDP-MYLOT021200M",
            screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021200M.vue",
            routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021200M"
          },
          api: {
            method: "POST",
            rawUrl: "/gw/api/loan/v2/realty/request/house/collateral/status/check/customer",
            normalizedUrl: "/loan/v2/realty/request/house/collateral/status/check/customer",
            functionName: "checkCustomer",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/loan/v2/realty/request/house/collateral/status/check/customer",
            controllerMethod: "RealtyCollateralLoanV2StatusController.checkCustomer",
            filePath: "dcp-loan/src/main/java/com/acme/RealtyCollateralLoanV2StatusController.java",
            serviceHints: ["RealtyCollateralLoanV2StatusService.callF1CLN0130"]
          },
          evidence: ["frontend-http-call", "gateway-api-proxy"]
        },
        {
          confidence: 0.84,
          frontend: {
            screenCode: "MDP-MYINT020200M",
            screenPath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020200M.vue",
            routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020200M"
          },
          api: {
            method: "POST",
            rawUrl: "/gw/api/insurance/benefit/claim/inquiry",
            normalizedUrl: "/insurance/benefit/claim/inquiry",
            functionName: "benefitClaimInquiry",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/insurance/benefit/claim/inquiry",
            controllerMethod: "BenefitClaimController.benefitClaimInquiry",
            filePath: "dcp-insurance/src/main/java/com/acme/BenefitClaimController.java",
            serviceHints: ["BenefitClaimService.loadBenefitClaim"]
          },
          evidence: ["frontend-http-call", "gateway-api-proxy"]
        },
        {
          confidence: 0.85,
          frontend: {
            screenCode: "MDP-MYINT020210M",
            screenPath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M.vue",
            routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M"
          },
          api: {
            method: "POST",
            rawUrl: "/gw/api/insurance/benefit/claim/insert",
            normalizedUrl: "/insurance/benefit/claim/insert",
            functionName: "insertBenefitClaim",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/insurance/benefit/claim/insert",
            controllerMethod: "BenefitClaimController.insertBenefitClaim",
            filePath: "dcp-insurance/src/main/java/com/acme/BenefitClaimController.java",
            serviceHints: ["BenefitClaimService.saveBenefitClaim"]
          },
          evidence: ["frontend-http-call", "gateway-api-proxy"]
        }
      ]
    } satisfies FrontBackGraphSnapshot;

    const linked = buildLinkedFlowEvidence({
      question: "보험금 청구 로직이 프론트부터 백엔드까지 어떻게 돌아가는지 설명해줘.",
      questionTags: ["보험금", "청구", "benefit", "claim", "action-read", "action-write"],
      hits: [],
      snapshot: coherentSnapshot,
      limit: 3
    });

    expect(linked[0]?.backendControllerMethod).toContain("BenefitClaim");
    expect(linked.slice(0, 2).every((item) => item.backendPath.startsWith("/insurance/"))).toBe(true);
  });
});
