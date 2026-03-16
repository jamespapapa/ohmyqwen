import { describe, expect, it } from "vitest";
import {
  buildProjectAskEvaluationArtifact,
  buildProjectSearchEvaluationArtifact
} from "../src/server/evaluation-artifacts.js";
import {
  applyLearnedKnowledgePromotionActions,
  LearnedKnowledgeSnapshotSchema
} from "../src/server/learned-knowledge.js";
import {
  buildEvaluationPromotionMarkdown,
  buildEvaluationPromotionSnapshot
} from "../src/server/evaluation-promotions.js";

describe("evaluation promotions", () => {
  it("derives promote and stale actions from historical evaluation artifacts", () => {
    const knowledge = LearnedKnowledgeSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-16T00:00:00.000Z",
      candidates: [
        {
          id: "channel:monimo",
          kind: "channel",
          status: "candidate",
          label: "monimo channel",
          description: "",
          tags: ["monimo"],
          aliases: [],
          apiPrefixes: ["/member/monimo"],
          screenPrefixes: ["MDP-MYCER999999M"],
          controllerHints: ["RegisteUseDcpChnelController"],
          serviceHints: ["EmbededMemberLoginService"],
          pathHints: ["dcp-member"],
          searchTerms: ["monimo", "회원인증", "embedded login"],
          evidence: ["monimo bridge"],
          score: 41,
          counts: {
            links: 2,
            screens: 1,
            backend: 2,
            eai: 0,
            uses: 1,
            successes: 1,
            failures: 0
          },
          firstSeenAt: "2026-03-15T00:00:00.000Z",
          lastSeenAt: "2026-03-16T00:00:00.000Z"
        },
        {
          id: "module:dcp-async",
          kind: "module-role",
          status: "validated",
          label: "dcp-async",
          description: "",
          tags: ["async"],
          aliases: [],
          apiPrefixes: [],
          screenPrefixes: [],
          controllerHints: [],
          serviceHints: [],
          pathHints: ["dcp-async"],
          searchTerms: ["dcp-async", "async support"],
          evidence: ["AsyncDispatcherManager"],
          score: 77,
          counts: {
            links: 3,
            screens: 0,
            backend: 4,
            eai: 0,
            uses: 3,
            successes: 3,
            failures: 0
          },
          firstSeenAt: "2026-03-15T00:00:00.000Z",
          lastSeenAt: "2026-03-16T00:00:00.000Z"
        }
      ],
      summary: {
        candidateCount: 2,
        validatedCount: 1,
        staleCount: 0,
        domainCount: 0,
        moduleRoleCount: 1,
        processCount: 0,
        channelCount: 1,
        strongestCandidates: ["module:dcp-async", "channel:monimo"]
      }
    });

    const artifacts = [
      buildProjectSearchEvaluationArtifact({
        generatedAt: "2026-03-16T00:01:00.000Z",
        projectId: "p1",
        projectName: "demo",
        query: "모니모 회원인증",
        questionType: "channel_or_partner_integration",
        questionTypeConfidence: 0.93,
        provider: "qmd",
        fallbackUsed: false,
        hitCount: 4,
        topConfidence: 0.71,
        matchedKnowledgeIds: ["channel:monimo"],
        matchedRetrievalUnitIds: ["unit:flow:monimo"],
        matchedRetrievalUnitStatuses: ["validated"]
      }),
      buildProjectAskEvaluationArtifact({
        generatedAt: "2026-03-16T00:02:00.000Z",
        projectId: "p1",
        projectName: "demo",
        question: "모니모 회원인증 흐름",
        strategyType: "cross_layer_flow",
        questionType: "channel_or_partner_integration",
        confidence: 0.82,
        qualityGatePassed: true,
        attempts: 1,
        llmCallCount: 1,
        retrievalProvider: "qmd",
        retrievalFallbackUsed: false,
        retrievalHitCount: 5,
        retrievalTopConfidence: 0.76,
        matchedKnowledgeIds: ["channel:monimo"],
        matchedRetrievalUnitIds: ["unit:flow:monimo"],
        matchedRetrievalUnitStatuses: ["validated"],
        qualityGateFailures: [],
        evidenceCount: 5,
        caveatCount: 1,
        hydratedEvidenceCount: 2,
        linkedFlowEvidenceCount: 2,
        linkedEaiEvidenceCount: 0,
        downstreamTraceCount: 1
      }),
      buildProjectAskEvaluationArtifact({
        generatedAt: "2026-03-16T00:03:00.000Z",
        projectId: "p1",
        projectName: "demo",
        question: "dcp-async 역할",
        strategyType: "architecture_overview",
        questionType: "module_role_explanation",
        confidence: 0.28,
        qualityGatePassed: false,
        attempts: 3,
        llmCallCount: 2,
        retrievalProvider: "lexical",
        retrievalFallbackUsed: true,
        retrievalHitCount: 2,
        retrievalTopConfidence: 0.31,
        matchedKnowledgeIds: ["module:dcp-async"],
        matchedRetrievalUnitIds: ["unit:module:dcp-async"],
        matchedRetrievalUnitStatuses: ["stale"],
        qualityGateFailures: ["missing-module-role-detail"],
        retryStopReason: "low-confidence-gain",
        evidenceCount: 1,
        caveatCount: 3,
        hydratedEvidenceCount: 0,
        linkedFlowEvidenceCount: 0,
        linkedEaiEvidenceCount: 0,
        downstreamTraceCount: 0
      }),
      buildProjectAskEvaluationArtifact({
        generatedAt: "2026-03-16T00:04:00.000Z",
        projectId: "p1",
        projectName: "demo",
        question: "dcp-async 뭐하는 모듈이야",
        strategyType: "architecture_overview",
        questionType: "module_role_explanation",
        confidence: 0.33,
        qualityGatePassed: false,
        attempts: 2,
        llmCallCount: 2,
        retrievalProvider: "lexical",
        retrievalFallbackUsed: true,
        retrievalHitCount: 2,
        retrievalTopConfidence: 0.29,
        matchedKnowledgeIds: ["module:dcp-async"],
        matchedRetrievalUnitIds: ["unit:module:dcp-async"],
        matchedRetrievalUnitStatuses: ["stale"],
        qualityGateFailures: ["stale-retrieval-only"],
        retryStopReason: "no-new-evidence",
        evidenceCount: 1,
        caveatCount: 3,
        hydratedEvidenceCount: 0,
        linkedFlowEvidenceCount: 0,
        linkedEaiEvidenceCount: 0,
        downstreamTraceCount: 0
      })
    ];

    const snapshot = buildEvaluationPromotionSnapshot({
      generatedAt: "2026-03-16T01:00:00.000Z",
      learnedKnowledge: knowledge,
      artifacts
    });

    expect(snapshot.summary.totalActions).toBeGreaterThanOrEqual(2);
    expect(snapshot.summary.promoteCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.summary.staleCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.actions.some((action) => action.candidateId === "channel:monimo" && action.targetStatus === "validated")).toBe(true);
    expect(snapshot.actions.some((action) => action.candidateId === "module:dcp-async" && action.targetStatus === "stale")).toBe(true);
  });

  it("applies promotion actions back into learned knowledge lifecycle", () => {
    const knowledge = LearnedKnowledgeSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-16T00:00:00.000Z",
      candidates: [
        {
          id: "channel:monimo",
          kind: "channel",
          status: "candidate",
          label: "monimo channel",
          description: "",
          tags: ["monimo"],
          aliases: [],
          apiPrefixes: [],
          screenPrefixes: [],
          controllerHints: [],
          serviceHints: [],
          pathHints: [],
          searchTerms: ["monimo"],
          evidence: [],
          score: 22,
          counts: { links: 1, screens: 1, backend: 1, eai: 0, uses: 1, successes: 1, failures: 0 },
          firstSeenAt: "2026-03-15T00:00:00.000Z",
          lastSeenAt: "2026-03-16T00:00:00.000Z"
        },
        {
          id: "module:dcp-async",
          kind: "module-role",
          status: "validated",
          label: "dcp-async",
          description: "",
          tags: ["async"],
          aliases: [],
          apiPrefixes: [],
          screenPrefixes: [],
          controllerHints: [],
          serviceHints: [],
          pathHints: [],
          searchTerms: ["dcp-async"],
          evidence: [],
          score: 72,
          counts: { links: 2, screens: 0, backend: 3, eai: 0, uses: 3, successes: 3, failures: 0 },
          firstSeenAt: "2026-03-15T00:00:00.000Z",
          lastSeenAt: "2026-03-16T00:00:00.000Z"
        }
      ],
      summary: {
        candidateCount: 2,
        validatedCount: 1,
        staleCount: 0,
        domainCount: 0,
        moduleRoleCount: 1,
        processCount: 0,
        channelCount: 1,
        strongestCandidates: ["module:dcp-async", "channel:monimo"]
      }
    });

    const next = applyLearnedKnowledgePromotionActions({
      snapshot: knowledge,
      generatedAt: "2026-03-16T01:00:00.000Z",
      actions: [
        {
          candidateId: "channel:monimo",
          currentStatus: "candidate",
          targetStatus: "validated",
          score: 80,
          reasons: ["promotion-ready"],
          confidence: 0.9
        },
        {
          candidateId: "module:dcp-async",
          currentStatus: "validated",
          targetStatus: "stale",
          score: 77,
          reasons: ["stale-risk-high"],
          confidence: 0.87
        }
      ]
    });

    expect(next.candidates.find((candidate) => candidate.id === "channel:monimo")?.status).toBe("validated");
    expect(next.candidates.find((candidate) => candidate.id === "module:dcp-async")?.status).toBe("stale");

    const markdown = buildEvaluationPromotionMarkdown(
      buildEvaluationPromotionSnapshot({
        generatedAt: "2026-03-16T01:00:00.000Z",
        learnedKnowledge: knowledge,
        artifacts: []
      })
    );
    expect(markdown).toContain("# Evaluation Promotions");
  });
});
