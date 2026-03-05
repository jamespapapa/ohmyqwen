import { proxyJson } from "@/lib/backend";

export async function GET(_request, { params }) {
  const { id } = await params;
  return proxyJson(`/api/runs/${id}/artifacts`, {
    method: "GET"
  });
}
