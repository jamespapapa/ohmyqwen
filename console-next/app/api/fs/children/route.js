import { proxyJson } from "@/lib/backend";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  const pathValue = searchParams.get("path");
  if (pathValue) {
    query.set("path", pathValue);
  }

  const suffix = query.toString();
  return proxyJson(`/api/fs/children${suffix ? `?${suffix}` : ""}`, {
    method: "GET"
  });
}
