import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { inspectContext } from "../context/packer.js";
import { RetrievalConfigOverrideSchema, RunModeSchema } from "../core/types.js";
import { resolveRetrievalConfig } from "../retrieval/config.js";
import {
  buildQmdQueryFromSignals,
  ensureQmdIndexed,
  queryQmd,
  resolveQmdRuntime
} from "../retrieval/qmd-cli.js";

const ServerProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  workspaceDir: z.string().min(1),
  description: z.string().default(""),
  defaultMode: RunModeSchema.default("feature"),
  defaultDryRun: z.boolean().default(false),
  retrieval: RetrievalConfigOverrideSchema.optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastIndexedAt: z.string().optional(),
  lastIndexSummary: z.string().optional()
});

const ServerProjectStoreSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().min(1),
  projects: z.array(ServerProjectSchema)
});

const UpsertServerProjectInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  workspaceDir: z.string().min(1),
  description: z.string().optional(),
  defaultMode: RunModeSchema.optional(),
  defaultDryRun: z.boolean().optional(),
  retrieval: RetrievalConfigOverrideSchema.optional()
});

export type ServerProject = z.infer<typeof ServerProjectSchema>;
export type UpsertServerProjectInput = z.infer<typeof UpsertServerProjectInputSchema>;

export interface ProjectWarmupResult {
  project: ServerProject;
  fileCount: number;
  changedFiles: number;
  reusedFiles: number;
  selectedProvider: string;
  fallbackUsed: boolean;
  providerResults: Array<{
    provider: string;
    status: string;
    tookMs: number;
    error?: string;
  }>;
}

export interface ProjectSearchHit {
  path: string;
  score: number;
  source: "qmd" | "lexical";
  title?: string;
  snippet?: string;
}

export interface ProjectSearchResult {
  project: ServerProject;
  query: string;
  provider: "qmd" | "lexical";
  fallbackUsed: boolean;
  modeUsed?: "query" | "search";
  hits: ProjectSearchHit[];
  diagnostics: {
    qmdStatus?: "ok" | "empty" | "failed" | "skipped";
    qmdErrors?: string[];
    qmdIndexMethod?: "add" | "update" | "cached";
    qmdQueryMode?: "query_then_search" | "search_only" | "query_only";
    qmdCommand?: string;
    fileCount?: number;
  };
}

interface ServerProjectStore {
  version: 1;
  updatedAt: string;
  projects: ServerProject[];
}

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".pnpm-store",
  ".ohmyqwen",
  ".idea",
  ".vscode"
]);

const SEARCHABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".java",
  ".kt",
  ".kts",
  ".xml",
  ".yml",
  ".yaml",
  ".py",
  ".go",
  ".rs",
  ".sql",
  ".sh",
  ".txt",
  ".toml",
  ".ini"
]);

const MAX_FILE_SIZE_BYTES = 512 * 1024;

let cachedStore: ServerProjectStore | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function storePath(): string {
  return path.resolve(process.cwd(), ".ohmyqwen", "server", "projects.json");
}

async function loadStore(): Promise<ServerProjectStore> {
  if (cachedStore) {
    return {
      version: cachedStore.version,
      updatedAt: cachedStore.updatedAt,
      projects: [...cachedStore.projects]
    };
  }

  const filePath = storePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = ServerProjectStoreSchema.parse(JSON.parse(raw));
    const normalized: ServerProjectStore = {
      version: 1,
      updatedAt: parsed.updatedAt,
      projects: parsed.projects
    };
    cachedStore = normalized;
    return {
      version: normalized.version,
      updatedAt: normalized.updatedAt,
      projects: [...normalized.projects]
    };
  } catch {
    const fallback: ServerProjectStore = {
      version: 1,
      updatedAt: nowIso(),
      projects: []
    };
    cachedStore = fallback;
    return {
      version: fallback.version,
      updatedAt: fallback.updatedAt,
      projects: []
    };
  }
}

