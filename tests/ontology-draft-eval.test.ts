import { describe, expect, it } from "vitest";
import { buildOntologyDraftSnapshot } from "../src/server/ontology-drafts.js";
import { buildOntologyDraftEvaluationSnapshot } from "../src/server/ontology-draft-eval.js";
import { OntologyGraphSnapshotSchema } from "../src/server/ontology-graph.js";
import { buildProjectAskEvaluationArtifact } from "../src/server/evaluation-artifacts.js";

describe("ontology draft evaluation", () => {
  it("flags regression when a touched validated node becomes deprecated", () => {
    const baseGraph = OntologyGraphSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-17T11:00:00.000Z",
      workspaceDir: "/workspace",
      nodes: [
        {
          id: "controller:MonimoController.login",
          type: "controller",
          label: "MonimoController.login",
          summary: "auth path",
          metadata: {
            domains: ["member-auth"],
            subdomains: [],
            channels: ["monimo"],
            actions: ["action-auth"],
            moduleRoles: [],
            processRoles: [],
            confidence: 0.9,
            evidencePaths: ["src/MonimoController.java"],
            sourceType: "ontology-review",
            validatedStatus: "validated"
          },
          attributes: {}
        }
      ],
      edges: [],
      summary: {
        nodeCount: 1,
        edgeCount: 0,
        nodeTypeCounts: { controller: 1 },
        edgeTypeCounts: {},
        feedbackNodeCount: 0,
        replayNodeCount: 0,
        pathNodeCount: 0,
        validatedNodeCount: 1,
        candidateNodeCount: 0,
        staleNodeCount: 0,
        contestedNodeCount: 0,
        deprecatedNodeCount: 0,
        topDomains: [{ id: "member-auth", count: 1 }],
        topChannels: [{ id: "monimo", count: 1 }]
      }
    });

    const artifact = buildProjectAskEvaluationArtifact({
      generatedAt: "2026-03-17T11:01:00.000Z",
      projectId: "p1",
      projectName: "demo",
      question: "모니모 회원 인증 로직이 어떻게 구현되는지 분석해줘",
      strategyType: "channel_or_partner_integration",
      questionType: "channel_or_partner_integration",
      confidence: 0.81,
      qualityGatePassed: true,
      attempts: 1,
      llmCallCount: 2,
      retrievalProvider: "qmd",
      retrievalFallbackUsed: false,
      retrievalHitCount: 4,
      retrievalTopConfidence: 0.83,
      matchedRetrievalUnitIds: ["unit:flow:monimo-auth"],
      matchedRetrievalUnitStatuses: ["validated"],
      matchedOntologyNodeIds: ["controller:MonimoController.login"],
      matchedOntologyNodeStatuses: ["validated"],
      matchedOntologyProjectionIds: ["projection:integration"],
      evidenceCount: 2,
      caveatCount: 0,
      hydratedEvidenceCount: 1,
      linkedFlowEvidenceCount: 1,
      linkedEaiEvidenceCount: 0,
      downstreamTraceCount: 0
    });

    const draft = buildOntologyDraftSnapshot({
      generatedAt: "2026-03-17T11:02:00.000Z",
      projectId: "p1",
      projectName: "demo",
      draftVersion: 2,
      basedOnOntologyGeneratedAt: baseGraph.generatedAt,
      operations: [
        {
          id: "op1",
          createdAt: "2026-03-17T11:02:00.000Z",
          kind: "override-node",
          targetId: "controller:MonimoController.login",
          metadata: {
            validatedStatus: "deprecated"
          }
        }
      ]
    });

    const evaluation = buildOntologyDraftEvaluationSnapshot({
      generatedAt: "2026-03-17T11:03:00.000Z",
      projectId: "p1",
      projectName: "demo",
      baseGraph,
      draft,
      evaluationArtifacts: [artifact]
    });

    expect(evaluation.metrics.affectedArtifactCount).toBe(1);
    expect(evaluation.metrics.regressedArtifactCount).toBe(1);
    expect(evaluation.metrics.replayCandidateDelta).toBeGreaterThanOrEqual(1);
    expect(["review", "revert"]).toContain(evaluation.summary.recommendation);
  });

  it("keeps low risk when a touched node is strengthened to validated", () => {
    const baseGraph = OntologyGraphSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-17T11:00:00.000Z",
      workspaceDir: "/workspace",
      nodes: [
        {
          id: "data-store:redis",
          type: "data-store",
          label: "redis",
          summary: "session store",
          metadata: {
            domains: [],
            subdomains: [],
            channels: [],
            actions: ["action-state-store"],
            moduleRoles: [],
            processRoles: [],
            confidence: 0.72,
            evidencePaths: ["src/RedisSessionSupport.java"],
            sourceType: "knowledge-schema",
            validatedStatus: "candidate"
          },
          attributes: {}
        }
      ],
      edges: [],
      summary: {
        nodeCount: 1,
        edgeCount: 0,
        nodeTypeCounts: { "data-store": 1 },
        edgeTypeCounts: {},
        feedbackNodeCount: 0,
        replayNodeCount: 0,
        pathNodeCount: 0,
        validatedNodeCount: 0,
        candidateNodeCount: 1,
        staleNodeCount: 0,
        contestedNodeCount: 0,
        deprecatedNodeCount: 0,
        topDomains: [],
        topChannels: []
      }
    });

    const artifact = buildProjectAskEvaluationArtifact({
      generatedAt: "2026-03-17T11:01:00.000Z",
      projectId: "p1",
      projectName: "demo",
      question: "redis 세션 정보는 어떤 값들이 저장되나",
      strategyType: "config_resource",
      questionType: "state_store_schema",
      confidence: 0.44,
      qualityGatePassed: false,
      attempts: 1,
      llmCallCount: 2,
      retrievalProvider: "qmd",
      retrievalFallbackUsed: false,
      retrievalHitCount: 2,
      retrievalTopConfidence: 0.52,
      matchedRetrievalUnitIds: ["unit:resource-schema:redis"],
      matchedRetrievalUnitStatuses: ["candidate"],
      matchedOntologyNodeIds: ["data-store:redis"],
      matchedOntologyNodeStatuses: ["candidate"],
      matchedOntologyProjectionIds: ["projection:integration"],
      qualityGateFailures: ["missing-store-schema-detail"],
      evidenceCount: 1,
      caveatCount: 1,
      hydratedEvidenceCount: 0,
      linkedFlowEvidenceCount: 0,
      linkedEaiEvidenceCount: 0,
      downstreamTraceCount: 0
    });

    const draft = buildOntologyDraftSnapshot({
      generatedAt: "2026-03-17T11:02:00.000Z",
      projectId: "p1",
      projectName: "demo",
      draftVersion: 2,
      basedOnOntologyGeneratedAt: baseGraph.generatedAt,
      operations: [
        {
          id: "op1",
          createdAt: "2026-03-17T11:02:00.000Z",
          kind: "override-node",
          targetId: "data-store:redis",
          metadata: {
            validatedStatus: "validated",
            actions: ["action-state-store", "action-read"]
          }
        }
      ]
    });

    const evaluation = buildOntologyDraftEvaluationSnapshot({
      generatedAt: "2026-03-17T11:03:00.000Z",
      projectId: "p1",
      projectName: "demo",
      baseGraph,
      draft,
      evaluationArtifacts: [artifact]
    });

    expect(evaluation.metrics.improvedArtifactCount).toBe(1);
    expect(evaluation.metrics.regressedArtifactCount).toBe(0);
    expect(evaluation.summary.recommendation).toBe("keep");
  });
});
