import { createHash } from "node:crypto";
import { z } from "zod";
import {
  KnowledgeSchemaSnapshotSchema,
  type KnowledgeSchemaSnapshot,
  type KnowledgeEntity,
  type KnowledgeEdge
} from "./knowledge-schema.js";
import { RetrievalUnitSnapshotSchema, type RetrievalUnitSnapshot } from "./retrieval-units.js";
import { ProjectFeedbackArtifactSchema, type ProjectFeedbackArtifact } from "./project-feedback.js";
import { EvaluationReplaySnapshotSchema, type EvaluationReplaySnapshot } from "./evaluation-replay.js";
import { EvaluationPromotionSnapshotSchema, type EvaluationPromotionSnapshot } from "./evaluation-promotions.js";
import {
  OntologyInputSummarySnapshotSchema,
  type OntologyInputSummarySnapshot,
  deriveOntologyInputMetadata
} from "./ontology-inputs.js";
import {
  OntologyReviewSnapshotSchema,
  type OntologyReviewSnapshot,
  canonicalOntologyPathTargetId
} from "./ontology-review.js";
import { maybeValidateSnapshot } from "./snapshot-validation.js";

const OntologyNodeTypeSchema = z.enum([
  "module",
  "file",
  "symbol",
  "ui-action",
  "route",
  "api",
  "gateway-handler",
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

const OntologyEdgeTypeSchema = z.enum([
  "contains",
  "declares",
  "calls",
  "proxies-to",
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

const OntologyValidatedStatusSchema = z.enum([
  "candidate",
  "validated",
  "derived",
  "stale",
  "contested",
  "deprecated"
]);

const OntologySourceTypeSchema = z.enum([
  "knowledge-schema",
  "retrieval-unit",
  "ontology-input",
  "ontology-review",
  "feedback",
  "evaluation-replay",
  "evaluation-promotion",
  "derived"
]);

const OntologyMetadataSchema = z.object({
  domains: z.array(z.string().min(1)).default([]),
  subdomains: z.array(z.string().min(1)).default([]),
  channels: z.array(z.string().min(1)).default([]),
  actions: z.array(z.string().min(1)).default([]),
  moduleRoles: z.array(z.string().min(1)).default([]),
  processRoles: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  evidencePaths: z.array(z.string().min(1)).default([]),
  sourceType: OntologySourceTypeSchema,
  validatedStatus: OntologyValidatedStatusSchema
});

const OntologyNodeSchema = z.object({
  id: z.string().min(1),
  type: OntologyNodeTypeSchema,
  label: z.string().min(1),
  summary: z.string().default(""),
  metadata: OntologyMetadataSchema,
  attributes: z.record(z.string(), z.unknown()).default({})
});

const OntologyEdgeSchema = z.object({
  id: z.string().min(1),
  type: OntologyEdgeTypeSchema,
  fromId: z.string().min(1),
  toId: z.string().min(1),
  label: z.string().default(""),
  metadata: OntologyMetadataSchema,
  attributes: z.record(z.string(), z.unknown()).default({})
});

const OntologyGraphSummarySchema = z.object({
  nodeCount: z.number().int().min(0),
  edgeCount: z.number().int().min(0),
  truncated: z.boolean().default(false),
  appliedLimits: z.array(z.string().min(1)).default([]),
  nodeTypeCounts: z.record(z.string(), z.number().int().min(0)),
  edgeTypeCounts: z.record(z.string(), z.number().int().min(0)),
  feedbackNodeCount: z.number().int().min(0),
  replayNodeCount: z.number().int().min(0),
  pathNodeCount: z.number().int().min(0),
  validatedNodeCount: z.number().int().min(0),
  candidateNodeCount: z.number().int().min(0),
  staleNodeCount: z.number().int().min(0),
  contestedNodeCount: z.number().int().min(0),
  deprecatedNodeCount: z.number().int().min(0),
  topDomains: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) })),
  topChannels: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) }))
});

export const OntologyGraphSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  workspaceDir: z.string().min(1),
  nodes: z.array(OntologyNodeSchema),
  edges: z.array(OntologyEdgeSchema),
  summary: OntologyGraphSummarySchema
});

export type OntologyNode = z.infer<typeof OntologyNodeSchema>;
export type OntologyEdge = z.infer<typeof OntologyEdgeSchema>;
export type OntologyGraphSnapshot = z.infer<typeof OntologyGraphSnapshotSchema>;

