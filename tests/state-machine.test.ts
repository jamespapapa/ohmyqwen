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

  it("rejects invalid transitions", () => {
    const machine = new RuntimeStateMachine();
    expect(() => machine.transition("VERIFY")).toThrowError(
      "Invalid transition: ANALYZE -> VERIFY"
    );
  });
});
