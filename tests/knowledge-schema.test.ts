import { describe, expect, it } from "vitest";
import { buildKnowledgeSchemaMarkdown, buildKnowledgeSchemaSnapshot, compactKnowledgeSchemaSnapshot } from "../src/server/knowledge-schema.js";
import type { LearnedKnowledgeSnapshot } from "../src/server/learned-knowledge.js";
import type { FrontBackGraphSnapshot } from "../src/server/front-back-graph.js";
import type { EaiDictionaryEntry } from "../src/server/eai-dictionary.js";

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
      status: "stale",
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
    staleCount: 1,
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
            functions: [],
            resources: {
              storeKinds: [],
              redisAccessTypes: [],
              redisOps: [],
              redisKeys: [],
              dbAccessTypes: [],
              dbModelNames: [],
              dbTableNames: [],
              dbQueryNames: [],
              controlGuardNames: [],
              decisionPathNames: ["registe::if monimo sessionToken missing"],
              requestModelNames: ["MonimoAuthRequest"],
              responseModelNames: ["MonimoAuthResponse"]
            }
          },
          "dcp-member/src/main/java/com/example/EmbededMemberLoginService.java": {
            path: "dcp-member/src/main/java/com/example/EmbededMemberLoginService.java",
            packageName: "com.example",
            summary: "member login service",
            classes: [{ name: "EmbededMemberLoginService", line: 10 }],
            methods: [{ name: "authenticate", className: "EmbededMemberLoginService", line: 22 }],
            functions: [],
            resources: {
              storeKinds: ["redis", "database"],
              redisAccessTypes: ["RedisSessionSupport"],
              redisOps: ["redisSessionSupport.getItem", "redisSessionSupport.setItem"],
              redisKeys: ["member.login.status", "member.profile"],
              dbAccessTypes: ["MonimoUntyPlatfMbrBasDao"],
              dbModelNames: ["MonimoUntyPlatfMbrBasDaoModel"],
              dbTableNames: ["TB_MONIMO_MEMBER"],
              decisionPathNames: ["authenticate::switch auth status"],
              requestModelNames: ["MonimoAuthRequest"],
              responseModelNames: ["MonimoAuthResponse"]
            }
          },
          "dcp-async/src/main/java/com/example/MonimoAsyncController.java": {
            path: "dcp-async/src/main/java/com/example/MonimoAsyncController.java",
            packageName: "com.example",
            summary: "monimo async callback controller",
            classes: [{ name: "MonimoAsyncController", line: 11 }],
            methods: [{ name: "jellyPayRes", className: "MonimoAsyncController", line: 25 }],
            functions: [],
            resources: {
              storeKinds: [],
              redisAccessTypes: [],
              redisOps: [],
              redisKeys: [],
              asyncChannelNames: ["monimo.auth.callback"],
              dbAccessTypes: [],
              dbModelNames: [],
              dbTableNames: [],
              requestModelNames: ["MonimoAuthRequest"],
              responseModelNames: []
            }
          },
          "dcp-async/src/main/java/com/example/MonimoAuthEventDispatcher.java": {
            path: "dcp-async/src/main/java/com/example/MonimoAuthEventDispatcher.java",
            packageName: "com.example",
            summary: "monimo auth callback dispatcher",
            classes: [{ name: "MonimoAuthEventDispatcher", line: 9 }],
            methods: [{ name: "dispatchCallback", className: "MonimoAuthEventDispatcher", line: 19 }],
            functions: [],
            resources: {
              storeKinds: [],
              redisAccessTypes: [],
              redisOps: [],
              redisKeys: [],
              asyncChannelNames: ["monimo.auth.callback"],
              dbAccessTypes: [],
              dbModelNames: [],
              dbTableNames: [],
              requestModelNames: ["MonimoAuthRequest"],
              responseModelNames: []
            }
          },
          "dcp-member/src/main/java/com/example/MemberAuthValidator.java": {
            path: "dcp-member/src/main/java/com/example/MemberAuthValidator.java",
            packageName: "com.example",
            summary: "member auth validator",
            classes: [{ name: "MemberAuthValidator", line: 9 }],
            methods: [{ name: "validateSessionToken", className: "MemberAuthValidator", line: 21 }],
            functions: [],
            resources: {
              storeKinds: [],
              redisAccessTypes: [],
              redisOps: [],
              redisKeys: [],
              dbAccessTypes: [],
              dbModelNames: [],
              dbTableNames: [],
              controlGuardNames: ["MemberAuthValidator", "validateSessionToken"],
              requestModelNames: [],
              responseModelNames: []
            }
          },
          "dcp-member/src/main/java/com/example/MemberSessionRepository.java": {
            path: "dcp-member/src/main/java/com/example/MemberSessionRepository.java",
            packageName: "com.example",
            summary: "member session repository",
            classes: [{ name: "MemberSessionRepository", line: 12 }],
            methods: [{ name: "findActiveSession", className: "MemberSessionRepository", line: 28 }],
            functions: [],
            resources: {
              storeKinds: ["database"],
              redisAccessTypes: [],
              redisOps: [],
              redisKeys: [],
              dbAccessTypes: ["MemberSessionRepository"],
              dbModelNames: [],
              dbTableNames: ["TB_MONIMO_MEMBER"],
              dbQueryNames: ["findActiveSession"],
              controlGuardNames: [],
              requestModelNames: [],
              responseModelNames: []
            }
          },
          "dcp-member/src/main/java/com/example/MonimoUntyPlatfMbrBasDaoModel.java": {
            path: "dcp-member/src/main/java/com/example/MonimoUntyPlatfMbrBasDaoModel.java",
            packageName: "com.example.model",
            summary: "monimo member dao model",
            classes: [{ name: "MonimoUntyPlatfMbrBasDaoModel", line: 8 }],
            methods: [],
            functions: [],
            resources: {
              storeKinds: ["database"],
              redisAccessTypes: [],
              redisOps: [],
              redisKeys: [],
              dbAccessTypes: [],
              dbModelNames: ["MonimoUntyPlatfMbrBasDaoModel"],
              dbTableNames: ["TB_MONIMO_MEMBER"],
              requestModelNames: [],
              responseModelNames: []
            }
          }
        }
      },
      frontBackGraph,
      eaiEntries,
      learnedKnowledge
    });

    expect(snapshot.summary.entityCount).toBeGreaterThan(0);
    expect(snapshot.summary.edgeCount).toBeGreaterThan(0);
    expect(snapshot.summary.entityTypeCounts["knowledge-cluster"]).toBeGreaterThanOrEqual(2);
    expect(snapshot.summary.edgeTypeCounts["routes-to"]).toBeGreaterThanOrEqual(2);
    expect(snapshot.summary.edgeTypeCounts["uses-eai"]).toBeGreaterThanOrEqual(1);
    expect(snapshot.summary.staleClusterCount).toBeGreaterThanOrEqual(1);

    expect(snapshot.entities.some((entity) => entity.id === "module:dcp-member")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "route:/mo/login/monimo/MDP-MYCER999999M:src/views/login/MDP-MYCER999999M.vue")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "api:/member/monimo/registe")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "gateway-handler:RouteController.route")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "controller:RegisteUseDcpChnelController.registe")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "service:EmbededMemberLoginService.authenticate")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "eai:F14090150")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "store:redis")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "store:database")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "cache-key:member.login.status")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "data-contract:monimoauthrequest")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "data-contract:monimoauthresponse")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.type === "decision-path" && /registe :: if monimo sessiontoken missing/i.test(entity.label))).toBe(true);
    expect(snapshot.entities.some((entity) => entity.type === "decision-path" && /authenticate :: switch auth status/i.test(entity.label))).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "data-model:monimountyplatfmbrbasdaomodel")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "data-table:tb_monimo_member")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "async-channel:monimo.auth.callback")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id.includes("MonimoAuthEventDispatcher.dispatchCallback"))).toBe(true);
    expect(snapshot.entities.some((entity) => entity.type === "data-query" && entity.label === "findActiveSession")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.type === "data-query" && entity.label === "findActiveSession")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.type === "control-guard" && entity.label === "MemberAuthValidator")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.type === "control-guard" && entity.label === "validateSessionToken")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === "knowledge:candidate:channel:monimo")).toBe(true);

    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "declares" &&
          edge.fromId === "file:frontend:src/views/login/MDP-MYCER999999M.vue" &&
          edge.toId === "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "calls" &&
          edge.fromId === "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth" &&
          edge.toId === "api:/member/monimo/registe"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "transitions-to" &&
          edge.fromId === "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth" &&
          edge.toId === "api:/member/monimo/registe"
      )
    ).toBe(true);
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
          edge.type === "routes-to" &&
          edge.fromId === "api:/member/monimo/registe" &&
          edge.toId === "gateway-handler:RouteController.route"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "proxies-to" &&
          edge.fromId === "gateway-handler:RouteController.route" &&
          edge.toId === "controller:RegisteUseDcpChnelController.registe"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "maps-to" &&
          edge.fromId === "controller:RegisteUseDcpChnelController.registe" &&
          edge.toId === "symbol:method:RegisteUseDcpChnelController.registe:dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "maps-to" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate" &&
          edge.toId === "symbol:method:EmbededMemberLoginService.authenticate:dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"
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
          edge.type === "transitions-to" &&
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
          edge.type === "transitions-to" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate" &&
          ["store:redis", "eai:F14090150"].includes(edge.toId) &&
          ["uses-store", "uses-eai"].includes(String(edge.attributes.edgeKind))
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "transitions-to" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate" &&
          edge.toId.includes("data-query:findactivesession") &&
          edge.attributes.edgeKind === "data-query"
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
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "uses-store" &&
          edge.fromId === "file:backend:dcp-member/src/main/java/com/example/EmbededMemberLoginService.java" &&
          edge.toId === "store:redis"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "branches-to" &&
          edge.fromId === "controller:RegisteUseDcpChnelController.registe"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "branches-to" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "emits-contract" &&
          edge.fromId === "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth" &&
          edge.toId === "data-contract:monimoauthrequest"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "receives-contract" &&
          edge.fromId === "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth" &&
          edge.toId === "data-contract:monimoauthresponse"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "accepts-contract" &&
          edge.fromId === "api:/member/monimo/registe" &&
          edge.toId === "data-contract:monimoauthrequest"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "returns-contract" &&
          edge.fromId === "api:/member/monimo/registe" &&
          edge.toId === "data-contract:monimoauthresponse"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "accepts-contract" &&
          edge.fromId === "controller:RegisteUseDcpChnelController.registe" &&
          edge.toId === "data-contract:monimoauthrequest"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "returns-contract" &&
          edge.fromId === "controller:RegisteUseDcpChnelController.registe" &&
          edge.toId === "data-contract:monimoauthresponse"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "accepts-contract" &&
          edge.fromId === "symbol:method:RegisteUseDcpChnelController.registe:dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java" &&
          edge.toId === "data-contract:monimoauthrequest"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "returns-contract" &&
          edge.fromId === "symbol:method:RegisteUseDcpChnelController.registe:dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java" &&
          edge.toId === "data-contract:monimoauthresponse"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "accepts-contract" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate" &&
          edge.toId === "data-contract:monimoauthrequest"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "returns-contract" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate" &&
          edge.toId === "data-contract:monimoauthresponse"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "propagates-contract" &&
          edge.fromId === "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth" &&
          edge.toId === "api:/member/monimo/registe" &&
          edge.attributes.direction === "request" &&
          edge.attributes.contractId === "data-contract:monimoauthrequest"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "propagates-contract" &&
          edge.fromId === "controller:RegisteUseDcpChnelController.registe" &&
          edge.toId === "service:EmbededMemberLoginService.authenticate" &&
          edge.attributes.direction === "request" &&
          edge.attributes.contractId === "data-contract:monimoauthrequest"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "propagates-contract" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate" &&
          edge.toId === "store:redis" &&
          edge.attributes.direction === "request" &&
          edge.attributes.contractId === "data-contract:monimoauthrequest"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "propagates-contract" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate" &&
          edge.toId === "eai:F14090150" &&
          edge.attributes.direction === "request" &&
          edge.attributes.contractId === "data-contract:monimoauthrequest"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "propagates-contract" &&
          edge.fromId === "api:/member/monimo/registe" &&
          edge.toId === "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth" &&
          edge.attributes.direction === "response" &&
          edge.attributes.contractId === "data-contract:monimoauthresponse"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "propagates-contract" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate" &&
          edge.toId === "controller:RegisteUseDcpChnelController.registe" &&
          edge.attributes.direction === "response" &&
          edge.attributes.contractId === "data-contract:monimoauthresponse"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "propagates-contract" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate" &&
          edge.toId === "store:redis" &&
          edge.attributes.direction === "response" &&
          edge.attributes.contractId === "data-contract:monimoauthresponse"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "propagates-contract" &&
          edge.fromId === "service:EmbededMemberLoginService.authenticate" &&
          edge.toId === "eai:F14090150" &&
          edge.attributes.direction === "response" &&
          edge.attributes.contractId === "data-contract:monimoauthresponse"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "stores-model" &&
          edge.fromId === "file:backend:dcp-member/src/main/java/com/example/EmbededMemberLoginService.java" &&
          edge.toId === "data-model:monimountyplatfmbrbasdaomodel"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "maps-to-table" &&
          edge.fromId === "data-model:monimountyplatfmbrbasdaomodel" &&
          edge.toId === "data-table:tb_monimo_member"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "queries-table" &&
          edge.fromId.includes("findactivesession") &&
          edge.toId === "data-table:tb_monimo_member"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "queries-table" &&
          edge.fromId === "file:backend:dcp-member/src/main/java/com/example/EmbededMemberLoginService.java" &&
          edge.toId === "data-table:tb_monimo_member"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "uses-cache-key" &&
          edge.fromId === "file:backend:dcp-member/src/main/java/com/example/EmbededMemberLoginService.java" &&
          edge.toId === "cache-key:member.login.status"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "consumes-from" &&
          edge.toId === "async-channel:monimo.auth.callback"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "dispatches-to" &&
          edge.toId === "async-channel:monimo.auth.callback"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "transitions-to" &&
          edge.fromId === "async-channel:monimo.auth.callback" &&
          edge.toId.includes("MonimoAsyncController")
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "propagates-contract" &&
          edge.toId === "async-channel:monimo.auth.callback" &&
          edge.attributes.contractId === "data-contract:monimoauthrequest" &&
          edge.attributes.direction === "request"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "propagates-contract" &&
          edge.fromId === "async-channel:monimo.auth.callback" &&
          edge.toId.includes("MonimoAsyncController.jellyPayRes") &&
          edge.attributes.contractId === "data-contract:monimoauthrequest" &&
          edge.attributes.direction === "request"
      )
    ).toBe(true);
    const guardIds = snapshot.entities
      .filter((entity) => entity.type === "control-guard" && ["MemberAuthValidator", "validateSessionToken"].includes(entity.label))
      .map((entity) => entity.id);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "validates" &&
          guardIds.includes(edge.toId)
      )
    ).toBe(true);
  });

  it("derives workflow-family transitions across related api/controller flows", () => {
    const snapshot = buildKnowledgeSchemaSnapshot({
      generatedAt: "2026-03-16T00:00:00.000Z",
      workspaceDir: "/workspace/dcp-services",
      structure: { entries: {} },
      frontBackGraph: {
        ...frontBackGraph,
        frontend: {
          ...frontBackGraph.frontend,
          routeCount: 3,
          screenCount: 3,
          apiCount: 3,
          routes: [
            {
              routePath: "/mo/insurance/claim/MDP-MYINT020110M",
              screenPath: "src/views/insurance/MDP-MYINT020110M.vue",
              sourceFile: "src/router/mo/insurance/route.js",
              screenCode: "MDP-MYINT020110M"
            },
            {
              routePath: "/mo/insurance/claim/MDP-MYINT020540M",
              screenPath: "src/views/insurance/MDP-MYINT020540M.vue",
              sourceFile: "src/router/mo/insurance/route.js",
              screenCode: "MDP-MYINT020540M"
            },
            {
              routePath: "/mo/insurance/claim/MDP-MYINT021120M",
              screenPath: "src/views/insurance/MDP-MYINT021120M.vue",
              sourceFile: "src/router/mo/insurance/route.js",
              screenCode: "MDP-MYINT021120M"
            }
          ],
          screens: [
            {
              filePath: "src/views/insurance/MDP-MYINT020110M.vue",
              screenCode: "MDP-MYINT020110M",
              componentName: "MDP-MYINT020110M",
              routePaths: ["/mo/insurance/claim/MDP-MYINT020110M"],
              exportPaths: [],
              apiPaths: ["/insurance/accBenefit/claim/check"],
              httpCalls: [
                {
                  rawUrl: "/gw/api/insurance/accBenefit/claim/check",
                  normalizedUrl: "/insurance/accBenefit/claim/check",
                  functionName: "checkClaim",
                  source: "http-call"
                }
              ]
            },
            {
              filePath: "src/views/insurance/MDP-MYINT020540M.vue",
              screenCode: "MDP-MYINT020540M",
              componentName: "MDP-MYINT020540M",
              routePaths: ["/mo/insurance/claim/MDP-MYINT020540M"],
              exportPaths: [],
              apiPaths: ["/insurance/accBenefit/claim/spotSave"],
              httpCalls: [
                {
                  rawUrl: "/gw/api/insurance/accBenefit/claim/spotSave",
                  normalizedUrl: "/insurance/accBenefit/claim/spotSave",
                  functionName: "saveClaimDraft",
                  source: "http-call"
                }
              ]
            },
            {
              filePath: "src/views/insurance/MDP-MYINT021120M.vue",
              screenCode: "MDP-MYINT021120M",
              componentName: "MDP-MYINT021120M",
              routePaths: ["/mo/insurance/claim/MDP-MYINT021120M"],
              exportPaths: [],
              apiPaths: ["/insurance/benefit/claim/progress/gen/inqury"],
              httpCalls: [
                {
                  rawUrl: "/gw/api/insurance/benefit/claim/progress/gen/inqury",
                  normalizedUrl: "/insurance/benefit/claim/progress/gen/inqury",
                  functionName: "loadClaimProgress",
                  source: "http-call"
                }
              ]
            }
          ]
        },
        backend: {
          ...frontBackGraph.backend,
          routeCount: 3,
          routes: [
            {
              path: "/insurance/accBenefit/claim/check",
              internalPath: "/insurance/accBenefit/claim/check",
              controllerClass: "AccBenefitClaimController",
              controllerMethod: "benefitClaimCheck",
              filePath: "dcp-insurance/src/main/java/com/example/AccBenefitClaimController.java",
              serviceHints: ["AccBenefitClaimService.checkApply"],
              labels: [],
              capabilityTags: []
            },
            {
              path: "/insurance/accBenefit/claim/spotSave",
              internalPath: "/insurance/accBenefit/claim/spotSave",
              controllerClass: "AccBenefitClaimController",
              controllerMethod: "spotSave",
              filePath: "dcp-insurance/src/main/java/com/example/AccBenefitClaimController.java",
              serviceHints: ["AccBenefitClaimService.saveBenefitClaim"],
              labels: [],
              capabilityTags: []
            },
            {
              path: "/insurance/benefit/claim/progress/gen/inqury",
              internalPath: "/insurance/benefit/claim/progress/gen/inqury",
              controllerClass: "BenefitClaimProgressController",
              controllerMethod: "benefitClaimProgressGenInqury",
              filePath: "dcp-insurance/src/main/java/com/example/BenefitClaimProgressController.java",
              serviceHints: ["BenefitClaimProgressService.callF1FCZ0230"],
              labels: [],
              capabilityTags: []
            }
          ]
        },
        links: [
          {
            confidence: 0.91,
            frontend: {
              screenCode: "MDP-MYINT020110M",
              screenPath: "src/views/insurance/MDP-MYINT020110M.vue",
              routePath: "/mo/insurance/claim/MDP-MYINT020110M"
            },
            api: {
              rawUrl: "/gw/api/insurance/accBenefit/claim/check",
              normalizedUrl: "/insurance/accBenefit/claim/check",
              functionName: "checkClaim",
              source: "http-call"
            },
            gateway: {
              path: "/api/**",
              controllerMethod: "RouteController.route"
            },
            backend: {
              path: "/insurance/accBenefit/claim/check",
              controllerMethod: "AccBenefitClaimController.benefitClaimCheck",
              filePath: "dcp-insurance/src/main/java/com/example/AccBenefitClaimController.java",
              serviceHints: ["AccBenefitClaimService.checkApply"]
            },
            evidence: ["frontend-http-call", "backend-request-mapping"]
          },
          {
            confidence: 0.93,
            frontend: {
              screenCode: "MDP-MYINT020540M",
              screenPath: "src/views/insurance/MDP-MYINT020540M.vue",
              routePath: "/mo/insurance/claim/MDP-MYINT020540M"
            },
            api: {
              rawUrl: "/gw/api/insurance/accBenefit/claim/spotSave",
              normalizedUrl: "/insurance/accBenefit/claim/spotSave",
              functionName: "saveClaimDraft",
              source: "http-call"
            },
            gateway: {
              path: "/api/**",
              controllerMethod: "RouteController.route"
            },
            backend: {
              path: "/insurance/accBenefit/claim/spotSave",
              controllerMethod: "AccBenefitClaimController.spotSave",
              filePath: "dcp-insurance/src/main/java/com/example/AccBenefitClaimController.java",
              serviceHints: ["AccBenefitClaimService.saveBenefitClaim"]
            },
            evidence: ["frontend-http-call", "backend-request-mapping"]
          },
          {
            confidence: 0.89,
            frontend: {
              screenCode: "MDP-MYINT021120M",
              screenPath: "src/views/insurance/MDP-MYINT021120M.vue",
              routePath: "/mo/insurance/claim/MDP-MYINT021120M"
            },
            api: {
              rawUrl: "/gw/api/insurance/benefit/claim/progress/gen/inqury",
              normalizedUrl: "/insurance/benefit/claim/progress/gen/inqury",
              functionName: "loadClaimProgress",
              source: "http-call"
            },
            gateway: {
              path: "/api/**",
              controllerMethod: "RouteController.route"
            },
            backend: {
              path: "/insurance/benefit/claim/progress/gen/inqury",
              controllerMethod: "BenefitClaimProgressController.benefitClaimProgressGenInqury",
              filePath: "dcp-insurance/src/main/java/com/example/BenefitClaimProgressController.java",
              serviceHints: ["BenefitClaimProgressService.callF1FCZ0230"]
            },
            evidence: ["frontend-http-call", "backend-request-mapping"]
          }
        ]
      }
    });

    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "transitions-to" &&
          edge.fromId === "api:/insurance/accBenefit/claim/check" &&
          edge.toId === "api:/insurance/accBenefit/claim/spotSave" &&
          edge.attributes.edgeKind === "flow-family"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "transitions-to" &&
          edge.fromId === "controller:AccBenefitClaimController.benefitClaimCheck" &&
          edge.toId === "controller:AccBenefitClaimController.spotSave" &&
          edge.attributes.edgeKind === "flow-family"
      )
    ).toBe(true);
    expect(
      snapshot.edges.some(
        (edge) =>
          edge.type === "transitions-to" &&
          edge.fromId === "service:AccBenefitClaimService.checkApply" &&
          edge.toId === "service:AccBenefitClaimService.saveBenefitClaim" &&
          edge.attributes.edgeKind === "flow-family"
      )
    ).toBe(true);
  });

  it("renders markdown summary without relying on mermaid or UI-only components", () => {
    const snapshot = buildKnowledgeSchemaSnapshot({
      generatedAt: "2026-03-16T00:00:00.000Z",
      workspaceDir: "/workspace/dcp-services",
      structure: { entries: {} }
    });

    const markdown = buildKnowledgeSchemaMarkdown(snapshot);
    expect(markdown).toContain("# Unified Knowledge Schema");
    expect(markdown).toContain("## Entity Types");
    expect(markdown).toContain("## Knowledge Clusters");
  });
  it("compacts large knowledge schema snapshots before retrieval-heavy stages", () => {
    const base = buildKnowledgeSchemaSnapshot({
      generatedAt: "2026-03-16T00:00:00.000Z",
      workspaceDir: "/workspace/dcp-services",
      structure: {
        entries: {
          "dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java": {
            path: "dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java",
            packageName: "demo",
            summary: "controller",
            classes: [{ name: "RegisteUseDcpChnelController", line: 1 }],
            methods: [{ name: "registe", line: 10, className: "RegisteUseDcpChnelController" }],
            functions: [],
            calls: []
          },
          "dcp-member/src/main/java/com/example/EmbededMemberLoginService.java": {
            path: "dcp-member/src/main/java/com/example/EmbededMemberLoginService.java",
            packageName: "demo",
            summary: "service",
            classes: [{ name: "EmbededMemberLoginService", line: 1 }],
            methods: [{ name: "authenticate", line: 15, className: "EmbededMemberLoginService" }],
            functions: [],
            calls: []
          },
          "dcp-member/src/main/java/com/example/NoiseSymbol.java": {
            path: "dcp-member/src/main/java/com/example/NoiseSymbol.java",
            packageName: "demo",
            summary: "noise",
            classes: [{ name: "NoiseSymbol", line: 1 }],
            methods: Array.from({ length: 12 }, (_, index) => ({ name: `noop${index}`, line: index + 2, className: "NoiseSymbol" })),
            functions: [],
            calls: []
          }
        }
      },
      frontBackGraph,
      eaiEntries,
      learnedKnowledge
    });

    const compacted = compactKnowledgeSchemaSnapshot(base, {
      maxEntities: 8,
      maxEdges: 12
    });

    expect(compacted.summary.entityCount).toBeLessThanOrEqual(8);
    expect(compacted.summary.edgeCount).toBeLessThanOrEqual(12);
    expect(compacted.entities.some((entity) => entity.type === "route")).toBe(true);
    expect(compacted.entities.some((entity) => entity.type === "api")).toBe(true);
    expect(compacted.entities.some((entity) => entity.type === "controller")).toBe(true);
    expect(compacted.entities.some((entity) => entity.type === "service")).toBe(true);
    expect(compacted.entities.some((entity) => entity.type === "knowledge-cluster")).toBe(true);
    expect(compacted.entities.some((entity) => entity.label === "NoiseSymbol.noop11")).toBe(false);
  });

});
