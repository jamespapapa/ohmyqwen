import { createHash } from "node:crypto";
import { z } from "zod";
import { ProjectFeedbackArtifactSchema, type ProjectFeedbackArtifact } from "./project-feedback.js";

export const OntologyReviewTargetKindSchema = z.enum(["node", "edge", "path"]);
export const OntologyReviewStatusSchema = z.enum(["candidate", "validated", "contested", "deprecated"]);

export const OntologyReviewRecordSchema = z.object({
  targetKind: OntologyReviewTargetKindSchema,
  targetId: z.string().min(1),
  label: z.string().default(""),
  status: OntologyReviewStatusSchema,
  confidence: z.number().min(0).max(1),
  feedbackCount: z.number().int().min(0),
  correctCount: z.number().int().min(0),
  partialCount: z.number().int().min(0),
  incorrectCount: z.number().int().min(0),
  strongCorrectCount: z.number().int().min(0),
  strongIncorrectCount: z.number().int().min(0),
  scopes: z.array(z.string().min(1)).default([]),
  questionTypes: z.array(z.string().min(1)).default([]),
  notes: z.array(z.string().min(1)).default([])
});

const OntologyReviewSummarySchema = z.object({
  totalTargets: z.number().int().min(0),
  statusCounts: z.record(z.string(), z.number().int().min(0)),
  validatedCount: z.number().int().min(0),
  contestedCount: z.number().int().min(0),
  deprecatedCount: z.number().int().min(0),
  topTargets: z.array(
    z.object({
      targetKind: OntologyReviewTargetKindSchema,
      targetId: z.string().min(1),
      status: OntologyReviewStatusSchema,
      feedbackCount: z.number().int().min(0),
      confidence: z.number().min(0).max(1)
    })
  )
});

export const OntologyReviewSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  records: z.array(OntologyReviewRecordSchema),
  summary: OntologyReviewSummarySchema
});

export type OntologyReviewSnapshot = z.infer<typeof OntologyReviewSnapshotSchema>;

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

export function canonicalOntologyPathTargetId(target: {
  label?: string;
  nodeIds?: string[];
  edgeIds?: string[];
  evidencePath?: string;
  notes?: string;
}): string {
  const digest = createHash("sha1")
    .update(
      JSON.stringify({
        label: target.label ?? "",
        nodeIds: target.nodeIds ?? [],
        edgeIds: target.edgeIds ?? [],
        evidencePath: target.evidencePath ?? "",
        notes: target.notes ?? ""
      })
    )
    .digest("hex")
    .slice(0, 12);
  return `path-target:${digest}`;
}

export function canonicalOntologyReviewTarget(input: ProjectFeedbackArtifact["targets"][number]):
  | { targetKind: "node"; targetId: string; label: string }
  | { targetKind: "edge"; targetId: string; label: string }
  | { targetKind: "path"; targetId: string; label: string }
  | undefined {
  switch (input.kind) {
    case "node":
      return input.id ? { targetKind: "node", targetId: input.id, label: input.label || input.id } : undefined;
    case "retrieval-unit":
      return input.id
        ? { targetKind: "node", targetId: `retrieval-unit:${input.id}`, label: input.label || input.id }
        : undefined;
    case "knowledge":
      return input.id ? { targetKind: "node", targetId: `knowledge:${input.id}`, label: input.label || input.id } : undefined;
    case "edge":
      return input.id ? { targetKind: "edge", targetId: input.id, label: input.label || input.id } : undefined;
    case "path":
      return {
        targetKind: "path",
        targetId: canonicalOntologyPathTargetId(input),
        label: input.label || input.nodeIds.join(" -> ") || input.edgeIds.join(" -> ") || input.id || "path"
      };
    case "evidence-path":
      return input.evidencePath
        ? { targetKind: "path", targetId: `path-evidence:${input.evidencePath}`, label: input.label || input.evidencePath }
        : undefined;
    case "boundary":
      return {
        targetKind: "path",
        targetId: `boundary:${createHash("sha1").update(JSON.stringify(input)).digest("hex").slice(0, 12)}`,
        label: input.label || input.notes || "boundary"
      };
    default:
      return undefined;
  }
}

function deriveStatus(metrics: {
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  strongCorrectCount: number;
  strongIncorrectCount: number;
}): z.infer<typeof OntologyReviewStatusSchema> {
  if (
    metrics.incorrectCount >= 3 ||
    metrics.strongIncorrectCount >= 2 ||
    (metrics.strongIncorrectCount >= 1 && metrics.incorrectCount >= 2)
  ) {
    return "deprecated";
  }
  if (metrics.incorrectCount > 0 && metrics.correctCount > 0) {
    return "contested";
  }
  if (metrics.incorrectCount > 0) {
    return "contested";
  }
  if (metrics.strongCorrectCount >= 1 || metrics.correctCount >= 2) {
    return "validated";
  }
  return "candidate";
}

function deriveConfidence(metrics: {
  feedbackCount: number;
  strongCorrectCount: number;
  strongIncorrectCount: number;
}): number {
  return Math.max(
    0.35,
    Math.min(0.99, 0.42 + metrics.feedbackCount * 0.1 + metrics.strongCorrectCount * 0.09 + metrics.strongIncorrectCount * 0.11)
  );
}

