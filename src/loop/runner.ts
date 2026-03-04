import {
  AnalyzeInput,
  AnalyzeInputSchema,
  ImplementOutputSchema,
  PlanOutputSchema,
  RuntimeSnapshot,
  VerifyOutputSchema
} from "../core/types.js";
import { RuntimeStateMachine } from "../core/state-machine.js";
import { packContext } from "../context/packer.js";
import { StubLlmClient } from "../llm/client.js";
import { runQualityGates } from "../gates/verify.js";

export interface RunLoopResult {
  finalState: RuntimeSnapshot["state"];
  snapshot: RuntimeSnapshot;
}

export async function runLoop(rawAnalyzeInput: unknown): Promise<RunLoopResult> {
  const analyzeInput: AnalyzeInput = AnalyzeInputSchema.parse(rawAnalyzeInput);
  const machine = new RuntimeStateMachine();
  const llm = new StubLlmClient();

  const snapshot: RuntimeSnapshot = {
    state: machine.current,
    analyzeInput
  };

  const context = packContext({
    taskId: analyzeInput.taskId,
    objective: analyzeInput.objective,
    shortSession: true,
    files: analyzeInput.files
  });

  machine.transition("PLAN");
  snapshot.state = machine.current;

  const planOutput = PlanOutputSchema.parse(await llm.proposePlan(analyzeInput, context));
  snapshot.planOutput = planOutput;

  machine.transition("IMPLEMENT");
  snapshot.state = machine.current;

  const implementOutput = ImplementOutputSchema.parse(
    await llm.proposeImplementation(planOutput, context)
  );
  snapshot.implementOutput = implementOutput;

  machine.transition("VERIFY");
  snapshot.state = machine.current;

  const verifyOutput = VerifyOutputSchema.parse(await runQualityGates());
  snapshot.verifyOutput = verifyOutput;

  machine.transition(verifyOutput.passed ? "FINISH" : "PATCH");
  snapshot.state = machine.current;

  return {
    finalState: snapshot.state,
    snapshot
  };
}
