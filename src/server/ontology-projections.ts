import { z } from "zod";
import { OntologyGraphSnapshotSchema, type OntologyGraphSnapshot } from "./ontology-graph.js";
import { maybeValidateSnapshot } from "./snapshot-validation.js";

const OntologyProjectionTypeSchema = z.enum([
  "code-structure",
  "front-back-flow",
  "integration",
  "knowledge-lifecycle"
]);

const OntologyProjectionPathSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  nodeIds: z.array(z.string().min(1)).default([]),
  edgeIds: z.array(z.string().min(1)).default([])
});

const OntologyProjectionSchema = z.object({
  id: z.string().min(1),
  type: OntologyProjectionTypeSchema,
  title: z.string().min(1),
  summary: z.string().default(""),
  nodeIds: z.array(z.string().min(1)).default([]),
  edgeIds: z.array(z.string().min(1)).default([]),
  representativePaths: z.array(OntologyProjectionPathSchema).default([]),
  statusCounts: z.record(z.string(), z.number().int().min(0)).default({}),
  highlightedNodeIds: z.array(z.string().min(1)).default([]),
  highlightedEdgeIds: z.array(z.string().min(1)).default([])
});

const OntologyProjectionSummarySchema = z.object({
  projectionCount: z.number().int().min(0),
  truncated: z.boolean().default(false),
  appliedLimits: z.array(z.string().min(1)).default([]),
  projectionTypeCounts: z.record(z.string(), z.number().int().min(0)),
  topProjectionTypes: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) })).default([]),
  totalRepresentativePathCount: z.number().int().min(0),
  largestProjectionType: z.string().default(""),
  lifecycleProjectionPathCount: z.number().int().min(0)
});

export const OntologyProjectionSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  workspaceDir: z.string().min(1),
  projections: z.array(OntologyProjectionSchema),
  summary: OntologyProjectionSummarySchema
});

export type OntologyProjectionSnapshot = z.infer<typeof OntologyProjectionSnapshotSchema>;

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

function countTop(values: string[], limit = 10): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.id.localeCompare(b.id)))
    .slice(0, limit);
}

function nodeTypeGroups(snapshot: OntologyGraphSnapshot) {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const edgesById = new Map(snapshot.edges.map((edge) => [edge.id, edge]));
  return { nodesById, edgesById };
}

function projectionStatusCounts(nodeIds: string[], nodesById: Map<string, OntologyGraphSnapshot["nodes"][number]>): Record<string, number> {
  return countBy(
    nodeIds
      .map((nodeId) => nodesById.get(nodeId)?.metadata.validatedStatus ?? "")
      .filter(Boolean)
  );
}

function flowNodeRank(type: string): number {
  const ranks: Record<string, number> = {
    route: 1,
    "ui-action": 2,
    api: 3,
    "gateway-handler": 4,
    controller: 5,
    service: 6,
    "decision-path": 7,
    "async-channel": 8,
    "retrieval-unit": 9,
    path: 10
  };
  return ranks[type] ?? 99;
}

function codeStructureNodeRank(type: string): number {
  const ranks: Record<string, number> = {
    module: 1,
    file: 2,
    symbol: 3,
    controller: 4,
    service: 5,
    "data-query": 6,
    "data-table": 7,
    "data-store": 8,
    "async-channel": 9,
    "data-contract": 10,
    "control-guard": 11,
    "decision-path": 12
  };
  return ranks[type] ?? 99;
}

function codeStructureEdgeRank(type: string): number {
  const ranks: Record<string, number> = {
    contains: 1,
    declares: 2,
    "maps-to": 3,
    "depends-on": 4,
    calls: 5,
    "proxies-to": 6,
    "uses-store": 7,
    "dispatches-to": 8,
    "consumes-from": 9,
    "propagates-contract": 10,
    "accepts-contract": 11,
    "returns-contract": 12,
    "queries-table": 13,
    "maps-to-table": 14,
    "validates": 15,
    "branches-to": 16
  };
  return ranks[type] ?? 99;
}

