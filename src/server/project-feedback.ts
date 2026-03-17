import { z } from "zod";
import type { LearnedKnowledgePromotionAction, LearnedKnowledgeSnapshot } from "./learned-knowledge.js";

export const ProjectFeedbackKindSchema = z.enum(["ask", "search"]);
export const ProjectFeedbackVerdictSchema = z.enum(["correct", "partial", "incorrect"]);
export const ProjectFeedbackScopeSchema = z.enum(["answer", "evidence", "node", "edge", "path", "boundary"]);
export const ProjectFeedbackStrengthSchema = z.enum(["weak", "normal", "strong"]);

export const ProjectFeedbackTargetSchema = z
  .object({
    kind: z.enum(["node", "edge", "path", "retrieval-unit", "knowledge", "evidence-path", "boundary"]),
    id: z.string().min(1).optional(),
    label: z.string().default(""),
    nodeIds: z.array(z.string().min(1)).default([]),
    edgeIds: z.array(z.string().min(1)).default([]),
    evidencePath: z.string().min(1).optional(),
    notes: z.string().default("")
  })
  .superRefine((value, ctx) => {
    if (["node", "edge", "retrieval-unit", "knowledge"].includes(value.kind) && !value.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `target id is required for kind=${value.kind}`
      });
    }
    if (value.kind === "path" && value.nodeIds.length === 0 && value.edgeIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "path target requires nodeIds or edgeIds"
      });
    }
    if (value.kind === "evidence-path" && !value.evidencePath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "evidence-path target requires evidencePath"
      });
    }
  });

export const ProjectFeedbackArtifactSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  kind: ProjectFeedbackKindSchema,
  prompt: z.string().min(1),
  questionType: z.string().min(1),
  verdict: ProjectFeedbackVerdictSchema,
  scope: ProjectFeedbackScopeSchema.default("answer"),
  strength: ProjectFeedbackStrengthSchema.default("normal"),
  matchedKnowledgeIds: z.array(z.string().min(1)).default([]),
  matchedRetrievalUnitIds: z.array(z.string().min(1)).default([]),
  targets: z.array(ProjectFeedbackTargetSchema).default([]),
  notes: z.string().default("")
});

const ProjectFeedbackSummarySchema = z.object({
  totalFeedback: z.number().int().min(0),
  correctCount: z.number().int().min(0),
  partialCount: z.number().int().min(0),
  incorrectCount: z.number().int().min(0),
  feedbackBackedKnowledgeCount: z.number().int().min(0),
  scopeCounts: z.record(z.string(), z.number().int().min(0)).default({}),
  targetedNodeCount: z.number().int().min(0),
  targetedEdgeCount: z.number().int().min(0),
  targetedPathCount: z.number().int().min(0),
  topQuestionTypes: z.array(z.object({ questionType: z.string().min(1), count: z.number().int().min(0) })),
  lastVerdict: ProjectFeedbackVerdictSchema.optional().default("partial")
});

export const ProjectFeedbackSummarySnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  summary: ProjectFeedbackSummarySchema,
  recentFeedback: z.array(ProjectFeedbackArtifactSchema).default([])
});

export type ProjectFeedbackArtifact = z.infer<typeof ProjectFeedbackArtifactSchema>;
export type ProjectFeedbackSummarySnapshot = z.infer<typeof ProjectFeedbackSummarySnapshotSchema>;

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function countTop(values: string[], limit = 8): Array<{ questionType: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([questionType, count]) => ({ questionType, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.questionType.localeCompare(b.questionType)))
    .slice(0, limit);
}

