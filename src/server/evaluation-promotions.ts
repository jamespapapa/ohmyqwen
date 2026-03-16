import { z } from "zod";
import type { LearnedKnowledgeSnapshot, LearnedKnowledgeStatus } from "./learned-knowledge.js";
import {
  ProjectAskEvaluationArtifactSchema,
  ProjectSearchEvaluationArtifactSchema
} from "./evaluation-artifacts.js";

const EvaluationArtifactUnionSchema = z.union([
  ProjectAskEvaluationArtifactSchema,
  ProjectSearchEvaluationArtifactSchema
]);

const EvaluationPromotionActionSchema = z.object({
  candidateId: z.string().min(1),
  currentStatus: z.enum(["candidate", "validated", "stale"]),
  targetStatus: z.enum(["candidate", "validated", "stale"]),
  score: z.number().min(0),
  reasons: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1)
});

const EvaluationPromotionSummarySchema = z.object({
  totalActions: z.number().int().min(0),
  promoteCount: z.number().int().min(0),
  staleCount: z.number().int().min(0),
  candidateCount: z.number().int().min(0),
  highestPriorityCandidateId: z.string().default("")
});

export const EvaluationPromotionSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  summary: EvaluationPromotionSummarySchema,
  actions: z.array(EvaluationPromotionActionSchema)
});

export type EvaluationPromotionAction = z.infer<typeof EvaluationPromotionActionSchema>;
export type EvaluationPromotionSnapshot = z.infer<typeof EvaluationPromotionSnapshotSchema>;
type EvaluationArtifact = z.infer<typeof EvaluationArtifactUnionSchema>;

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildActionForCandidate(options: {
  candidateId: string;
  currentStatus: LearnedKnowledgeStatus;
  artifacts: EvaluationArtifact[];
}): EvaluationPromotionAction | undefined {
  const askArtifacts = options.artifacts.filter(
    (artifact): artifact is z.infer<typeof ProjectAskEvaluationArtifactSchema> => artifact.kind === "ask"
  );
  const searchArtifacts = options.artifacts.filter(
    (artifact): artifact is z.infer<typeof ProjectSearchEvaluationArtifactSchema> => artifact.kind === "search"
  );
  const total = options.artifacts.length;
  const successfulAskCount = askArtifacts.filter((artifact) => artifact.qualityGatePassed).length;
  const failedAskCount = askArtifacts.length - successfulAskCount;
  const fallbackCount = options.artifacts.filter((artifact) =>
    artifact.kind === "ask" ? artifact.retrievalFallbackUsed : artifact.fallbackUsed
  ).length;
  const successfulSearchCount = searchArtifacts.filter(
    (artifact) => artifact.hitCount > 0 && !artifact.fallbackUsed && artifact.topConfidence >= 0.45
  ).length;
  const staleCount = options.artifacts.filter((artifact) => artifact.metrics.retrievalUnitStatuses.stale > 0).length;
  const averageCoverage =
    options.artifacts.reduce((sum, artifact) => sum + artifact.metrics.retrievalCoverageScore, 0) / Math.max(total, 1);
  const averageRisk =
    options.artifacts.reduce((sum, artifact) => sum + artifact.metrics.qualityRiskScore, 0) / Math.max(total, 1);
  const averageConfidence =
    options.artifacts.reduce(
      (sum, artifact) =>
        sum + (artifact.kind === "ask" ? artifact.confidence : artifact.topConfidence),
      0
    ) / Math.max(total, 1);
  const qmdCount = options.artifacts.filter((artifact) =>
    artifact.kind === "ask" ? artifact.retrievalProvider === "qmd" : artifact.provider === "qmd"
  ).length;

  const reasons: string[] = [];
  let targetStatus: LearnedKnowledgeStatus | undefined;
  let score = 0;

  if (
    ["candidate", "stale"].includes(options.currentStatus) &&
    total >= 2 &&
    successfulAskCount + successfulSearchCount >= 2 &&
    failedAskCount === 0 &&
    averageCoverage >= 45 &&
    averageRisk <= 35 &&
    averageConfidence >= 0.55
  ) {
    targetStatus = "validated";
    reasons.push("promotion-ready", `artifacts=${total}`, `coverage=${Math.round(averageCoverage)}`, `risk=${Math.round(averageRisk)}`);
    score = averageCoverage + (100 - averageRisk) + total * 5 + qmdCount * 3;
  } else if (
    options.currentStatus !== "stale" &&
    (failedAskCount >= 2 || staleCount >= 2) &&
    averageRisk >= 45
  ) {
    targetStatus = "stale";
    reasons.push("stale-risk-high", `failedAsk=${failedAskCount}`, `stale=${staleCount}`, `risk=${Math.round(averageRisk)}`);
    score = averageRisk + failedAskCount * 8 + staleCount * 10 + fallbackCount * 4;
  }

  if (!targetStatus || targetStatus === options.currentStatus) {
    return undefined;
  }

  return EvaluationPromotionActionSchema.parse({
    candidateId: options.candidateId,
    currentStatus: options.currentStatus,
    targetStatus,
    score: Math.round(score),
    reasons: unique(reasons),
    confidence: clampUnit(
      0.45 +
        Math.min(0.35, total * 0.08) +
        Math.min(0.15, qmdCount * 0.05) -
        Math.min(0.2, averageRisk / 500)
    )
  });
}

