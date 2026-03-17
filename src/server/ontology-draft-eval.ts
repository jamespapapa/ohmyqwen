import { z } from "zod";
import {
  ProjectAskEvaluationArtifactSchema,
  ProjectSearchEvaluationArtifactSchema,
  type ProjectAskEvaluationArtifact,
  type ProjectSearchEvaluationArtifact
} from "./evaluation-artifacts.js";
import { buildEvaluationReplaySnapshot } from "./evaluation-replay.js";
import { OntologyDraftSnapshotSchema, applyOntologyDraftSnapshot, type OntologyDraftSnapshot } from "./ontology-drafts.js";
import { OntologyGraphSnapshotSchema, type OntologyGraphSnapshot } from "./ontology-graph.js";

const EvaluationArtifactUnionSchema = z.union([ProjectAskEvaluationArtifactSchema, ProjectSearchEvaluationArtifactSchema]);
const OntologyDraftRecommendationSchema = z.enum(["keep", "review", "revert"]);
const OntologyDraftRiskBandSchema = z.enum(["low", "medium", "high"]);

export const OntologyDraftEvaluationSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  draftVersion: z.number().int().min(1),
  basedOnOntologyGeneratedAt: z.string().min(1),
  currentOntologyGeneratedAt: z.string().min(1),
  baseChanged: z.boolean(),
  changedNodeIds: z.array(z.string().min(1)).default([]),
  changedEdgeIds: z.array(z.string().min(1)).default([]),
  changedProjectionIds: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  metrics: z.object({
    operationCount: z.number().int().min(0),
    affectedArtifactCount: z.number().int().min(0),
    affectedAskArtifactCount: z.number().int().min(0),
    affectedSearchArtifactCount: z.number().int().min(0),
    improvedArtifactCount: z.number().int().min(0),
    regressedArtifactCount: z.number().int().min(0),
    unchangedArtifactCount: z.number().int().min(0),
    replayCandidateDelta: z.number().int(),
    replayQualityRiskDelta: z.number(),
    replayContestedDelta: z.number().int(),
    replayDeprecatedDelta: z.number().int(),
    touchedValidatedNodeCount: z.number().int().min(0),
    touchedContestedNodeCount: z.number().int().min(0),
    touchedDeprecatedNodeCount: z.number().int().min(0)
  }),
  summary: z.object({
    recommendation: OntologyDraftRecommendationSchema,
    riskBand: OntologyDraftRiskBandSchema,
    reason: z.string().min(1)
  })
});

export type OntologyDraftEvaluationSnapshot = z.infer<typeof OntologyDraftEvaluationSnapshotSchema>;

type EvaluationArtifact = ProjectAskEvaluationArtifact | ProjectSearchEvaluationArtifact;

function statusWeight(status: string): number {
  switch (status) {
    case "validated":
      return 3;
    case "derived":
      return 2;
    case "candidate":
      return 1;
    case "stale":
      return -1;
    case "contested":
      return -2;
    case "deprecated":
      return -3;
    default:
      return 0;
  }
}

function artifactStatusesForGraph(artifact: EvaluationArtifact, graph: OntologyGraphSnapshot): string[] {
  const statusById = new Map(graph.nodes.map((node) => [node.id, node.metadata.validatedStatus]));
  return artifact.matchedOntologyNodeIds.map((id) => statusById.get(id) ?? "deprecated");
}

function applyArtifactStatuses<T extends EvaluationArtifact>(artifact: T, graph: OntologyGraphSnapshot): T {
  const statuses = artifactStatusesForGraph(artifact, graph) as T["matchedOntologyNodeStatuses"];
  return {
    ...artifact,
    matchedOntologyNodeStatuses: statuses
  };
}

