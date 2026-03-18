import { proxyJson } from "@/lib/backend";

export async function GET(request, { params }) {
  const { id } = await params;
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  return proxyJson(`/api/projects/${id}/ontology${query ? `?${query}` : ""}`, {
    method: "GET"
  });
}