function scoreFrontBackPath(options: {
  nodeIds: string[];
  edgeIds: string[];
  ontologyGraph: OntologyGraphSnapshot;
}): number {
  const { nodeIds, edgeIds, ontologyGraph } = options;
  const nodesById = new Map(ontologyGraph.nodes.map((node) => [node.id, node]));
  const edgesById = new Map(ontologyGraph.edges.map((edge) => [edge.id, edge]));
  const nodeTypes = nodeIds.map((id) => nodesById.get(id)?.type ?? "");
  const uniqueNodeTypes = new Set(nodeTypes.filter(Boolean));
  const edges = edgeIds.map((id) => edgesById.get(id)).filter(Boolean) as OntologyGraphSnapshot["edges"];
  const edgeTypes = edges.map((edge) => edge.type);
  const routeLikeCount = nodeTypes.filter((type) => ["route", "ui-action", "api"].includes(type)).length;
  const backendCount = nodeTypes.filter((type) => ["gateway-handler", "controller", "service"].includes(type)).length;
  const transitionCount = edgeTypes.filter((type) => ["routes-to", "proxies-to", "calls"].includes(type)).length;
  const onlyServiceFamily = uniqueNodeTypes.size === 1 && uniqueNodeTypes.has("service");

  let score = 0;
  score += uniqueNodeTypes.size * 12;
  score += routeLikeCount * 14;
  score += backendCount * 12;
  score += transitionCount * 18;
  score += edgeTypes.filter((type) => type === "transitions-to").length * 4;
  score += Math.min(nodeIds.length, 6) * 3;

  if (nodeTypes.includes("api")) score += 24;
  if (nodeTypes.includes("controller")) score += 24;
  if (nodeTypes.includes("service")) score += 12;
  if (nodeTypes.includes("gateway-handler")) score += 16;
  if (nodeTypes.includes("route") || nodeTypes.includes("ui-action")) score += 20;

  if (onlyServiceFamily) score -= 60;
  if (routeLikeCount === 0) score -= 22;
  if (backendCount === 0) score -= 18;
  if (transitionCount === 0) score -= 18;

  return score;
}

