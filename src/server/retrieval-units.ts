import { z } from "zod";
import {
  KnowledgeSchemaSnapshotSchema,
  type KnowledgeEdge,
  type KnowledgeEntity,
  type KnowledgeMetadata,
  type KnowledgeSchemaSnapshot
} from "./knowledge-schema.js";

const RetrievalUnitTypeSchema = z.enum([
  "symbol-block",
  "module-overview",
  "flow",
  "knowledge-cluster",
  "eai-link"
]);

const RetrievalUnitSchema = z.object({
  id: z.string().min(1),
  type: RetrievalUnitTypeSchema,
  title: z.string().min(1),
  summary: z.string().default(""),
  confidence: z.number().min(0).max(1),
  entityIds: z.array(z.string().min(1)).default([]),
  edgeIds: z.array(z.string().min(1)).default([]),
  searchText: z.array(z.string().min(1)).default([]),
  domains: z.array(z.string().min(1)).default([]),
  subdomains: z.array(z.string().min(1)).default([]),
  channels: z.array(z.string().min(1)).default([]),
  actions: z.array(z.string().min(1)).default([]),
  moduleRoles: z.array(z.string().min(1)).default([]),
  processRoles: z.array(z.string().min(1)).default([]),
  evidencePaths: z.array(z.string().min(1)).default([])
});

const RetrievalUnitSummarySchema = z.object({
  unitCount: z.number().int().min(0),
  unitTypeCounts: z.record(z.string(), z.number().int().min(0)),
  topDomains: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) })),
  topChannels: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) })),
  topModuleRoles: z.array(z.object({ id: z.string().min(1), count: z.number().int().min(0) }))
});

export const RetrievalUnitSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  workspaceDir: z.string().min(1),
  units: z.array(RetrievalUnitSchema),
  summary: RetrievalUnitSummarySchema
});

export type RetrievalUnit = z.infer<typeof RetrievalUnitSchema>;
export type RetrievalUnitSnapshot = z.infer<typeof RetrievalUnitSnapshotSchema>;

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function mergeMetadata(items: KnowledgeMetadata[]): Omit<RetrievalUnit, "id" | "type" | "title" | "summary" | "entityIds" | "edgeIds" | "searchText" | "confidence"> & { confidence: number } {
  return {
    domains: unique(items.flatMap((item) => item.domains)),
    subdomains: unique(items.flatMap((item) => item.subdomains)),
    channels: unique(items.flatMap((item) => item.channels)),
    actions: unique(items.flatMap((item) => item.actions)),
    moduleRoles: unique(items.flatMap((item) => item.moduleRoles)),
    processRoles: unique(items.flatMap((item) => item.processRoles)),
    evidencePaths: unique(items.flatMap((item) => item.evidencePaths).map(toForwardSlash)),
    confidence: items.reduce((max, item) => Math.max(max, item.confidence), 0)
  };
}

function countTop(values: string[]): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.id.localeCompare(b.id)))
    .slice(0, 12);
}

