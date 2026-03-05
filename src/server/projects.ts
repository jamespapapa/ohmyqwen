import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { inspectContext } from "../context/packer.js";
import { RetrievalConfigOverrideSchema, RunModeSchema } from "../core/types.js";
import { OpenAICompatibleLlmClient } from "../llm/client.js";
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
  reasons?: string[];
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

export interface ProjectFileDetailResult {
  project: ServerProject;
  path: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
}

export interface ProjectAnalysisResult {
  project: ServerProject;
  analyzedAt: string;
  memoryHome: string;
  memoryFiles: string[];
  summary: string;
  architecture: string[];
  keyModules: Array<{
    name: string;
    path: string;
    role: string;
    confidence: number;
  }>;
  risks: string[];
  confidence: number;
  evidence: string[];
  diagnostics: {
    warmup: ProjectWarmupResult;
    lowConfidenceSignals: string[];
    usedFallback: boolean;
  };
}

export interface ProjectAskResponse {
  project: ServerProject;
  question: string;
  answer: string;
  confidence: number;
  qualityGatePassed: boolean;
  attempts: number;
  evidence: string[];
  caveats: string[];
  retrieval: {
    provider: "qmd" | "lexical";
    fallbackUsed: boolean;
    hitCount: number;
    topConfidence: number;
  };
  diagnostics: {
    lowConfidenceMode: boolean;
    qualityGateFailures: string[];
    usedFallback: boolean;
    memoryFiles: string[];
  };
}

interface ServerProjectStore {
  version: 1;
  updatedAt: string;
  projects: ServerProject[];
}

