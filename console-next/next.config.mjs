import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
export const distDir = process.env.NODE_ENV === "development" ? ".next-dev" : ".next";

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("./", import.meta.url)),
  distDir
};

export default nextConfig;