export function buildEvaluationPromotionSnapshot(options: {
  generatedAt: string;
  learnedKnowledge: LearnedKnowledgeSnapshot;
  artifacts: EvaluationArtifact[];
  limit?: number;
}): EvaluationPromotionSnapshot {
  const artifacts = options.artifacts
    .map((artifact) => EvaluationArtifactUnionSchema.parse(artifact))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, options.limit ?? 160);

  const artifactsByCandidate = new Map<string, EvaluationArtifact[]>();
  for (const artifact of artifacts) {
    const matchedIds =
      artifact.kind === "ask"
        ? artifact.matchedKnowledgeIds
        : artifact.matchedKnowledgeIds;
    for (const candidateId of matchedIds) {
      const bucket = artifactsByCandidate.get(candidateId) ?? [];
      bucket.push(artifact);
      artifactsByCandidate.set(candidateId, bucket);
    }
  }

  const actions = options.learnedKnowledge.candidates
    .map((candidate) =>
      buildActionForCandidate({
        candidateId: candidate.id,
        currentStatus: candidate.status,
        artifacts: artifactsByCandidate.get(candidate.id) ?? []
      })
    )
    .filter((action): action is EvaluationPromotionAction => Boolean(action))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.candidateId.localeCompare(b.candidateId)));

  return EvaluationPromotionSnapshotSchema.parse({
    version: 1,
    generatedAt: options.generatedAt,
    summary: {
      totalActions: actions.length,
      promoteCount: actions.filter((action) => action.targetStatus === "validated").length,
      staleCount: actions.filter((action) => action.targetStatus === "stale").length,
      candidateCount: actions.filter((action) => action.targetStatus === "candidate").length,
      highestPriorityCandidateId: actions[0]?.candidateId ?? ""
    },
    actions
  });
}

export function buildEvaluationPromotionMarkdown(snapshot: EvaluationPromotionSnapshot): string {
  const lines: string[] = [];
  lines.push("# Evaluation Promotions");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- totalActions: ${snapshot.summary.totalActions}`);
  lines.push(`- promoteCount: ${snapshot.summary.promoteCount}`);
  lines.push(`- staleCount: ${snapshot.summary.staleCount}`);
  lines.push(`- candidateCount: ${snapshot.summary.candidateCount}`);
  lines.push(`- highestPriorityCandidateId: ${snapshot.summary.highestPriorityCandidateId || "-"}`);
  lines.push("");
  lines.push("## Actions");
  if (snapshot.actions.length === 0) {
    lines.push("- (none)");
  } else {
    for (const action of snapshot.actions) {
      lines.push(
        `- ${action.candidateId}: ${action.currentStatus} -> ${action.targetStatus} | score=${action.score} | confidence=${action.confidence} | reasons=${action.reasons.join(", ") || "(none)"}`
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
