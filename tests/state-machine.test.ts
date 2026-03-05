import { describe, expect, it } from "vitest";
import { RuntimeStateMachine } from "../src/core/state-machine.js";

describe("RuntimeStateMachine", () => {
  it("follows the canonical loop", () => {
    const machine = new RuntimeStateMachine();
    expect(machine.current).toBe("ANALYZE");

    machine.transition("PLAN");
    machine.transition("IMPLEMENT");
    machine.transition("VERIFY");
    machine.transition("FINISH");

    expect(machine.current).toBe("FINISH");
  });

  it("supports clarification wait transition", () => {
    const machine = new RuntimeStateMachine();
    machine.transition("WAIT_CLARIFICATION");
    machine.transition("PLAN");
    expect(machine.current).toBe("PLAN");
  });

  it("allows idempotent self transition", () => {
    const machine = new RuntimeStateMachine();
    expect(machine.transition("ANALYZE")).toBe("ANALYZE");
    machine.transition("PLAN");
    expect(machine.transition("PLAN")).toBe("PLAN");
  });

  it("rejects invalid transitions", () => {
    const machine = new RuntimeStateMachine();
    expect(() => machine.transition("VERIFY")).toThrowError(
      "Invalid transition: ANALYZE -> VERIFY"
    );
  });
});
