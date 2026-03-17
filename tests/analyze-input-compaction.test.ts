import { describe, expect, it } from "vitest";
import type { EaiDictionaryEntry } from "../src/server/eai-dictionary.js";
import type { FrontBackGraphSnapshot } from "../src/server/front-back-graph.js";
import { compactAnalyzeKnowledgeInputs, resolveAnalyzeInputCompactionLimits } from "../src/server/analyze-input-compaction.js";

const frontBackGraph: FrontBackGraphSnapshot = {
  version: 1,
  generatedAt: "2026-03-17T00:00:00.000Z",
  meta: {
    backendWorkspaceDir: "/workspace/backend",
    frontendWorkspaceDirs: ["/workspace/frontend"],
    asOfDate: "2026-03-17"
  },
  frontend: {
    routeCount: 3,
    screenCount: 3,
    apiCount: 3,
    routes: [
      {
        routePath: "/claim/apply",
        screenPath: "src/views/claim/Apply.vue",
        sourceFile: "src/router/claim/route.js",
        screenCode: "CLM-APPLY"
      },
      {
        routePath: "/claim/status",
        screenPath: "src/views/claim/Status.vue",
        sourceFile: "src/router/claim/route.js",
        screenCode: "CLM-STATUS"
      },
      {
        routePath: "/loan/apply",
        screenPath: "src/views/loan/Apply.vue",
        sourceFile: "src/router/loan/route.js",
        screenCode: "LOAN-APPLY"
      }
    ],
    screens: [
      {
        filePath: "src/views/claim/Apply.vue",
        screenCode: "CLM-APPLY",
        componentName: "ClaimApply",
        routePaths: ["/claim/apply"],
        exportPaths: [],
        apiPaths: ["/insurance/claim/submit"],
        httpCalls: [
          {
            rawUrl: "/gw/api/insurance/claim/submit",
            normalizedUrl: "/insurance/claim/submit",
            functionName: "submitClaim",
            method: "POST",
            source: "http-call"
          }
        ],
        labels: ["보험금 청구"]
      },
      {
        filePath: "src/views/claim/Status.vue",
        screenCode: "CLM-STATUS",
        componentName: "ClaimStatus",
        routePaths: ["/claim/status"],
        exportPaths: [],
        apiPaths: ["/insurance/claim/status"],
        httpCalls: [
          {
            rawUrl: "/gw/api/insurance/claim/status",
            normalizedUrl: "/insurance/claim/status",
            functionName: "loadStatus",
            method: "GET",
            source: "http-call"
          }
        ],
        labels: ["청구 현황"]
      },
      {
        filePath: "src/views/loan/Apply.vue",
        screenCode: "LOAN-APPLY",
        componentName: "LoanApply",
        routePaths: ["/loan/apply"],
        exportPaths: [],
        apiPaths: ["/loan/apply"],
        httpCalls: [
          {
            rawUrl: "/gw/api/loan/apply",
            normalizedUrl: "/loan/apply",
            functionName: "submitLoan",
            method: "POST",
            source: "http-call"
          }
        ],
        labels: ["대출 신청"]
      }
    ]
  },
  backend: {
    routeCount: 4,
    gatewayRoutes: [
      {
        path: "/api/**",
        controllerClass: "RouteController",
        controllerMethod: "route",
        filePath: "dcp-gateway/src/main/java/com/example/RouteController.java",
        serviceHints: []
      }
    ],
    routes: [
      {
        path: "/insurance/claim/submit",
        controllerClass: "ClaimController",
        controllerMethod: "submit",
        filePath: "dcp-insurance/src/main/java/com/example/ClaimController.java",
        serviceHints: ["AccBenefitClaimService.submitClaim"]
      },
      {
        path: "/insurance/claim/status",
        controllerClass: "ClaimStatusController",
        controllerMethod: "status",
        filePath: "dcp-insurance/src/main/java/com/example/ClaimStatusController.java",
        serviceHints: ["AccBenefitClaimService.loadStatus"]
      },
      {
        path: "/loan/apply",
        controllerClass: "LoanController",
        controllerMethod: "apply",
        filePath: "dcp-loan/src/main/java/com/example/LoanController.java",
        serviceHints: ["LoanService.apply"]
      }
    ]
  },
  links: [
    {
      confidence: 0.95,
      frontend: {
        screenCode: "CLM-APPLY",
        screenPath: "src/views/claim/Apply.vue",
        routePath: "/claim/apply"
      },
      api: {
        rawUrl: "/gw/api/insurance/claim/submit",
        normalizedUrl: "/insurance/claim/submit",
        functionName: "submitClaim",
        method: "POST",
        source: "http-call"
      },
      gateway: {
        path: "/api/**",
        controllerMethod: "RouteController.route"
      },
      backend: {
        path: "/insurance/claim/submit",
        controllerMethod: "ClaimController.submit",
        filePath: "dcp-insurance/src/main/java/com/example/ClaimController.java",
        serviceHints: ["AccBenefitClaimService.submitClaim"]
      },
      evidence: ["frontend-route", "frontend-http-call", "gateway-api-proxy", "backend-service-call"]
    },
    {
      confidence: 0.62,
      frontend: {
        screenCode: "CLM-STATUS",
        screenPath: "src/views/claim/Status.vue",
        routePath: "/claim/status"
      },
      api: {
        rawUrl: "/gw/api/insurance/claim/status",
        normalizedUrl: "/insurance/claim/status",
        functionName: "loadStatus",
        method: "GET",
        source: "http-call"
      },
      gateway: {
        path: "/api/**",
        controllerMethod: "RouteController.route"
      },
      backend: {
        path: "/insurance/claim/status",
        controllerMethod: "ClaimStatusController.status",
        filePath: "dcp-insurance/src/main/java/com/example/ClaimStatusController.java",
        serviceHints: ["AccBenefitClaimService.loadStatus"]
      },
      evidence: ["frontend-route", "frontend-http-call"]
    },
    {
      confidence: 0.4,
      frontend: {
        screenCode: "LOAN-APPLY",
        screenPath: "src/views/loan/Apply.vue",
        routePath: "/loan/apply"
      },
      api: {
        rawUrl: "/gw/api/loan/apply",
        normalizedUrl: "/loan/apply",
        functionName: "submitLoan",
        method: "POST",
        source: "http-call"
      },
      gateway: {},
      backend: {
        path: "/loan/apply",
        controllerMethod: "LoanController.apply",
        filePath: "dcp-loan/src/main/java/com/example/LoanController.java",
        serviceHints: ["LoanService.apply"]
      },
      evidence: ["frontend-http-call"]
    }
  ],
  diagnostics: {
    parseFailures: [],
    unmatchedFrontendApis: [],
    unmatchedFrontendScreens: []
  }
};

