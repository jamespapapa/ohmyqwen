import { describe, expect, it } from "vitest";
import type { DomainPack } from "../src/server/domain-packs.js";
import { computeDomainMaturity } from "../src/server/domain-maturity.js";
import type { FrontBackGraphSnapshot } from "../src/server/front-back-graph.js";
import type { EaiDictionaryEntry } from "../src/server/eai-dictionary.js";

const benefitClaimPack: DomainPack = {
  id: "benefit-claim",
  name: "보험금 청구",
  description: "보험금 청구 domain",
  families: ["insurance"],
  enabledByDefault: true,
  capabilityTags: [
    {
      tag: "benefit-claim",
      kind: "domain",
      aliases: ["보험금 청구"],
      questionPatterns: ["보험금\\s*청구"],
      textPatterns: ["BenefitClaim", "claim/insert"],
      searchTerms: ["BenefitClaimController", "BenefitClaimService"],
      pathHints: ["dcp-insurance/"],
      symbolHints: ["BenefitClaimController", "BenefitClaimService"],
      apiHints: ["/insurance/benefit/claim"]
    },
    {
      tag: "claim-doc",
      kind: "subdomain",
      aliases: ["청구 서류"],
      questionPatterns: ["서류"],
      textPatterns: ["saveBenefitClaimDoc", "doc/insert", "F13630020"],
      searchTerms: ["saveBenefitClaimDoc", "F13630020"],
      parents: ["benefit-claim"]
    }
  ],
  rankingPriors: [],
  exemplars: [
    {
      question: "보험금 청구 로직이 frontend부터 backend까지 어떤 흐름으로 진행되는지 면밀히 분석해줘.",
      expectedTags: ["benefit-claim"],
      expectedApiPatterns: ["claim/insert"],
      expectedControllerPatterns: ["BenefitClaimController"]
    }
  ],
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
  builtIn: false
};

const snapshot: FrontBackGraphSnapshot = {
  version: 1,
  generatedAt: "2026-03-10T00:00:00.000Z",
  meta: {
    backendWorkspaceDir: "/work/backend",
    frontendWorkspaceDirs: ["/work/frontend"],
    asOfDate: "2026-03-10"
  },
  frontend: {
    routeCount: 1,
    screenCount: 1,
    apiCount: 2,
    routes: [],
    screens: [
      {
        filePath: "src/views/claim.vue",
        screenCode: "MDP-MYINT020220M",
        routePaths: ["/mo/insurance/claim"],
        exportPaths: [],
        apiPaths: ["/insurance/benefit/claim/insert", "/insurance/benefit/claim/doc/insert"],
        httpCalls: [],
        labels: ["보험금 청구"],
        capabilityTags: ["benefit-claim", "claim-doc"]
      }
    ]
  },
  backend: {
    routeCount: 1,
    gatewayRoutes: [],
    routes: [
      {
        path: "/insurance/benefit/claim/insert",
        controllerClass: "BenefitClaimController",
        controllerMethod: "insertBenefitClaim",
        filePath: "dcp-insurance/src/main/java/com/acme/BenefitClaimController.java",
        serviceHints: ["BenefitClaimService.saveBenefitClaim"],
        labels: ["보험금 청구"],
        capabilityTags: ["benefit-claim"]
      }
    ]
  },
  links: [
    {
      confidence: 0.94,
      capabilityTags: ["benefit-claim", "claim-doc"],
      frontend: {
        screenCode: "MDP-MYINT020220M",
        screenPath: "src/views/claim.vue",
        routePath: "/mo/insurance/claim"
      },
      api: {
        rawUrl: "/gw/api/insurance/benefit/claim/insert",
        normalizedUrl: "/insurance/benefit/claim/insert",
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
        serviceHints: ["BenefitClaimService.saveBenefitClaim", "BenefitClaimService.saveBenefitClaimDoc"]
      },
      evidence: ["frontend-route", "frontend-http-call", "backend-request-mapping"]
    }
  ],
  diagnostics: {
    parseFailures: [],
    unmatchedFrontendApis: [],
    unmatchedFrontendScreens: []
  }
};

const eaiEntries: EaiDictionaryEntry[] = [
  {
    interfaceId: "F13630020",
    interfaceName: "문서변환 동의서/청구서 호출",
    purpose: "보험금 청구 문서 생성",
    sourcePath: "resources/eai/io/sli/ea2/F13630020_service.xml",
    envPaths: [],
    usagePaths: ["dcp-insurance/src/main/java/com/acme/BenefitClaimService.java"],
    moduleUsagePaths: ["dcp-insurance/src/main/java/com/acme/BenefitClaimService.java"],
    reqSystemIds: [],
    respSystemId: undefined,
    targetType: undefined,
    parameterName: undefined,
    serviceId: undefined,
    javaCallSites: [
      {
        path: "dcp-insurance/src/main/java/com/acme/BenefitClaimService.java",
        methodName: "callF13630020",
        direct: true
      }
    ]
  }
];

describe("domain maturity", () => {
  it("computes maturity score and band from analysis artifacts", () => {
    const output = computeDomainMaturity({
      domainPacks: [benefitClaimPack],
      frontBackGraph: snapshot,
      structure: {
        entries: {
          "dcp-insurance/src/main/java/com/acme/BenefitClaimService.java": {
            path: "dcp-insurance/src/main/java/com/acme/BenefitClaimService.java",
            packageName: "com.acme",
            classes: [{ name: "BenefitClaimService" }],
            methods: [{ name: "saveBenefitClaim" }, { name: "saveBenefitClaimDoc" }],
            functions: [],
            calls: ["callF13630020", "saveClamDocumentFile"],
            summary: "보험금 청구 서비스"
          }
        }
      },
      eaiEntries
    });

    expect(output.summary.overallScore).toBeGreaterThanOrEqual(50);
    expect(output.domains[0]?.band).toMatch(/usable|mature|strong/);
    expect(output.domains[0]?.counts.linkCount).toBeGreaterThan(0);
    expect(output.domains[0]?.counts.eaiCount).toBeGreaterThan(0);
    expect(output.domains[0]?.matchedCapabilityTags).toEqual(expect.arrayContaining(["benefit-claim"]));
  });
});
