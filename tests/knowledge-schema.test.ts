import { describe, expect, it } from "vitest";
import { buildKnowledgeSchemaMarkdown, buildKnowledgeSchemaSnapshot } from "../src/server/knowledge-schema.js";
import type { DomainPack } from "../src/server/domain-packs.js";
import type { LearnedKnowledgeSnapshot } from "../src/server/learned-knowledge.js";
import type { FrontBackGraphSnapshot } from "../src/server/front-back-graph.js";
import type { EaiDictionaryEntry } from "../src/server/eai-dictionary.js";

const domainPacks: DomainPack[] = [
  {
    id: "member-auth",
    name: "Member Auth",
    description: "Member login and identity verification",
    families: [],
    enabledByDefault: true,
    capabilityTags: [
      {
        tag: "member-auth",
        kind: "domain",
        aliases: ["회원인증", "member auth"],
        questionPatterns: [],
        textPatterns: [],
        searchTerms: [],
        pathHints: ["/member/monimo"],
        symbolHints: ["EmbededMemberLogin"],
        apiHints: ["/member/monimo"],
        parents: [],
        adjacentConfusers: []
      },
      {
        tag: "embedded-login",
        kind: "subdomain",
        aliases: ["embedded member login"],
        questionPatterns: [],
        textPatterns: [],
        searchTerms: [],
        pathHints: ["/member/monimo/registe"],
        symbolHints: ["EmbededMemberLoginService"],
        apiHints: ["/member/monimo/registe"],
        parents: ["member-auth"],
        adjacentConfusers: []
      },
      {
        tag: "action-check",
        kind: "action",
        aliases: ["check"],
        questionPatterns: [],
        textPatterns: [],
        searchTerms: [],
        pathHints: ["check"],
        symbolHints: [],
        apiHints: [],
        parents: [],
        adjacentConfusers: []
      }
    ],
    rankingPriors: [],
    exemplars: [],
    createdAt: "2026-03-16T00:00:00.000Z",
    updatedAt: "2026-03-16T00:00:00.000Z",
    builtIn: false
  }
];

const frontBackGraph: FrontBackGraphSnapshot = {
  version: 1,
  generatedAt: "2026-03-16T00:00:00.000Z",
  meta: {
    backendWorkspaceDir: "/workspace/dcp-services",
    frontendWorkspaceDirs: ["/workspace/dcp-front"],
    asOfDate: "2026-03-16"
  },
  frontend: {
    routeCount: 1,
    screenCount: 1,
    apiCount: 1,
    routes: [
      {
        routePath: "/mo/login/monimo/MDP-MYCER999999M",
        screenPath: "src/views/login/MDP-MYCER999999M.vue",
        sourceFile: "src/router/mo/login/route.js",
        screenCode: "MDP-MYCER999999M",
        notes: ["모니모 나이스 인증 브릿지용"],
        capabilityTags: ["member-auth", "embedded-login"]
      }
    ],
    screens: [
      {
        filePath: "src/views/login/MDP-MYCER999999M.vue",
        screenCode: "MDP-MYCER999999M",
        componentName: "MDP-MYCER999999M",
        routePaths: ["/mo/login/monimo/MDP-MYCER999999M"],
        exportPaths: [],
        apiPaths: ["/member/monimo/registe"],
        httpCalls: [
          {
            rawUrl: "/gw/api/member/monimo/registe",
            normalizedUrl: "/member/monimo/registe",
            functionName: "requestMonimoAuth",
            source: "http-call"
          }
        ],
        labels: ["모니모 회원인증"],
        capabilityTags: ["member-auth", "embedded-login"]
      }
    ]
  },
  backend: {
    routeCount: 1,
    gatewayRoutes: [
      {
        path: "/api/**",
        controllerClass: "RouteController",
        controllerMethod: "route",
        filePath: "dcp-gateway/src/main/java/com/example/RouteController.java",
        serviceHints: [],
        labels: [],
        capabilityTags: ["gateway-api"]
      }
    ],
    routes: [
      {
        path: "/member/monimo/registe",
        internalPath: "/member/monimo/registe",
        controllerClass: "RegisteUseDcpChnelController",
        controllerMethod: "registe",
        filePath: "dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java",
        serviceHints: ["EmbededMemberLoginService.authenticate"],
        labels: ["모니모 회원인증 등록"],
        capabilityTags: ["member-auth", "embedded-login"]
      }
    ]
  },
  links: [
    {
      confidence: 0.91,
      capabilityTags: ["member-auth", "embedded-login"],
      frontend: {
        screenCode: "MDP-MYCER999999M",
        screenPath: "src/views/login/MDP-MYCER999999M.vue",
        routePath: "/mo/login/monimo/MDP-MYCER999999M"
      },
      api: {
        rawUrl: "/gw/api/member/monimo/registe",
        normalizedUrl: "/member/monimo/registe",
        functionName: "requestMonimoAuth",
        source: "http-call"
      },
      gateway: {
        path: "/api/**",
        controllerMethod: "RouteController.route"
      },
      backend: {
        path: "/member/monimo/registe",
        controllerMethod: "RegisteUseDcpChnelController.registe",
        filePath: "dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java",
        serviceHints: ["EmbededMemberLoginService.authenticate"]
      },
      evidence: ["frontend-route", "frontend-http-call", "backend-request-mapping", "backend-service-call"]
    }
  ],
  diagnostics: {
    parseFailures: [],
    unmatchedFrontendApis: [],
    unmatchedFrontendScreens: []
  }
};

