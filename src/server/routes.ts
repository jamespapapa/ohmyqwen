import { IncomingMessage, ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AnalyzeInputSchema, RunModeSchema } from "../core/types.js";
import {
  analyzeServerProject,
  askServerProject,
  evaluateServerProjectOntologyDraft,
  executeServerProjectReplay,
  getServerLlmSettings,
  getServerDomainPack,
  getServerProject,
  getServerProjectOntologyView,
  getServerProjectOntologyDraft,
  listServerDomainPacks,
  listServerProjectPresets,
  listServerProjects,
  listProjectDebugEvents,
  recordServerProjectFeedback,
  recordServerProjectOntologyInput,
  removeServerDomainPack,
  removeServerProject,
  removeServerProjectPreset,
  readServerProjectFile,
  revertServerProjectOntologyDraft,
  saveServerProjectOntologyDraft,
  searchServerProject,
  upsertServerDomainPack,
  upsertServerProject,
  upsertServerProjectPreset,
  warmupServerProjectIndex
} from "./projects.js";
import {
  deriveStageTokenCapsFromModel,
  loadLlmRuntimeSettings,
  resolveLlmModelProfile
} from "../llm/settings.js";
import { getRunArtifacts, getRunRecord, listRunEvents, startBackgroundRun } from "./store.js";

