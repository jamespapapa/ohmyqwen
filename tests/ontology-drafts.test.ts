import { describe, expect, it } from "vitest";
import { buildOntologyDraftSnapshot, applyOntologyDraftSnapshot } from "../src/server/ontology-drafts.js";
import { OntologyGraphSnapshotSchema } from "../src/server/ontology-graph.js";

describe("ontology drafts", () => {
  it("applies node and edge additions and overrides over a base ontology graph", () => {
    const baseGraph = OntologyGraphSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-17T10:00:00.000Z",
      workspaceDir: "/workspace",
      nodes: [
        {
          id: "service:MemberService.login",
          type: "service",
          label: "MemberService.login",
          summary: "login service",
          metadata: {
            domains: ["member-auth"],
            subdomains: [],
            channels: [],
            actions: ["action-auth"],
            moduleRoles: [],
            processRoles: [],
            confidence: 0.82,
            evidencePaths: ["src/MemberService.java"],
            sourceType: "knowledge-schema",
            validatedStatus: "validated"
          },
          attributes: {}
        }
      ],
      edges: [],
      summary: {
        nodeCount: 1,
        edgeCount: 0,
        nodeTypeCounts: { service: 1 },
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
        topChannels: []
      }
    });

    const draft = buildOntologyDraftSnapshot({
      generatedAt: "2026-03-17T10:05:00.000Z",
      projectId: "p1",
      projectName: "demo",
      draftVersion: 1,
      basedOnOntologyGeneratedAt: baseGraph.generatedAt,
      operations: [
        {
          id: "op1",
          createdAt: "2026-03-17T10:05:00.000Z",
          kind: "add-node",
          nodeId: "controller:MonimoController.login",
          nodeType: "controller",
          label: "MonimoController.login",
          summary: "monimo login controller",
          metadata: {
            channels: ["monimo"],
            actions: ["action-auth", "action-register"],
            validatedStatus: "candidate"
          }
        },
        {
          id: "op2",
          createdAt: "2026-03-17T10:05:01.000Z",
          kind: "add-edge",
          edgeId: "edge:monimo-login-calls-member-service",
          edgeType: "calls",
          fromId: "controller:MonimoController.login",
          toId: "service:MemberService.login",
          label: "calls"
        },
        {
          id: "op3",
          createdAt: "2026-03-17T10:05:02.000Z",
          kind: "override-node",
          targetId: "service:MemberService.login",
          summary: "validated login service",
          metadata: {
            channels: ["monimo"],
            validatedStatus: "validated"
          }
        }
      ]
    });

    const overlay = applyOntologyDraftSnapshot({ baseGraph, draft });
    expect(overlay.ontologyGraph.nodes.some((node) => node.id === "controller:MonimoController.login")).toBe(true);
    expect(overlay.ontologyGraph.edges.some((edge) => edge.id === "edge:monimo-login-calls-member-service")).toBe(true);
    expect(
      overlay.ontologyGraph.nodes.find((node) => node.id === "service:MemberService.login")?.metadata.channels
    ).toContain("monimo");
    expect(overlay.changedNodeIds).toContain("controller:MonimoController.login");
    expect(overlay.changedEdgeIds).toContain("edge:monimo-login-calls-member-service");
    expect(overlay.changedProjectionIds.length).toBeGreaterThan(0);
  });

  it("records warnings for invalid references and removes incident edges when removing a node", () => {
    const baseGraph = OntologyGraphSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-17T10:00:00.000Z",
      workspaceDir: "/workspace",
      nodes: [
        {
          id: "controller:A",
          type: "controller",
          label: "A",
          summary: "",
          metadata: {
            domains: [],
            subdomains: [],
            channels: [],
            actions: [],
            moduleRoles: [],
            processRoles: [],
            confidence: 0.7,
            evidencePaths: [],
            sourceType: "knowledge-schema",
            validatedStatus: "candidate"
          },
          attributes: {}
        },
        {
          id: "service:B",
          type: "service",
          label: "B",
          summary: "",
          metadata: {
            domains: [],
            subdomains: [],
            channels: [],
            actions: [],
            moduleRoles: [],
            processRoles: [],
            confidence: 0.7,
            evidencePaths: [],
            sourceType: "knowledge-schema",
            validatedStatus: "candidate"
          },
          attributes: {}
        }
      ],
      edges: [
        {
          id: "edge:A-B",
          type: "calls",
          fromId: "controller:A",
          toId: "service:B",
          label: "calls",
          metadata: {
            domains: [],
            subdomains: [],
            channels: [],
            actions: [],
            moduleRoles: [],
            processRoles: [],
            confidence: 0.7,
            evidencePaths: [],
            sourceType: "knowledge-schema",
            validatedStatus: "candidate"
          },
          attributes: {}
        }
      ],
      summary: {
        nodeCount: 2,
        edgeCount: 1,
        nodeTypeCounts: { controller: 1, service: 1 },
        edgeTypeCounts: { calls: 1 },
        feedbackNodeCount: 0,
        replayNodeCount: 0,
        pathNodeCount: 0,
        validatedNodeCount: 0,
        candidateNodeCount: 2,
        staleNodeCount: 0,
        contestedNodeCount: 0,
        deprecatedNodeCount: 0,
        topDomains: [],
        topChannels: []
      }
    });

    const draft = buildOntologyDraftSnapshot({
      generatedAt: "2026-03-17T10:06:00.000Z",
      projectId: "p1",
      projectName: "demo",
      draftVersion: 1,
      basedOnOntologyGeneratedAt: baseGraph.generatedAt,
      operations: [
        {
          id: "op1",
          createdAt: "2026-03-17T10:06:00.000Z",
          kind: "remove-node",
          targetId: "service:B"
        },
        {
          id: "op2",
          createdAt: "2026-03-17T10:06:01.000Z",
          kind: "add-edge",
          edgeId: "edge:missing",
          edgeType: "calls",
          fromId: "controller:A",
          toId: "service:missing",
          label: "broken"
        }
      ]
    });

    const overlay = applyOntologyDraftSnapshot({ baseGraph, draft });
    expect(overlay.ontologyGraph.nodes.some((node) => node.id === "service:B")).toBe(false);
    expect(overlay.ontologyGraph.edges.some((edge) => edge.id === "edge:A-B")).toBe(false);
    expect(overlay.warnings).toContain("missing-edge-endpoint:edge:missing");
  });
});