const structureEntries = {
  "dcp-insurance/src/main/java/com/example/ClaimController.java": {
    path: "dcp-insurance/src/main/java/com/example/ClaimController.java",
    summary: "claim controller",
    classes: [{ name: "ClaimController", line: 1 }],
    methods: [{ name: "submit", className: "ClaimController", line: 10 }],
    functions: [],
    calls: [],
    resources: {}
  },
  "dcp-insurance/src/main/java/com/example/AccBenefitClaimService.java": {
    path: "dcp-insurance/src/main/java/com/example/AccBenefitClaimService.java",
    summary: "claim service with redis and database access",
    classes: [{ name: "AccBenefitClaimService", line: 1 }],
    methods: [{ name: "submitClaim", className: "AccBenefitClaimService", line: 12 }],
    functions: [],
    calls: [],
    resources: {
      storeKinds: ["redis", "database"],
      redisKeys: ["claim.session"],
      dbTableNames: ["TB_CLAIM"],
      dbModelNames: ["ClaimEntity"],
      dbQueryNames: ["findClaim"]
    }
  },
  "dcp-loan/src/main/java/com/example/LoanController.java": {
    path: "dcp-loan/src/main/java/com/example/LoanController.java",
    summary: "loan controller",
    classes: [{ name: "LoanController", line: 1 }],
    methods: [{ name: "apply", className: "LoanController", line: 10 }],
    functions: [],
    calls: [],
    resources: {}
  }
};

const eaiEntries: EaiDictionaryEntry[] = [
  {
    interfaceId: "F13630020",
    interfaceName: "보험금 청구 생성",
    purpose: "benefit claim generation",
    sourcePath: "resources/eai/io/F13630020.xml",
    envPaths: [],
    usagePaths: ["dcp-insurance/src/main/java/com/example/AccBenefitClaimService.java"],
    moduleUsagePaths: ["dcp-insurance/src/main/java/com/example/AccBenefitClaimService.java"],
    reqSystemIds: ["INS"],
    javaCallSites: [
      {
        path: "dcp-insurance/src/main/java/com/example/AccBenefitClaimService.java",
        className: "AccBenefitClaimService",
        methodName: "submitClaim",
        direct: true
      }
    ]
  },
  {
    interfaceId: "F99999999",
    interfaceName: "대출 처리",
    purpose: "loan processing",
    sourcePath: "resources/eai/io/F99999999.xml",
    envPaths: [],
    usagePaths: ["dcp-loan/src/main/java/com/example/LoanController.java"],
    moduleUsagePaths: ["dcp-loan/src/main/java/com/example/LoanController.java"],
    reqSystemIds: ["LOAN"],
    javaCallSites: [
      {
        path: "dcp-loan/src/main/java/com/example/LoanController.java",
        className: "LoanController",
        methodName: "apply",
        direct: true
      }
    ]
  }
];

describe("analyze input compaction", () => {
  it("enables compact mode for large analyze inputs", () => {
    const limits = resolveAnalyzeInputCompactionLimits({
      structureEntryCount: 7000,
      frontBackScreenCount: 3500,
      frontBackLinkCount: 3800,
      eaiEntryCount: 1400
    });

    expect(limits).toBeDefined();
    expect(limits?.maxFrontBackLinks).toBeGreaterThan(0);
  });

  it("compacts large analyze inputs while preserving high-signal flow and storage evidence", () => {
    const compacted = compactAnalyzeKnowledgeInputs({
      structureEntries,
      frontBackGraph,
      eaiEntries,
      limits: {
        maxStructureEntries: 2,
        maxFrontendScreens: 1,
        maxFrontendRoutes: 1,
        maxFrontBackLinks: 1,
        maxEaiEntries: 1,
        maxEaiUsagePathsPerEntry: 1,
        maxEaiCallSitesPerEntry: 1,
        maxLearnedKnowledgeCandidates: 10
      }
    });

    expect(compacted.summary.compactMode).toBe(true);
    expect(compacted.frontBackGraph.links).toHaveLength(1);
    expect(compacted.frontBackGraph.links[0]?.backend.controllerMethod).toBe("ClaimController.submit");
    expect(compacted.frontBackGraph.frontend.screens).toHaveLength(1);
    expect(compacted.frontBackGraph.frontend.screens[0]?.screenCode).toBe("CLM-APPLY");
    expect(Object.keys(compacted.structureEntries)).toContain(
      "dcp-insurance/src/main/java/com/example/AccBenefitClaimService.java"
    );
    expect(compacted.eaiEntries).toHaveLength(1);
    expect(compacted.eaiEntries[0]?.interfaceId).toBe("F13630020");
  });
});