export function deriveFallbackFrontBackPaths(options: {
  ontologyGraph: OntologyGraphSnapshot;
  frontBackNodeIds: string[];
  frontBackEdgeIds: string[];
}): Array<z.infer<typeof OntologyProjectionPathSchema>> {
  const { ontologyGraph, frontBackNodeIds, frontBackEdgeIds } = options;
  const nodesById = new Map(ontologyGraph.nodes.map((node) => [node.id, node]));
  const edges = frontBackEdgeIds
    .map((id) => ontologyGraph.edges.find((edge) => edge.id === id))
    .filter((edge): edge is OntologyGraphSnapshot["edges"][number] => Boolean(edge));
  const adjacency = new Map<string, typeof edges>();
  const incomingCounts = new Map<string, number>();

  for (const edge of edges) {
    if (!adjacency.has(edge.fromId)) adjacency.set(edge.fromId, []);
    adjacency.get(edge.fromId)?.push(edge);
    incomingCounts.set(edge.toId, (incomingCounts.get(edge.toId) ?? 0) + 1);
  }

  for (const outgoing of adjacency.values()) {
    outgoing.sort((a, b) => {
      const aTo = nodesById.get(a.toId);
      const bTo = nodesById.get(b.toId);
      const typeDiff = flowNodeRank(aTo?.type ?? "") - flowNodeRank(bTo?.type ?? "");
      if (typeDiff !== 0) return typeDiff;
      const confidenceDiff = (b.metadata.confidence ?? 0) - (a.metadata.confidence ?? 0);
      if (confidenceDiff !== 0) return confidenceDiff;
      return a.id.localeCompare(b.id);
    });
  }

  const candidateStarts = frontBackNodeIds
    .map((id) => nodesById.get(id))
    .filter((node): node is OntologyGraphSnapshot["nodes"][number] => Boolean(node))
    .filter((node) => node.type !== "retrieval-unit")
    .sort((a, b) => {
      const aStart = incomingCounts.get(a.id) ?? 0;
      const bStart = incomingCounts.get(b.id) ?? 0;
      const incomingDiff = aStart - bStart;
      if (incomingDiff !== 0) return incomingDiff;
      const rankDiff = flowNodeRank(a.type) - flowNodeRank(b.type);
      if (rankDiff !== 0) return rankDiff;
      const confDiff = (b.metadata.confidence ?? 0) - (a.metadata.confidence ?? 0);
      if (confDiff !== 0) return confDiff;
      return a.label.localeCompare(b.label);
    });

  const paths: Array<z.infer<typeof OntologyProjectionPathSchema>> = [];
  const seen = new Set<string>();

  for (const start of candidateStarts) {
    const nodeIds = [start.id];
    const edgeIds: string[] = [];
    const visited = new Set<string>([start.id]);
    let currentId = start.id;

    for (let depth = 0; depth < 8; depth += 1) {
      const nextEdge = (adjacency.get(currentId) ?? []).find((edge) => !visited.has(edge.toId));
      if (!nextEdge) break;
      edgeIds.push(nextEdge.id);
      nodeIds.push(nextEdge.toId);
      visited.add(nextEdge.toId);
      currentId = nextEdge.toId;
    }

    if (nodeIds.length < 3 || edgeIds.length < 2) continue;
    const key = nodeIds.join("->");
    if (seen.has(key)) continue;
    seen.add(key);
    const labels = nodeIds
      .map((id) => nodesById.get(id)?.label)
      .filter(Boolean)
      .slice(0, 4);
    paths.push({
      id: `path:fallback:${start.id}`,
      label: labels.join(" -> "),
      nodeIds,
      edgeIds
    });
    if (paths.length >= 12) break;
  }

  return paths;
}

