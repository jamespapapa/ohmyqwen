import { z } from "zod";
import type { AskQuestionType } from "./question-types.js";

const RetrievalUnitStatusSchema = z.enum(["candidate", "validated", "derived", "stale"]);

const RetrievalUnitStatusSummarySchema = z.object({
  total: z.number().int().min(0),
  candidate: z.number().int().min(0),
  validated: z.number().int().min(0),
  derived: z.number().int().min(0),
  stale: z.number().int().min(0)
});

const EvaluationMetricsSchema = z.object({
  retrievalUnitStatuses: RetrievalUnitStatusSummarySchema,
  retrievalCoverageScore: z.number().min(0).max(100),
  evidenceStrengthScore: z.number().min(0).max(100),
  qualityRiskScore: z.number().min(0).max(100)
});

const EvaluationArtifactBaseSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  kind: z.enum(["ask", "search"]),
  questionType: z.string().min(1),
  plannedQuery: z.string().default(""),
  matchedRetrievalUnitIds: z.array(z.string().min(1)).default([]),
  matchedRetrievalUnitStatuses: z.array(RetrievalUnitStatusSchema).default([]),
  metrics: EvaluationMetricsSchema
});

export const ProjectAskEvaluationArtifactSchema = EvaluationArtifactBaseSchema.extend({
  kind: z.literal("ask"),
  question: z.string().min(1),
  strategyType: z.string().min(1),
  confidence: z.number().min(0).max(1),
  qualityGatePassed: z.boolean(),
  attempts: z.number().int().min(0),
  llmCallCount: z.number().int().min(0),
  retrievalProvider: z.enum(["qmd", "lexical"]),
  retrievalFallbackUsed: z.boolean(),
  retrievalHitCount: z.number().int().min(0),
  retrievalTopConfidence: z.number().min(0).max(1),
  matchedKnowledgeIds: z.array(z.string().min(1)).default([]),
  activeDomainIds: z.array(z.string().min(1)).default([]),
  matchedDomainIds: z.array(z.string().min(1)).default([]),
  qualityGateFailures: z.array(z.string().min(1)).default([]),
  retryStopReason: z.string().optional(),
  evidenceCount: z.number().int().min(0),
  caveatCount: z.number().int().min(0),
  hydratedEvidenceCount: z.number().int().min(0),
  linkedFlowEvidenceCount: z.number().int().min(0),
  linkedEaiEvidenceCount: z.number().int().min(0),
  downstreamTraceCount: z.number().int().min(0)
});

export const ProjectSearchEvaluationArtifactSchema = EvaluationArtifactBaseSchema.extend({
  kind: z.literal("search"),
  query: z.string().min(1),
  questionTypeConfidence: z.number().min(0).max(1),
  questionTypeReason: z.string().default(""),
  provider: z.enum(["qmd", "lexical"]),
  fallbackUsed: z.boolean(),
  hitCount: z.number().int().min(0),
  topConfidence: z.number().min(0).max(1),
  matchedKnowledgeIds: z.array(z.string().min(1)).default([])
});

export type RetrievalUnitStatus = z.infer<typeof RetrievalUnitStatusSchema>;
export type RetrievalUnitStatusSummary = z.infer<typeof RetrievalUnitStatusSummarySchema>;
export type ProjectAskEvaluationArtifact = z.infer<typeof ProjectAskEvaluationArtifactSchema>;
export type ProjectSearchEvaluationArtifact = z.infer<typeof ProjectSearchEvaluationArtifactSchema>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function summarizeRetrievalUnitStatuses(statuses: RetrievalUnitStatus[]): RetrievalUnitStatusSummary {
  const summary: RetrievalUnitStatusSummary = {
    total: statuses.length,
    candidate: 0,
    validated: 0,
    derived: 0,
    stale: 0
  };
  for (const status of statuses) {
    summary[status] += 1;
  }
  return summary;
}

