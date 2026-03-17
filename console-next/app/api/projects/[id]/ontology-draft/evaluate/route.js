import { proxyJson } from "@/lib/backend";

export async function POST(_request, { params }) {
  const { id } = await params;
  return proxyJson(`/api/projects/${id}/ontology-draft/evaluate`, {
    method: "POST"
  });
}
