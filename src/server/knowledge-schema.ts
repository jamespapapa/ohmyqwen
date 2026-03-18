import path from "node:path";
import { z } from "zod";
import type { EaiDictionaryEntry } from "./eai-dictionary.js";
import type { FrontBackGraphSnapshot } from "./front-back-graph.js";
import type { LearnedKnowledgeCandidate, LearnedKnowledgeSnapshot } from "./learned-knowledge.js";
import { maybeValidateSnapshot } from "./snapshot-validation.js";

const KnowledgeEntityTypeSchema = z.enum([
  "module",
  "file",
  "symbol",
  "ui-action",
  "route",
  "api",
  "gateway-handler",
  "controller",
  "service",
  "eai-interface",
  "data-store",
  "async-channel",
  "data-contract",
  "data-model",
  "data-query",
  "data-table",
  "cache-key",
  "control-guard",
  "decision-path",
  "knowledge-cluster"
]);

const KnowledgeEdgeTypeSchema = z.enum([
  "contains",
  "declares",
  "calls",
  "proxies-to",
  "routes-to",
  "maps-to",
  "uses-eai",
  "uses-store",
  "dispatches-to",
  "consumes-from",
  "transitions-to",
  "propagates-contract",
  "emits-contract",
  "receives-contract",
  "accepts-contract",
  "returns-contract",
  "stores-model",
  "maps-to-table",
  "queries-table",
  "uses-cache-key",
  "validates",
  "branches-to",
  "depends-on",
  "belongs-to-domain",
  "belongs-to-channel",
  "belongs-to-process",
  "supports-module-role"
]);

const KnowledgeSourceTypeSchema = z.enum([
  "structure-index",
  "front-back-graph",
  "eai-dictionary",
  "learned-knowledge",
  "domain-pack",
  "derived"
]);

const KnowledgeValidatedStatusSchema = z.enum(["candidate", "validated", "derived", "stale"]);

const KnowledgeMetadataSchema = z.object({
  domains: z.array(z.string().min(1)).default([]),
  subdomains: z.array(z.string().min(1)).default([]),
  channels: z.array(z.string().min(1)).default([]),
  actions: z.array(z.string().min(1)).default([]),
  moduleRoles: z.array(z.string().min(1)).default([]),
  processRoles: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  evidencePaths: z.array(z.string().min(1)).default([]),
  sourceType: KnowledgeSourceTypeSchema,
  validatedStatus: KnowledgeValidatedStatusSchema
});

const KnowledgeEntitySchema = z.object({
  id: z.string().min(1),
  type: KnowledgeEntityTypeSchema,
  label: z.string().min(1),
  summary: z.string().default(""),
  metadata: KnowledgeMetadataSchema,
  attributes: z.record(z.string(), z.unknown()).default({})
});

const KnowledgeEdgeSchema = z.object({
  id: z.string().min(1),
  type: KnowledgeEdgeTypeSchema,
  fromId: z.string().min(1),
  toId: z.string().min(1),
  label: z.string().default(""),
  metadata: KnowledgeMetadataSchema,
  attributes: z.record(z.string(), z.unknown()).default({})
});

const KnowledgeSchemaSummarySchema = z.object({
  entityCount: z.number().int().min(0),
  edgeCount: z.number().int().min(0),
  entityTypeCounts: z.record(z.string(), z.number().int().min(0)),
  edgeTypeCounts: z.record(z.string(), z.number().int().min(0)),
  validatedClusterCount: z.number().int().min(0),
  candidateClusterCount: z.number().int().min(0),
  staleClusterCount: z.number().int().min(0),
  activeDomainCount: z.number().int().min(0),
  topDomains: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) })),
  topModules: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) }))
});

export const KnowledgeSchemaSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  workspaceDir: z.string().min(1),
  entities: z.array(KnowledgeEntitySchema),
  edges: z.array(KnowledgeEdgeSchema),
  summary: KnowledgeSchemaSummarySchema
});

export type KnowledgeEntityType = z.infer<typeof KnowledgeEntityTypeSchema>;
export type KnowledgeEdgeType = z.infer<typeof KnowledgeEdgeTypeSchema>;
export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceTypeSchema>;
export type KnowledgeValidatedStatus = z.infer<typeof KnowledgeValidatedStatusSchema>;
export type KnowledgeMetadata = z.infer<typeof KnowledgeMetadataSchema>;
export type KnowledgeEntity = z.infer<typeof KnowledgeEntitySchema>;
export type KnowledgeEdge = z.infer<typeof KnowledgeEdgeSchema>;
export type KnowledgeSchemaSnapshot = z.infer<typeof KnowledgeSchemaSnapshotSchema>;

interface StructureSymbolLike {
  name: string;
  line: number;
  className?: string;
}

interface StructureFileEntryLike {
  path: string;
  packageName?: string;
  summary: string;
  classes: StructureSymbolLike[];
  methods: StructureSymbolLike[];
  functions: StructureSymbolLike[];
  resources?: {
    storeKinds?: string[];
    redisAccessTypes?: string[];
    redisOps?: string[];
    redisKeys?: string[];
    asyncChannelNames?: string[];
    dbAccessTypes?: string[];
    requestModelNames?: string[];
    responseModelNames?: string[];
    dbModelNames?: string[];
    dbTableNames?: string[];
    dbQueryNames?: string[];
    controlGuardNames?: string[];
    decisionPathNames?: string[];
  };
}

interface StructureSnapshotLike {
  entries: Record<string, StructureFileEntryLike>;
}

