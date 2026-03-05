import { proxyJson } from "@/lib/backend";

export async function GET() {
  return proxyJson("/api/projects", {
    method: "GET"
  });
}

export async function POST(request) {
  const body = await request.text();
  return proxyJson("/api/projects", {
    method: "POST",
    body
  });
}
