import { describe, expect, it } from "vitest";
import { LearnedKnowledgeSnapshotSchema, applyLearnedKnowledgePromotionActions } from "../src/server/learned-knowledge.js";
import {
  buildProjectFeedbackArtifact,
  buildProjectFeedbackMarkdown,
  buildProjectFeedbackSummaryMarkdown,
  buildProjectFeedbackSummarySnapshot,
  deriveFeedbackPromotionActions
} from "../src/server/project-feedback.js";

describe("project feedback", () => {
  it("promotes matched candidates when user marks a response correct", () => {
    const snapshot = LearnedKnowledgeSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-16T00:00:00.000Z",
      candidates: [
        {
          id: "channel:monimo",
          kind: "channel",
          status: "candidate",
          label: "monimo",
          description: "",
          tags: ["member-auth"],
          aliases: ["모니모 회원인증"],
          apiPrefixes: [],
          screenPrefixes: [],
          controllerHints: ["EmbededMemberLoginController"],
          serviceHints: ["EmbededMemberLoginService"],
          pathHints: ["dcp-member"],
          searchTerms: ["monimo", "회원인증"],
          evidence: ["dcp-member/.../EmbededMemberLoginController.java"],
          score: 35,
          counts: { links: 1, screens: 1, backend: 1, eai: 0, uses: 0, successes: 0, failures: 0 },
          firstSeenAt: "2026-03-16T00:00:00.000Z",
          lastSeenAt: "2026-03-16T00:00:00.000Z"
        }
      ],
      summary: {
        candidateCount: 1,
        validatedCount: 0,
        staleCount: 0,
        domainCount: 0,
        moduleRoleCount: 0,
        processCount: 0,
        channelCount: 1,
        strongestCandidates: ["channel:monimo"]
      }
    });

    const artifact = buildProjectFeedbackArtifact({
      generatedAt: "2026-03-16T00:00:01.000Z",
      projectId: "p1",
      projectName: "dcp",
      kind: "ask",
      prompt: "모니모 회원인증의 흐름이 프론트에서부터 백엔드까지 어떻게 이루어지는지 분석해줘.",
      questionType: "channel_or_partner_integration",
      verdict: "correct",
      scope: "path",
      matchedKnowledgeIds: ["channel:monimo"],
      matchedRetrievalUnitIds: ["unit:flow:monimo-auth"],
      targets: [
        {
          kind: "path",
          label: "monimo auth path",
          nodeIds: ["route:/mo/login/monimo", "controller:EmbededMemberLoginController.login"],
          edgeIds: ["edge:route-api"]
        }
      ],
      notes: "정답"
    });

    const actions = deriveFeedbackPromotionActions({
      artifact,
      learnedKnowledge: snapshot
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.candidateId).toBe("channel:monimo");
    expect(actions[0]?.targetStatus).toBe("validated");
    expect(actions[0]?.reasons).toContain("scope:path");

    const next = applyLearnedKnowledgePromotionActions({
      snapshot,
      generatedAt: artifact.generatedAt,
      actions
    });
    expect(next.candidates[0]?.status).toBe("validated");
    expect(next.candidates[0]?.counts.successes).toBeGreaterThan(0);

    const markdown = buildProjectFeedbackMarkdown(artifact);
    expect(markdown).toContain("scope: path");
    expect(markdown).toContain("targetCount: 1");
  });

  it("stales matched candidates when user marks a response incorrect", () => {
    const snapshot = LearnedKnowledgeSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-16T00:00:00.000Z",
      candidates: [
        {
          id: "module:dcp-async",
          kind: "module-role",
          status: "validated",
          label: "dcp-async",
          description: "",
          tags: ["async"],
          aliases: ["dcp-async 역할"],
          apiPrefixes: [],
          screenPrefixes: [],
          controllerHints: [],
          serviceHints: [],
          pathHints: ["dcp-async"],
          searchTerms: ["dcp-async", "async"],
          evidence: ["dcp-async/src/main/java/demo/AsyncDispatcherManager.java"],
          score: 72,
          counts: { links: 0, screens: 0, backend: 1, eai: 0, uses: 5, successes: 5, failures: 0 },
          firstSeenAt: "2026-03-16T00:00:00.000Z",
          lastSeenAt: "2026-03-16T00:00:00.000Z"
        }
      ],
      summary: {
        candidateCount: 0,
        validatedCount: 1,
        staleCount: 0,
        domainCount: 0,
        moduleRoleCount: 1,
        processCount: 0,
        channelCount: 0,
        strongestCandidates: ["module:dcp-async"]
      }
    });

    const artifact = buildProjectFeedbackArtifact({
      generatedAt: "2026-03-16T00:00:02.000Z",
      projectId: "p1",
      projectName: "dcp",
      kind: "search",
      prompt: "dcp-async 프로젝트는 어떤 역할을 하는가?",
      questionType: "module_role_explanation",
      verdict: "incorrect",
      scope: "node",
      matchedKnowledgeIds: ["module:dcp-async"],
      matchedRetrievalUnitIds: ["unit:module:module:dcp-async"],
      targets: [{ kind: "node", id: "module:dcp-async", label: "async module" }],
      notes: "공통 async 모듈 설명이 틀렸음"
    });

    const actions = deriveFeedbackPromotionActions({
      artifact,
      learnedKnowledge: snapshot
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.targetStatus).toBe("stale");
  });

  it("summarizes scoped and targeted feedback", () => {
    const artifacts = [
      buildProjectFeedbackArtifact({
        generatedAt: "2026-03-16T00:00:01.000Z",
        projectId: "p1",
        projectName: "dcp",
        kind: "ask",
        prompt: "모니모 회원인증 흐름",
        questionType: "channel_or_partner_integration",
        verdict: "correct",
        scope: "path",
        matchedKnowledgeIds: ["channel:monimo"],
        targets: [
          {
            kind: "path",
            label: "critical path",
            nodeIds: ["route:/mo/login/monimo", "controller:RegisteUseDcpChnelController.registe"]
          }
        ]
      }),
      buildProjectFeedbackArtifact({
        generatedAt: "2026-03-16T00:00:02.000Z",
        projectId: "p1",
        projectName: "dcp",
        kind: "search",
        prompt: "dcp-async 역할",
        questionType: "module_role_explanation",
        verdict: "incorrect",
        scope: "edge",
        matchedKnowledgeIds: ["module:dcp-async"],
        targets: [{ kind: "edge", id: "edge:controller-service", label: "wrong relation" }]
      }),
      buildProjectFeedbackArtifact({
        generatedAt: "2026-03-16T00:00:03.000Z",
        projectId: "p1",
        projectName: "dcp",
        kind: "search",
        prompt: "loan runtime 역할",
        questionType: "module_role_explanation",
        verdict: "partial",
        scope: "node",
        matchedKnowledgeIds: ["module:loan-runtime"],
        targets: [{ kind: "node", id: "module:loan-runtime", label: "loan runtime" }]
      })
    ];

    const summary = buildProjectFeedbackSummarySnapshot({
      generatedAt: "2026-03-16T00:00:04.000Z",
      artifacts
    });
    expect(summary.summary.totalFeedback).toBe(3);
    expect(summary.summary.scopeCounts.path).toBe(1);
    expect(summary.summary.scopeCounts.edge).toBe(1);
    expect(summary.summary.scopeCounts.node).toBe(1);
    expect(summary.summary.targetedNodeCount).toBe(1);
    expect(summary.summary.targetedEdgeCount).toBe(1);
    expect(summary.summary.targetedPathCount).toBe(1);

    const markdown = buildProjectFeedbackSummaryMarkdown(summary);
    expect(markdown).toContain("## Scope Counts");
    expect(markdown).toContain("targetedEdgeCount: 1");
  });
});
