import { describe, expect, it } from "vitest";
import {
  buildOntologyInputArtifact,
  buildOntologyInputSummaryMarkdown,
  buildOntologyInputSummarySnapshot,
  deriveOntologyInputMetadata,
  parseOntologyCsvText
} from "../src/server/ontology-inputs.js";

describe("ontology inputs", () => {
  it("parses csv text with quoted cells and derives normalized metadata", () => {
    const parsed = parseOntologyCsvText([
      'name,description,channel',
      'monimo-auth,"회원 인증, 브릿지",monimo',
      'loan-runtime,"controller/service role",loan'
    ].join("\n"));

    expect(parsed.headers).toEqual(["name", "description", "channel"]);
    expect(parsed.rows[0]?.description).toBe("회원 인증, 브릿지");
    expect(parsed.rows[1]?.channel).toBe("loan");
  });

  it("builds structured ontology input artifacts and extracts prefixed semantic tags", () => {
    const artifact = buildOntologyInputArtifact({
      generatedAt: "2026-03-17T00:00:00.000Z",
      projectId: "p1",
      projectName: "demo",
      kind: "structured",
      scope: "channel",
      title: "모니모 회원인증 예시",
      message: "모니모 회원인증은 브릿지와 등록 흐름이 핵심이다.",
      tags: ["channel:monimo", "domain:member-auth", "action:register", "module-role:bridge"],
      positiveExamples: ["/monimo/registe", "EmbededMemberLoginController"],
      negativeExamples: ["일반 display board content"],
      boundaryNotes: ["일반 회원인증과 혼동하지 말 것"],
      relatedNodeIds: ["controller:EmbededMemberLoginController.login"]
    });

    expect(artifact.id).toContain("ontology-input:structured:");
    expect(artifact.normalizedTerms).toContain("monimo");
    expect(artifact.normalizedTerms).toContain("회원인증");

    expect(deriveOntologyInputMetadata(artifact)).toEqual({
      domains: ["member-auth"],
      subdomains: [],
      channels: ["monimo"],
      actions: ["register"],
      moduleRoles: ["bridge"],
      processRoles: []
    });
  });

  it("summarizes recent ontology inputs by scope, tags, and linked targets", () => {
    const artifacts = [
      buildOntologyInputArtifact({
        generatedAt: "2026-03-17T00:00:00.000Z",
        projectId: "p1",
        projectName: "demo",
        kind: "note",
        scope: "module-role",
        title: "dcp-async role",
        message: "메일/렌더링 후처리 허브",
        tags: ["module-role:async-support"],
        relatedNodeIds: ["module:dcp-async"]
      }),
      buildOntologyInputArtifact({
        generatedAt: "2026-03-17T00:00:01.000Z",
        projectId: "p1",
        projectName: "demo",
        kind: "csv",
        scope: "channel",
        title: "모니모 사전",
        message: "csv input",
        tags: ["channel:monimo"],
        csvText: ["screen,api", "MDP-MYCER999999M,/monimo/registe", "MDP-MYCER999998M,/monimo/callback"].join("\n"),
        relatedNodeIds: ["route:MDP-MYCER999999M"]
      })
    ];

    const snapshot = buildOntologyInputSummarySnapshot({
      generatedAt: "2026-03-17T00:00:02.000Z",
      artifacts
    });

    expect(snapshot.summary.totalInputs).toBe(2);
    expect(snapshot.summary.noteCount).toBe(1);
    expect(snapshot.summary.csvCount).toBe(1);
    expect(snapshot.summary.csvRowCount).toBe(2);
    expect(snapshot.summary.scopeCounts["module-role"]).toBe(1);
    expect(snapshot.summary.scopeCounts.channel).toBe(1);
    expect(snapshot.summary.relatedNodeCount).toBe(2);

    const markdown = buildOntologyInputSummaryMarkdown(snapshot);
    expect(markdown).toContain("## Top Scopes");
    expect(markdown).toContain("csvRowCount: 2");
  });
});
