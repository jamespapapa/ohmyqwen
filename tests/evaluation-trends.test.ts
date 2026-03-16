import { describe, expect, it } from "vitest";
import {
  buildProjectAskEvaluationArtifact,
  buildProjectSearchEvaluationArtifact
} from "../src/server/evaluation-artifacts.js";
import {
  buildEvaluationTrendMarkdown,
  buildEvaluationTrendSnapshot
} from "../src/server/evaluation-trends.js";

describe("evaluation trends", () => {
  it("summarizes typed retrieval trends across ask and search artifacts", () => {
    const artifacts = [
      buildProjectAskEvaluationArtifact({
        generatedAt: "2026-03-16T00:00:01.000Z",
        projectId: "proj-1",
        projectName: "demo",
        question: "모니모 회원인증 흐름",
        strategyType: "cross_layer_flow",
        questionType: "channel_or_partner_integration",
        confidence: 0.42,
        qualityGatePassed: false,
        attempts: 2,
        llmCallCount: 2,
        retrievalProvider: "qmd",
        retrievalFallbackUsed: true,
        retrievalHitCount: 3,
        retrievalTopConfidence: 0.48,
        matchedRetrievalUnitIds: ["flow:monimo-auth", "module:member-auth"],
        matchedRetrievalUnitStatuses: ["candidate", "stale"],
        qualityGateFailures: ["missing-channel-boundary-detail"],
        evidenceCount: 2,
        caveatCount: 2,
        hydratedEvidenceCount: 1,
        linkedFlowEvidenceCount: 1,
        linkedEaiEvidenceCount: 0,
        downstreamTraceCount: 0
      }),
      buildProjectSearchEvaluationArtifact({
        generatedAt: "2026-03-16T00:00:02.000Z",
        projectId: "proj-1",
        projectName: "demo",
        query: "모니모 회원인증",
        questionType: "channel_or_partner_integration",
        questionTypeConfidence: 0.91,
        provider: "qmd",
        fallbackUsed: false,
        hitCount: 5,
        topConfidence: 0.71,
        matchedRetrievalUnitIds: ["flow:monimo-auth"],
        matchedRetrievalUnitStatuses: ["validated"]
      }),
      buildProjectAskEvaluationArtifact({
        generatedAt: "2026-03-16T00:00:03.000Z",
        projectId: "proj-1",
        projectName: "demo",
        question: "dcp-async 프로젝트 역할",
        strategyType: "architecture_overview",
        questionType: "module_role_explanation",
        confidence: 0.73,
        qualityGatePassed: true,
        attempts: 1,
        llmCallCount: 1,
        retrievalProvider: "lexical",
        retrievalFallbackUsed: false,
        retrievalHitCount: 4,
        retrievalTopConfidence: 0.64,
        matchedRetrievalUnitIds: ["module:dcp-async"],
        matchedRetrievalUnitStatuses: ["validated"],
        qualityGateFailures: [],
        evidenceCount: 4,
        caveatCount: 1,
        hydratedEvidenceCount: 2,
        linkedFlowEvidenceCount: 0,
        linkedEaiEvidenceCount: 0,
        downstreamTraceCount: 1
      })
    ];

    const snapshot = buildEvaluationTrendSnapshot({
      generatedAt: "2026-03-16T00:10:00.000Z",
      artifacts
    });

    expect(snapshot.summary.totalArtifacts).toBe(3);
    expect(snapshot.summary.askCount).toBe(2);
    expect(snapshot.summary.searchCount).toBe(1);
    expect(snapshot.summary.questionTypeCount).toBe(2);
    expect(snapshot.summary.highestRiskQuestionType).toBe("channel_or_partner_integration");
    expect(snapshot.summary.strongestCoverageQuestionType).toBe("module_role_explanation");

    const channelEntry = snapshot.byQuestionType.find((entry) => entry.questionType === "channel_or_partner_integration");
    expect(channelEntry).toBeTruthy();
    expect(channelEntry?.total).toBe(2);
    expect(channelEntry?.qmdCount).toBe(2);
    expect(channelEntry?.staleBackedCount).toBe(1);
    expect(channelEntry?.failedAskCount).toBe(1);

    const moduleEntry = snapshot.byQuestionType.find((entry) => entry.questionType === "module_role_explanation");
    expect(moduleEntry?.lexicalCount).toBe(1);
    expect(moduleEntry?.averageQualityRisk).toBeLessThan(channelEntry?.averageQualityRisk ?? 100);
  });

  it("renders trend markdown with summary and question-type rows", () => {
    const snapshot = buildEvaluationTrendSnapshot({
      generatedAt: "2026-03-16T00:10:00.000Z",
      artifacts: [
        buildProjectSearchEvaluationArtifact({
          generatedAt: "2026-03-16T00:00:02.000Z",
          projectId: "proj-1",
          projectName: "demo",
          query: "배치 처리 흐름",
          questionType: "process_or_batch_trace",
          questionTypeConfidence: 0.88,
          provider: "qmd",
          fallbackUsed: false,
          hitCount: 3,
          topConfidence: 0.66,
          matchedRetrievalUnitIds: ["process:batch-job"],
          matchedRetrievalUnitStatuses: ["derived"]
        })
      ]
    });

    const markdown = buildEvaluationTrendMarkdown(snapshot);
    expect(markdown).toContain("# Evaluation Trends");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## By Question Type");
    expect(markdown).toContain("process_or_batch_trace");
  });
});