interface ProjectDebugEvent {
  timestamp: string;
  projectId: string;
  stage: "analyze" | "ask" | "search" | "index" | "file";
  status: "start" | "success" | "failure" | "info";
  message: string;
  metadata?: Record<string, unknown>;
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
const MAX_DETAIL_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_ASK_MAX_ATTEMPTS = 3;
const ANALYSIS_MEMORY_DIR = "project-analysis";
const QUERY_MEMORY_DIR = "query-reports";

let cachedStore: ServerProjectStore | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function storePath(): string {
  return path.resolve(process.cwd(), ".ohmyqwen", "server", "projects.json");
}

function debugLogPath(): string {
  return path.resolve(process.cwd(), ".ohmyqwen", "server", "project-debug-events.jsonl");
}

async function appendProjectDebugEvent(event: ProjectDebugEvent): Promise<void> {
  const line = `${JSON.stringify(event)}\n`;
  const filePath = debugLogPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, line, "utf8");
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

function resolveProjectHome(workspaceDir: string): string {
  const envProjectHome = process.env.OHMYQWEN_PROJECT_HOME?.trim();
  if (!envProjectHome) {
    return workspaceDir;
  }

  return path.isAbsolute(envProjectHome)
    ? path.resolve(envProjectHome)
    : path.resolve(workspaceDir, envProjectHome);
}

function resolveMemoryHome(workspaceDir: string): string {
  const projectHome = resolveProjectHome(workspaceDir);
  const envMemoryHome = process.env.OHMYQWEN_MEMORY_HOME?.trim();
  if (!envMemoryHome) {
    return path.resolve(projectHome, "memory");
  }

  return path.isAbsolute(envMemoryHome)
    ? path.resolve(envMemoryHome)
    : path.resolve(projectHome, envMemoryHome);
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
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

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
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

function normalizeHitConfidence(hit: ProjectSearchHit): number {
  const divisor = hit.source === "qmd" ? 10 : 20;
  const normalized = hit.score / divisor;
  return Math.max(0, Math.min(1, Number.isFinite(normalized) ? normalized : 0));
}

function summarizeLowConfidenceSignals(hits: ProjectSearchHit[]): string[] {
  if (hits.length === 0) {
    return ["검색 결과가 비어있어 누락 가능성이 높습니다."];
  }

  const topConfidence = normalizeHitConfidence(hits[0]);
  const avgConfidence =
    hits.reduce((sum, hit) => sum + normalizeHitConfidence(hit), 0) / Math.max(1, hits.length);
  const warnings: string[] = [];

  if (topConfidence < 0.35) {
    warnings.push("상위 결과 confidence가 낮아 핵심 근거 누락 가능성이 있습니다.");
  }
  if (avgConfidence < 0.25) {
    warnings.push("전체 평균 confidence가 낮아 검색 미스가 있을 수 있습니다.");
  }
  if (hits.length < 3) {
    warnings.push("검색 결과 수가 적어 판단 근거가 제한적입니다.");
  }

  return warnings;
}

async function fileExistsUnderWorkspace(workspaceDir: string, relativePath: string): Promise<boolean> {
  try {
    const resolved = resolveProjectFilePath(workspaceDir, relativePath);
    const stat = await fs.stat(resolved.absolutePath);
    return stat.isFile();
  } catch {
    return false;
  }
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
    const pathMatches: string[] = [];
    const contentMatches: string[] = [];

    for (const token of tokens) {
      if (normalizedPath.includes(token)) {
        score += 4;
        pathMatches.push(token);
      }
    }

    const absolutePath = path.resolve(options.workspaceDir, relativePath);
    const content = await readTextFileSafe(absolutePath);
    if (content) {
      const lowered = content.toLowerCase();
      for (const token of tokens) {
        if (lowered.includes(token)) {
          score += 1.5;
          contentMatches.push(token);
        }
      }

      if (score > 0) {
        hits.push({
          path: relativePath,
          score,
          source: "lexical",
          reasons: unique([
            pathMatches.length > 0 ? `path-match:${unique(pathMatches).slice(0, 6).join(",")}` : "",
            contentMatches.length > 0
              ? `content-match:${unique(contentMatches).slice(0, 8).join(",")}`
              : ""
          ]),
          snippet: makeSnippet(content, tokens[0])
        });
      }
      continue;
    }

    if (score > 0) {
      hits.push({
        path: relativePath,
        score,
        source: "lexical",
        reasons: unique([
          pathMatches.length > 0 ? `path-match:${unique(pathMatches).slice(0, 6).join(",")}` : ""
        ])
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

export async function listProjectDebugEvents(options: {
  projectId: string;
  limit?: number;
}): Promise<ProjectDebugEvent[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
  try {
    const raw = await fs.readFile(debugLogPath(), "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const events: ProjectDebugEvent[] = [];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line) {
        continue;
      }

      try {
        const parsed = JSON.parse(line) as ProjectDebugEvent;
        if (parsed.projectId !== options.projectId) {
          continue;
        }
        events.push(parsed);
        if (events.length >= limit) {
          break;
        }
      } catch {
        // ignore malformed line
      }
    }

    return events.reverse();
  } catch {
    return [];
  }
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

function resolveProjectFilePath(workspaceDir: string, rawPath: string): {
  absolutePath: string;
  relativePath: string;
} {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error("file path is required");
  }

  const absolutePath = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceDir, trimmed);
  const relativePath = path.relative(workspaceDir, absolutePath);

  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`file path escapes workspace: ${rawPath}`);
  }

  return {
    absolutePath,
    relativePath: relativePath.replace(/\\/g, "/")
  };
}

export async function readServerProjectFile(options: {
  projectId: string;
  filePath: string;
  maxBytes?: number;
}): Promise<ProjectFileDetailResult> {
  const project = await getServerProject(options.projectId);
  if (!project) {
    throw new Error(`project not found: ${options.projectId}`);
  }

  await appendProjectDebugEvent({
    timestamp: nowIso(),
    projectId: options.projectId,
    stage: "file",
    status: "start",
    message: "file detail read requested",
    metadata: {
      path: options.filePath
    }
  });

  const resolved = resolveProjectFilePath(project.workspaceDir, options.filePath);
  const maxBytes = Math.max(16 * 1024, Math.min(options.maxBytes ?? MAX_DETAIL_FILE_BYTES, 8 * 1024 * 1024));
  let stat;
  try {
    stat = await fs.stat(resolved.absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "file",
        status: "failure",
        message: "file detail path missing (stale index candidate)",
        metadata: {
          path: resolved.relativePath
        }
      });
      throw new Error(
        `파일을 찾을 수 없습니다(이동/삭제 가능성). 재색인 후 다시 시도하세요: ${resolved.relativePath}`
      );
    }
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "file",
      status: "failure",
      message: error instanceof Error ? error.message : String(error),
      metadata: {
        path: resolved.relativePath
      }
    });
    throw error;
  }
  if (!stat.isFile()) {
    throw new Error(`not a file: ${resolved.relativePath}`);
  }

  if (stat.size <= maxBytes) {
    const content = await fs.readFile(resolved.absolutePath, "utf8");
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "file",
      status: "success",
      message: "file detail read completed",
      metadata: {
        path: resolved.relativePath,
        sizeBytes: stat.size,
        truncated: false
      }
    });
    return {
      project,
      path: resolved.relativePath,
      content,
      sizeBytes: stat.size,
      truncated: false
    };
  }

  const handle = await fs.open(resolved.absolutePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "file",
      status: "info",
      message: "file detail truncated due maxBytes",
      metadata: {
        path: resolved.relativePath,
        sizeBytes: stat.size,
        maxBytes
      }
    });
    return {
      project,
      path: resolved.relativePath,
      content: buffer.toString("utf8", 0, bytesRead),
      sizeBytes: stat.size,
      truncated: true
    };
  } finally {
    await handle.close();
  }
}

