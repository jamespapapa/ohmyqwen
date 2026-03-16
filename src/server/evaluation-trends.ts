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

const EvaluationTrendEntrySchema = z.object({
  questionType: z.string().min(1),
  total: z.number().int().min(0),
  askCount: z.number().int().min(0),
  searchCount: z.number().int().min(0),
  qmdCount: z.number().int().min(0),
  lexicalCount: z.number().int().min(0),
  fallbackCount: z.number().int().min(0),
  staleBackedCount: z.number().int().min(0),
  failedAskCount: z.number().int().min(0),
  averageConfidence: z.number().min(0).max(1),
  averageRetrievalCoverage: z.number().min(0).max(100),
  averageEvidenceStrength: z.number().min(0).max(100),
  averageQualityRisk: z.number().min(0).max(100)
});

const EvaluationTrendSummarySchema = z.object({
  totalArtifacts: z.number().int().min(0),
  askCount: z.number().int().min(0),
  searchCount: z.number().int().min(0),
  questionTypeCount: z.number().int().min(0),
  averageRetrievalCoverage: z.number().min(0).max(100),
  averageEvidenceStrength: z.number().min(0).max(100),
  averageQualityRisk: z.number().min(0).max(100),
  highestRiskQuestionType: z.string().default(""),
  strongestCoverageQuestionType: z.string().default("")
});

export const EvaluationTrendSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  summary: EvaluationTrendSummarySchema,
  byQuestionType: z.array(EvaluationTrendEntrySchema)
});

export type EvaluationTrendSnapshot = z.infer<typeof EvaluationTrendSnapshotSchema>;
type EvaluationArtifact = z.infer<typeof EvaluationArtifactUnionSchema>;

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function averageUnit(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
}

function artifactConfidenceValue(artifact: EvaluationArtifact): number {
  return artifact.kind === "ask" ? artifact.confidence : artifact.topConfidence;
}

function artifactProvider(artifact: EvaluationArtifact): "qmd" | "lexical" {
  return artifact.kind === "ask" ? artifact.retrievalProvider : artifact.provider;
}

function artifactFallbackUsed(artifact: EvaluationArtifact): boolean {
  return artifact.kind === "ask" ? artifact.retrievalFallbackUsed : artifact.fallbackUsed;
}

export function buildEvaluationTrendSnapshot(options: {
  generatedAt: string;
  artifacts: EvaluationArtifact[];
  limit?: number;
}): EvaluationTrendSnapshot {
  const artifacts = options.artifacts
    .map((artifact) => EvaluationArtifactUnionSchema.parse(artifact))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, options.limit ?? 180);

  const byType = new Map<string, EvaluationArtifact[]>();
  for (const artifact of artifacts) {
    const bucket = byType.get(artifact.questionType) ?? [];
    bucket.push(artifact);
    byType.set(artifact.questionType, bucket);
  }

  const entries = Array.from(byType.entries())
    .map(([questionType, bucket]) => {
      const askBucket = bucket.filter((artifact): artifact is ProjectAskEvaluationArtifact => artifact.kind === "ask");
      const searchBucket = bucket.filter((artifact): artifact is ProjectSearchEvaluationArtifact => artifact.kind === "search");
      const qmdCount = bucket.filter((artifact) => artifactProvider(artifact) === "qmd").length;
      const lexicalCount = bucket.length - qmdCount;
      const fallbackCount = bucket.filter((artifact) => artifactFallbackUsed(artifact)).length;
      const staleBackedCount = bucket.filter((artifact) => artifact.metrics.retrievalUnitStatuses.stale > 0).length;
      const failedAskCount = askBucket.filter((artifact) => !artifact.qualityGatePassed).length;

      return EvaluationTrendEntrySchema.parse({
        questionType,
        total: bucket.length,
        askCount: askBucket.length,
        searchCount: searchBucket.length,
        qmdCount,
        lexicalCount,
        fallbackCount,
        staleBackedCount,
        failedAskCount,
        averageConfidence: averageUnit(bucket.map((artifact) => artifactConfidenceValue(artifact))),
        averageRetrievalCoverage: average(bucket.map((artifact) => artifact.metrics.retrievalCoverageScore)),
        averageEvidenceStrength: average(bucket.map((artifact) => artifact.metrics.evidenceStrengthScore)),
        averageQualityRisk: average(bucket.map((artifact) => artifact.metrics.qualityRiskScore))
      });
    })
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      if (b.averageQualityRisk !== a.averageQualityRisk) {
        return b.averageQualityRisk - a.averageQualityRisk;
      }
      return a.questionType.localeCompare(b.questionType);
    });

  const highestRisk = [...entries].sort((a, b) => b.averageQualityRisk - a.averageQualityRisk)[0];
  const strongestCoverage = [...entries].sort((a, b) => b.averageRetrievalCoverage - a.averageRetrievalCoverage)[0];

  return EvaluationTrendSnapshotSchema.parse({
    version: 1,
    generatedAt: options.generatedAt,
    summary: {
      totalArtifacts: artifacts.length,
      askCount: artifacts.filter((artifact) => artifact.kind === "ask").length,
      searchCount: artifacts.filter((artifact) => artifact.kind === "search").length,
      questionTypeCount: entries.length,
      averageRetrievalCoverage: average(artifacts.map((artifact) => artifact.metrics.retrievalCoverageScore)),
      averageEvidenceStrength: average(artifacts.map((artifact) => artifact.metrics.evidenceStrengthScore)),
      averageQualityRisk: average(artifacts.map((artifact) => artifact.metrics.qualityRiskScore)),
      highestRiskQuestionType: highestRisk?.questionType ?? "",
      strongestCoverageQuestionType: strongestCoverage?.questionType ?? ""
    },
    byQuestionType: entries
  });
}

export function buildEvaluationTrendMarkdown(snapshot: EvaluationTrendSnapshot): string {
  const lines: string[] = [];
  lines.push("# Evaluation Trends");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- totalArtifacts: ${snapshot.summary.totalArtifacts}`);
  lines.push(`- askCount: ${snapshot.summary.askCount}`);
  lines.push(`- searchCount: ${snapshot.summary.searchCount}`);
  lines.push(`- questionTypeCount: ${snapshot.summary.questionTypeCount}`);
  lines.push(`- averageRetrievalCoverage: ${snapshot.summary.averageRetrievalCoverage}`);
  lines.push(`- averageEvidenceStrength: ${snapshot.summary.averageEvidenceStrength}`);
  lines.push(`- averageQualityRisk: ${snapshot.summary.averageQualityRisk}`);
  lines.push(`- highestRiskQuestionType: ${snapshot.summary.highestRiskQuestionType || "-"}`);
  lines.push(`- strongestCoverageQuestionType: ${snapshot.summary.strongestCoverageQuestionType || "-"}`);
  lines.push("");
  lines.push("## By Question Type");
  if (snapshot.byQuestionType.length === 0) {
    lines.push("- (none)");
  } else {
    for (const item of snapshot.byQuestionType) {
      lines.push(
        `- ${item.questionType}: total=${item.total}, ask=${item.askCount}, search=${item.searchCount}, qmd=${item.qmdCount}, lexical=${item.lexicalCount}, fallback=${item.fallbackCount}, stale=${item.staleBackedCount}, failedAsk=${item.failedAskCount}, avgConfidence=${item.averageConfidence}, avgCoverage=${item.averageRetrievalCoverage}, avgEvidence=${item.averageEvidenceStrength}, avgRisk=${item.averageQualityRisk}`
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
