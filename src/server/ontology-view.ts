import { z } from "zod";
import {
  OntologyGraphSnapshotSchema,
  type OntologyEdge,
  type OntologyGraphSnapshot,
  type OntologyNode
} from "./ontology-graph.js";
import {
  OntologyProjectionSnapshotSchema,
  deriveFallbackFrontBackPaths,
  type OntologyProjectionSnapshot
} from "./ontology-projections.js";
import { maybeValidateSnapshot } from "./snapshot-validation.js";

const OntologyViewerNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().min(1),
  summary: z.string().default(""),
  status: z.string().min(1),
  confidence: z.number().min(0).max(1),
  domains: z.array(z.string().min(1)).default([]),
  channels: z.array(z.string().min(1)).default([]),
  actions: z.array(z.string().min(1)).default([]),
  evidencePaths: z.array(z.string().min(1)).default([]),
  degree: z.number().int().min(0),
  inDegree: z.number().int().min(0),
  outDegree: z.number().int().min(0),
  isHighlighted: z.boolean().default(false),
  attributePreview: z.array(z.object({ key: z.string().min(1), value: z.string().min(1) })).default([])
});

const OntologyViewerEdgeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  fromId: z.string().min(1),
  toId: z.string().min(1),
  label: z.string().default(""),
  status: z.string().min(1),
  confidence: z.number().min(0).max(1),
  isHighlighted: z.boolean().default(false)
});

const OntologyViewerPathSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  nodeIds: z.array(z.string().min(1)).default([]),
  edgeIds: z.array(z.string().min(1)).default([])
});

const OntologyViewerProjectionSummarySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(""),
  nodeCount: z.number().int().min(0),
  edgeCount: z.number().int().min(0),
  pathCount: z.number().int().min(0),
  statusCounts: z.record(z.string(), z.number().int().min(0)).default({})
});

const OntologyViewerSelectedProjectionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(""),
  statusCounts: z.record(z.string(), z.number().int().min(0)).default({}),
  totalNodeCount: z.number().int().min(0),
  totalEdgeCount: z.number().int().min(0),
  totalPathCount: z.number().int().min(0),
  filteredNodeCount: z.number().int().min(0),
  filteredEdgeCount: z.number().int().min(0),
  hiddenNodeCount: z.number().int().min(0),
  hiddenEdgeCount: z.number().int().min(0),
  availableNodeTypes: z.array(z.string().min(1)).default([]),
  representativePaths: z.array(OntologyViewerPathSchema).default([]),
  highlightedNodeIds: z.array(z.string().min(1)).default([]),
  highlightedEdgeIds: z.array(z.string().min(1)).default([]),
  nodes: z.array(OntologyViewerNodeSchema).default([]),
  edges: z.array(OntologyViewerEdgeSchema).default([])
});

export const OntologyViewerPayloadSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  workspaceDir: z.string().min(1),
  storage: z.object({
    kind: z.literal("filesystem-artifacts"),
    memoryRoot: z.string().min(1),
    graphSnapshotPath: z.string().min(1),
    projectionSnapshotPath: z.string().min(1),
    analysisSnapshotPath: z.string().min(1)
  }),
  graph: z.object({
    nodeCount: z.number().int().min(0),
    edgeCount: z.number().int().min(0),
    truncated: z.boolean().default(false),
    appliedLimits: z.array(z.string().min(1)).default([]),
    nodeTypeCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    edgeTypeCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    topDomains: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) })).default([]),
    topChannels: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) })).default([])
  }),
  filters: z.object({
    selectedProjectionId: z.string().min(1),
    nodeType: z.string().default("all"),
    search: z.string().default(""),
    focusMode: z.enum(["projection", "path"]).default("path"),
    selectedPathId: z.string().default(""),
    nodeLimit: z.number().int().min(1),
    edgeLimit: z.number().int().min(1)
  }),
  projections: z.array(OntologyViewerProjectionSummarySchema),
  selectedProjection: OntologyViewerSelectedProjectionSchema
});

