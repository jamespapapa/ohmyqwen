import { describe, expect, it } from "vitest";
import { buildOntologyGraphSnapshot } from "../src/server/ontology-graph.js";
import { buildOntologyProjectionMarkdown, buildOntologyProjectionSnapshot } from "../src/server/ontology-projections.js";
import type { KnowledgeSchemaSnapshot } from "../src/server/knowledge-schema.js";
import type { RetrievalUnitSnapshot } from "../src/server/retrieval-units.js";

const knowledgeSchema: KnowledgeSchemaSnapshot = {
  version: 1,
  generatedAt: "2026-03-17T00:00:00.000Z",
  workspaceDir: "/workspace/dcp-services",
  entities: [
    {
      id: "module:dcp-async",
      type: "module",
      label: "dcp-async",
      summary: "async module",
      metadata: {
        domains: [],
        subdomains: [],
        channels: ["monimo"],
        actions: [],
        moduleRoles: ["async-support"],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["dcp-async"],
        sourceType: "structure-index",
        validatedStatus: "derived"
      },
      attributes: { moduleName: "dcp-async" }
    },
    {
      id: "route:/monimo/callback",
      type: "route",
      label: "monimo callback",
      summary: "callback route",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.86,
        evidencePaths: ["src/router/mo/login/route.js"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { routePath: "/monimo/callback" }
    },
    {
      id: "api:/monimo/jellyPayRes",
      type: "api",
      label: "/monimo/jellyPayRes",
      summary: "monimo callback api",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.89,
        evidencePaths: ["dcp-async/src/main/java/com/example/MonimoAsyncController.java"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { normalizedUrl: "/monimo/jellyPayRes" }
    },
    {
      id: "controller:MonimoAsyncController.jellyPayRes",
      type: "controller",
      label: "MonimoAsyncController.jellyPayRes",
      summary: "async callback controller",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: ["async-support"],
        processRoles: [],
        confidence: 0.9,
        evidencePaths: ["dcp-async/src/main/java/com/example/MonimoAsyncController.java"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { controllerMethod: "MonimoAsyncController.jellyPayRes" }
    },
    {
      id: "async-channel:monimo.auth.callback",
      type: "async-channel",
      label: "monimo.auth.callback",
      summary: "async callback boundary",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: ["action-callback"],
        moduleRoles: ["async-support"],
        processRoles: ["async-process"],
        confidence: 0.83,
        evidencePaths: ["dcp-async/src/main/java/com/example/MonimoAsyncController.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { channel: "monimo.auth.callback" }
    },
    {
      id: "eai:F14090150",
      type: "eai-interface",
      label: "F14090150 가입자일괄조회",
      summary: "member lookup",
      metadata: {
        domains: [],
        subdomains: [],
        channels: [],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.95,
        evidencePaths: ["eai/F14090150.xml"],
        sourceType: "eai-dictionary",
        validatedStatus: "validated"
      },
      attributes: { interfaceId: "F14090150" }
    }
  ],
  edges: [
    {
      id: "edge:route-api",
      type: "routes-to",
      fromId: "route:/monimo/callback",
      toId: "api:/monimo/jellyPayRes",
      label: "route to api",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.88,
        evidencePaths: ["src/router/mo/login/route.js"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:api-controller",
      type: "routes-to",
      fromId: "api:/monimo/jellyPayRes",
      toId: "controller:MonimoAsyncController.jellyPayRes",
      label: "api handled by controller",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: ["async-support"],
        processRoles: [],
        confidence: 0.9,
        evidencePaths: ["dcp-async/src/main/java/com/example/MonimoAsyncController.java"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:controller-eai",
      type: "uses-eai",
      fromId: "controller:MonimoAsyncController.jellyPayRes",
      toId: "eai:F14090150",
      label: "controller uses eai",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: ["async-support"],
        processRoles: [],
        confidence: 0.82,
        evidencePaths: ["dcp-async/src/main/java/com/example/MonimoAsyncController.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:controller-async",
      type: "consumes-from",
      fromId: "controller:MonimoAsyncController.jellyPayRes",
      toId: "async-channel:monimo.auth.callback",
      label: "controller consumes from async channel",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: ["action-callback"],
        moduleRoles: ["async-support"],
        processRoles: ["async-process"],
        confidence: 0.8,
        evidencePaths: ["dcp-async/src/main/java/com/example/MonimoAsyncController.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    }
  ],
  summary: {
    entityCount: 6,
    edgeCount: 4,
    entityTypeCounts: { api: 1, "async-channel": 1, controller: 1, "eai-interface": 1, module: 1, route: 1 },
    edgeTypeCounts: { "consumes-from": 1, "routes-to": 2, "uses-eai": 1 },
    validatedClusterCount: 0,
    candidateClusterCount: 0,
    staleClusterCount: 0,
    activeDomainCount: 1,
    topDomains: [{ id: "member-auth", count: 3 }],
    topModules: [{ id: "module:dcp-async", count: 1 }]
  }
};

const retrievalUnits: RetrievalUnitSnapshot = {
  version: 1,
  generatedAt: knowledgeSchema.generatedAt,
  workspaceDir: knowledgeSchema.workspaceDir,
  units: [
    {
      id: "unit:flow:monimo-callback",
      type: "flow",
      title: "monimo callback flow",
      summary: "route -> api -> controller",
      confidence: 0.89,
      validatedStatus: "derived",
      entityIds: ["route:/monimo/callback", "api:/monimo/jellyPayRes", "controller:MonimoAsyncController.jellyPayRes", "async-channel:monimo.auth.callback"],
      edgeIds: ["edge:route-api", "edge:api-controller", "edge:controller-async"],
      searchText: ["monimo", "callback", "monimo.auth.callback"],
      domains: ["member-auth"],
      subdomains: [],
      channels: ["monimo"],
      actions: ["action-check"],
      moduleRoles: ["async-support"],
      processRoles: [],
      evidencePaths: ["dcp-async/src/main/java/com/example/MonimoAsyncController.java"]
    },
    {
      id: "unit:eai:member-lookup",
      type: "eai-link",
      title: "member lookup eai",
      summary: "controller uses F14090150",
      confidence: 0.84,
      validatedStatus: "validated",
      entityIds: ["controller:MonimoAsyncController.jellyPayRes", "eai:F14090150"],
      edgeIds: ["edge:controller-eai"],
      searchText: ["F14090150", "member lookup"],
      domains: ["member-auth"],
      subdomains: [],
      channels: ["monimo"],
      actions: ["action-check"],
      moduleRoles: ["async-support"],
      processRoles: [],
      evidencePaths: ["eai/F14090150.xml"]
    }
  ],
  summary: {
    unitCount: 2,
    unitTypeCounts: { flow: 1, "eai-link": 1 },
    unitStatusCounts: { derived: 1, validated: 1 },
    topDomains: [{ id: "member-auth", count: 2 }],
    topChannels: [{ id: "monimo", count: 2 }],
    topModuleRoles: [{ id: "async-support", count: 2 }]
  }
};

describe("ontology projections", () => {
  it("builds projection snapshots from ontology graph", () => {
    const ontologyGraph = buildOntologyGraphSnapshot({
      knowledgeSchema,
      retrievalUnits
    });
    const snapshot = buildOntologyProjectionSnapshot({ ontologyGraph });

    expect(snapshot.summary.projectionCount).toBe(4);
    expect(snapshot.summary.projectionTypeCounts["code-structure"]).toBe(1);
    expect(snapshot.summary.totalRepresentativePathCount).toBeGreaterThanOrEqual(2);
    expect(snapshot.summary.largestProjectionType).toBeTruthy();

    const frontBack = snapshot.projections.find((projection) => projection.type === "front-back-flow");
    expect(frontBack?.representativePaths.length).toBeGreaterThan(0);
    expect(frontBack?.statusCounts.derived).toBeGreaterThan(0);
    expect(frontBack?.nodeIds).toContain("async-channel:monimo.auth.callback");
    const integration = snapshot.projections.find((projection) => projection.type === "integration");
    expect(integration?.representativePaths.length).toBeGreaterThan(0);
    expect(integration?.statusCounts.validated).toBeGreaterThan(0);
    expect(integration?.nodeIds).toContain("async-channel:monimo.auth.callback");
    expect(snapshot.summary.topProjectionTypes.some((item) => item.id === "front-back-flow")).toBe(true);

    const markdown = buildOntologyProjectionMarkdown(snapshot);
    expect(markdown).toContain("# Ontology Projections");
    expect(markdown).toContain("projectionCount: 4");
    expect(markdown).toContain("status=");
  });

  it("propagates compact mode from ontology graph summary", () => {
    const ontologyGraph = buildOntologyGraphSnapshot({
      knowledgeSchema,
      retrievalUnits,
      limits: {
        maxKnowledgeEntities: 3,
        maxKnowledgeEdges: 2,
        maxRetrievalUnits: 1
      }
    });
    const snapshot = buildOntologyProjectionSnapshot({ ontologyGraph });

    expect(snapshot.summary.truncated).toBe(true);
    expect(snapshot.summary.appliedLimits.length).toBeGreaterThan(0);

    const markdown = buildOntologyProjectionMarkdown(snapshot);
    expect(markdown).toContain("truncated: yes");
  });

  it("builds fallback front-back representative paths when flow retrieval units are absent", () => {
    const ontologyGraph = buildOntologyGraphSnapshot({
      knowledgeSchema,
      retrievalUnits: {
        ...retrievalUnits,
        units: retrievalUnits.units.filter((unit) => unit.type !== "flow"),
        summary: {
          ...retrievalUnits.summary,
          unitCount: 1,
          unitTypeCounts: { "eai-link": 1 },
          unitStatusCounts: { validated: 1 },
          topDomains: [{ id: "member-auth", count: 1 }],
          topChannels: [{ id: "monimo", count: 1 }],
          topModuleRoles: [{ id: "async-support", count: 1 }]
        }
      }
    });
    const snapshot = buildOntologyProjectionSnapshot({ ontologyGraph });
    const frontBack = snapshot.projections.find((projection) => projection.type === "front-back-flow");

    expect(frontBack?.representativePaths.length).toBeGreaterThan(0);
    expect(frontBack?.representativePaths[0]?.nodeIds).toEqual(
      expect.arrayContaining([
        "route:/monimo/callback",
        "api:/monimo/jellyPayRes",
        "controller:MonimoAsyncController.jellyPayRes"
      ])
    );
  });

  it("includes ui-action and gateway-handler nodes in front-back projections", () => {
    const ontologyGraph = buildOntologyGraphSnapshot({
      knowledgeSchema: {
        ...knowledgeSchema,
        entities: [
          ...knowledgeSchema.entities,
          {
            id: "ui-action:src/views/login/MonimoLogin.vue:submitauth",
            type: "ui-action",
            label: "submitAuth",
            summary: "submitAuth UI action",
            metadata: {
              domains: ["member-auth"],
              subdomains: ["embedded-login"],
              channels: ["monimo"],
              actions: ["action-auth", "action-register"],
              moduleRoles: ["ui-submit"],
              processRoles: [],
              confidence: 0.84,
              evidencePaths: ["src/views/login/MonimoLogin.vue"],
              sourceType: "front-back-graph",
              validatedStatus: "derived"
            },
            attributes: { functionName: "submitAuth" }
          },
          {
            id: "gateway-handler:RouteController.route",
            type: "gateway-handler",
            label: "RouteController.route",
            summary: "/api/** gateway handler",
            metadata: {
              domains: ["member-auth"],
              subdomains: ["embedded-login"],
              channels: ["monimo"],
              actions: ["action-auth", "action-register"],
              moduleRoles: ["gateway-routing"],
              processRoles: [],
              confidence: 0.86,
              evidencePaths: ["dcp-gateway/src/main/java/com/example/RouteController.java"],
              sourceType: "front-back-graph",
              validatedStatus: "derived"
            },
            attributes: { path: "/api/**" }
          }
        ],
        edges: [
          ...knowledgeSchema.edges,
          {
            id: "edge:ui-action-api",
            type: "calls",
            fromId: "ui-action:src/views/login/MonimoLogin.vue:submitauth",
            toId: "api:/monimo/jellyPayRes",
            label: "ui action calls api",
            metadata: {
              domains: ["member-auth"],
              subdomains: ["embedded-login"],
              channels: ["monimo"],
              actions: ["action-auth", "action-register"],
              moduleRoles: ["ui-submit"],
              processRoles: [],
              confidence: 0.84,
              evidencePaths: ["src/views/login/MonimoLogin.vue"],
              sourceType: "front-back-graph",
              validatedStatus: "derived"
            },
            attributes: {}
          },
          {
            id: "edge:api-gateway",
            type: "routes-to",
            fromId: "api:/monimo/jellyPayRes",
            toId: "gateway-handler:RouteController.route",
            label: "api routed to gateway",
            metadata: {
              domains: ["member-auth"],
              subdomains: ["embedded-login"],
              channels: ["monimo"],
              actions: ["action-auth", "action-register"],
              moduleRoles: ["gateway-routing"],
              processRoles: [],
              confidence: 0.85,
              evidencePaths: ["dcp-gateway/src/main/java/com/example/RouteController.java"],
              sourceType: "front-back-graph",
              validatedStatus: "derived"
            },
            attributes: {}
          },
          {
            id: "edge:gateway-controller",
            type: "proxies-to",
            fromId: "gateway-handler:RouteController.route",
            toId: "controller:MonimoAsyncController.jellyPayRes",
            label: "gateway proxies to controller",
            metadata: {
              domains: ["member-auth"],
              subdomains: ["embedded-login"],
              channels: ["monimo"],
              actions: ["action-auth", "action-register"],
              moduleRoles: ["gateway-routing"],
              processRoles: [],
              confidence: 0.85,
              evidencePaths: ["dcp-gateway/src/main/java/com/example/RouteController.java"],
              sourceType: "front-back-graph",
              validatedStatus: "derived"
            },
            attributes: {}
          }
        ]
      },
      retrievalUnits
    });
    const snapshot = buildOntologyProjectionSnapshot({ ontologyGraph });
    const frontBack = snapshot.projections.find((projection) => projection.type === "front-back-flow");

    expect(frontBack?.nodeIds).toEqual(
      expect.arrayContaining([
        "ui-action:src/views/login/MonimoLogin.vue:submitauth",
        "gateway-handler:RouteController.route"
      ])
    );
    expect(frontBack?.edgeIds).toEqual(
      expect.arrayContaining(["edge:ui-action-api", "edge:api-gateway", "edge:gateway-controller"])
    );
  });
});
