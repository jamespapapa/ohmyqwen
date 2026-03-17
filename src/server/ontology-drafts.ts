import { createHash } from "node:crypto";
import { z } from "zod";
import { OntologyGraphSnapshotSchema, type OntologyGraphSnapshot } from "./ontology-graph.js";
import { buildOntologyProjectionSnapshot, type OntologyProjectionSnapshot } from "./ontology-projections.js";

const DraftNodeTypeSchema = z.enum([
  "module",
  "file",
  "symbol",
  "route",
  "api",
  "controller",
  "service",
  "eai-interface",
  "data-store",
  "async-channel",
  "data-contract",
  "data-model",
  "data-query",
  "data-table",
  "cache-key",
  "control-guard",
  "decision-path",
  "knowledge-cluster",
  "retrieval-unit",
  "knowledge-input",
  "review-target",
  "feedback-record",
  "replay-candidate",
  "path"
]);

const DraftEdgeTypeSchema = z.enum([
  "contains",
  "declares",
  "calls",
  "routes-to",
  "maps-to",
  "uses-eai",
  "uses-store",
  "dispatches-to",
  "consumes-from",
  "transitions-to",
  "propagates-contract",
  "emits-contract",
  "receives-contract",
  "accepts-contract",
  "returns-contract",
  "stores-model",
  "maps-to-table",
  "queries-table",
  "uses-cache-key",
  "validates",
  "branches-to",
  "depends-on",
  "belongs-to-domain",
  "belongs-to-channel",
  "belongs-to-process",
  "supports-module-role",
  "references-entity",
  "references-edge",
  "targets-node",
  "targets-edge",
  "targets-path"
]);

const DraftStatusSchema = z.enum(["candidate", "validated", "derived", "stale", "contested", "deprecated"]);
const DraftSourceTypeSchema = z.enum([
  "knowledge-schema",
  "retrieval-unit",
  "ontology-input",
  "ontology-review",
  "feedback",
  "evaluation-replay",
  "evaluation-promotion",
  "derived"
]);

const DraftMetadataPatchSchema = z.object({
  domains: z.array(z.string().min(1)).optional(),
  subdomains: z.array(z.string().min(1)).optional(),
  channels: z.array(z.string().min(1)).optional(),
  actions: z.array(z.string().min(1)).optional(),
  moduleRoles: z.array(z.string().min(1)).optional(),
  processRoles: z.array(z.string().min(1)).optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidencePaths: z.array(z.string().min(1)).optional(),
  sourceType: DraftSourceTypeSchema.optional(),
  validatedStatus: DraftStatusSchema.optional()
});

const BaseDraftOperationSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  notes: z.string().default("")
});

export const OntologyDraftOperationSchema = z.discriminatedUnion("kind", [
  BaseDraftOperationSchema.extend({
    kind: z.literal("add-node"),
    nodeId: z.string().min(1),
    nodeType: DraftNodeTypeSchema,
    label: z.string().min(1),
    summary: z.string().default(""),
    metadata: DraftMetadataPatchSchema.default({}),
    attributes: z.record(z.string(), z.unknown()).default({})
  }),
  BaseDraftOperationSchema.extend({
    kind: z.literal("remove-node"),
    targetId: z.string().min(1)
  }),
  BaseDraftOperationSchema.extend({
    kind: z.literal("add-edge"),
    edgeId: z.string().min(1),
    edgeType: DraftEdgeTypeSchema,
    fromId: z.string().min(1),
    toId: z.string().min(1),
    label: z.string().default(""),
    metadata: DraftMetadataPatchSchema.default({}),
    attributes: z.record(z.string(), z.unknown()).default({})
  }),
  BaseDraftOperationSchema.extend({
    kind: z.literal("remove-edge"),
    targetId: z.string().min(1)
  }),
  BaseDraftOperationSchema.extend({
    kind: z.literal("override-node"),
    targetId: z.string().min(1),
    label: z.string().optional(),
    summary: z.string().optional(),
    metadata: DraftMetadataPatchSchema.default({}),
    attributes: z.record(z.string(), z.unknown()).default({})
  }),
  BaseDraftOperationSchema.extend({
    kind: z.literal("override-edge"),
    targetId: z.string().min(1),
    label: z.string().optional(),
    metadata: DraftMetadataPatchSchema.default({}),
    attributes: z.record(z.string(), z.unknown()).default({})
  })
]);

const OntologyDraftSummarySchema = z.object({
  operationCount: z.number().int().min(0),
  addNodeCount: z.number().int().min(0),
  removeNodeCount: z.number().int().min(0),
  addEdgeCount: z.number().int().min(0),
  removeEdgeCount: z.number().int().min(0),
  overrideNodeCount: z.number().int().min(0),
  overrideEdgeCount: z.number().int().min(0),
  touchedNodeCount: z.number().int().min(0),
  touchedEdgeCount: z.number().int().min(0)
});

