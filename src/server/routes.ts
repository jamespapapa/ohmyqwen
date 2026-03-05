import { IncomingMessage, ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AnalyzeInputSchema, RunModeSchema } from "../core/types.js";
import { getRunArtifacts, getRunRecord, listRunEvents, startBackgroundRun } from "./store.js";

function json(res: ServerResponse, code: number, payload: unknown): void {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
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

function resolveBrowsePath(raw: string | null): string {
  const value = raw?.trim();
  if (!value) {
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
        files: payload.files,
        constraints: payload.constraints,
        symbols: payload.symbols,
        contextTier: payload.contextTier,
        contextTokenBudget: payload.contextTokenBudget,
        retryPolicy: payload.retryPolicy as never,
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
