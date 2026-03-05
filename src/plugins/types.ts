import { AnalyzeInput, ImplementOutput, PlanOutput, PluginContribution, VerifyOutput } from "../core/types.js";

export type PluginPhase = "beforeAnalyze" | "beforePlan" | "beforeImplement" | "beforeVerify";

export interface PluginExecutionContext {
  cwd: string;
  runId: string;
  input: AnalyzeInput;
  plan?: PlanOutput;
  implement?: ImplementOutput;
  verify?: VerifyOutput;
  stageAttempt: number;
}

export interface PluginHookResult {
  summary: string;
  context?: string[];
  warnings?: string[];
  metadata?: Record<string, unknown>;
}

export interface RuntimePlugin {
  name: string;
  beforeAnalyze?(context: PluginExecutionContext): Promise<PluginHookResult | void>;
  beforePlan?(context: PluginExecutionContext): Promise<PluginHookResult | void>;
  beforeImplement?(context: PluginExecutionContext): Promise<PluginHookResult | void>;
  beforeVerify?(context: PluginExecutionContext): Promise<PluginHookResult | void>;
}

export interface LoadedPlugin {
  name: string;
  plugin: RuntimePlugin;
  enabled: boolean;
  options: Record<string, unknown>;
}

export interface PluginManagerResult {
  contributions: PluginContribution[];
  warnings: string[];
}
