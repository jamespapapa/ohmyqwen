import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { RetrievalHit, RetrievalProvider, RetrievalProviderResult } from "../types.js";
import { sortHits, tokenizeQuery } from "../utils.js";

interface QmdCommandResult {
  code: number;
  stdout: string;
  stderr: string;
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

interface QmdRuntime {
  command: string;
  indexName: string;
  collectionName: string;
  mask: string;
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  configPath: string;
  indexPath: string;
  syncIntervalMs: number;
  queryMode: "query_then_search" | "search_only" | "query_only";
}

interface QmdSyncCacheEntry {
  signature: string;
  syncedAt: number;
}

const syncCache = new Map<string, QmdSyncCacheEntry>();

function isSafeQmdCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed === "qmd") {
    return true;
  }

  const normalized = trimmed.replace(/\\/g, "/").toLowerCase();
  return normalized.endsWith("/qmd") || normalized.endsWith("/qmd.exe");
}

function nowIso(): string {
  return new Date().toISOString();
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function extractJsonArray(text: string): unknown[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const start = normalized.indexOf("[");
  const end = normalized.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error("qmd JSON output parsing failed: array not found");
  }

  const candidate = normalized.slice(start, end + 1);
  const parsed = JSON.parse(candidate);
  if (!Array.isArray(parsed)) {
    throw new Error("qmd JSON output parsing failed: expected array");
  }

  return parsed;
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? text.trim()
  );
}

