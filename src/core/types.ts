import { z } from "zod";

export const RuntimeStateSchema = z.enum([
  "ANALYZE",
  "WAIT_CLARIFICATION",
  "PLAN",
  "IMPLEMENT",
  "VERIFY",
  "FINISH",
  "PATCH",
  "FAIL"
]);

export type RuntimeState = z.infer<typeof RuntimeStateSchema>;

export const ContextTierSchema = z.enum(["small", "mid", "big"]);

export type ContextTier = z.infer<typeof ContextTierSchema>;

export const RunModeSchema = z.enum(["auto", "feature", "refactor", "medium", "microservice"]);

export type RunMode = z.infer<typeof RunModeSchema>;

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).default(2),
  backoffMs: z.number().int().min(0).default(0),
  sameFailureLimit: z.number().int().min(1).default(2),
  rollbackOnVerifyFail: z.boolean().default(false)
});

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const AnalyzeInputSchema = z.object({
  taskId: z.string().min(1),
  objective: z.string().min(1),
  constraints: z.array(z.string()).default([]),
  availableLibraries: z.array(z.string().min(1)).max(200).optional(),
  availableLibrariesFile: z.string().min(1).optional(),
  availableLibrariesUrl: z.string().url().optional(),
  files: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  errorLogs: z.array(z.string()).default([]),
  diffSummary: z.array(z.string()).default([]),
  contextTier: ContextTierSchema.default("small"),
  contextTokenBudget: z.number().int().min(200).max(12000).default(1200),
  retryPolicy: RetryPolicySchema.default({
    maxAttempts: 2,
    backoffMs: 0,
    sameFailureLimit: 2,
    rollbackOnVerifyFail: false
  }),
  mode: RunModeSchema.default("auto"),
  clarificationAnswers: z.array(z.string()).default([]),
  gateProfile: z.string().min(1).optional(),
  dryRun: z.boolean().default(false)
});

export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>;

export const PlanOutputSchema = z.object({
  summary: z.string().min(1),
  steps: z.array(z.string()).min(1),
  risks: z.array(z.string()).default([]),
  targetSymbols: z.array(z.string()).default([]),
  successCriteria: z.array(z.string()).default([]),
  retryPolicy: RetryPolicySchema.optional()
});

export type PlanOutput = z.infer<typeof PlanOutputSchema>;

const WriteFileActionSchema = z.object({
  type: z.literal("write_file"),
  path: z.string().min(1),
  content: z.string()
});

const PatchFileActionSchema = z.object({
  type: z.literal("patch_file"),
  path: z.string().min(1),
  find: z.string().min(1),
  replace: z.string(),
  all: z.boolean().default(false)
});

const RunCommandActionSchema = z.object({
  type: z.literal("run_command"),
  command: z.string().min(1),
  args: z.array(z.string()).default([])
});

export const ImplementActionSchema = z.discriminatedUnion("type", [
  WriteFileActionSchema,
  PatchFileActionSchema,
  RunCommandActionSchema
]);

export type ImplementAction = z.infer<typeof ImplementActionSchema>;

export const ImplementOutputSchema = z.object({
  summary: z.string().min(1),
  changes: z
    .array(
      z.object({
        path: z.string().min(1),
        summary: z.string().min(1)
      })
    )
    .default([]),
  actions: z.array(ImplementActionSchema).default([]),
  notes: z.array(z.string()).default([]),
  strategy: z.string().optional(),
  retryPolicy: RetryPolicySchema.optional()
});

export type ImplementOutput = z.infer<typeof ImplementOutputSchema>;

export const FailureCategorySchema = z.enum([
  "compile",
  "test",
  "lint",
  "runtime",
  "tooling",
  "infra"
]);

export type FailureCategory = z.infer<typeof FailureCategorySchema>;

export const FailureSummarySchema = z.object({
  category: FailureCategorySchema,
  signature: z.string().min(1),
  coreLines: z.array(z.string()).default([]),
  relatedFiles: z.array(z.string()).default([]),
  recommendation: z.string().default("Apply minimal and targeted patch only")
});

export type FailureSummary = z.infer<typeof FailureSummarySchema>;

export const VerifyGateResultSchema = z.object({
  name: z.string().min(1),
  passed: z.boolean(),
  command: z.string().min(1),
  args: z.array(z.string()),
  details: z.string().default(""),
  durationMs: z.number().int().min(0).default(0),
  category: FailureCategorySchema.optional()
});

export type VerifyGateResult = z.infer<typeof VerifyGateResultSchema>;

export const VerifyOutputSchema = z.object({
  passed: z.boolean(),
  gateResults: z.array(VerifyGateResultSchema),
  failureSignature: z.string().optional(),
  failureSummary: FailureSummarySchema.optional(),
  retryPolicy: RetryPolicySchema.optional()
});

export type VerifyOutput = z.infer<typeof VerifyOutputSchema>;

export const RunLockSchema = z.object({
  pid: z.number().int().min(1),
  createdAt: z.string()
});

export type RunLock = z.infer<typeof RunLockSchema>;

export const AttemptCheckpointSchema = z.object({
  attempt: z.number().int().min(0),
  strategy: z.string().min(1),
  implementOutputFile: z.string().min(1),
  actionsFile: z.string().min(1),
  verifyFile: z.string().min(1),
  actionsApplied: z.boolean().default(false),
  verifyCompleted: z.boolean().default(false),
  verifyPassed: z.boolean().optional(),
  rolledBack: z.boolean().default(false),
  failureSignature: z.string().optional()
});

export type AttemptCheckpoint = z.infer<typeof AttemptCheckpointSchema>;

export const RunManifestSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  status: z.enum(["running", "waiting", "finished", "failed"]),
  currentState: RuntimeStateSchema,
  mode: RunModeSchema,
  modeReason: z.string().default(""),
  loopCount: z.number().int().min(0).default(0),
  patchAttempts: z.number().int().min(0).default(0),
  sameFailureCount: z.number().int().min(0).default(0),
  strategyIndex: z.number().int().min(0).default(0),
  lastFailureSignature: z.string().default(""),
  waitingQuestions: z.array(z.string()).default([]),
  checkpoints: z.object({
    planCompleted: z.boolean().default(false),
    attempts: z.array(AttemptCheckpointSchema).default([])
  }),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type RunManifest = z.infer<typeof RunManifestSchema>;

export interface RuntimeSnapshot {
  runId: string;
  artifactDir: string;
  state: RuntimeState;
  analyzeInput?: AnalyzeInput;
  mode?: RunMode;
  modeReason?: string;
  waitingQuestions?: string[];
  planOutput?: PlanOutput;
  implementOutput?: ImplementOutput;
  verifyOutput?: VerifyOutput;
  patchAttempts: number;
  sameFailureCount: number;
  lastFailureSignature?: string;
  failReason?: string;
}

export interface PluginContribution {
  plugin: string;
  phase: "beforeAnalyze" | "beforePlan" | "beforeImplement" | "beforeVerify";
  summary: string;
  context?: string[];
  warnings?: string[];
  metadata?: Record<string, unknown>;
}