function countItems(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

export function buildProjectFeedbackArtifact(input: {
  generatedAt: string;
  projectId: string;
  projectName: string;
  kind: "ask" | "search";
  prompt: string;
  questionType: string;
  verdict: "correct" | "partial" | "incorrect";
  scope?: "answer" | "evidence" | "node" | "edge" | "path" | "boundary";
  strength?: "weak" | "normal" | "strong";
  matchedKnowledgeIds?: string[];
  matchedRetrievalUnitIds?: string[];
  targets?: Array<z.input<typeof ProjectFeedbackTargetSchema>>;
  notes?: string;
}): ProjectFeedbackArtifact {
  return ProjectFeedbackArtifactSchema.parse({
    version: 1,
    generatedAt: input.generatedAt,
    projectId: input.projectId,
    projectName: input.projectName,
    kind: input.kind,
    prompt: input.prompt,
    questionType: input.questionType,
    verdict: input.verdict,
    scope: input.scope ?? "answer",
    strength: input.strength ?? "normal",
    matchedKnowledgeIds: unique(input.matchedKnowledgeIds ?? []),
    matchedRetrievalUnitIds: unique(input.matchedRetrievalUnitIds ?? []),
    targets: input.targets ?? [],
    notes: input.notes ?? ""
  });
}

export function buildProjectFeedbackMarkdown(artifact: ProjectFeedbackArtifact): string {
  return [
    "# User Feedback",
    "",
    `- generatedAt: ${artifact.generatedAt}`,
    `- projectId: ${artifact.projectId}`,
    `- projectName: ${artifact.projectName}`,
    `- kind: ${artifact.kind}`,
    `- questionType: ${artifact.questionType}`,
    `- verdict: ${artifact.verdict}`,
    `- scope: ${artifact.scope}`,
    `- strength: ${artifact.strength}`,
    `- prompt: ${artifact.prompt}`,
    `- matchedKnowledgeIds: ${artifact.matchedKnowledgeIds.join(", ") || "-"}`,
    `- matchedRetrievalUnitIds: ${artifact.matchedRetrievalUnitIds.join(", ") || "-"}`,
    `- targetCount: ${artifact.targets.length}`,
    `- notes: ${artifact.notes || "-"}`,
    ""
  ].join("\n");
}

export function buildProjectFeedbackSummarySnapshot(options: {
  generatedAt: string;
  artifacts: ProjectFeedbackArtifact[];
  limit?: number;
}): ProjectFeedbackSummarySnapshot {
  const artifacts = options.artifacts
    .map((artifact) => ProjectFeedbackArtifactSchema.parse(artifact))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, options.limit ?? 80);

  return ProjectFeedbackSummarySnapshotSchema.parse({
    version: 1,
    generatedAt: options.generatedAt,
    summary: {
      totalFeedback: artifacts.length,
      correctCount: artifacts.filter((artifact) => artifact.verdict === "correct").length,
      partialCount: artifacts.filter((artifact) => artifact.verdict === "partial").length,
      incorrectCount: artifacts.filter((artifact) => artifact.verdict === "incorrect").length,
      feedbackBackedKnowledgeCount: unique(artifacts.flatMap((artifact) => artifact.matchedKnowledgeIds)).length,
      scopeCounts: countItems(artifacts.map((artifact) => artifact.scope)),
      targetedNodeCount: unique(
        artifacts.flatMap((artifact) =>
          artifact.targets
            .filter((target) => ["node", "retrieval-unit", "knowledge"].includes(target.kind) && target.id)
            .map((target) => target.id as string)
        )
      ).length,
      targetedEdgeCount: unique(
        artifacts.flatMap((artifact) =>
          artifact.targets.filter((target) => target.kind === "edge" && target.id).map((target) => target.id as string)
        )
      ).length,
      targetedPathCount: artifacts.reduce(
        (sum, artifact) =>
          sum + artifact.targets.filter((target) => target.kind === "path" || target.kind === "evidence-path").length,
        0
      ),
      topQuestionTypes: countTop(artifacts.map((artifact) => artifact.questionType)),
      lastVerdict: artifacts[0]?.verdict ?? "partial"
    },
    recentFeedback: artifacts.slice(0, 12)
  });
}

export function buildProjectFeedbackSummaryMarkdown(snapshot: ProjectFeedbackSummarySnapshot): string {
  const lines = [
    "# User Feedback Summary",
    "",
    "## Summary",
    `- totalFeedback: ${snapshot.summary.totalFeedback}`,
    `- correctCount: ${snapshot.summary.correctCount}`,
    `- partialCount: ${snapshot.summary.partialCount}`,
    `- incorrectCount: ${snapshot.summary.incorrectCount}`,
    `- feedbackBackedKnowledgeCount: ${snapshot.summary.feedbackBackedKnowledgeCount}`,
    `- targetedNodeCount: ${snapshot.summary.targetedNodeCount}`,
    `- targetedEdgeCount: ${snapshot.summary.targetedEdgeCount}`,
    `- targetedPathCount: ${snapshot.summary.targetedPathCount}`,
    `- lastVerdict: ${snapshot.summary.lastVerdict || "-"}`,
    "",
    "## Scope Counts"
  ];
  const scopeEntries = Object.entries(snapshot.summary.scopeCounts ?? {});
  if (scopeEntries.length === 0) {
    lines.push("- (none)");
  } else {
    for (const [scope, count] of scopeEntries) {
      lines.push(`- ${scope}: ${count}`);
    }
  }
  lines.push("", "## Top Question Types");
  if (snapshot.summary.topQuestionTypes.length === 0) {
    lines.push("- (none)");
  } else {
    for (const entry of snapshot.summary.topQuestionTypes) {
      lines.push(`- ${entry.questionType}: ${entry.count}`);
    }
  }
  lines.push("", "## Recent Feedback");
  if (snapshot.recentFeedback.length === 0) {
    lines.push("- (none)");
  } else {
    for (const artifact of snapshot.recentFeedback) {
      lines.push(`- [${artifact.verdict}] ${artifact.questionType} | ${artifact.prompt}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function deriveFeedbackPromotionActions(options: {
  artifact: ProjectFeedbackArtifact;
  learnedKnowledge: LearnedKnowledgeSnapshot;
}): LearnedKnowledgePromotionAction[] {
  const verdict = options.artifact.verdict;
  if (verdict === "partial") {
    return [];
  }
  const candidatesById = new Map(options.learnedKnowledge.candidates.map((candidate) => [candidate.id, candidate]));
  const actions: LearnedKnowledgePromotionAction[] = [];
  for (const candidateId of unique(options.artifact.matchedKnowledgeIds)) {
    const candidate = candidatesById.get(candidateId);
    if (!candidate) {
      continue;
    }
    actions.push({
      candidateId,
      currentStatus: candidate.status,
      targetStatus: verdict === "correct" ? "validated" : "stale",
      score: verdict === "correct" ? 96 : 97,
      confidence: verdict === "correct" ? 0.96 : 0.97,
      reasons: unique([
        `feedback:${verdict}`,
        `scope:${options.artifact.scope}`,
        `questionType:${options.artifact.questionType}`,
        ...(options.artifact.notes ? [`notes:${options.artifact.notes}`] : [])
      ])
    });
  }
  return actions;
}
