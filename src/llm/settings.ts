import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";

const LlmModelProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  contextWindowTokens: z.number().int().min(1024).default(32768),
  maxOutputTokens: z.number().int().min(256).default(4096)
});

const LlmRetryPolicySchema = z.object({
  sameTaskRetries: z.number().int().min(1).default(3),
  changedTaskRetries: z.number().int().min(1).default(10)
});

const LlmRuntimeSettingsSchema = z.object({
  defaultModelId: z.string().min(1).default("Qwen3-235B-A22B-Instruct-2507-FP8"),
  continuationUsageRatio: z.number().min(0.2).max(0.9).default(0.5),
  models: z.array(LlmModelProfileSchema).min(1),
  retryPolicy: LlmRetryPolicySchema.default({
    sameTaskRetries: 3,
    changedTaskRetries: 10
  })
});

export type LlmModelProfile = z.infer<typeof LlmModelProfileSchema>;
export type LlmRetryPolicy = z.infer<typeof LlmRetryPolicySchema>;
export type LlmRuntimeSettings = z.infer<typeof LlmRuntimeSettingsSchema>;

const DEFAULT_SETTINGS: LlmRuntimeSettings = {
  defaultModelId: "Qwen3-235B-A22B-Instruct-2507-FP8",
  continuationUsageRatio: 0.5,
  models: [
    {
      id: "Qwen3-235B-A22B-Instruct-2507-FP8",
      label: "Qwen3 235B A22B",
      contextWindowTokens: 32768,
      maxOutputTokens: 4096
    }
  ],
  retryPolicy: {
    sameTaskRetries: 3,
    changedTaskRetries: 10
  }
};

let cachedSettings: LlmRuntimeSettings | null = null;

function configPath(cwd = process.cwd()): string {
  return path.resolve(cwd, "config", "llm-settings.json");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mergeSettings(base: LlmRuntimeSettings, patch: Partial<LlmRuntimeSettings>): LlmRuntimeSettings {
  const patchedModels = Array.isArray(patch.models) && patch.models.length > 0
    ? patch.models.map((model) => ({
        id: model.id,
        label: model.label ?? model.id,
        contextWindowTokens: clamp(model.contextWindowTokens, 1024, 2_000_000),
        maxOutputTokens: clamp(model.maxOutputTokens, 256, 128_000)
      }))
    : base.models;

  const defaultModelId =
    patch.defaultModelId && patchedModels.some((model) => model.id === patch.defaultModelId)
      ? patch.defaultModelId
      : base.defaultModelId;

  return {
    defaultModelId,
    continuationUsageRatio: clamp(
      Number(patch.continuationUsageRatio ?? base.continuationUsageRatio),
      0.2,
      0.9
    ),
    models: patchedModels,
    retryPolicy: {
      sameTaskRetries: clamp(
        Number(patch.retryPolicy?.sameTaskRetries ?? base.retryPolicy.sameTaskRetries),
        1,
        100
      ),
      changedTaskRetries: clamp(
        Number(patch.retryPolicy?.changedTaskRetries ?? base.retryPolicy.changedTaskRetries),
        1,
        100
      )
    }
  };
}

export async function loadLlmRuntimeSettings(cwd = process.cwd(), forceRefresh = false): Promise<LlmRuntimeSettings> {
  if (cachedSettings && !forceRefresh) {
    return cachedSettings;
  }

  let settings = DEFAULT_SETTINGS;
  try {
    const raw = await fs.readFile(configPath(cwd), "utf8");
    const parsed = LlmRuntimeSettingsSchema.partial().parse(JSON.parse(raw)) as Partial<LlmRuntimeSettings>;
    settings = mergeSettings(DEFAULT_SETTINGS, parsed);
  } catch {
    settings = DEFAULT_SETTINGS;
  }

  cachedSettings = settings;
  return settings;
}

export function resolveLlmModelProfile(
  settings: LlmRuntimeSettings,
  modelId?: string | null
): LlmModelProfile {
  const selected =
    settings.models.find((model) => model.id === modelId) ??
    settings.models.find((model) => model.id === settings.defaultModelId) ??
    settings.models[0];

  return selected ?? DEFAULT_SETTINGS.models[0];
}

export function deriveStageTokenCapsFromModel(options: {
  model: LlmModelProfile;
  usageRatio: number;
}): { PLAN: number; IMPLEMENT: number; VERIFY: number } {
  const usageRatio = clamp(options.usageRatio, 0.2, 0.9);
  const safeInputBudget = Math.max(
    600,
    Math.floor(options.model.contextWindowTokens * usageRatio) - options.model.maxOutputTokens
  );
  const cap = (ratio: number) => clamp(Math.floor(safeInputBudget * ratio), 200, 12000);

  return {
    PLAN: cap(0.35),
    IMPLEMENT: cap(0.5),
    VERIFY: cap(0.25)
  };
}