export const OntologyDraftSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  draftVersion: z.number().int().min(1),
  basedOnOntologyGeneratedAt: z.string().min(1),
  notes: z.string().default(""),
  operations: z.array(OntologyDraftOperationSchema),
  summary: OntologyDraftSummarySchema
});

export const OntologyDraftHistoryEntrySchema = z.object({
  draftVersion: z.number().int().min(1),
  updatedAt: z.string().min(1),
  snapshotPath: z.string().min(1),
  operationCount: z.number().int().min(0)
});

export const OntologyDraftReadResultSchema = z.object({
  draft: OntologyDraftSnapshotSchema.nullable(),
  history: z.array(OntologyDraftHistoryEntrySchema),
  evaluation: z.unknown().optional()
});

export type OntologyDraftOperation = z.infer<typeof OntologyDraftOperationSchema>;
export type OntologyDraftSnapshot = z.infer<typeof OntologyDraftSnapshotSchema>;
export type OntologyDraftHistoryEntry = z.infer<typeof OntologyDraftHistoryEntrySchema>;

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

function mergeMetadata(base: Record<string, unknown>, patch: z.infer<typeof DraftMetadataPatchSchema>): Record<string, unknown> {
  const next = { ...base };
  for (const key of ["domains", "subdomains", "channels", "actions", "moduleRoles", "processRoles", "evidencePaths"] as const) {
    if (patch[key]) {
      next[key] = unique(patch[key] ?? []);
    }
  }
  if (patch.confidence !== undefined) {
    next.confidence = Math.max(0, Math.min(1, patch.confidence));
  }
  if (patch.sourceType) {
    next.sourceType = patch.sourceType;
  }
  if (patch.validatedStatus) {
    next.validatedStatus = patch.validatedStatus;
  }
  return next;
}

function buildDraftSummary(operations: OntologyDraftOperation[]): z.infer<typeof OntologyDraftSummarySchema> {
  const touchedNodes = new Set<string>();
  const touchedEdges = new Set<string>();
  let addNodeCount = 0;
  let removeNodeCount = 0;
  let addEdgeCount = 0;
  let removeEdgeCount = 0;
  let overrideNodeCount = 0;
  let overrideEdgeCount = 0;

  for (const operation of operations) {
    switch (operation.kind) {
      case "add-node":
        addNodeCount += 1;
        touchedNodes.add(operation.nodeId);
        break;
      case "remove-node":
        removeNodeCount += 1;
        touchedNodes.add(operation.targetId);
        break;
      case "add-edge":
        addEdgeCount += 1;
        touchedEdges.add(operation.edgeId);
        break;
      case "remove-edge":
        removeEdgeCount += 1;
        touchedEdges.add(operation.targetId);
        break;
      case "override-node":
        overrideNodeCount += 1;
        touchedNodes.add(operation.targetId);
        break;
      case "override-edge":
        overrideEdgeCount += 1;
        touchedEdges.add(operation.targetId);
        break;
    }
  }

  return OntologyDraftSummarySchema.parse({
    operationCount: operations.length,
    addNodeCount,
    removeNodeCount,
    addEdgeCount,
    removeEdgeCount,
    overrideNodeCount,
    overrideEdgeCount,
    touchedNodeCount: touchedNodes.size,
    touchedEdgeCount: touchedEdges.size
  });
}

export function buildOntologyDraftSnapshot(input: {
  generatedAt: string;
  updatedAt?: string;
  projectId: string;
  projectName: string;
  draftVersion: number;
  basedOnOntologyGeneratedAt: string;
  operations: Array<z.input<typeof OntologyDraftOperationSchema>>;
  notes?: string;
}): OntologyDraftSnapshot {
  const operations = input.operations.map((operation) => OntologyDraftOperationSchema.parse(operation));
  return OntologyDraftSnapshotSchema.parse({
    version: 1,
    generatedAt: input.generatedAt,
    updatedAt: input.updatedAt ?? input.generatedAt,
    projectId: input.projectId,
    projectName: input.projectName,
    draftVersion: input.draftVersion,
    basedOnOntologyGeneratedAt: input.basedOnOntologyGeneratedAt,
    notes: input.notes ?? "",
    operations,
    summary: buildDraftSummary(operations)
  });
}

