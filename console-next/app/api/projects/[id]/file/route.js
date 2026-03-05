import { proxyJson } from "@/lib/backend";

export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  const pathValue = searchParams.get("path");
  const maxBytesValue = searchParams.get("maxBytes");

  if (pathValue) {
    query.set("path", pathValue);
  }

  if (maxBytesValue) {
    query.set("maxBytes", maxBytesValue);
  }

  return proxyJson(`/api/projects/${id}/file${query.toString() ? `?${query.toString()}` : ""}`, {
    method: "GET"
  });
}
