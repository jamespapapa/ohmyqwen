import path from "node:path";
import { z } from "zod";
import type { DomainPack } from "./domain-packs.js";
import type { EaiDictionaryEntry } from "./eai-dictionary.js";
import type { FrontBackGraphSnapshot } from "./front-back-graph.js";
import type { LearnedKnowledgeCandidate, LearnedKnowledgeSnapshot } from "./learned-knowledge.js";

const KnowledgeEntityTypeSchema = z.enum([
  "module",
  "file",
  "symbol",
  "route",
  "api",
  "controller",
  "service",
  "eai-interface",
  "knowledge-cluster"
]);

const KnowledgeEdgeTypeSchema = z.enum([
  "contains",
  "declares",
  "calls",
  "routes-to",
  "maps-to",
  "uses-eai",
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
  domainPacks?: DomainPack[];
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

function inferProcessRoles(moduleName: string): string[] {
  const normalized = normalizeComparable(moduleName);
  if (normalized.includes("batch")) return ["batch-process"];
  return [];
}

function extractModuleName(relativePath: string, fallback?: string): string {
  const normalized = toForwardSlash(relativePath);
  const first = normalized.split("/").find(Boolean) ?? "";
  if (/^dcp-[a-z0-9-]+$/i.test(first)) {
    return first;
  }
  return fallback ? slugify(fallback) : "workspace-root";
}

function classifyCapabilityTags(tags: string[], domainPacks?: DomainPack[]): Pick<KnowledgeMetadata, "domains" | "subdomains" | "actions"> {
  const domains = new Set<string>();
  const subdomains = new Set<string>();
  const actions = new Set<string>();
  const tagSet = new Set(tags);

  for (const tag of tagSet) {
    if (tag.startsWith("action-")) {
      actions.add(tag);
    }
  }

  for (const pack of domainPacks ?? []) {
    let matchedPack = false;
    for (const capability of pack.capabilityTags) {
      if (!tagSet.has(capability.tag)) {
        continue;
      }
      matchedPack = true;
      if (capability.kind === "action") {
        actions.add(capability.tag);
      } else if (capability.kind === "subdomain") {
        subdomains.add(capability.tag);
      } else {
        domains.add(capability.tag);
      }
    }
    if (matchedPack) {
      domains.add(pack.id);
    }
  }

  return {
    domains: Array.from(domains),
    subdomains: Array.from(subdomains),
    actions: Array.from(actions)
  };
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
    const next = KnowledgeEntitySchema.parse(entity);
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

  const upsertEdge = (edge: KnowledgeEdge) => {
    const next = KnowledgeEdgeSchema.parse(edge);
    const key = `${next.type}:${next.fromId}:${next.toId}`;
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
    }
  }

  const frontendModuleId = options.frontBackGraph ? ensureModule("frontend-linked-workspaces", "front-back-graph") : undefined;

  for (const screen of options.frontBackGraph?.frontend.screens ?? []) {
    const tags = classifyCapabilityTags(screen.capabilityTags ?? [], options.domainPacks);
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
  }

  for (const route of options.frontBackGraph?.frontend.routes ?? []) {
    const tags = classifyCapabilityTags(route.capabilityTags ?? [], options.domainPacks);
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
    const tags = classifyCapabilityTags(link.capabilityTags ?? [], options.domainPacks);
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

    const backendPath = toForwardSlash(link.backend.filePath);
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
      id: `edge:routes-to:${apiId}:${controllerId}`,
      type: "routes-to",
      fromId: apiId,
      toId: controllerId,
      label: "API routed to backend controller",
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

    for (const serviceHint of link.backend.serviceHints) {
      const serviceClass = serviceHint.split(".")[0] ?? serviceHint;
      const serviceFilePath = classFileMap.get(serviceClass);
      const serviceModuleName = extractModuleName(serviceFilePath ?? backendPath, backendWorkspaceBase);
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

  for (const pack of options.domainPacks ?? []) {
    const packId = `knowledge:pack:${pack.id}`;
    upsertEntity({
      id: packId,
      type: "knowledge-cluster",
      label: pack.name,
      summary: pack.description || `${pack.name} domain pack`,
      metadata: makeMetadata({
        domains: [pack.id],
        confidence: 0.96,
        evidencePaths: [],
        sourceType: "domain-pack",
        validatedStatus: "validated"
      }),
      attributes: {
        packId: pack.id,
        families: pack.families,
        capabilityCount: pack.capabilityTags.length,
        exemplarCount: pack.exemplars.length,
        clusterKind: "domain-pack"
      }
    });
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

  for (const entity of Array.from(entities.values())) {
    if (entity.type === "knowledge-cluster") {
      continue;
    }
    for (const domainId of entity.metadata.domains) {
      const packId = `knowledge:pack:${domainId}`;
      if (!entities.has(packId)) {
        continue;
      }
      upsertEdge({
        id: `edge:belongs-to-domain:${entity.id}:${packId}`,
        type: "belongs-to-domain",
        fromId: entity.id,
        toId: packId,
        label: `${entity.type} belongs to domain pack`,
        metadata: makeMetadata({
          domains: [domainId],
          confidence: Math.max(0.65, entity.metadata.confidence),
          evidencePaths: entity.metadata.evidencePaths,
          sourceType: entity.metadata.sourceType,
          validatedStatus: entity.metadata.validatedStatus
        }),
        attributes: {}
      });
    }
  }

  const orderedEntities = Array.from(entities.values()).sort((a, b) => a.id.localeCompare(b.id));
  const orderedEdges = Array.from(edges.values()).sort((a, b) => a.id.localeCompare(b.id));
  const clusterEntities = orderedEntities.filter((entity) => entity.type === "knowledge-cluster");

  return KnowledgeSchemaSnapshotSchema.parse({
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
      activeDomainCount: (options.domainPacks ?? []).length,
      topDomains: summarizeCounts(orderedEntities.flatMap((entity) => entity.metadata.domains)),
      topModules: summarizeCounts(
        orderedEntities
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
  lines.push(`- activeDomains: ${snapshot.summary.activeDomainCount}`);
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