function computeRetrievalCoverageScore(input: {
  hitCount: number;
  topConfidence: number;
  matchedRetrievalUnitCount: number;
  retrievalUnitStatuses: RetrievalUnitStatusSummary;
  providerBoost: number;
  fallbackPenalty: number;
}): number {
  const { retrievalUnitStatuses } = input;
  const raw =
    input.hitCount * 8 +
    input.topConfidence * 30 +
    input.matchedRetrievalUnitCount * 6 +
    retrievalUnitStatuses.validated * 8 +
    retrievalUnitStatuses.derived * 4 +
    retrievalUnitStatuses.candidate * 1 -
    retrievalUnitStatuses.stale * 10 +
    input.providerBoost -
    input.fallbackPenalty;
  return Math.round(clamp(raw, 0, 100));
}

function computeEvidenceStrengthScore(input: {
  evidenceCount: number;
  caveatCount: number;
  hydratedEvidenceCount: number;
  linkedFlowEvidenceCount: number;
  linkedEaiEvidenceCount: number;
  downstreamTraceCount: number;
}): number {
  const raw =
    input.evidenceCount * 12 +
    input.hydratedEvidenceCount * 6 +
    input.linkedFlowEvidenceCount * 10 +
    input.linkedEaiEvidenceCount * 6 +
    input.downstreamTraceCount * 6 -
    input.caveatCount * 4;
  return Math.round(clamp(raw, 0, 100));
}

function computeQualityRiskScore(input: {
  qualityGatePassed: boolean;
  qualityGateFailureCount: number;
  retryStopReason?: string;
  staleCount: number;
  fallbackUsed: boolean;
  confidence: number;
}): number {
  const raw =
    (input.qualityGatePassed ? 0 : 30) +
    input.qualityGateFailureCount * 8 +
    input.staleCount * 10 +
    (input.retryStopReason ? 8 : 0) +
    (input.fallbackUsed ? 6 : 0) +
    (input.confidence < 0.5 ? 10 : 0) +
    (input.confidence < 0.35 ? 10 : 0);
  return Math.round(clamp(raw, 0, 100));
}

