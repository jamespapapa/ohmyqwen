import { describe, expect, it } from "vitest";
import { buildDeterministicFlowAnswer, buildLinkedFlowEvidence, type FrontBackGraphSnapshot } from "../src/server/flow-links.js";

const snapshot: FrontBackGraphSnapshot = {
  version: 1,
  generatedAt: "2026-03-09T00:00:00.000Z",
  meta: {
    backendWorkspaceDir: "/work/dcp-services-mevelop",
    frontendWorkspaceDirs: ["/work/dcp-front-develop"],
    asOfDate: "2026-03-09"
  },
  frontend: {
    routeCount: 1,
    screenCount: 1,
    apiCount: 1,
    routes: [
      {
        routePath: "/mo/mysamsunglife/insurance/give/MDP-MYINT022231M",
        screenPath: "src/views/mo/mysamsunglife/insurance/give/MDP-MYINT022231M.vue",
        sourceFile: "src/router/mo/mysamsunglife/insurance/give/route.js",
        screenCode: "MDP-MYINT022231M"
      }
    ],
    screens: [
      {
        filePath: "src/views/mo/mysamsunglife/insurance/give/MDP-MYINT022231M.vue",
        screenCode: "MDP-MYINT022231M",
        componentName: "MDP-MYINT022231M",
        routePaths: ["/mo/mysamsunglife/insurance/give/MDP-MYINT022231M"],
        exportPaths: ["/mo/mysamsunglife/insurance/give/MDP-MYINT022231M"],
        apiPaths: ["/insurance/division/appexpiry/inqury"],
        httpCalls: [
          {
            method: "POST",
            rawUrl: "/gw/api/insurance/division/appexpiry/inqury",
            normalizedUrl: "/insurance/division/appexpiry/inqury",
            functionName: "loadAppSbSearch",
            source: "http-call"
          }
        ]
      }
    ]
  },
  backend: {
    routeCount: 2,
    gatewayRoutes: [
      {
        path: "/api/**",
        controllerClass: "RouteController",
        controllerMethod: "route",
        filePath: "dcp-gateway/src/main/java/com/samsunglife/dcp/gateway/controller/RouteController.java",
        serviceHints: []
      }
    ],
    routes: [
      {
        path: "/insurance/division/appexpiry/inqury",
        controllerClass: "DivisionExpController",
        controllerMethod: "inqury",
        filePath: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/give/controller/DivisionExpController.java",
        serviceHints: ["DivisionExpService.selectDivisionExpiry"]
      }
    ]
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
    }
  ],
  diagnostics: {
    parseFailures: [],
    unmatchedFrontendApis: [],
    unmatchedFrontendScreens: []
  }
};