export interface OntologyGraphBuildLimits {
  maxKnowledgeEntities?: number;
  maxKnowledgeEdges?: number;
  maxRetrievalUnits?: number;
  maxUnitEntityRefs?: number;
  maxUnitEdgeRefs?: number;
  maxOntologyInputs?: number;
  maxOntologyInputRowsPerArtifact?: number;
  maxFeedbackArtifacts?: number;
  maxReplayCandidates?: number;
  maxReviewRecords?: number;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function mapValidatedStatus(status?: string): z.infer<typeof OntologyValidatedStatusSchema> {
  switch (status) {
    case "candidate":
    case "validated":
    case "derived":
    case "stale":
    case "contested":
    case "deprecated":
      return status;
    default:
      return "derived";
  }
}

function makeMetadata(input?: Partial<z.infer<typeof OntologyMetadataSchema>>): z.infer<typeof OntologyMetadataSchema> {
  return {
    domains: unique(input?.domains ?? []),
    subdomains: unique(input?.subdomains ?? []),
    channels: unique(input?.channels ?? []),
    actions: unique(input?.actions ?? []),
    moduleRoles: unique(input?.moduleRoles ?? []),
    processRoles: unique(input?.processRoles ?? []),
    confidence: Math.max(0, Math.min(1, input?.confidence ?? 0.5)),
    evidencePaths: unique((input?.evidencePaths ?? []).map(toForwardSlash)),
    sourceType: input?.sourceType ?? "derived",
    validatedStatus: mapValidatedStatus(input?.validatedStatus)
  };
}

function countBy<T extends string>(values: T[]): Record<string, number> {
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

function feedbackNodeId(artifact: ProjectFeedbackArtifact): string {
  const digest = createHash("sha1")
    .update(JSON.stringify([artifact.projectId, artifact.kind, artifact.generatedAt, artifact.prompt, artifact.questionType]))
    .digest("hex")
    .slice(0, 12);
  return `feedback:${artifact.kind}:${digest}`;
}

function replayNodeId(candidate: EvaluationReplaySnapshot["replayCandidates"][number]): string {
  const digest = createHash("sha1")
    .update(JSON.stringify([candidate.kind, candidate.generatedAt, candidate.questionType, candidate.questionOrQuery]))
    .digest("hex")
    .slice(0, 12);
  return `replay:${candidate.kind}:${digest}`;
}

function feedbackConfidence(verdict: ProjectFeedbackArtifact["verdict"]): number {
  if (verdict === "correct") return 0.98;
  if (verdict === "incorrect") return 0.97;
  return 0.7;
}

function feedbackStatus(verdict: ProjectFeedbackArtifact["verdict"]): z.infer<typeof OntologyValidatedStatusSchema> {
  if (verdict === "correct") return "validated";
  if (verdict === "incorrect") return "contested";
  return "candidate";
}

function knowledgeEntityPriority(entity: KnowledgeEntity): number {
  switch (entity.type) {
    case "module":
      return 120;
    case "route":
    case "ui-action":
    case "api":
    case "gateway-handler":
    case "controller":
    case "service":
    case "eai-interface":
    case "data-store":
    case "async-channel":
    case "data-contract":
    case "control-guard":
    case "decision-path":
    case "knowledge-cluster":
      return 110;
    case "data-model":
    case "data-query":
    case "data-table":
    case "cache-key":
      return 95;
    case "file":
      return 70;
    case "symbol":
      return 55;
    default:
      return 50;
  }
}

function knowledgeEdgePriority(edge: KnowledgeEdge): number {
  switch (edge.type) {
    case "routes-to":
    case "proxies-to":
    case "calls":
    case "uses-eai":
    case "uses-store":
    case "dispatches-to":
    case "consumes-from":
    case "transitions-to":
    case "propagates-contract":
    case "emits-contract":
    case "receives-contract":
    case "accepts-contract":
    case "returns-contract":
      return 120;
    case "maps-to":
    case "stores-model":
    case "maps-to-table":
    case "queries-table":
    case "uses-cache-key":
    case "validates":
    case "branches-to":
    case "supports-module-role":
      return 105;
    case "contains":
    case "declares":
    case "depends-on":
      return 70;
    case "belongs-to-domain":
    case "belongs-to-channel":
    case "belongs-to-process":
      return 60;
    default:
      return 50;
  }
}

function retrievalUnitTypePriority(unitType: string): number {
  switch (unitType) {
    case "flow":
      return 120;
    case "resource-schema":
      return 112;
    case "module-overview":
    case "eai-link":
      return 105;
    case "knowledge-cluster":
      return 95;
    case "symbol-block":
      return 80;
    default:
      return 50;
  }
}

function statusPriority(status: z.infer<typeof OntologyValidatedStatusSchema> | string): number {
  switch (status) {
    case "validated":
      return 120;
    case "derived":
      return 95;
    case "candidate":
      return 80;
    case "stale":
      return 40;
    case "contested":
      return 30;
    case "deprecated":
      return 10;
    default:
      return 50;
  }
}

function selectKnowledgeEntities(entities: KnowledgeSchemaSnapshot["entities"], maxEntities?: number): KnowledgeSchemaSnapshot["entities"] {
  if (!maxEntities || entities.length <= maxEntities) {
    return entities;
  }
  return [...entities]
    .sort((a, b) => {
      const priorityDiff = knowledgeEntityPriority(b) - knowledgeEntityPriority(a);
      if (priorityDiff !== 0) return priorityDiff;
      const statusDiff = statusPriority(b.metadata.validatedStatus) - statusPriority(a.metadata.validatedStatus);
      if (statusDiff !== 0) return statusDiff;
      const confidenceDiff = b.metadata.confidence - a.metadata.confidence;
      if (confidenceDiff !== 0) return confidenceDiff;
      return a.id.localeCompare(b.id);
    })
    .slice(0, maxEntities);
}

function selectKnowledgeEdges(
  edges: KnowledgeSchemaSnapshot["edges"],
  selectedNodeIds: Set<string>,
  maxEdges?: number
): KnowledgeSchemaSnapshot["edges"] {
  const filtered = edges.filter((edge) => selectedNodeIds.has(edge.fromId) && selectedNodeIds.has(edge.toId));
  if (!maxEdges || filtered.length <= maxEdges) {
    return filtered;
  }
  return [...filtered]
    .sort((a, b) => {
      const priorityDiff = knowledgeEdgePriority(b) - knowledgeEdgePriority(a);
      if (priorityDiff !== 0) return priorityDiff;
      const statusDiff = statusPriority(b.metadata.validatedStatus) - statusPriority(a.metadata.validatedStatus);
      if (statusDiff !== 0) return statusDiff;
      const confidenceDiff = b.metadata.confidence - a.metadata.confidence;
      if (confidenceDiff !== 0) return confidenceDiff;
      return a.id.localeCompare(b.id);
    })
    .slice(0, maxEdges);
}

function selectRetrievalUnits(units: RetrievalUnitSnapshot["units"], maxUnits?: number): RetrievalUnitSnapshot["units"] {
  if (!maxUnits || units.length <= maxUnits) {
    return units;
  }
  return [...units]
    .sort((a, b) => {
      const typeDiff = retrievalUnitTypePriority(b.type) - retrievalUnitTypePriority(a.type);
      if (typeDiff !== 0) return typeDiff;
      const statusDiff = statusPriority(b.validatedStatus) - statusPriority(a.validatedStatus);
      if (statusDiff !== 0) return statusDiff;
      const confidenceDiff = b.confidence - a.confidence;
      if (confidenceDiff !== 0) return confidenceDiff;
      return a.id.localeCompare(b.id);
    })
    .slice(0, maxUnits);
}

function resolveFeedbackTargetNodeId(target: ProjectFeedbackArtifact["targets"][number], nodeIds: Set<string>, clusterNodes: OntologyNode[]): string | undefined {
  if (["node", "retrieval-unit", "knowledge"].includes(target.kind) && target.id && nodeIds.has(target.id)) {
    return target.id;
  }
  if (target.kind === "knowledge" && target.id) {
    const matched = clusterNodes.find((node) => node.id === target.id || String(node.attributes.candidateId ?? "") === target.id || String(node.attributes.packId ?? "") === target.id);
    return matched?.id;
  }
  if (target.kind === "retrieval-unit" && target.id) {
    const direct = `retrieval-unit:${target.id}`;
    return nodeIds.has(direct) ? direct : undefined;
  }
  return undefined;
}

export function buildOntologyGraphSnapshot(options: {
  generatedAt?: string;
  workspaceDir?: string;
  knowledgeSchema: KnowledgeSchemaSnapshot;
  retrievalUnits?: RetrievalUnitSnapshot;
  ontologyInputs?: OntologyInputSummarySnapshot;
  ontologyReview?: OntologyReviewSnapshot;
  feedbackArtifacts?: ProjectFeedbackArtifact[];
  evaluationReplay?: EvaluationReplaySnapshot;
  evaluationPromotions?: EvaluationPromotionSnapshot;
  limits?: OntologyGraphBuildLimits;
}): OntologyGraphSnapshot {
  const knowledgeSchema = maybeValidateSnapshot(KnowledgeSchemaSnapshotSchema, options.knowledgeSchema);
  const retrievalUnits = options.retrievalUnits
    ? maybeValidateSnapshot(RetrievalUnitSnapshotSchema, options.retrievalUnits)
    : undefined;
  const ontologyInputs = options.ontologyInputs
    ? maybeValidateSnapshot(OntologyInputSummarySnapshotSchema, options.ontologyInputs)
    : undefined;
  const ontologyReview = options.ontologyReview
    ? maybeValidateSnapshot(OntologyReviewSnapshotSchema, options.ontologyReview)
    : undefined;
  const feedbackArtifacts = (options.feedbackArtifacts ?? []).map((artifact) =>
    maybeValidateSnapshot(ProjectFeedbackArtifactSchema, artifact)
  );
  const evaluationReplay = options.evaluationReplay
    ? maybeValidateSnapshot(EvaluationReplaySnapshotSchema, options.evaluationReplay)
    : undefined;
  const evaluationPromotions = options.evaluationPromotions
    ? maybeValidateSnapshot(EvaluationPromotionSnapshotSchema, options.evaluationPromotions)
    : undefined;
  const limits = options.limits ?? {};
  const appliedLimits: string[] = [];

  const selectedKnowledgeEntities = selectKnowledgeEntities(
    knowledgeSchema.entities,
    limits.maxKnowledgeEntities
  );
  if ((limits.maxKnowledgeEntities ?? 0) > 0 && selectedKnowledgeEntities.length < knowledgeSchema.entities.length) {
    appliedLimits.push(`knowledge-entities:${selectedKnowledgeEntities.length}/${knowledgeSchema.entities.length}`);
  }
  const selectedEntityIds = new Set(selectedKnowledgeEntities.map((entity) => entity.id));
  const selectedKnowledgeEdges = selectKnowledgeEdges(
    knowledgeSchema.edges,
    selectedEntityIds,
    limits.maxKnowledgeEdges
  );
  if ((limits.maxKnowledgeEdges ?? 0) > 0 && selectedKnowledgeEdges.length < knowledgeSchema.edges.length) {
    appliedLimits.push(`knowledge-edges:${selectedKnowledgeEdges.length}/${knowledgeSchema.edges.length}`);
  }
  const selectedRetrievalUnits = retrievalUnits
    ? selectRetrievalUnits(retrievalUnits.units, limits.maxRetrievalUnits)
    : [];
  if (retrievalUnits && (limits.maxRetrievalUnits ?? 0) > 0 && selectedRetrievalUnits.length < retrievalUnits.units.length) {
    appliedLimits.push(`retrieval-units:${selectedRetrievalUnits.length}/${retrievalUnits.units.length}`);
  }
  const selectedOntologyInputs = ontologyInputs?.recentInputs.slice(0, limits.maxOntologyInputs ?? ontologyInputs.recentInputs.length) ?? [];
  if (ontologyInputs && (limits.maxOntologyInputs ?? 0) > 0 && selectedOntologyInputs.length < ontologyInputs.recentInputs.length) {
    appliedLimits.push(`ontology-inputs:${selectedOntologyInputs.length}/${ontologyInputs.recentInputs.length}`);
  }
  const selectedFeedbackArtifacts = feedbackArtifacts.slice(0, limits.maxFeedbackArtifacts ?? feedbackArtifacts.length);
  if ((limits.maxFeedbackArtifacts ?? 0) > 0 && selectedFeedbackArtifacts.length < feedbackArtifacts.length) {
    appliedLimits.push(`feedback-artifacts:${selectedFeedbackArtifacts.length}/${feedbackArtifacts.length}`);
  }
  const selectedReplayCandidates = evaluationReplay?.replayCandidates.slice(
    0,
    limits.maxReplayCandidates ?? evaluationReplay.replayCandidates.length
  ) ?? [];
  if (evaluationReplay && (limits.maxReplayCandidates ?? 0) > 0 && selectedReplayCandidates.length < evaluationReplay.replayCandidates.length) {
    appliedLimits.push(`replay-candidates:${selectedReplayCandidates.length}/${evaluationReplay.replayCandidates.length}`);
  }
  const selectedReviewRecords = ontologyReview?.records.slice(0, limits.maxReviewRecords ?? ontologyReview.records.length) ?? [];
  if (ontologyReview && (limits.maxReviewRecords ?? 0) > 0 && selectedReviewRecords.length < ontologyReview.records.length) {
    appliedLimits.push(`review-records:${selectedReviewRecords.length}/${ontologyReview.records.length}`);
  }

  const nodes = new Map<string, OntologyNode>();
  const edges = new Map<string, OntologyEdge>();

  const upsertNode = (node: OntologyNode) => {
    nodes.set(node.id, maybeValidateSnapshot(OntologyNodeSchema, node));
  };
  const upsertEdge = (edge: OntologyEdge) => {
    const parsed = maybeValidateSnapshot(OntologyEdgeSchema, edge);
    edges.set(`${parsed.type}:${parsed.fromId}:${parsed.toId}`, parsed);
  };

  for (const entity of selectedKnowledgeEntities) {
    upsertNode({
      id: entity.id,
      type: entity.type,
      label: entity.label,
      summary: entity.summary,
      metadata: makeMetadata({
        ...entity.metadata,
        sourceType: "knowledge-schema"
      }),
      attributes: {
        ...entity.attributes,
        originType: entity.type
      }
    });
  }
  for (const edge of selectedKnowledgeEdges) {
    upsertEdge({
      id: edge.id,
      type: edge.type,
      fromId: edge.fromId,
      toId: edge.toId,
      label: edge.label,
      metadata: makeMetadata({
        ...edge.metadata,
        sourceType: "knowledge-schema"
      }),
      attributes: edge.attributes
    });
  }

  const selectedKnowledgeEdgeMap = new Map(selectedKnowledgeEdges.map((edge) => [edge.id, edge]));

  if (retrievalUnits) {
    for (const unit of selectedRetrievalUnits) {
      const unitNodeId = `retrieval-unit:${unit.id}`;
      upsertNode({
        id: unitNodeId,
        type: "retrieval-unit",
        label: unit.title,
        summary: unit.summary,
        metadata: makeMetadata({
          domains: unit.domains,
          subdomains: unit.subdomains,
          channels: unit.channels,
          actions: unit.actions,
          moduleRoles: unit.moduleRoles,
          processRoles: unit.processRoles,
          confidence: unit.confidence,
          evidencePaths: unit.evidencePaths,
          sourceType: "retrieval-unit",
          validatedStatus: unit.validatedStatus
        }),
        attributes: {
          unitId: unit.id,
          unitType: unit.type,
          searchText: unit.searchText,
          entityIds: unit.entityIds,
          edgeIds: unit.edgeIds
        }
      });
      for (const entityId of unit.entityIds.slice(0, limits.maxUnitEntityRefs ?? unit.entityIds.length)) {
        if (!nodes.has(entityId)) continue;
        upsertEdge({
          id: `edge:references-entity:${unitNodeId}:${entityId}`,
          type: "references-entity",
          fromId: unitNodeId,
          toId: entityId,
          label: "retrieval unit references entity",
          metadata: makeMetadata({
            domains: unit.domains,
            subdomains: unit.subdomains,
            channels: unit.channels,
            actions: unit.actions,
            moduleRoles: unit.moduleRoles,
            processRoles: unit.processRoles,
            confidence: unit.confidence,
            evidencePaths: unit.evidencePaths,
            sourceType: "retrieval-unit",
            validatedStatus: unit.validatedStatus
          }),
          attributes: { unitType: unit.type }
        });
      }
      for (const edgeId of unit.edgeIds.slice(0, limits.maxUnitEdgeRefs ?? unit.edgeIds.length)) {
        const knowledgeEdge = selectedKnowledgeEdgeMap.get(edgeId);
        if (!knowledgeEdge) continue;
        const targetNodeId = `${knowledgeEdge.fromId}->${knowledgeEdge.toId}:${knowledgeEdge.type}`;
        upsertNode({
          id: targetNodeId,
          type: "path",
          label: `${knowledgeEdge.type} ${knowledgeEdge.fromId} -> ${knowledgeEdge.toId}`,
          summary: knowledgeEdge.label || `${knowledgeEdge.type} relation`,
          metadata: makeMetadata({
            ...knowledgeEdge.metadata,
            sourceType: "derived"
          }),
          attributes: {
            edgeId: knowledgeEdge.id,
            edgeType: knowledgeEdge.type,
            fromId: knowledgeEdge.fromId,
            toId: knowledgeEdge.toId
          }
        });
        upsertEdge({
          id: `edge:references-edge:${unitNodeId}:${targetNodeId}`,
          type: "references-edge",
          fromId: unitNodeId,
          toId: targetNodeId,
          label: "retrieval unit references edge",
          metadata: makeMetadata({
            domains: unit.domains,
            subdomains: unit.subdomains,
            channels: unit.channels,
            actions: unit.actions,
            moduleRoles: unit.moduleRoles,
            processRoles: unit.processRoles,
            confidence: unit.confidence,
            evidencePaths: unit.evidencePaths,
            sourceType: "retrieval-unit",
            validatedStatus: unit.validatedStatus
          }),
          attributes: { edgeId: knowledgeEdge.id }
        });
      }
    }
  }

  if (ontologyInputs) {
    for (const artifact of selectedOntologyInputs) {
      const semantic = deriveOntologyInputMetadata(artifact);
      const inputNodeId = artifact.id;
      upsertNode({
        id: inputNodeId,
        type: "knowledge-input",
        label: artifact.title,
        summary: artifact.message || artifact.notes || `${artifact.kind}/${artifact.scope}`,
        metadata: makeMetadata({
          ...semantic,
          confidence: artifact.kind === "csv" ? 0.68 : artifact.kind === "structured" ? 0.72 : 0.6,
          evidencePaths: unique([
            ...artifact.relatedNodeIds,
            ...artifact.relatedEdgeIds,
            ...artifact.relatedPathIds
          ]),
          sourceType: "ontology-input",
          validatedStatus: "candidate"
        }),
        attributes: {
          inputId: artifact.id,
          inputKind: artifact.kind,
          scope: artifact.scope,
          tags: artifact.tags,
          positiveExamples: artifact.positiveExamples,
          negativeExamples: artifact.negativeExamples,
          boundaryNotes: artifact.boundaryNotes,
          normalizedTerms: artifact.normalizedTerms,
          csvHeaders: artifact.csvHeaders,
          csvRowCount: artifact.csvRows.length
        }
      });

      for (const relatedNodeId of artifact.relatedNodeIds) {
        if (!nodes.has(relatedNodeId)) continue;
        upsertEdge({
          id: `edge:references-entity:${inputNodeId}:${relatedNodeId}`,
          type: "references-entity",
          fromId: inputNodeId,
          toId: relatedNodeId,
          label: "ontology input references entity",
          metadata: makeMetadata({
            ...semantic,
            confidence: 0.72,
            sourceType: "ontology-input",
            validatedStatus: "candidate"
          }),
          attributes: {
            scope: artifact.scope
          }
        });
      }

      for (const relatedEdgeId of artifact.relatedEdgeIds) {
        const reviewTargetNodeId = `review-target:edge:${relatedEdgeId}`;
        upsertNode({
          id: reviewTargetNodeId,
          type: "review-target",
          label: relatedEdgeId,
          summary: "ontology input references edge",
          metadata: makeMetadata({
            ...semantic,
            confidence: 0.66,
            sourceType: "ontology-input",
            validatedStatus: "candidate"
          }),
          attributes: {
            targetKind: "edge",
            targetId: relatedEdgeId
          }
        });
        upsertEdge({
          id: `edge:references-edge:${inputNodeId}:${reviewTargetNodeId}`,
          type: "references-edge",
          fromId: inputNodeId,
          toId: reviewTargetNodeId,
          label: "ontology input references edge",
          metadata: makeMetadata({
            ...semantic,
            confidence: 0.66,
            sourceType: "ontology-input",
            validatedStatus: "candidate"
          }),
          attributes: {
            scope: artifact.scope
          }
        });
      }

      artifact.csvRows.slice(0, limits.maxOntologyInputRowsPerArtifact ?? 48).forEach((row, index) => {
        const rowNodeId = `${artifact.id}:row:${index + 1}`;
        const label =
          Object.values(row).find((value) => String(value).trim().length > 0) ||
          `${artifact.title} row ${index + 1}`;
        upsertNode({
          id: rowNodeId,
          type: "knowledge-input",
          label,
          summary: Object.entries(row)
            .filter(([, value]) => value)
            .slice(0, 4)
            .map(([key, value]) => `${key}=${value}`)
            .join(", "),
          metadata: makeMetadata({
            ...semantic,
            confidence: 0.64,
            sourceType: "ontology-input",
            validatedStatus: "candidate"
          }),
          attributes: {
            inputId: artifact.id,
            inputKind: "csv-row",
            rowIndex: index + 1,
            row
          }
        });
        upsertEdge({
          id: `edge:contains:${inputNodeId}:${rowNodeId}`,
          type: "contains",
          fromId: inputNodeId,
          toId: rowNodeId,
          label: "ontology input contains row",
          metadata: makeMetadata({
            ...semantic,
            confidence: 0.7,
            sourceType: "ontology-input",
            validatedStatus: "candidate"
          }),
          attributes: {
            scope: artifact.scope
          }
        });
      });
    }
  }

  const nodeIds = new Set(nodes.keys());
  const clusterNodes = Array.from(nodes.values()).filter((node) => node.type === "knowledge-cluster");

  for (const artifact of selectedFeedbackArtifacts) {
    const feedbackId = feedbackNodeId(artifact);
    upsertNode({
      id: feedbackId,
      type: "feedback-record",
      label: `${artifact.kind}:${artifact.verdict}`,
      summary: artifact.prompt,
      metadata: makeMetadata({
        confidence: feedbackConfidence(artifact.verdict),
        evidencePaths: [],
        sourceType: "feedback",
        validatedStatus: feedbackStatus(artifact.verdict)
      }),
      attributes: {
        kind: artifact.kind,
        prompt: artifact.prompt,
        questionType: artifact.questionType,
        verdict: artifact.verdict,
        scope: artifact.scope,
        strength: artifact.strength,
        notes: artifact.notes,
        matchedKnowledgeIds: artifact.matchedKnowledgeIds,
        matchedRetrievalUnitIds: artifact.matchedRetrievalUnitIds
      }
    });

    for (const candidateId of artifact.matchedKnowledgeIds) {
      const target = resolveFeedbackTargetNodeId({ kind: "knowledge", id: candidateId, label: "", nodeIds: [], edgeIds: [], notes: "" }, nodeIds, clusterNodes);
      if (!target) continue;
      upsertEdge({
        id: `edge:targets-node:${feedbackId}:${target}`,
        type: "targets-node",
        fromId: feedbackId,
        toId: target,
        label: "feedback targets knowledge",
        metadata: makeMetadata({
          confidence: feedbackConfidence(artifact.verdict),
          sourceType: "feedback",
          validatedStatus: feedbackStatus(artifact.verdict)
        }),
        attributes: {
          verdict: artifact.verdict,
          scope: artifact.scope
        }
      });
    }

    for (const unitId of artifact.matchedRetrievalUnitIds) {
      const target = resolveFeedbackTargetNodeId({ kind: "retrieval-unit", id: unitId, label: "", nodeIds: [], edgeIds: [], notes: "" }, nodeIds, clusterNodes);
      if (!target) continue;
      upsertEdge({
        id: `edge:targets-node:${feedbackId}:${target}`,
        type: "targets-node",
        fromId: feedbackId,
        toId: target,
        label: "feedback targets retrieval unit",
        metadata: makeMetadata({
          confidence: feedbackConfidence(artifact.verdict),
          sourceType: "feedback",
          validatedStatus: feedbackStatus(artifact.verdict)
        }),
        attributes: {
          verdict: artifact.verdict,
          scope: artifact.scope
        }
      });
    }

    artifact.targets.forEach((target, index) => {
      if (target.kind === "path") {
        const targetId = canonicalOntologyPathTargetId(target);
        upsertNode({
          id: targetId,
          type: "path",
          label: target.label || `feedback path ${index + 1}`,
          summary: target.notes || target.edgeIds.join(" -> ") || target.nodeIds.join(" -> "),
          metadata: makeMetadata({
            confidence: feedbackConfidence(artifact.verdict),
            evidencePaths: target.evidencePath ? [target.evidencePath] : [],
            sourceType: "feedback",
            validatedStatus: feedbackStatus(artifact.verdict)
          }),
          attributes: {
            nodeIds: target.nodeIds,
            edgeIds: target.edgeIds,
            evidencePath: target.evidencePath ?? ""
          }
        });
        upsertEdge({
          id: `edge:targets-path:${feedbackId}:${targetId}`,
          type: "targets-path",
          fromId: feedbackId,
          toId: targetId,
          label: "feedback targets path",
          metadata: makeMetadata({
            confidence: feedbackConfidence(artifact.verdict),
            sourceType: "feedback",
            validatedStatus: feedbackStatus(artifact.verdict)
          }),
          attributes: {
            verdict: artifact.verdict,
            scope: artifact.scope
          }
        });
        return;
      }

      const targetNode = resolveFeedbackTargetNodeId(target, nodeIds, clusterNodes);
      if (target.kind === "edge" && target.id) {
        const edgeNodeId = `${target.id}:feedback-target`;
        upsertNode({
          id: edgeNodeId,
          type: "path",
          label: target.label || target.id,
          summary: target.notes || "feedback targets edge",
          metadata: makeMetadata({
            confidence: feedbackConfidence(artifact.verdict),
            sourceType: "feedback",
            validatedStatus: feedbackStatus(artifact.verdict)
          }),
          attributes: { edgeId: target.id }
        });
        upsertEdge({
          id: `edge:targets-edge:${feedbackId}:${edgeNodeId}`,
          type: "targets-edge",
          fromId: feedbackId,
          toId: edgeNodeId,
          label: "feedback targets edge",
          metadata: makeMetadata({
            confidence: feedbackConfidence(artifact.verdict),
            sourceType: "feedback",
            validatedStatus: feedbackStatus(artifact.verdict)
          }),
          attributes: {
            verdict: artifact.verdict,
            scope: artifact.scope,
            targetId: target.id
          }
        });
        return;
      }
      if (targetNode) {
        upsertEdge({
          id: `edge:targets-node:${feedbackId}:${targetNode}:${index}`,
          type: "targets-node",
          fromId: feedbackId,
          toId: targetNode,
          label: `feedback targets ${target.kind}`,
          metadata: makeMetadata({
            confidence: feedbackConfidence(artifact.verdict),
            sourceType: "feedback",
            validatedStatus: feedbackStatus(artifact.verdict)
          }),
          attributes: {
            verdict: artifact.verdict,
            scope: artifact.scope,
            targetKind: target.kind
          }
        });
      }
    });
  }

  for (const candidate of selectedReplayCandidates) {
    const replayId = replayNodeId(candidate);
    upsertNode({
      id: replayId,
      type: "replay-candidate",
      label: `${candidate.kind}:${candidate.questionType}`,
      summary: candidate.questionOrQuery,
      metadata: makeMetadata({
        confidence: Math.max(0, Math.min(1, candidate.score / 100)),
        sourceType: "evaluation-replay",
        validatedStatus: candidate.score >= 80 ? "candidate" : "derived"
      }),
      attributes: {
        kind: candidate.kind,
        questionType: candidate.questionType,
        score: candidate.score,
        reasons: candidate.reasons
      }
    });
  }

  if (evaluationPromotions) {
    for (const action of evaluationPromotions.actions.slice(0, 48)) {
      const target = clusterNodes.find((node) => node.id === action.candidateId || String(node.attributes.candidateId ?? "") === action.candidateId);
      if (!target) continue;
      target.metadata = makeMetadata({
        ...target.metadata,
        confidence: Math.max(target.metadata.confidence, action.confidence),
        sourceType: "evaluation-promotion",
        validatedStatus: action.targetStatus
      });
      target.attributes = {
        ...target.attributes,
        promotionScore: action.score,
        promotionReasons: action.reasons,
        promotionCurrentStatus: action.currentStatus,
        promotionTargetStatus: action.targetStatus
      };
      nodes.set(target.id, target);
    }
  }

  if (ontologyReview) {
    for (const record of selectedReviewRecords) {
      if (record.targetKind === "node") {
        const direct = nodes.get(record.targetId);
        const knowledgeAlias = record.targetId.startsWith("knowledge:")
          ? Array.from(nodes.values()).find(
              (node) =>
                node.type === "knowledge-cluster" &&
                (String(node.attributes.candidateId ?? "") === record.targetId.slice("knowledge:".length) ||
                  String(node.attributes.packId ?? "") === record.targetId.slice("knowledge:".length))
            )
          : undefined;
        const targetNode = direct ?? knowledgeAlias;
        if (targetNode) {
          targetNode.metadata = makeMetadata({
            ...targetNode.metadata,
            confidence: Math.max(targetNode.metadata.confidence, record.confidence),
            sourceType: "ontology-review",
            validatedStatus: record.status
          });
          targetNode.attributes = {
            ...targetNode.attributes,
            reviewStatus: record.status,
            reviewFeedbackCount: record.feedbackCount,
            reviewScopes: record.scopes
          };
          nodes.set(targetNode.id, targetNode);
          continue;
        }
      }

      const reviewTargetNodeId = `review-target:${record.targetKind}:${record.targetId}`;
      upsertNode({
        id: reviewTargetNodeId,
        type: "review-target",
        label: record.label || record.targetId,
        summary: `${record.targetKind} review target`,
        metadata: makeMetadata({
          confidence: record.confidence,
          sourceType: "ontology-review",
          validatedStatus: record.status
        }),
        attributes: {
          targetKind: record.targetKind,
          targetId: record.targetId,
          feedbackCount: record.feedbackCount,
          questionTypes: record.questionTypes,
          scopes: record.scopes
        }
      });
    }
  }

  const orderedNodes = Array.from(nodes.values()).sort((a, b) => a.id.localeCompare(b.id));
  const orderedEdges = Array.from(edges.values()).sort((a, b) => a.id.localeCompare(b.id));

  return maybeValidateSnapshot(OntologyGraphSnapshotSchema, {
    version: 1,
    generatedAt: options.generatedAt ?? knowledgeSchema.generatedAt,
    workspaceDir: options.workspaceDir ?? knowledgeSchema.workspaceDir,
    nodes: orderedNodes,
    edges: orderedEdges,
    summary: {
      nodeCount: orderedNodes.length,
      edgeCount: orderedEdges.length,
      truncated: appliedLimits.length > 0,
      appliedLimits,
      nodeTypeCounts: countBy(orderedNodes.map((node) => node.type)),
      edgeTypeCounts: countBy(orderedEdges.map((edge) => edge.type)),
      feedbackNodeCount: orderedNodes.filter((node) => node.type === "feedback-record").length,
      replayNodeCount: orderedNodes.filter((node) => node.type === "replay-candidate").length,
      pathNodeCount: orderedNodes.filter((node) => node.type === "path").length,
      validatedNodeCount: orderedNodes.filter((node) => node.metadata.validatedStatus === "validated").length,
      candidateNodeCount: orderedNodes.filter((node) => node.metadata.validatedStatus === "candidate").length,
      staleNodeCount: orderedNodes.filter((node) => node.metadata.validatedStatus === "stale").length,
      contestedNodeCount: orderedNodes.filter((node) => node.metadata.validatedStatus === "contested").length,
      deprecatedNodeCount: orderedNodes.filter((node) => node.metadata.validatedStatus === "deprecated").length,
      topDomains: countTop(orderedNodes.flatMap((node) => node.metadata.domains)),
      topChannels: countTop(orderedNodes.flatMap((node) => node.metadata.channels))
    }
  });
}

export function buildOntologyGraphMarkdown(snapshot: OntologyGraphSnapshot): string {
  const lines: string[] = [];
  lines.push("# Ontology Graph");
  lines.push("");
  lines.push(`- generatedAt: ${snapshot.generatedAt}`);
  lines.push(`- workspaceDir: ${toForwardSlash(snapshot.workspaceDir)}`);
  lines.push(`- nodeCount: ${snapshot.summary.nodeCount}`);
  lines.push(`- edgeCount: ${snapshot.summary.edgeCount}`);
  lines.push(`- truncated: ${snapshot.summary.truncated ? "yes" : "no"}`);
  if (snapshot.summary.appliedLimits.length > 0) {
    lines.push(`- appliedLimits: ${snapshot.summary.appliedLimits.join(", ")}`);
  }
  lines.push(`- feedbackNodeCount: ${snapshot.summary.feedbackNodeCount}`);
  lines.push(`- replayNodeCount: ${snapshot.summary.replayNodeCount}`);
  lines.push(`- pathNodeCount: ${snapshot.summary.pathNodeCount}`);
  lines.push(`- contestedNodeCount: ${snapshot.summary.contestedNodeCount}`);
  lines.push(`- deprecatedNodeCount: ${snapshot.summary.deprecatedNodeCount}`);
  lines.push("");
  lines.push("## Node Types");
  for (const [type, count] of Object.entries(snapshot.summary.nodeTypeCounts)) {
    lines.push(`- ${type}: ${count}`);
  }
  lines.push("");
  lines.push("## Edge Types");
  for (const [type, count] of Object.entries(snapshot.summary.edgeTypeCounts)) {
    lines.push(`- ${type}: ${count}`);
  }
  lines.push("");
  lines.push("## Top Domains");
  if (snapshot.summary.topDomains.length === 0) {
    lines.push("- (none)");
  } else {
    for (const item of snapshot.summary.topDomains) {
      lines.push(`- ${item.id}: ${item.count}`);
    }
  }
  lines.push("");
  lines.push("## Representative Nodes");
  for (const node of snapshot.nodes.slice(0, 24)) {
    lines.push(`- [${node.type}] ${node.label} | status=${node.metadata.validatedStatus} | confidence=${node.metadata.confidence.toFixed(2)}`);
    if (node.summary) {
      lines.push(`  - ${node.summary}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
