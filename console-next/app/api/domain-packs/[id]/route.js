import { proxyJson } from "@/lib/backend";

export async function GET(_request, { params }) {
  const { id } = await params;
  return proxyJson(`/api/domain-packs/${id}`, {
    method: "GET"
  });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  return proxyJson(`/api/domain-packs/${id}`, {
    method: "DELETE"
  });
}
