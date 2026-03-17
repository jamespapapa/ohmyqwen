import { proxyJson } from "@/lib/backend";

export async function GET(_request, { params }) {
  const { id } = await params;
  return proxyJson(`/api/projects/${id}/ontology-draft`, {
    method: "GET"
  });
}

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.text();
  return proxyJson(`/api/projects/${id}/ontology-draft`, {
    method: "POST",
    body
  });
}
