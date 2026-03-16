import { describe, expect, it } from "vitest";
import { LearnedKnowledgeSnapshotSchema, applyLearnedKnowledgePromotionActions } from "../src/server/learned-knowledge.js";
import {
  buildProjectFeedbackArtifact,
  buildProjectFeedbackMarkdown,
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
      matchedKnowledgeIds: ["channel:monimo"],
      matchedRetrievalUnitIds: ["unit:flow:monimo-auth"],
      notes: "정답"
    });

    const actions = deriveFeedbackPromotionActions({
      artifact,
      learnedKnowledge: snapshot
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.candidateId).toBe("channel:monimo");
    expect(actions[0]?.targetStatus).toBe("validated");

    const next = applyLearnedKnowledgePromotionActions({
      snapshot,
      generatedAt: artifact.generatedAt,
      actions
    });
    expect(next.candidates[0]?.status).toBe("validated");
    expect(next.candidates[0]?.counts.successes).toBeGreaterThan(0);
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
      matchedKnowledgeIds: ["module:dcp-async"],
      matchedRetrievalUnitIds: ["unit:module:module:dcp-async"],
      notes: "공통 async 모듈 설명이 틀렸음"
    });

    const actions = deriveFeedbackPromotionActions({
      artifact,
      learnedKnowledge: snapshot
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.targetStatus).toBe("stale");

    const markdown = buildProjectFeedbackMarkdown(artifact);
    expect(markdown).toContain("# User Feedback");
    expect(markdown).toContain("verdict: incorrect");
  });
});
