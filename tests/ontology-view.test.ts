import { describe, expect, it } from "vitest";
import { buildOntologyViewerPayload } from "../src/server/ontology-view.js";
import { buildOntologyGraphSnapshot } from "../src/server/ontology-graph.js";
import { buildOntologyProjectionSnapshot } from "../src/server/ontology-projections.js";
import type { KnowledgeSchemaSnapshot } from "../src/server/knowledge-schema.js";
import type { RetrievalUnitSnapshot } from "../src/server/retrieval-units.js";

const knowledgeSchema: KnowledgeSchemaSnapshot = {
  version: 1,
  generatedAt: "2026-03-18T00:00:00.000Z",
  workspaceDir: "/workspace/demo",
  entities: [
    {
      id: "route:/insurance/claim",
      type: "route",
      label: "claim route",
      summary: "front route",
      metadata: {
        domains: ["insurance-benefit-claim"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["web/src/router.js"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { routePath: "/insurance/claim" }
    },
    {
      id: "api:/gw/api/insurance/claim/spotSave",
      type: "api",
      label: "spotSave api",
      summary: "gw api",
      metadata: {
        domains: ["insurance-benefit-claim"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.82,
        evidencePaths: ["web/src/api.js"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { normalizedUrl: "/gw/api/insurance/claim/spotSave" }
    },
    {
      id: "controller:ClaimController.spotSave",
      type: "controller",
      label: "ClaimController.spotSave",
      summary: "claim controller",
      metadata: {
        domains: ["insurance-benefit-claim"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.86,
        evidencePaths: ["src/ClaimController.java"],
        sourceType: "front-back-graph",
        validatedStatus: "validated"
      },
      attributes: { controllerMethod: "ClaimController.spotSave" }
    },
    {
      id: "service:ClaimService.spotSave",
      type: "service",
      label: "ClaimService.spotSave",
      summary: "claim service",
      metadata: {
        domains: ["insurance-benefit-claim"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.88,
        evidencePaths: ["src/ClaimService.java"],
        sourceType: "derived",
        validatedStatus: "validated"
      },
      attributes: { serviceMethod: "ClaimService.spotSave" }
    },
    {
      id: "data-query:ClaimMapper.insertClaim",
      type: "data-query",
      label: "ClaimMapper.insertClaim",
      summary: "insert query",
      metadata: {
        domains: ["insurance-benefit-claim"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.75,
        evidencePaths: ["src/ClaimMapper.xml"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { queryName: "insertClaim" }
    },
    {
      id: "data-table:TB_CLAIM",
      type: "data-table",
      label: "TB_CLAIM",
      summary: "claim table",
      metadata: {
        domains: ["insurance-benefit-claim"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.7,
        evidencePaths: ["src/ClaimMapper.xml"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { tableName: "TB_CLAIM" }
    },
    {
      id: "service:LoanNoiseService.apply",
      type: "service",
      label: "LoanNoiseService.apply",
      summary: "noise service",
      metadata: {
        domains: ["loan"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.4,
        evidencePaths: ["src/LoanNoiseService.java"],
        sourceType: "derived",
        validatedStatus: "candidate"
      },
      attributes: { serviceMethod: "LoanNoiseService.apply" }
    }
  ],
  edges: [
    {
      id: "edge:route-api",
      type: "routes-to",
      fromId: "route:/insurance/claim",
      toId: "api:/gw/api/insurance/claim/spotSave",
      label: "route api",
      metadata: {
        domains: ["insurance-benefit-claim"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["web/src/router.js"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:api-controller",
      type: "routes-to",
      fromId: "api:/gw/api/insurance/claim/spotSave",
      toId: "controller:ClaimController.spotSave",
      label: "api controller",
      metadata: {
        domains: ["insurance-benefit-claim"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.84,
        evidencePaths: ["src/ClaimController.java"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:controller-service",
      type: "calls",
      fromId: "controller:ClaimController.spotSave",
      toId: "service:ClaimService.spotSave",
      label: "controller service",
      metadata: {
        domains: ["insurance-benefit-claim"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.88,
        evidencePaths: ["src/ClaimController.java"],
        sourceType: "derived",
        validatedStatus: "validated"
      },
      attributes: {}
    },
    {
      id: "edge:service-query",
      type: "transitions-to",
      fromId: "service:ClaimService.spotSave",
      toId: "data-query:ClaimMapper.insertClaim",
      label: "service query",
      metadata: {
        domains: ["insurance-benefit-claim"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.77,
        evidencePaths: ["src/ClaimService.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:query-table",
      type: "queries-table",
      fromId: "data-query:ClaimMapper.insertClaim",
      toId: "data-table:TB_CLAIM",
      label: "query table",
      metadata: {
        domains: ["insurance-benefit-claim"],
        subdomains: [],
        channels: [],
        actions: ["action-write"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.76,
        evidencePaths: ["src/ClaimMapper.xml"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    }
  ],
  summary: {
    entityCount: 7,
    edgeCount: 5,
    entityTypeCounts: { route: 1, api: 1, controller: 1, service: 2, "data-query": 1, "data-table": 1 },
    edgeTypeCounts: { "routes-to": 2, calls: 1, "transitions-to": 1, "queries-table": 1 },
    validatedClusterCount: 0,
    candidateClusterCount: 0,
    staleClusterCount: 0,
    activeDomainCount: 1,
    topDomains: [{ id: "insurance-benefit-claim", count: 6 }],
    topModules: []
  }
};

const retrievalUnits: RetrievalUnitSnapshot = {
  version: 1,
  generatedAt: knowledgeSchema.generatedAt,
  workspaceDir: knowledgeSchema.workspaceDir,
  units: [
    {
      id: "unit:flow:claim-spotsave",
      type: "flow",
      title: "claim spotSave flow",
      summary: "route to service",
      confidence: 0.92,
      validatedStatus: "validated",
      entityIds: [
        "route:/insurance/claim",
        "api:/gw/api/insurance/claim/spotSave",
        "controller:ClaimController.spotSave",
        "service:ClaimService.spotSave",
        "data-query:ClaimMapper.insertClaim"
      ],
      edgeIds: ["edge:route-api", "edge:api-controller", "edge:controller-service", "edge:service-query"],
      searchText: ["insurance claim", "spotsave", "claim controller"],
      domains: ["insurance-benefit-claim"],
      subdomains: [],
      channels: [],
      actions: ["action-write"],
      moduleRoles: [],
      processRoles: [],
      evidencePaths: ["src/ClaimController.java"]
    }
  ],
  summary: {
    unitCount: 1,
    unitTypeCounts: { flow: 1 },
    unitStatusCounts: { validated: 1 },
    topDomains: [{ id: "insurance-benefit-claim", count: 1 }],
    topChannels: [],
    topModuleRoles: []
  }
};

describe("buildOntologyViewerPayload", () => {
  it("returns projection-scoped node and edge detail for viewer", () => {
    const graph = buildOntologyGraphSnapshot({
      knowledgeSchema,
      retrievalUnits,
      feedbackArtifacts: [],
      ontologyInputs: undefined,
      ontologyReview: undefined,
      evaluationReplay: undefined,
      evaluationPromotions: undefined
    });
    const projections = buildOntologyProjectionSnapshot({ ontologyGraph: graph });

    const payload = buildOntologyViewerPayload({
      graph,
      projections,
      memoryRoot: "/workspace/.ohmyqwen/memory",
      graphSnapshotPath: "/workspace/.ohmyqwen/memory/ontology-graph/latest.json",
      projectionSnapshotPath: "/workspace/.ohmyqwen/memory/ontology-projections/latest.json",
      analysisSnapshotPath: "/workspace/.ohmyqwen/memory/project-analysis/latest.json",
      selectedProjectionId: "projection:front-back-flow",
      nodeLimit: 5,
      edgeLimit: 5
    });

    expect(payload.storage.kind).toBe("filesystem-artifacts");
    expect(payload.selectedProjection.id).toBe("projection:front-back-flow");
    expect(payload.selectedProjection.nodes.length).toBeGreaterThan(0);
    expect(payload.selectedProjection.edges.length).toBeGreaterThan(0);
    expect(payload.selectedProjection.representativePaths[0]?.label).toContain("claim spotSave flow");
    expect(payload.selectedProjection.availableNodeTypes).toContain("service");
  });

  it("supports type/search filtering while keeping visible node counts bounded", () => {
    const graph = buildOntologyGraphSnapshot({
      knowledgeSchema,
      retrievalUnits,
      feedbackArtifacts: [],
      ontologyInputs: undefined,
      ontologyReview: undefined,
      evaluationReplay: undefined,
      evaluationPromotions: undefined
    });
    const projections = buildOntologyProjectionSnapshot({ ontologyGraph: graph });

    const payload = buildOntologyViewerPayload({
      graph,
      projections,
      memoryRoot: "/workspace/.ohmyqwen/memory",
      graphSnapshotPath: "/workspace/.ohmyqwen/memory/ontology-graph/latest.json",
      projectionSnapshotPath: "/workspace/.ohmyqwen/memory/ontology-projections/latest.json",
      analysisSnapshotPath: "/workspace/.ohmyqwen/memory/project-analysis/latest.json",
      selectedProjectionId: "projection:front-back-flow",
      nodeType: "service",
      search: "claim",
      nodeLimit: 1,
      edgeLimit: 1
    });

    expect(payload.filters.nodeType).toBe("service");
    expect(payload.selectedProjection.nodes).toHaveLength(1);
    expect(payload.selectedProjection.nodes[0]?.id).toBe("service:ClaimService.spotSave");
    expect(payload.selectedProjection.hiddenNodeCount).toBeGreaterThanOrEqual(0);
    expect(payload.selectedProjection.edges.length).toBeLessThanOrEqual(1);
  });


  it("preserves connected edges when visible nodes are heavily compacted", () => {
    const noisySchema: KnowledgeSchemaSnapshot = {
      ...knowledgeSchema,
      entities: [
        ...knowledgeSchema.entities,
        ...Array.from({ length: 20 }, (_, index) => ({
          id: `service:NoiseService${index}.run`,
          type: "service" as const,
          label: `NoiseService${index}.run`,
          summary: "isolated noise service",
          metadata: {
            domains: ["noise"],
            subdomains: [],
            channels: [],
            actions: ["action-write"],
            moduleRoles: [],
            processRoles: [],
            confidence: 0.95,
            evidencePaths: [`src/NoiseService${index}.java`],
            sourceType: "derived" as const,
            validatedStatus: "validated" as const
          },
          attributes: { serviceMethod: `NoiseService${index}.run` }
        }))
      ],
      summary: {
        ...knowledgeSchema.summary,
        entityCount: knowledgeSchema.entities.length + 20,
        entityTypeCounts: {
          ...knowledgeSchema.summary.entityTypeCounts,
          service: (knowledgeSchema.summary.entityTypeCounts.service ?? 0) + 20
        }
      }
    };

    const graph = buildOntologyGraphSnapshot({
      knowledgeSchema: noisySchema,
      retrievalUnits: { ...retrievalUnits, units: [] },
      feedbackArtifacts: [],
      ontologyInputs: undefined,
      ontologyReview: undefined,
      evaluationReplay: undefined,
      evaluationPromotions: undefined
    });

    const projectionNodeIds = [
      "route:/insurance/claim",
      "api:/gw/api/insurance/claim/spotSave",
      "controller:ClaimController.spotSave",
      "service:ClaimService.spotSave",
      ...Array.from({ length: 20 }, (_, index) => `service:NoiseService${index}.run`)
    ];
    const projectionEdgeIds = ["edge:route-api", "edge:api-controller", "edge:controller-service"];

    const projections = {
      version: 1 as const,
      generatedAt: graph.generatedAt,
      workspaceDir: graph.workspaceDir,
      projections: [
        {
          id: "projection:front-back-flow",
          type: "front-back-flow" as const,
          title: "Front to Back Flow",
          summary: "edge preservation",
          nodeIds: projectionNodeIds,
          edgeIds: projectionEdgeIds,
          representativePaths: [],
          statusCounts: { validated: 21, derived: 3 },
          highlightedNodeIds: [],
          highlightedEdgeIds: []
        }
      ],
      summary: {
        projectionCount: 1,
        truncated: false,
        appliedLimits: [],
        projectionTypeCounts: { "front-back-flow": 1 },
        topProjectionTypes: [{ id: "front-back-flow", count: 1 }],
        totalRepresentativePathCount: 0,
        largestProjectionType: "front-back-flow",
        lifecycleProjectionPathCount: 0
      }
    };

    const payload = buildOntologyViewerPayload({
      graph,
      projections,
      memoryRoot: "/workspace/.ohmyqwen/memory",
      graphSnapshotPath: "/workspace/.ohmyqwen/memory/ontology-graph/latest.json",
      projectionSnapshotPath: "/workspace/.ohmyqwen/memory/ontology-projections/latest.json",
      analysisSnapshotPath: "/workspace/.ohmyqwen/memory/project-analysis/latest.json",
      selectedProjectionId: "projection:front-back-flow",
      nodeLimit: 6,
      edgeLimit: 4
    });

    expect(payload.selectedProjection.nodes.length).toBe(payload.filters.nodeLimit);
    expect(payload.selectedProjection.edges.length).toBeGreaterThan(0);
    expect(payload.selectedProjection.nodes.some((node) => node.id === "route:/insurance/claim")).toBe(true);
    expect(payload.selectedProjection.nodes.some((node) => node.id === "api:/gw/api/insurance/claim/spotSave")).toBe(true);
  });
});
