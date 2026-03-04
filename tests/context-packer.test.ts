import { describe, expect, it } from "vitest";
import { packContext } from "../src/context/packer.js";

describe("packContext", () => {
  it("enforces hard cap and truncates oversized payload", () => {
    const oversized = "symbol ".repeat(2000);

    const packed = packContext({
      objective: "Implement controlled loop",
      constraints: ["short-session", "state-machine"],
      symbols: [oversized],
      errorLogs: ["error ".repeat(2000)],
      diffSummary: ["diff ".repeat(2000)],
      tier: "small",
      tokenBudget: 600
    });

    expect(packed.hardCapTokens).toBe(600);
    expect(packed.usedTokens).toBeLessThanOrEqual(600);
    expect(packed.truncated).toBe(true);
  });

  it("supports three context tiers", () => {
    const small = packContext({
      objective: "obj",
      constraints: [],
      symbols: ["A", "B", "C"],
      errorLogs: [],
      diffSummary: [],
      tier: "small"
    });

    const big = packContext({
      objective: "obj",
      constraints: [],
      symbols: ["A", "B", "C"],
      errorLogs: [],
      diffSummary: [],
      tier: "big"
    });

    expect(small.tier).toBe("small");
    expect(big.tier).toBe("big");
    expect(big.hardCapTokens).toBeGreaterThan(small.hardCapTokens);
  });
});
