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

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface SessionContext {
  taskId: string;
  objective: string;
  shortSession: boolean;
  files: string[];
}

export const AnalyzeInputSchema = z.object({
  taskId: z.string().min(1),
  objective: z.string().min(1),
  constraints: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  retryPolicy: z
    .object({
      maxAttempts: z.number().int().min(1),
      backoffMs: z.number().int().min(0)
    })
    .default({ maxAttempts: 1, backoffMs: 0 })
});

export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>;

export const PlanOutputSchema = z.object({
  summary: z.string().min(1),
  steps: z.array(z.string()).min(1),
  risks: z.array(z.string()).default([]),
  retryPolicy: z
    .object({
      maxAttempts: z.number().int().min(1),
      backoffMs: z.number().int().min(0)
    })
    .optional()
});

export type PlanOutput = z.infer<typeof PlanOutputSchema>;

export const ImplementOutputSchema = z.object({
  changes: z.array(
    z.object({
      path: z.string().min(1),
      summary: z.string().min(1)
    })
  ),
  notes: z.array(z.string()).default([]),
  retryPolicy: z
    .object({
      maxAttempts: z.number().int().min(1),
      backoffMs: z.number().int().min(0)
    })
    .optional()
});

export type ImplementOutput = z.infer<typeof ImplementOutputSchema>;

export const VerifyOutputSchema = z.object({
  passed: z.boolean(),
  gateResults: z.array(
    z.object({
      name: z.string().min(1),
      passed: z.boolean(),
      details: z.string().default("")
    })
  ),
  retryPolicy: z
    .object({
      maxAttempts: z.number().int().min(1),
      backoffMs: z.number().int().min(0)
    })
    .optional()
});

export type VerifyOutput = z.infer<typeof VerifyOutputSchema>;

export interface RuntimeSnapshot {
  state: RuntimeState;
  analyzeInput?: AnalyzeInput;
  planOutput?: PlanOutput;
  implementOutput?: ImplementOutput;
  verifyOutput?: VerifyOutput;
}