describe("flow linking", () => {
  it("builds a deterministic cross-layer answer when linked flow evidence is already available", () => {
    const linked = buildLinkedFlowEvidence({
      question: "MDP-MYINT022231M 화면에서 어떤 API를 거쳐 dcp-insurance 서비스까지 들어가는지 프론트에서 백엔드까지 추적해줘.",
      hits: [],
      snapshot
    });

    const output = buildDeterministicFlowAnswer({
      question: "MDP-MYINT022231M 화면에서 어떤 API를 거쳐 dcp-insurance 서비스까지 들어가는지 프론트에서 백엔드까지 추적해줘.",
      linkedFlowEvidence: linked
    });

    expect(output.answer).toContain("MDP-MYINT022231M");
    expect(output.answer).toContain("/gw/api/insurance/division/appexpiry/inqury");
    expect(output.answer).toContain("RouteController.route");
    expect(output.answer).toContain("DivisionExpController.inqury");
    expect(output.answer).toContain("DivisionExpService.selectDivisionExpiry");
    expect(output.confidence).toBeGreaterThanOrEqual(0.7);
    expect(output.evidence.length).toBeGreaterThanOrEqual(3);
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
      question: "MDP-MYINT022231M 화면에서 어떤 API를 거쳐 dcp-insurance 서비스까지 들어가는지 프론트에서 백엔드까지 추적해줘.",
      hits: [],
      snapshot: noisySnapshot
    });

    expect(linked[0]?.screenCode).toBe("MDP-MYINT022231M");
  });

  it("prefers direct frontend->api->backend chains for cross-layer questions", () => {
    const linked = buildLinkedFlowEvidence({
      question: "분할만기보험금 화면에서 어떤 API를 타고 backend service 까지 가는지 알려줘",
      hits: [
        {
          path: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/give/controller/DivisionExpController.java",
          score: 0.71,
          source: "qmd",
          reasons: ["controller"]
        }
      ],
      snapshot
    });

    expect(linked[0]?.screenCode).toBe("MDP-MYINT022231M");
    expect(linked[0]?.apiUrl).toBe("/gw/api/insurance/division/appexpiry/inqury");
    expect(linked[0]?.backendControllerMethod).toBe("DivisionExpController.inqury");
    expect(linked[0]?.reasons).toEqual(
      expect.arrayContaining(["cross-layer-question", "screen-code-match", "backend-hit-match"])
    );
  });

  it("prefers benefit-claim chains over adjacent insurance flows for generic claim questions", () => {
    const claimSnapshot = {
      ...snapshot,
      frontend: {
        ...snapshot.frontend,
        routeCount: 2,
        screenCount: 2,
        apiCount: 2,
        routes: [
          ...snapshot.frontend.routes,
          {
            routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M",
            screenPath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M.vue",
            sourceFile: "src/router/mo/mysamsunglife/insurance/internet/route.js",
            screenCode: "MDP-MYINT020210M",
            notes: ["보험금청구 - 본인 보험금 청구 - 청구서 작성"],
            capabilityTags: ["benefit-claim", "insurance-internet"]
          }
        ],
        screens: [
          ...snapshot.frontend.screens,
          {
            filePath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M.vue",
            screenCode: "MDP-MYINT020210M",
            componentName: "MDP-MYINT020210M",
            routePaths: ["/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M"],
            exportPaths: ["/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M"],
            apiPaths: ["/insurance/benefit/claim/insert"],
            httpCalls: [
              {
                method: "POST",
                rawUrl: "/gw/api/insurance/benefit/claim/insert",
                normalizedUrl: "/insurance/benefit/claim/insert",
                functionName: "submitBenefitClaim",
                source: "http-call"
              }
            ],
            labels: ["보험금 청구"],
            capabilityTags: ["benefit-claim", "claim-submit", "insurance-internet"]
          }
        ]
      },
      backend: {
        ...snapshot.backend,
        routeCount: 3,
        routes: [
          ...snapshot.backend.routes,
          {
            path: "/insurance/benefit/claim/insert",
            controllerClass: "BenefitClaimController",
            controllerMethod: "insertBenefitClaim",
            filePath: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/controller/BenefitClaimController.java",
            serviceHints: ["BenefitClaimService.saveBenefitClaim"],
            labels: ["보험금 청구 Controller"],
            capabilityTags: ["benefit-claim", "claim-submit", "insurance-internet"]
          }
        ]
      },
      links: [
        ...snapshot.links,
        {
          confidence: 0.91,
          capabilityTags: ["benefit-claim", "claim-submit", "insurance-internet", "gateway-api"],
          frontend: {
            screenCode: "MDP-MYINT020210M",
            screenPath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M.vue",
            routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M"
          },
          api: {
            method: "POST",
            rawUrl: "/gw/api/insurance/benefit/claim/insert",
            normalizedUrl: "/insurance/benefit/claim/insert",
            functionName: "submitBenefitClaim",
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
          evidence: ["frontend-route", "frontend-http-call", "backend-request-mapping", "gateway-api-proxy", "backend-service-call"]
        }
      ]
    } satisfies FrontBackGraphSnapshot;

    const linked = buildLinkedFlowEvidence({
      question: "보험금 청구 로직이 frontend부터 backend까지 어떤 흐름으로 진행되는지 면밀히 분석해줘.",
      hits: [],
      snapshot: claimSnapshot
    });

    expect(linked[0]?.screenCode).toBe("MDP-MYINT020210M");
    expect(linked[0]?.backendControllerMethod).toBe("BenefitClaimController.insertBenefitClaim");
    expect(linked[0]?.apiUrl).toBe("/gw/api/insurance/benefit/claim/insert");
    expect(linked[0]?.capabilityTags).toEqual(expect.arrayContaining(["benefit-claim", "claim-submit"]));
    expect(linked[0]?.reasons).toEqual(expect.arrayContaining(["capability:benefit-claim", "benefit-claim-api-match"]));
  });

  it("builds a multi-phase claim answer when insert/check/doc flows and downstream traces are available", () => {
    const linked = [
      {
        screenCode: "MDP-MYINT020220M",
        routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020220M",
        screenPath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020220M.vue",
        apiUrl: "/gw/api/insurance/accBenefit/claim/check",
        gatewayPath: "/api/**",
        gatewayControllerMethod: "RouteController.route",
        backendPath: "/insurance/accBenefit/claim/check",
        backendControllerMethod: "AccBenefitClaimController.benefitClaimCheck",
        serviceHints: ["AccBenefitClaimService.checkApply"],
        capabilityTags: ["benefit-claim", "claim-inquiry"],
        confidence: 0.99,
        reasons: ["benefit-claim-api-match"]
      },
      {
        screenCode: "MDP-MYINT020220M",
        routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020220M",
        screenPath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020220M.vue",
        apiUrl: "/gw/api/insurance/accBenefit/claim/insert",
        gatewayPath: "/api/**",
        gatewayControllerMethod: "RouteController.route",
        backendPath: "/insurance/accBenefit/claim/insert",
        backendControllerMethod: "AccBenefitClaimController.insertBenefitClaim",
        serviceHints: ["AccBenefitClaimService.chkAccnNo", "AccBenefitClaimService.saveBenefitClaim"],
        capabilityTags: ["benefit-claim", "claim-submit"],
        confidence: 0.99,
        reasons: ["benefit-claim-api-match"]
      },
      {
        screenCode: "MDP-MYINT020220M",
        routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020220M",
        screenPath: "src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020220M.vue",
        apiUrl: "/gw/api/insurance/accBenefit/claim/doc/insert",
        gatewayPath: "/api/**",
        gatewayControllerMethod: "RouteController.route",
        backendPath: "/insurance/accBenefit/claim/doc/insert",
        backendControllerMethod: "AccBenefitClaimController.insertBenefitClaimDoc",
        serviceHints: ["AccBenefitClaimService.saveBenefitClaimDoc"],
        capabilityTags: ["benefit-claim", "claim-doc"],
        confidence: 0.99,
        reasons: ["benefit-claim-doc-submit-match"]
      }
    ];

    const output = buildDeterministicFlowAnswer({
      question: "보험금 청구 로직이 frontend부터 backend까지 어떤 흐름으로 진행되는지 면밀히 분석해줘.",
      linkedFlowEvidence: linked,
      downstreamTraces: [
        {
          phase: "claim-insert",
          apiUrl: "/gw/api/insurance/accBenefit/claim/insert",
          backendControllerMethod: "AccBenefitClaimController.insertBenefitClaim",
          serviceMethod: "AccBenefitClaimService.saveBenefitClaim",
          filePath: "dcp-insurance/.../AccBenefitClaimService.java",
          steps: ["getRedisInfo: Redis 세션/청구 진행상태 조회", "saveClamDocument: 청구 기본정보 DB insert/update"],
          evidence: [],
          eaiInterfaces: []
        },
        {
          phase: "doc-insert",
          apiUrl: "/gw/api/insurance/accBenefit/claim/doc/insert",
          backendControllerMethod: "AccBenefitClaimController.insertBenefitClaimDoc",
          serviceMethod: "AccBenefitClaimService.saveBenefitClaimDoc",
          filePath: "dcp-insurance/.../AccBenefitClaimService.java",
          steps: [
            "selectClamDocument: 기존 청구문서/최근 제출 이력 조회",
            "callMODC0008 -> F13630020: 동의서/청구서 문서변환 호출",
            "callF1FCZ0045: 청구 관련 EAI 전문 호출",
            "saveClamDocumentFile: 첨부파일 이력 DB 저장"
          ],
          evidence: [],
          eaiInterfaces: ["F13630020", "F1FCZ0045"]
        }
      ]
    });

    expect(output.answer).toContain("/gw/api/insurance/accBenefit/claim/check");
    expect(output.answer).toContain("/gw/api/insurance/accBenefit/claim/insert");
    expect(output.answer).toContain("/gw/api/insurance/accBenefit/claim/doc/insert");
    expect(output.answer).toContain("F13630020");
    expect(output.answer).toContain("F1FCZ0045");
    expect(output.caveats).toContain("downstream-static-trace");
  });

});
