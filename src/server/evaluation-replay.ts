import { z } from "zod";
import {
  ProjectAskEvaluationArtifactSchema,
  ProjectSearchEvaluationArtifactSchema,
  type ProjectAskEvaluationArtifact,
  type ProjectSearchEvaluationArtifact
} from "./evaluation-artifacts.js";

const EvaluationArtifactUnionSchema = z.union([
  ProjectAskEvaluationArtifactSchema,
  ProjectSearchEvaluationArtifactSchema
]);

const ReplayCandidateSchema = z.object({
  kind: z.enum(["ask", "search"]),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  questionOrQuery: z.string().min(1),
  questionType: z.string().min(1),
  score: z.number().min(0),
  reasons: z.array(z.string().min(1)).default([]),
  generatedAt: z.string().min(1)
});

const EvaluationReplaySummarySchema = z.object({
  totalArtifacts: z.number().int().min(0),
  askCount: z.number().int().min(0),
  searchCount: z.number().int().min(0),
  failedAskCount: z.number().int().min(0),
  staleBackedCount: z.number().int().min(0),
  ontologyContestedBackedCount: z.number().int().min(0).default(0),
  ontologyDeprecatedBackedCount: z.number().int().min(0).default(0),
  topQuestionTypes: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) })),
  topFailureCodes: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) })),
  averageRetrievalCoverage: z.number().min(0).max(100),
  averageQualityRisk: z.number().min(0).max(100)
});

export const EvaluationReplaySnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  summary: EvaluationReplaySummarySchema,
  replayCandidates: z.array(ReplayCandidateSchema)
});

export type EvaluationArtifact = z.infer<typeof EvaluationArtifactUnionSchema>;
export type EvaluationReplaySnapshot = z.infer<typeof EvaluationReplaySnapshotSchema>;

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function countTop(values: string[], limit = 12): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.id.localeCompare(b.id)))
    .slice(0, limit);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function buildReplayCandidate(
  artifact: EvaluationArtifact
): z.infer<typeof ReplayCandidateSchema> | undefined {
  if (artifact.kind === "ask") {
    const reasons = unique([
      ...artifact.qualityGateFailures.map((item) => `failure:${item}`),
      artifact.retryStopReason ? `retry:${artifact.retryStopReason}` : "",
      artifact.droppedIncoherentFlowCount > 0 ? "canonical-flow-incoherent" : "",
      artifact.canonicalNamespaceCount > 1 ? "canonical-flow-mixed-namespace" : "",
      artifact.metrics.retrievalUnitStatuses.stale > 0 ? "stale-units" : "",
      artifact.matchedOntologyNodeStatuses.includes("contested") ? "ontology-contested" : "",
      artifact.matchedOntologyNodeStatuses.includes("deprecated") ? "ontology-deprecated" : "",
      artifact.metrics.qualityRiskScore >= 50 ? "quality-risk-high" : "",
      artifact.confidence < 0.5 ? "confidence-low" : ""
    ]);
    if (artifact.qualityGatePassed && reasons.length === 0) {
      return undefined;
    }
    const score =
      artifact.metrics.qualityRiskScore +
      artifact.qualityGateFailures.length * 12 +
      artifact.droppedIncoherentFlowCount * 6 +
      Math.max(0, artifact.canonicalNamespaceCount - 1) * 12 +
      artifact.metrics.retrievalUnitStatuses.stale * 10 +
      artifact.matchedOntologyNodeStatuses.filter((status) => status === "contested").length * 8 +
      artifact.matchedOntologyNodeStatuses.filter((status) => status === "deprecated").length * 14 +
      (artifact.confidence < 0.5 ? 10 : 0);
    return ReplayCandidateSchema.parse({
      kind: "ask",
      projectId: artifact.projectId,
      projectName: artifact.projectName,
      questionOrQuery: artifact.question,
      questionType: artifact.questionType,
      score,
      reasons,
      generatedAt: artifact.generatedAt
    });
  }

  const reasons = unique([
    artifact.metrics.retrievalUnitStatuses.stale > 0 ? "stale-units" : "",
    artifact.matchedOntologyNodeStatuses.includes("contested") ? "ontology-contested" : "",
    artifact.matchedOntologyNodeStatuses.includes("deprecated") ? "ontology-deprecated" : "",
    artifact.fallbackUsed ? "fallback-used" : "",
    artifact.topConfidence < 0.45 ? "top-confidence-low" : "",
    artifact.metrics.qualityRiskScore >= 45 ? "quality-risk-high" : ""
  ]);
  if (reasons.length === 0) {
    return undefined;
  }
  const score =
    artifact.metrics.qualityRiskScore +
    artifact.metrics.retrievalUnitStatuses.stale * 10 +
    artifact.matchedOntologyNodeStatuses.filter((status) => status === "contested").length * 8 +
    artifact.matchedOntologyNodeStatuses.filter((status) => status === "deprecated").length * 14 +
    (artifact.fallbackUsed ? 8 : 0);
  return ReplayCandidateSchema.parse({
    kind: "search",
    projectId: artifact.projectId,
    projectName: artifact.projectName,
    questionOrQuery: artifact.query,
    questionType: artifact.questionType,
    score,
    reasons,
    generatedAt: artifact.generatedAt
  });
}

