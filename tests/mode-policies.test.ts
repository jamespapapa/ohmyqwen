import { describe, expect, it } from "vitest";
import { AnalyzeInput } from "../src/core/types.js";
import { generateClarifyingQuestions, resolveModePolicy } from "../src/modes/policies.js";

function makeInput(overrides?: Partial<AnalyzeInput>): AnalyzeInput {
  return {
    taskId: "mode-test",
    objective: "Add a new feature endpoint",
    constraints: [],
    files: [],
    symbols: [],
    errorLogs: [],
    diffSummary: [],
    contextTier: "small",
    contextTokenBudget: 1200,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 0,
      sameFailureLimit: 2,
      rollbackOnVerifyFail: false
    },
    mode: "auto",
    clarificationAnswers: [],
    dryRun: false,
    ...overrides
  };
}

describe("mode policies", () => {
  it("infers feature mode in auto", () => {
    const resolved = resolveModePolicy(makeInput({ objective: "Implement feature for dashboard" }));
    expect(resolved.mode).toBe("feature");
    expect(resolved.reason).toContain("auto mode inference");
  });

  it("respects manual mode override", () => {
    const resolved = resolveModePolicy(makeInput({ mode: "refactor" }));
    expect(resolved.mode).toBe("refactor");
    expect(resolved.reason).toContain("manual mode override");
  });

  it("generates up to 3 clarifying questions for ambiguous objective", () => {
    const input = makeInput({ objective: "fix it", clarificationAnswers: [] });
    const questions = generateClarifyingQuestions(input);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThanOrEqual(3);

    const resolved = resolveModePolicy(input);
    expect(resolved.waitingRequired).toBe(true);
  });

  it("does not wait when clarification answers are already provided", () => {
    const resolved = resolveModePolicy(
      makeInput({ objective: "fix it", clarificationAnswers: ["update src/a.ts"] })
    );
    expect(resolved.waitingRequired).toBe(false);
  });
});