function deriveCodeStructurePaths(options: {
  ontologyGraph: OntologyGraphSnapshot;
  nodeIds: string[];
  edgeIds: string[];
}): Array<z.infer<typeof OntologyProjectionPathSchema>> {
  const { ontologyGraph, nodeIds, edgeIds } = options;
  const nodeSet = new Set(nodeIds);
  const nodesById = new Map(
    ontologyGraph.nodes.filter((node) => nodeSet.has(node.id)).map((node) => [node.id, node])
  );
  const edges = edgeIds
    .map((id) => ontologyGraph.edges.find((edge) => edge.id === id))
    .filter((edge): edge is OntologyGraphSnapshot["edges"][number] => Boolean(edge))
    .sort((a, b) => {
      const rankDiff = codeStructureEdgeRank(a.type) - codeStructureEdgeRank(b.type);
      if (rankDiff !== 0) return rankDiff;
      const confidenceDiff = (b.metadata.confidence ?? 0) - (a.metadata.confidence ?? 0);
      if (confidenceDiff !== 0) return confidenceDiff;
      return a.id.localeCompare(b.id);
    });
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  const adjacency = new Map<string, OntologyGraphSnapshot["edges"]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.fromId)) adjacency.set(edge.fromId, []);
    adjacency.get(edge.fromId)?.push(edge);
  }
  for (const bucket of adjacency.values()) {
    bucket.sort((a, b) => {
      const rankDiff = codeStructureEdgeRank(a.type) - codeStructureEdgeRank(b.type);
      if (rankDiff !== 0) return rankDiff;
      const confidenceDiff = (b.metadata.confidence ?? 0) - (a.metadata.confidence ?? 0);
      if (confidenceDiff !== 0) return confidenceDiff;
      return a.id.localeCompare(b.id);
    });
  }

  const starts = nodeIds
    .map((id) => nodesById.get(id))
    .filter((node): node is OntologyGraphSnapshot["nodes"][number] => Boolean(node))
    .sort((a, b) => {
      const rankDiff = codeStructureNodeRank(a.type) - codeStructureNodeRank(b.type);
      if (rankDiff !== 0) return rankDiff;
      const confidenceDiff = (b.metadata.confidence ?? 0) - (a.metadata.confidence ?? 0);
      if (confidenceDiff !== 0) return confidenceDiff;
      return a.label.localeCompare(b.label);
    });

  const paths: Array<z.infer<typeof OntologyProjectionPathSchema>> = [];
  const seen = new Set<string>();
  const scorePath = (pathEdgeIds: string[], pathNodeIds: string[]) => {
    const nodeTypes = pathNodeIds.map((id) => nodesById.get(id)?.type ?? "unknown");
    const typeSet = new Set(nodeTypes);
    const moduleCount = nodeTypes.filter((type) => type === "module").length;
    const fileCount = nodeTypes.filter((type) => type === "file").length;
    const symbolCount = nodeTypes.filter((type) => type === "symbol").length;
    const runtimeCount = nodeTypes.filter((type) => ["controller", "service", "data-query", "data-table", "data-store", "async-channel"].includes(type)).length;
    return (
      pathEdgeIds.length * 100 +
      pathNodeIds.length * 20 +
      typeSet.size * 80 +
      (fileCount > 0 ? 60 : 0) +
      (symbolCount > 0 ? 80 : 0) +
      (runtimeCount > 0 ? 50 : 0) -
      (fileCount === 0 && symbolCount === 0 && runtimeCount === 0 ? 10000 : 0) -
      (typeSet.size === 1 ? 5000 : 0) -
      (moduleCount >= pathNodeIds.length - 1 ? 220 : 0) -
      pathEdgeIds.reduce((sum, edgeId) => {
        const edge = edgesById.get(edgeId);
        return sum + (edge ? codeStructureEdgeRank(edge.type) : 99);
      }, 0)
    );
  };

  const exploreLongestPath = (
    currentId: string,
    visited: Set<string>,
    nodePath: string[],
    edgePath: string[],
    depthRemaining: number
  ): { nodeIds: string[]; edgeIds: string[] } => {
    let best = {
      nodeIds: [...nodePath],
      edgeIds: [...edgePath]
    };
    if (depthRemaining <= 0) {
      return best;
    }
    for (const nextEdge of adjacency.get(currentId) ?? []) {
      if (visited.has(nextEdge.toId)) {
        continue;
      }
      visited.add(nextEdge.toId);
      nodePath.push(nextEdge.toId);
      edgePath.push(nextEdge.id);
      const candidate = exploreLongestPath(nextEdge.toId, visited, nodePath, edgePath, depthRemaining - 1);
      if (
        scorePath(candidate.edgeIds, candidate.nodeIds) >
        scorePath(best.edgeIds, best.nodeIds)
      ) {
        best = candidate;
      }
      edgePath.pop();
      nodePath.pop();
      visited.delete(nextEdge.toId);
    }
    return best;
  };

  for (const start of starts) {
    const bestPath = exploreLongestPath(start.id, new Set([start.id]), [start.id], [], 6);
    if (bestPath.nodeIds.length < 3 || bestPath.edgeIds.length < 2) {
      continue;
    }

    const key = bestPath.nodeIds.join("->");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    paths.push({
      id: `path:structure:${start.id}`,
      label: bestPath.nodeIds
        .map((id) => nodesById.get(id)?.label)
        .filter(Boolean)
        .slice(0, 4)
        .join(" -> "),
      nodeIds: bestPath.nodeIds,
      edgeIds: bestPath.edgeIds
    });
  }

  return paths
    .sort(
      (a, b) =>
        scorePath(b.edgeIds, b.nodeIds) - scorePath(a.edgeIds, a.nodeIds) ||
        a.id.localeCompare(b.id)
    )
    .slice(0, 12);
}