export function buildProjectAskEvaluationArtifact(input: {
  generatedAt: string;
  projectId: string;
  projectName: string;
  question: string;
  strategyType: string;
  questionType: AskQuestionType;
  confidence: number;
  qualityGatePassed: boolean;
  attempts: number;
  llmCallCount: number;
  retrievalProvider: "qmd" | "lexical";
  retrievalFallbackUsed: boolean;
  retrievalHitCount: number;
  retrievalTopConfidence: number;
  plannedQuery?: string;
  matchedRetrievalUnitIds?: string[];
  matchedRetrievalUnitStatuses?: RetrievalUnitStatus[];
  matchedKnowledgeIds?: string[];
  activeDomainIds?: string[];
  matchedDomainIds?: string[];
  qualityGateFailures?: string[];
  retryStopReason?: string;
  evidenceCount: number;
  caveatCount: number;
  hydratedEvidenceCount: number;
  linkedFlowEvidenceCount: number;
  linkedEaiEvidenceCount: number;
  downstreamTraceCount: number;
}): ProjectAskEvaluationArtifact {
  const retrievalUnitStatuses = summarizeRetrievalUnitStatuses(input.matchedRetrievalUnitStatuses ?? []);
  return ProjectAskEvaluationArtifactSchema.parse({
    version: 1,
    generatedAt: input.generatedAt,
    projectId: input.projectId,
    projectName: input.projectName,
    kind: "ask",
    question: input.question,
    strategyType: input.strategyType,
    questionType: input.questionType,
    confidence: input.confidence,
    qualityGatePassed: input.qualityGatePassed,
    attempts: input.attempts,
    llmCallCount: input.llmCallCount,
    retrievalProvider: input.retrievalProvider,
    retrievalFallbackUsed: input.retrievalFallbackUsed,
    retrievalHitCount: input.retrievalHitCount,
    retrievalTopConfidence: input.retrievalTopConfidence,
    plannedQuery: input.plannedQuery ?? "",
    matchedRetrievalUnitIds: input.matchedRetrievalUnitIds ?? [],
    matchedRetrievalUnitStatuses: input.matchedRetrievalUnitStatuses ?? [],
    matchedKnowledgeIds: input.matchedKnowledgeIds ?? [],
    activeDomainIds: input.activeDomainIds ?? [],
    matchedDomainIds: input.matchedDomainIds ?? [],
    qualityGateFailures: input.qualityGateFailures ?? [],
    retryStopReason: input.retryStopReason,
    evidenceCount: input.evidenceCount,
    caveatCount: input.caveatCount,
    hydratedEvidenceCount: input.hydratedEvidenceCount,
    linkedFlowEvidenceCount: input.linkedFlowEvidenceCount,
    linkedEaiEvidenceCount: input.linkedEaiEvidenceCount,
    downstreamTraceCount: input.downstreamTraceCount,
    metrics: {
      retrievalUnitStatuses,
      retrievalCoverageScore: computeRetrievalCoverageScore({
        hitCount: input.retrievalHitCount,
        topConfidence: input.retrievalTopConfidence,
        matchedRetrievalUnitCount: (input.matchedRetrievalUnitIds ?? []).length,
        retrievalUnitStatuses,
        providerBoost: input.retrievalProvider === "qmd" ? 8 : 0,
        fallbackPenalty: input.retrievalFallbackUsed ? 8 : 0
      }),
      evidenceStrengthScore: computeEvidenceStrengthScore({
        evidenceCount: input.evidenceCount,
        caveatCount: input.caveatCount,
        hydratedEvidenceCount: input.hydratedEvidenceCount,
        linkedFlowEvidenceCount: input.linkedFlowEvidenceCount,
        linkedEaiEvidenceCount: input.linkedEaiEvidenceCount,
        downstreamTraceCount: input.downstreamTraceCount
      }),
      qualityRiskScore: computeQualityRiskScore({
        qualityGatePassed: input.qualityGatePassed,
        qualityGateFailureCount: (input.qualityGateFailures ?? []).length,
        retryStopReason: input.retryStopReason,
        staleCount: retrievalUnitStatuses.stale,
        fallbackUsed: input.retrievalFallbackUsed,
        confidence: input.confidence
      })
    }
  });
}

export function buildProjectSearchEvaluationArtifact(input: {
  generatedAt: string;
  projectId: string;
  projectName: string;
  query: string;
  questionType: AskQuestionType;
  questionTypeConfidence: number;
  questionTypeReason?: string;
  provider: "qmd" | "lexical";
  fallbackUsed: boolean;
  hitCount: number;
  topConfidence: number;
  plannedQuery?: string;
  matchedKnowledgeIds?: string[];
  matchedRetrievalUnitIds?: string[];
  matchedRetrievalUnitStatuses?: RetrievalUnitStatus[];
}): ProjectSearchEvaluationArtifact {
  const retrievalUnitStatuses = summarizeRetrievalUnitStatuses(input.matchedRetrievalUnitStatuses ?? []);
  return ProjectSearchEvaluationArtifactSchema.parse({
    version: 1,
    generatedAt: input.generatedAt,
    projectId: input.projectId,
    projectName: input.projectName,
    kind: "search",
    query: input.query,
    questionType: input.questionType,
    questionTypeConfidence: input.questionTypeConfidence,
    questionTypeReason: input.questionTypeReason ?? "",
    provider: input.provider,
    fallbackUsed: input.fallbackUsed,
    hitCount: input.hitCount,
    topConfidence: input.topConfidence,
    plannedQuery: input.plannedQuery ?? "",
    matchedKnowledgeIds: input.matchedKnowledgeIds ?? [],
    matchedRetrievalUnitIds: input.matchedRetrievalUnitIds ?? [],
    matchedRetrievalUnitStatuses: input.matchedRetrievalUnitStatuses ?? [],
    metrics: {
      retrievalUnitStatuses,
      retrievalCoverageScore: computeRetrievalCoverageScore({
        hitCount: input.hitCount,
        topConfidence: input.topConfidence,
        matchedRetrievalUnitCount: (input.matchedRetrievalUnitIds ?? []).length,
        retrievalUnitStatuses,
        providerBoost: input.provider === "qmd" ? 8 : 0,
        fallbackPenalty: input.fallbackUsed ? 8 : 0
      }),
      evidenceStrengthScore: Math.round(clamp(input.hitCount * 12 + input.topConfidence * 18, 0, 100)),
      qualityRiskScore: Math.round(
        clamp(
          (input.hitCount === 0 ? 30 : 0) +
            retrievalUnitStatuses.stale * 10 +
            (input.fallbackUsed ? 8 : 0) +
            (input.topConfidence < 0.45 ? 12 : 0),
          0,
          100
        )
      )
    }
  });
}

