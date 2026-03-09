import http from "node:http";
import https from "node:https";

const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:4311";
const BACKEND_PROXY_TIMEOUT_MS = Number.parseInt(
  process.env.BACKEND_PROXY_TIMEOUT_MS ?? "900000",
  10
);

function normalizeBody(body) {
  if (body == null) {
    return "";
  }
  if (typeof body === "string") {
    return body;
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  return JSON.stringify(body);
}

export async function proxyJson(pathname, init = {}) {
  const targetUrl = new URL(`${BACKEND_BASE_URL}${pathname}`);
  const transport = targetUrl.protocol === "https:" ? https : http;
  const method = (init.method || "GET").toUpperCase();
  const body = normalizeBody(init.body);

  return new Promise((resolve) => {
    const req = transport.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        headers: {
          "content-type": "application/json",
          ...(init.headers || {}),
          ...(body ? { "content-length": Buffer.byteLength(body) } : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve(
            new Response(text, {
              status: res.statusCode || 500,
              headers: {
                "content-type": res.headers["content-type"] || "application/json"
              }
            })
          );
        });
      }
    );

    req.setTimeout(BACKEND_PROXY_TIMEOUT_MS, () => {
      req.destroy(new Error(`backend headers timeout after ${BACKEND_PROXY_TIMEOUT_MS}ms`));
    });

    req.on("error", (error) => {
      resolve(
        Response.json(
          {
            error: `backend proxy failed: ${error instanceof Error ? error.message : String(error)}`
          },
          {
            status: 504
          }
        )
      );
    });

    if (body && method !== "GET" && method !== "HEAD") {
      req.write(body);
    }
    req.end();
  });
}
