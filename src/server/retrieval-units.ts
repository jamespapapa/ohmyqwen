import { z } from "zod";
import {
  KnowledgeSchemaSnapshotSchema,
  type KnowledgeEdge,
  type KnowledgeEntity,
  type KnowledgeMetadata,
  type KnowledgeValidatedStatus,
  type KnowledgeSchemaSnapshot
} from "./knowledge-schema.js";
import { inferQuestionActionHints, type AskQuestionType } from "./question-types.js";
import { maybeValidateSnapshot } from "./snapshot-validation.js";

const RetrievalUnitTypeSchema = z.enum([
  "symbol-block",
  "module-overview",
  "flow",
  "knowledge-cluster",
  "eai-link",
  "resource-schema"
]);

const RetrievalUnitSchema = z.object({
  id: z.string().min(1),
  type: RetrievalUnitTypeSchema,
  title: z.string().min(1),
  summary: z.string().default(""),
  confidence: z.number().min(0).max(1),
  validatedStatus: z.enum(["candidate", "validated", "derived", "stale"]).default("derived"),
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
  unitStatusCounts: z.record(z.string(), z.number().int().min(0)),
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
export interface RankedRetrievalUnit {
  unit: RetrievalUnit;
  score: number;
  reasons: string[];
}

export interface RetrievalUnitSupportCandidate {
  unitId: string;
  path: string;
  title: string;
  summary: string;
  score: number;
  reasons: string[];
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function mergeValidatedStatus(items: KnowledgeMetadata[]): KnowledgeValidatedStatus {
  if (items.some((item) => item.validatedStatus === "validated")) {
    return "validated";
  }
  if (items.some((item) => item.validatedStatus === "derived")) {
    return "derived";
  }
  if (items.some((item) => item.validatedStatus === "candidate")) {
    return "candidate";
  }
  if (items.some((item) => item.validatedStatus === "stale")) {
    return "stale";
  }
  return "derived";
}

function mergeMetadata(items: KnowledgeMetadata[]): Omit<RetrievalUnit, "id" | "type" | "title" | "summary" | "entityIds" | "edgeIds" | "searchText" | "confidence"> & { confidence: number; validatedStatus: KnowledgeValidatedStatus } {
  return {
    domains: unique(items.flatMap((item) => item.domains)),
    subdomains: unique(items.flatMap((item) => item.subdomains)),
    channels: unique(items.flatMap((item) => item.channels)),
    actions: unique(items.flatMap((item) => item.actions)),
    moduleRoles: unique(items.flatMap((item) => item.moduleRoles)),
    processRoles: unique(items.flatMap((item) => item.processRoles)),
    evidencePaths: unique(items.flatMap((item) => item.evidencePaths).map(toForwardSlash)),
    confidence: items.reduce((max, item) => Math.max(max, item.confidence), 0),
    validatedStatus: mergeValidatedStatus(items)
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

function summarizeUnitStatuses(units: RetrievalUnit[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const unit of units) {
    counts.set(unit.validatedStatus, (counts.get(unit.validatedStatus) ?? 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function makeSearchText(parts: Array<string | undefined | null>): string[] {
  return unique(parts.filter((part): part is string => Boolean(part && part.trim())));
}

function toSearchTokens(input: string): string[] {
  return unique(
    input
      .toLowerCase()
      .replace(/[^a-z0-9가-힣_:/.-]+/gi, " ")
      .split(/\s+/)
      .filter((item) => item.length >= 2)
  );
}

function isDirectActionHint(action: string): boolean {
  return [
    "action-auth",
    "action-register",
    "action-write",
    "action-update",
    "action-delete",
    "action-callback",
    "action-token"
  ].includes(action);
}

function actionAlignmentScore(unitActions: string[], desiredActions: string[]): { delta: number; reasons: string[] } {
  if (unitActions.length === 0 || desiredActions.length === 0) {
    return { delta: 0, reasons: [] };
  }

  const overlaps = desiredActions.filter((action) => unitActions.includes(action));
  if (overlaps.length > 0) {
    return {
      delta: overlaps.length * 1.2,
      reasons: [`actions:${overlaps.slice(0, 4).join(",")}`]
    };
  }

  const directDesired = desiredActions.filter(isDirectActionHint);
  if (directDesired.length > 0) {
    return { delta: -1.3, reasons: ["action-mismatch"] };
  }

  return { delta: -0.45, reasons: ["action-mismatch"] };
}

function chooseSupportPath(evidencePaths: string[]): string | undefined {
  const normalized = evidencePaths.map(toForwardSlash).filter(Boolean);
  return (
    normalized.find((entry) => /\/src\/|\.java$|\.kt$|\.ts$|\.tsx$|\.js$|\.jsx$|\.vue$|\.jsp$|\.xml$|\.yml$|\.yaml$|\.json$/i.test(entry)) ??
    normalized.find((entry) => entry.includes("/")) ??
    normalized[0]
  );
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
  const knowledgeSchema = maybeValidateSnapshot(KnowledgeSchemaSnapshotSchema, options.knowledgeSchema);
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
    const normalizedUnit = {
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
    };
    units.push(maybeValidateSnapshot(RetrievalUnitSchema, normalizedUnit));
  };

  for (const entity of knowledgeSchema.entities) {
    if (!["symbol", "controller", "service", "control-guard", "data-query"].includes(entity.type)) {
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
      validatedStatus: mergeValidatedStatus([entity.metadata, ...childEntities.map((child) => child.metadata)]),
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

  const apiEntryEdges = knowledgeSchema.edges.filter(
    (edge) => ["routes-to", "calls"].includes(edge.type)
  );
  for (const routeEdge of apiEntryEdges) {
    const fromEntity = entitiesById.get(routeEdge.fromId);
    const apiEntity = entitiesById.get(routeEdge.toId);
    if (!fromEntity || !apiEntity || apiEntity.type !== "api" || !["route", "file", "ui-action"].includes(fromEntity.type)) {
      continue;
    }
    const apiToGatewayOrController = (outgoing.get(apiEntity.id) ?? []).filter((edge) =>
      edge.type === "routes-to"
    );
    for (const mappingEdge of apiToGatewayOrController) {
      const mappedNode = entitiesById.get(mappingEdge.toId);
      if (!mappedNode) {
        continue;
      }

      const gatewayNode = mappedNode.type === "gateway-handler" ? mappedNode : undefined;
      const proxyEdges = gatewayNode
        ? (outgoing.get(gatewayNode.id) ?? []).filter((edge) => edge.type === "proxies-to")
        : [];
      const controllerEdges =
        mappedNode.type === "controller"
          ? [mappingEdge]
          : proxyEdges;

      for (const controllerEdge of controllerEdges) {
        const controller = entitiesById.get(controllerEdge.toId);
        if (!controller || controller.type !== "controller") {
          continue;
        }
        const controllerCalls = (outgoing.get(controller.id) ?? []).filter((edge) => edge.type === "calls");
        const services = controllerCalls.map((edge) => entitiesById.get(edge.toId)).filter(Boolean) as KnowledgeEntity[];
        const supportRoots = [apiEntity, gatewayNode, controller, ...services].filter(Boolean) as KnowledgeEntity[];
        const supportEdges = supportRoots.flatMap((root) =>
          (outgoing.get(root.id) ?? []).filter((edge) =>
            [
              "accepts-contract",
              "returns-contract",
              "uses-store",
              "uses-eai",
              "uses-cache-key",
              "stores-model",
              "maps-to-table",
              "queries-table",
              "validates"
            ].includes(edge.type)
          )
        );
        const supportEntities = unique(
          supportEdges
            .flatMap((edge) => [edge.fromId, edge.toId])
            .filter((id) => !supportRoots.some((root) => root.id === id))
        )
          .map((id) => entitiesById.get(id))
          .filter(Boolean) as KnowledgeEntity[];
        const merged = mergeMetadata([
          fromEntity.metadata,
          apiEntity.metadata,
          mappingEdge.metadata,
          gatewayNode?.metadata,
          controller.metadata,
          ...services.map((item) => item.metadata),
          ...supportEntities.map((item) => item.metadata),
          ...supportEdges.map((item) => item.metadata)
        ].filter(Boolean) as KnowledgeMetadata[]);
        pushUnit({
          id: `unit:flow:${fromEntity.id}:${apiEntity.id}:${controller.id}`,
          type: "flow",
          title: `${labelForEntity(fromEntity)} -> ${controller.label}`,
          summary:
            services.length > 0
              ? `${labelForEntity(fromEntity)} -> ${apiEntity.label}${gatewayNode ? ` -> ${gatewayNode.label}` : ""} -> ${controller.label} -> ${services.map((service) => service.label).join(", ")}${supportEntities.length > 0 ? ` | ${supportEntities.slice(0, 6).map((entity) => entity.label).join(", ")}` : ""}`
              : `${labelForEntity(fromEntity)} -> ${apiEntity.label}${gatewayNode ? ` -> ${gatewayNode.label}` : ""} -> ${controller.label}${supportEntities.length > 0 ? ` | ${supportEntities.slice(0, 6).map((entity) => entity.label).join(", ")}` : ""}`,
          ...merged,
          confidence: Math.max(merged.confidence, 0.74),
          validatedStatus: mergeValidatedStatus([
            fromEntity.metadata,
            apiEntity.metadata,
            mappingEdge.metadata,
            gatewayNode?.metadata,
            controller.metadata,
            ...services.map((item) => item.metadata),
            ...supportEntities.map((item) => item.metadata),
            ...supportEdges.map((item) => item.metadata)
          ].filter(Boolean) as KnowledgeMetadata[]),
          entityIds: ids([fromEntity, apiEntity, gatewayNode, controller, ...services, ...supportEntities]),
          edgeIds: ids([routeEdge, mappingEdge, ...proxyEdges, ...controllerCalls, ...supportEdges]),
          searchText: makeSearchText([
            fromEntity.label,
            fromEntity.summary,
            apiEntity.label,
            apiEntity.summary,
            gatewayNode?.label,
            controller.label,
            ...services.map((service) => service.label),
            ...supportEntities.map((entity) => entity.label),
            String(fromEntity.attributes.routePath ?? fromEntity.attributes.functionName ?? ""),
            String(apiEntity.attributes.normalizedUrl ?? apiEntity.attributes.rawUrl ?? ""),
            String(gatewayNode?.attributes.path ?? ""),
            String(controller.attributes.path ?? ""),
            ...merged.domains,
            ...merged.subdomains,
            ...merged.channels,
            ...merged.actions
          ])
        });
      }
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
      validatedStatus: mergeValidatedStatus([fromEntity.metadata, toEntity.metadata, edge.metadata]),
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
    if (!["data-store", "data-contract", "data-model", "data-table", "cache-key"].includes(entity.type)) {
      continue;
    }
    const relatedOutgoing = (outgoing.get(entity.id) ?? []).filter((edge) =>
      ["uses-store", "accepts-contract", "returns-contract", "maps-to-table", "queries-table", "uses-cache-key", "stores-model", "contains", "declares"].includes(edge.type)
    );
    const relatedIncoming = (incoming.get(entity.id) ?? []).filter((edge) =>
      ["uses-store", "accepts-contract", "returns-contract", "maps-to-table", "queries-table", "uses-cache-key", "stores-model", "contains", "declares"].includes(edge.type)
    );
    const relatedEdges = unique([...relatedOutgoing, ...relatedIncoming].map((edge) => edge.id))
      .map((id) => knowledgeSchema.edges.find((edge) => edge.id === id))
      .filter(Boolean) as KnowledgeEdge[];
    const relatedEntities = unique(
      relatedEdges.flatMap((edge) => [edge.fromId, edge.toId]).filter((id) => id !== entity.id)
    )
      .map((id) => entitiesById.get(id))
      .filter(Boolean) as KnowledgeEntity[];
    const merged = mergeMetadata([entity.metadata, ...relatedEntities.map((item) => item.metadata), ...relatedEdges.map((item) => item.metadata)]);
    const summaryParts = unique([
      entity.summary,
      ...relatedEntities.slice(0, 6).map((item) => item.label)
    ]).filter(Boolean);
    pushUnit({
      id: `unit:resource:${entity.id}`,
      type: "resource-schema",
      title: entity.label,
      summary: summaryParts.join(" | "),
      ...merged,
      confidence: Math.max(entity.metadata.confidence, merged.confidence, 0.74),
      validatedStatus: mergeValidatedStatus([entity.metadata, ...relatedEntities.map((item) => item.metadata), ...relatedEdges.map((item) => item.metadata)]),
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
        ...merged.processRoles,
        String(entity.attributes.tableName ?? ""),
        String(entity.attributes.modelName ?? ""),
        String(entity.attributes.key ?? ""),
        String(entity.attributes.storeKind ?? "")
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
      validatedStatus: entity.metadata.validatedStatus,
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
  return maybeValidateSnapshot(RetrievalUnitSnapshotSchema, {
    version: 1,
    generatedAt: knowledgeSchema.generatedAt,
    workspaceDir: knowledgeSchema.workspaceDir,
    units: orderedUnits,
    summary: {
      unitCount: orderedUnits.length,
      unitTypeCounts: summarizeUnitTypes(orderedUnits),
      unitStatusCounts: summarizeUnitStatuses(orderedUnits),
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
    lines.push(`- [${unit.type}] ${unit.title} | status=${unit.validatedStatus} | confidence=${unit.confidence.toFixed(2)}`);
    if (unit.summary) {
      lines.push(`  - ${unit.summary}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function rankRetrievalUnitsForQuestion(options: {
  snapshot: RetrievalUnitSnapshot;
  question: string;
  questionType: AskQuestionType;
  questionTags?: string[];
  matchedKnowledgeIds?: string[];
  moduleCandidates?: string[];
  limit?: number;
}): RankedRetrievalUnit[] {
  const tokens = toSearchTokens(options.question);
  const questionTags = unique(options.questionTags ?? []);
  const knowledgeSignals = unique(options.matchedKnowledgeIds ?? []);
  const desiredActions = inferQuestionActionHints(options.question, [...questionTags, ...knowledgeSignals]);
  const moduleCandidates = unique(options.moduleCandidates ?? []).map((item) => item.toLowerCase());
  const preferredTypeWeights: Record<AskQuestionType, Partial<Record<RetrievalUnit["type"], number>>> = {
    cross_layer_flow: { flow: 4, "knowledge-cluster": 1.5, "module-overview": 1 },
    business_capability_trace: { flow: 3, "symbol-block": 2.5, "eai-link": 2, "knowledge-cluster": 1 },
    domain_capability_overview: { "module-overview": 3, "knowledge-cluster": 2.5, flow: 1.5, "eai-link": 1.5 },
    module_role_explanation: { "module-overview": 4, "knowledge-cluster": 2, flow: 1 },
    process_or_batch_trace: { flow: 3, "module-overview": 2, "symbol-block": 1.5, "knowledge-cluster": 1.5 },
    channel_or_partner_integration: { flow: 4, "knowledge-cluster": 2.5, "module-overview": 1.5 },
    state_store_schema: { "resource-schema": 4.5, "symbol-block": 2.5, "module-overview": 1.5, "knowledge-cluster": 1 },
    config_or_resource_explanation: { "resource-schema": 4, "knowledge-cluster": 2, "eai-link": 1.5, "module-overview": 1 },
    symbol_deep_trace: { "symbol-block": 4, "eai-link": 2, flow: 1.5 }
  };

  const results = options.snapshot.units.map((unit) => {
    let score = unit.confidence * 2;
    const reasons: string[] = [`base:${unit.confidence.toFixed(2)}`];
    const lifecycleBonus =
      unit.validatedStatus === "validated"
        ? 1.5
        : unit.validatedStatus === "derived"
          ? 0.5
          : unit.validatedStatus === "candidate"
            ? -0.4
            : -2.5;
    score += lifecycleBonus;
    reasons.push(`status:${unit.validatedStatus}`);

    const typeBonus = preferredTypeWeights[options.questionType][unit.type] ?? 0;
    if (typeBonus > 0) {
      score += typeBonus;
      reasons.push(`type:${unit.type}`);
    }

    const actionAlignment = actionAlignmentScore(unit.actions, desiredActions);
    score += actionAlignment.delta;
    reasons.push(...actionAlignment.reasons);

    const haystack = unique([unit.title, unit.summary, ...unit.searchText]).join(" ").toLowerCase();
    const tokenMatches = tokens.filter((token) => haystack.includes(token));
    if (tokenMatches.length > 0) {
      score += tokenMatches.length * 0.9;
      reasons.push(`tokens:${tokenMatches.slice(0, 4).join(",")}`);
    }

    const tagMatches = questionTags.filter(
      (tag) => unit.domains.includes(tag) || unit.subdomains.includes(tag) || unit.channels.includes(tag) || unit.actions.includes(tag)
    );
    if (tagMatches.length > 0) {
      score += tagMatches.length * 1.2;
      reasons.push(`tags:${tagMatches.slice(0, 4).join(",")}`);
    }

    const normalizedKnowledgeSignals = knowledgeSignals.flatMap((item) =>
      item.startsWith("channel:") || item.startsWith("module:") || item.startsWith("process:")
        ? [item, item.split(":").slice(1).join(":")]
        : [item]
    );
    const knowledgeMatches = normalizedKnowledgeSignals.filter((signal) => haystack.includes(signal.toLowerCase()));
    if (knowledgeMatches.length > 0) {
      score += knowledgeMatches.length * 1.3;
      reasons.push(`knowledge:${knowledgeMatches.slice(0, 4).join(",")}`);
    }

    if (moduleCandidates.length > 0) {
      const moduleMatched = moduleCandidates.some(
        (candidate) =>
          haystack.includes(candidate) ||
          unit.evidencePaths.some((path) => path.toLowerCase().includes(candidate))
      );
      if (moduleMatched) {
        score += 2.2;
        reasons.push("module");
      }
    }

    if (options.questionType === "channel_or_partner_integration" && unit.channels.length > 0) {
      score += 1.5;
      reasons.push(`channels:${unit.channels.slice(0, 3).join(",")}`);
    }
    if (
      options.questionType === "channel_or_partner_integration" &&
      unit.type === "flow" &&
      unit.channels.length > 0
    ) {
      score += 1.15;
      reasons.push("channel-flow");
    }

    if (options.questionType === "process_or_batch_trace" && (unit.processRoles.length > 0 || /batch|job|tasklet|step|scheduler|processor|queue/i.test(haystack))) {
      score += 1.8;
      reasons.push("process");
    }

    if (options.questionType === "module_role_explanation" && unit.moduleRoles.length > 0) {
      score += 1.4;
      reasons.push(`moduleRoles:${unit.moduleRoles.slice(0, 3).join(",")}`);
    }

    if (
      unit.validatedStatus === "stale" &&
      ["module_role_explanation", "channel_or_partner_integration", "process_or_batch_trace", "domain_capability_overview"].includes(
        options.questionType
      )
    ) {
      score -= 1.5;
      reasons.push("stale-penalty");
    }

    return {
      unit,
      score,
      reasons
    };
  });

  return results
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.unit.id.localeCompare(b.unit.id)))
    .slice(0, options.limit ?? 8);
}

export function buildRetrievalUnitSupportCandidates(options: {
  rankedUnits: RankedRetrievalUnit[];
  existingPaths?: string[];
  limit?: number;
}): RetrievalUnitSupportCandidate[] {
  const existing = new Set((options.existingPaths ?? []).map((item) => toForwardSlash(item).toLowerCase()));
  const results: RetrievalUnitSupportCandidate[] = [];

  for (const ranked of options.rankedUnits) {
    const supportPath = chooseSupportPath(ranked.unit.evidencePaths);
    if (!supportPath) {
      continue;
    }
    const normalizedPath = supportPath.toLowerCase();
    if (existing.has(normalizedPath)) {
      continue;
    }
    existing.add(normalizedPath);
    results.push({
      unitId: ranked.unit.id,
      path: supportPath,
      title: ranked.unit.title,
      summary: ranked.unit.summary,
      score: Math.round((ranked.score * 0.35 + ranked.unit.confidence * 4) * 100) / 100,
      reasons: unique([`retrieval-unit-derived=${ranked.unit.id}`, ...ranked.reasons.slice(0, 3)])
    });
    if (results.length >= (options.limit ?? 4)) {
      break;
    }
  }

  return results;
}
