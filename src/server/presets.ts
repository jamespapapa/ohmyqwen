import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ServerProject } from "./projects.js";

const ProjectPresetRuleSchema = z
  .object({
    workspaceIncludes: z.array(z.string().min(1)).default([]),
    projectNameIncludes: z.array(z.string().min(1)).default([]),
    requiredPaths: z.array(z.string().min(1)).default([])
  })
  .default({
    workspaceIncludes: [],
    projectNameIncludes: [],
    requiredPaths: []
  });

const ProjectPresetEaiSchema = z
  .object({
    enabled: z.boolean().default(false),
    asOfDate: z.string().min(1).optional(),
    servicePathIncludes: z.array(z.string().min(1)).default(["resources/eai/"]),
    manualOverridesFile: z.string().min(1).optional()
  })
  .default({
    enabled: false,
    asOfDate: undefined,
    servicePathIncludes: ["resources/eai/"],
    manualOverridesFile: undefined
  });

const ProjectPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  keyFacts: z.array(z.string().min(1)).min(1),
  domainPackIds: z.array(z.string().min(1)).default([]),
  rules: ProjectPresetRuleSchema.optional(),
  eai: ProjectPresetEaiSchema.optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  builtIn: z.boolean().default(false)
});

const ProjectPresetStoreSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().min(1),
  presets: z.array(ProjectPresetSchema)
});

const UpsertProjectPresetInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  summary: z.string().min(1),
  keyFacts: z.array(z.string().min(1)).min(1),
  domainPackIds: z.array(z.string().min(1)).optional(),
  rules: ProjectPresetRuleSchema.optional(),
  eai: ProjectPresetEaiSchema.optional()
});

export type ProjectPreset = z.infer<typeof ProjectPresetSchema>;
export type UpsertProjectPresetInput = z.infer<typeof UpsertProjectPresetInputSchema>;

interface ProjectPresetStore {
  version: 1;
  updatedAt: string;
  presets: ProjectPreset[];
}

let cachedCustomPresets: ProjectPresetStore | null = null;
let cachedBuiltInPresets: ProjectPreset[] | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function customPresetStorePath(): string {
  return path.resolve(process.cwd(), ".ohmyqwen", "server", "presets.json");
}

function builtInPresetPath(): string {
  return path.resolve(process.cwd(), "config", "project-presets.json");
}

function normalizeTextList(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function normalizePreset(preset: ProjectPreset): ProjectPreset {
  return {
    ...preset,
    keyFacts: normalizeTextList(preset.keyFacts),
    domainPackIds: normalizeTextList(preset.domainPackIds ?? []),
    rules: preset.rules
      ? {
          workspaceIncludes: normalizeTextList(preset.rules.workspaceIncludes ?? []),
          projectNameIncludes: normalizeTextList(preset.rules.projectNameIncludes ?? []),
          requiredPaths: normalizeTextList(preset.rules.requiredPaths ?? [])
        }
      : undefined,
    eai: preset.eai
      ? {
          enabled: Boolean(preset.eai.enabled),
          asOfDate: preset.eai.asOfDate?.trim() || undefined,
          servicePathIncludes: normalizeTextList(preset.eai.servicePathIncludes ?? ["resources/eai/"]),
          manualOverridesFile: preset.eai.manualOverridesFile?.trim() || undefined
        }
      : undefined
  };
}

async function loadBuiltInPresets(): Promise<ProjectPreset[]> {
  if (cachedBuiltInPresets) {
    return [...cachedBuiltInPresets];
  }

  const filePath = builtInPresetPath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { presets?: unknown };
    const presets = z.array(ProjectPresetSchema).parse(parsed.presets ?? []).map((preset) =>
      normalizePreset({
        ...preset,
        builtIn: true
      })
    );
    cachedBuiltInPresets = presets;
    return [...presets];
  } catch {
    cachedBuiltInPresets = [];
    return [];
  }
}

async function loadCustomPresets(): Promise<ProjectPresetStore> {
  if (cachedCustomPresets) {
    return {
      version: cachedCustomPresets.version,
      updatedAt: cachedCustomPresets.updatedAt,
      presets: [...cachedCustomPresets.presets]
    };
  }

  const filePath = customPresetStorePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = ProjectPresetStoreSchema.parse(JSON.parse(raw));
    const store: ProjectPresetStore = {
      version: 1,
      updatedAt: parsed.updatedAt,
      presets: parsed.presets.map((preset) => normalizePreset({ ...preset, builtIn: false }))
    };
    cachedCustomPresets = store;
    return {
      version: store.version,
      updatedAt: store.updatedAt,
      presets: [...store.presets]
    };
  } catch {
    const empty: ProjectPresetStore = {
      version: 1,
      updatedAt: nowIso(),
      presets: []
    };
    cachedCustomPresets = empty;
    return {
      version: empty.version,
      updatedAt: empty.updatedAt,
      presets: []
    };
  }
}