function recommendationFor(metrics: OntologyDraftEvaluationSnapshot["metrics"], warnings: string[]): OntologyDraftEvaluationSnapshot["summary"] {
  const riskScore =
    metrics.regressedArtifactCount * 18 +
    Math.max(0, metrics.replayCandidateDelta) * 6 +
    Math.max(0, metrics.replayQualityRiskDelta) * 0.8 +
    metrics.touchedDeprecatedNodeCount * 8 +
    metrics.touchedContestedNodeCount * 5 +
    warnings.length * 4;

  if (riskScore >= 55) {
    return {
      recommendation: "revert",
      riskBand: "high",
      reason: `regressed=${metrics.regressedArtifactCount}, replayDelta=${metrics.replayCandidateDelta}, warnings=${warnings.length}`
    };
  }
  if (riskScore >= 22) {
    return {
      recommendation: "review",
      riskBand: "medium",
      reason: `review required: regressed=${metrics.regressedArtifactCount}, replayRiskDelta=${metrics.replayQualityRiskDelta}`
    };
  }
  return {
    recommendation: "keep",
    riskBand: "low",
    reason: `stable/improved: improved=${metrics.improvedArtifactCount}, affected=${metrics.affectedArtifactCount}`
  };
}

export function buildOntologyDraftEvaluationSnapshot(input: {
  generatedAt: string;
  projectId: string;
  projectName: string;
  baseGraph: OntologyGraphSnapshot;
  draft: OntologyDraftSnapshot;
  evaluationArtifacts: Array<unknown>;
}): OntologyDraftEvaluationSnapshot {
  const baseGraph = OntologyGraphSnapshotSchema.parse(input.baseGraph);
  const draft = OntologyDraftSnapshotSchema.parse(input.draft);
  const artifacts = input.evaluationArtifacts.map((artifact) => EvaluationArtifactUnionSchema.parse(artifact));
  const overlay = applyOntologyDraftSnapshot({ baseGraph, draft });
  const changedProjectionIds = new Set(overlay.changedProjectionIds);
  const changedNodeIds = new Set(overlay.changedNodeIds);
  const changedEdgeIds = new Set(overlay.changedEdgeIds);

  let affectedArtifactCount = 0;
  let affectedAskArtifactCount = 0;
  let affectedSearchArtifactCount = 0;
  let improvedArtifactCount = 0;
  let regressedArtifactCount = 0;
  let unchangedArtifactCount = 0;

  const baseArtifacts = artifacts.map((artifact) => applyArtifactStatuses(artifact, baseGraph));
  const overlayArtifacts = artifacts.map((artifact) => applyArtifactStatuses(artifact, overlay.ontologyGraph));

  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index]!;
    const baseArtifact = baseArtifacts[index]!;
    const overlayArtifact = overlayArtifacts[index]!;
    const touched =
      artifact.matchedOntologyNodeIds.some((id) => changedNodeIds.has(id)) ||
      artifact.matchedOntologyProjectionIds.some((id) => changedProjectionIds.has(id));
    if (!touched) {
      continue;
    }
    affectedArtifactCount += 1;
    if (artifact.kind === "ask") {
      affectedAskArtifactCount += 1;
    } else {
      affectedSearchArtifactCount += 1;
    }
    const baseScore = baseArtifact.matchedOntologyNodeStatuses.reduce((sum, status) => sum + statusWeight(status), 0);
    const overlayScore = overlayArtifact.matchedOntologyNodeStatuses.reduce((sum, status) => sum + statusWeight(status), 0);
    if (overlayScore > baseScore) {
      improvedArtifactCount += 1;
    } else if (overlayScore < baseScore) {
      regressedArtifactCount += 1;
    } else {
      unchangedArtifactCount += 1;
    }
  }

  const baseReplay = buildEvaluationReplaySnapshot({
    generatedAt: input.generatedAt,
    artifacts: baseArtifacts
  });
  const overlayReplay = buildEvaluationReplaySnapshot({
    generatedAt: input.generatedAt,
    artifacts: overlayArtifacts
  });

  const touchedNodes = overlay.ontologyGraph.nodes.filter((node) => changedNodeIds.has(node.id));
  const metrics = {
    operationCount: draft.summary.operationCount,
    affectedArtifactCount,
    affectedAskArtifactCount,
    affectedSearchArtifactCount,
    improvedArtifactCount,
    regressedArtifactCount,
    unchangedArtifactCount,
    replayCandidateDelta: overlayReplay.replayCandidates.length - baseReplay.replayCandidates.length,
    replayQualityRiskDelta: Math.round((overlayReplay.summary.averageQualityRisk - baseReplay.summary.averageQualityRisk) * 100) / 100,
    replayContestedDelta:
      overlayReplay.summary.ontologyContestedBackedCount - baseReplay.summary.ontologyContestedBackedCount,
    replayDeprecatedDelta:
      overlayReplay.summary.ontologyDeprecatedBackedCount - baseReplay.summary.ontologyDeprecatedBackedCount,
    touchedValidatedNodeCount: touchedNodes.filter((node) => node.metadata.validatedStatus === "validated").length,
    touchedContestedNodeCount: touchedNodes.filter((node) => node.metadata.validatedStatus === "contested").length,
    touchedDeprecatedNodeCount: touchedNodes.filter((node) => node.metadata.validatedStatus === "deprecated").length
  } satisfies OntologyDraftEvaluationSnapshot["metrics"];

  return OntologyDraftEvaluationSnapshotSchema.parse({
    version: 1,
    generatedAt: input.generatedAt,
    projectId: input.projectId,
    projectName: input.projectName,
    draftVersion: draft.draftVersion,
    basedOnOntologyGeneratedAt: draft.basedOnOntologyGeneratedAt,
    currentOntologyGeneratedAt: baseGraph.generatedAt,
    baseChanged: draft.basedOnOntologyGeneratedAt !== baseGraph.generatedAt,
    changedNodeIds: overlay.changedNodeIds,
    changedEdgeIds: overlay.changedEdgeIds,
    changedProjectionIds: overlay.changedProjectionIds,
    warnings: overlay.warnings,
    metrics,
    summary: recommendationFor(metrics, overlay.warnings)
  });
}

