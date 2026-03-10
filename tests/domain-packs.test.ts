import { describe, expect, it } from "vitest";
import { listDomainPacks } from "../src/server/domain-packs.js";

describe("domain pack store", () => {
  it("loads built-in domain packs from config", async () => {
    const domainPacks = await listDomainPacks();

    expect(domainPacks.length).toBeGreaterThanOrEqual(3);
    expect(domainPacks.some((item) => item.id === "benefit-claim")).toBe(true);
    expect(domainPacks.find((item) => item.id === "benefit-claim")?.capabilityTags.length).toBeGreaterThan(0);
  });
});
