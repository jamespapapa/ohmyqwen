import { describe, expect, it } from "vitest";
import { buildOntologyGraphMarkdown, buildOntologyGraphSnapshot } from "../src/server/ontology-graph.js";
import type { KnowledgeSchemaSnapshot } from "../src/server/knowledge-schema.js";
import type { RetrievalUnitSnapshot } from "../src/server/retrieval-units.js";
import { buildProjectFeedbackArtifact } from "../src/server/project-feedback.js";
import type { EvaluationReplaySnapshot } from "../src/server/evaluation-replay.js";
import type { EvaluationPromotionSnapshot } from "../src/server/evaluation-promotions.js";

const knowledgeSchema: KnowledgeSchemaSnapshot = {
  version: 1,
  generatedAt: "2026-03-17T00:00:00.000Z",
  workspaceDir: "/workspace/dcp-services",
  entities: [
    {
      id: "module:dcp-member",
      type: "module",
      label: "dcp-member",
      summary: "member module",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["dcp-member"],
        sourceType: "structure-index",
        validatedStatus: "derived"
      },
      attributes: { moduleName: "dcp-member" }
    },
    {
      id: "route:/mo/login/monimo",
      type: "route",
      label: "monimo route",
      summary: "frontend route",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.85,
        evidencePaths: ["src/router/mo/login/route.js"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { routePath: "/mo/login/monimo" }
    },
    {
      id: "api:/member/monimo/registe",
      type: "api",
      label: "/member/monimo/registe",
      summary: "monimo api",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.9,
        evidencePaths: ["src/views/login/MDP-MYCER999999M.vue"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { normalizedUrl: "/member/monimo/registe" }
    },
    {
      id: "controller:RegisteUseDcpChnelController.registe",
      type: "controller",
      label: "RegisteUseDcpChnelController.registe",
      summary: "backend controller",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.9,
        evidencePaths: ["dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { controllerMethod: "RegisteUseDcpChnelController.registe" }
    },
    {
      id: "service:EmbededMemberLoginService.authenticate",
      type: "service",
      label: "EmbededMemberLoginService.authenticate",
      summary: "login service",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.87,
        evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { serviceMethod: "authenticate" }
    },
    {
      id: "knowledge:candidate:channel:monimo",
      type: "knowledge-cluster",
      label: "monimo channel",
      summary: "monimo channel candidate",
      metadata: {
        domains: [],
        subdomains: [],
        channels: ["monimo"],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.82,
        evidencePaths: ["MDP-MYCER999999M -> /member/monimo/registe"],
        sourceType: "learned-knowledge",
        validatedStatus: "validated"
      },
      attributes: { candidateId: "channel:monimo" }
    }
  ],
  edges: [
    {
      id: "edge:contains:module:dcp-member:route",
      type: "contains",
      fromId: "module:dcp-member",
      toId: "route:/mo/login/monimo",
      label: "module contains route",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["dcp-member"],
        sourceType: "structure-index",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:route-api",
      type: "routes-to",
      fromId: "route:/mo/login/monimo",
      toId: "api:/member/monimo/registe",
      label: "route issues api",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.91,
        evidencePaths: ["src/views/login/MDP-MYCER999999M.vue"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:api-controller",
      type: "routes-to",
      fromId: "api:/member/monimo/registe",
      toId: "controller:RegisteUseDcpChnelController.registe",
      label: "api handled by controller",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.92,
        evidencePaths: ["dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:controller-service",
      type: "calls",
      fromId: "controller:RegisteUseDcpChnelController.registe",
      toId: "service:EmbededMemberLoginService.authenticate",
      label: "controller delegates to service",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.88,
        evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    }
  ],
  summary: {
    entityCount: 6,
    edgeCount: 4,
    entityTypeCounts: { api: 1, controller: 1, "knowledge-cluster": 1, module: 1, route: 1, service: 1 },
    edgeTypeCounts: { calls: 1, contains: 1, "routes-to": 2 },
    validatedClusterCount: 1,
    candidateClusterCount: 0,
    staleClusterCount: 0,
    activeDomainCount: 1,
    topDomains: [{ id: "member-auth", count: 5 }],
    topModules: [{ id: "module:dcp-member", count: 3 }]
  }
};

const retrievalUnits: RetrievalUnitSnapshot = {
  version: 1,
  generatedAt: knowledgeSchema.generatedAt,
  workspaceDir: knowledgeSchema.workspaceDir,
  units: [
    {
      id: "unit:flow:monimo-auth",
      type: "flow",
      title: "monimo auth flow",
      summary: "route -> api -> controller -> service",
      confidence: 0.91,
      validatedStatus: "validated",
      entityIds: [
        "route:/mo/login/monimo",
        "api:/member/monimo/registe",
        "controller:RegisteUseDcpChnelController.registe",
        "service:EmbededMemberLoginService.authenticate"
      ],
      edgeIds: ["edge:route-api", "edge:api-controller", "edge:controller-service"],
      searchText: ["monimo", "회원인증", "embedded-login"],
      domains: ["member-auth"],
      subdomains: ["embedded-login"],
      channels: ["monimo"],
      actions: ["action-check"],
      moduleRoles: [],
      processRoles: [],
      evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"]
    }
  ],
  summary: {
    unitCount: 1,
    unitTypeCounts: { flow: 1 },
    unitStatusCounts: { validated: 1 },
    topDomains: [{ id: "member-auth", count: 1 }],
    topChannels: [{ id: "monimo", count: 1 }],
    topModuleRoles: []
  }
};

describe("ontology graph", () => {
  it("builds ontology nodes from knowledge schema, retrieval units, feedback, and replay", () => {
    const feedback = buildProjectFeedbackArtifact({
      generatedAt: "2026-03-17T00:00:01.000Z",
      projectId: "p1",
      projectName: "dcp",
      kind: "ask",
      prompt: "모니모 회원인증의 흐름을 분석해줘.",
      questionType: "channel_or_partner_integration",
      verdict: "correct",
      scope: "path",
      matchedKnowledgeIds: ["channel:monimo"],
      matchedRetrievalUnitIds: ["unit:flow:monimo-auth"],
      targets: [
        {
          kind: "path",
          label: "monimo auth critical path",
          nodeIds: ["route:/mo/login/monimo", "controller:RegisteUseDcpChnelController.registe"],
          edgeIds: ["edge:route-api", "edge:controller-service"]
        }
      ],
      notes: "정답"
    });

    const replay: EvaluationReplaySnapshot = {
      version: 1,
      generatedAt: "2026-03-17T00:00:02.000Z",
      summary: {
        totalArtifacts: 1,
        askCount: 1,
        searchCount: 0,
        failedAskCount: 0,
        staleBackedCount: 0,
        topQuestionTypes: [{ id: "channel_or_partner_integration", count: 1 }],
        topFailureCodes: [],
        averageRetrievalCoverage: 72,
        averageQualityRisk: 18
      },
      replayCandidates: [
        {
          kind: "ask",
          projectId: "p1",
          projectName: "dcp",
          questionOrQuery: "모니모 회원인증의 흐름을 분석해줘.",
          questionType: "channel_or_partner_integration",
          score: 64,
          reasons: ["manual-replay"],
          generatedAt: "2026-03-17T00:00:02.000Z"
        }
      ]
    };

    const promotions: EvaluationPromotionSnapshot = {
      version: 1,
      generatedAt: "2026-03-17T00:00:02.000Z",
      summary: {
        totalActions: 1,
        promoteCount: 1,
        staleCount: 0,
        candidateCount: 0,
        highestPriorityCandidateId: "channel:monimo"
      },
      actions: [
        {
          candidateId: "channel:monimo",
          currentStatus: "candidate",
          targetStatus: "validated",
          score: 95,
          reasons: ["feedback:correct"],
          confidence: 0.95
        }
      ]
    };

    const snapshot = buildOntologyGraphSnapshot({
      knowledgeSchema,
      retrievalUnits,
      feedbackArtifacts: [feedback],
      evaluationReplay: replay,
      evaluationPromotions: promotions
    });

    expect(snapshot.summary.nodeCount).toBeGreaterThan(knowledgeSchema.summary.entityCount);
    expect(snapshot.summary.feedbackNodeCount).toBe(1);
    expect(snapshot.summary.replayNodeCount).toBe(1);
    expect(snapshot.summary.pathNodeCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.nodes.some((node) => node.id === "retrieval-unit:unit:flow:monimo-auth")).toBe(true);
    expect(snapshot.nodes.some((node) => node.type === "feedback-record")).toBe(true);
    expect(snapshot.edges.some((edge) => edge.type === "targets-path")).toBe(true);
    expect(snapshot.summary.topChannels[0]?.id).toBe("monimo");

    const markdown = buildOntologyGraphMarkdown(snapshot);
    expect(markdown).toContain("# Ontology Graph");
    expect(markdown).toContain("feedbackNodeCount: 1");
  });
});
