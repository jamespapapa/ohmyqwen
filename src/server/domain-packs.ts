import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const DomainPackCapabilitySchema = z.object({
  tag: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  questionPatterns: z.array(z.string().min(1)).default([]),
  textPatterns: z.array(z.string().min(1)).default([]),
  searchTerms: z.array(z.string().min(1)).default([]),
  pathHints: z.array(z.string().min(1)).default([]),
  symbolHints: z.array(z.string().min(1)).default([]),
  apiHints: z.array(z.string().min(1)).default([]),
  parents: z.array(z.string().min(1)).default([]),
  adjacentConfusers: z.array(z.string().min(1)).default([])
});

const DomainPackRankingPriorSchema = z.object({
  id: z.string().min(1).optional(),
  whenQuestionHas: z.array(z.string().min(1)).default([]),
  whenLinkHas: z.array(z.string().min(1)).default([]),
  whenPathMatches: z.array(z.string().min(1)).default([]),
  whenApiMatches: z.array(z.string().min(1)).default([]),
  whenMethodMatches: z.array(z.string().min(1)).default([]),
  weight: z.number().int().min(-200).max(200),
  reason: z.string().min(1),
  negative: z.boolean().default(false)
});

const DomainPackExemplarSchema = z.object({
  id: z.string().min(1).optional(),
  question: z.string().min(1),
  expectedTags: z.array(z.string().min(1)).default([]),
  expectedPaths: z.array(z.string().min(1)).default([]),
  expectedApiPatterns: z.array(z.string().min(1)).default([]),
  expectedControllerPatterns: z.array(z.string().min(1)).default([])
});

const DomainPackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  families: z.array(z.string().min(1)).default([]),
  enabledByDefault: z.boolean().default(true),
  capabilityTags: z.array(DomainPackCapabilitySchema).min(1),
  rankingPriors: z.array(DomainPackRankingPriorSchema).default([]),
  exemplars: z.array(DomainPackExemplarSchema).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  builtIn: z.boolean().default(false)
});

const DomainPackStoreSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().min(1),
  domainPacks: z.array(DomainPackSchema)
});

const UpsertDomainPackInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  families: z.array(z.string().min(1)).optional(),
  enabledByDefault: z.boolean().optional(),
  capabilityTags: z.array(DomainPackCapabilitySchema).min(1),
  rankingPriors: z.array(DomainPackRankingPriorSchema).optional(),
  exemplars: z.array(DomainPackExemplarSchema).optional()
});

export type DomainPack = z.infer<typeof DomainPackSchema>;
export type DomainPackCapability = z.infer<typeof DomainPackCapabilitySchema>;
export type DomainPackRankingPrior = z.infer<typeof DomainPackRankingPriorSchema>;
export type DomainPackExemplar = z.infer<typeof DomainPackExemplarSchema>;
export type UpsertDomainPackInput = z.infer<typeof UpsertDomainPackInputSchema>;

interface DomainPackStore {
  version: 1;
  updatedAt: string;
  domainPacks: DomainPack[];
}

let cachedCustomDomainPacks: DomainPackStore | null = null;
let cachedBuiltInDomainPacks: DomainPack[] | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function customDomainPackStorePath(): string {
  return path.resolve(process.cwd(), ".ohmyqwen", "server", "domain-packs.json");
}

