import { describe, expect, it } from "vitest";
import {
  buildEvaluationReplayMarkdown,
  buildEvaluationReplaySnapshot
} from "../src/server/evaluation-replay.js";
import {
  buildProjectAskEvaluationArtifact,
  buildProjectSearchEvaluationArtifact
} from "../src/server/evaluation-artifacts.js";

describe("evaluation replay automation", () => {
  it("summarizes recent ask/search evaluation artifacts into replay metrics and candidates", () => {
    const artifacts = [
      buildProjectAskEvaluationArtifact({
        generatedAt: "2026-03-16T01:00:00.000Z",
        projectId: "p1",
        projectName: "dcp-services",
        question: "모니모 회원인증은 어떻게 연동되는지 설명해줘.",
        strategyType: "cross_layer_flow",
        questionType: "channel_or_partner_integration",
        confidence: 0.41,
        qualityGatePassed: false,
        attempts: 3,
        llmCallCount: 4,
        retrievalProvider: "qmd",
        retrievalFallbackUsed: false,
        retrievalHitCount: 5,
        retrievalTopConfidence: 0.63,
        plannedQuery: "모니모 회원인증 callback bridge",
        matchedRetrievalUnitIds: ["unit:flow:monimo"],
        matchedRetrievalUnitStatuses: ["stale"],
        matchedOntologyNodeIds: ["controller:RegisteUseDcpChnelController.registe"],
        matchedOntologyNodeStatuses: ["contested"],
        matchedOntologyProjectionIds: ["projection:integration"],
        matchedKnowledgeIds: ["channel:monimo"],
        qualityGateFailures: ["missing-channel-boundary-detail", "stale-retrieval-only"],
        canonicalFlowCount: 1,
        droppedIncoherentFlowCount: 2,
        canonicalNamespaceCount: 2,
        retryStopReason: "low-confidence-gain",
        evidenceCount: 2,
        caveatCount: 1,
        hydratedEvidenceCount: 1,
        linkedFlowEvidenceCount: 1,
        linkedEaiEvidenceCount: 0,
        downstreamTraceCount: 0
      }),
      buildProjectAskEvaluationArtifact({
        generatedAt: "2026-03-16T01:10:00.000Z",
        projectId: "p1",
        projectName: "dcp-services",
        question: "dcp-async 프로젝트는 어떤 역할을 하는 것인가?",
        strategyType: "architecture_overview",
        questionType: "module_role_explanation",
        confidence: 0.82,
        qualityGatePassed: true,
        attempts: 1,
        llmCallCount: 1,
        retrievalProvider: "qmd",
        retrievalFallbackUsed: false,
        retrievalHitCount: 7,
        retrievalTopConfidence: 0.88,
        plannedQuery: "dcp-async role dispatcher queue processor",
        matchedRetrievalUnitIds: ["unit:module:dcp-async"],
        matchedRetrievalUnitStatuses: ["validated"],
        matchedKnowledgeIds: ["module:dcp-async"],
        qualityGateFailures: [],
        evidenceCount: 3,
        caveatCount: 0,
        hydratedEvidenceCount: 2,
        linkedFlowEvidenceCount: 0,
        linkedEaiEvidenceCount: 0,
        downstreamTraceCount: 0
      }),
      buildProjectSearchEvaluationArtifact({
        generatedAt: "2026-03-16T01:20:00.000Z",
        projectId: "p1",
        projectName: "dcp-services",
        query: "IRP가입 로직",
        questionType: "business_capability_trace",
        questionTypeConfidence: 0.84,
        questionTypeReason: "capability question",
        provider: "lexical",
        fallbackUsed: true,
        hitCount: 2,
        topConfidence: 0.37,
        plannedQuery: "IRP가입 join apply contract",
        matchedOntologyNodeIds: ["service:DisplayBoardContentService.selectClassList"],
        matchedOntologyNodeStatuses: ["deprecated"],
        matchedOntologyProjectionIds: ["projection:front-back-flow"],
        matchedRetrievalUnitIds: ["unit:knowledge:irp-join"],
        matchedRetrievalUnitStatuses: ["candidate"]
      })
    ];

    const replay = buildEvaluationReplaySnapshot({
      generatedAt: "2026-03-16T02:00:00.000Z",
      artifacts,
      limit: 50
    });

    expect(replay.summary.totalArtifacts).toBe(3);
    expect(replay.summary.askCount).toBe(2);
    expect(replay.summary.searchCount).toBe(1);
    expect(replay.summary.failedAskCount).toBe(1);
    expect(replay.summary.staleBackedCount).toBe(1);
    expect(replay.summary.ontologyContestedBackedCount).toBe(1);
    expect(replay.summary.ontologyDeprecatedBackedCount).toBe(1);
    expect(replay.summary.topQuestionTypes.map((item) => item.id)).toContain("channel_or_partner_integration");
    expect(replay.summary.topFailureCodes.some((item) => item.id === "stale-retrieval-only")).toBe(true);
    expect(replay.replayCandidates[0]?.questionType).toBe("channel_or_partner_integration");
    expect(replay.replayCandidates[0]?.reasons).toContain("failure:stale-retrieval-only");
    expect(replay.replayCandidates[0]?.reasons).toContain("ontology-contested");
    expect(replay.replayCandidates[0]?.reasons).toContain("canonical-flow-incoherent");
    expect(replay.replayCandidates[0]?.reasons).toContain("canonical-flow-mixed-namespace");
    expect(replay.replayCandidates.some((item) => item.reasons.includes("ontology-deprecated"))).toBe(true);
  });

  it("renders replay markdown with candidate queue", () => {
    const replay = buildEvaluationReplaySnapshot({
      generatedAt: "2026-03-16T02:00:00.000Z",
      artifacts: [
        buildProjectAskEvaluationArtifact({
          generatedAt: "2026-03-16T01:00:00.000Z",
          projectId: "p1",
          projectName: "dcp-services",
          question: "모니모 회원인증은 어떻게 연동되는지 설명해줘.",
          strategyType: "cross_layer_flow",
          questionType: "channel_or_partner_integration",
          confidence: 0.41,
          qualityGatePassed: false,
          attempts: 3,
          llmCallCount: 4,
          retrievalProvider: "qmd",
          retrievalFallbackUsed: false,
          retrievalHitCount: 5,
          retrievalTopConfidence: 0.63,
          matchedRetrievalUnitIds: ["unit:flow:monimo"],
          matchedRetrievalUnitStatuses: ["stale"],
          qualityGateFailures: ["stale-retrieval-only"],
          evidenceCount: 2,
          caveatCount: 1,
          hydratedEvidenceCount: 1,
          linkedFlowEvidenceCount: 1,
          linkedEaiEvidenceCount: 0,
          downstreamTraceCount: 0
        })
      ]
    });

    const markdown = buildEvaluationReplayMarkdown(replay);
    expect(markdown).toContain("# Evaluation Replay");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Replay Candidates");
    expect(markdown).toContain("channel_or_partner_integration");
  });
});
