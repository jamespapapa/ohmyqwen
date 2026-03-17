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
    }
  ],
  summary: {
    entityCount: 5,
    edgeCount: 3,
    entityTypeCounts: { api: 1, controller: 1, "eai-interface": 1, module: 1, route: 1 },
    edgeTypeCounts: { "routes-to": 2, "uses-eai": 1 },
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
      entityIds: ["route:/monimo/callback", "api:/monimo/jellyPayRes", "controller:MonimoAsyncController.jellyPayRes"],
      edgeIds: ["edge:route-api", "edge:api-controller"],
      searchText: ["monimo", "callback"],
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
    const integration = snapshot.projections.find((projection) => projection.type === "integration");
    expect(integration?.representativePaths.length).toBeGreaterThan(0);

    const markdown = buildOntologyProjectionMarkdown(snapshot);
    expect(markdown).toContain("# Ontology Projections");
    expect(markdown).toContain("projectionCount: 4");
  });
});