async function runCommand(runtime: QmdRuntime, args: string[]): Promise<QmdCommandResult> {
  return new Promise<QmdCommandResult>((resolve, reject) => {
    const child = spawn(runtime.command, args, {
      cwd: runtime.cwd,
      env: runtime.env,
      stdio: ["ignore", "pipe", "pipe"]
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

function buildRuntime(context: Parameters<RetrievalProvider["run"]>[0]): QmdRuntime {
  const qmdConfig = context.config.qmd;
  const cwd = context.cwd;
  const command = qmdConfig.command.trim();

  if (!isSafeQmdCommand(command)) {
    throw new Error(`qmd command is not allowed: ${command}`);
  }

  const cwdHash = createHash("sha1").update(path.resolve(cwd)).digest("hex").slice(0, 12);
  const indexName = qmdConfig.indexName?.trim() || `ohmyqwen-${cwdHash}`;
  const collectionName = qmdConfig.collectionName.trim();
  const mask = qmdConfig.mask.trim();

  const configDir = qmdConfig.configDir
    ? path.isAbsolute(qmdConfig.configDir)
      ? qmdConfig.configDir
      : path.resolve(cwd, qmdConfig.configDir)
    : path.resolve(cwd, ".ohmyqwen", "cache", "qmd", "config");

  const cacheHome = qmdConfig.cacheHome
    ? path.isAbsolute(qmdConfig.cacheHome)
      ? qmdConfig.cacheHome
      : path.resolve(cwd, qmdConfig.cacheHome)
    : path.resolve(cwd, ".ohmyqwen", "cache", "qmd", "cache");

  const indexPath = qmdConfig.indexPath
    ? path.isAbsolute(qmdConfig.indexPath)
      ? qmdConfig.indexPath
      : path.resolve(cwd, qmdConfig.indexPath)
    : path.resolve(cwd, ".ohmyqwen", "cache", "qmd", "indexes", `${indexName}.sqlite`);

  const configPath = path.join(configDir, `${indexName}.yml`);

  return {
    command,
    indexName,
    collectionName,
    mask,
    cwd,
    timeoutMs: context.config.timeoutMs.qmd,
    env: {
      ...process.env,
      QMD_CONFIG_DIR: configDir,
      XDG_CACHE_HOME: cacheHome,
      INDEX_PATH: indexPath,
      NO_COLOR: "1",
      CLICOLOR: "0",
      FORCE_COLOR: "0",
      CI: process.env.CI || "1"
    },
    configPath,
    indexPath,
    syncIntervalMs: qmdConfig.syncIntervalMs,
    queryMode: qmdConfig.queryMode
  };
}

async function ensureQmdIndexed(runtime: QmdRuntime): Promise<void> {
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
    return;
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
      throw new Error(firstLine(addResult.stderr || addResult.stdout || "qmd collection add failed"));
    }
  } else {
    const updateResult = await runCommand(runtime, ["--index", runtime.indexName, "update"]);
    if (updateResult.code !== 0) {
      throw new Error(firstLine(updateResult.stderr || updateResult.stdout || "qmd update failed"));
    }
  }

  syncCache.set(runtime.indexPath, {
    signature,
    syncedAt: Date.now()
  });
}

function normalizeQmdPath(inputPath: string, runtime: QmdRuntime): string {
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

function toHits(rows: QmdSearchRow[], runtime: QmdRuntime): RetrievalHit[] {
  const output: RetrievalHit[] = [];

  for (const row of rows) {
    const file = typeof row.file === "string" ? normalizeQmdPath(row.file, runtime) : "";
    if (!file) {
      continue;
    }

    const score = typeof row.score === "number" ? row.score : 0;
    const reasons = unique(
      [
        "qmd-cli",
        row.docid ? `docid=${row.docid}` : "",
        row.title ? `title=${row.title}` : "",
        row.context ? `context=${row.context}` : "",
        row.snippet ? `snippet=${row.snippet.split("\n")[0]?.slice(0, 80)}` : ""
      ].filter(Boolean)
    );

    output.push({
      path: file,
      score,
      reasons
    });
  }

  return sortHits(output);
}

function buildQueryString(context: Parameters<RetrievalProvider["run"]>[0]): string {
  const queryTokens = tokenizeQuery(context.query);
  const explicitPaths = context.query.targetFiles.map((file) => file.trim()).filter(Boolean);
  const signalLines = [
    context.query.task,
    ...context.query.diffSummary,
    ...context.query.errorLogs,
    ...context.query.verifyFeedback
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  const segments = unique([
    ...queryTokens.slice(0, 32),
    ...explicitPaths.slice(0, 10),
    ...signalLines.slice(0, 6)
  ]);

  return segments.join(" ").slice(0, 800).trim();
}

async function runQmdSearch(runtime: QmdRuntime, mode: "query" | "search", query: string, topK: number) {
  const commandArgs = [
    "--index",
    runtime.indexName,
    mode,
    query,
    "--json",
    "-n",
    String(topK),
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

export class QmdRetrievalProvider implements RetrievalProvider {
  public readonly name = "qmd" as const;

  public async run(context: Parameters<RetrievalProvider["run"]>[0]): Promise<RetrievalProviderResult> {
    const startedAt = Date.now();

    if (context.config.qmd.forceFailure) {
      return {
        provider: this.name,
        status: "failed",
        tookMs: Date.now() - startedAt,
        hits: [],
        error: "qmd provider forced failure by config"
      };
    }

    if (!context.config.qmd.enabled) {
      return {
        provider: this.name,
        status: "skipped",
        tookMs: Date.now() - startedAt,
        hits: [],
        metadata: {
          reason: "qmd-disabled"
        }
      };
    }

    const query = buildQueryString(context);
    if (!query) {
      return {
        provider: this.name,
        status: "empty",
        tookMs: Date.now() - startedAt,
        hits: [],
        metadata: {
          reason: "empty-query"
        }
      };
    }

    let runtime: QmdRuntime;
    try {
      runtime = buildRuntime(context);
    } catch (error) {
      return {
        provider: this.name,
        status: "failed",
        tookMs: Date.now() - startedAt,
        hits: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }

    try {
      await ensureQmdIndexed(runtime);
    } catch (error) {
      return {
        provider: this.name,
        status: "failed",
        tookMs: Date.now() - startedAt,
        hits: [],
        error: `qmd indexing failed: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          command: runtime.command,
          indexName: runtime.indexName,
          indexPath: runtime.indexPath,
          configPath: runtime.configPath,
          attemptedAt: nowIso()
        }
      };
    }

    const modes: Array<"query" | "search"> =
      runtime.queryMode === "query_only"
        ? ["query"]
        : runtime.queryMode === "search_only"
          ? ["search"]
          : ["query", "search"];

    const errors: string[] = [];
    for (const mode of modes) {
      try {
        const hits = await runQmdSearch(runtime, mode, query, context.config.topK.qmd);
        return {
          provider: this.name,
          status: hits.length > 0 ? "ok" : "empty",
          tookMs: Date.now() - startedAt,
          hits: hits.slice(0, context.config.topK.qmd),
          metadata: {
            command: runtime.command,
            mode,
            queryMode: runtime.queryMode,
            query,
            indexName: runtime.indexName,
            indexPath: runtime.indexPath,
            collectionName: runtime.collectionName,
            attemptedAt: nowIso()
          }
        };
      } catch (error) {
        errors.push(`${mode}:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      provider: this.name,
      status: "failed",
      tookMs: Date.now() - startedAt,
      hits: [],
      error: errors.join(" | ") || "qmd query failed",
      metadata: {
        command: runtime.command,
        queryMode: runtime.queryMode,
        query,
        indexName: runtime.indexName,
        indexPath: runtime.indexPath,
        collectionName: runtime.collectionName,
        attemptedAt: nowIso()
      }
    };
  }
}
