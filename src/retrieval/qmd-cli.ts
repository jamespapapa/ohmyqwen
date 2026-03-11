import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
export { buildQmdQueryFromSignals } from "./qmd-planner.js";

export interface QmdSearchHit {
  path: string;
  score: number;
  docid?: string;
  title?: string;
  context?: string;
  snippet?: string;
}

interface QmdSearchRow {
  docid?: string;
  score?: number;
  file?: string;
  title?: string;
  context?: string;
  snippet?: string;
  body?: string;
}

export interface QmdCliRuntime {
  command: string;
  cwd: string;
  indexName: string;
  collectionName: string;
  mask: string;
  queryMode: "query_then_search" | "search_only" | "query_only";
  timeoutMs: number;
  syncIntervalMs: number;
  configPath: string;
  indexPath: string;
  env: NodeJS.ProcessEnv;
}

interface QmdCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface QmdSyncCacheEntry {
  signature: string;
  syncedAt: number;
}

const syncCache = new Map<string, QmdSyncCacheEntry>();

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function firstLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return text.trim();
  }

  const prioritized =
    lines.find((line) => /sql|sqlite|error|failed|exception|readonly|timeout/i.test(line)) ?? lines[0];
  return prioritized;
}

export function isSafeQmdCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  if (["qmd", "qmd.exe", "qmd.cmd", "qmd.bat"].includes(trimmed.toLowerCase())) {
    return true;
  }

  const normalized = trimmed.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.endsWith("/qmd") ||
    normalized.endsWith("/qmd.exe") ||
    normalized.endsWith("/qmd.cmd") ||
    normalized.endsWith("/qmd.bat")
  );
}

function normalizeOptionalPath(cwd: string, value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
}

function isReadonlySqliteError(text: string): boolean {
  return /sqlite.*readonly|readonly database|SQLITE_READONLY|wrappers\.js:9/i.test(text);
}

async function hasUsableIndexFile(indexPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(indexPath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function resolveQmdRuntime(options: {
  cwd: string;
  command: string;
  collectionName: string;
  mask: string;
  queryMode: "query_then_search" | "search_only" | "query_only";
  indexName?: string;
  configDir?: string;
  cacheHome?: string;
  indexPath?: string;
  timeoutMs: number;
  syncIntervalMs: number;
}): QmdCliRuntime {
  if (!isSafeQmdCommand(options.command)) {
    throw new Error(`qmd command is not allowed: ${options.command}`);
  }

  const cwdHash = createHash("sha1").update(path.resolve(options.cwd)).digest("hex").slice(0, 12);
  const maskHash = createHash("sha1").update(options.mask.trim()).digest("hex").slice(0, 6);
  const indexName = options.indexName?.trim() || `ohmyqwen-${cwdHash}-${maskHash}`;
  const configDir =
    normalizeOptionalPath(options.cwd, options.configDir) ||
    path.resolve(options.cwd, ".ohmyqwen", "cache", "qmd", "config");
  const cacheHome =
    normalizeOptionalPath(options.cwd, options.cacheHome) ||
    path.resolve(options.cwd, ".ohmyqwen", "cache", "qmd", "cache");
  const indexPath =
    normalizeOptionalPath(options.cwd, options.indexPath) ||
    path.resolve(options.cwd, ".ohmyqwen", "cache", "qmd", "indexes", `${indexName}.sqlite`);

  return {
    command: options.command.trim(),
    cwd: options.cwd,
    indexName,
    collectionName: options.collectionName.trim(),
    mask: options.mask.trim(),
    queryMode: options.queryMode,
    timeoutMs: options.timeoutMs,
    syncIntervalMs: options.syncIntervalMs,
    configPath: path.join(configDir, `${indexName}.yml`),
    indexPath,
    env: {
      ...process.env,
      QMD_CONFIG_DIR: configDir,
      XDG_CACHE_HOME: cacheHome,
      INDEX_PATH: indexPath,
      NO_COLOR: "1",
      CLICOLOR: "0",
      FORCE_COLOR: "0",
      CI: process.env.CI || "1"
    }
  };
}

function extractJsonArray(text: string): unknown[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const starts: number[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === "[") {
      starts.push(index);
    }
  }

  if (starts.length === 0) {
    throw new Error("qmd JSON output parsing failed: array not found");
  }

  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const start = starts[index]!;
    const end = normalized.lastIndexOf("]");
    if (end < start) {
      continue;
    }
    const candidate = normalized.slice(start, end + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // keep trying with earlier "[" positions
    }
  }

  throw new Error("qmd JSON output parsing failed: expected array");
}

async function runCommand(runtime: QmdCliRuntime, args: string[]): Promise<QmdCommandResult> {
  return new Promise<QmdCommandResult>((resolve, reject) => {
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(runtime.command);
    const child = spawn(runtime.command, args, {
      cwd: runtime.cwd,
      env: runtime.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: useShell
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`qmd command timeout: ${[runtime.command, ...args].join(" ")}`));
    }, runtime.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout,
        stderr
      });
    });
  });
}

function isCollectionConfigured(rawYaml: string, collectionName: string, workspacePath: string): boolean {
  const collectionPattern = new RegExp(`(^|\\n)\\s{2}${collectionName}:\\s*(\\n|$)`);
  if (!collectionPattern.test(rawYaml)) {
    return false;
  }

  const normalizedWorkspace = workspacePath.replace(/\\\\/g, "/");
  return rawYaml.includes(`path: ${normalizedWorkspace}`) || rawYaml.includes(`path: ${workspacePath}`);
}