function summarizeUnitTypes(units: RetrievalUnit[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const unit of units) {
    counts.set(unit.type, (counts.get(unit.type) ?? 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function makeSearchText(parts: Array<string | undefined | null>): string[] {
  return unique(parts.filter((part): part is string => Boolean(part && part.trim())));
}

function labelForEntity(entity: KnowledgeEntity | undefined): string {
  return entity?.label ?? "(unknown)";
}

function ids(items: Array<KnowledgeEntity | KnowledgeEdge | undefined>): string[] {
  return unique(items.filter(Boolean).map((item) => item!.id));
}

export function buildRetrievalUnitSnapshot(options: {
  knowledgeSchema: KnowledgeSchemaSnapshot;
}): RetrievalUnitSnapshot {
  const knowledgeSchema = KnowledgeSchemaSnapshotSchema.parse(options.knowledgeSchema);
  const entitiesById = new Map(knowledgeSchema.entities.map((entity) => [entity.id, entity]));
  const outgoing = new Map<string, KnowledgeEdge[]>();
  const incoming = new Map<string, KnowledgeEdge[]>();
  for (const edge of knowledgeSchema.edges) {
    const out = outgoing.get(edge.fromId) ?? [];
    out.push(edge);
    outgoing.set(edge.fromId, out);
    const inc = incoming.get(edge.toId) ?? [];
    inc.push(edge);
    incoming.set(edge.toId, inc);
  }

  const units: RetrievalUnit[] = [];

  const pushUnit = (unit: RetrievalUnit) => {
    units.push(RetrievalUnitSchema.parse({
      ...unit,
      searchText: unique(unit.searchText),
      entityIds: unique(unit.entityIds),
      edgeIds: unique(unit.edgeIds),
      domains: unique(unit.domains),
      subdomains: unique(unit.subdomains),
      channels: unique(unit.channels),
      actions: unique(unit.actions),
      moduleRoles: unique(unit.moduleRoles),
      processRoles: unique(unit.processRoles),
      evidencePaths: unique(unit.evidencePaths.map(toForwardSlash))
    }));
  };

  for (const entity of knowledgeSchema.entities) {
    if (!["symbol", "controller", "service"].includes(entity.type)) {
      continue;
    }
    const declaredBy = (incoming.get(entity.id) ?? []).find((edge) => edge.type === "declares");
    const parentFile = declaredBy ? entitiesById.get(declaredBy.fromId) : undefined;
    const merged = mergeMetadata([entity.metadata, parentFile?.metadata].filter(Boolean) as KnowledgeMetadata[]);
    pushUnit({
      id: `unit:symbol:${entity.id}`,
      type: "symbol-block",
      title: entity.label,
      summary: entity.summary,
      ...merged,
      confidence: entity.metadata.confidence,
      entityIds: ids([entity, parentFile]),
      edgeIds: ids([declaredBy]),
      searchText: makeSearchText([
        entity.label,
        entity.summary,
        String(entity.attributes.path ?? entity.attributes.filePath ?? ""),
        String(entity.attributes.className ?? ""),
        String(entity.attributes.methodName ?? entity.attributes.serviceMethod ?? ""),
        ...entity.metadata.domains,
        ...entity.metadata.subdomains,
        ...entity.metadata.channels,
        ...entity.metadata.actions,
        ...entity.metadata.moduleRoles,
        ...entity.metadata.processRoles
      ])
    });
  }

  for (const entity of knowledgeSchema.entities) {
    if (entity.type !== "module") {
      continue;
    }
    const contains = (outgoing.get(entity.id) ?? []).filter((edge) => edge.type === "contains");
    const childEntities = contains.map((edge) => entitiesById.get(edge.toId)).filter(Boolean) as KnowledgeEntity[];
    const childTypeCounts = new Map<string, number>();
    for (const child of childEntities) {
      childTypeCounts.set(child.type, (childTypeCounts.get(child.type) ?? 0) + 1);
    }
    const childSummary = Array.from(childTypeCounts.entries())
      .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
      .map(([type, count]) => `${type}=${count}`)
      .join(", ");
    const merged = mergeMetadata([entity.metadata, ...childEntities.map((child) => child.metadata)]);
    pushUnit({
      id: `unit:module:${entity.id}`,
      type: "module-overview",
      title: entity.label,
      summary: childSummary ? `${entity.label} contains ${childSummary}` : entity.summary,
      ...merged,
      confidence: Math.max(entity.metadata.confidence, 0.72),
      entityIds: ids([entity, ...childEntities]),
      edgeIds: ids(contains),
      searchText: makeSearchText([
        entity.label,
        entity.summary,
        String(entity.attributes.moduleName ?? ""),
        childSummary,
        ...entity.metadata.moduleRoles,
        ...entity.metadata.processRoles
      ])
    });
  }

  const routeEdges = knowledgeSchema.edges.filter((edge) => edge.type === "routes-to");
  for (const routeEdge of routeEdges) {
    const fromEntity = entitiesById.get(routeEdge.fromId);
    const apiEntity = entitiesById.get(routeEdge.toId);
    if (!fromEntity || !apiEntity || apiEntity.type !== "api" || !["route", "file"].includes(fromEntity.type)) {
      continue;
    }
    const apiToController = (outgoing.get(apiEntity.id) ?? []).filter((edge) => edge.type === "routes-to");
    for (const mappingEdge of apiToController) {
      const controller = entitiesById.get(mappingEdge.toId);
      if (!controller || controller.type !== "controller") {
        continue;
      }
      const controllerCalls = (outgoing.get(controller.id) ?? []).filter((edge) => edge.type === "calls");
      const services = controllerCalls.map((edge) => entitiesById.get(edge.toId)).filter(Boolean) as KnowledgeEntity[];
      const merged = mergeMetadata([
        fromEntity.metadata,
        apiEntity.metadata,
        mappingEdge.metadata,
        controller.metadata,
        ...services.map((item) => item.metadata)
      ]);
      pushUnit({
        id: `unit:flow:${fromEntity.id}:${apiEntity.id}:${controller.id}`,
        type: "flow",
        title: `${labelForEntity(fromEntity)} -> ${controller.label}`,
        summary:
          services.length > 0
            ? `${labelForEntity(fromEntity)} -> ${apiEntity.label} -> ${controller.label} -> ${services.map((service) => service.label).join(", ")}`
            : `${labelForEntity(fromEntity)} -> ${apiEntity.label} -> ${controller.label}`,
        ...merged,
        confidence: Math.max(merged.confidence, 0.74),
        entityIds: ids([fromEntity, apiEntity, controller, ...services]),
        edgeIds: ids([routeEdge, mappingEdge, ...controllerCalls]),
        searchText: makeSearchText([
          fromEntity.label,
          fromEntity.summary,
          apiEntity.label,
          apiEntity.summary,
          controller.label,
          ...services.map((service) => service.label),
          String(fromEntity.attributes.routePath ?? ""),
          String(apiEntity.attributes.normalizedUrl ?? apiEntity.attributes.rawUrl ?? ""),
          String(controller.attributes.path ?? ""),
          ...merged.domains,
          ...merged.subdomains,
          ...merged.channels,
          ...merged.actions
        ])
      });
    }
  }

  for (const edge of knowledgeSchema.edges.filter((item) => item.type === "uses-eai")) {
    const fromEntity = entitiesById.get(edge.fromId);
    const toEntity = entitiesById.get(edge.toId);
    if (!fromEntity || !toEntity || toEntity.type !== "eai-interface") {
      continue;
    }
    const merged = mergeMetadata([fromEntity.metadata, toEntity.metadata, edge.metadata]);
    pushUnit({
      id: `unit:eai:${fromEntity.id}:${toEntity.id}`,
      type: "eai-link",
      title: `${fromEntity.label} -> ${toEntity.label}`,
      summary: `${fromEntity.label} uses ${toEntity.label}`,
      ...merged,
      confidence: Math.max(merged.confidence, 0.75),
      entityIds: ids([fromEntity, toEntity]),
      edgeIds: ids([edge]),
      searchText: makeSearchText([
        fromEntity.label,
        fromEntity.summary,
        toEntity.label,
        toEntity.summary,
        String(fromEntity.attributes.path ?? fromEntity.attributes.filePath ?? ""),
        String(toEntity.attributes.interfaceId ?? ""),
        ...merged.domains,
        ...merged.subdomains,
        ...merged.channels,
        ...merged.actions
      ])
    });
  }

  for (const entity of knowledgeSchema.entities) {
    if (entity.type !== "knowledge-cluster") {
      continue;
    }
    const relatedEdges = (incoming.get(entity.id) ?? []).filter((edge) =>
      ["belongs-to-domain", "belongs-to-channel", "belongs-to-process", "supports-module-role"].includes(edge.type)
    );
    const relatedEntities = relatedEdges.map((edge) => entitiesById.get(edge.fromId)).filter(Boolean) as KnowledgeEntity[];
    const merged = mergeMetadata([entity.metadata, ...relatedEntities.map((item) => item.metadata)]);
    pushUnit({
      id: `unit:knowledge:${entity.id}`,
      type: "knowledge-cluster",
      title: entity.label,
      summary:
        relatedEntities.length > 0
          ? `${entity.label} links ${relatedEntities.slice(0, 6).map((item) => item.label).join(", ")}`
          : entity.summary,
      ...merged,
      confidence: Math.max(merged.confidence, entity.metadata.confidence),
      entityIds: ids([entity, ...relatedEntities]),
      edgeIds: ids(relatedEdges),
      searchText: makeSearchText([
        entity.label,
        entity.summary,
        ...relatedEntities.map((item) => item.label),
        ...merged.domains,
        ...merged.subdomains,
        ...merged.channels,
        ...merged.actions,
        ...merged.moduleRoles,
        ...merged.processRoles
      ])
    });
  }

  const orderedUnits = units.sort((a, b) => a.id.localeCompare(b.id));
  return RetrievalUnitSnapshotSchema.parse({
    version: 1,
    generatedAt: knowledgeSchema.generatedAt,
    workspaceDir: knowledgeSchema.workspaceDir,
    units: orderedUnits,
    summary: {
      unitCount: orderedUnits.length,
      unitTypeCounts: summarizeUnitTypes(orderedUnits),
      topDomains: countTop(orderedUnits.flatMap((unit) => unit.domains)),
      topChannels: countTop(orderedUnits.flatMap((unit) => unit.channels)),
      topModuleRoles: countTop(orderedUnits.flatMap((unit) => unit.moduleRoles))
    }
  });
}

export function buildRetrievalUnitMarkdown(snapshot: RetrievalUnitSnapshot): string {
  const lines: string[] = [];
  lines.push("# Retrieval Units");
  lines.push("");
  lines.push(`- generatedAt: ${snapshot.generatedAt}`);
  lines.push(`- workspaceDir: ${toForwardSlash(snapshot.workspaceDir)}`);
  lines.push(`- unitCount: ${snapshot.summary.unitCount}`);
  lines.push("");
  lines.push("## Unit Types");
  for (const [type, count] of Object.entries(snapshot.summary.unitTypeCounts)) {
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
  lines.push("## Representative Units");
  for (const unit of snapshot.units.slice(0, 24)) {
    lines.push(`- [${unit.type}] ${unit.title} | confidence=${unit.confidence.toFixed(2)}`);
    if (unit.summary) {
      lines.push(`  - ${unit.summary}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