function pickLargestProjectionType(projections: OntologyProjectionSnapshot["projections"]): string {
  const sorted = [...projections].sort((a, b) => {
    const sizeDiff = b.nodeIds.length + b.edgeIds.length - (a.nodeIds.length + a.edgeIds.length);
    return sizeDiff !== 0 ? sizeDiff : a.type.localeCompare(b.type);
  });
  return sorted[0]?.type ?? "";
}

export function buildOntologyProjectionSnapshot(options: { ontologyGraph: OntologyGraphSnapshot }): OntologyProjectionSnapshot {
  const ontologyGraph = maybeValidateSnapshot(OntologyGraphSnapshotSchema, options.ontologyGraph);
  const { nodesById } = nodeTypeGroups(ontologyGraph);

  const codeStructureNodeIds = ontologyGraph.nodes
    .filter((node) => ["module", "file", "symbol", "ui-action", "gateway-handler", "controller", "service", "control-guard", "decision-path", "data-contract", "data-model", "data-query", "data-table", "cache-key", "data-store", "async-channel"].includes(node.type))
    .map((node) => node.id);
  const codeStructureEdgeIds = ontologyGraph.edges
    .filter((edge) => ["contains", "declares", "maps-to", "calls", "proxies-to", "depends-on", "supports-module-role", "uses-store", "dispatches-to", "consumes-from", "transitions-to", "propagates-contract", "emits-contract", "receives-contract", "accepts-contract", "returns-contract", "stores-model", "maps-to-table", "queries-table", "uses-cache-key", "validates", "branches-to"].includes(edge.type))
    .map((edge) => edge.id);
  const codeStructurePaths = deriveCodeStructurePaths({
    ontologyGraph,
    nodeIds: codeStructureNodeIds,
    edgeIds: codeStructureEdgeIds
  });

  const flowPathsFromUnits = ontologyGraph.nodes
    .filter((node) => node.type === "retrieval-unit" && node.attributes.unitType === "flow")
    .map((node) => ({
      id: `path:${node.id}`,
      label: node.label,
      nodeIds: unique([node.id, ...((node.attributes.entityIds as string[] | undefined) ?? [])]),
      edgeIds: ontologyGraph.edges.filter((edge) => edge.fromId === node.id && edge.type.startsWith("references-")).map((edge) => edge.id)
    }))
    .sort((a, b) => {
      const scoreDiff =
        scoreFrontBackPath({ nodeIds: b.nodeIds, edgeIds: b.edgeIds, ontologyGraph }) -
        scoreFrontBackPath({ nodeIds: a.nodeIds, edgeIds: a.edgeIds, ontologyGraph });
      if (scoreDiff !== 0) return scoreDiff;
      return a.label.localeCompare(b.label);
    })
    .slice(0, 12);

  const frontBackNodeIds = ontologyGraph.nodes
    .filter((node) => ["route", "ui-action", "api", "gateway-handler", "controller", "service", "decision-path", "async-channel", "retrieval-unit"].includes(node.type) && (node.type !== "retrieval-unit" || node.attributes.unitType === "flow"))
    .map((node) => node.id);
  const frontBackEdgeIds = ontologyGraph.edges
    .filter((edge) => ["routes-to", "calls", "proxies-to", "branches-to", "dispatches-to", "consumes-from", "transitions-to", "propagates-contract", "emits-contract", "receives-contract", "maps-to", "references-entity", "references-edge"].includes(edge.type))
    .map((edge) => edge.id);
  const flowPaths = flowPathsFromUnits.length > 0
    ? flowPathsFromUnits
    : deriveFallbackFrontBackPaths({ ontologyGraph, frontBackNodeIds, frontBackEdgeIds });

  const integrationNodeIds = ontologyGraph.nodes
    .filter((node) => node.type === "eai-interface" || node.type === "data-store" || node.type === "async-channel" || node.type === "data-contract" || node.type === "data-query" || node.type === "data-table" || node.type === "cache-key" || node.type === "control-guard" || node.type === "decision-path" || node.type === "gateway-handler" || node.metadata.channels.length > 0 || (node.type === "retrieval-unit" && (node.attributes.unitType === "eai-link" || node.attributes.unitType === "flow" || node.attributes.unitType === "resource-schema")))
    .map((node) => node.id);
  const integrationEdgeIds = ontologyGraph.edges
    .filter((edge) => ["uses-eai", "uses-store", "dispatches-to", "consumes-from", "transitions-to", "propagates-contract", "emits-contract", "receives-contract", "accepts-contract", "returns-contract", "maps-to-table", "queries-table", "uses-cache-key", "validates", "branches-to", "belongs-to-channel", "references-entity", "routes-to", "proxies-to"].includes(edge.type))
    .map((edge) => edge.id);
  const integrationPaths = ontologyGraph.nodes
    .filter((node) => node.type === "retrieval-unit" && (node.attributes.unitType === "eai-link" || node.metadata.channels.length > 0))
    .slice(0, 12)
    .map((node) => ({
      id: `path:${node.id}`,
      label: node.label,
      nodeIds: unique([node.id, ...((node.attributes.entityIds as string[] | undefined) ?? [])]),
      edgeIds: ontologyGraph.edges.filter((edge) => edge.fromId === node.id && edge.type.startsWith("references-")).map((edge) => edge.id)
    }));

  const lifecycleNodeIds = ontologyGraph.nodes
    .filter((node) => ["knowledge-cluster", "retrieval-unit", "feedback-record", "replay-candidate", "path"].includes(node.type))
    .map((node) => node.id);
  const lifecycleEdgeIds = ontologyGraph.edges
    .filter((edge) => ["targets-node", "targets-edge", "targets-path", "references-entity", "references-edge"].includes(edge.type))
    .map((edge) => edge.id);
  const lifecyclePaths = ontologyGraph.nodes
    .filter((node) => node.type === "feedback-record")
    .slice(0, 12)
    .map((node) => ({
      id: `path:${node.id}`,
      label: `${String(node.attributes.verdict ?? "feedback")} ${String(node.attributes.questionType ?? "")}`.trim(),
      nodeIds: unique([
        node.id,
        ...ontologyGraph.edges.filter((edge) => edge.fromId === node.id).map((edge) => edge.toId)
      ]),
      edgeIds: ontologyGraph.edges.filter((edge) => edge.fromId === node.id).map((edge) => edge.id)
    }));

  const projections: Array<z.infer<typeof OntologyProjectionSchema>> = [
    {
      id: "projection:code-structure",
      type: "code-structure" as const,
      title: "Code Structure",
      summary: `modules/files/symbols/services=${codeStructureNodeIds.length}, edges=${codeStructureEdgeIds.length}, representativeStructures=${codeStructurePaths.length}`,
      nodeIds: unique(codeStructureNodeIds),
      edgeIds: unique(codeStructureEdgeIds),
      representativePaths: codeStructurePaths,
      statusCounts: projectionStatusCounts(codeStructureNodeIds, nodesById),
      highlightedNodeIds: codeStructurePaths.flatMap((entry) => entry.nodeIds).slice(0, 20),
      highlightedEdgeIds: codeStructurePaths.flatMap((entry) => entry.edgeIds).slice(0, 20)
    },
    {
      id: "projection:front-back-flow",
      type: "front-back-flow" as const,
      title: "Front to Back Flow",
      summary: `flow nodes=${frontBackNodeIds.length}, representativeFlows=${flowPaths.length}`,
      nodeIds: unique(frontBackNodeIds),
      edgeIds: unique(frontBackEdgeIds),
      representativePaths: flowPaths,
      statusCounts: projectionStatusCounts(frontBackNodeIds, nodesById),
      highlightedNodeIds: flowPaths.flatMap((entry) => entry.nodeIds).slice(0, 16),
      highlightedEdgeIds: flowPaths.flatMap((entry) => entry.edgeIds).slice(0, 16)
    },
    {
      id: "projection:integration",
      type: "integration" as const,
      title: "Integration / Channel",
      summary: `integration nodes=${integrationNodeIds.length}, representativeIntegrations=${integrationPaths.length}`,
      nodeIds: unique(integrationNodeIds),
      edgeIds: unique(integrationEdgeIds),
      representativePaths: integrationPaths,
      statusCounts: projectionStatusCounts(integrationNodeIds, nodesById),
      highlightedNodeIds: integrationPaths.flatMap((entry) => entry.nodeIds).slice(0, 16),
      highlightedEdgeIds: integrationPaths.flatMap((entry) => entry.edgeIds).slice(0, 16)
    },
    {
      id: "projection:knowledge-lifecycle",
      type: "knowledge-lifecycle" as const,
      title: "Knowledge Lifecycle",
      summary: `feedback/replay/lifecycle nodes=${lifecycleNodeIds.length}, representativePaths=${lifecyclePaths.length}`,
      nodeIds: unique(lifecycleNodeIds),
      edgeIds: unique(lifecycleEdgeIds),
      representativePaths: lifecyclePaths,
      statusCounts: projectionStatusCounts(lifecycleNodeIds, nodesById),
      highlightedNodeIds: lifecyclePaths.flatMap((entry) => entry.nodeIds).slice(0, 16),
      highlightedEdgeIds: lifecyclePaths.flatMap((entry) => entry.edgeIds).slice(0, 16)
    }
  ].map((projection) => maybeValidateSnapshot(OntologyProjectionSchema, projection));

  return maybeValidateSnapshot(OntologyProjectionSnapshotSchema, {
    version: 1,
    generatedAt: ontologyGraph.generatedAt,
    workspaceDir: ontologyGraph.workspaceDir,
    projections,
    summary: {
      projectionCount: projections.length,
      truncated: ontologyGraph.summary.truncated,
      appliedLimits: ontologyGraph.summary.appliedLimits,
      projectionTypeCounts: countBy(projections.map((projection) => projection.type)),
      topProjectionTypes: countTop(projections.map((projection) => projection.type)),
      totalRepresentativePathCount: projections.reduce((sum, projection) => sum + projection.representativePaths.length, 0),
      largestProjectionType: pickLargestProjectionType(projections),
      lifecycleProjectionPathCount: projections.find((projection) => projection.type === "knowledge-lifecycle")?.representativePaths.length ?? 0
    }
  });
}