export function buildEvaluationReplaySnapshot(options: {
  generatedAt: string;
  artifacts: EvaluationArtifact[];
  limit?: number;
}): EvaluationReplaySnapshot {
  const artifacts = options.artifacts
    .map((artifact) => EvaluationArtifactUnionSchema.parse(artifact))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, options.limit ?? 100);

  const askArtifacts = artifacts.filter((artifact): artifact is ProjectAskEvaluationArtifact => artifact.kind === "ask");
  const searchArtifacts = artifacts.filter((artifact): artifact is ProjectSearchEvaluationArtifact => artifact.kind === "search");
  const replayCandidates = artifacts
    .map((artifact) => buildReplayCandidate(artifact))
    .filter((item): item is z.infer<typeof ReplayCandidateSchema> => Boolean(item))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : b.generatedAt.localeCompare(a.generatedAt)))
    .slice(0, 24);

  return EvaluationReplaySnapshotSchema.parse({
    version: 1,
    generatedAt: options.generatedAt,
    summary: {
      totalArtifacts: artifacts.length,
      askCount: askArtifacts.length,
      searchCount: searchArtifacts.length,
      failedAskCount: askArtifacts.filter((artifact) => !artifact.qualityGatePassed).length,
      staleBackedCount: artifacts.filter((artifact) => artifact.metrics.retrievalUnitStatuses.stale > 0).length,
      ontologyContestedBackedCount: artifacts.filter((artifact) =>
        artifact.matchedOntologyNodeStatuses.includes("contested")
      ).length,
      ontologyDeprecatedBackedCount: artifacts.filter((artifact) =>
        artifact.matchedOntologyNodeStatuses.includes("deprecated")
      ).length,
      topQuestionTypes: countTop(artifacts.map((artifact) => artifact.questionType)),
      topFailureCodes: countTop(askArtifacts.flatMap((artifact) => artifact.qualityGateFailures)),
      averageRetrievalCoverage: average(artifacts.map((artifact) => artifact.metrics.retrievalCoverageScore)),
      averageQualityRisk: average(artifacts.map((artifact) => artifact.metrics.qualityRiskScore))
    },
    replayCandidates
  });
}

export function buildEvaluationReplayMarkdown(snapshot: EvaluationReplaySnapshot): string {
  const lines: string[] = [];
  lines.push("# Evaluation Replay");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- totalArtifacts: ${snapshot.summary.totalArtifacts}`);
  lines.push(`- askCount: ${snapshot.summary.askCount}`);
  lines.push(`- searchCount: ${snapshot.summary.searchCount}`);
  lines.push(`- failedAskCount: ${snapshot.summary.failedAskCount}`);
  lines.push(`- staleBackedCount: ${snapshot.summary.staleBackedCount}`);
  lines.push(`- ontologyContestedBackedCount: ${snapshot.summary.ontologyContestedBackedCount}`);
  lines.push(`- ontologyDeprecatedBackedCount: ${snapshot.summary.ontologyDeprecatedBackedCount}`);
  lines.push(`- averageRetrievalCoverage: ${snapshot.summary.averageRetrievalCoverage}`);
  lines.push(`- averageQualityRisk: ${snapshot.summary.averageQualityRisk}`);
  lines.push("");
  lines.push("## Top Question Types");
  for (const item of snapshot.summary.topQuestionTypes) {
    lines.push(`- ${item.id}: ${item.count}`);
  }
  lines.push("");
  lines.push("## Top Failure Codes");
  for (const item of snapshot.summary.topFailureCodes) {
    lines.push(`- ${item.id}: ${item.count}`);
  }
  lines.push("");
  lines.push("## Replay Candidates");
  if (snapshot.replayCandidates.length === 0) {
    lines.push("- (none)");
  } else {
    for (const candidate of snapshot.replayCandidates) {
      lines.push(
        `- [${candidate.kind}] ${candidate.questionType} | score=${candidate.score} | ${candidate.questionOrQuery} | reasons=${candidate.reasons.join(", ") || "(none)"}`
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
