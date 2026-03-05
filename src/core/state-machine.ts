import { RuntimeState, RuntimeStateSchema } from "./types.js";

const ALLOWED_TRANSITIONS: Record<RuntimeState, RuntimeState[]> = {
  ANALYZE: ["WAIT_CLARIFICATION", "PLAN", "FAIL"],
  WAIT_CLARIFICATION: ["PLAN", "FAIL"],
  PLAN: ["IMPLEMENT", "FAIL"],
  IMPLEMENT: ["VERIFY", "FAIL"],
  VERIFY: ["FINISH", "PATCH", "FAIL"],
  FINISH: [],
  PATCH: ["IMPLEMENT", "FAIL"],
  FAIL: []
};

export class RuntimeStateMachine {
  private state: RuntimeState = "ANALYZE";

  public get current(): RuntimeState {
    return this.state;
  }

  public transition(next: RuntimeState): RuntimeState {
    RuntimeStateSchema.parse(next);

    if (next === this.state) {
      return this.state;
    }

    const allowed = ALLOWED_TRANSITIONS[this.state];
    if (!allowed.includes(next)) {
      throw new Error(`Invalid transition: ${this.state} -> ${next}`);
    }

    this.state = next;
    return this.state;
  }

  public canTransition(next: RuntimeState): boolean {
    RuntimeStateSchema.parse(next);
    return next === this.state || ALLOWED_TRANSITIONS[this.state].includes(next);
  }

  public reset(initial: RuntimeState = "ANALYZE"): void {
    RuntimeStateSchema.parse(initial);
    this.state = initial;
  }
}

export { ALLOWED_TRANSITIONS };
