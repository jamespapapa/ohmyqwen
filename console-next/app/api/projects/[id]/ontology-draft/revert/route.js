import { proxyJson } from "@/lib/backend";

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.text();
  return proxyJson(`/api/projects/${id}/ontology-draft/revert`, {
    method: "POST",
    body
  });
}