export async function ensureQmdIndexed(runtime: QmdCliRuntime): Promise<{
  indexed: boolean;
  method: "add" | "update" | "cached";
}> {
  await fs.mkdir(path.dirname(runtime.configPath), { recursive: true });
  await fs.mkdir(path.dirname(runtime.indexPath), { recursive: true });

  const signature = createHash("sha1")
    .update(
      JSON.stringify({
        cwd: runtime.cwd,
        collection: runtime.collectionName,
        mask: runtime.mask,
        indexPath: runtime.indexPath,
        configPath: runtime.configPath
      })
    )
    .digest("hex");

  const cached = syncCache.get(runtime.indexPath);
  if (
    cached &&
    cached.signature === signature &&
    Date.now() - cached.syncedAt < runtime.syncIntervalMs
  ) {
    return {
      indexed: true,
      method: "cached"
    };
  }

  let configRaw = "";
  try {
    configRaw = await fs.readFile(runtime.configPath, "utf8");
  } catch {
    configRaw = "";
  }

  const hasCollection = isCollectionConfigured(configRaw, runtime.collectionName, runtime.cwd);

  if (!hasCollection) {
    const addResult = await runCommand(runtime, [
      "--index",
      runtime.indexName,
      "collection",
      "add",
      runtime.cwd,
      "--name",
      runtime.collectionName,
      "--mask",
      runtime.mask
    ]);

    if (addResult.code !== 0) {
      const raw = addResult.stderr || addResult.stdout || "qmd collection add failed";
      if (isReadonlySqliteError(raw) && (await hasUsableIndexFile(runtime.indexPath))) {
        syncCache.set(runtime.indexPath, {
          signature,
          syncedAt: Date.now()
        });
        return {
          indexed: true,
          method: "cached"
        };
      }
      throw new Error(firstLine(raw));
    }

    syncCache.set(runtime.indexPath, {
      signature,
      syncedAt: Date.now()
    });
    return {
      indexed: true,
      method: "add"
    };
  }

  const updateResult = await runCommand(runtime, ["--index", runtime.indexName, "update"]);
  if (updateResult.code !== 0) {
    const raw = updateResult.stderr || updateResult.stdout || "qmd update failed";
    if (isReadonlySqliteError(raw) && (await hasUsableIndexFile(runtime.indexPath))) {
      syncCache.set(runtime.indexPath, {
        signature,
        syncedAt: Date.now()
      });
      return {
        indexed: true,
        method: "cached"
      };
    }
    throw new Error(firstLine(raw));
  }

  syncCache.set(runtime.indexPath, {
    signature,
    syncedAt: Date.now()
  });
  return {
    indexed: true,
    method: "update"
  };
}

function normalizeQmdPath(inputPath: string, runtime: QmdCliRuntime): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return trimmed;
  }

  const qmdPrefix = `qmd://${runtime.collectionName}/`;
  if (trimmed.startsWith(qmdPrefix)) {
    return trimmed.slice(qmdPrefix.length).replace(/^\/+/, "");
  }

  if (trimmed.startsWith("qmd://")) {
    const rest = trimmed.replace(/^qmd:\/\/[A-Za-z0-9_.-]+\//, "");
    return rest.replace(/^\/+/, "");
  }

  if (path.isAbsolute(trimmed)) {
    const relative = path.relative(runtime.cwd, trimmed);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative;
    }
  }

  return trimmed.replace(/^\.\//, "");
}

function toHits(rows: QmdSearchRow[], runtime: QmdCliRuntime): QmdSearchHit[] {
  const output: QmdSearchHit[] = [];

  for (const row of rows) {
    const file = typeof row.file === "string" ? normalizeQmdPath(row.file, runtime) : "";
    if (!file) {
      continue;
    }

    output.push({
      path: file,
      score: typeof row.score === "number" ? row.score : 0,
      docid: row.docid,
      title: row.title,
      context: row.context,
      snippet: row.snippet
    });
  }

  return output.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.path.localeCompare(b.path)));
}

async function runQmdSearch(
  runtime: QmdCliRuntime,
  mode: "query" | "search",
  query: string,
  limit: number
): Promise<QmdSearchHit[]> {
  const commandArgs = [
    "--index",
    runtime.indexName,
    mode,
    query,
    "--json",
    "-n",
    String(limit),
    "-c",
    runtime.collectionName
  ];

  const result = await runCommand(runtime, commandArgs);
  if (result.code !== 0) {
    throw new Error(firstLine(result.stderr || result.stdout || `qmd ${mode} failed`));
  }

  const rows = extractJsonArray(result.stdout) as QmdSearchRow[];
  return toHits(rows, runtime);
}

export async function queryQmd(options: {
  runtime: QmdCliRuntime;
  query: string;
  limit: number;
}): Promise<{
  status: "ok" | "empty" | "failed";
  mode?: "query" | "search";
  hits: QmdSearchHit[];
  errors: string[];
}> {
  const trimmedQuery = options.query.trim();
  if (!trimmedQuery) {
    return {
      status: "empty",
      hits: [],
      errors: []
    };
  }

  const modes: Array<"query" | "search"> =
    options.runtime.queryMode === "query_only"
      ? ["query"]
      : options.runtime.queryMode === "search_only"
        ? ["search"]
        : ["query", "search"];

  const errors: string[] = [];
  for (const mode of modes) {
    try {
      const hits = await runQmdSearch(options.runtime, mode, trimmedQuery, options.limit);
      if (hits.length === 0) {
        errors.push(`${mode}:empty`);
        continue;
      }
      return {
        status: "ok",
        mode,
        hits,
        errors
      };
    } catch (error) {
      errors.push(`${mode}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    status: "failed",
    hits: [],
    errors
  };
}