const ProjectAnalysisOutputSchema = z.object({
  summary: z.string().min(1),
  architecture: z.array(z.string()).min(1),
  keyModules: z
    .array(
      z.object({
        name: z.string().min(1),
        path: z.string().min(1),
        role: z.string().min(1),
        confidence: z.number().min(0).max(1).default(0.5)
      })
    )
    .default([]),
  risks: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([])
});

const ProjectAskOutputSchema = z.object({
  answer: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([]),
  caveats: z.array(z.string()).default([])
});

function buildFileExtensionStats(files: string[]): Array<{ ext: string; count: number }> {
  const map = new Map<string, number>();
  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || "(no-ext)";
    map.set(ext, (map.get(ext) ?? 0) + 1);
  }

  return Array.from(map.entries())
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.ext.localeCompare(b.ext)))
    .slice(0, 12);
}

function buildTopDirectoryStats(files: string[]): Array<{ dir: string; count: number }> {
  const map = new Map<string, number>();
  for (const file of files) {
    const normalized = toForwardSlash(file);
    const rootDir = normalized.includes("/") ? normalized.split("/")[0] : "(root)";
    map.set(rootDir, (map.get(rootDir) ?? 0) + 1);
  }

  return Array.from(map.entries())
    .map(([dir, count]) => ({ dir, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.dir.localeCompare(b.dir)))
    .slice(0, 20);
}

function buildDeterministicProjectSummary(options: {
  project: ServerProject;
  files: string[];
  warmup: ProjectWarmupResult;
}): {
  summary: string;
  architecture: string[];
  keyModules: Array<{ name: string; path: string; role: string; confidence: number }>;
  risks: string[];
  confidence: number;
  evidence: string[];
} {
  const extStats = buildFileExtensionStats(options.files);
  const topDirs = buildTopDirectoryStats(options.files);
  const keyModules = options.files.slice(0, 12).map((file) => ({
    name: path.basename(file),
    path: toForwardSlash(file),
    role: "candidate-module",
    confidence: 0.35
  }));

  return {
    summary: `${options.project.name} 프로젝트는 총 ${options.files.length}개 파일이 감지되었고, 주요 디렉터리는 ${topDirs
      .slice(0, 3)
      .map((entry) => `${entry.dir}(${entry.count})`)
      .join(", ")} 입니다.`,
    architecture: topDirs.slice(0, 8).map((entry) => `${entry.dir}: ${entry.count} files`),
    keyModules,
    risks: summarizeLowConfidenceSignals([]),
    confidence: 0.42,
    evidence: [
      `fileCount=${options.files.length}`,
      `provider=${options.warmup.selectedProvider}`,
      `fallbackUsed=${options.warmup.fallbackUsed}`,
      `topExt=${extStats
        .slice(0, 5)
        .map((entry) => `${entry.ext}:${entry.count}`)
        .join(",")}`
    ]
  };
}

function formatTs(value: Date): string {
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(
    value.getHours()
  )}${pad(value.getMinutes())}${pad(value.getSeconds())}`;
}

function buildAnalysisMarkdown(input: {
  project: ServerProject;
  analyzedAt: string;
  summary: string;
  architecture: string[];
  keyModules: Array<{ name: string; path: string; role: string; confidence: number }>;
  risks: string[];
  confidence: number;
  evidence: string[];
  lowConfidenceSignals: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# Project Analysis Memory`);
  lines.push("");
  lines.push(`- projectId: ${input.project.id}`);
  lines.push(`- projectName: ${input.project.name}`);
  lines.push(`- workspaceDir: ${input.project.workspaceDir}`);
  lines.push(`- analyzedAt: ${input.analyzedAt}`);
  lines.push(`- confidence: ${input.confidence.toFixed(2)}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(input.summary);
  lines.push("");
  lines.push("## Architecture");
  for (const item of input.architecture) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Key Modules");
  for (const module of input.keyModules) {
    lines.push(
      `- ${module.path} | role=${module.role} | confidence=${module.confidence.toFixed(2)} | name=${module.name}`
    );
  }
  lines.push("");
  lines.push("## Evidence");
  for (const item of input.evidence) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Risks");
  for (const risk of input.risks) {
    lines.push(`- ${risk}`);
  }
  lines.push("");
  lines.push("## Low Confidence Signals");
  for (const signal of input.lowConfidenceSignals) {
    lines.push(`- ${signal}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function writeMemoryDocs(options: {
  memoryRoot: string;
  groupDir: string;
  latestFileName: string;
  content: string;
}): Promise<{ latestPath: string; snapshotPath: string; relativePaths: string[] }> {
  const groupRoot = path.resolve(options.memoryRoot, options.groupDir);
  await fs.mkdir(groupRoot, { recursive: true });

  const now = new Date();
  const snapshotName = `${formatTs(now)}.md`;
  const latestPath = path.resolve(groupRoot, options.latestFileName);
  const snapshotPath = path.resolve(groupRoot, snapshotName);

  await fs.writeFile(snapshotPath, options.content, "utf8");
  await fs.writeFile(latestPath, options.content, "utf8");

  return {
    latestPath,
    snapshotPath,
    relativePaths: [
      toForwardSlash(path.relative(options.memoryRoot, latestPath)),
      toForwardSlash(path.relative(options.memoryRoot, snapshotPath))
    ]
  };
}

async function collectMemoryMarkdownFiles(memoryRoot: string, maxFiles = 300): Promise<string[]> {
  const files = await collectProjectFiles(memoryRoot, maxFiles);
  return files.filter((file) => path.extname(file).toLowerCase() === ".md");
}

export async function warmupServerProjectIndex(options: {
  projectId: string;
  maxFiles?: number;
}): Promise<ProjectWarmupResult> {
  await appendProjectDebugEvent({
    timestamp: nowIso(),
    projectId: options.projectId,
    stage: "index",
    status: "start",
    message: "warmup indexing started",
    metadata: {
      maxFiles: options.maxFiles
    }
  });

  try {
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

      await appendProjectDebugEvent({
        timestamp: nowIso(),
        projectId: options.projectId,
        stage: "index",
        status: "success",
        message: "warmup indexing finished with zero files"
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

    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "index",
      status: "success",
      message: "warmup indexing finished",
      metadata: {
        files: files.length,
        changedFiles: inspection.changedFiles.length,
        selectedProvider: inspection.retrieval.selectedProvider,
        fallbackUsed: inspection.retrieval.fallbackUsed
      }
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
  } catch (error) {
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "index",
      status: "failure",
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function isInsideParent(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function analyzeServerProject(options: {
  projectId: string;
  maxFiles?: number;
}): Promise<ProjectAnalysisResult> {
  await appendProjectDebugEvent({
    timestamp: nowIso(),
    projectId: options.projectId,
    stage: "analyze",
    status: "start",
    message: "project analyze started",
    metadata: {
      maxFiles: options.maxFiles
    }
  });

  try {
    const project = await getServerProject(options.projectId);
    if (!project) {
      throw new Error(`project not found: ${options.projectId}`);
    }

    const warmup = await warmupServerProjectIndex({
      projectId: options.projectId,
      maxFiles: options.maxFiles
    });
    const files = await collectProjectFiles(project.workspaceDir, options.maxFiles ?? 5_000);
    const memoryRoot = resolveMemoryHome(project.workspaceDir);
    await fs.mkdir(memoryRoot, { recursive: true });

  const extStats = buildFileExtensionStats(files);
  const topDirs = buildTopDirectoryStats(files);
  const seedSearch = await searchServerProject({
    projectId: options.projectId,
    query: "architecture module service controller repository flow entrypoint",
    limit: 14
  });
  const hitConfidence = seedSearch.hits.map((hit) => normalizeHitConfidence(hit));
  const topConfidence = hitConfidence[0] ?? 0;
  const avgConfidence =
    hitConfidence.reduce((sum, value) => sum + value, 0) / Math.max(1, hitConfidence.length);
  const lowConfidenceSignals = summarizeLowConfidenceSignals(seedSearch.hits);
  const lowConfidenceMode = topConfidence < 0.4 || avgConfidence < 0.3 || seedSearch.hits.length < 3;

  const deterministic = buildDeterministicProjectSummary({
    project: warmup.project,
    files,
    warmup
  });

  const llm = new OpenAICompatibleLlmClient();
  const analysisPromptPayload = {
    project: {
      id: warmup.project.id,
      name: warmup.project.name,
      description: warmup.project.description,
      workspaceDir: warmup.project.workspaceDir
    },
    indexed: {
      fileCount: files.length,
      warmupProvider: warmup.selectedProvider,
      warmupFallbackUsed: warmup.fallbackUsed,
      topExtensions: extStats.slice(0, 12),
      topDirectories: topDirs.slice(0, 15)
    },
    retrievalEvidence: seedSearch.hits.slice(0, 14).map((hit) => ({
      path: hit.path,
      score: hit.score,
      confidence: normalizeHitConfidence(hit),
      reasons: hit.reasons ?? [],
      snippet: hit.snippet ?? ""
    })),
    confidencePolicy: {
      topConfidence,
      averageConfidence: avgConfidence,
      lowConfidenceMode,
      lowConfidenceSignals
    }
  };

  const generation = await llm.generateStructured({
    systemPrompt: [
      "You are an architecture analyst for a local coding runtime.",
      "Return ONLY one JSON object.",
      "If confidence is low, explicitly include missing-coverage risks and lower confidence.",
      "Do not fabricate files or dependencies."
    ].join("\n"),
    userPrompt: JSON.stringify(
      {
        task: "Analyze project structure and architecture for memory indexing.",
        outputSchema: {
          summary: "string",
          architecture: ["string"],
          keyModules: [{ name: "string", path: "string", role: "string", confidence: "0..1" }],
          risks: ["string"],
          confidence: "0..1",
          evidence: ["string"]
        },
        input: analysisPromptPayload
      },
      null,
      2
    ),
    fallback: deterministic,
    parse: (value) => ProjectAnalysisOutputSchema.parse(value)
  });

  const analyzedAt = nowIso();
  const output = generation.output;
  const normalizedOutput = {
    summary: output.summary,
    architecture: output.architecture.slice(0, 24),
    keyModules: output.keyModules
      .map((module) => ({
        ...module,
        path: toForwardSlash(module.path),
        confidence: Math.max(0, Math.min(1, module.confidence))
      }))
      .slice(0, 32),
    risks: unique([...output.risks, ...lowConfidenceSignals]).slice(0, 30),
    confidence: Math.max(
      0,
      Math.min(
        1,
        output.confidence * (lowConfidenceMode ? 0.85 : 1)
      )
    ),
    evidence: unique([
      ...output.evidence,
      `seedProvider=${seedSearch.provider}`,
      `seedTopConfidence=${topConfidence.toFixed(2)}`,
      `seedAverageConfidence=${avgConfidence.toFixed(2)}`
    ]).slice(0, 30)
  };

  const markdown = buildAnalysisMarkdown({
    project: warmup.project,
    analyzedAt,
    ...normalizedOutput,
    lowConfidenceSignals
  });
  const analysisFiles = await writeMemoryDocs({
    memoryRoot,
    groupDir: ANALYSIS_MEMORY_DIR,
    latestFileName: "latest.md",
    content: markdown
  });

  if (isInsideParent(project.workspaceDir, memoryRoot)) {
    const relativeMemoryFiles = analysisFiles.relativePaths.map((item) =>
      toForwardSlash(path.join(path.relative(project.workspaceDir, memoryRoot), item))
    );
    await inspectContext({
      cwd: project.workspaceDir,
      files: unique([...files.slice(0, 5_000), ...relativeMemoryFiles]),
      task: `reindex with memory docs: ${project.name}`,
      tier: "small",
      tokenBudget: 700,
      stage: "PLAN"
    });
  }

    const result: ProjectAnalysisResult = {
      project: warmup.project,
      analyzedAt,
      memoryHome: memoryRoot,
      memoryFiles: [analysisFiles.latestPath, analysisFiles.snapshotPath],
      ...normalizedOutput,
      diagnostics: {
        warmup,
        lowConfidenceSignals,
        usedFallback: generation.usedFallback
      }
    };

    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "analyze",
      status: "success",
      message: "project analyze completed",
      metadata: {
        confidence: result.confidence,
        memoryFiles: result.memoryFiles.length,
        usedFallback: result.diagnostics.usedFallback
      }
    });

    return result;
  } catch (error) {
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "analyze",
      status: "failure",
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function hasCodeFileEvidence(hits: ProjectSearchHit[]): boolean {
  return hits.some((hit) => /\.(java|kt|kts|ts|tsx|js|jsx|py|go|rs|cs)$/i.test(hit.path));
}

function qualityGateForAsk(options: {
  output: z.infer<typeof ProjectAskOutputSchema>;
  question: string;
  hits: ProjectSearchHit[];
}): {
  passed: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  const output = options.output;
  if (output.answer.trim().length < 80) {
    failures.push("answer-too-short");
  }
  if (output.evidence.length < 2) {
    failures.push("missing-evidence");
  }
  if (output.confidence < 0.45) {
    failures.push("confidence-too-low");
  }

  const logicQuestion = /(로직|흐름|어떻게|처리|구현|검증|계산|상태전이|service|controller|domain)/i.test(
    options.question
  );
  if (logicQuestion && !hasCodeFileEvidence(options.hits)) {
    failures.push("missing-code-evidence");
  }

  return {
    passed: failures.length === 0,
    failures
  };
}

export async function askServerProject(options: {
  projectId: string;
  question: string;
  maxAttempts?: number;
  limit?: number;
}): Promise<ProjectAskResponse> {
  await appendProjectDebugEvent({
    timestamp: nowIso(),
    projectId: options.projectId,
    stage: "ask",
    status: "start",
    message: "project ask started",
    metadata: {
      question: options.question
    }
  });

  try {
    const project = await getServerProject(options.projectId);
    if (!project) {
      throw new Error(`project not found: ${options.projectId}`);
    }

    const question = options.question.trim();
    if (!question) {
      throw new Error("question is required");
    }

    const analysis = await analyzeServerProject({
      projectId: options.projectId
    });

    const expandedQueries = unique([
      question,
      `${question} service controller domain transaction`,
      `${question} process proc impl logic`,
      `${question} xml api endpoint`
    ]);
    const searchResults = await Promise.all(
      expandedQueries.map((query) =>
        searchServerProject({
          projectId: options.projectId,
          query,
          limit: options.limit ?? 14
        })
      )
    );

    const mergedHitsMap = new Map<string, ProjectSearchHit>();
    for (const result of searchResults) {
      for (const hit of result.hits) {
        const existing = mergedHitsMap.get(hit.path);
        if (!existing || existing.score < hit.score) {
          mergedHitsMap.set(hit.path, hit);
        }
      }
    }
    const mergedHits = Array.from(mergedHitsMap.values())
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.path.localeCompare(b.path)))
      .slice(0, options.limit ?? 14);

    const bestSearch = searchResults[0]!;
    const lowConfidenceMode =
      mergedHits.length === 0 || normalizeHitConfidence(mergedHits[0]) < 0.45;

    const memoryRoot = resolveMemoryHome(project.workspaceDir);
    const memoryMarkdownFiles = await collectMemoryMarkdownFiles(memoryRoot, 240);
    const memoryPreview: Array<{ path: string; content: string }> = [];
    for (const relativePath of memoryMarkdownFiles.slice(0, 12)) {
      const absolutePath = path.resolve(memoryRoot, relativePath);
      const content = await readTextFileSafe(absolutePath);
      if (!content) {
        continue;
      }
      memoryPreview.push({
        path: relativePath,
        content: content.slice(0, 2200)
      });
    }

    const llm = new OpenAICompatibleLlmClient();
    const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? DEFAULT_ASK_MAX_ATTEMPTS, 5));
    const qualityFailures: string[] = [];

    let bestOutput: z.infer<typeof ProjectAskOutputSchema> = {
      answer:
        "충분한 근거를 확보하지 못해 확정 답변을 제공하기 어렵습니다. 재색인 후 다시 질의하세요.",
      confidence: 0.2,
      evidence: [],
      caveats: ["low-evidence"]
    };
    let attempts = 0;
    let usedFallback = false;
    let passed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      const priorFailures = qualityFailures.slice(-8);
      const generation = await llm.generateStructured({
        systemPrompt: [
          "You are a strict project Q&A engine for implementation logic.",
          "Return ONLY one JSON object.",
          "Use only provided evidence, never fabricate.",
          "For logic questions, prefer code-level evidence over XML-only evidence.",
          "If confidence is low, explicitly say uncertainty and missing coverage."
        ].join("\n"),
        userPrompt: JSON.stringify(
          {
            task: "Answer user question using project analysis memory + retrieval evidence.",
            outputSchema: {
              answer: "string",
              confidence: "0..1",
              evidence: ["string with file path and why"],
              caveats: ["string"]
            },
            question,
            qualityGateContext: {
              attempt,
              priorFailures,
              lowConfidenceMode,
              requireCodeEvidence: /(로직|흐름|어떻게|구현|처리|service|controller|domain)/i.test(question)
            },
            projectAnalysis: {
              summary: analysis.summary,
              architecture: analysis.architecture,
              keyModules: analysis.keyModules,
              confidence: analysis.confidence,
              risks: analysis.risks
            },
            retrieval: {
              provider: bestSearch.provider,
              fallbackUsed: bestSearch.fallbackUsed,
              mergedHits: mergedHits.map((hit) => ({
                path: hit.path,
                score: hit.score,
                confidence: normalizeHitConfidence(hit),
                reasons: hit.reasons ?? [],
                snippet: hit.snippet ?? ""
              }))
            },
            memory: memoryPreview,
            instruction:
              lowConfidenceMode
                ? "검색 confidence가 낮으므로 누락 가능성을 명확히 경고하고, 확정/추정 범위를 분리하세요."
                : "근거 중심으로 구체적으로 답변하세요."
          },
          null,
          2
        ),
        fallback: bestOutput,
        parse: (value) => ProjectAskOutputSchema.parse(value)
      });

      usedFallback ||= generation.usedFallback;
      bestOutput = generation.output;

      const gate = qualityGateForAsk({
        output: bestOutput,
        question,
        hits: mergedHits
      });
      if (gate.passed) {
        passed = true;
        break;
      }

      qualityFailures.push(...gate.failures);
    }

    const reportLines: string[] = [
      `# Query Report`,
      ``,
      `- projectId: ${project.id}`,
      `- projectName: ${project.name}`,
      `- askedAt: ${nowIso()}`,
      `- question: ${question}`,
      `- confidence: ${bestOutput.confidence.toFixed(2)}`,
      `- qualityGatePassed: ${passed}`,
      `- attempts: ${attempts}`,
      ``,
      `## Answer`,
      bestOutput.answer,
      ``,
      `## Evidence`
    ];
    for (const line of bestOutput.evidence) {
      reportLines.push(`- ${line}`);
    }
    reportLines.push("", "## Caveats");
    for (const line of bestOutput.caveats) {
      reportLines.push(`- ${line}`);
    }
    reportLines.push("", "## Retrieval");
    reportLines.push(`- provider=${bestSearch.provider}`);
    reportLines.push(`- fallback=${bestSearch.fallbackUsed}`);
    reportLines.push(`- hitCount=${mergedHits.length}`);
    reportLines.push(`- topConfidence=${(mergedHits[0] ? normalizeHitConfidence(mergedHits[0]) : 0).toFixed(2)}`);
    reportLines.push("");

    const queryReportFiles = await writeMemoryDocs({
      memoryRoot,
      groupDir: QUERY_MEMORY_DIR,
      latestFileName: "latest.md",
      content: `${reportLines.join("\n")}\n`
    });

    const response: ProjectAskResponse = {
      project,
      question,
      answer: bestOutput.answer,
      confidence: bestOutput.confidence,
      qualityGatePassed: passed,
      attempts,
      evidence: bestOutput.evidence,
      caveats: bestOutput.caveats,
      retrieval: {
        provider: bestSearch.provider,
        fallbackUsed: bestSearch.fallbackUsed,
        hitCount: mergedHits.length,
        topConfidence: mergedHits[0] ? normalizeHitConfidence(mergedHits[0]) : 0
      },
      diagnostics: {
        lowConfidenceMode,
        qualityGateFailures: unique(qualityFailures),
        usedFallback,
        memoryFiles: [
          analysis.memoryFiles[0],
          analysis.memoryFiles[1],
          queryReportFiles.latestPath,
          queryReportFiles.snapshotPath
        ]
      }
    };

    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "ask",
      status: "success",
      message: "project ask completed",
      metadata: {
        confidence: response.confidence,
        qualityGatePassed: response.qualityGatePassed,
        attempts: response.attempts,
        hitCount: response.retrieval.hitCount
      }
    });

    return response;
  } catch (error) {
    await appendProjectDebugEvent({
      timestamp: nowIso(),
      projectId: options.projectId,
      stage: "ask",
      status: "failure",
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
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
        const existingQmdHits: ProjectSearchHit[] = [];
        const missingQmdPaths: string[] = [];
        for (const hit of qmdResult.hits) {
          const exists = await fileExistsUnderWorkspace(project.workspaceDir, hit.path);
          if (!exists) {
            missingQmdPaths.push(hit.path);
            continue;
          }

          existingQmdHits.push({
            path: hit.path,
            score: hit.score,
            source: "qmd",
            reasons: unique([
              hit.docid ? `docid=${hit.docid}` : "",
              hit.title ? `title=${hit.title}` : "",
              hit.context ? `context=${hit.context}` : "",
              hit.snippet ? `snippet=${hit.snippet.split("\n")[0]?.slice(0, 120)}` : ""
            ]),
            title: hit.title,
            snippet: hit.snippet
          });
        }

        if (existingQmdHits.length === 0) {
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
              qmdStatus: "empty",
              qmdErrors: [
                `qmd hits were stale and missing on disk: ${missingQmdPaths.slice(0, 5).join(", ")}`
              ],
              qmdIndexMethod: indexed.method,
              qmdQueryMode: retrievalConfig.qmd.queryMode,
              qmdCommand: retrievalConfig.qmd.command,
              fileCount: files.length
            }
          };
        }

        return {
          project,
          query,
          provider: "qmd",
          fallbackUsed: false,
          modeUsed: qmdResult.mode,
          hits: existingQmdHits,
          diagnostics: {
            qmdStatus: qmdResult.status,
            qmdErrors: unique([
              ...qmdResult.errors,
              missingQmdPaths.length > 0
                ? `stale-path-filtered=${missingQmdPaths.slice(0, 5).join(",")}`
                : ""
            ]),
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