export function buildEvaluationArtifactMarkdown(
  artifact: ProjectAskEvaluationArtifact | ProjectSearchEvaluationArtifact
): string {
  const lines = [
    "# Evaluation Artifact",
    "",
    `- kind: ${artifact.kind}`,
    `- projectId: ${artifact.projectId}`,
    `- projectName: ${artifact.projectName}`,
    `- generatedAt: ${artifact.generatedAt}`,
    `- questionType: ${artifact.questionType}`,
    `- plannedQuery: ${artifact.plannedQuery || "(none)"}`,
    `- retrievalUnits: ${artifact.matchedRetrievalUnitIds.join(", ") || "(none)"}`,
    `- retrievalUnitStatuses: ${artifact.matchedRetrievalUnitStatuses.join(", ") || "(none)"}`,
    "",
    "## Metrics",
    `- retrievalCoverageScore: ${artifact.metrics.retrievalCoverageScore}`,
    `- evidenceStrengthScore: ${artifact.metrics.evidenceStrengthScore}`,
    `- qualityRiskScore: ${artifact.metrics.qualityRiskScore}`,
    `- lifecycle: validated=${artifact.metrics.retrievalUnitStatuses.validated}, derived=${artifact.metrics.retrievalUnitStatuses.derived}, candidate=${artifact.metrics.retrievalUnitStatuses.candidate}, stale=${artifact.metrics.retrievalUnitStatuses.stale}`,
    ""
  ];

  if (artifact.kind === "ask") {
    lines.push(
      "## Ask",
      `- question: ${artifact.question}`,
      `- strategyType: ${artifact.strategyType}`,
      `- confidence: ${artifact.confidence.toFixed(2)}`,
      `- qualityGatePassed: ${artifact.qualityGatePassed}`,
      `- qualityGateFailures: ${artifact.qualityGateFailures.join(", ") || "(none)"}`,
      `- attempts: ${artifact.attempts}`,
      `- llmCallCount: ${artifact.llmCallCount}`,
      `- retrieval: ${artifact.retrievalProvider} fallback=${artifact.retrievalFallbackUsed} hits=${artifact.retrievalHitCount} topConfidence=${artifact.retrievalTopConfidence.toFixed(2)}`,
      ""
    );
  } else {
    lines.push(
      "## Search",
      `- query: ${artifact.query}`,
      `- questionTypeConfidence: ${artifact.questionTypeConfidence.toFixed(2)}`,
      `- questionTypeReason: ${artifact.questionTypeReason || "(none)"}`,
      `- retrieval: ${artifact.provider} fallback=${artifact.fallbackUsed} hits=${artifact.hitCount} topConfidence=${artifact.topConfidence.toFixed(2)}`,
      ""
    );
  }

  return `${lines.join("\n")}\n`;
}