async function saveStore(store: ServerProjectStore): Promise<void> {
  const next: ServerProjectStore = {
    version: 1,
    updatedAt: nowIso(),
    projects: [...store.projects].sort((a, b) =>
      a.updatedAt === b.updatedAt ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt)
    )
  };

  const filePath = storePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  cachedStore = next;
}

async function ensureWorkspaceDir(workspaceDir: string): Promise<string> {
  const trimmed = workspaceDir.trim();
  if (!trimmed) {
    throw new Error("workspaceDir is required");
  }

  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(process.cwd(), trimmed);

  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`workspaceDir is not a directory: ${resolved}`);
  }

  return resolved;
}

function toProject(value: ServerProject): ServerProject {
  return {
    ...value,
    retrieval: value.retrieval ? { ...value.retrieval } : undefined
  };
}

function toSearchTokens(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length >= 2)
    )
  ).slice(0, 24);
}

function isSearchableFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SEARCHABLE_EXTENSIONS.has(ext);
}

async function collectProjectFiles(workspaceDir: string, maxFiles = 10_000): Promise<string[]> {
  const queue: string[] = [workspaceDir];
  const results: string[] = [];

  while (queue.length > 0 && results.length < maxFiles) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= maxFiles) {
        break;
      }

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }

        if (entry.name.startsWith(".")) {
          continue;
        }

        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!isSearchableFile(entry.name)) {
        continue;
      }

      results.push(path.relative(workspaceDir, fullPath));
    }
  }

  return results;
}

async function readTextFileSafe(filePath: string): Promise<string | undefined> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return undefined;
  }

  if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) {
    return undefined;
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw;
  } catch {
    return undefined;
  }
}

function makeSnippet(content: string, token: string): string | undefined {
  const lines = content.split("\n");
  const index = lines.findIndex((line) => line.toLowerCase().includes(token));
  if (index < 0) {
    return undefined;
  }

  return lines[index]?.trim().slice(0, 180);
}

async function lexicalSearch(options: {
  workspaceDir: string;
  files: string[];
  query: string;
  limit: number;
}): Promise<ProjectSearchHit[]> {
  const tokens = toSearchTokens(options.query);
  if (tokens.length === 0) {
    return [];
  }

  const hits: ProjectSearchHit[] = [];

  for (const relativePath of options.files) {
    const normalizedPath = relativePath.toLowerCase();
    let score = 0;

    for (const token of tokens) {
      if (normalizedPath.includes(token)) {
        score += 4;
      }
    }

    const absolutePath = path.resolve(options.workspaceDir, relativePath);
    const content = await readTextFileSafe(absolutePath);
    if (content) {
      const lowered = content.toLowerCase();
      for (const token of tokens) {
        if (lowered.includes(token)) {
          score += 1.5;
        }
      }

      if (score > 0) {
        hits.push({
          path: relativePath,
          score,
          source: "lexical",
          snippet: makeSnippet(content, tokens[0])
        });
      }
      continue;
    }

    if (score > 0) {
      hits.push({
        path: relativePath,
        score,
        source: "lexical"
      });
    }
  }

  hits.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.path.localeCompare(b.path)));
  return hits.slice(0, options.limit);
}

export async function listServerProjects(): Promise<ServerProject[]> {
  const store = await loadStore();
  return store.projects.map((project) => toProject(project));
}

export async function getServerProject(id: string): Promise<ServerProject | undefined> {
  const store = await loadStore();
  const found = store.projects.find((project) => project.id === id);
  return found ? toProject(found) : undefined;
}

