import { describe, expect, it } from "vitest";
import {
  buildEvaluationArtifactMarkdown,
  buildProjectAskEvaluationArtifact,
  buildProjectSearchEvaluationArtifact,
  summarizeRetrievalUnitStatuses
} from "../src/server/evaluation-artifacts.js";

describe("evaluation artifacts", () => {
  it("summarizes retrieval unit lifecycle statuses", () => {
    const summary = summarizeRetrievalUnitStatuses(["validated", "derived", "stale", "validated", "candidate"]);

    expect(summary.total).toBe(5);
    expect(summary.validated).toBe(2);
    expect(summary.derived).toBe(1);
    expect(summary.candidate).toBe(1);
    expect(summary.stale).toBe(1);
  });

  it("builds ask evaluation metrics with stale-aware risk scoring", () => {
    const artifact = buildProjectAskEvaluationArtifact({
      generatedAt: "2026-03-16T00:00:00.000Z",
      projectId: "project-1",
      projectName: "dcp-services",
      question: "모니모 회원인증은 어떻게 연동되는지 설명해줘.",
      strategyType: "cross_layer_flow",
      questionType: "channel_or_partner_integration",
      confidence: 0.72,
      qualityGatePassed: false,
      attempts: 2,
      llmCallCount: 2,
      retrievalProvider: "qmd",
      retrievalFallbackUsed: false,
      retrievalHitCount: 6,
      retrievalTopConfidence: 0.84,
      plannedQuery: "모니모 회원인증 callback bridge RegisteUseDcpChnelController",
      matchedRetrievalUnitIds: ["unit:flow:monimo", "unit:knowledge:channel:monimo"],
      matchedRetrievalUnitStatuses: ["validated", "stale"],
      matchedKnowledgeIds: ["channel:monimo"],
      qualityGateFailures: ["missing-channel-boundary-detail"],
      canonicalFlowCount: 2,
      droppedIncoherentFlowCount: 1,
      canonicalNamespaceCount: 2,
      retryStopReason: "low-confidence-gain",
      evidenceCount: 3,
      caveatCount: 1,
      hydratedEvidenceCount: 2,
      linkedFlowEvidenceCount: 1,
      linkedEaiEvidenceCount: 0,
      downstreamTraceCount: 0
    });

    expect(artifact.kind).toBe("ask");
    expect(artifact.metrics.retrievalUnitStatuses.validated).toBe(1);
    expect(artifact.metrics.retrievalUnitStatuses.stale).toBe(1);
    expect(artifact.metrics.retrievalCoverageScore).toBeGreaterThan(0);
    expect(artifact.metrics.qualityRiskScore).toBeGreaterThan(0);
    expect(artifact.qualityGateFailures).toContain("missing-channel-boundary-detail");
    expect(artifact.droppedIncoherentFlowCount).toBe(1);
    expect(artifact.canonicalNamespaceCount).toBe(2);
  });

  it("builds search evaluation metrics and markdown summary", () => {
    const artifact = buildProjectSearchEvaluationArtifact({
      generatedAt: "2026-03-16T00:00:00.000Z",
      projectId: "project-1",
      projectName: "dcp-services",
      query: "dcp-async 프로젝트는 어떤 역할을 하는가?",
      questionType: "module_role_explanation",
      questionTypeConfidence: 0.91,
      questionTypeReason: "module name plus role phrasing",
      provider: "lexical",
      fallbackUsed: true,
      hitCount: 4,
      topConfidence: 0.62,
      plannedQuery: "dcp-async 역할 responsibility dispatcher processor",
      matchedRetrievalUnitIds: ["unit:module:module:dcp-async", "unit:knowledge:knowledge:candidate:module:dcp-async"],
      matchedRetrievalUnitStatuses: ["validated", "candidate"]
    });

    expect(artifact.kind).toBe("search");
    expect(artifact.metrics.retrievalUnitStatuses.candidate).toBe(1);
    expect(artifact.metrics.retrievalCoverageScore).toBeGreaterThan(0);

    const markdown = buildEvaluationArtifactMarkdown(artifact);
    expect(markdown).toContain("# Evaluation Artifact");
    expect(markdown).toContain("kind: search");
    expect(markdown).toContain("questionType: module_role_explanation");
  });
});
