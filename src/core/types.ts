import { z } from "zod";

export const RuntimeStateSchema = z.enum([
  "ANALYZE",
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

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).default(2),
  backoffMs: z.number().int().min(0).default(0),
  sameFailureLimit: z.number().int().min(1).default(2)
});

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const AnalyzeInputSchema = z.object({
  taskId: z.string().min(1),
  objective: z.string().min(1),
  constraints: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  errorLogs: z.array(z.string()).default([]),
  diffSummary: z.array(z.string()).default([]),
  contextTier: ContextTierSchema.default("small"),
  contextTokenBudget: z.number().int().min(200).max(8000).default(1200),
  retryPolicy: RetryPolicySchema.default({
    maxAttempts: 2,
    backoffMs: 0,
    sameFailureLimit: 2
  })
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

export const VerifyGateResultSchema = z.object({
  name: z.string().min(1),
  passed: z.boolean(),
  command: z.string().min(1),
  args: z.array(z.string()),
  details: z.string().default("")
});

export type VerifyGateResult = z.infer<typeof VerifyGateResultSchema>;

export const VerifyOutputSchema = z.object({
  passed: z.boolean(),
  gateResults: z.array(VerifyGateResultSchema),
  failureSignature: z.string().optional(),
  retryPolicy: RetryPolicySchema.optional()
});

export type VerifyOutput = z.infer<typeof VerifyOutputSchema>;

export interface RuntimeSnapshot {
  runId: string;
  artifactDir: string;
  state: RuntimeState;
  analyzeInput?: AnalyzeInput;
  planOutput?: PlanOutput;
  implementOutput?: ImplementOutput;
  verifyOutput?: VerifyOutput;
  patchAttempts: number;
  sameFailureCount: number;
  failReason?: string;
}
