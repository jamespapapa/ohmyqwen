import { describe, expect, it } from "vitest";
import { rankOntologyNodesForQuestion, rankOntologyProjectionsForQuestion, buildOntologySupportCandidates } from "../src/server/ontology-planner.js";
import { OntologyGraphSnapshotSchema } from "../src/server/ontology-graph.js";
import { OntologyProjectionSnapshotSchema } from "../src/server/ontology-projections.js";

describe("ontology planner", () => {
  it("prefers validated channel-specific nodes and penalizes deprecated ones", () => {
    const snapshot = OntologyGraphSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-17T00:00:00.000Z",
      workspaceDir: "/workspace",
      nodes: [
        {
          id: "controller:RegisteUseDcpChnelController.registe",
          type: "controller",
          label: "RegisteUseDcpChnelController.registe",
          summary: "monimo registration controller",
          metadata: {
            domains: ["member-auth"],
            subdomains: ["member-registration"],
            channels: ["monimo"],
            actions: ["register"],
            moduleRoles: ["bridge"],
            processRoles: [],
            confidence: 0.88,
            evidencePaths: ["dcp-member/src/RegisteUseDcpChnelController.java"],
            sourceType: "ontology-review",
            validatedStatus: "validated"
          },
          attributes: {}
        },
        {
          id: "controller:DisplayBoardContentController.selectClassList",
          type: "controller",
          label: "DisplayBoardContentController.selectClassList",
          summary: "display board content",
          metadata: {
            domains: ["member-auth"],
            subdomains: [],
            channels: [],
            actions: [],
            moduleRoles: [],
            processRoles: [],
            confidence: 0.81,
            evidencePaths: ["dcp-display/src/DisplayBoardContentController.java"],
            sourceType: "ontology-review",
            validatedStatus: "deprecated"
          },
          attributes: {}
        }
      ],
      edges: [],
      summary: {
        nodeCount: 2,
        edgeCount: 0,
        nodeTypeCounts: { controller: 2 },
        edgeTypeCounts: {},
        feedbackNodeCount: 0,
        replayNodeCount: 0,
        pathNodeCount: 0,
        validatedNodeCount: 1,
        candidateNodeCount: 0,
        staleNodeCount: 0,
        contestedNodeCount: 0,
        deprecatedNodeCount: 1,
        topDomains: [{ id: "member-auth", count: 2 }],
        topChannels: [{ id: "monimo", count: 1 }]
      }
    });

    const ranked = rankOntologyNodesForQuestion({
      snapshot,
      question: "모니모 회원인증 등록 흐름 설명",
      questionType: "channel_or_partner_integration",
      questionTags: ["monimo", "member-auth", "register"]
    });

    expect(ranked[0]?.node.id).toBe("controller:RegisteUseDcpChnelController.registe");
    expect(ranked.some((item) => item.node.id === "controller:DisplayBoardContentController.selectClassList")).toBe(false);

    const support = buildOntologySupportCandidates({
      rankedNodes: ranked,
      existingPaths: []
    });
    expect(support[0]?.path).toBe("dcp-member/src/RegisteUseDcpChnelController.java");
  });

  it("prefers matching projections for module role questions", () => {
    const snapshot = OntologyProjectionSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-17T00:00:00.000Z",
      workspaceDir: "/workspace",
      projections: [
        {
          id: "projection:code",
          type: "code-structure",
          title: "Code Structure",
          summary: "module and symbol layout",
          nodeIds: ["module:dcp-async"],
          edgeIds: [],
          representativePaths: [{ id: "p1", label: "dcp-async/src/AsyncDispatcherManager.java", nodeIds: [], edgeIds: [] }]
        },
        {
          id: "projection:integration",
          type: "integration",
          title: "Integration",
          summary: "monimo integration path",
          nodeIds: ["controller:RegisteUseDcpChnelController.registe"],
          edgeIds: [],
          representativePaths: []
        }
      ],
      summary: {
        projectionCount: 2,
        totalRepresentativePathCount: 1,
        projectionTypeCounts: { "code-structure": 1, integration: 1 },
        lifecycleProjectionPathCount: 0,
        topProjectionTypes: [
          { id: "code-structure", count: 1 },
          { id: "integration", count: 1 }
        ]
      }
    });

    const ranked = rankOntologyProjectionsForQuestion({
      snapshot,
      question: "dcp-async 프로젝트 역할 설명",
      questionType: "module_role_explanation",
      matchedNodeIds: ["module:dcp-async"]
    });

    expect(ranked[0]?.projection.id).toBe("projection:code");
  });

  it("prefers action-aligned nodes over adjacent status-read nodes", () => {
    const snapshot = OntologyGraphSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-17T00:00:00.000Z",
      workspaceDir: "/workspace",
      nodes: [
        {
          id: "controller:MemberStatusController.getMemberRedisInfo",
          type: "controller",
          label: "MemberStatusController.getMemberRedisInfo",
          summary: "member redis status info",
          metadata: {
            domains: ["member-auth"],
            subdomains: [],
            channels: ["monimo"],
            actions: ["action-read", "action-status-read", "action-state-store"],
            moduleRoles: [],
            processRoles: [],
            confidence: 0.86,
            evidencePaths: ["dcp-member/src/MemberStatusController.java"],
            sourceType: "ontology-review",
            validatedStatus: "validated"
          },
          attributes: {}
        },
        {
          id: "controller:RegisteUseDcpChnelController.registe",
          type: "controller",
          label: "RegisteUseDcpChnelController.registe",
          summary: "monimo member registration/authentication flow",
          metadata: {
            domains: ["member-auth"],
            subdomains: [],
            channels: ["monimo"],
            actions: ["action-auth", "action-register"],
            moduleRoles: ["bridge"],
            processRoles: [],
            confidence: 0.84,
            evidencePaths: ["dcp-member/src/RegisteUseDcpChnelController.java"],
            sourceType: "ontology-review",
            validatedStatus: "validated"
          },
          attributes: {}
        }
      ],
      edges: [],
      summary: {
        nodeCount: 2,
        edgeCount: 0,
        nodeTypeCounts: { controller: 2 },
        edgeTypeCounts: {},
        feedbackNodeCount: 0,
        replayNodeCount: 0,
        pathNodeCount: 0,
        validatedNodeCount: 2,
        candidateNodeCount: 0,
        staleNodeCount: 0,
        contestedNodeCount: 0,
        deprecatedNodeCount: 0,
        topDomains: [{ id: "member-auth", count: 2 }],
        topChannels: [{ id: "monimo", count: 2 }]
      }
    });

    const ranked = rankOntologyNodesForQuestion({
      snapshot,
      question: "모니모 회원 인증 로직이 어떻게 구현되는지 면밀히 분석해줘.",
      questionType: "channel_or_partner_integration",
      questionTags: ["channel:monimo", "member-auth"]
    });

    expect(ranked[0]?.node.id).toBe("controller:RegisteUseDcpChnelController.registe");
    expect(ranked.find((item) => item.node.id === "controller:MemberStatusController.getMemberRedisInfo")?.reasons).toContain(
      "action-mismatch"
    );
  });

  it("includes async channels for process and callback questions", () => {
    const snapshot = OntologyGraphSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-18T00:00:00.000Z",
      workspaceDir: "/workspace",
      nodes: [
        {
          id: "async-channel:monimo.auth.callback",
          type: "async-channel",
          label: "monimo.auth.callback",
          summary: "async callback queue/topic boundary",
          metadata: {
            domains: ["member-auth"],
            subdomains: ["embedded-login"],
            channels: ["monimo"],
            actions: ["action-callback"],
            moduleRoles: ["async-support"],
            processRoles: ["async-process"],
            confidence: 0.82,
            evidencePaths: ["dcp-async/src/MonimoAsyncController.java"],
            sourceType: "ontology-review",
            validatedStatus: "validated"
          },
          attributes: {}
        },
        {
          id: "service:EmbededMemberLoginService.authenticate",
          type: "service",
          label: "EmbededMemberLoginService.authenticate",
          summary: "member authentication service",
          metadata: {
            domains: ["member-auth"],
            subdomains: ["embedded-login"],
            channels: ["monimo"],
            actions: ["action-auth"],
            moduleRoles: [],
            processRoles: [],
            confidence: 0.8,
            evidencePaths: ["dcp-member/src/EmbededMemberLoginService.java"],
            sourceType: "ontology-review",
            validatedStatus: "validated"
          },
          attributes: {}
        }
      ],
      edges: [],
      summary: {
        nodeCount: 2,
        edgeCount: 0,
        nodeTypeCounts: { "async-channel": 1, service: 1 },
        edgeTypeCounts: {},
        feedbackNodeCount: 0,
        replayNodeCount: 0,
        pathNodeCount: 0,
        validatedNodeCount: 2,
        candidateNodeCount: 0,
        staleNodeCount: 0,
        contestedNodeCount: 0,
        deprecatedNodeCount: 0,
        topDomains: [{ id: "member-auth", count: 2 }],
        topChannels: [{ id: "monimo", count: 2 }]
      }
    });

    const ranked = rankOntologyNodesForQuestion({
      snapshot,
      question: "모니모 비동기 콜백 처리 흐름을 추적해줘.",
      questionType: "process_or_batch_trace",
      questionTags: ["monimo", "callback"]
    });

    expect(ranked[0]?.node.id).toBe("async-channel:monimo.auth.callback");
  });
});
