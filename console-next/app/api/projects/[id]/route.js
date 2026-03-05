import { proxyJson } from "@/lib/backend";

export async function GET(_request, { params }) {
  const { id } = await params;
  return proxyJson(`/api/projects/${id}`, {
    method: "GET"
  });
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.text();
  return proxyJson(`/api/projects/${id}`, {
    method: "PATCH",
    body
  });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  return proxyJson(`/api/projects/${id}`, {
    method: "DELETE"
  });
}
