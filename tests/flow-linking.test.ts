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
});
