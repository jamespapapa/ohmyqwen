const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:4311";

export async function proxyJson(pathname, init = {}) {
  const url = `${BACKEND_BASE_URL}${pathname}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {})
    },
    cache: "no-store"
  });

  const text = await response.text();

  return new Response(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json"
    }
  });
}
