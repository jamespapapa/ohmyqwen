import { describe, expect, it } from "vitest";
import {
  buildOntologyEdgePath,
  buildOntologyRenderableGraph
} from "../console-next/lib/ontology-graph-layout.js";

describe("ontology graph layout", () => {
  it("builds a horizontal spine in path focus mode", () => {
    const graph = buildOntologyRenderableGraph({
      focusMode: "path",
      selectedPathId: "path:claim",
      representativePaths: [
        {
          id: "path:claim",
          label: "claim path",
          nodeIds: ["route:1", "api:1", "controller:1", "service:1"],
          edgeIds: ["edge:1", "edge:2", "edge:3"]
        }
      ],
      nodes: [
        { id: "route:1", type: "route", label: "route", confidence: 0.9, isHighlighted: true },
        { id: "api:1", type: "api", label: "api", confidence: 0.9, isHighlighted: true },
        { id: "controller:1", type: "controller", label: "controller", confidence: 0.9, isHighlighted: true },
        { id: "service:1", type: "service", label: "service", confidence: 0.9, isHighlighted: true },
        { id: "query:1", type: "data-query", label: "query", confidence: 0.7, isHighlighted: false }
      ],
      edges: [
        { id: "edge:1", fromId: "route:1", toId: "api:1", type: "routes-to" },
        { id: "edge:2", fromId: "api:1", toId: "controller:1", type: "routes-to" },
        { id: "edge:3", fromId: "controller:1", toId: "service:1", type: "calls" },
        { id: "edge:4", fromId: "service:1", toId: "query:1", type: "transitions-to" }
      ]
    });

    expect(graph.layout.mode).toBe("path");
    expect(graph.layout.positions["route:1"].y).toBe(graph.layout.positions["api:1"].y);
    expect(graph.layout.positions["api:1"].y).toBe(graph.layout.positions["controller:1"].y);
    expect(graph.layout.positions["route:1"].x).toBeLessThan(graph.layout.positions["api:1"].x);
    expect(graph.layout.positions["api:1"].x).toBeLessThan(graph.layout.positions["controller:1"].x);
    expect(graph.layout.positions["query:1"].y).not.toBe(graph.layout.positions["service:1"].y);
  });

  it("filters isolated nodes in path focus mode", () => {
    const graph = buildOntologyRenderableGraph({
      focusMode: "path",
      selectedPathId: "path:claim",
      representativePaths: [
        {
          id: "path:claim",
          label: "claim path",
          nodeIds: ["route:1", "api:1", "controller:1"],
          edgeIds: ["edge:1", "edge:2"]
        }
      ],
      nodes: [
        { id: "route:1", type: "route", label: "route", confidence: 0.9, isHighlighted: true },
        { id: "api:1", type: "api", label: "api", confidence: 0.9, isHighlighted: true },
        { id: "controller:1", type: "controller", label: "controller", confidence: 0.9, isHighlighted: true },
        { id: "service:isolated", type: "service", label: "isolated", confidence: 0.95, isHighlighted: true }
      ],
      edges: [
        { id: "edge:1", fromId: "route:1", toId: "api:1", type: "routes-to" },
        { id: "edge:2", fromId: "api:1", toId: "controller:1", type: "routes-to" }
      ]
    });

    expect(graph.nodes.some((node) => node.id === "service:isolated")).toBe(false);
  });

  it("builds curved support edges in path mode", () => {
    const graph = buildOntologyRenderableGraph({
      focusMode: "path",
      selectedPathId: "path:claim",
      representativePaths: [
        {
          id: "path:claim",
          label: "claim path",
          nodeIds: ["route:1", "api:1", "controller:1"],
          edgeIds: ["edge:1", "edge:2"]
        }
      ],
      nodes: [
        { id: "route:1", type: "route", label: "route", confidence: 0.9, isHighlighted: true },
        { id: "api:1", type: "api", label: "api", confidence: 0.9, isHighlighted: true },
        { id: "controller:1", type: "controller", label: "controller", confidence: 0.9, isHighlighted: true },
        { id: "query:1", type: "data-query", label: "query", confidence: 0.7, isHighlighted: false }
      ],
      edges: [
        { id: "edge:1", fromId: "route:1", toId: "api:1", type: "routes-to" },
        { id: "edge:2", fromId: "api:1", toId: "controller:1", type: "routes-to" },
        { id: "edge:3", fromId: "controller:1", toId: "query:1", type: "transitions-to" }
      ]
    });

    const supportEdge = graph.edges.find((edge) => edge.id === "edge:3");
    expect(supportEdge).toBeTruthy();
    expect(buildOntologyEdgePath(supportEdge, graph.layout)).toContain("Q");
  });
});
