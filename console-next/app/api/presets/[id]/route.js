import { proxyJson } from "@/lib/backend";

export async function DELETE(_request, { params }) {
  const { id } = await params;
  return proxyJson(`/api/presets/${id}`, {
    method: "DELETE"
  });
}