function builtInDomainPackPath(): string {
  return path.resolve(process.cwd(), "config", "domain-packs.json");
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

function normalizeCapability(capability: DomainPackCapability): DomainPackCapability {
  return {
    ...capability,
    aliases: normalizeTextList(capability.aliases ?? []),
    questionPatterns: normalizeTextList(capability.questionPatterns ?? []),
    textPatterns: normalizeTextList(capability.textPatterns ?? []),
    searchTerms: normalizeTextList(capability.searchTerms ?? []),
    pathHints: normalizeTextList(capability.pathHints ?? []),
    symbolHints: normalizeTextList(capability.symbolHints ?? []),
    apiHints: normalizeTextList(capability.apiHints ?? []),
    parents: normalizeTextList(capability.parents ?? []),
    adjacentConfusers: normalizeTextList(capability.adjacentConfusers ?? [])
  };
}

function normalizeRankingPrior(prior: DomainPackRankingPrior): DomainPackRankingPrior {
  return {
    ...prior,
    whenQuestionHas: normalizeTextList(prior.whenQuestionHas ?? []),
    whenLinkHas: normalizeTextList(prior.whenLinkHas ?? []),
    whenPathMatches: normalizeTextList(prior.whenPathMatches ?? []),
    whenApiMatches: normalizeTextList(prior.whenApiMatches ?? []),
    whenMethodMatches: normalizeTextList(prior.whenMethodMatches ?? []),
    reason: prior.reason.trim(),
    negative: Boolean(prior.negative)
  };
}

function normalizeExemplar(exemplar: DomainPackExemplar): DomainPackExemplar {
  return {
    ...exemplar,
    question: exemplar.question.trim(),
    expectedTags: normalizeTextList(exemplar.expectedTags ?? []),
    expectedPaths: normalizeTextList(exemplar.expectedPaths ?? []),
    expectedApiPatterns: normalizeTextList(exemplar.expectedApiPatterns ?? []),
    expectedControllerPatterns: normalizeTextList(exemplar.expectedControllerPatterns ?? [])
  };
}

function normalizeDomainPack(domainPack: DomainPack): DomainPack {
  return {
    ...domainPack,
    name: domainPack.name.trim(),
    description: domainPack.description?.trim() || "",
    families: normalizeTextList(domainPack.families ?? []),
    enabledByDefault: Boolean(domainPack.enabledByDefault),
    capabilityTags: (domainPack.capabilityTags ?? []).map(normalizeCapability),
    rankingPriors: (domainPack.rankingPriors ?? []).map(normalizeRankingPrior),
    exemplars: (domainPack.exemplars ?? []).map(normalizeExemplar)
  };
}

async function loadBuiltInDomainPacks(): Promise<DomainPack[]> {
  if (cachedBuiltInDomainPacks) {
    return [...cachedBuiltInDomainPacks];
  }

  const filePath = builtInDomainPackPath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { domainPacks?: unknown };
    const domainPacks = z.array(DomainPackSchema).parse(parsed.domainPacks ?? []).map((domainPack) =>
      normalizeDomainPack({
        ...domainPack,
        builtIn: true
      })
    );
    cachedBuiltInDomainPacks = domainPacks;
    return [...domainPacks];
  } catch {
    cachedBuiltInDomainPacks = [];
    return [];
  }
}

async function loadCustomDomainPacks(): Promise<DomainPackStore> {
  if (cachedCustomDomainPacks) {
    return {
      version: cachedCustomDomainPacks.version,
      updatedAt: cachedCustomDomainPacks.updatedAt,
      domainPacks: [...cachedCustomDomainPacks.domainPacks]
    };
  }

  const filePath = customDomainPackStorePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = DomainPackStoreSchema.parse(JSON.parse(raw));
    const store: DomainPackStore = {
      version: 1,
      updatedAt: parsed.updatedAt,
      domainPacks: parsed.domainPacks.map((domainPack) => normalizeDomainPack({ ...domainPack, builtIn: false }))
    };
    cachedCustomDomainPacks = store;
    return {
      version: store.version,
      updatedAt: store.updatedAt,
      domainPacks: [...store.domainPacks]
    };
  } catch {
    const empty: DomainPackStore = {
      version: 1,
      updatedAt: nowIso(),
      domainPacks: []
    };
    cachedCustomDomainPacks = empty;
    return {
      version: empty.version,
      updatedAt: empty.updatedAt,
      domainPacks: []
    };
  }
}