export function buildOntologyDraftEvaluationMarkdown(snapshot: OntologyDraftEvaluationSnapshot): string {
  const lines = [
    "# Ontology Draft Evaluation",
    "",
    `- draftVersion: ${snapshot.draftVersion}`,
    `- generatedAt: ${snapshot.generatedAt}`,
    `- baseChanged: ${snapshot.baseChanged ? "yes" : "no"}`,
    `- recommendation: ${snapshot.summary.recommendation}`,
    `- riskBand: ${snapshot.summary.riskBand}`,
    `- reason: ${snapshot.summary.reason}`,
    "",
    "## Metrics",
    `- affectedArtifactCount: ${snapshot.metrics.affectedArtifactCount}`,
    `- improvedArtifactCount: ${snapshot.metrics.improvedArtifactCount}`,
    `- regressedArtifactCount: ${snapshot.metrics.regressedArtifactCount}`,
    `- replayCandidateDelta: ${snapshot.metrics.replayCandidateDelta}`,
    `- replayQualityRiskDelta: ${snapshot.metrics.replayQualityRiskDelta}`,
    `- touchedValidatedNodeCount: ${snapshot.metrics.touchedValidatedNodeCount}`,
    `- touchedContestedNodeCount: ${snapshot.metrics.touchedContestedNodeCount}`,
    `- touchedDeprecatedNodeCount: ${snapshot.metrics.touchedDeprecatedNodeCount}`,
    "",
    "## Changed Targets",
    `- nodes: ${snapshot.changedNodeIds.join(", ") || "-"}`,
    `- edges: ${snapshot.changedEdgeIds.join(", ") || "-"}`,
    `- projections: ${snapshot.changedProjectionIds.join(", ") || "-"}`,
    `- warnings: ${snapshot.warnings.join(", ") || "-"}`,
    ""
  ];
  return `${lines.join("\n")}\n`;
}
