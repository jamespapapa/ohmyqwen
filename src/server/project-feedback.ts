import { z } from "zod";
import type { LearnedKnowledgePromotionAction, LearnedKnowledgeSnapshot } from "./learned-knowledge.js";

export const ProjectFeedbackKindSchema = z.enum(["ask", "search"]);
export const ProjectFeedbackVerdictSchema = z.enum(["correct", "partial", "incorrect"]);

export const ProjectFeedbackArtifactSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  kind: ProjectFeedbackKindSchema,
  prompt: z.string().min(1),
  questionType: z.string().min(1),
  verdict: ProjectFeedbackVerdictSchema,
  matchedKnowledgeIds: z.array(z.string().min(1)).default([]),
  matchedRetrievalUnitIds: z.array(z.string().min(1)).default([]),
  notes: z.string().default("")
});

const ProjectFeedbackSummarySchema = z.object({
  totalFeedback: z.number().int().min(0),
  correctCount: z.number().int().min(0),
  partialCount: z.number().int().min(0),
  incorrectCount: z.number().int().min(0),
  feedbackBackedKnowledgeCount: z.number().int().min(0),
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

export function buildProjectFeedbackArtifact(input: {
  generatedAt: string;
  projectId: string;
  projectName: string;
  kind: "ask" | "search";
  prompt: string;
  questionType: string;
  verdict: "correct" | "partial" | "incorrect";
  matchedKnowledgeIds?: string[];
  matchedRetrievalUnitIds?: string[];
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
    matchedKnowledgeIds: unique(input.matchedKnowledgeIds ?? []),
    matchedRetrievalUnitIds: unique(input.matchedRetrievalUnitIds ?? []),
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
    `- prompt: ${artifact.prompt}`,
    `- matchedKnowledgeIds: ${artifact.matchedKnowledgeIds.join(", ") || "-"}`,
    `- matchedRetrievalUnitIds: ${artifact.matchedRetrievalUnitIds.join(", ") || "-"}`,
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
    `- lastVerdict: ${snapshot.summary.lastVerdict || "-"}`,
    "",
    "## Top Question Types"
  ];
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
        `questionType:${options.artifact.questionType}`,
        ...(options.artifact.notes ? [`notes:${options.artifact.notes}`] : [])
      ])
    });
  }
  return actions;
}
