import { proxyJson } from "@/lib/backend";

export async function POST(request) {
  const body = await request.text();
  return proxyJson("/api/runs", {
    method: "POST",
    body
  });
}
