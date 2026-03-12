import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("offline bundle scripts", () => {
  it("uses materialized npm runtime deps for backend win64 bundle", () => {
    const script = fs.readFileSync(path.join(root, "scripts/bundle-offline-win64.ps1"), "utf8");
    expect(script).toContain("npm install --omit=dev");
    expect(script).not.toContain("pnpm install --prod --frozen-lockfile");
  });

  it("uses materialized npm runtime deps for backend unix bundle", () => {
    const script = fs.readFileSync(path.join(root, "scripts/bundle-offline.sh"), "utf8");
    expect(script).toContain("npm install --omit=dev");
    expect(script).not.toContain("pnpm install --prod --frozen-lockfile --dir");
  });
});