interface BuildKnowledgeSchemaOptions {
  generatedAt: string;
  workspaceDir: string;
  structure?: StructureSnapshotLike;
  frontBackGraph?: FrontBackGraphSnapshot;
  eaiEntries?: EaiDictionaryEntry[];
  learnedKnowledge?: LearnedKnowledgeSnapshot;
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeComparable(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function basenameLabel(value: string): string {
  const base = path.basename(value);
  return base || value;
}

function makeMetadata(input?: Partial<KnowledgeMetadata>): KnowledgeMetadata {
  return {
    domains: unique(input?.domains ?? []),
    subdomains: unique(input?.subdomains ?? []),
    channels: unique(input?.channels ?? []),
    actions: unique(input?.actions ?? []),
    moduleRoles: unique(input?.moduleRoles ?? []),
    processRoles: unique(input?.processRoles ?? []),
    confidence: Math.max(0, Math.min(1, input?.confidence ?? 0.5)),
    evidencePaths: unique((input?.evidencePaths ?? []).map(toForwardSlash)),
    sourceType: input?.sourceType ?? "derived",
    validatedStatus: input?.validatedStatus ?? "derived"
  };
}

function mergeMetadata(left: KnowledgeMetadata, right: KnowledgeMetadata): KnowledgeMetadata {
  return makeMetadata({
    domains: [...left.domains, ...right.domains],
    subdomains: [...left.subdomains, ...right.subdomains],
    channels: [...left.channels, ...right.channels],
    actions: [...left.actions, ...right.actions],
    moduleRoles: [...left.moduleRoles, ...right.moduleRoles],
    processRoles: [...left.processRoles, ...right.processRoles],
    confidence: Math.max(left.confidence, right.confidence),
    evidencePaths: [...left.evidencePaths, ...right.evidencePaths],
    sourceType: left.sourceType === right.sourceType ? left.sourceType : "derived",
    validatedStatus:
      left.validatedStatus === "validated" || right.validatedStatus === "validated"
        ? "validated"
        : left.validatedStatus === "derived" || right.validatedStatus === "derived"
          ? "derived"
        : left.validatedStatus === "candidate" || right.validatedStatus === "candidate"
          ? "candidate"
          : left.validatedStatus === "stale" || right.validatedStatus === "stale"
            ? "stale"
            : "derived"
  });
}

function inferChannels(values: Array<string | undefined>): string[] {
  const joined = values.filter(Boolean).join(" ");
  const channels: string[] = [];
  if (/monimo/i.test(joined)) {
    channels.push("monimo");
  }
  return unique(channels);
}

function inferModuleRoles(moduleName: string): string[] {
  const normalized = normalizeComparable(moduleName);
  if (normalized.includes("gateway")) return ["gateway-routing"];
  if (normalized.includes("core")) return ["shared-platform-core"];
  if (normalized.includes("async")) return ["async-support"];
  if (normalized.includes("display")) return ["display-content"];
  if (normalized.includes("upload")) return ["upload-support"];
  return [];
}

function inferFrontendActionRoles(functionName?: string): string[] {
  const normalized = normalizeComparable(functionName);
  if (!normalized) {
    return [];
  }

  const roles: string[] = [];
  if (/submit|save|insert|apply|request|send|regist|register/.test(normalized)) roles.push("ui-submit");
  if (/load|fetch|get|inq|select|search|find/.test(normalized)) roles.push("ui-load");
  if (/check|verify|valid|confirm/.test(normalized)) roles.push("ui-validate");
  if (/callback|return|result|complete/.test(normalized)) roles.push("ui-callback");
  return unique(roles);
}

function inferProcessRoles(moduleName: string): string[] {
  const normalized = normalizeComparable(moduleName);
  if (normalized.includes("batch")) return ["batch-process"];
  return [];
}

function inferActionsFromTexts(...values: Array<string | undefined>): string[] {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  const actions = new Set<string>();
  if (/(login|signin|auth|authenticate|cert|verify)/.test(text)) actions.add("action-auth");
  if (/(register|regist|signup|join|enroll)/.test(text)) actions.add("action-register");
  if (/(check|precheck|pre-check|verify|valid|confirm|ensure)/.test(text)) actions.add("action-check");
  if (/(status|state|info|lookup)/.test(text)) actions.add("action-status-read");
  if (/(status|state|info|lookup|select|get|load|read|inquiry|inqury|query)/.test(text)) actions.add("action-read");
  if (/(save|insert|create|add|persist|write|set)/.test(text)) actions.add("action-write");
  if (/(update|modify|change|patch)/.test(text)) actions.add("action-update");
  if (/(delete|remove|clear|expire|evict)/.test(text)) actions.add("action-delete");
  if (/(callback|webhook|notify|event)/.test(text)) actions.add("action-callback");
  if (/(session|redis|cache)/.test(text)) actions.add("action-state-store");
  if (/(token|issue|refresh)/.test(text)) actions.add("action-token");
  return Array.from(actions);
}

function normalizeStoreKind(value: string): "redis" | "database" | undefined {
  const normalized = normalizeComparable(value);
  if (normalized.includes("redis")) {
    return "redis";
  }
  if (
    normalized.includes("database") ||
    normalized.includes("db") ||
    normalized.includes("repository") ||
    normalized.includes("mapper") ||
    normalized.includes("dao")
  ) {
    return "database";
  }
  return undefined;
}

function inferStoreLabel(kind: "redis" | "database"): string {
  return kind === "redis" ? "Redis Store" : "Database Store";
}

function normalizeTableName(value: string): string {
  return value.replace(/[`"'[\]]/g, "").trim();
}

function extractModuleName(relativePath: string, fallback?: string): string {
  const normalized = toForwardSlash(relativePath);
  const first = normalized.split("/").find(Boolean) ?? "";
  if (/^dcp-[a-z0-9-]+$/i.test(first)) {
    return first;
  }
  return fallback ? slugify(fallback) : "workspace-root";
}

function classifyCapabilityTags(tags: string[]): Pick<KnowledgeMetadata, "domains" | "subdomains" | "actions"> {
  const domains = new Set<string>();
  const subdomains = new Set<string>();
  const actions = new Set<string>();
  const tagSet = new Set(tags);

  for (const tag of tagSet) {
    if (tag.startsWith("action-")) {
      actions.add(tag);
      continue;
    }
    if (tag.startsWith("concept:")) {
      const value = tag.replace(/^concept:/, "");
      if (value) {
        domains.add(value);
      }
      continue;
    }
    if (tag.startsWith("subdomain:")) {
      const value = tag.replace(/^subdomain:/, "");
      if (value) {
        subdomains.add(value);
      }
    }
  }

  return {
    domains: Array.from(domains),
    subdomains: Array.from(subdomains),
    actions: Array.from(actions)
  };
}

function knowledgeEntityPriority(entity: KnowledgeEntity): number {
  switch (entity.type) {
    case "module":
      return 120;
    case "route":
    case "ui-action":
    case "api":
    case "gateway-handler":
    case "controller":
    case "service":
    case "eai-interface":
    case "data-store":
    case "async-channel":
    case "data-contract":
    case "control-guard":
    case "decision-path":
    case "knowledge-cluster":
      return 110;
    case "data-model":
    case "data-query":
    case "data-table":
    case "cache-key":
      return 95;
    case "file":
      return 70;
    case "symbol":
      return 55;
    default:
      return 50;
  }
}

function knowledgeEdgePriority(edge: KnowledgeEdge): number {
  switch (edge.type) {
    case "routes-to":
    case "proxies-to":
    case "calls":
    case "transitions-to":
    case "uses-eai":
    case "uses-store":
    case "dispatches-to":
    case "consumes-from":
    case "accepts-contract":
    case "returns-contract":
    case "propagates-contract":
    case "emits-contract":
    case "receives-contract":
      return 120;
    case "maps-to":
    case "stores-model":
    case "maps-to-table":
    case "queries-table":
    case "uses-cache-key":
    case "validates":
    case "branches-to":
    case "supports-module-role":
      return 105;
    case "contains":
    case "declares":
    case "depends-on":
      return 70;
    case "belongs-to-domain":
    case "belongs-to-channel":
    case "belongs-to-process":
      return 60;
    default:
      return 50;
  }
}

function knowledgeStatusPriority(status: KnowledgeValidatedStatus): number {
  switch (status) {
    case "validated":
      return 120;
    case "derived":
      return 95;
    case "candidate":
      return 80;
    case "stale":
      return 40;
    default:
      return 50;
  }
}

function buildEntityTypeCounts(entities: KnowledgeEntity[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function buildEdgeTypeCounts(edges: KnowledgeEdge[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function summarizeCounts(values: string[]): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.id.localeCompare(b.id)))
    .slice(0, 12);
}

function pickEntityMatchThreshold(kind: LearnedKnowledgeCandidate["kind"]): number {
  switch (kind) {
    case "channel":
      return 5;
    case "domain":
      return 4;
    case "module-role":
    case "process":
    default:
      return 3;
  }
}

function edgeTypeForKnowledgeKind(kind: LearnedKnowledgeCandidate["kind"]): KnowledgeEdgeType {
  switch (kind) {
    case "channel":
      return "belongs-to-channel";
    case "process":
      return "belongs-to-process";
    case "module-role":
      return "supports-module-role";
    case "domain":
    default:
      return "belongs-to-domain";
  }
}

function normalizeKnowledgeValue(candidate: LearnedKnowledgeCandidate): string {
  return candidate.id.split(":").slice(1).join(":") || slugify(candidate.label);
}

interface MatchableEntity {
  id: string;
  type: KnowledgeEntityType;
  pathText: string;
  moduleName: string;
  label: string;
  routePath: string;
  apiPath: string;
  screenCode: string;
  controllerName: string;
  serviceName: string;
}

function scoreKnowledgeCandidateMatch(candidate: LearnedKnowledgeCandidate, entity: MatchableEntity): number {
  const entityText = [
    entity.pathText,
    entity.moduleName,
    entity.label,
    entity.routePath,
    entity.apiPath,
    entity.screenCode,
    entity.controllerName,
    entity.serviceName
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  if (candidate.pathHints.some((hint) => hint && entityText.includes(hint.toLowerCase()))) score += 3;
  if (candidate.apiPrefixes.some((prefix) => prefix && entity.apiPath.toLowerCase().includes(prefix.toLowerCase()))) score += 5;
  if (candidate.screenPrefixes.some((prefix) => prefix && entity.screenCode.toLowerCase().startsWith(prefix.toLowerCase()))) score += 5;
  if (candidate.controllerHints.some((hint) => hint && entity.controllerName.toLowerCase().includes(hint.toLowerCase()))) score += 4;
  if (candidate.serviceHints.some((hint) => hint && entity.serviceName.toLowerCase().includes(hint.toLowerCase()))) score += 4;
  if (score === 0 && candidate.aliases.some((alias) => alias && entityText.includes(alias.toLowerCase()))) score += 1;
  return score;
}

export function buildKnowledgeSchemaSnapshot(options: BuildKnowledgeSchemaOptions): KnowledgeSchemaSnapshot {
  const backendWorkspaceBase = path.basename(options.workspaceDir);
  const entities = new Map<string, KnowledgeEntity>();
  const edges = new Map<string, KnowledgeEdge>();
  const classFileMap = new Map<string, string>();
  const classSymbolMap = new Map<string, string>();
  const methodSymbolMap = new Map<string, string>();

  const upsertEntity = (entity: KnowledgeEntity) => {
    const next = maybeValidateSnapshot(KnowledgeEntitySchema, entity);
    const existing = entities.get(next.id);
    if (!existing) {
      entities.set(next.id, next);
      return;
    }
    entities.set(next.id, {
      ...existing,
      label: existing.label || next.label,
      summary: existing.summary || next.summary,
      metadata: mergeMetadata(existing.metadata, next.metadata),
      attributes: {
        ...existing.attributes,
        ...next.attributes,
        sourceTypes: unique([
          ...((existing.attributes.sourceTypes as string[] | undefined) ?? []),
          existing.metadata.sourceType,
          next.metadata.sourceType
        ])
      }
    });
  };

  const edgeStorageKey = (edge: Pick<KnowledgeEdge, "type" | "fromId" | "toId" | "attributes">) => {
    if (edge.type === "propagates-contract") {
      return [
        edge.type,
        edge.fromId,
        edge.toId,
        String(edge.attributes.contractId ?? ""),
        String(edge.attributes.direction ?? "")
      ].join(":");
    }
    return `${edge.type}:${edge.fromId}:${edge.toId}`;
  };
  const upsertEdge = (edge: KnowledgeEdge) => {
    const next = maybeValidateSnapshot(KnowledgeEdgeSchema, edge);
    const key = edgeStorageKey(next);
    const existing = edges.get(key);
    if (!existing) {
      edges.set(key, next);
      return;
    }
    edges.set(key, {
      ...existing,
      label: existing.label || next.label,
      metadata: mergeMetadata(existing.metadata, next.metadata),
      attributes: {
        ...existing.attributes,
        ...next.attributes
      }
    });
  };
  const hasEdge = (type: KnowledgeEdgeType, fromId: string, toId: string) =>
    edges.has(edgeStorageKey({ type, fromId, toId, attributes: {} }));

  const ensureModule = (moduleName: string, sourceType: KnowledgeSourceType, evidencePath?: string) => {
    const id = `module:${moduleName}`;
    upsertEntity({
      id,
      type: "module",
      label: moduleName,
      summary: `${moduleName} module`,
      metadata: makeMetadata({
        moduleRoles: inferModuleRoles(moduleName),
        processRoles: inferProcessRoles(moduleName),
        confidence: 0.7,
        evidencePaths: evidencePath ? [evidencePath] : [],
        sourceType,
        validatedStatus: "derived"
      }),
      attributes: {
        moduleName
      }
    });
    return id;
  };

  const ensureDataStore = (storeKind: "redis" | "database", evidencePath?: string) => {
    const id = `store:${storeKind}`;
    upsertEntity({
      id,
      type: "data-store",
      label: inferStoreLabel(storeKind),
      summary: storeKind === "redis" ? "Redis-backed state/session/cache store" : "Database-backed persistence store",
      metadata: makeMetadata({
        channels: storeKind === "redis" ? ["cache-session"] : [],
        actions: storeKind === "redis" ? ["action-state-store"] : ["action-write", "action-read"],
        moduleRoles: storeKind === "redis" ? ["state-store"] : ["data-persistence"],
        confidence: 0.86,
        evidencePaths: evidencePath ? [evidencePath] : [],
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        storeKind
      }
    });
    return id;
  };

  const ensureAsyncChannel = (options: {
    channel: string;
    evidencePath: string;
    moduleName: string;
  }) => {
    const id = `async-channel:${slugify(options.channel)}`;
    upsertEntity({
      id,
      type: "async-channel",
      label: options.channel,
      summary: `Async/message boundary ${options.channel}`,
      metadata: makeMetadata({
        actions: inferActionsFromTexts(options.channel, "async callback queue topic event"),
        moduleRoles: ["async-support"],
        processRoles: ["async-process"],
        confidence: 0.74,
        evidencePaths: [options.evidencePath],
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        channel: options.channel,
        moduleName: options.moduleName,
        path: options.evidencePath
      }
    });
    return id;
  };

  const ensureDataContract = (options: {
    label: string;
    direction: "request" | "response";
    evidencePath: string;
    moduleName: string;
  }) => {
    const id = `data-contract:${slugify(options.label)}`;
    upsertEntity({
      id,
      type: "data-contract",
      label: options.label,
      summary:
        options.direction === "request"
          ? `${options.label} request/input contract`
          : `${options.label} response/output contract`,
      metadata: makeMetadata({
        actions: inferActionsFromTexts(
          options.label,
          options.direction === "request" ? "request input payload command param" : "response output result payload"
        ),
        moduleRoles: ["data-contract"],
        confidence: 0.76,
        evidencePaths: [options.evidencePath],
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        contractName: options.label,
        direction: options.direction,
        moduleName: options.moduleName,
        path: options.evidencePath
      }
    });
    return id;
  };

  const ensureDataModel = (options: {
    label: string;
    tableName?: string;
    evidencePath: string;
    moduleName: string;
  }) => {
    const normalizedLabel = slugify(options.label || options.tableName || "data-model");
    const id = `data-model:${normalizedLabel}`;
    upsertEntity({
      id,
      type: "data-model",
      label: options.label,
      summary: options.tableName
        ? `${options.label} maps to table ${options.tableName}`
        : `${options.label} database model`,
      metadata: makeMetadata({
        actions: inferActionsFromTexts(options.label, options.tableName),
        moduleRoles: ["data-model"],
        confidence: 0.78,
        evidencePaths: [options.evidencePath],
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        modelName: options.label,
        tableName: options.tableName ?? null,
        moduleName: options.moduleName,
        path: options.evidencePath
      }
    });
    return id;
  };

  const ensureDataQuery = (options: {
    label: string;
    tableNames: string[];
    evidencePath: string;
    moduleName: string;
  }) => {
    const id = `data-query:${slugify(options.label)}:${slugify(options.evidencePath)}`;
    upsertEntity({
      id,
      type: "data-query",
      label: options.label,
      summary:
        options.tableNames.length > 0
          ? `${options.label} query touches ${options.tableNames.join(", ")}`
          : `${options.label} database query`,
      metadata: makeMetadata({
        actions: inferActionsFromTexts(options.label, ...options.tableNames),
        moduleRoles: ["data-persistence"],
        confidence: 0.8,
        evidencePaths: [options.evidencePath],
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        queryName: options.label,
        tableNames: options.tableNames,
        moduleName: options.moduleName,
        path: options.evidencePath
      }
    });
    return id;
  };

  const ensureDataTable = (options: {
    tableName: string;
    evidencePath: string;
    moduleName: string;
  }) => {
    const normalizedTableName = normalizeTableName(options.tableName);
    const id = `data-table:${slugify(normalizedTableName || options.tableName)}`;
    upsertEntity({
      id,
      type: "data-table",
      label: normalizedTableName || options.tableName,
      summary: `Database table ${normalizedTableName || options.tableName}`,
      metadata: makeMetadata({
        actions: inferActionsFromTexts(options.tableName),
        moduleRoles: ["data-persistence"],
        confidence: 0.8,
        evidencePaths: [options.evidencePath],
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        tableName: normalizedTableName || options.tableName,
        moduleName: options.moduleName,
        path: options.evidencePath
      }
    });
    const databaseStoreId = ensureDataStore("database", options.evidencePath);
    upsertEdge({
      id: `edge:uses-store:${id}:${databaseStoreId}`,
      type: "uses-store",
      fromId: id,
      toId: databaseStoreId,
      label: "table stored in database",
      metadata: makeMetadata({
        moduleRoles: ["data-persistence"],
        confidence: 0.78,
        evidencePaths: [options.evidencePath],
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        storeKind: "database"
      }
    });
    return id;
  };

  const ensureCacheKey = (options: {
    key: string;
    evidencePath: string;
    moduleName: string;
  }) => {
    const id = `cache-key:${slugify(options.key)}`;
    upsertEntity({
      id,
      type: "cache-key",
      label: options.key,
      summary: `Redis/cache key hint ${options.key}`,
      metadata: makeMetadata({
        channels: ["cache-session"],
        actions: inferActionsFromTexts(options.key, "redis cache session"),
        moduleRoles: ["state-store"],
        confidence: 0.72,
        evidencePaths: [options.evidencePath],
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        key: options.key,
        moduleName: options.moduleName,
        path: options.evidencePath
      }
    });
    return id;
  };

  const ensureControlGuard = (options: {
    label: string;
    evidencePath: string;
    moduleName: string;
  }) => {
    const id = `control-guard:${slugify(options.label)}:${slugify(options.evidencePath)}`;
    upsertEntity({
      id,
      type: "control-guard",
      label: options.label,
      summary: `${options.label} validation/guard control`,
      metadata: makeMetadata({
        actions: inferActionsFromTexts(options.label, "validate guard check verify"),
        moduleRoles: ["validation-control"],
        confidence: 0.76,
        evidencePaths: [options.evidencePath],
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        guardName: options.label,
        moduleName: options.moduleName,
        path: options.evidencePath
      }
    });
    return id;
  };

  const ensureDecisionPath = (options: {
    label: string;
    ownerName?: string;
    evidencePath: string;
    moduleName: string;
  }) => {
    const id = `decision-path:${slugify(options.ownerName ?? "file")}:${slugify(options.label)}:${slugify(options.evidencePath)}`;
    upsertEntity({
      id,
      type: "decision-path",
      label: options.ownerName ? `${options.ownerName} :: ${options.label}` : options.label,
      summary: `${options.label} decision/branch path`,
      metadata: makeMetadata({
        actions: inferActionsFromTexts(options.label, options.ownerName, "decision branch if switch guard"),
        moduleRoles: ["decision-control"],
        confidence: 0.72,
        evidencePaths: [options.evidencePath],
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        decisionLabel: options.label,
        ownerName: options.ownerName ?? null,
        moduleName: options.moduleName,
        path: options.evidencePath
      }
    });
    return id;
  };

  const inferAsyncEdgeType = (...values: Array<string | undefined>): "dispatches-to" | "consumes-from" | undefined => {
    const joined = values.filter(Boolean).join(" ").toLowerCase();
    if (!joined) {
      return undefined;
    }
    if (/(send|publish|emit|enqueue|dispatch|produce|push)/.test(joined)) {
      return "dispatches-to";
    }
    if (/(consume|listen|listener|receive|callback|webhook|process|processor|worker|handler|subscriber|async)/.test(joined)) {
      return "consumes-from";
    }
    return undefined;
  };

  const orderedActionPhases = (actions: string[]): string[] => {
    const normalized = new Set(actions.map((item) => item.trim()).filter(Boolean));
    const order = [
      "action-auth",
      "action-register",
      "action-check",
      "action-document",
      "action-write",
      "action-update",
      "action-delete",
      "action-state-store",
      "action-status-read",
      "action-read",
      "action-callback",
      "action-token"
    ];
    return order.filter((action) => normalized.has(action));
  };

  const addTransitionEdge = (options: {
    fromId?: string;
    toId?: string;
    fromTexts: Array<string | undefined>;
    toTexts: Array<string | undefined>;
    evidencePaths: Array<string | undefined>;
    confidence: number;
  }) => {
    if (!options.fromId || !options.toId || options.fromId === options.toId) {
      return;
    }
    const fromPhases = orderedActionPhases(inferActionsFromTexts(...options.fromTexts));
    const toPhases = orderedActionPhases(inferActionsFromTexts(...options.toTexts));
    const fromPhase = fromPhases[0];
    const toPhase = toPhases.find((phase) => phase !== fromPhase) ?? toPhases[0];
    if (!fromPhase || !toPhase || fromPhase === toPhase) {
      return;
    }
    upsertEdge({
      id: `edge:transitions-to:${options.fromId}:${options.toId}`,
      type: "transitions-to",
      fromId: options.fromId,
      toId: options.toId,
      label: `${fromPhase.replace(/^action-/, "")} -> ${toPhase.replace(/^action-/, "")}`,
      metadata: makeMetadata({
        actions: [fromPhase, toPhase],
        processRoles: ["state-transition"],
        confidence: Math.max(0.7, options.confidence - 0.04),
        evidencePaths: unique(options.evidencePaths.filter(Boolean) as string[]),
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        fromPhase,
        toPhase
      }
    });
  };

  const addDerivedTransitionEdge = (options: {
    fromId?: string;
    toId?: string;
    label: string;
    texts: Array<string | undefined>;
    evidencePaths: Array<string | undefined>;
    confidence: number;
    edgeKind: string;
  }) => {
    if (!options.fromId || !options.toId || options.fromId === options.toId) {
      return;
    }
    if (hasEdge("transitions-to", options.fromId, options.toId)) {
      return;
    }
    upsertEdge({
      id: `edge:transitions-to:${options.fromId}:${options.toId}:${slugify(options.edgeKind)}`,
      type: "transitions-to",
      fromId: options.fromId,
      toId: options.toId,
      label: options.label,
      metadata: makeMetadata({
        actions: inferActionsFromTexts(...options.texts),
        processRoles: ["state-transition"],
        confidence: Math.max(0.68, options.confidence - 0.05),
        evidencePaths: unique(options.evidencePaths.filter(Boolean) as string[]),
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        edgeKind: options.edgeKind
      }
    });
  };

  for (const [relativePath, entry] of Object.entries(options.structure?.entries ?? {})) {
    const normalizedPath = toForwardSlash(relativePath);
    const moduleName = extractModuleName(normalizedPath, backendWorkspaceBase);
    const moduleId = ensureModule(moduleName, "structure-index", normalizedPath);
    const fileId = `file:backend:${normalizedPath}`;
    upsertEntity({
      id: fileId,
      type: "file",
      label: basenameLabel(normalizedPath),
      summary: entry.summary,
      metadata: makeMetadata({
        actions: inferActionsFromTexts(normalizedPath, entry.summary),
        moduleRoles: inferModuleRoles(moduleName),
        processRoles: inferProcessRoles(moduleName),
        confidence: 0.72,
        evidencePaths: [normalizedPath],
        sourceType: "structure-index",
        validatedStatus: "derived"
      }),
      attributes: {
        path: normalizedPath,
        packageName: entry.packageName ?? null,
        moduleName
      }
    });
    upsertEdge({
      id: `edge:contains:${moduleId}:${fileId}`,
      type: "contains",
      fromId: moduleId,
      toId: fileId,
      label: "module contains file",
      metadata: makeMetadata({
        confidence: 0.82,
        evidencePaths: [normalizedPath],
        sourceType: "structure-index",
        validatedStatus: "derived"
      }),
      attributes: {}
    });

    const resourceHints = entry.resources ?? {};
    const storeKinds = unique((resourceHints.storeKinds ?? []).map((value) => normalizeStoreKind(value) ?? "")).filter(
      (value): value is "redis" | "database" => value === "redis" || value === "database"
    );
    for (const storeKind of storeKinds) {
      const storeId = ensureDataStore(storeKind, normalizedPath);
      upsertEdge({
        id: `edge:uses-store:${fileId}:${storeId}`,
        type: "uses-store",
        fromId: fileId,
        toId: storeId,
        label: `file uses ${storeKind} store`,
        metadata: makeMetadata({
          actions: inferActionsFromTexts(storeKind, normalizedPath),
          moduleRoles: storeKind === "redis" ? ["state-store"] : ["data-persistence"],
          confidence: 0.82,
          evidencePaths: [normalizedPath],
          sourceType: "structure-index",
          validatedStatus: "derived"
        }),
        attributes: {
          storeKind
        }
      });
    }

    const requestModelNames = unique(resourceHints.requestModelNames ?? []);
    const responseModelNames = unique(resourceHints.responseModelNames ?? []);
    const asyncChannelNames = unique(resourceHints.asyncChannelNames ?? []);
    const asyncChannelIds = asyncChannelNames.map((channel) =>
      ensureAsyncChannel({
        channel,
        evidencePath: normalizedPath,
        moduleName
      })
    );
    for (const requestModelName of requestModelNames) {
      const requestContractId = ensureDataContract({
        label: requestModelName,
        direction: "request",
        evidencePath: normalizedPath,
        moduleName
      });
      upsertEdge({
        id: `edge:declares:${fileId}:${requestContractId}`,
        type: "declares",
        fromId: fileId,
        toId: requestContractId,
        label: "file declares request contract",
        metadata: makeMetadata({
          actions: inferActionsFromTexts(requestModelName, normalizedPath, "request input payload"),
          moduleRoles: ["data-contract"],
          confidence: 0.76,
          evidencePaths: [normalizedPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {
          direction: "request"
        }
      });
    }
    for (const responseModelName of responseModelNames) {
      const responseContractId = ensureDataContract({
        label: responseModelName,
        direction: "response",
        evidencePath: normalizedPath,
        moduleName
      });
      upsertEdge({
        id: `edge:declares:${fileId}:${responseContractId}`,
        type: "declares",
        fromId: fileId,
        toId: responseContractId,
        label: "file declares response contract",
        metadata: makeMetadata({
          actions: inferActionsFromTexts(responseModelName, normalizedPath, "response output result payload"),
          moduleRoles: ["data-contract"],
          confidence: 0.76,
          evidencePaths: [normalizedPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {
          direction: "response"
        }
      });
    }

    const dbTableNames = unique((resourceHints.dbTableNames ?? []).map(normalizeTableName));
    const dbTableName = dbTableNames[0];
    for (const tableName of dbTableNames) {
      const tableId = ensureDataTable({
        tableName,
        evidencePath: normalizedPath,
        moduleName
      });
      upsertEdge({
        id: `edge:queries-table:${fileId}:${tableId}`,
        type: "queries-table",
        fromId: fileId,
        toId: tableId,
        label: "file queries database table",
        metadata: makeMetadata({
          actions: inferActionsFromTexts(tableName, normalizedPath),
          moduleRoles: ["data-persistence"],
          confidence: 0.78,
          evidencePaths: [normalizedPath],
          sourceType: "structure-index",
          validatedStatus: "derived"
        }),
        attributes: {}
      });
    }
    for (const modelName of unique(resourceHints.dbModelNames ?? [])) {
      const modelId = ensureDataModel({
        label: modelName,
        tableName: dbTableName,
        evidencePath: normalizedPath,
        moduleName
      });
      upsertEdge({
        id: `edge:stores-model:${fileId}:${modelId}`,
        type: "stores-model",
        fromId: fileId,
        toId: modelId,
        label: "file defines or uses database model",
        metadata: makeMetadata({
          actions: inferActionsFromTexts(modelName, dbTableName, normalizedPath),
          moduleRoles: ["data-model"],
          confidence: 0.78,
          evidencePaths: [normalizedPath],
          sourceType: "structure-index",
          validatedStatus: "derived"
        }),
        attributes: {
          tableName: dbTableName ?? null
        }
      });
      if (dbTableName) {
        const tableId = ensureDataTable({
          tableName: dbTableName,
          evidencePath: normalizedPath,
          moduleName
        });
        upsertEdge({
          id: `edge:maps-to-table:${modelId}:${tableId}`,
          type: "maps-to-table",
          fromId: modelId,
          toId: tableId,
          label: "model maps to database table",
          metadata: makeMetadata({
            moduleRoles: ["data-model", "data-persistence"],
            confidence: 0.82,
            evidencePaths: [normalizedPath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      }
    }

    for (const queryName of unique(resourceHints.dbQueryNames ?? [])) {
      const queryId = ensureDataQuery({
        label: queryName,
        tableNames: dbTableNames,
        evidencePath: normalizedPath,
        moduleName
      });
      upsertEdge({
        id: `edge:declares:${fileId}:${queryId}`,
        type: "declares",
        fromId: fileId,
        toId: queryId,
        label: "file declares database query",
        metadata: makeMetadata({
          actions: inferActionsFromTexts(queryName, ...dbTableNames),
          moduleRoles: ["data-persistence"],
          confidence: 0.78,
          evidencePaths: [normalizedPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {}
      });

      for (const tableName of dbTableNames) {
        const tableId = ensureDataTable({
          tableName,
          evidencePath: normalizedPath,
          moduleName
        });
        upsertEdge({
          id: `edge:queries-table:${queryId}:${tableId}`,
          type: "queries-table",
          fromId: queryId,
          toId: tableId,
          label: "query reads or writes database table",
          metadata: makeMetadata({
            actions: inferActionsFromTexts(queryName, tableName),
            moduleRoles: ["data-persistence"],
            confidence: 0.8,
            evidencePaths: [normalizedPath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      }
    }

    for (const redisKey of unique(resourceHints.redisKeys ?? [])) {
      const cacheKeyId = ensureCacheKey({
        key: redisKey,
        evidencePath: normalizedPath,
        moduleName
      });
      upsertEdge({
        id: `edge:uses-cache-key:${fileId}:${cacheKeyId}`,
        type: "uses-cache-key",
        fromId: fileId,
        toId: cacheKeyId,
        label: "file uses cache/session key",
        metadata: makeMetadata({
          channels: ["cache-session"],
          actions: inferActionsFromTexts(redisKey, normalizedPath),
          moduleRoles: ["state-store"],
          confidence: 0.76,
          evidencePaths: [normalizedPath],
          sourceType: "structure-index",
          validatedStatus: "derived"
        }),
        attributes: {}
      });
      const redisStoreId = ensureDataStore("redis", normalizedPath);
      upsertEdge({
        id: `edge:uses-store:${cacheKeyId}:${redisStoreId}`,
        type: "uses-store",
        fromId: cacheKeyId,
        toId: redisStoreId,
        label: "cache key stored in redis",
        metadata: makeMetadata({
          channels: ["cache-session"],
          moduleRoles: ["state-store"],
          confidence: 0.74,
          evidencePaths: [normalizedPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {
          storeKind: "redis"
        }
      });
    }

    if (asyncChannelIds.length > 0) {
      for (const asyncChannelId of asyncChannelIds) {
        const asyncEdgeType = inferAsyncEdgeType(normalizedPath, entry.summary) ?? "consumes-from";
        upsertEdge({
          id: `edge:${asyncEdgeType}:${fileId}:${asyncChannelId}`,
          type: asyncEdgeType,
          fromId: fileId,
          toId: asyncChannelId,
          label: asyncEdgeType === "dispatches-to" ? "file dispatches to async channel" : "file consumes from async channel",
          metadata: makeMetadata({
            actions: inferActionsFromTexts(entry.summary, normalizedPath, "async callback queue topic event"),
            moduleRoles: ["async-support"],
            processRoles: ["async-process"],
            confidence: 0.68,
            evidencePaths: [normalizedPath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
        addDerivedTransitionEdge({
          fromId: asyncEdgeType === "dispatches-to" ? fileId : asyncChannelId,
          toId: asyncEdgeType === "dispatches-to" ? asyncChannelId : fileId,
          label: asyncEdgeType === "dispatches-to" ? "async dispatch transition" : "async consume transition",
          texts: [entry.summary, normalizedPath, asyncChannelId],
          evidencePaths: [normalizedPath],
          confidence: 0.72,
          edgeKind: asyncEdgeType
        });
      }
    }

    for (const classRef of entry.classes) {
      const symbolId = `symbol:class:${classRef.name}:${normalizedPath}`;
      classFileMap.set(classRef.name, normalizedPath);
      classSymbolMap.set(classRef.name, symbolId);
      upsertEntity({
        id: symbolId,
        type: "symbol",
        label: classRef.name,
        summary: `${classRef.name} class symbol`,
        metadata: makeMetadata({
          actions: inferActionsFromTexts(classRef.name, normalizedPath),
          moduleRoles: inferModuleRoles(moduleName),
          processRoles: inferProcessRoles(moduleName),
          confidence: 0.7,
          evidencePaths: [normalizedPath],
          sourceType: "structure-index",
          validatedStatus: "derived"
        }),
        attributes: {
          path: normalizedPath,
          symbolKind: "class",
          line: classRef.line,
          className: classRef.name,
          moduleName
        }
      });
      upsertEdge({
        id: `edge:declares:${fileId}:${symbolId}`,
        type: "declares",
        fromId: fileId,
        toId: symbolId,
        label: "file declares class",
        metadata: makeMetadata({
          confidence: 0.84,
          evidencePaths: [normalizedPath],
          sourceType: "structure-index",
          validatedStatus: "derived"
        }),
        attributes: {}
      });

      if ((resourceHints.dbAccessTypes ?? []).includes(classRef.name)) {
        const databaseStoreId = ensureDataStore("database", normalizedPath);
        upsertEdge({
          id: `edge:uses-store:${symbolId}:${databaseStoreId}`,
          type: "uses-store",
          fromId: symbolId,
          toId: databaseStoreId,
          label: "class accesses database store",
          metadata: makeMetadata({
            actions: inferActionsFromTexts(classRef.name, "database"),
            moduleRoles: ["data-persistence"],
            confidence: 0.8,
            evidencePaths: [normalizedPath],
            sourceType: "structure-index",
            validatedStatus: "derived"
          }),
          attributes: {
            accessType: classRef.name
          }
        });
      }

      if ((resourceHints.redisAccessTypes ?? []).includes(classRef.name)) {
        const redisStoreId = ensureDataStore("redis", normalizedPath);
        upsertEdge({
          id: `edge:uses-store:${symbolId}:${redisStoreId}`,
          type: "uses-store",
          fromId: symbolId,
          toId: redisStoreId,
          label: "class accesses redis store",
          metadata: makeMetadata({
            actions: inferActionsFromTexts(classRef.name, "redis"),
            moduleRoles: ["state-store"],
            confidence: 0.8,
            evidencePaths: [normalizedPath],
            sourceType: "structure-index",
            validatedStatus: "derived"
          }),
          attributes: {
            accessType: classRef.name
          }
        });
      }

      for (const asyncChannelId of asyncChannelIds) {
        const asyncEdgeType = inferAsyncEdgeType(classRef.name, normalizedPath, entry.summary);
        if (!asyncEdgeType) {
          continue;
        }
        upsertEdge({
          id: `edge:${asyncEdgeType}:${symbolId}:${asyncChannelId}`,
          type: asyncEdgeType,
          fromId: symbolId,
          toId: asyncChannelId,
          label: asyncEdgeType === "dispatches-to" ? "class dispatches to async channel" : "class consumes from async channel",
          metadata: makeMetadata({
            actions: inferActionsFromTexts(classRef.name, "async callback queue topic event"),
            moduleRoles: ["async-support"],
            processRoles: ["async-process"],
            confidence: 0.74,
            evidencePaths: [normalizedPath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
        addDerivedTransitionEdge({
          fromId: asyncEdgeType === "dispatches-to" ? symbolId : asyncChannelId,
          toId: asyncEdgeType === "dispatches-to" ? asyncChannelId : symbolId,
          label: asyncEdgeType === "dispatches-to" ? "async dispatch transition" : "async consume transition",
          texts: [classRef.name, normalizedPath, asyncChannelId],
          evidencePaths: [normalizedPath],
          confidence: 0.76,
          edgeKind: asyncEdgeType
        });
      }
    }

    for (const methodRef of [...entry.methods, ...entry.functions]) {
      const classPart = methodRef.className ?? "(global)";
      const symbolId = `symbol:method:${classPart}.${methodRef.name}:${normalizedPath}`;
      methodSymbolMap.set(`${classPart}.${methodRef.name}`, symbolId);
      upsertEntity({
        id: symbolId,
        type: "symbol",
        label: methodRef.className ? `${methodRef.className}.${methodRef.name}` : methodRef.name,
        summary: `${methodRef.name} ${methodRef.className ? "method" : "function"} symbol`,
        metadata: makeMetadata({
          actions: inferActionsFromTexts(methodRef.name, methodRef.className, normalizedPath),
          moduleRoles: inferModuleRoles(moduleName),
          processRoles: inferProcessRoles(moduleName),
          confidence: 0.68,
          evidencePaths: [normalizedPath],
          sourceType: "structure-index",
          validatedStatus: "derived"
        }),
        attributes: {
          path: normalizedPath,
          symbolKind: methodRef.className ? "method" : "function",
          line: methodRef.line,
          className: methodRef.className ?? null,
          methodName: methodRef.name,
          moduleName
        }
      });
      upsertEdge({
        id: `edge:declares:${fileId}:${symbolId}`,
        type: "declares",
        fromId: fileId,
        toId: symbolId,
        label: methodRef.className ? "file declares method" : "file declares function",
        metadata: makeMetadata({
          confidence: 0.82,
          evidencePaths: [normalizedPath],
          sourceType: "structure-index",
          validatedStatus: "derived"
        }),
        attributes: {}
      });
      if (methodRef.className && classSymbolMap.has(methodRef.className)) {
        upsertEdge({
          id: `edge:contains:${classSymbolMap.get(methodRef.className)!}:${symbolId}`,
          type: "contains",
          fromId: classSymbolMap.get(methodRef.className)!,
          toId: symbolId,
          label: "class contains method",
          metadata: makeMetadata({
            confidence: 0.8,
            evidencePaths: [normalizedPath],
            sourceType: "structure-index",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      }

      if ((resourceHints.redisOps ?? []).length > 0 && /(redis|getredis|setredis|session)/i.test(methodRef.name)) {
        const redisStoreId = ensureDataStore("redis", normalizedPath);
        upsertEdge({
          id: `edge:uses-store:${symbolId}:${redisStoreId}`,
          type: "uses-store",
          fromId: symbolId,
          toId: redisStoreId,
          label: "method accesses redis/session store",
          metadata: makeMetadata({
            channels: ["cache-session"],
            actions: inferActionsFromTexts(methodRef.name, ...(resourceHints.redisOps ?? [])),
            moduleRoles: ["state-store"],
            confidence: 0.76,
            evidencePaths: [normalizedPath],
            sourceType: "structure-index",
            validatedStatus: "derived"
          }),
          attributes: {
            redisOps: resourceHints.redisOps
          }
        });
      }

      for (const requestModelName of requestModelNames) {
        const requestContractId = ensureDataContract({
          label: requestModelName,
          direction: "request",
          evidencePath: normalizedPath,
          moduleName
        });
        upsertEdge({
          id: `edge:accepts-contract:${symbolId}:${requestContractId}`,
          type: "accepts-contract",
          fromId: symbolId,
          toId: requestContractId,
          label: "method accepts request contract",
          metadata: makeMetadata({
            actions: inferActionsFromTexts(methodRef.name, requestModelName, "request input payload"),
            moduleRoles: ["data-contract"],
            confidence: 0.72,
            evidencePaths: [normalizedPath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {
            direction: "request"
          }
        });
      }

      for (const responseModelName of responseModelNames) {
        const responseContractId = ensureDataContract({
          label: responseModelName,
          direction: "response",
          evidencePath: normalizedPath,
          moduleName
        });
        upsertEdge({
          id: `edge:returns-contract:${symbolId}:${responseContractId}`,
          type: "returns-contract",
          fromId: symbolId,
          toId: responseContractId,
          label: "method returns response contract",
          metadata: makeMetadata({
            actions: inferActionsFromTexts(methodRef.name, responseModelName, "response output result payload"),
            moduleRoles: ["data-contract"],
            confidence: 0.72,
            evidencePaths: [normalizedPath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {
            direction: "response"
          }
        });
      }

      for (const asyncChannelId of asyncChannelIds) {
        const asyncEdgeType = inferAsyncEdgeType(methodRef.name, methodRef.className, normalizedPath, entry.summary);
        if (!asyncEdgeType) {
          continue;
        }
        upsertEdge({
          id: `edge:${asyncEdgeType}:${symbolId}:${asyncChannelId}`,
          type: asyncEdgeType,
          fromId: symbolId,
          toId: asyncChannelId,
          label: asyncEdgeType === "dispatches-to" ? "method dispatches to async channel" : "method consumes from async channel",
          metadata: makeMetadata({
            actions: inferActionsFromTexts(methodRef.name, methodRef.className, "async callback queue topic event"),
            moduleRoles: ["async-support"],
            processRoles: ["async-process"],
            confidence: 0.78,
            evidencePaths: [normalizedPath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
        addDerivedTransitionEdge({
          fromId: asyncEdgeType === "dispatches-to" ? symbolId : asyncChannelId,
          toId: asyncEdgeType === "dispatches-to" ? asyncChannelId : symbolId,
          label: asyncEdgeType === "dispatches-to" ? "async dispatch transition" : "async consume transition",
          texts: [methodRef.name, methodRef.className, normalizedPath, asyncChannelId],
          evidencePaths: [normalizedPath],
          confidence: 0.8,
          edgeKind: asyncEdgeType
        });
      }
    }

    for (const guardName of unique(resourceHints.controlGuardNames ?? [])) {
      const guardId = ensureControlGuard({
        label: guardName,
        evidencePath: normalizedPath,
        moduleName
      });
      upsertEdge({
        id: `edge:declares:${fileId}:${guardId}`,
        type: "declares",
        fromId: fileId,
        toId: guardId,
        label: "file declares validation guard",
        metadata: makeMetadata({
          actions: inferActionsFromTexts(guardName, "validate guard check verify"),
          moduleRoles: ["validation-control"],
          confidence: 0.78,
          evidencePaths: [normalizedPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {}
      });

      const classSymbolId = classSymbolMap.get(guardName);
      if (classSymbolId) {
        upsertEdge({
          id: `edge:validates:${classSymbolId}:${guardId}`,
          type: "validates",
          fromId: classSymbolId,
          toId: guardId,
          label: "class implements validation guard",
          metadata: makeMetadata({
            actions: inferActionsFromTexts(guardName, "validate guard check verify"),
            moduleRoles: ["validation-control"],
            confidence: 0.8,
            evidencePaths: [normalizedPath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      }

      const matchingMethodSymbol = Array.from(methodSymbolMap.entries()).find(([key]) =>
        key.endsWith(`.${guardName}`) || key === guardName
      )?.[1];
      if (matchingMethodSymbol) {
        upsertEdge({
          id: `edge:validates:${matchingMethodSymbol}:${guardId}`,
          type: "validates",
          fromId: matchingMethodSymbol,
          toId: guardId,
          label: "method performs validation guard",
          metadata: makeMetadata({
            actions: inferActionsFromTexts(guardName, "validate guard check verify"),
            moduleRoles: ["validation-control"],
            confidence: 0.84,
            evidencePaths: [normalizedPath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      }
    }

    for (const decisionPathName of unique(resourceHints.decisionPathNames ?? [])) {
      const [ownerCandidate, ...labelParts] = decisionPathName.split("::");
      const decisionLabel = (labelParts.length > 0 ? labelParts.join("::") : ownerCandidate).trim();
      const ownerName = labelParts.length > 0 ? ownerCandidate.trim() : undefined;
      const decisionId = ensureDecisionPath({
        label: decisionLabel,
        ownerName,
        evidencePath: normalizedPath,
        moduleName
      });
      upsertEdge({
        id: `edge:declares:${fileId}:${decisionId}`,
        type: "declares",
        fromId: fileId,
        toId: decisionId,
        label: "file declares decision path",
        metadata: makeMetadata({
          actions: inferActionsFromTexts(decisionLabel, ownerName, "decision branch if switch"),
          moduleRoles: ["decision-control"],
          confidence: 0.74,
          evidencePaths: [normalizedPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {}
      });

      const matchingMethodSymbol = ownerName
        ? Array.from(methodSymbolMap.entries()).find(([key]) => key.endsWith(`.${ownerName}`) || key === ownerName)?.[1]
        : undefined;
      if (matchingMethodSymbol) {
        upsertEdge({
          id: `edge:branches-to:${matchingMethodSymbol}:${decisionId}`,
          type: "branches-to",
          fromId: matchingMethodSymbol,
          toId: decisionId,
          label: "method branches through decision path",
          metadata: makeMetadata({
            actions: inferActionsFromTexts(decisionLabel, ownerName, "decision branch if switch"),
            moduleRoles: ["decision-control"],
            confidence: 0.78,
            evidencePaths: [normalizedPath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      }
    }
  }

  const frontendModuleId = options.frontBackGraph ? ensureModule("frontend-linked-workspaces", "front-back-graph") : undefined;

  for (const screen of options.frontBackGraph?.frontend.screens ?? []) {
    const tags = classifyCapabilityTags(screen.capabilityTags ?? []);
    const channels = inferChannels([screen.filePath, screen.screenCode, ...(screen.labels ?? [])]);
    const fileId = `file:frontend:${screen.filePath}`;
    upsertEntity({
      id: fileId,
      type: "file",
      label: screen.screenCode || basenameLabel(screen.filePath),
      summary: `frontend screen ${screen.filePath}`,
      metadata: makeMetadata({
        ...tags,
        channels,
        confidence: 0.7,
        evidencePaths: [screen.filePath],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      }),
      attributes: {
        path: screen.filePath,
        screenCode: screen.screenCode ?? null,
        routePaths: screen.routePaths,
        apiPaths: screen.apiPaths
      }
    });
    if (frontendModuleId) {
      upsertEdge({
        id: `edge:contains:${frontendModuleId}:${fileId}`,
        type: "contains",
        fromId: frontendModuleId,
        toId: fileId,
        label: "frontend module contains screen",
        metadata: makeMetadata({
          ...tags,
          channels,
          confidence: 0.8,
          evidencePaths: [screen.filePath],
          sourceType: "front-back-graph",
          validatedStatus: "derived"
        }),
        attributes: {}
      });
    }

    for (const httpCall of screen.httpCalls) {
      if (!httpCall.functionName) {
        continue;
      }
      const actionTags = classifyCapabilityTags(screen.capabilityTags ?? []);
      const actionHints = inferActionsFromTexts(
        httpCall.functionName,
        httpCall.rawUrl,
        httpCall.normalizedUrl,
        screen.screenCode,
        screen.filePath
      );
      const actionChannels = inferChannels([
        screen.filePath,
        screen.screenCode,
        httpCall.functionName,
        httpCall.rawUrl,
        httpCall.normalizedUrl
      ]);
      const uiActionId = `ui-action:${screen.filePath}:${slugify(httpCall.functionName)}`;
      upsertEntity({
        id: uiActionId,
        type: "ui-action",
        label: httpCall.functionName,
        summary: `${httpCall.functionName} UI action in ${screen.screenCode || basenameLabel(screen.filePath)}`,
        metadata: makeMetadata({
          ...actionTags,
          channels: actionChannels,
          actions: unique([...actionTags.actions, ...actionHints]),
          moduleRoles: inferFrontendActionRoles(httpCall.functionName),
          confidence: 0.76,
          evidencePaths: [screen.filePath],
          sourceType: "front-back-graph",
          validatedStatus: "derived"
        }),
        attributes: {
          functionName: httpCall.functionName,
          screenPath: screen.filePath,
          screenCode: screen.screenCode ?? null,
          rawUrl: httpCall.rawUrl,
          normalizedUrl: httpCall.normalizedUrl,
          method: httpCall.method ?? null
        }
      });
      upsertEdge({
        id: `edge:declares:${fileId}:${uiActionId}`,
        type: "declares",
        fromId: fileId,
        toId: uiActionId,
        label: "screen declares UI action",
        metadata: makeMetadata({
          ...actionTags,
          channels: actionChannels,
          actions: unique([...actionTags.actions, ...actionHints]),
          moduleRoles: inferFrontendActionRoles(httpCall.functionName),
          confidence: 0.8,
          evidencePaths: [screen.filePath],
          sourceType: "front-back-graph",
          validatedStatus: "derived"
        }),
        attributes: {
          rawUrl: httpCall.rawUrl,
          normalizedUrl: httpCall.normalizedUrl
        }
      });
    }
  }

  for (const route of options.frontBackGraph?.frontend.routes ?? []) {
    const tags = classifyCapabilityTags(route.capabilityTags ?? []);
    const channels = inferChannels([route.routePath, route.screenPath, route.screenCode, ...(route.notes ?? [])]);
    const fileId = `file:frontend:${route.screenPath}`;
    const routeId = `route:${route.routePath}:${route.screenPath}`;
    upsertEntity({
      id: routeId,
      type: "route",
      label: route.screenCode || route.routePath,
      summary: `${route.routePath} frontend route`,
      metadata: makeMetadata({
        ...tags,
        channels,
        confidence: 0.78,
        evidencePaths: [route.sourceFile, route.screenPath],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      }),
      attributes: {
        routePath: route.routePath,
        screenPath: route.screenPath,
        screenCode: route.screenCode ?? null,
        sourceFile: route.sourceFile,
        notes: route.notes ?? []
      }
    });
    upsertEdge({
      id: `edge:declares:${fileId}:${routeId}`,
      type: "declares",
      fromId: fileId,
      toId: routeId,
      label: "screen declares route",
      metadata: makeMetadata({
        ...tags,
        channels,
        confidence: 0.84,
        evidencePaths: [route.sourceFile, route.screenPath],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      }),
      attributes: {}
    });
  }

  for (const link of options.frontBackGraph?.links ?? []) {
    const tags = classifyCapabilityTags(link.capabilityTags ?? []);
    const channels = inferChannels([
      link.frontend.screenCode,
      link.frontend.screenPath,
      link.frontend.routePath,
      link.api.rawUrl,
      link.backend.path,
      link.backend.controllerMethod
    ]);
    const frontendFileId = `file:frontend:${link.frontend.screenPath}`;
    const routeId = link.frontend.routePath ? `route:${link.frontend.routePath}:${link.frontend.screenPath}` : undefined;
    const uiActionId = link.api.functionName
      ? `ui-action:${link.frontend.screenPath}:${slugify(link.api.functionName)}`
      : undefined;
    const backendPath = toForwardSlash(link.backend.filePath);
    const backendStructureEntry = options.structure?.entries?.[backendPath];
    const backendResourceHints = backendStructureEntry?.resources ?? {};
    const apiId = `api:${link.api.normalizedUrl}`;
    upsertEntity({
      id: apiId,
      type: "api",
      label: link.api.rawUrl || link.api.normalizedUrl,
      summary: `${link.api.normalizedUrl} API call`,
      metadata: makeMetadata({
        ...tags,
        channels,
        confidence: link.confidence,
        evidencePaths: [link.frontend.screenPath, link.backend.filePath],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      }),
      attributes: {
        rawUrl: link.api.rawUrl,
        normalizedUrl: link.api.normalizedUrl,
        method: link.api.method ?? null,
        functionName: link.api.functionName ?? null,
        callSource: link.api.source
      }
    });
    if (routeId) {
      upsertEdge({
        id: `edge:routes-to:${routeId}:${apiId}`,
        type: "routes-to",
        fromId: routeId,
        toId: apiId,
        label: "frontend route issues API call",
        metadata: makeMetadata({
          ...tags,
          channels,
          confidence: link.confidence,
          evidencePaths: [link.frontend.screenPath],
          sourceType: "front-back-graph",
          validatedStatus: "derived"
        }),
        attributes: {
          source: link.api.source
        }
      });
    } else {
      upsertEdge({
        id: `edge:routes-to:${frontendFileId}:${apiId}`,
        type: "routes-to",
        fromId: frontendFileId,
        toId: apiId,
        label: "frontend screen issues API call",
        metadata: makeMetadata({
          ...tags,
          channels,
          confidence: link.confidence,
          evidencePaths: [link.frontend.screenPath],
          sourceType: "front-back-graph",
          validatedStatus: "derived"
        }),
        attributes: {
          source: link.api.source
        }
      });
    }
    if (uiActionId && entities.has(uiActionId)) {
      upsertEdge({
        id: `edge:calls:${uiActionId}:${apiId}`,
        type: "calls",
        fromId: uiActionId,
        toId: apiId,
        label: "UI action calls API",
        metadata: makeMetadata({
          ...tags,
          channels,
          moduleRoles: inferFrontendActionRoles(link.api.functionName),
          confidence: link.confidence,
          evidencePaths: [link.frontend.screenPath],
          sourceType: "front-back-graph",
          validatedStatus: "derived"
        }),
        attributes: {
          source: link.api.source,
          method: link.api.method ?? null
        }
      });
      addTransitionEdge({
        fromId: uiActionId,
        toId: apiId,
        fromTexts: [link.api.functionName, link.frontend.screenPath, link.frontend.routePath],
        toTexts: [link.api.normalizedUrl, link.api.rawUrl, link.backend.path, link.backend.controllerMethod],
        evidencePaths: [link.frontend.screenPath, backendPath],
        confidence: link.confidence
      });
    }

    let gatewayHandlerId: string | undefined;
    const gatewayControllerMethod = link.gateway.controllerMethod?.trim();
    if (gatewayControllerMethod) {
      const gatewayRoute = (options.frontBackGraph?.backend.gatewayRoutes ?? []).find(
        (entry) =>
          `${entry.controllerClass}.${entry.controllerMethod}` === gatewayControllerMethod &&
          (!link.gateway.path || entry.path === link.gateway.path)
      );
      gatewayHandlerId = `gateway-handler:${gatewayControllerMethod}`;
      const gatewayFilePath = gatewayRoute ? toForwardSlash(gatewayRoute.filePath) : undefined;
      const gatewayModuleName = extractModuleName(gatewayFilePath ?? "dcp-gateway", backendWorkspaceBase);
      const gatewayModuleId = ensureModule(gatewayModuleName, "front-back-graph", gatewayFilePath ?? "dcp-gateway");
      if (gatewayFilePath) {
        const gatewayFileId = `file:backend:${gatewayFilePath}`;
        upsertEntity({
          id: gatewayFileId,
          type: "file",
          label: basenameLabel(gatewayFilePath),
          summary: `gateway file ${gatewayFilePath}`,
          metadata: makeMetadata({
            ...tags,
            channels,
            moduleRoles: inferModuleRoles(gatewayModuleName),
            processRoles: inferProcessRoles(gatewayModuleName),
            confidence: Math.max(0.74, link.confidence),
            evidencePaths: [gatewayFilePath],
            sourceType: "front-back-graph",
            validatedStatus: "derived"
          }),
          attributes: {
            path: gatewayFilePath,
            moduleName: gatewayModuleName
          }
        });
        upsertEdge({
          id: `edge:contains:${gatewayModuleId}:${gatewayFileId}`,
          type: "contains",
          fromId: gatewayModuleId,
          toId: gatewayFileId,
          label: "module contains gateway file",
          metadata: makeMetadata({
            ...tags,
            channels,
            confidence: Math.max(0.78, link.confidence),
            evidencePaths: [gatewayFilePath],
            sourceType: "front-back-graph",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
        upsertEntity({
          id: gatewayHandlerId,
          type: "gateway-handler",
          label: gatewayControllerMethod,
          summary: `${link.gateway.path ?? "/api/**"} gateway handler`,
          metadata: makeMetadata({
            ...tags,
            channels,
            moduleRoles: ["gateway-routing", ...inferModuleRoles(gatewayModuleName)],
            processRoles: inferProcessRoles(gatewayModuleName),
            confidence: Math.max(0.78, link.confidence),
            evidencePaths: [gatewayFilePath],
            sourceType: "front-back-graph",
            validatedStatus: "derived"
          }),
          attributes: {
            path: link.gateway.path ?? null,
            filePath: gatewayFilePath,
            controllerMethod: gatewayControllerMethod,
            controllerClass: gatewayControllerMethod.split(".")[0] ?? gatewayControllerMethod,
            moduleName: gatewayModuleName
          }
        });
      upsertEdge({
        id: `edge:declares:${gatewayFileId}:${gatewayHandlerId}`,
        type: "declares",
          fromId: gatewayFileId,
          toId: gatewayHandlerId,
          label: "gateway file declares gateway handler",
          metadata: makeMetadata({
            ...tags,
            channels,
            confidence: Math.max(0.8, link.confidence),
            evidencePaths: [gatewayFilePath],
            sourceType: "front-back-graph",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      } else {
        upsertEntity({
          id: gatewayHandlerId,
          type: "gateway-handler",
          label: gatewayControllerMethod,
          summary: `${link.gateway.path ?? "/api/**"} gateway handler`,
          metadata: makeMetadata({
            ...tags,
            channels,
            moduleRoles: ["gateway-routing"],
            confidence: Math.max(0.72, link.confidence),
            evidencePaths: [],
            sourceType: "front-back-graph",
            validatedStatus: "derived"
          }),
          attributes: {
            path: link.gateway.path ?? null,
            filePath: null,
            controllerMethod: gatewayControllerMethod,
            controllerClass: gatewayControllerMethod.split(".")[0] ?? gatewayControllerMethod,
            moduleName: "dcp-gateway"
          }
        });
      }

      const gatewayMethodSymbolId = methodSymbolMap.get(gatewayControllerMethod);
      if (gatewayMethodSymbolId) {
        upsertEdge({
          id: `edge:maps-to:${gatewayHandlerId}:${gatewayMethodSymbolId}`,
          type: "maps-to",
          fromId: gatewayHandlerId,
          toId: gatewayMethodSymbolId,
          label: "gateway handler maps to method symbol",
          metadata: makeMetadata({
            ...tags,
            channels,
            confidence: Math.max(0.78, link.confidence),
            evidencePaths: unique([gatewayRoute?.filePath ?? "", backendPath]),
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      }

      upsertEdge({
        id: `edge:routes-to:${apiId}:${gatewayHandlerId}`,
        type: "routes-to",
        fromId: apiId,
        toId: gatewayHandlerId,
        label: "API routed through gateway handler",
        metadata: makeMetadata({
          ...tags,
          channels,
          confidence: link.confidence,
          evidencePaths: unique([(options.frontBackGraph?.backend.gatewayRoutes ?? [])
            .find((entry) => `${entry.controllerClass}.${entry.controllerMethod}` === gatewayControllerMethod)?.filePath ?? "", backendPath]),
          sourceType: "front-back-graph",
          validatedStatus: "derived"
        }),
        attributes: {
          gatewayPath: link.gateway.path ?? null
        }
      });
      addTransitionEdge({
        fromId: apiId,
        toId: gatewayHandlerId,
        fromTexts: [link.api.normalizedUrl, link.api.rawUrl, link.api.functionName],
        toTexts: [gatewayControllerMethod, link.gateway.path, gatewayRoute?.filePath],
        evidencePaths: [gatewayRoute?.filePath, backendPath],
        confidence: link.confidence
      });
    }

    const backendModuleName = extractModuleName(backendPath, backendWorkspaceBase);
    const backendModuleId = ensureModule(backendModuleName, "front-back-graph", backendPath);
    const backendFileId = `file:backend:${backendPath}`;
    upsertEntity({
      id: backendFileId,
      type: "file",
      label: basenameLabel(backendPath),
      summary: `backend file ${backendPath}`,
      metadata: makeMetadata({
        ...tags,
        channels,
        moduleRoles: inferModuleRoles(backendModuleName),
        processRoles: inferProcessRoles(backendModuleName),
        confidence: link.confidence,
        evidencePaths: [backendPath],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      }),
      attributes: {
        path: backendPath,
        moduleName: backendModuleName
      }
    });
    upsertEdge({
      id: `edge:contains:${backendModuleId}:${backendFileId}`,
      type: "contains",
      fromId: backendModuleId,
      toId: backendFileId,
      label: "module contains backend file",
      metadata: makeMetadata({
        ...tags,
        channels,
        confidence: Math.max(0.75, link.confidence),
        evidencePaths: [backendPath],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      }),
      attributes: {}
    });

    const controllerId = `controller:${link.backend.controllerMethod}`;
    upsertEntity({
      id: controllerId,
      type: "controller",
      label: link.backend.controllerMethod,
      summary: `${link.backend.path} backend controller method`,
      metadata: makeMetadata({
        ...tags,
        channels,
        moduleRoles: inferModuleRoles(backendModuleName),
        processRoles: inferProcessRoles(backendModuleName),
        confidence: link.confidence,
        evidencePaths: [backendPath],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      }),
      attributes: {
        path: link.backend.path,
        filePath: backendPath,
        controllerMethod: link.backend.controllerMethod,
        controllerClass: link.backend.controllerMethod.split(".")[0] ?? link.backend.controllerMethod,
        moduleName: backendModuleName
      }
    });
    upsertEdge({
      id: `edge:declares:${backendFileId}:${controllerId}`,
      type: "declares",
      fromId: backendFileId,
      toId: controllerId,
      label: "backend file declares controller",
      metadata: makeMetadata({
        ...tags,
        channels,
        confidence: Math.max(0.75, link.confidence),
        evidencePaths: [backendPath],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      }),
      attributes: {}
    });
    upsertEdge({
      id: gatewayHandlerId
        ? `edge:proxies-to:${gatewayHandlerId}:${controllerId}`
        : `edge:routes-to:${apiId}:${controllerId}`,
      type: gatewayHandlerId ? "proxies-to" : "routes-to",
      fromId: gatewayHandlerId ?? apiId,
      toId: controllerId,
      label: gatewayHandlerId ? "gateway handler proxies to backend controller" : "API routed to backend controller",
      metadata: makeMetadata({
        ...tags,
        channels,
        confidence: link.confidence,
        evidencePaths: [backendPath],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      }),
      attributes: {
        backendPath: link.backend.path,
        gatewayMethod: link.gateway.controllerMethod ?? null
      }
    });
    addTransitionEdge({
      fromId: gatewayHandlerId ?? apiId,
      toId: controllerId,
      fromTexts: [gatewayControllerMethod, link.gateway.path, link.api.normalizedUrl],
      toTexts: [link.backend.controllerMethod, link.backend.path, backendPath],
      evidencePaths: [backendPath],
      confidence: link.confidence
    });

    const controllerMethodSymbolId = methodSymbolMap.get(link.backend.controllerMethod);
    if (controllerMethodSymbolId) {
      upsertEdge({
        id: `edge:maps-to:${controllerId}:${controllerMethodSymbolId}`,
        type: "maps-to",
        fromId: controllerId,
        toId: controllerMethodSymbolId,
        label: "controller maps to method symbol",
        metadata: makeMetadata({
          ...tags,
          channels,
          confidence: Math.max(0.78, link.confidence),
          evidencePaths: [backendPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {}
      });
    }

    for (const requestModelName of unique(backendResourceHints.requestModelNames ?? [])) {
      const requestContractId = ensureDataContract({
        label: requestModelName,
        direction: "request",
        evidencePath: backendPath,
        moduleName: backendModuleName
      });
      if (uiActionId) {
        upsertEdge({
          id: `edge:emits-contract:${uiActionId}:${requestContractId}`,
          type: "emits-contract",
          fromId: uiActionId,
          toId: requestContractId,
          label: "UI action emits request contract",
          metadata: makeMetadata({
            ...tags,
            channels,
            actions: inferActionsFromTexts(link.api.functionName, requestModelName, "request input payload"),
            moduleRoles: ["data-contract"],
            confidence: Math.max(0.72, link.confidence),
            evidencePaths: [link.frontend.screenPath, backendPath].filter(Boolean) as string[],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {
            direction: "request"
          }
        });
      }
      upsertEdge({
        id: `edge:accepts-contract:${apiId}:${requestContractId}`,
        type: "accepts-contract",
        fromId: apiId,
        toId: requestContractId,
        label: "API accepts request contract",
        metadata: makeMetadata({
          ...tags,
          channels,
          actions: inferActionsFromTexts(link.api.normalizedUrl, requestModelName, "request input payload"),
          moduleRoles: ["data-contract"],
          confidence: Math.max(0.74, link.confidence),
          evidencePaths: [backendPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {
          direction: "request"
        }
      });
      upsertEdge({
        id: `edge:accepts-contract:${controllerId}:${requestContractId}`,
        type: "accepts-contract",
        fromId: controllerId,
        toId: requestContractId,
        label: "controller accepts request contract",
        metadata: makeMetadata({
          ...tags,
          channels,
          actions: inferActionsFromTexts(link.backend.controllerMethod, requestModelName, "request input payload"),
          moduleRoles: ["data-contract"],
          confidence: Math.max(0.76, link.confidence),
          evidencePaths: [backendPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {
          direction: "request"
        }
      });
    }

    for (const responseModelName of unique(backendResourceHints.responseModelNames ?? [])) {
      const responseContractId = ensureDataContract({
        label: responseModelName,
        direction: "response",
        evidencePath: backendPath,
        moduleName: backendModuleName
      });
      if (uiActionId) {
        upsertEdge({
          id: `edge:receives-contract:${uiActionId}:${responseContractId}`,
          type: "receives-contract",
          fromId: uiActionId,
          toId: responseContractId,
          label: "UI action receives response contract",
          metadata: makeMetadata({
            ...tags,
            channels,
            actions: inferActionsFromTexts(link.api.functionName, responseModelName, "response output result payload"),
            moduleRoles: ["data-contract"],
            confidence: Math.max(0.72, link.confidence),
            evidencePaths: [link.frontend.screenPath, backendPath].filter(Boolean) as string[],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {
            direction: "response"
          }
        });
      }
      upsertEdge({
        id: `edge:returns-contract:${apiId}:${responseContractId}`,
        type: "returns-contract",
        fromId: apiId,
        toId: responseContractId,
        label: "API returns response contract",
        metadata: makeMetadata({
          ...tags,
          channels,
          actions: inferActionsFromTexts(link.api.normalizedUrl, responseModelName, "response output result payload"),
          moduleRoles: ["data-contract"],
          confidence: Math.max(0.74, link.confidence),
          evidencePaths: [backendPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {
          direction: "response"
        }
      });
      upsertEdge({
        id: `edge:returns-contract:${controllerId}:${responseContractId}`,
        type: "returns-contract",
        fromId: controllerId,
        toId: responseContractId,
        label: "controller returns response contract",
        metadata: makeMetadata({
          ...tags,
          channels,
          actions: inferActionsFromTexts(link.backend.controllerMethod, responseModelName, "response output result payload"),
          moduleRoles: ["data-contract"],
          confidence: Math.max(0.76, link.confidence),
          evidencePaths: [backendPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {
          direction: "response"
        }
      });
    }

    for (const decisionPathName of unique(backendResourceHints.decisionPathNames ?? [])) {
      const [ownerCandidate, ...labelParts] = decisionPathName.split("::");
      const decisionLabel = (labelParts.length > 0 ? labelParts.join("::") : ownerCandidate).trim();
      const ownerName = labelParts.length > 0 ? ownerCandidate.trim() : undefined;
      const controllerMethodName = link.backend.controllerMethod.split(".")[1] ?? link.backend.controllerMethod;
      if (ownerName && ownerName !== controllerMethodName) {
        continue;
      }
      const decisionId = ensureDecisionPath({
        label: decisionLabel,
        ownerName,
        evidencePath: backendPath,
        moduleName: backendModuleName
      });
      upsertEdge({
        id: `edge:branches-to:${controllerId}:${decisionId}`,
        type: "branches-to",
        fromId: controllerId,
        toId: decisionId,
        label: "controller branches through decision path",
        metadata: makeMetadata({
          ...tags,
          channels,
          actions: inferActionsFromTexts(link.backend.controllerMethod, decisionLabel, "decision branch if switch"),
          moduleRoles: ["decision-control"],
          confidence: Math.max(0.76, link.confidence),
          evidencePaths: [backendPath],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {}
      });
    }

    for (const serviceHint of link.backend.serviceHints) {
      const serviceClass = serviceHint.split(".")[0] ?? serviceHint;
      const serviceFilePath = classFileMap.get(serviceClass);
      const serviceModuleName = extractModuleName(serviceFilePath ?? backendPath, backendWorkspaceBase);
      const serviceStructureEntry = serviceFilePath ? options.structure?.entries?.[serviceFilePath] : undefined;
      const serviceResourceHints = serviceStructureEntry?.resources ?? {};
      if (serviceFilePath) {
        const serviceModuleId = ensureModule(serviceModuleName, "derived", serviceFilePath);
        const serviceFileId = `file:backend:${serviceFilePath}`;
        upsertEntity({
          id: serviceFileId,
          type: "file",
          label: basenameLabel(serviceFilePath),
          summary: `backend file ${serviceFilePath}`,
          metadata: makeMetadata({
            ...tags,
            channels,
            moduleRoles: inferModuleRoles(serviceModuleName),
            processRoles: inferProcessRoles(serviceModuleName),
            confidence: link.confidence,
            evidencePaths: [serviceFilePath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {
            path: serviceFilePath,
            moduleName: serviceModuleName
          }
        });
        upsertEdge({
          id: `edge:contains:${serviceModuleId}:${serviceFileId}`,
          type: "contains",
          fromId: serviceModuleId,
          toId: serviceFileId,
          label: "module contains service file",
          metadata: makeMetadata({
            ...tags,
            channels,
            confidence: Math.max(0.74, link.confidence),
            evidencePaths: [serviceFilePath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      }

      const serviceId = `service:${serviceHint}`;
      upsertEntity({
        id: serviceId,
        type: "service",
        label: serviceHint,
        summary: `${serviceHint} service call`,
        metadata: makeMetadata({
          ...tags,
          channels,
          moduleRoles: inferModuleRoles(serviceModuleName),
          processRoles: inferProcessRoles(serviceModuleName),
          confidence: Math.max(0.68, link.confidence),
          evidencePaths: unique([serviceFilePath ?? "", backendPath]),
          sourceType: serviceFilePath ? "derived" : "front-back-graph",
          validatedStatus: "derived"
        }),
        attributes: {
          serviceHint,
          serviceClass,
          serviceMethod: serviceHint.split(".")[1] ?? null,
          filePath: serviceFilePath ?? null,
          moduleName: serviceModuleName
        }
      });
      if (serviceFilePath) {
        upsertEdge({
          id: `edge:declares:file:backend:${serviceFilePath}:${serviceId}`,
          type: "declares",
          fromId: `file:backend:${serviceFilePath}`,
          toId: serviceId,
          label: "service file declares service method",
          metadata: makeMetadata({
            ...tags,
            channels,
            confidence: Math.max(0.72, link.confidence),
            evidencePaths: [serviceFilePath],
            sourceType: "derived",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      }
      upsertEdge({
        id: `edge:calls:${controllerId}:${serviceId}`,
        type: "calls",
        fromId: controllerId,
        toId: serviceId,
        label: "controller calls service",
        metadata: makeMetadata({
          ...tags,
          channels,
          confidence: Math.max(0.7, link.confidence),
          evidencePaths: unique([backendPath, serviceFilePath ?? ""]),
          sourceType: serviceFilePath ? "derived" : "front-back-graph",
          validatedStatus: "derived"
        }),
        attributes: {}
      });
      addTransitionEdge({
        fromId: controllerId,
        toId: serviceId,
        fromTexts: [link.backend.controllerMethod, link.backend.path, backendPath],
        toTexts: [serviceHint, serviceFilePath, serviceStructureEntry?.summary],
        evidencePaths: [backendPath, serviceFilePath],
        confidence: link.confidence
      });

      const serviceMethodSymbolId = methodSymbolMap.get(serviceHint);
      if (serviceMethodSymbolId) {
        upsertEdge({
          id: `edge:maps-to:${serviceId}:${serviceMethodSymbolId}`,
          type: "maps-to",
          fromId: serviceId,
          toId: serviceMethodSymbolId,
          label: "service maps to method symbol",
          metadata: makeMetadata({
            ...tags,
            channels,
            confidence: Math.max(0.76, link.confidence),
            evidencePaths: unique([serviceFilePath ?? "", backendPath]),
            sourceType: serviceFilePath ? "derived" : "front-back-graph",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      }

      for (const decisionPathName of unique(serviceResourceHints.decisionPathNames ?? [])) {
        const [ownerCandidate, ...labelParts] = decisionPathName.split("::");
        const decisionLabel = (labelParts.length > 0 ? labelParts.join("::") : ownerCandidate).trim();
        const ownerName = labelParts.length > 0 ? ownerCandidate.trim() : undefined;
        const serviceMethodName = serviceHint.split(".")[1] ?? serviceHint;
        if (ownerName && ownerName !== serviceMethodName) {
          continue;
        }
        const decisionId = ensureDecisionPath({
          label: decisionLabel,
          ownerName,
          evidencePath: serviceFilePath ?? backendPath,
          moduleName: serviceModuleName
        });
        upsertEdge({
          id: `edge:branches-to:${serviceId}:${decisionId}`,
          type: "branches-to",
          fromId: serviceId,
          toId: decisionId,
          label: "service branches through decision path",
          metadata: makeMetadata({
            ...tags,
            channels,
            actions: inferActionsFromTexts(serviceHint, decisionLabel, "decision branch if switch"),
            moduleRoles: ["decision-control"],
            confidence: Math.max(0.74, link.confidence),
            evidencePaths: unique([serviceFilePath ?? "", backendPath]),
            sourceType: serviceFilePath ? "derived" : "front-back-graph",
            validatedStatus: "derived"
          }),
          attributes: {}
        });
      }
    }
  }

  for (const entry of options.eaiEntries ?? []) {
    const eaiId = `eai:${entry.interfaceId}`;
    upsertEntity({
      id: eaiId,
      type: "eai-interface",
      label: `${entry.interfaceId} ${entry.interfaceName}`.trim(),
      summary: entry.purpose,
      metadata: makeMetadata({
        confidence: 0.9,
        evidencePaths: [entry.sourcePath, ...entry.envPaths],
        sourceType: "eai-dictionary",
        validatedStatus: "validated"
      }),
      attributes: {
        interfaceId: entry.interfaceId,
        interfaceName: entry.interfaceName,
        sourcePath: entry.sourcePath,
        reqSystemIds: entry.reqSystemIds,
        respSystemId: entry.respSystemId ?? null,
        serviceId: entry.serviceId ?? null,
        targetType: entry.targetType ?? null
      }
    });

    for (const usagePath of unique([...entry.usagePaths, ...entry.moduleUsagePaths])) {
      const normalizedPath = toForwardSlash(usagePath);
      const moduleName = extractModuleName(normalizedPath, backendWorkspaceBase);
      const moduleId = ensureModule(moduleName, "eai-dictionary", normalizedPath);
      const fileId = `file:backend:${normalizedPath}`;
      upsertEntity({
        id: fileId,
        type: "file",
        label: basenameLabel(normalizedPath),
        summary: `EAI usage file ${normalizedPath}`,
        metadata: makeMetadata({
          moduleRoles: inferModuleRoles(moduleName),
          processRoles: inferProcessRoles(moduleName),
          confidence: 0.62,
          evidencePaths: [normalizedPath],
          sourceType: "eai-dictionary",
          validatedStatus: "validated"
        }),
        attributes: {
          path: normalizedPath,
          moduleName
        }
      });
      upsertEdge({
        id: `edge:contains:${moduleId}:${fileId}`,
        type: "contains",
        fromId: moduleId,
        toId: fileId,
        label: "module contains EAI usage file",
        metadata: makeMetadata({
          confidence: 0.72,
          evidencePaths: [normalizedPath],
          sourceType: "eai-dictionary",
          validatedStatus: "validated"
        }),
        attributes: {}
      });
      upsertEdge({
        id: `edge:uses-eai:${fileId}:${eaiId}`,
        type: "uses-eai",
        fromId: fileId,
        toId: eaiId,
        label: "file uses EAI interface",
        metadata: makeMetadata({
          confidence: 0.6,
          evidencePaths: [normalizedPath, entry.sourcePath],
          sourceType: "eai-dictionary",
          validatedStatus: "validated"
        }),
        attributes: {}
      });
    }

    for (const site of entry.javaCallSites) {
      const normalizedPath = toForwardSlash(site.path);
      const moduleName = extractModuleName(normalizedPath, backendWorkspaceBase);
      ensureModule(moduleName, "eai-dictionary", normalizedPath);
      const fileId = `file:backend:${normalizedPath}`;
      upsertEntity({
        id: fileId,
        type: "file",
        label: basenameLabel(normalizedPath),
        summary: `EAI call site file ${normalizedPath}`,
        metadata: makeMetadata({
          moduleRoles: inferModuleRoles(moduleName),
          processRoles: inferProcessRoles(moduleName),
          confidence: 0.65,
          evidencePaths: [normalizedPath],
          sourceType: "eai-dictionary",
          validatedStatus: site.direct ? "validated" : "derived"
        }),
        attributes: {
          path: normalizedPath,
          moduleName
        }
      });

      const serviceLike = Boolean(site.className && /(Service|Manager|Support|Client|Dao|Mapper|Repository)$/i.test(site.className));
      const nodeId = site.className && site.methodName && serviceLike
        ? `service:${site.className}.${site.methodName}`
        : `symbol:method:${site.className ?? basenameLabel(normalizedPath)}.${site.methodName ?? "unknown"}:${normalizedPath}`;
      const nodeType: KnowledgeEntityType = site.className && site.methodName && serviceLike ? "service" : "symbol";
      upsertEntity({
        id: nodeId,
        type: nodeType,
        label: site.className && site.methodName ? `${site.className}.${site.methodName}` : `${site.className ?? basenameLabel(normalizedPath)}.${site.methodName ?? "unknown"}`,
        summary: `${entry.interfaceId} call site`,
        metadata: makeMetadata({
          moduleRoles: inferModuleRoles(moduleName),
          processRoles: inferProcessRoles(moduleName),
          confidence: site.direct ? 0.86 : 0.68,
          evidencePaths: [normalizedPath, entry.sourcePath],
          sourceType: "eai-dictionary",
          validatedStatus: site.direct ? "validated" : "derived"
        }),
        attributes: {
          path: normalizedPath,
          className: site.className ?? null,
          methodName: site.methodName ?? null,
          direct: site.direct,
          moduleName,
          interfaceId: entry.interfaceId
        }
      });
      upsertEdge({
        id: `edge:declares:${fileId}:${nodeId}`,
        type: "declares",
        fromId: fileId,
        toId: nodeId,
        label: "file declares EAI call site",
        metadata: makeMetadata({
          confidence: site.direct ? 0.82 : 0.65,
          evidencePaths: [normalizedPath],
          sourceType: "eai-dictionary",
          validatedStatus: site.direct ? "validated" : "derived"
        }),
        attributes: {}
      });
      upsertEdge({
        id: `edge:uses-eai:${nodeId}:${eaiId}`,
        type: "uses-eai",
        fromId: nodeId,
        toId: eaiId,
        label: site.direct ? "direct EAI call" : "indirect EAI call",
        metadata: makeMetadata({
          confidence: site.direct ? 0.92 : 0.72,
          evidencePaths: [normalizedPath, entry.sourcePath],
          sourceType: "eai-dictionary",
          validatedStatus: site.direct ? "validated" : "derived"
        }),
        attributes: {
          direct: site.direct
        }
      });
    }
  }

  const mappedSupportEdgeTypes: KnowledgeEdgeType[] = [
    "emits-contract",
    "receives-contract",
    "accepts-contract",
    "returns-contract",
    "uses-store",
    "dispatches-to",
    "consumes-from",
    "uses-eai",
    "uses-cache-key",
    "stores-model",
    "maps-to-table",
    "queries-table",
    "validates",
    "branches-to"
  ];
  const outgoingEdgesById = new Map<string, KnowledgeEdge[]>();
  for (const edge of edges.values()) {
    const bucket = outgoingEdgesById.get(edge.fromId) ?? [];
    bucket.push(edge);
    outgoingEdgesById.set(edge.fromId, bucket);
  }
  for (const mapsToEdge of Array.from(edges.values()).filter((edge) => edge.type === "maps-to")) {
    const sourceEntity = entities.get(mapsToEdge.fromId);
    const mappedEntity = entities.get(mapsToEdge.toId);
    if (!sourceEntity || !mappedEntity) {
      continue;
    }
    const mappedSupportEdges = (outgoingEdgesById.get(mappedEntity.id) ?? []).filter((edge) =>
      mappedSupportEdgeTypes.includes(edge.type)
    );
    for (const supportEdge of mappedSupportEdges) {
      if (hasEdge(supportEdge.type, sourceEntity.id, supportEdge.toId)) {
        continue;
      }
      upsertEdge({
        id: `edge:${supportEdge.type}:${sourceEntity.id}:${supportEdge.toId}:mapped`,
        type: supportEdge.type,
        fromId: sourceEntity.id,
        toId: supportEdge.toId,
        label: `${sourceEntity.type} inherits mapped ${supportEdge.type}`,
        metadata: makeMetadata({
          domains: [
            ...sourceEntity.metadata.domains,
            ...mapsToEdge.metadata.domains,
            ...supportEdge.metadata.domains
          ],
          subdomains: [
            ...sourceEntity.metadata.subdomains,
            ...mapsToEdge.metadata.subdomains,
            ...supportEdge.metadata.subdomains
          ],
          channels: [
            ...sourceEntity.metadata.channels,
            ...mapsToEdge.metadata.channels,
            ...supportEdge.metadata.channels
          ],
          actions: [
            ...sourceEntity.metadata.actions,
            ...mapsToEdge.metadata.actions,
            ...supportEdge.metadata.actions
          ],
          moduleRoles: [
            ...sourceEntity.metadata.moduleRoles,
            ...mapsToEdge.metadata.moduleRoles,
            ...supportEdge.metadata.moduleRoles
          ],
          processRoles: [
            ...sourceEntity.metadata.processRoles,
            ...mapsToEdge.metadata.processRoles,
            ...supportEdge.metadata.processRoles
          ],
          confidence: Math.max(
            0.7,
            Math.min(
              0.92,
              Math.max(sourceEntity.metadata.confidence, mapsToEdge.metadata.confidence, supportEdge.metadata.confidence) - 0.04
            )
          ),
          evidencePaths: [
            ...sourceEntity.metadata.evidencePaths,
            ...mapsToEdge.metadata.evidencePaths,
            ...supportEdge.metadata.evidencePaths
          ],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {
          propagatedFrom: mappedEntity.id,
          viaEdgeId: supportEdge.id,
          viaType: "maps-to"
        }
      });
    }
  }

  const fileSupportEdgeTypes: KnowledgeEdgeType[] = [
    "uses-store",
    "dispatches-to",
    "consumes-from",
    "uses-eai",
    "uses-cache-key",
    "stores-model",
    "maps-to-table",
    "queries-table",
    "validates",
    "branches-to"
  ];
  for (const declaresEdge of Array.from(edges.values()).filter((edge) => edge.type === "declares")) {
    const sourceEntity = entities.get(declaresEdge.fromId);
    const declaredEntity = entities.get(declaresEdge.toId);
    if (!sourceEntity || sourceEntity.type !== "file" || !declaredEntity) {
      continue;
    }
    const fileSupportEdges = (outgoingEdgesById.get(sourceEntity.id) ?? []).filter((edge) =>
      fileSupportEdgeTypes.includes(edge.type)
    );
    for (const supportEdge of fileSupportEdges) {
      if (hasEdge(supportEdge.type, declaredEntity.id, supportEdge.toId)) {
        continue;
      }
      upsertEdge({
        id: `edge:${supportEdge.type}:${declaredEntity.id}:${supportEdge.toId}:declared-file`,
        type: supportEdge.type,
        fromId: declaredEntity.id,
        toId: supportEdge.toId,
        label: `${declaredEntity.type} inherits file ${supportEdge.type}`,
        metadata: makeMetadata({
          domains: [
            ...sourceEntity.metadata.domains,
            ...declaredEntity.metadata.domains,
            ...declaresEdge.metadata.domains,
            ...supportEdge.metadata.domains
          ],
          subdomains: [
            ...sourceEntity.metadata.subdomains,
            ...declaredEntity.metadata.subdomains,
            ...declaresEdge.metadata.subdomains,
            ...supportEdge.metadata.subdomains
          ],
          channels: [
            ...sourceEntity.metadata.channels,
            ...declaredEntity.metadata.channels,
            ...declaresEdge.metadata.channels,
            ...supportEdge.metadata.channels
          ],
          actions: [
            ...sourceEntity.metadata.actions,
            ...declaredEntity.metadata.actions,
            ...declaresEdge.metadata.actions,
            ...supportEdge.metadata.actions
          ],
          moduleRoles: [
            ...sourceEntity.metadata.moduleRoles,
            ...declaredEntity.metadata.moduleRoles,
            ...declaresEdge.metadata.moduleRoles,
            ...supportEdge.metadata.moduleRoles
          ],
          processRoles: [
            ...sourceEntity.metadata.processRoles,
            ...declaredEntity.metadata.processRoles,
            ...declaresEdge.metadata.processRoles,
            ...supportEdge.metadata.processRoles
          ],
          confidence: Math.max(
            0.68,
            Math.min(
              0.9,
              Math.max(
                sourceEntity.metadata.confidence,
                declaredEntity.metadata.confidence,
                declaresEdge.metadata.confidence,
                supportEdge.metadata.confidence
              ) - 0.05
            )
          ),
          evidencePaths: [
            ...sourceEntity.metadata.evidencePaths,
            ...declaredEntity.metadata.evidencePaths,
            ...declaresEdge.metadata.evidencePaths,
            ...supportEdge.metadata.evidencePaths
          ],
          sourceType: "derived",
          validatedStatus: "derived"
        }),
        attributes: {
          propagatedFrom: sourceEntity.id,
          viaEdgeId: supportEdge.id,
          viaType: "declares"
        }
      });
    }
  }

  const declaresEdges = Array.from(edges.values()).filter((edge) => edge.type === "declares");
  const declaredEdgesByFile = new Map<string, KnowledgeEdge[]>();
  for (const declaresEdge of declaresEdges) {
    const bucket = declaredEdgesByFile.get(declaresEdge.fromId) ?? [];
    bucket.push(declaresEdge);
    declaredEdgesByFile.set(declaresEdge.fromId, bucket);
  }
  for (const [fileId, fileDeclares] of declaredEdgesByFile.entries()) {
    const fileEntity = entities.get(fileId);
    if (!fileEntity || fileEntity.type !== "file") {
      continue;
    }
    const runtimeEntities = fileDeclares
      .map((edge) => entities.get(edge.toId))
      .filter(
        (entity): entity is KnowledgeEntity =>
          entity != null &&
          ["controller", "service", "gateway-handler", "symbol"].includes(entity.type)
      );
    const queryEntities = fileDeclares
      .map((edge) => entities.get(edge.toId))
      .filter((entity): entity is KnowledgeEntity => entity != null && entity.type === "data-query");
    if (runtimeEntities.length === 0 || queryEntities.length === 0) {
      continue;
    }
    for (const runtimeEntity of runtimeEntities) {
      for (const queryEntity of queryEntities) {
        addDerivedTransitionEdge({
          fromId: runtimeEntity.id,
          toId: queryEntity.id,
          label: "data query transition",
          texts: [
            runtimeEntity.label,
            runtimeEntity.summary,
            queryEntity.label,
            queryEntity.summary,
            fileEntity.label
          ],
          evidencePaths: [
            ...runtimeEntity.metadata.evidencePaths,
            ...queryEntity.metadata.evidencePaths,
            ...fileEntity.metadata.evidencePaths
          ],
          confidence: Math.max(runtimeEntity.metadata.confidence, queryEntity.metadata.confidence, fileEntity.metadata.confidence),
          edgeKind: "data-query"
        });
      }
    }
  }

  const queryTableEdges = Array.from(edges.values()).filter((edge) => edge.type === "queries-table");
  const queryNodesByTable = new Map<string, KnowledgeEntity[]>();
  const runtimeNodesByQueriedTable = new Map<string, KnowledgeEntity[]>();
  for (const queryTableEdge of queryTableEdges) {
    const fromEntity = entities.get(queryTableEdge.fromId);
    if (!fromEntity) {
      continue;
    }
    if (fromEntity.type === "data-query") {
      const bucket = queryNodesByTable.get(queryTableEdge.toId) ?? [];
      bucket.push(fromEntity);
      queryNodesByTable.set(queryTableEdge.toId, bucket);
      continue;
    }
    if (["controller", "service", "gateway-handler", "symbol"].includes(fromEntity.type)) {
      const bucket = runtimeNodesByQueriedTable.get(queryTableEdge.toId) ?? [];
      bucket.push(fromEntity);
      runtimeNodesByQueriedTable.set(queryTableEdge.toId, bucket);
    }
  }
  for (const [tableId, runtimeNodes] of runtimeNodesByQueriedTable.entries()) {
    const queryNodes = queryNodesByTable.get(tableId) ?? [];
    if (queryNodes.length === 0) {
      continue;
    }
    const tableEntity = entities.get(tableId);
    for (const runtimeEntity of runtimeNodes) {
      for (const queryEntity of queryNodes) {
        addDerivedTransitionEdge({
          fromId: runtimeEntity.id,
          toId: queryEntity.id,
          label: "data query transition",
          texts: [
            runtimeEntity.label,
            runtimeEntity.summary,
            queryEntity.label,
            queryEntity.summary,
            tableEntity?.label
          ],
          evidencePaths: [
            ...runtimeEntity.metadata.evidencePaths,
            ...queryEntity.metadata.evidencePaths,
            ...(tableEntity?.metadata.evidencePaths ?? [])
          ],
          confidence: Math.max(runtimeEntity.metadata.confidence, queryEntity.metadata.confidence, tableEntity?.metadata.confidence ?? 0),
          edgeKind: "data-query"
        });
      }
    }
  }

  const requestSourceContractsByNode = new Map<string, Set<string>>();
  const requestTargetContractsByNode = new Map<string, Set<string>>();
  const responseSourceContractsByNode = new Map<string, Set<string>>();
  const responseTargetContractsByNode = new Map<string, Set<string>>();
  const addContractForNode = (bucket: Map<string, Set<string>>, nodeId: string, contractId: string) => {
    const contracts = bucket.get(nodeId) ?? new Set<string>();
    contracts.add(contractId);
    bucket.set(nodeId, contracts);
  };
  for (const edge of edges.values()) {
    if (edge.type === "emits-contract") {
      addContractForNode(requestSourceContractsByNode, edge.fromId, edge.toId);
    } else if (edge.type === "accepts-contract") {
      addContractForNode(requestSourceContractsByNode, edge.fromId, edge.toId);
      addContractForNode(requestTargetContractsByNode, edge.fromId, edge.toId);
    } else if (edge.type === "returns-contract") {
      addContractForNode(responseSourceContractsByNode, edge.fromId, edge.toId);
      addContractForNode(responseTargetContractsByNode, edge.fromId, edge.toId);
    } else if (edge.type === "receives-contract") {
      addContractForNode(responseTargetContractsByNode, edge.fromId, edge.toId);
    }
  }

  const addContractPropagationEdge = (options: {
    fromId: string;
    toId: string;
    contractId: string;
    direction: "request" | "response";
    flowEdge: KnowledgeEdge;
  }) => {
    if (options.fromId === options.toId) {
      return;
    }
    const fromEntity = entities.get(options.fromId);
    const toEntity = entities.get(options.toId);
    const contractEntity = entities.get(options.contractId);
    if (!fromEntity || !toEntity || !contractEntity) {
      return;
    }
    upsertEdge({
      id: `edge:propagates-contract:${options.fromId}:${options.toId}:${options.contractId}:${options.direction}`,
      type: "propagates-contract",
      fromId: options.fromId,
      toId: options.toId,
      label: `${options.direction} contract propagation`,
      metadata: makeMetadata({
        domains: [
          ...fromEntity.metadata.domains,
          ...toEntity.metadata.domains,
          ...options.flowEdge.metadata.domains,
          ...contractEntity.metadata.domains
        ],
        subdomains: [
          ...fromEntity.metadata.subdomains,
          ...toEntity.metadata.subdomains,
          ...options.flowEdge.metadata.subdomains,
          ...contractEntity.metadata.subdomains
        ],
        channels: [
          ...fromEntity.metadata.channels,
          ...toEntity.metadata.channels,
          ...options.flowEdge.metadata.channels,
          ...contractEntity.metadata.channels
        ],
        actions: inferActionsFromTexts(
          fromEntity.label,
          toEntity.label,
          contractEntity.label,
          options.direction === "request" ? "request input payload propagation" : "response output payload propagation"
        ),
        moduleRoles: ["data-contract"],
        processRoles: ["contract-propagation"],
        confidence: Math.max(
          0.72,
          Math.min(
            0.9,
            Math.max(
              fromEntity.metadata.confidence,
              toEntity.metadata.confidence,
              options.flowEdge.metadata.confidence,
              contractEntity.metadata.confidence
            ) - 0.04
          )
        ),
        evidencePaths: unique([
          ...fromEntity.metadata.evidencePaths,
          ...toEntity.metadata.evidencePaths,
          ...options.flowEdge.metadata.evidencePaths,
          ...contractEntity.metadata.evidencePaths
        ]),
        sourceType: "derived",
        validatedStatus: "derived"
      }),
      attributes: {
        contractId: options.contractId,
        direction: options.direction,
        viaEdgeId: options.flowEdge.id,
        viaType: options.flowEdge.type
      }
    });
  };

  const forwardFlowTypes = new Set<KnowledgeEdgeType>(["calls", "routes-to", "proxies-to"]);
  for (const flowEdge of Array.from(edges.values()).filter((edge) => forwardFlowTypes.has(edge.type))) {
    const fromRequestContracts = requestSourceContractsByNode.get(flowEdge.fromId) ?? new Set<string>();
    const toRequestContracts = requestTargetContractsByNode.get(flowEdge.toId) ?? new Set<string>();
    for (const contractId of fromRequestContracts) {
      if (toRequestContracts.has(contractId)) {
        addContractPropagationEdge({
          fromId: flowEdge.fromId,
          toId: flowEdge.toId,
          contractId,
          direction: "request",
          flowEdge
        });
      }
    }

    const responseSourceContracts = responseSourceContractsByNode.get(flowEdge.toId) ?? new Set<string>();
    const responseTargetContracts = responseTargetContractsByNode.get(flowEdge.fromId) ?? new Set<string>();
    for (const contractId of responseSourceContracts) {
      if (responseTargetContracts.has(contractId)) {
        addContractPropagationEdge({
          fromId: flowEdge.toId,
          toId: flowEdge.fromId,
          contractId,
          direction: "response",
          flowEdge
        });
      }
    }
  }

  const asyncRequestContractsByChannel = new Map<string, Set<string>>();
  for (const asyncEdge of Array.from(edges.values()).filter((edge) => edge.type === "dispatches-to")) {
    const producerContracts = requestSourceContractsByNode.get(asyncEdge.fromId) ?? new Set<string>();
    for (const contractId of producerContracts) {
      addContractPropagationEdge({
        fromId: asyncEdge.fromId,
        toId: asyncEdge.toId,
        contractId,
        direction: "request",
        flowEdge: asyncEdge
      });
      addContractForNode(asyncRequestContractsByChannel, asyncEdge.toId, contractId);
    }
  }
  for (const asyncEdge of Array.from(edges.values()).filter((edge) => edge.type === "consumes-from")) {
    const consumerContracts = requestTargetContractsByNode.get(asyncEdge.fromId) ?? new Set<string>();
    const channelContracts = asyncRequestContractsByChannel.get(asyncEdge.toId) ?? new Set<string>();
    for (const contractId of consumerContracts) {
      if (!channelContracts.has(contractId)) {
        continue;
      }
      addContractPropagationEdge({
        fromId: asyncEdge.toId,
        toId: asyncEdge.fromId,
        contractId,
        direction: "request",
        flowEdge: asyncEdge
      });
    }
  }

  const requestCarrierContractsByNode = new Map<string, Set<string>>();
  const responseCarrierContractsByNode = new Map<string, Set<string>>();
  const seedCarrierContracts = (target: Map<string, Set<string>>, bucket: Map<string, Set<string>>) => {
    for (const [nodeId, contracts] of bucket.entries()) {
      for (const contractId of contracts) {
        addContractForNode(target, nodeId, contractId);
      }
    }
  };
  seedCarrierContracts(requestCarrierContractsByNode, requestSourceContractsByNode);
  seedCarrierContracts(requestCarrierContractsByNode, requestTargetContractsByNode);
  seedCarrierContracts(requestCarrierContractsByNode, asyncRequestContractsByChannel);
  seedCarrierContracts(responseCarrierContractsByNode, responseSourceContractsByNode);
  seedCarrierContracts(responseCarrierContractsByNode, responseTargetContractsByNode);

  const supportPropagationRules: Array<{
    edgeType: KnowledgeEdgeType;
    direction: "forward" | "reverse";
  }> = [
    { edgeType: "uses-store", direction: "forward" },
    { edgeType: "uses-cache-key", direction: "forward" },
    { edgeType: "stores-model", direction: "forward" },
    { edgeType: "maps-to-table", direction: "forward" },
    { edgeType: "queries-table", direction: "forward" },
    { edgeType: "uses-eai", direction: "forward" },
    { edgeType: "validates", direction: "forward" },
    { edgeType: "branches-to", direction: "forward" },
    { edgeType: "dispatches-to", direction: "forward" },
    { edgeType: "consumes-from", direction: "reverse" }
  ];
  const propagateCarrierContracts = (
    carrierContractsByNode: Map<string, Set<string>>,
    direction: "request" | "response"
  ) => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const rule of supportPropagationRules) {
        for (const supportEdge of Array.from(edges.values()).filter((edge) => edge.type === rule.edgeType)) {
          const fromId = rule.direction === "forward" ? supportEdge.fromId : supportEdge.toId;
          const toId = rule.direction === "forward" ? supportEdge.toId : supportEdge.fromId;
          const contracts = carrierContractsByNode.get(fromId) ?? new Set<string>();
          for (const contractId of contracts) {
            const knownContracts = carrierContractsByNode.get(toId) ?? new Set<string>();
            if (!knownContracts.has(contractId)) {
              addContractForNode(carrierContractsByNode, toId, contractId);
              changed = true;
            }
            addContractPropagationEdge({
              fromId,
              toId,
              contractId,
              direction,
              flowEdge: supportEdge
            });
          }
        }
      }
    }
  };

  propagateCarrierContracts(requestCarrierContractsByNode, "request");
  propagateCarrierContracts(responseCarrierContractsByNode, "response");

  const supportTransitionLabels: Partial<Record<KnowledgeEdgeType, string>> = {
    "uses-store": "state store transition",
    "uses-cache-key": "cache key transition",
    "stores-model": "data model transition",
    "maps-to-table": "table mapping transition",
    "queries-table": "table query transition",
    "uses-eai": "integration transition",
    "validates": "validation transition",
    "branches-to": "decision transition"
  };
  const supportTransitionEdgeTypes = new Set<KnowledgeEdgeType>([
    "uses-store",
    "uses-cache-key",
    "stores-model",
    "maps-to-table",
    "queries-table",
    "uses-eai",
    "validates",
    "branches-to"
  ]);
  for (const supportEdge of Array.from(edges.values()).filter((edge) => supportTransitionEdgeTypes.has(edge.type))) {
    addDerivedTransitionEdge({
      fromId: supportEdge.fromId,
      toId: supportEdge.toId,
      label: supportTransitionLabels[supportEdge.type] ?? "support transition",
      texts: [
        entities.get(supportEdge.fromId)?.label,
        entities.get(supportEdge.toId)?.label,
        supportEdge.label,
        supportEdge.type
      ],
      evidencePaths: supportEdge.metadata.evidencePaths,
      confidence: supportEdge.metadata.confidence,
      edgeKind: supportEdge.type
    });
  }

  const directSupportEdgeTypes = new Set<KnowledgeEdgeType>([
    "uses-store",
    "uses-cache-key",
    "stores-model",
    "maps-to-table",
    "queries-table",
    "uses-eai",
    "validates",
    "branches-to",
    "dispatches-to",
    "consumes-from"
  ]);
  const directSupportPairs = new Set<string>();
  for (const edge of edges.values()) {
    if (!directSupportEdgeTypes.has(edge.type)) {
      continue;
    }
    directSupportPairs.add(`${edge.fromId}:${edge.toId}`);
  }
  const transitionPropagationTargetTypes = new Set<KnowledgeEntityType>([
    "data-query",
    "data-model",
    "data-table",
    "data-store",
    "cache-key",
    "async-channel",
    "control-guard",
    "decision-path"
  ]);
  let transitionCarrierPropagationChanged = false;
  for (const transitionEdge of Array.from(edges.values()).filter((edge) => edge.type === "transitions-to")) {
    const targetEntity = entities.get(transitionEdge.toId);
    if (!targetEntity || !transitionPropagationTargetTypes.has(targetEntity.type)) {
      continue;
    }
    if (directSupportPairs.has(`${transitionEdge.fromId}:${transitionEdge.toId}`)) {
      continue;
    }

    const requestContracts = requestCarrierContractsByNode.get(transitionEdge.fromId) ?? new Set<string>();
    for (const contractId of requestContracts) {
      const knownContracts = requestCarrierContractsByNode.get(transitionEdge.toId) ?? new Set<string>();
      if (!knownContracts.has(contractId)) {
        addContractForNode(requestCarrierContractsByNode, transitionEdge.toId, contractId);
        transitionCarrierPropagationChanged = true;
      }
      addContractPropagationEdge({
        fromId: transitionEdge.fromId,
        toId: transitionEdge.toId,
        contractId,
        direction: "request",
        flowEdge: transitionEdge
      });
    }

    const responseContracts = responseCarrierContractsByNode.get(transitionEdge.fromId) ?? new Set<string>();
    for (const contractId of responseContracts) {
      const knownContracts = responseCarrierContractsByNode.get(transitionEdge.toId) ?? new Set<string>();
      if (!knownContracts.has(contractId)) {
        addContractForNode(responseCarrierContractsByNode, transitionEdge.toId, contractId);
        transitionCarrierPropagationChanged = true;
      }
      addContractPropagationEdge({
        fromId: transitionEdge.fromId,
        toId: transitionEdge.toId,
        contractId,
        direction: "response",
        flowEdge: transitionEdge
      });
    }
  }
  if (transitionCarrierPropagationChanged) {
    propagateCarrierContracts(requestCarrierContractsByNode, "request");
    propagateCarrierContracts(responseCarrierContractsByNode, "response");
  }

  const matchableEntities = (): MatchableEntity[] =>
    Array.from(entities.values())
      .filter((entity) => entity.type !== "knowledge-cluster" && entity.type !== "eai-interface")
      .map((entity) => ({
        id: entity.id,
        type: entity.type,
        pathText: String(entity.attributes.path ?? entity.attributes.filePath ?? ""),
        moduleName: String(entity.attributes.moduleName ?? ""),
        label: entity.label,
        routePath: String(entity.attributes.routePath ?? ""),
        apiPath: String(entity.attributes.normalizedUrl ?? entity.attributes.rawUrl ?? ""),
        screenCode: String(entity.attributes.screenCode ?? ""),
        controllerName: String(entity.attributes.controllerMethod ?? entity.attributes.controllerClass ?? ""),
        serviceName: String(entity.attributes.serviceHint ?? entity.attributes.serviceClass ?? entity.attributes.serviceMethod ?? "")
      }));

  for (const candidate of options.learnedKnowledge?.candidates ?? []) {
    const normalizedValue = normalizeKnowledgeValue(candidate);
    const clusterId = `knowledge:candidate:${candidate.id}`;
    const candidateDomains = candidate.kind === "domain" ? [normalizedValue] : [];
    const candidateChannels = candidate.kind === "channel" ? [normalizedValue] : [];
    const candidateModuleRoles = candidate.kind === "module-role" ? [normalizedValue] : [];
    const candidateProcessRoles = candidate.kind === "process" ? [normalizedValue] : [];
    upsertEntity({
      id: clusterId,
      type: "knowledge-cluster",
      label: candidate.label,
      summary: candidate.description,
      metadata: makeMetadata({
        domains: candidateDomains,
        channels: candidateChannels,
        moduleRoles: candidateModuleRoles,
        processRoles: candidateProcessRoles,
        confidence: Math.max(0.45, Math.min(0.95, candidate.score / 100)),
        evidencePaths: candidate.evidence,
        sourceType: "learned-knowledge",
        validatedStatus: candidate.status
      }),
      attributes: {
        candidateId: candidate.id,
        candidateKind: candidate.kind,
        score: candidate.score,
        searchTerms: candidate.searchTerms,
        aliases: candidate.aliases,
        apiPrefixes: candidate.apiPrefixes,
        controllerHints: candidate.controllerHints,
        serviceHints: candidate.serviceHints,
        screenPrefixes: candidate.screenPrefixes,
        pathHints: candidate.pathHints,
        counts: candidate.counts,
        clusterKind: "learned-candidate"
      }
    });

    const threshold = pickEntityMatchThreshold(candidate.kind);
    const matched = matchableEntities()
      .map((entity) => ({ entity, score: scoreKnowledgeCandidateMatch(candidate, entity) }))
      .filter((item) => item.score >= threshold)
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.entity.id.localeCompare(b.entity.id)))
      .slice(0, 40);

    for (const item of matched) {
      upsertEdge({
        id: `edge:${edgeTypeForKnowledgeKind(candidate.kind)}:${item.entity.id}:${clusterId}`,
        type: edgeTypeForKnowledgeKind(candidate.kind),
        fromId: item.entity.id,
        toId: clusterId,
        label: `${item.entity.type} linked to learned ${candidate.kind}`,
        metadata: makeMetadata({
          domains: candidateDomains,
          channels: candidateChannels,
          moduleRoles: candidateModuleRoles,
          processRoles: candidateProcessRoles,
          confidence: Math.max(0.45, Math.min(0.92, 0.4 + item.score * 0.08 + (candidate.status === "validated" ? 0.08 : 0))),
          evidencePaths: candidate.evidence,
          sourceType: "learned-knowledge",
          validatedStatus: candidate.status
        }),
        attributes: {
          matchScore: item.score,
          candidateId: candidate.id,
          candidateKind: candidate.kind
        }
      });
    }
  }

  const orderedEntities = Array.from(entities.values()).sort((a, b) => a.id.localeCompare(b.id));
  const orderedEdges = Array.from(edges.values()).sort((a, b) => a.id.localeCompare(b.id));
  const clusterEntities = orderedEntities.filter((entity) => entity.type === "knowledge-cluster");

  return maybeValidateSnapshot(KnowledgeSchemaSnapshotSchema, {
    version: 1,
    generatedAt: options.generatedAt,
    workspaceDir: options.workspaceDir,
    entities: orderedEntities,
    edges: orderedEdges,
    summary: {
      entityCount: orderedEntities.length,
      edgeCount: orderedEdges.length,
      entityTypeCounts: buildEntityTypeCounts(orderedEntities),
      edgeTypeCounts: buildEdgeTypeCounts(orderedEdges),
      validatedClusterCount: clusterEntities.filter((entity) => entity.metadata.validatedStatus === "validated").length,
      candidateClusterCount: clusterEntities.filter((entity) => entity.metadata.validatedStatus === "candidate").length,
      staleClusterCount: clusterEntities.filter((entity) => entity.metadata.validatedStatus === "stale").length,
      activeDomainCount: summarizeCounts(orderedEntities.flatMap((entity) => entity.metadata.domains)).length,
      topDomains: summarizeCounts(orderedEntities.flatMap((entity) => entity.metadata.domains)),
      topModules: summarizeCounts(
        orderedEntities
          .filter((entity) => entity.type === "module")
          .map((entity) => String(entity.attributes.moduleName ?? entity.label))
      )
    }
  });
}

export function compactKnowledgeSchemaSnapshot(
  snapshot: KnowledgeSchemaSnapshot,
  options: {
    maxEntities?: number;
    maxEdges?: number;
  }
): KnowledgeSchemaSnapshot {
  const parsed = maybeValidateSnapshot(KnowledgeSchemaSnapshotSchema, snapshot);
  const maxEntities = options.maxEntities;
  const maxEdges = options.maxEdges;

  if (
    (!maxEntities || parsed.entities.length <= maxEntities) &&
    (!maxEdges || parsed.edges.length <= maxEdges)
  ) {
    return parsed;
  }

  const rankedEntities = [...parsed.entities].sort((a, b) => {
    const priorityDiff = knowledgeEntityPriority(b) - knowledgeEntityPriority(a);
    if (priorityDiff !== 0) return priorityDiff;
    const statusDiff =
      knowledgeStatusPriority(b.metadata.validatedStatus) -
      knowledgeStatusPriority(a.metadata.validatedStatus);
    if (statusDiff !== 0) return statusDiff;
    const confidenceDiff = b.metadata.confidence - a.metadata.confidence;
    if (confidenceDiff !== 0) return confidenceDiff;
    return a.id.localeCompare(b.id);
  });

  const selectedEntities = (() => {
    if (!maxEntities || rankedEntities.length <= maxEntities) {
      return rankedEntities.sort((a, b) => a.id.localeCompare(b.id));
    }

    const coverageOrder: KnowledgeEntityType[] = [
      "route",
      "ui-action",
      "api",
      "gateway-handler",
      "controller",
      "service",
      "knowledge-cluster",
      "data-store",
      "async-channel",
      "eai-interface",
      "control-guard",
      "data-query",
      "data-model",
      "data-table",
      "cache-key",
      "module",
      "file",
      "symbol"
    ];

    const chosen = new Map<string, KnowledgeEntity>();
    for (const type of coverageOrder) {
      if (chosen.size >= maxEntities) break;
      const entity = rankedEntities.find((item) => item.type === type && !chosen.has(item.id));
      if (entity) {
        chosen.set(entity.id, entity);
      }
    }
    for (const entity of rankedEntities) {
      if (chosen.size >= maxEntities) break;
      if (!chosen.has(entity.id)) {
        chosen.set(entity.id, entity);
      }
    }
    return Array.from(chosen.values()).sort((a, b) => a.id.localeCompare(b.id));
  })();

  const selectedEntityIds = new Set(selectedEntities.map((entity) => entity.id));
  const selectedEdges = (
    !maxEdges
      ? parsed.edges.filter(
          (edge) => selectedEntityIds.has(edge.fromId) && selectedEntityIds.has(edge.toId)
        )
      : parsed.edges
          .filter((edge) => selectedEntityIds.has(edge.fromId) && selectedEntityIds.has(edge.toId))
          .sort((a, b) => {
            const priorityDiff = knowledgeEdgePriority(b) - knowledgeEdgePriority(a);
            if (priorityDiff !== 0) return priorityDiff;
            const statusDiff =
              knowledgeStatusPriority(b.metadata.validatedStatus) -
              knowledgeStatusPriority(a.metadata.validatedStatus);
            if (statusDiff !== 0) return statusDiff;
            const confidenceDiff = b.metadata.confidence - a.metadata.confidence;
            if (confidenceDiff !== 0) return confidenceDiff;
            return a.id.localeCompare(b.id);
          })
          .slice(0, maxEdges)
  ).sort((a, b) => a.id.localeCompare(b.id));

  const clusterEntities = selectedEntities.filter((entity) => entity.type === "knowledge-cluster");

  return maybeValidateSnapshot(KnowledgeSchemaSnapshotSchema, {
    version: parsed.version,
    generatedAt: parsed.generatedAt,
    workspaceDir: parsed.workspaceDir,
    entities: selectedEntities,
    edges: selectedEdges,
    summary: {
      entityCount: selectedEntities.length,
      edgeCount: selectedEdges.length,
      entityTypeCounts: buildEntityTypeCounts(selectedEntities),
      edgeTypeCounts: buildEdgeTypeCounts(selectedEdges),
      validatedClusterCount: clusterEntities.filter((entity) => entity.metadata.validatedStatus === "validated").length,
      candidateClusterCount: clusterEntities.filter((entity) => entity.metadata.validatedStatus === "candidate").length,
      staleClusterCount: clusterEntities.filter((entity) => entity.metadata.validatedStatus === "stale").length,
      activeDomainCount: parsed.summary.activeDomainCount,
      topDomains: summarizeCounts(selectedEntities.flatMap((entity) => entity.metadata.domains)),
      topModules: summarizeCounts(
        selectedEntities
          .filter((entity) => entity.type === "module")
          .map((entity) => String(entity.attributes.moduleName ?? entity.label))
      )
    }
  });
}

export function buildKnowledgeSchemaMarkdown(snapshot: KnowledgeSchemaSnapshot): string {
  const lines: string[] = [];
  lines.push("# Unified Knowledge Schema");
  lines.push("");
  lines.push(`- generatedAt: ${snapshot.generatedAt}`);
  lines.push(`- workspaceDir: ${toForwardSlash(snapshot.workspaceDir)}`);
  lines.push(`- entityCount: ${snapshot.summary.entityCount}`);
  lines.push(`- edgeCount: ${snapshot.summary.edgeCount}`);
  lines.push(`- validatedClusters: ${snapshot.summary.validatedClusterCount}`);
  lines.push(`- candidateClusters: ${snapshot.summary.candidateClusterCount}`);
  lines.push(`- staleClusters: ${snapshot.summary.staleClusterCount}`);
  lines.push("");
  lines.push("## Entity Types");
  for (const [type, count] of Object.entries(snapshot.summary.entityTypeCounts)) {
    lines.push(`- ${type}: ${count}`);
  }
  lines.push("");
  lines.push("## Edge Types");
  for (const [type, count] of Object.entries(snapshot.summary.edgeTypeCounts)) {
    lines.push(`- ${type}: ${count}`);
  }
  lines.push("");
  lines.push("## Top Domains");
  if (snapshot.summary.topDomains.length === 0) {
    lines.push("- (none)");
  } else {
    for (const item of snapshot.summary.topDomains) {
      lines.push(`- ${item.id}: ${item.count}`);
    }
  }
  lines.push("");
  lines.push("## Top Modules");
  if (snapshot.summary.topModules.length === 0) {
    lines.push("- (none)");
  } else {
    for (const item of snapshot.summary.topModules) {
      lines.push(`- ${item.id}: ${item.count}`);
    }
  }
  lines.push("");
  lines.push("## Knowledge Clusters");
  const clusters = snapshot.entities
    .filter((entity) => entity.type === "knowledge-cluster")
    .slice(0, 24);
  if (clusters.length === 0) {
    lines.push("- (none)");
  } else {
    for (const cluster of clusters) {
      lines.push(
        `- ${cluster.label} | status=${cluster.metadata.validatedStatus} | source=${cluster.metadata.sourceType} | confidence=${cluster.metadata.confidence.toFixed(2)}`
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