export async function upsertServerProject(input: UpsertServerProjectInput): Promise<ServerProject> {
  const parsed = UpsertServerProjectInputSchema.parse(input);
  const resolvedWorkspace = await ensureWorkspaceDir(parsed.workspaceDir);

  const store = await loadStore();
  const now = nowIso();

  const index = parsed.id
    ? store.projects.findIndex((project) => project.id === parsed.id)
    : -1;

  if (index >= 0) {
    const existing = store.projects[index];
    const updated: ServerProject = {
      ...existing,
      name: parsed.name,
      workspaceDir: resolvedWorkspace,
      description: parsed.description ?? existing.description,
      defaultMode: parsed.defaultMode ?? existing.defaultMode,
      defaultDryRun: parsed.defaultDryRun ?? existing.defaultDryRun,
      retrieval: parsed.retrieval ?? existing.retrieval,
      updatedAt: now
    };

    store.projects[index] = ServerProjectSchema.parse(updated);
    await saveStore(store);
    return toProject(store.projects[index]);
  }

  const created: ServerProject = ServerProjectSchema.parse({
    id: parsed.id ?? randomUUID().slice(0, 12),
    name: parsed.name,
    workspaceDir: resolvedWorkspace,
    description: parsed.description ?? "",
    defaultMode: parsed.defaultMode ?? "feature",
    defaultDryRun: parsed.defaultDryRun ?? false,
    retrieval: parsed.retrieval,
    createdAt: now,
    updatedAt: now
  });

  store.projects.push(created);
  await saveStore(store);
  return toProject(created);
}

export async function removeServerProject(id: string): Promise<void> {
  const store = await loadStore();
  const nextProjects = store.projects.filter((project) => project.id !== id);
  if (nextProjects.length === store.projects.length) {
    throw new Error(`project not found: ${id}`);
  }

  store.projects = nextProjects;
  await saveStore(store);
}

async function patchProject(id: string, patch: Partial<ServerProject>): Promise<ServerProject> {
  const store = await loadStore();
  const index = store.projects.findIndex((project) => project.id === id);
  if (index < 0) {
    throw new Error(`project not found: ${id}`);
  }

  const current = store.projects[index];
  const next = ServerProjectSchema.parse({
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: nowIso()
  });

  store.projects[index] = next;
  await saveStore(store);
  return toProject(next);
}

export async function warmupServerProjectIndex(options: {
  projectId: string;
  maxFiles?: number;
}): Promise<ProjectWarmupResult> {
  const project = await getServerProject(options.projectId);
  if (!project) {
    throw new Error(`project not found: ${options.projectId}`);
  }

  const files = await collectProjectFiles(project.workspaceDir, options.maxFiles ?? 5_000);
  if (files.length === 0) {
    const updatedProject = await patchProject(project.id, {
      lastIndexedAt: nowIso(),
      lastIndexSummary: "indexed files=0"
    });

    return {
      project: updatedProject,
      fileCount: 0,
      changedFiles: 0,
      reusedFiles: 0,
      selectedProvider: "lexical",
      fallbackUsed: false,
      providerResults: []
    };
  }

  const retrievalConfig = await resolveRetrievalConfig(project.workspaceDir, project.retrieval);
  const inspection = await inspectContext({
    cwd: project.workspaceDir,
    files,
    task: `warmup project index: ${project.name}`,
    tier: "small",
    tokenBudget: 800,
    stage: "PLAN",
    retrievalConfig
  });

  const providerResults = inspection.retrieval.providerResults.map((result) => ({
    provider: result.provider,
    status: result.status,
    tookMs: result.tookMs,
    error: result.error
  }));

  const updatedProject = await patchProject(project.id, {
    lastIndexedAt: nowIso(),
    lastIndexSummary: `indexed files=${files.length} changed=${inspection.changedFiles.length} reused=${inspection.reusedFiles.length}`
  });

  return {
    project: updatedProject,
    fileCount: files.length,
    changedFiles: inspection.changedFiles.length,
    reusedFiles: inspection.reusedFiles.length,
    selectedProvider: inspection.retrieval.selectedProvider,
    fallbackUsed: inspection.retrieval.fallbackUsed,
    providerResults
  };
}

