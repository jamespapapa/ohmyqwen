import { AnalyzeInput, ImplementOutput, PlanOutput } from "../core/types.js";
import { PackedContext } from "../context/packer.js";

export interface LlmClient {
  proposePlan(input: AnalyzeInput, context: PackedContext): Promise<PlanOutput>;
  proposeImplementation(plan: PlanOutput, context: PackedContext): Promise<ImplementOutput>;
}

export class StubLlmClient implements LlmClient {
  public async proposePlan(
    input: AnalyzeInput,
    context: PackedContext
  ): Promise<PlanOutput> {
    return {
      summary: `Task '${input.taskId}' planning output (${context.fileCount} files)`,
      steps: [
        "Analyze objective and constraints",
        "Generate implementation steps",
        "Prepare verification-ready output"
      ],
      risks: ["Stub client: replace with secured offline adapter"],
      retryPolicy: input.retryPolicy
    };
  }

  public async proposeImplementation(
    plan: PlanOutput,
    context: PackedContext
  ): Promise<ImplementOutput> {
    return {
      changes: [
        {
          path: "src/",
          summary: `Stub implementation generated from plan: ${plan.summary} (shortSession=${context.shortSession})`
        }
      ],
      notes: ["No real file modification in stub mode"],
      retryPolicy: plan.retryPolicy
    };
  }
}
