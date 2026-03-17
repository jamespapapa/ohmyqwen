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
    .filter((node) => ["module", "file", "symbol", "ui-action", "gateway-handler", "controller", "service", "control-guard", "data-contract", "data-model", "data-query", "data-table", "cache-key", "data-store"].includes(node.type))
    .map((node) => node.id);
  const codeStructureEdgeIds = ontologyGraph.edges
    .filter((edge) => ["contains", "declares", "calls", "proxies-to", "depends-on", "supports-module-role", "uses-store", "accepts-contract", "returns-contract", "stores-model", "maps-to-table", "queries-table", "uses-cache-key", "validates"].includes(edge.type))
    .map((edge) => edge.id);

  const flowPaths = ontologyGraph.nodes
    .filter((node) => node.type === "retrieval-unit" && node.attributes.unitType === "flow")
    .slice(0, 12)
    .map((node) => ({
      id: `path:${node.id}`,
      label: node.label,
      nodeIds: unique([node.id, ...((node.attributes.entityIds as string[] | undefined) ?? [])]),
      edgeIds: ontologyGraph.edges.filter((edge) => edge.fromId === node.id && edge.type.startsWith("references-")).map((edge) => edge.id)
    }));

  const frontBackNodeIds = ontologyGraph.nodes
    .filter((node) => ["route", "ui-action", "api", "gateway-handler", "controller", "service", "retrieval-unit"].includes(node.type) && (node.type !== "retrieval-unit" || node.attributes.unitType === "flow"))
    .map((node) => node.id);
  const frontBackEdgeIds = ontologyGraph.edges
    .filter((edge) => ["routes-to", "calls", "proxies-to", "maps-to", "references-entity", "references-edge"].includes(edge.type))
    .map((edge) => edge.id);

  const integrationNodeIds = ontologyGraph.nodes
    .filter((node) => node.type === "eai-interface" || node.type === "data-store" || node.type === "data-contract" || node.type === "data-query" || node.type === "data-table" || node.type === "cache-key" || node.type === "control-guard" || node.type === "gateway-handler" || node.metadata.channels.length > 0 || (node.type === "retrieval-unit" && (node.attributes.unitType === "eai-link" || node.attributes.unitType === "flow")))
    .map((node) => node.id);
  const integrationEdgeIds = ontologyGraph.edges
    .filter((edge) => ["uses-eai", "uses-store", "accepts-contract", "returns-contract", "maps-to-table", "queries-table", "uses-cache-key", "validates", "belongs-to-channel", "references-entity", "routes-to", "proxies-to"].includes(edge.type))
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
      summary: `modules/files/symbols/services=${codeStructureNodeIds.length}, edges=${codeStructureEdgeIds.length}`,
      nodeIds: unique(codeStructureNodeIds),
      edgeIds: unique(codeStructureEdgeIds),
      representativePaths: [],
      statusCounts: projectionStatusCounts(codeStructureNodeIds, nodesById),
      highlightedNodeIds: codeStructureNodeIds.filter((id) => nodesById.get(id)?.type === "module").slice(0, 12),
      highlightedEdgeIds: []
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