export function buildOntologyProjectionMarkdown(snapshot: OntologyProjectionSnapshot): string {
  const lines: string[] = [];
  lines.push("# Ontology Projections");
  lines.push("");
  lines.push(`- generatedAt: ${snapshot.generatedAt}`);
  lines.push(`- workspaceDir: ${snapshot.workspaceDir.replace(/\\/g, "/")}`);
  lines.push(`- projectionCount: ${snapshot.summary.projectionCount}`);
  lines.push(`- truncated: ${snapshot.summary.truncated ? "yes" : "no"}`);
  if (snapshot.summary.appliedLimits.length > 0) {
    lines.push(`- appliedLimits: ${snapshot.summary.appliedLimits.join(", ")}`);
  }
  lines.push(`- totalRepresentativePathCount: ${snapshot.summary.totalRepresentativePathCount}`);
  lines.push(`- largestProjectionType: ${snapshot.summary.largestProjectionType || "-"}`);
  lines.push("");
  lines.push("## Projections");
  for (const projection of snapshot.projections) {
    lines.push(`- [${projection.type}] ${projection.title} | nodes=${projection.nodeIds.length} | edges=${projection.edgeIds.length} | paths=${projection.representativePaths.length}`);
    if (projection.summary) {
      lines.push(`  - ${projection.summary}`);
    }
    const statusEntries = Object.entries(projection.statusCounts);
    if (statusEntries.length > 0) {
      lines.push(`  - status=${statusEntries.map(([status, count]) => `${status}:${count}`).join(", ")}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