export async function searchServerProject(options: {
  projectId: string;
  query: string;
  limit?: number;
  queryMode?: "query_then_search" | "search_only" | "query_only";
  maxFiles?: number;
}): Promise<ProjectSearchResult> {
  const project = await getServerProject(options.projectId);
  if (!project) {
    throw new Error(`project not found: ${options.projectId}`);
  }

  const query = String(options.query || "").trim();
  if (!query) {
    throw new Error("query is required");
  }

  const limit = Math.max(1, Math.min(200, options.limit ?? 20));

  const qmdOverrides = options.queryMode
    ? {
        qmd: {
          queryMode: options.queryMode
        }
      }
    : undefined;

  const retrievalOverrides = {
    ...(project.retrieval ?? {}),
    ...(qmdOverrides ?? {}),
    qmd: {
      ...(project.retrieval?.qmd ?? {}),
      ...(qmdOverrides?.qmd ?? {})
    }
  };

  const retrievalConfig = await resolveRetrievalConfig(project.workspaceDir, retrievalOverrides);

  const files = await collectProjectFiles(project.workspaceDir, options.maxFiles ?? 5_000);

  if (retrievalConfig.qmd.enabled) {
    try {
      const runtime = resolveQmdRuntime({
        cwd: project.workspaceDir,
        command: retrievalConfig.qmd.command,
        collectionName: retrievalConfig.qmd.collectionName,
        indexName: retrievalConfig.qmd.indexName,
        mask: retrievalConfig.qmd.mask,
        queryMode: retrievalConfig.qmd.queryMode,
        configDir: retrievalConfig.qmd.configDir,
        cacheHome: retrievalConfig.qmd.cacheHome,
        indexPath: retrievalConfig.qmd.indexPath,
        timeoutMs: retrievalConfig.timeoutMs.qmd,
        syncIntervalMs: retrievalConfig.qmd.syncIntervalMs
      });

      const indexed = await ensureQmdIndexed(runtime);
      const qmdQuery = buildQmdQueryFromSignals({
        task: query
      });
      const qmdResult = await queryQmd({
        runtime,
        query: qmdQuery,
        limit
      });

      if (qmdResult.status === "ok") {
        return {
          project,
          query,
          provider: "qmd",
          fallbackUsed: false,
          modeUsed: qmdResult.mode,
          hits: qmdResult.hits.map((hit) => ({
            path: hit.path,
            score: hit.score,
            source: "qmd",
            title: hit.title,
            snippet: hit.snippet
          })),
          diagnostics: {
            qmdStatus: qmdResult.status,
            qmdErrors: qmdResult.errors,
            qmdIndexMethod: indexed.method,
            qmdQueryMode: retrievalConfig.qmd.queryMode,
            qmdCommand: retrievalConfig.qmd.command,
            fileCount: files.length
          }
        };
      }

      const lexicalHits = await lexicalSearch({
        workspaceDir: project.workspaceDir,
        files,
        query,
        limit
      });

      return {
        project,
        query,
        provider: "lexical",
        fallbackUsed: true,
        hits: lexicalHits,
        diagnostics: {
          qmdStatus: qmdResult.status,
          qmdErrors: qmdResult.errors,
          qmdIndexMethod: indexed.method,
          qmdQueryMode: retrievalConfig.qmd.queryMode,
          qmdCommand: retrievalConfig.qmd.command,
          fileCount: files.length
        }
      };
    } catch (error) {
      const lexicalHits = await lexicalSearch({
        workspaceDir: project.workspaceDir,
        files,
        query,
        limit
      });

      return {
        project,
        query,
        provider: "lexical",
        fallbackUsed: true,
        hits: lexicalHits,
        diagnostics: {
          qmdStatus: "failed",
          qmdErrors: [error instanceof Error ? error.message : String(error)],
          qmdQueryMode: retrievalConfig.qmd.queryMode,
          qmdCommand: retrievalConfig.qmd.command,
          fileCount: files.length
        }
      };
    }
  }

  const lexicalHits = await lexicalSearch({
    workspaceDir: project.workspaceDir,
    files,
    query,
    limit
  });

  return {
    project,
    query,
    provider: "lexical",
    fallbackUsed: false,
    hits: lexicalHits,
    diagnostics: {
      qmdStatus: "skipped",
      fileCount: files.length
    }
  };
}
