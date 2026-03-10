import { describe, expect, it } from "vitest";
import { detectQuestionDomainPacks, listDomainPacks } from "../src/server/domain-packs.js";

describe("domain pack store", () => {
  it("loads built-in domain packs from config", async () => {
    const domainPacks = await listDomainPacks();

    expect(domainPacks.length).toBeGreaterThanOrEqual(3);
    expect(domainPacks.some((item) => item.id === "benefit-claim")).toBe(true);
    expect(domainPacks.find((item) => item.id === "benefit-claim")?.capabilityTags.length).toBeGreaterThan(0);
  });

  it("detects loan domain for sunshine-loan questions", async () => {
    const domainPacks = await listDomainPacks();
    const matches = detectQuestionDomainPacks(
      "햇살론 대출 로직이 frontend부터 backend까지 어떤 흐름으로 진행되는지 분석해줘.",
      domainPacks
    );

    expect(matches[0]?.id).toBe("loan");
    expect(matches[0]?.matchedTags).toEqual(expect.arrayContaining(["loan", "sunshine-loan"]));
  });
});