function summarizeGraph(nodes: OntologyGraphSnapshot["nodes"], edges: OntologyGraphSnapshot["edges"], base: OntologyGraphSnapshot["summary"]): OntologyGraphSnapshot["summary"] {
  const nodeTypeCounts = countBy(nodes.map((node) => node.type));
  const edgeTypeCounts = countBy(edges.map((edge) => edge.type));
  const statuses = nodes.map((node) => String(node.metadata.validatedStatus || "derived"));
  const domains = nodes.flatMap((node) => node.metadata.domains ?? []);
  const channels = nodes.flatMap((node) => node.metadata.channels ?? []);
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    truncated: false,
    appliedLimits: [],
    nodeTypeCounts,
    edgeTypeCounts,
    feedbackNodeCount: nodes.filter((node) => node.type === "feedback-record").length,
    replayNodeCount: nodes.filter((node) => node.type === "replay-candidate").length,
    pathNodeCount: nodes.filter((node) => node.type === "path").length,
    validatedNodeCount: statuses.filter((status) => status === "validated").length,
    candidateNodeCount: statuses.filter((status) => status === "candidate").length,
    staleNodeCount: statuses.filter((status) => status === "stale").length,
    contestedNodeCount: statuses.filter((status) => status === "contested").length,
    deprecatedNodeCount: statuses.filter((status) => status === "deprecated").length,
    topDomains: countTop(domains),
    topChannels: countTop(channels)
  } satisfies OntologyGraphSnapshot["summary"];
}

function overlayDigest(payload: unknown): string {
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex").slice(0, 10);
}