function json(res: ServerResponse, code: number, payload: unknown): void {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function routeTrace(message: string, payload?: Record<string, unknown>): void {
  if (process.env.OHMYQWEN_SERVER_TRACE !== "1") {
    return;
  }
  const suffix = payload ? ` ${JSON.stringify(payload)}` : "";
  process.stdout.write(`[route-trace] ${new Date().toISOString()} ${message}${suffix}\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function matchRunPath(urlPath: string, suffix: "" | "events" | "artifacts"): string | undefined {
  const pattern = suffix
    ? new RegExp(`^/api/runs/([^/]+)/${suffix}$`)
    : /^\/api\/runs\/([^/]+)$/;
  const matched = urlPath.match(pattern);
  return matched?.[1];
}

function matchProjectPath(
  urlPath: string,
  suffix:
    | ""
    | "index"
    | "search"
    | "runs"
    | "file"
    | "analyze"
    | "ask"
    | "debug"
    | "feedback"
    | "ontology"
    | "ontology-inputs"
    | "ontology-draft"
    | "ontology-draft/evaluate"
    | "ontology-draft/revert"
    | "replay"
): string | undefined {
  const pattern = suffix
    ? new RegExp(`^/api/projects/([^/]+)/${suffix}$`)
    : /^\/api\/projects\/([^/]+)$/;
  const matched = urlPath.match(pattern);
  return matched?.[1];
}

function matchPresetPath(urlPath: string): string | undefined {
  const matched = urlPath.match(/^\/api\/presets\/([^/]+)$/);
  return matched?.[1];
}

function matchDomainPackPath(urlPath: string): string | undefined {
  const matched = urlPath.match(/^\/api\/domain-packs\/([^/]+)$/);
  return matched?.[1];
}

function resolveBrowsePath(raw: string | null): string {
  const value = raw?.trim();
  if (!value) {
    const configuredRoot = process.env.OHMYQWEN_FS_PICKER_ROOT?.trim();
    if (configuredRoot) {
      return path.isAbsolute(configuredRoot)
        ? path.resolve(configuredRoot)
        : path.resolve(process.cwd(), configuredRoot);
    }

    const home = process.env.HOME ?? "";
    if (home) {
      return path.resolve(home, "Desktop", "work");
    }

    return process.cwd();
  }

  const home = process.env.HOME ?? "";
  if (value === "~" && home) {
    return home;
  }

  if (value.startsWith("~/") && home) {
    return path.join(home, value.slice(2));
  }

  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(process.cwd(), value);
}

export async function handleApiRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/presets") {
    try {
      const presets = await listServerProjectPresets();
      json(res, 200, {
        presets
      });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  if (method === "GET" && pathname === "/api/domain-packs") {
    try {
      const domainPacks = await listServerDomainPacks();
      json(res, 200, {
        domainPacks
      });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  if (method === "GET" && pathname === "/api/llm/models") {
    try {
      const settings = await getServerLlmSettings();
      json(res, 200, settings);
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  if (method === "POST" && pathname === "/api/presets") {
    try {
      const payload = (await readJsonBody(req)) as {
        id?: string;
        name?: string;
        summary?: string;
        keyFacts?: string[];
        domainPackIds?: string[];
        rules?: {
          workspaceIncludes?: string[];
          projectNameIncludes?: string[];
          requiredPaths?: string[];
        };
        eai?: {
          enabled?: boolean;
          asOfDate?: string;
          servicePathIncludes?: string[];
          manualOverridesFile?: string;
        };
      };

      const preset = await upsertServerProjectPreset({
        id: payload.id,
        name: payload.name ?? "",
        summary: payload.summary ?? "",
        keyFacts: payload.keyFacts ?? [],
        rules: payload.rules
          ? {
              workspaceIncludes: payload.rules.workspaceIncludes ?? [],
              projectNameIncludes: payload.rules.projectNameIncludes ?? [],
              requiredPaths: payload.rules.requiredPaths ?? []
            }
          : undefined,
        domainPackIds: payload.domainPackIds ?? [],
        eai: payload.eai
          ? {
              enabled: payload.eai.enabled ?? false,
              asOfDate: payload.eai.asOfDate,
              servicePathIncludes: payload.eai.servicePathIncludes ?? ["resources/eai/"],
              manualOverridesFile: payload.eai.manualOverridesFile
            }
          : undefined
      });

      json(res, 201, {
        preset
      });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  if (method === "POST" && pathname === "/api/domain-packs") {
    try {
      const payload = (await readJsonBody(req)) as {
        id?: string;
        name?: string;
        description?: string;
        families?: string[];
        enabledByDefault?: boolean;
        capabilityTags?: unknown[];
        rankingPriors?: unknown[];
        exemplars?: unknown[];
      };

      const domainPack = await upsertServerDomainPack({
        id: payload.id,
        name: payload.name ?? "",
        description: payload.description ?? "",
        families: payload.families ?? [],
        enabledByDefault: payload.enabledByDefault ?? true,
        capabilityTags: Array.isArray(payload.capabilityTags) ? (payload.capabilityTags as any[]) : [],
        rankingPriors: Array.isArray(payload.rankingPriors) ? (payload.rankingPriors as any[]) : [],
        exemplars: Array.isArray(payload.exemplars) ? (payload.exemplars as any[]) : []
      });

      json(res, 201, {
        domainPack
      });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const presetId = matchPresetPath(pathname);
  if (presetId && method === "DELETE") {
    try {
      await removeServerProjectPreset(presetId);
      json(res, 200, { ok: true });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const domainPackId = matchDomainPackPath(pathname);
  if (domainPackId && method === "GET") {
    try {
      const domainPack = await getServerDomainPack(domainPackId);
      if (!domainPack) {
        json(res, 404, { error: `domain pack not found: ${domainPackId}` });
        return true;
      }
      json(res, 200, { domainPack });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }
  if (domainPackId && method === "DELETE") {
    try {
      await removeServerDomainPack(domainPackId);
      json(res, 200, { ok: true });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  if (method === "GET" && pathname === "/api/projects") {
    try {
      const projects = await listServerProjects();
      json(res, 200, {
        projects
      });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  if (method === "POST" && pathname === "/api/projects") {
    try {
      const payload = (await readJsonBody(req)) as {
        id?: string;
        name?: string;
        workspaceDir?: string;
        linkedWorkspaceDirs?: string[];
        description?: string;
        defaultMode?: "auto" | "feature" | "refactor" | "medium" | "microservice";
        defaultDryRun?: boolean;
        llm?: {
          modelId?: string;
        };
        retrieval?: {
          providerPriority?: Array<"qmd" | "lexical" | "semantic" | "hybrid">;
          topK?: Partial<Record<"qmd" | "lexical" | "semantic" | "hybrid" | "final", number>>;
          timeoutMs?: Partial<Record<"qmd" | "semantic" | "provider", number>>;
          stageTokenCaps?: Partial<Record<"PLAN" | "IMPLEMENT" | "VERIFY", number>>;
          embedding?: {
            enabled?: boolean;
            endpoint?: string;
            healthPath?: string;
            embedPath?: string;
            model?: string;
            timeoutMs?: number;
            maxBatchSize?: number;
            cachePath?: string;
          };
          lifecycle?: {
            chunkVersion?: string;
            retrievalVersion?: string;
            autoReindexOnStale?: boolean;
          };
          qmd?: {
            enabled?: boolean;
            command?: string;
            collectionName?: string;
            indexName?: string;
            mask?: string;
            queryMode?: "query_then_search" | "search_only" | "query_only";
            configDir?: string;
            cacheHome?: string;
            indexPath?: string;
            syncIntervalMs?: number;
            forceFailure?: boolean;
          };
        };
      };

      const project = await upsertServerProject({
        id: payload.id,
        name: payload.name ?? "",
        workspaceDir: payload.workspaceDir ?? "",
        linkedWorkspaceDirs: payload.linkedWorkspaceDirs ?? [],
        description: payload.description,
        defaultMode: payload.defaultMode ? RunModeSchema.parse(payload.defaultMode) : undefined,
        defaultDryRun: payload.defaultDryRun,
        llm: payload.llm,
        retrieval: payload.retrieval as never
      });

      json(res, 201, {
        project
      });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectId = matchProjectPath(pathname, "");
  if (projectId && method === "GET") {
    try {
      const project = await getServerProject(projectId);
      if (!project) {
        json(res, 404, {
          error: `project not found: ${projectId}`
        });
        return true;
      }

      json(res, 200, {
        project
      });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  if (projectId && method === "PATCH") {
    try {
      const payload = (await readJsonBody(req)) as {
        name?: string;
        workspaceDir?: string;
        linkedWorkspaceDirs?: string[];
        description?: string;
        defaultMode?: "auto" | "feature" | "refactor" | "medium" | "microservice";
        defaultDryRun?: boolean;
        retrieval?: {
          providerPriority?: Array<"qmd" | "lexical" | "semantic" | "hybrid">;
          topK?: Partial<Record<"qmd" | "lexical" | "semantic" | "hybrid" | "final", number>>;
          timeoutMs?: Partial<Record<"qmd" | "semantic" | "provider", number>>;
          stageTokenCaps?: Partial<Record<"PLAN" | "IMPLEMENT" | "VERIFY", number>>;
          embedding?: {
            enabled?: boolean;
            endpoint?: string;
            healthPath?: string;
            embedPath?: string;
            model?: string;
            timeoutMs?: number;
            maxBatchSize?: number;
            cachePath?: string;
          };
          lifecycle?: {
            chunkVersion?: string;
            retrievalVersion?: string;
            autoReindexOnStale?: boolean;
          };
          qmd?: {
            enabled?: boolean;
            command?: string;
            collectionName?: string;
            indexName?: string;
            mask?: string;
            queryMode?: "query_then_search" | "search_only" | "query_only";
            configDir?: string;
            cacheHome?: string;
            indexPath?: string;
            syncIntervalMs?: number;
            forceFailure?: boolean;
          };
        };
      };

      const existing = await getServerProject(projectId);
      if (!existing) {
        json(res, 404, {
          error: `project not found: ${projectId}`
        });
        return true;
      }

      const project = await upsertServerProject({
        id: projectId,
        name: payload.name ?? existing.name,
        workspaceDir: payload.workspaceDir ?? existing.workspaceDir,
        linkedWorkspaceDirs: payload.linkedWorkspaceDirs ?? existing.linkedWorkspaceDirs ?? [],
        description: payload.description ?? existing.description,
        defaultMode: payload.defaultMode
          ? RunModeSchema.parse(payload.defaultMode)
          : existing.defaultMode,
        defaultDryRun: payload.defaultDryRun ?? existing.defaultDryRun,
        retrieval: payload.retrieval ? (payload.retrieval as never) : existing.retrieval
      });

      json(res, 200, {
        project
      });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  if (projectId && method === "DELETE") {
    try {
      await removeServerProject(projectId);
      json(res, 200, {
        ok: true
      });
      return true;
    } catch (error) {
      json(res, 404, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectIndexId = matchProjectPath(pathname, "index");
  if (projectIndexId && method === "POST") {
    const startedAt = Date.now();
    routeTrace("project/index:start", { projectId: projectIndexId });
    try {
      const payload = (await readJsonBody(req)) as {
        maxFiles?: number;
      };
      const result = await warmupServerProjectIndex({
        projectId: projectIndexId,
        maxFiles: payload.maxFiles
      });
      routeTrace("project/index:success", {
        projectId: projectIndexId,
        fileCount: result.fileCount,
        tookMs: Date.now() - startedAt
      });
      json(res, 200, result);
      return true;
    } catch (error) {
      routeTrace("project/index:failure", {
        projectId: projectIndexId,
        error: error instanceof Error ? error.message : String(error),
        tookMs: Date.now() - startedAt
      });
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectSearchId = matchProjectPath(pathname, "search");
  if (projectSearchId && method === "POST") {
    const startedAt = Date.now();
    routeTrace("project/search:start", { projectId: projectSearchId });
    try {
      const payload = (await readJsonBody(req)) as {
        query?: string;
        limit?: number;
        queryMode?: "query_then_search" | "search_only" | "query_only";
        maxFiles?: number;
      };

      const result = await searchServerProject({
        projectId: projectSearchId,
        query: payload.query ?? "",
        limit: payload.limit,
        queryMode: payload.queryMode,
        maxFiles: payload.maxFiles
      });
      routeTrace("project/search:success", {
        projectId: projectSearchId,
        provider: result.provider,
        hitCount: result.hits.length,
        tookMs: Date.now() - startedAt
      });
      json(res, 200, result);
      return true;
    } catch (error) {
      routeTrace("project/search:failure", {
        projectId: projectSearchId,
        error: error instanceof Error ? error.message : String(error),
        tookMs: Date.now() - startedAt
      });
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectAnalyzeId = matchProjectPath(pathname, "analyze");
  if (projectAnalyzeId && method === "POST") {
    const startedAt = Date.now();
    routeTrace("project/analyze:start", { projectId: projectAnalyzeId });
    try {
      const payload = (await readJsonBody(req)) as {
        maxFiles?: number;
      };
      const result = await analyzeServerProject({
        projectId: projectAnalyzeId,
        maxFiles: payload.maxFiles
      });
      routeTrace("project/analyze:success", {
        projectId: projectAnalyzeId,
        confidence: result.confidence,
        tookMs: Date.now() - startedAt
      });
      json(res, 200, result);
      return true;
    } catch (error) {
      routeTrace("project/analyze:failure", {
        projectId: projectAnalyzeId,
        error: error instanceof Error ? error.message : String(error),
        tookMs: Date.now() - startedAt
      });
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectAskId = matchProjectPath(pathname, "ask");
  if (projectAskId && method === "POST") {
    const startedAt = Date.now();
    routeTrace("project/ask:start", { projectId: projectAskId });
    try {
      const payload = (await readJsonBody(req)) as {
        question?: string;
        maxAttempts?: number;
        limit?: number;
        maxLlmCalls?: number;
        deterministicOnly?: boolean;
      };
      const result = await askServerProject({
        projectId: projectAskId,
        question: payload.question ?? "",
        maxAttempts: payload.maxAttempts,
        limit: payload.limit,
        maxLlmCalls: payload.maxLlmCalls,
        deterministicOnly: payload.deterministicOnly
      });
      routeTrace("project/ask:success", {
        projectId: projectAskId,
        confidence: result.confidence,
        attempts: result.attempts,
        llmCalls: result.diagnostics.llmCallCount,
        tookMs: Date.now() - startedAt
      });
      json(res, 200, result);
      return true;
    } catch (error) {
      routeTrace("project/ask:failure", {
        projectId: projectAskId,
        error: error instanceof Error ? error.message : String(error),
        tookMs: Date.now() - startedAt
      });
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectFeedbackId = matchProjectPath(pathname, "feedback");
  if (projectFeedbackId && method === "POST") {
    routeTrace("project/feedback:start", { projectId: projectFeedbackId });
    try {
      const payload = (await readJsonBody(req)) as {
        kind?: "ask" | "search";
        prompt?: string;
        questionType?: string;
        verdict?: "correct" | "partial" | "incorrect";
        scope?: "answer" | "evidence" | "node" | "edge" | "path" | "boundary";
        strength?: "weak" | "normal" | "strong";
        matchedKnowledgeIds?: string[];
        matchedRetrievalUnitIds?: string[];
        targets?: Array<{
          kind?: "node" | "edge" | "path" | "retrieval-unit" | "knowledge" | "evidence-path" | "boundary";
          id?: string;
          label?: string;
          nodeIds?: string[];
          edgeIds?: string[];
          evidencePath?: string;
          notes?: string;
        }>;
        notes?: string;
      };
      const normalizedTargets = (payload.targets ?? []).flatMap((target) =>
        target.kind
          ? [
              {
                kind: target.kind,
                id: target.id,
                label: target.label,
                nodeIds: target.nodeIds,
                edgeIds: target.edgeIds,
                evidencePath: target.evidencePath,
                notes: target.notes
              }
            ]
          : []
      );
      const result = await recordServerProjectFeedback({
        projectId: projectFeedbackId,
        kind: payload.kind ?? "ask",
        prompt: payload.prompt ?? "",
        questionType: payload.questionType ?? "domain_capability_overview",
        verdict: payload.verdict ?? "partial",
        scope: payload.scope,
        strength: payload.strength,
        matchedKnowledgeIds: payload.matchedKnowledgeIds ?? [],
        matchedRetrievalUnitIds: payload.matchedRetrievalUnitIds ?? [],
        targets: normalizedTargets,
        notes: payload.notes
      });
      routeTrace("project/feedback:success", {
        projectId: projectFeedbackId,
        learnedKnowledgeUpdated: result.learnedKnowledgeUpdated,
        matchedKnowledgeIds: result.artifact.matchedKnowledgeIds
      });
      json(res, 201, result);
      return true;
    } catch (error) {
      routeTrace("project/feedback:failure", {
        projectId: projectFeedbackId,
        error: error instanceof Error ? error.message : String(error)
      });
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectOntologyId = matchProjectPath(pathname, "ontology");
  if (projectOntologyId && method === "GET") {
    routeTrace("project/ontology:get:start", { projectId: projectOntologyId });
    try {
      const projectionId = url.searchParams.get("projectionId") ?? undefined;
      const nodeType = url.searchParams.get("nodeType") ?? undefined;
      const search = url.searchParams.get("search") ?? undefined;
      const nodeLimitRaw = url.searchParams.get("nodeLimit");
      const edgeLimitRaw = url.searchParams.get("edgeLimit");
      const result = await getServerProjectOntologyView({
        projectId: projectOntologyId,
        projectionId,
        nodeType,
        search,
        nodeLimit: nodeLimitRaw ? Number(nodeLimitRaw) : undefined,
        edgeLimit: edgeLimitRaw ? Number(edgeLimitRaw) : undefined
      });
      routeTrace("project/ontology:get:success", {
        projectId: projectOntologyId,
        projectionId: result.ontology.filters.selectedProjectionId,
        nodeCount: result.ontology.selectedProjection.nodes.length,
        edgeCount: result.ontology.selectedProjection.edges.length
      });
      json(res, 200, result);
      return true;
    } catch (error) {
      routeTrace("project/ontology:get:failure", {
        projectId: projectOntologyId,
        error: error instanceof Error ? error.message : String(error)
      });
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectOntologyInputId = matchProjectPath(pathname, "ontology-inputs");
  if (projectOntologyInputId && method === "POST") {
    routeTrace("project/ontology-inputs:start", { projectId: projectOntologyInputId });
    try {
      const payload = (await readJsonBody(req)) as {
        kind?: "note" | "structured" | "csv";
        scope?: "general" | "domain" | "subdomain" | "channel" | "action" | "module-role" | "process-role" | "boundary" | "path";
        title?: string;
        message?: string;
        tags?: string[];
        positiveExamples?: string[];
        negativeExamples?: string[];
        boundaryNotes?: string[];
        relatedNodeIds?: string[];
        relatedEdgeIds?: string[];
        relatedPathIds?: string[];
        relatedKnowledgeIds?: string[];
        csvText?: string;
        notes?: string;
      };
      const result = await recordServerProjectOntologyInput({
        projectId: projectOntologyInputId,
        kind: payload.kind ?? "note",
        scope: payload.scope ?? "general",
        title: payload.title ?? "",
        message: payload.message,
        tags: payload.tags ?? [],
        positiveExamples: payload.positiveExamples ?? [],
        negativeExamples: payload.negativeExamples ?? [],
        boundaryNotes: payload.boundaryNotes ?? [],
        relatedNodeIds: payload.relatedNodeIds ?? [],
        relatedEdgeIds: payload.relatedEdgeIds ?? [],
        relatedPathIds: payload.relatedPathIds ?? [],
        relatedKnowledgeIds: payload.relatedKnowledgeIds ?? [],
        csvText: payload.csvText,
        notes: payload.notes
      });
      routeTrace("project/ontology-inputs:success", {
        projectId: projectOntologyInputId,
        totalInputs: result.summary.totalInputs,
        csvRows: result.summary.csvRowCount
      });
      json(res, 201, result);
      return true;
    } catch (error) {
      routeTrace("project/ontology-inputs:failure", {
        projectId: projectOntologyInputId,
        error: error instanceof Error ? error.message : String(error)
      });
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectOntologyDraftId = matchProjectPath(pathname, "ontology-draft");
  if (projectOntologyDraftId && method === "GET") {
    routeTrace("project/ontology-draft:get:start", { projectId: projectOntologyDraftId });
    try {
      const result = await getServerProjectOntologyDraft({ projectId: projectOntologyDraftId });
      routeTrace("project/ontology-draft:get:success", {
        projectId: projectOntologyDraftId,
        hasDraft: Boolean(result.draft),
        historyCount: result.history.length
      });
      json(res, 200, result);
      return true;
    } catch (error) {
      routeTrace("project/ontology-draft:get:failure", {
        projectId: projectOntologyDraftId,
        error: error instanceof Error ? error.message : String(error)
      });
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  if (projectOntologyDraftId && method === "POST") {
    routeTrace("project/ontology-draft:save:start", { projectId: projectOntologyDraftId });
    try {
      const payload = (await readJsonBody(req)) as {
        notes?: string;
        operations?: Array<{
          id?: string;
          createdAt?: string;
          kind?: "add-node" | "remove-node" | "add-edge" | "remove-edge" | "override-node" | "override-edge";
          notes?: string;
          nodeId?: string;
          nodeType?: string;
          label?: string;
          summary?: string;
          metadata?: Record<string, unknown>;
          attributes?: Record<string, unknown>;
          targetId?: string;
          edgeId?: string;
          edgeType?: string;
          fromId?: string;
          toId?: string;
        }>;
      };
      const operations = (payload.operations ?? []).flatMap((operation) => (operation.kind ? [operation] : []));
      const result = await saveServerProjectOntologyDraft({
        projectId: projectOntologyDraftId,
        operations,
        notes: payload.notes
      });
      routeTrace("project/ontology-draft:save:success", {
        projectId: projectOntologyDraftId,
        draftVersion: result.draft?.draftVersion ?? null,
        operationCount: result.draft?.summary?.operationCount ?? 0
      });
      json(res, 201, result);
      return true;
    } catch (error) {
      routeTrace("project/ontology-draft:save:failure", {
        projectId: projectOntologyDraftId,
        error: error instanceof Error ? error.message : String(error)
      });
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  const projectOntologyDraftEvaluateId = matchProjectPath(pathname, "ontology-draft/evaluate");
  if (projectOntologyDraftEvaluateId && method === "POST") {
    routeTrace("project/ontology-draft:evaluate:start", { projectId: projectOntologyDraftEvaluateId });
    try {
      const result = await evaluateServerProjectOntologyDraft({ projectId: projectOntologyDraftEvaluateId });
      routeTrace("project/ontology-draft:evaluate:success", {
        projectId: projectOntologyDraftEvaluateId,
        recommendation: result.evaluation.summary.recommendation,
        riskBand: result.evaluation.summary.riskBand
      });
      json(res, 200, result);
      return true;
    } catch (error) {
      routeTrace("project/ontology-draft:evaluate:failure", {
        projectId: projectOntologyDraftEvaluateId,
        error: error instanceof Error ? error.message : String(error)
      });
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  const projectOntologyDraftRevertId = matchProjectPath(pathname, "ontology-draft/revert");
  if (projectOntologyDraftRevertId && method === "POST") {
    routeTrace("project/ontology-draft:revert:start", { projectId: projectOntologyDraftRevertId });
    try {
      const payload = (await readJsonBody(req)) as { targetVersion?: number };
      const result = await revertServerProjectOntologyDraft({
        projectId: projectOntologyDraftRevertId,
        targetVersion: Number.isFinite(payload.targetVersion) ? payload.targetVersion : undefined
      });
      routeTrace("project/ontology-draft:revert:success", {
        projectId: projectOntologyDraftRevertId,
        draftVersion: result.draft?.draftVersion ?? null,
        historyCount: result.history.length
      });
      json(res, 200, result);
      return true;
    } catch (error) {
      routeTrace("project/ontology-draft:revert:failure", {
        projectId: projectOntologyDraftRevertId,
        error: error instanceof Error ? error.message : String(error)
      });
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  const projectReplayId = matchProjectPath(pathname, "replay");
  if (projectReplayId && method === "POST") {
    routeTrace("project/replay:start", { projectId: projectReplayId });
    try {
      const payload = (await readJsonBody(req)) as {
        limit?: number;
        kinds?: Array<"ask" | "search">;
      };
      const result = await executeServerProjectReplay({
        projectId: projectReplayId,
        limit: payload.limit,
        kinds: payload.kinds
      });
      routeTrace("project/replay:success", {
        projectId: projectReplayId,
        executedCount: result.executedCount,
        totalCandidates: result.totalCandidates
      });
      json(res, 200, result);
      return true;
    } catch (error) {
      routeTrace("project/replay:failure", {
        projectId: projectReplayId,
        error: error instanceof Error ? error.message : String(error)
      });
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectFileId = matchProjectPath(pathname, "file");
  if (projectFileId && method === "GET") {
    try {
      const filePath = url.searchParams.get("path") ?? "";
      const maxBytesRaw = url.searchParams.get("maxBytes");
      const maxBytes = maxBytesRaw ? Number.parseInt(maxBytesRaw, 10) : undefined;
      const result = await readServerProjectFile({
        projectId: projectFileId,
        filePath,
        maxBytes: Number.isFinite(maxBytes) ? maxBytes : undefined
      });
      json(res, 200, result);
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectDebugId = matchProjectPath(pathname, "debug");
  if (projectDebugId && method === "GET") {
    try {
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
      const events = await listProjectDebugEvents({
        projectId: projectDebugId,
        limit: Number.isFinite(limit) ? limit : undefined
      });
      json(res, 200, {
        projectId: projectDebugId,
        events
      });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const projectRunId = matchProjectPath(pathname, "runs");
  if (projectRunId && method === "POST") {
    const startedAt = Date.now();
    routeTrace("project/run:start", { projectId: projectRunId });
    try {
      const payload = (await readJsonBody(req)) as {
        task?: string;
        mode?: string;
        input?: unknown;
        dryRun?: boolean;
        retrieval?: {
          providerPriority?: Array<"qmd" | "lexical" | "semantic" | "hybrid">;
          topK?: Partial<Record<"qmd" | "lexical" | "semantic" | "hybrid" | "final", number>>;
          timeoutMs?: Partial<Record<"qmd" | "semantic" | "provider", number>>;
          stageTokenCaps?: Partial<Record<"PLAN" | "IMPLEMENT" | "VERIFY", number>>;
          embedding?: {
            enabled?: boolean;
            endpoint?: string;
            healthPath?: string;
            embedPath?: string;
            model?: string;
            timeoutMs?: number;
            maxBatchSize?: number;
            cachePath?: string;
          };
          lifecycle?: {
            chunkVersion?: string;
            retrievalVersion?: string;
            autoReindexOnStale?: boolean;
          };
          qmd?: {
            enabled?: boolean;
            command?: string;
            collectionName?: string;
            indexName?: string;
            mask?: string;
            queryMode?: "query_then_search" | "search_only" | "query_only";
            configDir?: string;
            cacheHome?: string;
            indexPath?: string;
            syncIntervalMs?: number;
            forceFailure?: boolean;
          };
        };
      };

      const project = await getServerProject(projectRunId);
      if (!project) {
        json(res, 404, {
          error: `project not found: ${projectRunId}`
        });
        return true;
      }

      if (payload.input) {
        AnalyzeInputSchema.parse(payload.input);
      }

      if (typeof payload.task !== "string" && !payload.input) {
        json(res, 400, {
          error: "task or input is required"
        });
        return true;
      }

      const llmSettings = await loadLlmRuntimeSettings();
      const selectedModel = resolveLlmModelProfile(llmSettings, project.llm?.modelId);
      const derivedStageCaps = deriveStageTokenCapsFromModel({
        model: selectedModel,
        usageRatio: llmSettings.continuationUsageRatio
      });

      const mergedRetrieval = {
        ...(project.retrieval ?? {}),
        ...(payload.retrieval ?? {}),
        stageTokenCaps: {
          ...derivedStageCaps,
          ...(project.retrieval?.stageTokenCaps ?? {}),
          ...(payload.retrieval?.stageTokenCaps ?? {})
        },
        qmd: {
          ...(project.retrieval?.qmd ?? {}),
          ...(payload.retrieval?.qmd ?? {})
        }
      };

      const run = await startBackgroundRun({
        task: payload.task,
        mode: payload.mode ? RunModeSchema.parse(payload.mode) : project.defaultMode,
        input: payload.input as never,
        retrieval: mergedRetrieval as never,
        llm: {
          model: selectedModel.id,
          maxTokens: selectedModel.maxOutputTokens,
          contextWindowTokens: selectedModel.contextWindowTokens,
          contextUsageRatio: llmSettings.continuationUsageRatio,
          retrySameTask: llmSettings.retryPolicy.sameTaskRetries,
          retryChangedTask: llmSettings.retryPolicy.changedTaskRetries
        },
        dryRun: payload.dryRun ?? project.defaultDryRun,
        workspaceDir: project.workspaceDir
      });

      routeTrace("project/run:accepted", {
        projectId: projectRunId,
        runId: run.runId,
        tookMs: Date.now() - startedAt
      });

      json(res, 202, {
        runId: run.runId,
        status: run.status,
        createdAt: run.createdAt,
        projectId: project.id,
        workspaceDir: project.workspaceDir
      });
      return true;
    } catch (error) {
      routeTrace("project/run:failure", {
        projectId: projectRunId,
        error: error instanceof Error ? error.message : String(error),
        tookMs: Date.now() - startedAt
      });
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  if (method === "GET" && pathname === "/api/fs/children") {
    try {
      const targetPath = resolveBrowsePath(url.searchParams.get("path"));
      const targetStat = await fs.stat(targetPath);
      if (!targetStat.isDirectory()) {
        json(res, 400, { error: `Not a directory: ${targetPath}` });
        return true;
      }

      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          path: path.join(targetPath, entry.name)
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const parent = path.dirname(targetPath);

      json(res, 200, {
        path: targetPath,
        parent: parent !== targetPath ? parent : null,
        cwd: process.cwd(),
        home: process.env.HOME ?? null,
        entries: directories
      });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  if (method === "POST" && pathname === "/api/runs") {
    try {
      const payload = (await readJsonBody(req)) as {
        task?: string;
        mode?: string;
        input?: unknown;
        availableLibraries?: string[];
        availableLibrariesFile?: string;
        availableLibrariesUrl?: string;
        files?: string[];
        constraints?: string[];
        symbols?: string[];
        contextTier?: "small" | "mid" | "big";
        contextTokenBudget?: number;
        retryPolicy?: {
          maxAttempts?: number;
          backoffMs?: number;
          sameFailureLimit?: number;
          rollbackOnVerifyFail?: boolean;
        };
        retrieval?: {
          providerPriority?: Array<"qmd" | "lexical" | "semantic" | "hybrid">;
          topK?: Partial<Record<"qmd" | "lexical" | "semantic" | "hybrid" | "final", number>>;
          timeoutMs?: Partial<Record<"qmd" | "semantic" | "provider", number>>;
          stageTokenCaps?: Partial<Record<"PLAN" | "IMPLEMENT" | "VERIFY", number>>;
          embedding?: {
            enabled?: boolean;
            endpoint?: string;
            healthPath?: string;
            embedPath?: string;
            model?: string;
            timeoutMs?: number;
            maxBatchSize?: number;
            cachePath?: string;
          };
          lifecycle?: {
            chunkVersion?: string;
            retrievalVersion?: string;
            autoReindexOnStale?: boolean;
          };
          qmd?: {
            enabled?: boolean;
            command?: string;
            collectionName?: string;
            indexName?: string;
            mask?: string;
            queryMode?: "query_then_search" | "search_only" | "query_only";
            configDir?: string;
            cacheHome?: string;
            indexPath?: string;
            syncIntervalMs?: number;
            forceFailure?: boolean;
          };
        };
        dryRun?: boolean;
        workspaceDir?: string;
      };

      if (payload.input) {
        AnalyzeInputSchema.parse(payload.input);
      }

      if (typeof payload.task !== "string" && !payload.input) {
        json(res, 400, {
          error: "task or input is required"
        });
        return true;
      }

      const run = await startBackgroundRun({
        task: payload.task,
        mode: payload.mode ? RunModeSchema.parse(payload.mode) : undefined,
        input: payload.input as never,
        availableLibraries: payload.availableLibraries,
        availableLibrariesFile: payload.availableLibrariesFile,
        availableLibrariesUrl: payload.availableLibrariesUrl,
        files: payload.files,
        constraints: payload.constraints,
        symbols: payload.symbols,
        contextTier: payload.contextTier,
        contextTokenBudget: payload.contextTokenBudget,
        retryPolicy: payload.retryPolicy as never,
        retrieval: payload.retrieval as never,
        dryRun: payload.dryRun,
        workspaceDir: payload.workspaceDir
      });

      json(res, 202, {
        runId: run.runId,
        status: run.status,
        createdAt: run.createdAt
      });
      return true;
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  const runStatusId = matchRunPath(pathname, "");
  if (method === "GET" && runStatusId) {
    const run = getRunRecord(runStatusId);
    if (!run) {
      json(res, 404, {
        error: `run not found: ${runStatusId}`
      });
      return true;
    }

    json(res, 200, run);
    return true;
  }

  const runEventsId = matchRunPath(pathname, "events");
  if (method === "GET" && runEventsId) {
    const run = getRunRecord(runEventsId);
    if (!run) {
      json(res, 404, {
        error: `run not found: ${runEventsId}`
      });
      return true;
    }

    json(res, 200, {
      runId: runEventsId,
      events: listRunEvents(runEventsId)
    });
    return true;
  }

  const runArtifactsId = matchRunPath(pathname, "artifacts");
  if (method === "GET" && runArtifactsId) {
    try {
      const artifacts = await getRunArtifacts(runArtifactsId);
      json(res, 200, artifacts);
    } catch (error) {
      json(res, 404, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  return false;
}
