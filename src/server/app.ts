import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { handleApiRoutes } from "./routes.js";

function shouldTraceServer(): boolean {
  return process.env.OHMYQWEN_SERVER_TRACE === "1";
}

function serverTrace(message: string, payload?: Record<string, unknown>): void {
  if (!shouldTraceServer()) {
    return;
  }
  const suffix = payload ? ` ${JSON.stringify(payload)}` : "";
  process.stdout.write(`[server-trace] ${new Date().toISOString()} ${message}${suffix}\n`);
}


function summarizeValue(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "<unset>";
  }
  return normalized;
}

function printStartupDiagnostics(host: string, port: number): void {
  const lines = [
    `[server-startup] ${new Date().toISOString()} pid=${process.pid} cwd=${process.cwd()}`,
    `[server-startup] listen=http://${host}:${port} trace=${shouldTraceServer() ? "enabled" : "disabled"}`,
    `[server-startup] llm endpointKind=${summarizeValue(process.env.OHMYQWEN_LLM_ENDPOINT_KIND ?? "auto")} model=${summarizeValue(process.env.OHMYQWEN_LLM_MODEL)} baseUrl=${summarizeValue(process.env.OHMYQWEN_LLM_BASE_URL)}`,
    `[server-startup] tls rejectUnauthorized=${summarizeValue(process.env.NODE_TLS_REJECT_UNAUTHORIZED)} extraCa=${summarizeValue(process.env.NODE_EXTRA_CA_CERTS)}`
  ];

  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}

function sendText(res: ServerResponse, code: number, body: string, contentType: string): void {
  res.statusCode = code;
  res.setHeader("Content-Type", contentType);
  res.end(body);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method !== "GET") {
    return false;
  }

  const root = path.resolve(process.cwd(), "web");
  const filePath =
    url.pathname === "/" ? path.join(root, "index.html") : path.join(root, url.pathname.replace(/^\/+/, ""));

  if (!filePath.startsWith(root)) {
    sendText(res, 403, "forbidden", "text/plain; charset=utf-8");
    return true;
  }

  try {
    const content = await fs.readFile(filePath, "utf8");
    const ext = path.extname(filePath);
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
          ? "application/javascript; charset=utf-8"
          : "text/plain; charset=utf-8";

    sendText(res, 200, content, contentType);
    return true;
  } catch {
    if (url.pathname === "/") {
      sendText(
        res,
        500,
        "web/index.html not found. Please build project with web assets.",
        "text/plain; charset=utf-8"
      );
      return true;
    }

    return false;
  }
}

export async function startServer(options?: { host?: string; port?: number }): Promise<void> {
  const host = options?.host ?? "127.0.0.1";
  const port = options?.port ?? 4311;

  const server = createServer(async (req, res) => {
    const startedAt = Date.now();
    const method = req.method ?? "GET";
    const urlPath = req.url ?? "/";
    const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    serverTrace("request:start", {
      traceId,
      method,
      url: urlPath
    });

    res.once("finish", () => {
      serverTrace("request:finish", {
        traceId,
        method,
        url: urlPath,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      });
    });

    try {
      const handledApi = await handleApiRoutes(req, res);
      if (handledApi) {
        return;
      }

      const handledStatic = await serveStatic(req, res);
      if (handledStatic) {
        return;
      }

      sendText(res, 404, "not found", "text/plain; charset=utf-8");
    } catch (error) {
      sendText(
        res,
        500,
        JSON.stringify(
          {
            error: error instanceof Error ? error.message : String(error)
          },
          null,
          2
        ),
        "application/json; charset=utf-8"
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve();
    });
  });

  printStartupDiagnostics(host, port);
  process.stdout.write(`ohmyqwen server listening on http://${host}:${port}\n`);

  await new Promise<void>(() => {
    // keep process alive until externally terminated
  });
}