async function saveCustomPresets(store: ProjectPresetStore): Promise<void> {
  const next: ProjectPresetStore = {
    version: 1,
    updatedAt: nowIso(),
    presets: [...store.presets]
      .map((preset) => normalizePreset({ ...preset, builtIn: false }))
      .sort((a, b) => (a.name === b.name ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name)))
  };

  const filePath = customPresetStorePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  cachedCustomPresets = next;
}

export async function listProjectPresets(): Promise<ProjectPreset[]> {
  const [builtIn, custom] = await Promise.all([loadBuiltInPresets(), loadCustomPresets()]);
  const merged = new Map<string, ProjectPreset>();

  for (const preset of builtIn) {
    merged.set(preset.id, normalizePreset({ ...preset, builtIn: true }));
  }

  for (const preset of custom.presets) {
    merged.set(preset.id, normalizePreset({ ...preset, builtIn: false }));
  }

  return Array.from(merged.values()).sort((a, b) =>
    a.name === b.name ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name)
  );
}

export async function getProjectPresetById(id: string): Promise<ProjectPreset | undefined> {
  const presets = await listProjectPresets();
  return presets.find((preset) => preset.id === id);
}

export async function upsertProjectPreset(input: UpsertProjectPresetInput): Promise<ProjectPreset> {
  const parsed = UpsertProjectPresetInputSchema.parse(input);
  const store = await loadCustomPresets();
  const now = nowIso();
  const index = parsed.id ? store.presets.findIndex((preset) => preset.id === parsed.id) : -1;

  if (index >= 0) {
    const existing = store.presets[index];
    const updated = ProjectPresetSchema.parse(
      normalizePreset({
        ...existing,
        name: parsed.name,
        summary: parsed.summary,
        keyFacts: parsed.keyFacts,
        domainPackIds: parsed.domainPackIds ?? existing.domainPackIds,
        rules: parsed.rules,
        eai: parsed.eai,
        updatedAt: now,
        builtIn: false
      })
    );
    store.presets[index] = updated;
    await saveCustomPresets(store);
    return updated;
  }

  const created = ProjectPresetSchema.parse(
    normalizePreset({
      id: parsed.id ?? randomUUID().slice(0, 12),
      name: parsed.name,
      summary: parsed.summary,
      keyFacts: parsed.keyFacts,
      domainPackIds: parsed.domainPackIds ?? [],
      rules: parsed.rules,
      eai: parsed.eai,
      createdAt: now,
      updatedAt: now,
      builtIn: false
    })
  );
  store.presets.push(created);
  await saveCustomPresets(store);
  return created;
}

export async function removeProjectPreset(id: string): Promise<void> {
  const store = await loadCustomPresets();
  const next = store.presets.filter((preset) => preset.id !== id);
  if (next.length === store.presets.length) {
    throw new Error(`preset not found or built-in only: ${id}`);
  }

  store.presets = next;
  await saveCustomPresets(store);
}

function containsAny(source: string, tokens: string[]): boolean {
  const lowerSource = source.toLowerCase();
  return tokens.some((token) => lowerSource.includes(token.toLowerCase()));
}

export function matchProjectPreset(options: {
  project: ServerProject;
  files: string[];
  presets: ProjectPreset[];
}): ProjectPreset | undefined {
  const workspace = options.project.workspaceDir.toLowerCase();
  const projectName = options.project.name.toLowerCase();
  const normalizedFiles = options.files.map((file) => file.toLowerCase());

  let best: { preset: ProjectPreset; score: number } | undefined;

  for (const preset of options.presets) {
    const rules = preset.rules;
    if (!rules) {
      continue;
    }

    let score = 0;
    if (rules.workspaceIncludes.length > 0 && containsAny(workspace, rules.workspaceIncludes)) {
      score += 2;
    }
    if (rules.projectNameIncludes.length > 0 && containsAny(projectName, rules.projectNameIncludes)) {
      score += 2;
    }

    if (rules.requiredPaths.length > 0) {
      let matchedRequired = 0;
      for (const expected of rules.requiredPaths) {
        if (normalizedFiles.some((file) => file.includes(expected.toLowerCase()))) {
          matchedRequired += 1;
        }
      }
      score += matchedRequired;
    }

    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        preset,
        score
      };
    }
  }

  return best?.preset;
}
