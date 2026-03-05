import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { handleApiRoutes } from "./routes.js";

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

  process.stdout.write(`ohmyqwen server listening on http://${host}:${port}\n`);

  await new Promise<void>(() => {
    // keep process alive until externally terminated
  });
}