async function saveCustomDomainPacks(store: DomainPackStore): Promise<void> {
  const next: DomainPackStore = {
    version: 1,
    updatedAt: nowIso(),
    domainPacks: [...store.domainPacks]
      .map((domainPack) => normalizeDomainPack({ ...domainPack, builtIn: false }))
      .sort((a, b) => (a.name === b.name ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name)))
  };

  const filePath = customDomainPackStorePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  cachedCustomDomainPacks = next;
}

export async function listDomainPacks(): Promise<DomainPack[]> {
  const [builtIn, custom] = await Promise.all([loadBuiltInDomainPacks(), loadCustomDomainPacks()]);
  const merged = new Map<string, DomainPack>();

  for (const domainPack of builtIn) {
    merged.set(domainPack.id, normalizeDomainPack({ ...domainPack, builtIn: true }));
  }

  for (const domainPack of custom.domainPacks) {
    merged.set(domainPack.id, normalizeDomainPack({ ...domainPack, builtIn: false }));
  }

  return Array.from(merged.values()).sort((a, b) =>
    a.name === b.name ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name)
  );
}

export async function getDomainPackById(id: string): Promise<DomainPack | undefined> {
  const domainPacks = await listDomainPacks();
  return domainPacks.find((domainPack) => domainPack.id === id);
}

export async function upsertDomainPack(input: UpsertDomainPackInput): Promise<DomainPack> {
  const parsed = UpsertDomainPackInputSchema.parse(input);
  const store = await loadCustomDomainPacks();
  const now = nowIso();
  const index = parsed.id ? store.domainPacks.findIndex((domainPack) => domainPack.id === parsed.id) : -1;

  if (index >= 0) {
    const existing = store.domainPacks[index];
    const updated = DomainPackSchema.parse(
      normalizeDomainPack({
        ...existing,
        name: parsed.name,
        description: parsed.description ?? existing.description,
        families: parsed.families ?? existing.families,
        enabledByDefault: parsed.enabledByDefault ?? existing.enabledByDefault,
        capabilityTags: parsed.capabilityTags,
        rankingPriors: parsed.rankingPriors ?? existing.rankingPriors,
        exemplars: parsed.exemplars ?? existing.exemplars,
        updatedAt: now,
        builtIn: false
      })
    );
    store.domainPacks[index] = updated;
    await saveCustomDomainPacks(store);
    return updated;
  }

  const created = DomainPackSchema.parse(
    normalizeDomainPack({
      id: parsed.id ?? randomUUID().slice(0, 12),
      name: parsed.name,
      description: parsed.description ?? "",
      families: parsed.families ?? [],
      enabledByDefault: parsed.enabledByDefault ?? true,
      capabilityTags: parsed.capabilityTags,
      rankingPriors: parsed.rankingPriors ?? [],
      exemplars: parsed.exemplars ?? [],
      createdAt: now,
      updatedAt: now,
      builtIn: false
    })
  );
  store.domainPacks.push(created);
  await saveCustomDomainPacks(store);
  return created;
}

export async function removeDomainPack(id: string): Promise<void> {
  const store = await loadCustomDomainPacks();
  const next = store.domainPacks.filter((domainPack) => domainPack.id !== id);
  if (next.length === store.domainPacks.length) {
    throw new Error(`domain pack not found or built-in only: ${id}`);
  }

  store.domainPacks = next;
  await saveCustomDomainPacks(store);
}

export function resolveDomainPacksByIds(domainPacks: DomainPack[], ids?: string[]): DomainPack[] {
  if (!ids || ids.length === 0) {
    return domainPacks.filter((domainPack) => domainPack.enabledByDefault);
  }
  const idSet = new Set(ids.map((id) => id.trim()).filter(Boolean));
  return domainPacks.filter((domainPack) => idSet.has(domainPack.id));
}

export {
  DomainPackCapabilitySchema,
  DomainPackExemplarSchema,
  DomainPackRankingPriorSchema,
  DomainPackSchema,
  UpsertDomainPackInputSchema
};