const learnedKnowledge: LearnedKnowledgeSnapshot = {
  version: 1,
  generatedAt: "2026-03-16T00:00:00.000Z",
  candidates: [
    {
      id: "channel:monimo",
      kind: "channel",
      status: "validated",
      label: "monimo channel",
      description: "monimo-related login flow",
      tags: ["monimo", "channel"],
      aliases: ["모니모", "monimo"],
      apiPrefixes: ["member/monimo"],
      screenPrefixes: ["MDP-MYCER9999"],
      controllerHints: ["RegisteUseDcpChnelController"],
      serviceHints: ["EmbededMemberLoginService"],
      pathHints: ["dcp-member", "monimo"],
      searchTerms: ["monimo", "모니모", "/member/monimo/registe"],
      evidence: ["MDP-MYCER999999M -> /gw/api/member/monimo/registe -> RegisteUseDcpChnelController.registe"],
      score: 82,
      counts: {
        links: 1,
        screens: 1,
        backend: 1,
        eai: 0,
        uses: 2,
        successes: 2,
        failures: 0
      },
      firstSeenAt: "2026-03-16T00:00:00.000Z",
      lastSeenAt: "2026-03-16T00:00:00.000Z"
    },
    {
      id: "module:dcp-async",
      kind: "module-role",
      status: "candidate",
      label: "async support",
      description: "async support module",
      tags: ["dcp-async"],
      aliases: ["dcp-async", "async support"],
      apiPrefixes: [],
      screenPrefixes: [],
      controllerHints: [],
      serviceHints: [],
      pathHints: ["dcp-async"],
      searchTerms: ["dcp-async", "async"],
      evidence: ["dcp-async files=42"],
      score: 44,
      counts: {
        links: 0,
        screens: 0,
        backend: 42,
        eai: 0,
        uses: 0,
        successes: 0,
        failures: 0
      },
      firstSeenAt: "2026-03-16T00:00:00.000Z",
      lastSeenAt: "2026-03-16T00:00:00.000Z"
    }
  ],
  summary: {
    candidateCount: 2,
    validatedCount: 1,
    domainCount: 0,
    moduleRoleCount: 1,
    processCount: 0,
    channelCount: 1,
    strongestCandidates: ["channel:monimo", "module:dcp-async"]
  }
};

const eaiEntries: EaiDictionaryEntry[] = [
  {
    interfaceId: "F14090150",
    interfaceName: "가입자일괄조회",
    purpose: "회원 가입자 조회",
    sourcePath: "dcp-member/src/main/resources/eai/io/F14090150.xml",
    envPaths: [],
    usagePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
    moduleUsagePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
    reqSystemIds: ["DCP"],
    respSystemId: "LEGACY",
    targetType: "sync",
    parameterName: "request",
    serviceId: "F14090150",
    javaCallSites: [
      {
        path: "dcp-member/src/main/java/com/example/EmbededMemberLoginService.java",
        className: "EmbededMemberLoginService",
        methodName: "authenticate",
        direct: true
      }
    ]
  }
];

