import { proxyJson } from "@/lib/backend";

export async function GET() {
  return proxyJson("/api/presets", {
    method: "GET"
  });
}

export async function POST(request) {
  const body = await request.text();
  return proxyJson("/api/presets", {
    method: "POST",
    body
  });
}