export type OntologyViewerPayload = z.infer<typeof OntologyViewerPayloadSchema>;

export interface BuildOntologyViewerPayloadOptions {
  graph: OntologyGraphSnapshot;
  projections: OntologyProjectionSnapshot;
  memoryRoot: string;
  graphSnapshotPath: string;
  projectionSnapshotPath: string;
  analysisSnapshotPath: string;
  selectedProjectionId?: string;
  nodeType?: string;
  search?: string;
  focusMode?: "projection" | "path";
  selectedPathId?: string;
  nodeLimit?: number;
  edgeLimit?: number;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function countBy(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function previewAttributes(attributes: Record<string, unknown>): Array<{ key: string; value: string }> {
  return Object.entries(attributes)
    .filter(([, value]) => value != null && value !== "")
    .slice(0, 6)
    .map(([key, value]) => ({
      key,
      value: Array.isArray(value) ? value.join(", ") : String(value)
    }));
}

function edgeMembershipSet(paths: OntologyProjectionSnapshot["projections"][number]["representativePaths"]): Set<string> {
  const ids = new Set<string>();
  for (const path of paths) {
    for (const edgeId of path.edgeIds) {
      ids.add(edgeId);
    }
  }
  return ids;
}

function nodeMembershipSet(paths: OntologyProjectionSnapshot["projections"][number]["representativePaths"]): Set<string> {
  const ids = new Set<string>();
  for (const path of paths) {
    for (const nodeId of path.nodeIds) {
      ids.add(nodeId);
    }
  }
  return ids;
}

function textMatches(node: OntologyNode, searchLower: string): boolean {
  if (!searchLower) {
    return true;
  }
  const haystack = [
    node.id,
    node.type,
    node.label,
    node.summary,
    ...node.metadata.domains,
    ...node.metadata.channels,
    ...node.metadata.actions,
    ...node.metadata.moduleRoles,
    ...node.metadata.processRoles,
    ...node.metadata.evidencePaths,
    ...Object.entries(node.attributes).flatMap(([key, value]) => [key, Array.isArray(value) ? value.join(" ") : String(value ?? "")])
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(searchLower);
}

function degreeForNode(nodeId: string, edges: OntologyEdge[]): { degree: number; inDegree: number; outDegree: number } {
  let inDegree = 0;
  let outDegree = 0;
  for (const edge of edges) {
    if (edge.fromId === nodeId) {
      outDegree += 1;
    }
    if (edge.toId === nodeId) {
      inDegree += 1;
    }
  }
  return { degree: inDegree + outDegree, inDegree, outDegree };
}

function compareNodes(
  a: OntologyNode,
  b: OntologyNode,
  metrics: Map<string, { degree: number; inDegree: number; outDegree: number }>,
  highlightedNodes: Set<string>,
  pathNodes: Set<string>
): number {
  const aScore =
    (highlightedNodes.has(a.id) ? 100 : 0) +
    (pathNodes.has(a.id) ? 50 : 0) +
    (metrics.get(a.id)?.degree ?? 0) +
    (a.metadata.validatedStatus === "validated" ? 8 : 0) +
    (a.metadata.validatedStatus === "candidate" ? 4 : 0);
  const bScore =
    (highlightedNodes.has(b.id) ? 100 : 0) +
    (pathNodes.has(b.id) ? 50 : 0) +
    (metrics.get(b.id)?.degree ?? 0) +
    (b.metadata.validatedStatus === "validated" ? 8 : 0) +
    (b.metadata.validatedStatus === "candidate" ? 4 : 0);
  if (bScore !== aScore) {
    return bScore - aScore;
  }
  return a.label.localeCompare(b.label);
}

function compareEdges(a: OntologyEdge, b: OntologyEdge, highlightedEdges: Set<string>, pathEdges: Set<string>): number {
  const aScore = (highlightedEdges.has(a.id) ? 100 : 0) + (pathEdges.has(a.id) ? 50 : 0);
  const bScore = (highlightedEdges.has(b.id) ? 100 : 0) + (pathEdges.has(b.id) ? 50 : 0);
  if (bScore !== aScore) {
    return bScore - aScore;
  }
  return a.id.localeCompare(b.id);
}

function selectPathFocusedSubgraph(options: {
  path: z.infer<typeof OntologyViewerPathSchema>;
  filteredNodes: OntologyNode[];
  sortedEdges: OntologyEdge[];
  nodeLimit: number;
  edgeLimit: number;
}): { visibleNodes: OntologyNode[]; visibleEdges: OntologyEdge[] } {
  const { path, filteredNodes, sortedEdges, nodeLimit, edgeLimit } = options;
  const nodesById = new Map(filteredNodes.map((node) => [node.id, node]));
  const selectedNodeIds = new Set<string>();
  const selectedEdgeIds = new Set<string>();
  const visibleNodes: OntologyNode[] = [];
  const visibleEdges: OntologyEdge[] = [];

  const pushNode = (nodeId: string) => {
    if (visibleNodes.length >= nodeLimit || selectedNodeIds.has(nodeId)) return;
    const node = nodesById.get(nodeId);
    if (!node) return;
    selectedNodeIds.add(nodeId);
    visibleNodes.push(node);
  };

  const pushEdge = (edge: OntologyEdge) => {
    if (visibleEdges.length >= edgeLimit || selectedEdgeIds.has(edge.id)) return;
    if (!selectedNodeIds.has(edge.fromId) || !selectedNodeIds.has(edge.toId)) return;
    selectedEdgeIds.add(edge.id);
    visibleEdges.push(edge);
  };

  for (const nodeId of path.nodeIds) {
    pushNode(nodeId);
  }

  for (const edge of sortedEdges) {
    if (path.edgeIds.includes(edge.id)) {
      pushNode(edge.fromId);
      pushNode(edge.toId);
    }
  }

  for (const edge of sortedEdges) {
    if (visibleNodes.length >= nodeLimit && visibleEdges.length >= edgeLimit) break;
    const touchesPath = selectedNodeIds.has(edge.fromId) || selectedNodeIds.has(edge.toId);
    if (!touchesPath) continue;
    pushNode(edge.fromId);
    pushNode(edge.toId);
    pushEdge(edge);
  }

  for (const edge of sortedEdges) {
    if (visibleEdges.length >= edgeLimit) break;
    pushEdge(edge);
  }

  return { visibleNodes, visibleEdges };
}

function selectVisibleNodes(options: {
  sortedNodes: OntologyNode[];
  sortedEdges: OntologyEdge[];
  highlightedNodes: Set<string>;
  pathNodes: Set<string>;
  nodeLimit: number;
  edgeLimit: number;
}): OntologyNode[] {
  const { sortedNodes, sortedEdges, highlightedNodes, pathNodes, nodeLimit, edgeLimit } = options;
  if (sortedNodes.length <= nodeLimit) {
    return sortedNodes;
  }

  const nodesById = new Map(sortedNodes.map((node) => [node.id, node]));
  const selectedIds = new Set<string>();
  const visibleNodes: OntologyNode[] = [];
  const connectedTarget = Math.min(nodeLimit, Math.max(12, Math.min(nodeLimit, edgeLimit * 2)));
  const diversityTarget = Math.min(nodeLimit, Math.max(10, Math.ceil(nodeLimit * 0.45)));

  const pushNode = (nodeId: string) => {
    if (visibleNodes.length >= nodeLimit || selectedIds.has(nodeId)) {
      return;
    }
    const node = nodesById.get(nodeId);
    if (!node) {
      return;
    }
    selectedIds.add(nodeId);
    visibleNodes.push(node);
  };

  for (const node of sortedNodes) {
    if (highlightedNodes.has(node.id) || pathNodes.has(node.id)) {
      pushNode(node.id);
    }
  }

  for (const edge of sortedEdges) {
    if (visibleNodes.length >= connectedTarget) {
      break;
    }
    pushNode(edge.fromId);
    pushNode(edge.toId);
  }

  const nodesByType = new Map<string, OntologyNode[]>();
  for (const node of sortedNodes) {
    if (!nodesByType.has(node.type)) nodesByType.set(node.type, []);
    nodesByType.get(node.type)?.push(node);
  }
  const typeOrder = Array.from(nodesByType.keys()).sort((a, b) => a.localeCompare(b));
  for (let round = 0; round < 4 && visibleNodes.length < diversityTarget; round += 1) {
    for (const type of typeOrder) {
      const candidate = nodesByType.get(type)?.[round];
      if (!candidate) continue;
      pushNode(candidate.id);
      if (visibleNodes.length >= diversityTarget) break;
    }
  }

  for (const node of sortedNodes) {
    pushNode(node.id);
    if (visibleNodes.length >= nodeLimit) {
      break;
    }
  }

  return visibleNodes;
}

export function buildOntologyViewerPayload(options: BuildOntologyViewerPayloadOptions): OntologyViewerPayload {
  const graph = maybeValidateSnapshot(OntologyGraphSnapshotSchema, options.graph);
  const projections = maybeValidateSnapshot(OntologyProjectionSnapshotSchema, options.projections);
  const nodeLimit = Math.max(16, Math.min(160, options.nodeLimit ?? 72));
  const edgeLimit = Math.max(24, Math.min(320, options.edgeLimit ?? 140));
  const requestedProjectionId = String(options.selectedProjectionId || "").trim();
  const selectedProjection =
    projections.projections.find((projection) => projection.id === requestedProjectionId) ??
    projections.projections.find((projection) => projection.type === "front-back-flow" && projection.nodeIds.length > 0) ??
    [...projections.projections].sort((a, b) => {
      const aScore = a.representativePaths.length * 10 + a.nodeIds.length + a.edgeIds.length;
      const bScore = b.representativePaths.length * 10 + b.nodeIds.length + b.edgeIds.length;
      return bScore - aScore;
    })[0];

  if (!selectedProjection) {
    return maybeValidateSnapshot(OntologyViewerPayloadSchema, {
      version: 1,
      generatedAt: graph.generatedAt,
      workspaceDir: graph.workspaceDir,
      storage: {
        kind: "filesystem-artifacts",
        memoryRoot: options.memoryRoot,
        graphSnapshotPath: options.graphSnapshotPath,
        projectionSnapshotPath: options.projectionSnapshotPath,
        analysisSnapshotPath: options.analysisSnapshotPath
      },
      graph: {
        nodeCount: graph.summary.nodeCount,
        edgeCount: graph.summary.edgeCount,
        truncated: graph.summary.truncated,
        appliedLimits: graph.summary.appliedLimits,
        nodeTypeCounts: graph.summary.nodeTypeCounts,
        edgeTypeCounts: graph.summary.edgeTypeCounts,
        topDomains: graph.summary.topDomains,
        topChannels: graph.summary.topChannels
      },
      filters: {
        selectedProjectionId: requestedProjectionId || "",
        nodeType: String(options.nodeType || "all"),
        search: String(options.search || ""),
        focusMode: options.focusMode || "path",
        selectedPathId: String(options.selectedPathId || ""),
        nodeLimit,
        edgeLimit
      },
      projections: [],
      selectedProjection: {
        id: "none",
        type: "code-structure",
        title: "No Projection",
        summary: "",
        statusCounts: {},
        totalNodeCount: 0,
        totalEdgeCount: 0,
        totalPathCount: 0,
        filteredNodeCount: 0,
        filteredEdgeCount: 0,
        hiddenNodeCount: 0,
        hiddenEdgeCount: 0,
        availableNodeTypes: [],
        representativePaths: [],
        highlightedNodeIds: [],
        highlightedEdgeIds: [],
        nodes: [],
        edges: []
      }
    });
  }

  const graphNodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const graphEdgesById = new Map(graph.edges.map((edge) => [edge.id, edge]));

  const projectionNodes = selectedProjection.nodeIds.map((id) => graphNodesById.get(id)).filter(Boolean) as OntologyNode[];
  const projectionEdges = selectedProjection.edgeIds.map((id) => graphEdgesById.get(id)).filter(Boolean) as OntologyEdge[];
  const effectiveRepresentativePaths =
    selectedProjection.representativePaths.length > 0
      ? selectedProjection.representativePaths
      : selectedProjection.type === "front-back-flow"
        ? deriveFallbackFrontBackPaths({
            ontologyGraph: graph,
            frontBackNodeIds: selectedProjection.nodeIds,
            frontBackEdgeIds: selectedProjection.edgeIds
          })
        : [];
  const effectiveHighlightedNodeIds =
    selectedProjection.highlightedNodeIds.length > 0
      ? selectedProjection.highlightedNodeIds
      : effectiveRepresentativePaths.flatMap((path) => path.nodeIds).slice(0, 24);
  const effectiveHighlightedEdgeIds =
    selectedProjection.highlightedEdgeIds.length > 0
      ? selectedProjection.highlightedEdgeIds
      : effectiveRepresentativePaths.flatMap((path) => path.edgeIds).slice(0, 24);
  const searchLower = String(options.search || "").trim().toLowerCase();
  const requestedNodeType = String(options.nodeType || "all").trim();
  const requestedFocusMode =
    options.focusMode ??
    (selectedProjection.type === "front-back-flow" || selectedProjection.type === "integration" ? "path" : "projection");
  const highlightedNodes = new Set(effectiveHighlightedNodeIds);
  const highlightedEdges = new Set(effectiveHighlightedEdgeIds);
  const pathNodes = nodeMembershipSet(effectiveRepresentativePaths);
  const pathEdges = edgeMembershipSet(effectiveRepresentativePaths);

  const filteredProjectionNodes = projectionNodes.filter((node) => {
    if (requestedNodeType && requestedNodeType !== "all" && node.type !== requestedNodeType) {
      return false;
    }
    return textMatches(node, searchLower);
  });
  const filteredNodeIds = new Set(filteredProjectionNodes.map((node) => node.id));
  const filteredProjectionEdges = projectionEdges.filter(
    (edge) => filteredNodeIds.has(edge.fromId) && filteredNodeIds.has(edge.toId)
  );

  const metrics = new Map<string, { degree: number; inDegree: number; outDegree: number }>(
    filteredProjectionNodes.map((node) => [node.id, degreeForNode(node.id, filteredProjectionEdges)])
  );

  const sortedNodes = [...filteredProjectionNodes].sort((a, b) =>
    compareNodes(a, b, metrics, highlightedNodes, pathNodes)
  );
  const candidateEdges = [...filteredProjectionEdges].sort((a, b) => compareEdges(a, b, highlightedEdges, pathEdges));
  const activeRepresentativePath =
    requestedFocusMode === "path"
      ? effectiveRepresentativePaths.find((path) => path.id === String(options.selectedPathId || "").trim()) ??
        effectiveRepresentativePaths[0]
      : undefined;
  const focused =
    requestedFocusMode === "path" && activeRepresentativePath
      ? selectPathFocusedSubgraph({
          path: activeRepresentativePath,
          filteredNodes: filteredProjectionNodes,
          sortedEdges: candidateEdges,
          nodeLimit,
          edgeLimit
        })
      : null;
  const visibleNodes = focused?.visibleNodes ?? selectVisibleNodes({
    sortedNodes,
    sortedEdges: candidateEdges,
    highlightedNodes,
    pathNodes,
    nodeLimit,
    edgeLimit
  });
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const sortedEdges = candidateEdges.filter((edge) => visibleNodeIds.has(edge.fromId) && visibleNodeIds.has(edge.toId));
  const visibleEdges = focused?.visibleEdges ?? sortedEdges.slice(0, edgeLimit);
  const visibleEdgeIds = new Set(visibleEdges.map((edge) => edge.id));

  const payload = {
    version: 1 as const,
    generatedAt: graph.generatedAt,
    workspaceDir: graph.workspaceDir,
    storage: {
      kind: "filesystem-artifacts" as const,
      memoryRoot: options.memoryRoot,
      graphSnapshotPath: options.graphSnapshotPath,
      projectionSnapshotPath: options.projectionSnapshotPath,
      analysisSnapshotPath: options.analysisSnapshotPath
    },
    graph: {
      nodeCount: graph.summary.nodeCount,
      edgeCount: graph.summary.edgeCount,
      truncated: graph.summary.truncated,
      appliedLimits: graph.summary.appliedLimits,
      nodeTypeCounts: graph.summary.nodeTypeCounts,
      edgeTypeCounts: graph.summary.edgeTypeCounts,
      topDomains: graph.summary.topDomains,
      topChannels: graph.summary.topChannels
    },
    filters: {
      selectedProjectionId: selectedProjection.id,
      nodeType: requestedNodeType || "all",
      search: String(options.search || ""),
      focusMode: requestedFocusMode,
      selectedPathId: activeRepresentativePath?.id || "",
      nodeLimit,
      edgeLimit
    },
    projections: projections.projections.map((projection) => ({
      id: projection.id,
      type: projection.type,
      title: projection.title,
      summary: projection.summary,
      nodeCount: projection.nodeIds.length,
      edgeCount: projection.edgeIds.length,
      pathCount: projection.representativePaths.length,
      statusCounts: projection.statusCounts
    })),
    selectedProjection: {
      id: selectedProjection.id,
      type: selectedProjection.type,
      title: selectedProjection.title,
      summary: selectedProjection.summary,
      statusCounts: selectedProjection.statusCounts,
      totalNodeCount: selectedProjection.nodeIds.length,
      totalEdgeCount: selectedProjection.edgeIds.length,
      totalPathCount: effectiveRepresentativePaths.length,
      filteredNodeCount: filteredProjectionNodes.length,
      filteredEdgeCount: filteredProjectionEdges.length,
      hiddenNodeCount: Math.max(0, filteredProjectionNodes.length - visibleNodes.length),
      hiddenEdgeCount: Math.max(0, filteredProjectionEdges.length - visibleEdges.length),
      availableNodeTypes: unique(projectionNodes.map((node) => node.type)).sort((a, b) => a.localeCompare(b)),
      representativePaths: effectiveRepresentativePaths.slice(0, 12),
      highlightedNodeIds: effectiveHighlightedNodeIds.filter((id) => visibleNodeIds.has(id)),
      highlightedEdgeIds: effectiveHighlightedEdgeIds.filter((id) => visibleEdgeIds.has(id)),
      nodes: visibleNodes.map((node) => {
        const nodeMetrics = metrics.get(node.id) ?? { degree: 0, inDegree: 0, outDegree: 0 };
        return {
          id: node.id,
          type: node.type,
          label: node.label,
          summary: node.summary,
          status: node.metadata.validatedStatus,
          confidence: node.metadata.confidence,
          domains: node.metadata.domains,
          channels: node.metadata.channels,
          actions: node.metadata.actions,
          evidencePaths: node.metadata.evidencePaths.slice(0, 8),
          degree: nodeMetrics.degree,
          inDegree: nodeMetrics.inDegree,
          outDegree: nodeMetrics.outDegree,
          isHighlighted: highlightedNodes.has(node.id) || pathNodes.has(node.id),
          attributePreview: previewAttributes(node.attributes)
        };
      }),
      edges: visibleEdges.map((edge) => ({
        id: edge.id,
        type: edge.type,
        fromId: edge.fromId,
        toId: edge.toId,
        label: edge.label,
        status: edge.metadata.validatedStatus,
        confidence: edge.metadata.confidence,
        isHighlighted: highlightedEdges.has(edge.id) || pathEdges.has(edge.id)
      }))
    }
  };

  return maybeValidateSnapshot(OntologyViewerPayloadSchema, payload);
}
