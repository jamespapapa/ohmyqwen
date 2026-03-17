import { describe, expect, it } from "vitest";
import {
  buildOntologyReviewSnapshot,
  canonicalOntologyPathTargetId,
  canonicalOntologyReviewTarget
} from "../src/server/ontology-review.js";
import { buildProjectFeedbackArtifact } from "../src/server/project-feedback.js";

describe("ontology review", () => {
  it("canonicalizes path targets deterministically", () => {
    const pathIdA = canonicalOntologyPathTargetId({
      label: "monimo path",
      nodeIds: ["route:/monimo", "controller:RegisteUseDcpChnelController.registe"],
      edgeIds: ["edge:route-api"]
    });
    const pathIdB = canonicalOntologyPathTargetId({
      label: "monimo path",
      nodeIds: ["route:/monimo", "controller:RegisteUseDcpChnelController.registe"],
      edgeIds: ["edge:route-api"]
    });
    expect(pathIdA).toBe(pathIdB);

    const target = canonicalOntologyReviewTarget({
      kind: "path",
      label: "monimo path",
      nodeIds: ["route:/monimo", "controller:RegisteUseDcpChnelController.registe"],
      edgeIds: ["edge:route-api"],
      notes: "critical path"
    });
    expect(target?.targetKind).toBe("path");
    expect(target?.targetId).toContain("path-target:");
  });

  it("marks mixed feedback as contested and repeated strong negatives as deprecated", () => {
    const artifacts = [
      buildProjectFeedbackArtifact({
        generatedAt: "2026-03-17T00:00:00.000Z",
        projectId: "p1",
        projectName: "demo",
        kind: "ask",
        prompt: "모니모 회원인증 흐름",
        questionType: "channel_or_partner_integration",
        verdict: "correct",
        scope: "node",
        strength: "strong",
        targets: [{ kind: "node", id: "controller:EmbededMemberLoginController.login", label: "login controller" }]
      }),
      buildProjectFeedbackArtifact({
        generatedAt: "2026-03-17T00:00:01.000Z",
        projectId: "p1",
        projectName: "demo",
        kind: "ask",
        prompt: "모니모 회원인증 흐름",
        questionType: "channel_or_partner_integration",
        verdict: "incorrect",
        scope: "node",
        targets: [{ kind: "node", id: "controller:EmbededMemberLoginController.login", label: "login controller" }]
      }),
      buildProjectFeedbackArtifact({
        generatedAt: "2026-03-17T00:00:02.000Z",
        projectId: "p1",
        projectName: "demo",
        kind: "search",
        prompt: "display content role",
        questionType: "module_role_explanation",
        verdict: "incorrect",
        scope: "edge",
        strength: "strong",
        targets: [{ kind: "edge", id: "edge:display-wrong", label: "wrong edge" }]
      }),
      buildProjectFeedbackArtifact({
        generatedAt: "2026-03-17T00:00:03.000Z",
        projectId: "p1",
        projectName: "demo",
        kind: "search",
        prompt: "display content role",
        questionType: "module_role_explanation",
        verdict: "incorrect",
        scope: "edge",
        strength: "strong",
        targets: [{ kind: "edge", id: "edge:display-wrong", label: "wrong edge" }]
      })
    ];

    const snapshot = buildOntologyReviewSnapshot({
      generatedAt: "2026-03-17T00:00:04.000Z",
      feedbackArtifacts: artifacts
    });

    const contested = snapshot.records.find((item) => item.targetId === "controller:EmbededMemberLoginController.login");
    expect(contested?.status).toBe("contested");

    const deprecated = snapshot.records.find((item) => item.targetId === "edge:display-wrong");
    expect(deprecated?.status).toBe("deprecated");
    expect(snapshot.summary.contestedCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.summary.deprecatedCount).toBeGreaterThanOrEqual(1);
  });
});
