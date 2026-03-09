import { proxyJson } from "@/lib/backend";

export async function GET() {
  return proxyJson("/api/llm/models", {
    method: "GET"
  });
}

