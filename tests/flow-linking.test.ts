import { describe, expect, it } from "vitest";
import { buildDeterministicFlowAnswer, buildLinkedFlowEvidence, type FrontBackGraphSnapshot } from "../src/server/flow-links.js";
import type { DomainPack } from "../src/server/domain-packs.js";

const pensionDomainPack: DomainPack = {
  id: "retire-pension",
  name: "퇴직/연금",
  description: "퇴직연금 capability pack",
  families: ["retire", "pension"],
  enabledByDefault: true,
  capabilityTags: [
    {
      tag: "retire-pension",
      kind: "domain",
      aliases: ["퇴직연금", "IRP"],
      questionPatterns: ["퇴직연금", "IRP"],
      textPatterns: ["Pension", "IRP"],
      searchTerms: ["Pension", "IRP"],
      pathHints: ["dcp-pension/"],
      symbolHints: ["Pension"],
      apiHints: ["/pension/"]
    },
    {
      tag: "irp-join",
      kind: "subdomain",
      aliases: ["IRP가입", "IRP 가입"],
      questionPatterns: ["IRP\\s*가입"],
      textPatterns: ["IrpJoin", "/join/irpjoin", "/join/assetcontract", "registirpsubscription"],
      searchTerms: ["IrpJoinController", "IrpJoinService", "AssetContractController", "AssetContractService"],
      pathHints: ["dcp-pension/src/main/java/com/samsunglife/dcp/pension/join/"],
      symbolHints: ["IrpJoinController", "IrpJoinService", "AssetContractController", "AssetContractService"],
      apiHints: ["/join/irpjoin/", "/join/assetcontract/"],
      parents: ["retire-pension"],
      adjacentConfusers: ["retire-pension-content"]
    },
    {
      tag: "retire-pension-content",
      kind: "subdomain",
      aliases: ["연금 컨텐츠"],
      questionPatterns: ["컨텐츠"],
      textPatterns: ["DisplayBoardContent", "/display/board/content/", "PRREA"],
      searchTerms: ["DisplayBoardContentController"],
      pathHints: ["dcp-core/src/main/java/com/samsunglife/dcp/core/display/contents/board/"],
      symbolHints: ["DisplayBoardContentController"],
      apiHints: ["/display/board/content/"],
      parents: ["retire-pension"],
      adjacentConfusers: ["irp-join"]
    }
  ],
  rankingPriors: [
    {
      whenQuestionHas: ["irp-join"],
      whenLinkHas: ["irp-join"],
      whenApiMatches: ["/join/irpjoin/", "/join/assetcontract/"],
      weight: 110,
      reason: "subdomain:irp-join"
    },
    {
      whenQuestionHas: ["irp-join"],
      whenLinkHas: ["retire-pension-content"],
      whenApiMatches: ["/display/board/content/"],
      weight: -180,
      reason: "penalty:retire-pension-content",
      negative: true
    }
  ],
  exemplars: [],
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
  builtIn: false
};

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
    expect(output.confidence).toBeGreaterThanOrEqual(0.55);
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

  it("recomputes capability tags from text and ignores stale snapshot tags from another domain", () => {
    const loanSnapshot = {
      ...snapshot,
      links: [
        {
          confidence: 0.99,
          capabilityTags: ["benefit-claim", "claim-inquiry", "gateway-api"],
          frontend: {
            screenCode: "MDP-MYLOT021301C",
            screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021301C.vue",
            routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021301C"
          },
          api: {
            method: "POST",
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
            controllerMethod: "CreditLowWorkerLoanReauestController.checkTimeService",
            filePath: "dcp-loan/src/main/java/com/samsunglife/dcp/loan/request/controller/CreditLowWorkerLoanReauestController.java",
            serviceHints: ["CreditLowWorkerLoanReauestService.validateAccessTime"]
          },
          evidence: ["frontend-http-call", "backend-request-mapping", "gateway-api-proxy", "backend-service-call"]
        }
      ]
    } satisfies FrontBackGraphSnapshot;

    const linked = buildLinkedFlowEvidence({
      question: "햇살론 대출 로직이 frontend부터 backend까지 어떤 흐름인지 분석해줘.",
      hits: [],
      snapshot: loanSnapshot
    });

    expect(linked[0]?.capabilityTags).toEqual(expect.arrayContaining(["loan", "sunshine-loan", "credit-low-worker-loan"]));
    expect(linked[0]?.capabilityTags).not.toContain("benefit-claim");
    expect(linked[0]?.capabilityTags).not.toContain("claim-inquiry");
  });

  it("builds sunshine-loan deterministic phases without falling back to contract-loan inquiry flows", () => {
    const sunshineSnapshot = {
      ...snapshot,
      frontend: {
        ...snapshot.frontend,
        routeCount: 4,
        screenCount: 4,
        apiCount: 4,
        routes: [],
        screens: []
      },
      backend: {
        ...snapshot.backend,
        routeCount: 4,
        routes: []
      },
      links: [
        {
          confidence: 0.96,
          frontend: {
            screenCode: "MDP-MYLOT021301C",
            screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021301C.vue",
            routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021301C"
          },
          api: {
            method: "POST",
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
            controllerMethod: "CreditLowWorkerLoanReauestController.checkTimeService",
            filePath: "dcp-loan/src/main/java/com/samsunglife/dcp/loan/request/controller/CreditLowWorkerLoanReauestController.java",
            serviceHints: ["CreditLowWorkerLoanReauestService.validateAccessTime"]
          },
          evidence: ["frontend-http-call", "backend-request-mapping", "gateway-api-proxy", "backend-service-call"]
        },
        {
          confidence: 0.94,
          frontend: {
            screenCode: "MDP-MYLOT021320M",
            screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021320M.vue",
            routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021320M"
          },
          api: {
            method: "POST",
            rawUrl: "/gw/api/loan/credit/low/worker/request/requestLoanMember",
            normalizedUrl: "/loan/credit/low/worker/request/requestLoanMember",
            functionName: "requestLoanMember",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/loan/credit/low/worker/request/requestLoanMember",
            controllerMethod: "CreditLowWorkerLoanReauestController.registLoanMember",
            filePath: "dcp-loan/src/main/java/com/samsunglife/dcp/loan/request/controller/CreditLowWorkerLoanReauestController.java",
            serviceHints: ["CreditLowWorkerLoanReauestService.registLoanMember"]
          },
          evidence: ["frontend-http-call", "backend-request-mapping", "gateway-api-proxy", "backend-service-call"]
        },
        {
          confidence: 0.93,
          frontend: {
            screenCode: "MDP-MYLOT021370M",
            screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021370M.vue",
            routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021370M"
          },
          api: {
            method: "POST",
            rawUrl: "/gw/api/loan/credit/low/worker/request/make/owner/agreement",
            normalizedUrl: "/loan/credit/low/worker/request/make/owner/agreement",
            functionName: "makeOwnerAgreement",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/loan/credit/low/worker/request/make/owner/agreement",
            controllerMethod: "CreditLowWorkerLoanReauestController.makeOwnerAgreement",
            filePath: "dcp-loan/src/main/java/com/samsunglife/dcp/loan/request/controller/CreditLowWorkerLoanReauestController.java",
            serviceHints: [
              "CreditLowWorkerLoanReauestService.validateAccessTime",
              "CreditLowWorkerLoanPdfReauestService.makeDocListBeforeApply"
            ]
          },
          evidence: ["frontend-http-call", "backend-request-mapping", "gateway-api-proxy", "backend-service-call"]
        },
        {
          confidence: 0.99,
          frontend: {
            screenCode: "MDP-MYLOT010100M",
            screenPath: "src/views/mo/mysamsunglife/loan/contract/MDP-MYLOT010100M.vue",
            routePath: "/mo/mysamsunglife/loan/contract/MDP-MYLOT010100M"
          },
          api: {
            method: "POST",
            rawUrl: "/gw/api/loan/contract/inqury/list",
            normalizedUrl: "/loan/contract/inqury/list",
            functionName: "loadContractLoanList",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/loan/contract/inqury/list",
            controllerMethod: "ContractLoanInquryController.pllnList",
            filePath: "dcp-loan/src/main/java/com/samsunglife/dcp/loan/contract/controller/ContractLoanInquryController.java",
            serviceHints: ["ContractLoanInquryService.callF1CLT0093"]
          },
          evidence: ["frontend-http-call", "backend-request-mapping", "gateway-api-proxy", "backend-service-call"]
        }
      ]
    } satisfies FrontBackGraphSnapshot;

    const linked = buildLinkedFlowEvidence({
      question: "햇살론 대출 로직이 frontend부터 backend까지 어떻게 구성되는지 면밀히 분석해줘.",
      hits: [],
      snapshot: sunshineSnapshot
    });

    const output = buildDeterministicFlowAnswer({
      question: "햇살론 대출 로직이 frontend부터 backend까지 어떻게 구성되는지 면밀히 분석해줘.",
      linkedFlowEvidence: linked
    });

    expect(linked[0]?.backendControllerMethod).toBe("CreditLowWorkerLoanReauestController.checkTimeService");
    expect(output.answer).toContain("/gw/api/loan/credit/low/worker/request/checktime");
    expect(output.answer).toContain("CreditLowWorkerLoanReauestController.registLoanMember");
    expect(output.answer).toContain("CreditLowWorkerLoanReauestController.makeOwnerAgreement");
    expect(output.answer).not.toContain("/gw/api/loan/contract/inqury/list");
    expect(output.answer).not.toContain("ContractLoanInquryController.pllnList");
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
    expect(linked[0]?.capabilityTags).toEqual(expect.arrayContaining(["benefit-claim", "action-submit"]));
    expect(linked[0]?.reasons).toEqual(
      expect.arrayContaining(["capability:benefit-claim", "capability:claim-submit"])
    );
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

  it("builds an action-oriented answer for sunshine-loan flows without claim-specific leakage", () => {
    const linked = [
      {
        screenCode: "MDP-MYLOT021301C",
        routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021301M",
        screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021301C.vue",
        apiUrl: "/gw/api/loan/credit/low/worker/request/checktime",
        gatewayPath: "/api/**",
        gatewayControllerMethod: "RouteController.route",
        backendPath: "/loan/credit/low/worker/request/checktime",
        backendControllerMethod: "CreditLowWorkerLoanReauestController.checkTimeService",
        serviceHints: ["CreditLowWorkerLoanReauestService.validateAccessTime"],
        capabilityTags: ["loan", "sunshine-loan", "action-check"],
        confidence: 0.99,
        reasons: ["capability:sunshine-loan"]
      },
      {
        screenCode: "MDP-MYLOT021370M",
        routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021370M",
        screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021370M.vue",
        apiUrl: "/gw/api/loan/credit/low/worker/request/apply",
        gatewayPath: "/api/**",
        gatewayControllerMethod: "RouteController.route",
        backendPath: "/loan/credit/low/worker/request/apply",
        backendControllerMethod: "CreditLowWorkerLoanReauestController.apply",
        serviceHints: ["CreditLowWorkerLoanReauestService.callF1CLN0015"],
        capabilityTags: ["loan", "sunshine-loan", "action-submit"],
        confidence: 0.99,
        reasons: ["capability:sunshine-loan"]
      },
      {
        screenCode: "MDP-MYLOT021370M",
        routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021370M",
        screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021370M.vue",
        apiUrl: "/gw/api/loan/credit/low/worker/request/make/owner/agreement",
        gatewayPath: "/api/**",
        gatewayControllerMethod: "RouteController.route",
        backendPath: "/loan/credit/low/worker/request/make/owner/agreement",
        backendControllerMethod: "CreditLowWorkerLoanReauestController.makeOwnerAgreement",
        serviceHints: ["CreditLowWorkerLoanPdfReauestService.makeDocListBeforeApply"],
        capabilityTags: ["loan", "sunshine-loan", "action-doc", "action-agreement"],
        confidence: 0.99,
        reasons: ["capability:sunshine-loan"]
      }
    ];

    const output = buildDeterministicFlowAnswer({
      question: "햇살론 대출 로직이 frontend부터 backend까지 어떤 흐름으로 진행되는지 면밀히 분석해줘.",
      linkedFlowEvidence: linked
    });

    expect(output.answer).toContain("/gw/api/loan/credit/low/worker/request/checktime");
    expect(output.answer).toContain("/gw/api/loan/credit/low/worker/request/apply");
    expect(output.answer).toContain("/gw/api/loan/credit/low/worker/request/make/owner/agreement");
    expect(output.answer).not.toContain("보험금");
  });

  it("ranks irp-join flows ahead of adjacent retire-pension content flows and lowers confidence on mismatched deterministic answers", () => {
    const pensionSnapshot: FrontBackGraphSnapshot = {
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
          confidence: 0.97,
          frontend: {
            screenCode: "MDP-PRREA000070M",
            screenPath: "src/views/mo/products/pension/main/MDP-PRREA000070M.vue",
            routePath: "/mo/products/pension/main/MDP-PRREA000070M"
          },
          api: {
            rawUrl: "/gw/api/display/board/content/class",
            normalizedUrl: "/display/board/content/class",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/display/board/content/class",
            controllerMethod: "DisplayBoardContentController.selectClassList",
            filePath: "dcp-core/src/main/java/com/samsunglife/dcp/core/display/contents/board/DisplayBoardContentController.java",
            serviceHints: ["DisplayContentBoardService.selectClassList"]
          },
          evidence: ["frontend-http-call", "gateway-api-proxy"]
        },
        {
          confidence: 0.79,
          frontend: {
            screenCode: "PDP-MYRET020210M",
            screenPath: "src/views/pc/individual/mysamsunglife/pension/contractinformation/PDP-MYRET020210M.vue",
            routePath: "/pc/individual/mysamsunglife/pension/contractinformation/PDP-MYRET020210M"
          },
          api: {
            rawUrl: "/gw/api/pension/join/irpjoin/joinpurpose/checkservicetime",
            normalizedUrl: "/pension/join/irpjoin/joinpurpose/checkservicetime",
            source: "http-call"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/join/irpjoin/joinpurpose/checkservicetime",
            controllerMethod: "IrpJoinController.checkServiceTime",
            filePath: "dcp-pension/src/main/java/com/samsunglife/dcp/pension/join/controller/IrpJoinController.java",
            serviceHints: ["IrpJoinService.checkServiceTime"]
          },
          evidence: ["frontend-http-call", "gateway-api-proxy", "backend-request-mapping"]
        }
      ],
      diagnostics: {
        parseFailures: [],
        unmatchedFrontendApis: [],
        unmatchedFrontendScreens: []
      }
    };

    const linked = buildLinkedFlowEvidence({
      question: "IRP가입 로직이 프론트부터 백엔드까지 어떻게 구성되는지 면밀히 분석해줘.",
      snapshot: pensionSnapshot,
      domainPacks: [pensionDomainPack]
    });

    expect(linked[0]?.backendControllerMethod).toBe("IrpJoinController.checkServiceTime");
    expect(linked[0]?.capabilityTags).toEqual(expect.arrayContaining(["retire-pension", "irp-join"]));

    const mismatchedOutput = buildDeterministicFlowAnswer({
      question: "IRP가입 로직이 프론트부터 백엔드까지 어떻게 구성되는지 면밀히 분석해줘.",
      questionTags: ["retire-pension", "irp-join"],
      linkedFlowEvidence: [
        {
          screenCode: "MDP-PRREA000070M",
          routePath: "/mo/products/pension/main/MDP-PRREA000070M",
          screenPath: "src/views/mo/products/pension/main/MDP-PRREA000070M.vue",
          apiUrl: "/gw/api/display/board/content/class",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/display/board/content/class",
          backendControllerMethod: "DisplayBoardContentController.selectClassList",
          serviceHints: ["DisplayContentBoardService.selectClassList"],
          capabilityTags: ["retire-pension", "retire-pension-content"],
          confidence: 0.97,
          reasons: ["capability-penalty:retire-pension-content"]
        }
      ],
      domainPacks: [pensionDomainPack]
    });

    expect(mismatchedOutput.confidence).toBeLessThan(0.65);
    expect(mismatchedOutput.caveats).toContain("specific-capability-mismatch");
  });

});
