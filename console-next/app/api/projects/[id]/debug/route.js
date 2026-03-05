import { proxyJson } from "@/lib/backend";

export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  const limitValue = searchParams.get("limit");
  if (limitValue) {
    query.set("limit", limitValue);
  }

  return proxyJson(`/api/projects/${id}/debug${query.toString() ? `?${query.toString()}` : ""}`, {
    method: "GET"
  });
}