export function applyOntologyDraftSnapshot(input: {
  baseGraph: OntologyGraphSnapshot;
  draft: OntologyDraftSnapshot;
}): {
  ontologyGraph: OntologyGraphSnapshot;
  ontologyProjections: OntologyProjectionSnapshot;
  changedNodeIds: string[];
  changedEdgeIds: string[];
  warnings: string[];
  changedProjectionIds: string[];
} {
  const baseGraph = OntologyGraphSnapshotSchema.parse(input.baseGraph);
  const draft = OntologyDraftSnapshotSchema.parse(input.draft);
  const nodes = new Map(baseGraph.nodes.map((node) => [node.id, structuredClone(node)]));
  const edges = new Map(baseGraph.edges.map((edge) => [edge.id, structuredClone(edge)]));
  const changedNodeIds = new Set<string>();
  const changedEdgeIds = new Set<string>();
  const warnings: string[] = [];

  const removeIncidentEdges = (nodeId: string) => {
    for (const [edgeId, edge] of Array.from(edges.entries())) {
      if (edge.fromId === nodeId || edge.toId === nodeId) {
        edges.delete(edgeId);
        changedEdgeIds.add(edgeId);
      }
    }
  };

  for (const operation of draft.operations) {
    switch (operation.kind) {
      case "add-node": {
        nodes.set(operation.nodeId, {
          id: operation.nodeId,
          type: operation.nodeType,
          label: operation.label,
          summary: operation.summary,
          metadata: {
            domains: unique(operation.metadata.domains ?? []),
            subdomains: unique(operation.metadata.subdomains ?? []),
            channels: unique(operation.metadata.channels ?? []),
            actions: unique(operation.metadata.actions ?? []),
            moduleRoles: unique(operation.metadata.moduleRoles ?? []),
            processRoles: unique(operation.metadata.processRoles ?? []),
            confidence: operation.metadata.confidence ?? 0.75,
            evidencePaths: unique(operation.metadata.evidencePaths ?? []),
            sourceType: operation.metadata.sourceType ?? "derived",
            validatedStatus: operation.metadata.validatedStatus ?? "candidate"
          },
          attributes: {
            ...operation.attributes,
            draftOperationId: operation.id,
            draftAdded: true
          }
        });
        changedNodeIds.add(operation.nodeId);
        break;
      }
      case "remove-node": {
        if (!nodes.has(operation.targetId)) {
          warnings.push(`missing-node:${operation.targetId}`);
          break;
        }
        nodes.delete(operation.targetId);
        removeIncidentEdges(operation.targetId);
        changedNodeIds.add(operation.targetId);
        break;
      }
      case "add-edge": {
        if (!nodes.has(operation.fromId) || !nodes.has(operation.toId)) {
          warnings.push(`missing-edge-endpoint:${operation.edgeId}`);
          break;
        }
        edges.set(operation.edgeId, {
          id: operation.edgeId,
          type: operation.edgeType,
          fromId: operation.fromId,
          toId: operation.toId,
          label: operation.label,
          metadata: {
            domains: unique(operation.metadata.domains ?? []),
            subdomains: unique(operation.metadata.subdomains ?? []),
            channels: unique(operation.metadata.channels ?? []),
            actions: unique(operation.metadata.actions ?? []),
            moduleRoles: unique(operation.metadata.moduleRoles ?? []),
            processRoles: unique(operation.metadata.processRoles ?? []),
            confidence: operation.metadata.confidence ?? 0.75,
            evidencePaths: unique(operation.metadata.evidencePaths ?? []),
            sourceType: operation.metadata.sourceType ?? "derived",
            validatedStatus: operation.metadata.validatedStatus ?? "candidate"
          },
          attributes: {
            ...operation.attributes,
            draftOperationId: operation.id,
            draftAdded: true
          }
        });
        changedEdgeIds.add(operation.edgeId);
        break;
      }
      case "remove-edge": {
        if (!edges.has(operation.targetId)) {
          warnings.push(`missing-edge:${operation.targetId}`);
          break;
        }
        edges.delete(operation.targetId);
        changedEdgeIds.add(operation.targetId);
        break;
      }
      case "override-node": {
        const existing = nodes.get(operation.targetId);
        if (!existing) {
          warnings.push(`missing-node:${operation.targetId}`);
          break;
        }
        nodes.set(operation.targetId, {
          ...existing,
          label: operation.label ?? existing.label,
          summary: operation.summary ?? existing.summary,
          metadata: mergeMetadata(existing.metadata, operation.metadata) as typeof existing.metadata,
          attributes: {
            ...existing.attributes,
            ...operation.attributes,
            draftOverrideId: operation.id
          }
        });
        changedNodeIds.add(operation.targetId);
        break;
      }
      case "override-edge": {
        const existing = edges.get(operation.targetId);
        if (!existing) {
          warnings.push(`missing-edge:${operation.targetId}`);
          break;
        }
        edges.set(operation.targetId, {
          ...existing,
          label: operation.label ?? existing.label,
          metadata: mergeMetadata(existing.metadata, operation.metadata) as typeof existing.metadata,
          attributes: {
            ...existing.attributes,
            ...operation.attributes,
            draftOverrideId: operation.id
          }
        });
        changedEdgeIds.add(operation.targetId);
        break;
      }
    }
  }

  const filteredEdges = Array.from(edges.values()).filter((edge) => nodes.has(edge.fromId) && nodes.has(edge.toId));
  const ontologyGraph = OntologyGraphSnapshotSchema.parse({
    version: 1,
    generatedAt: draft.updatedAt,
    workspaceDir: baseGraph.workspaceDir,
    nodes: Array.from(nodes.values()).sort((a, b) => a.id.localeCompare(b.id)),
    edges: filteredEdges.sort((a, b) => a.id.localeCompare(b.id)),
    summary: summarizeGraph(Array.from(nodes.values()), filteredEdges, baseGraph.summary)
  });
  const ontologyProjections = buildOntologyProjectionSnapshot({ ontologyGraph });
  const baseProjectionSnapshot = buildOntologyProjectionSnapshot({ ontologyGraph: baseGraph });
  const changedProjectionIds = ontologyProjections.projections
    .filter((projection) => {
      const before = baseProjectionSnapshot.projections.find((candidate) => candidate.id === projection.id);
      if (!before) return true;
      return overlayDigest({ nodes: projection.nodeIds, edges: projection.edgeIds, paths: projection.representativePaths }) !==
        overlayDigest({ nodes: before.nodeIds, edges: before.edgeIds, paths: before.representativePaths });
    })
    .map((projection) => projection.id);

  return {
    ontologyGraph,
    ontologyProjections,
    changedNodeIds: Array.from(changedNodeIds).sort(),
    changedEdgeIds: Array.from(changedEdgeIds).sort(),
    warnings: unique(warnings),
    changedProjectionIds
  };
}

export function buildOntologyDraftMarkdown(snapshot: OntologyDraftSnapshot): string {
  const lines = [
    "# Ontology Draft",
    "",
    `- draftVersion: ${snapshot.draftVersion}`,
    `- updatedAt: ${snapshot.updatedAt}`,
    `- basedOnOntologyGeneratedAt: ${snapshot.basedOnOntologyGeneratedAt}`,
    `- operationCount: ${snapshot.summary.operationCount}`,
    `- notes: ${snapshot.notes || "-"}`,
    "",
    "## Operations"
  ];
  if (snapshot.operations.length === 0) {
    lines.push("- (none)");
  } else {
    for (const operation of snapshot.operations) {
      let target = operation.id;
      switch (operation.kind) {
        case "add-node":
          target = operation.nodeId;
          break;
        case "remove-node":
        case "remove-edge":
        case "override-node":
        case "override-edge":
          target = operation.targetId;
          break;
        case "add-edge":
          target = operation.edgeId;
          break;
      }
      lines.push(`- [${operation.kind}] ${target}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