describe("knowledge schema foundation", () => {
  it("normalizes structure, graph, EAI, and learned knowledge into one snapshot", () => {
    const snapshot = buildKnowledgeSchemaSnapshot({
      generatedAt: "2026-03-16T00:00:00.000Z",
      workspaceDir: "/workspace/dcp-services",
      structure: {
        entries: {
          "dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java": {
            path: "dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java",
            packageName: "com.example",
            summary: "member controller",
            classes: [{ name: "RegisteUseDcpChnelController", line: 10 }],
            methods: [{ name: "registe", className: "RegisteUseDcpChnelController", line: 20 }],
            functions: []
          },
          "dcp-member/src/main/java/com/example/EmbededMemberLoginService.java": {
            path: "dcp-member/src/main/java/com/example/EmbededMemberLoginService.java",
            packageName: "com.example",
            summary: "member login service",
            classes: [{ name: "EmbededMemberLoginService", line: 10 }],
            methods: [{ name: "authenticate", className: "EmbededMemberLoginService", line: 22 }],
            functions: []
          },
          "dcp-async/src/main/java/com/example/MonimoAsyncController.java": {
            path: "dcp-async/src/main/java/com/example/MonimoAsyncController.java",
            packageName: "com.example",
            summary: "monimo async callback controller",
            classes: [{ name: "MonimoAsyncController", line: 11 }],
            methods: [{ name: "jellyPayRes", className: "MonimoAsyncController", line: 25 }],
            functions: []
          }
        }
      },
      frontBackGraph,
      eaiEntries,
      learnedKnowledge,
      domainPacks
    });

    expect(snapshot.summary.entityCount).toBeGreaterThan(0);
    expect(snapshot.summary.edgeCount).toBeGreaterThan(0);
    expect(snapshot.summary.entityTypeCounts["knowledge-cluster"]).toBeGreaterThanOrEqual(3);
    expect(snapshot.summary.edgeTypeCounts["routes-to"]).toBeGreaterThanOrEqual(2);
    expect(snapshot.summary.edgeTypeCounts["uses-eai"]).toBeGreaterThanOrEqual(1);

    expect(snapshot.entities.some((entity) => entity.id === "module:dcp-member")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "route:/mo/login/monimo/MDP-MYCER999999M:src/views/login/MDP-MYCER999999M.vue")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "api:/member/monimo/registe")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "controller:RegisteUseDcpChnelController.registe")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "service:EmbededMemberLoginService.authenticate")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "eai:F14090150")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "knowledge:candidate:channel:monimo")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "knowledge:pack:member-auth")).toBe(true);

    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "routes-to" &&
          edge.fromId === "route:/mo/login/monimo/MDP-MYCER999999M:src/views/login/MDP-MYCER999999M.vue" &&
          edge.toId === "api:/member/monimo/registe"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "calls" &&
          edge.fromId === "controller:RegisteUseDcpChnelController.registe" &&
          edge.toId === "service:EmbededMemberLoginService.authenticate"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "uses-eai" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate" &&
          edge.toId === "eai:F14090150"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "belongs-to-channel" &&
          edge.toId === "knowledge:candidate:channel:monimo"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "supports-module-role" &&
          edge.fromId === "module:dcp-async" &&
          edge.toId === "knowledge:candidate:module:dcp-async"
      )
    ).toBe(true);
  });

  it("renders markdown summary without relying on mermaid or UI-only components", () => {
    const snapshot = buildKnowledgeSchemaSnapshot({
      generatedAt: "2026-03-16T00:00:00.000Z",
      workspaceDir: "/workspace/dcp-services",
      structure: { entries: {} },
      domainPacks
    });

    const markdown = buildKnowledgeSchemaMarkdown(snapshot);
    expect(markdown).toContain("# Unified Knowledge Schema");
    expect(markdown).toContain("## Entity Types");
    expect(markdown).toContain("## Knowledge Clusters");
  });
});
