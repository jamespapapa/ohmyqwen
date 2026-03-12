import { pathToFileURL } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(path.join(process.cwd(), "console-next/next.config.mjs")).href;

describe("console next config", () => {
  it("uses separate distDir for development", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const mod = await import(`${moduleUrl}?dev-test=${Date.now()}`);
    expect(mod.distDir).toBe(".next-dev");
    process.env.NODE_ENV = prev;
  });

  it("uses production distDir for build/start", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const mod = await import(`${moduleUrl}?prod-test=${Date.now()}`);
    expect(mod.distDir).toBe(".next");
    process.env.NODE_ENV = prev;
  });
});