export function buildOntologyReviewSnapshot(options: {
  generatedAt: string;
  feedbackArtifacts: ProjectFeedbackArtifact[];
}): OntologyReviewSnapshot {
  const artifacts = options.feedbackArtifacts.map((artifact) => ProjectFeedbackArtifactSchema.parse(artifact));
  const aggregate = new Map<
    string,
    {
      targetKind: "node" | "edge" | "path";
      targetId: string;
      label: string;
      feedbackCount: number;
      correctCount: number;
      partialCount: number;
      incorrectCount: number;
      strongCorrectCount: number;
      strongIncorrectCount: number;
      scopes: string[];
      questionTypes: string[];
      notes: string[];
    }
  >();

  for (const artifact of artifacts) {
    const targets = artifact.targets
      .map((target) => canonicalOntologyReviewTarget(target))
      .filter(Boolean) as Array<{ targetKind: "node" | "edge" | "path"; targetId: string; label: string }>;

    for (const target of targets) {
      const key = `${target.targetKind}:${target.targetId}`;
      const current =
        aggregate.get(key) ??
        {
          targetKind: target.targetKind,
          targetId: target.targetId,
          label: target.label,
          feedbackCount: 0,
          correctCount: 0,
          partialCount: 0,
          incorrectCount: 0,
          strongCorrectCount: 0,
          strongIncorrectCount: 0,
          scopes: [],
          questionTypes: [],
          notes: []
        };

      current.feedbackCount += 1;
      if (artifact.verdict === "correct") {
        current.correctCount += 1;
      } else if (artifact.verdict === "incorrect") {
        current.incorrectCount += 1;
      } else {
        current.partialCount += 1;
      }

      if (artifact.strength === "strong" && artifact.verdict === "correct") {
        current.strongCorrectCount += 1;
      }
      if (artifact.strength === "strong" && artifact.verdict === "incorrect") {
        current.strongIncorrectCount += 1;
      }

      current.scopes.push(artifact.scope);
      current.questionTypes.push(artifact.questionType);
      if (artifact.notes) {
        current.notes.push(artifact.notes);
      }
      aggregate.set(key, current);
    }
  }

  const records = Array.from(aggregate.values())
    .map((item) => {
      const status = deriveStatus(item);
      const confidence = deriveConfidence(item);
      return OntologyReviewRecordSchema.parse({
        targetKind: item.targetKind,
        targetId: item.targetId,
        label: item.label,
        status,
        confidence,
        feedbackCount: item.feedbackCount,
        correctCount: item.correctCount,
        partialCount: item.partialCount,
        incorrectCount: item.incorrectCount,
        strongCorrectCount: item.strongCorrectCount,
        strongIncorrectCount: item.strongIncorrectCount,
        scopes: unique(item.scopes),
        questionTypes: unique(item.questionTypes),
        notes: unique(item.notes).slice(0, 8)
      });
    })
    .sort((a, b) => {
      if (b.feedbackCount !== a.feedbackCount) return b.feedbackCount - a.feedbackCount;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return `${a.targetKind}:${a.targetId}`.localeCompare(`${b.targetKind}:${b.targetId}`);
    });

  return OntologyReviewSnapshotSchema.parse({
    version: 1,
    generatedAt: options.generatedAt,
    records,
    summary: {
      totalTargets: records.length,
      statusCounts: countBy(records.map((record) => record.status)),
      validatedCount: records.filter((record) => record.status === "validated").length,
      contestedCount: records.filter((record) => record.status === "contested").length,
      deprecatedCount: records.filter((record) => record.status === "deprecated").length,
      topTargets: records.slice(0, 12).map((record) => ({
        targetKind: record.targetKind,
        targetId: record.targetId,
        status: record.status,
        feedbackCount: record.feedbackCount,
        confidence: record.confidence
      }))
    }
  });
}

export function buildOntologyReviewMarkdown(snapshot: OntologyReviewSnapshot): string {
  const lines = [
    "# Ontology Review",
    "",
    `- totalTargets: ${snapshot.summary.totalTargets}`,
    `- validatedCount: ${snapshot.summary.validatedCount}`,
    `- contestedCount: ${snapshot.summary.contestedCount}`,
    `- deprecatedCount: ${snapshot.summary.deprecatedCount}`,
    "",
    "## Status Counts"
  ];

  const entries = Object.entries(snapshot.summary.statusCounts);
  if (entries.length === 0) {
    lines.push("- (none)");
  } else {
    for (const [status, count] of entries) {
      lines.push(`- ${status}: ${count}`);
    }
  }

  lines.push("", "## Top Targets");
  if (snapshot.summary.topTargets.length === 0) {
    lines.push("- (none)");
  } else {
    for (const target of snapshot.summary.topTargets) {
      lines.push(`- [${target.targetKind}] ${target.targetId} | ${target.status} | feedback=${target.feedbackCount} | confidence=${target.confidence.toFixed(2)}`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}
