import { AnalyzeInput, RunMode } from "../core/types.js";

export interface ModePolicy {
  mode: Exclude<RunMode, "auto">;
  maxLoops: number;
  maxPatchRetries: number;
  gateProfile: string;
  planningGuidance: string;
}

export interface ResolvedMode {
  mode: Exclude<RunMode, "auto">;
  reason: string;
  policy: ModePolicy;
  questions: string[];
  waitingRequired: boolean;
}

const MODE_POLICIES: Record<Exclude<RunMode, "auto">, ModePolicy> = {
  feature: {
    mode: "feature",
    maxLoops: 4,
    maxPatchRetries: 3,
    gateProfile: "strict",
    planningGuidance: "Prioritize acceptance criteria, backward compatibility, and rollout-safe steps."
  },
  refactor: {
    mode: "refactor",
    maxLoops: 3,
    maxPatchRetries: 2,
    gateProfile: "strict",
    planningGuidance: "Keep behavior unchanged, focus on structural simplification and safety checks."
  },
  medium: {
    mode: "medium",
    maxLoops: 3,
    maxPatchRetries: 2,
    gateProfile: "default",
    planningGuidance: "Balance delivery speed and risk by scoping edits to the requested module."
  },
  microservice: {
    mode: "microservice",
    maxLoops: 5,
    maxPatchRetries: 4,
    gateProfile: "service",
    planningGuidance: "Validate runtime boundaries, contract compatibility, and operational guardrails first."
  }
};

const AMBIGUOUS_PATTERNS = [
  /fix\s+it/i,
  /do\s+it/i,
  /improve\s+this/i,
  /알아서/i,
  /대충/i,
  /그냥/i
];

function inferModeFromInput(input: AnalyzeInput): { mode: Exclude<RunMode, "auto">; reason: string } {
  const objective = input.objective.toLowerCase();
  const constraints = input.constraints.join(" ").toLowerCase();
  const joined = `${objective} ${constraints}`;

  if (/microservice|service|gateway|api/i.test(joined)) {
    return {
      mode: "microservice",
      reason: "objective/constraints mention service or API boundary terms"
    };
  }

  if (/refactor|cleanup|restructure|리팩터|정리/i.test(joined)) {
    return {
      mode: "refactor",
      reason: "objective/constraints indicate refactor intent"
    };
  }

  if (/feature|implement|add|추가|구현/i.test(joined)) {
    return {
      mode: "feature",
      reason: "objective/constraints indicate feature implementation"
    };
  }

  return {
    mode: "medium",
    reason: "default fallback mode for general coding tasks"
  };
}

export function generateClarifyingQuestions(input: AnalyzeInput): string[] {
  const objective = input.objective.trim();
  if (!objective) {
    return [
      "What exact outcome should be delivered in this run?",
      "Which files or modules are in scope?",
      "What constraints must not be violated?"
    ];
  }

  const isAmbiguous =
    objective.split(/\s+/).length <= 2 || AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(objective));

  if (!isAmbiguous) {
    return [];
  }

  const questions = [
    "What is the concrete expected result (behavior or file changes)?",
    "Which target files/modules should be changed first?",
    "How will we decide this task is done?"
  ];

  return questions.slice(0, 3);
}

export function resolveModePolicy(input: AnalyzeInput): ResolvedMode {
  const inferred = input.mode === "auto" ? inferModeFromInput(input) : { mode: input.mode, reason: "manual mode override from CLI/input" };
  const mode = inferred.mode as Exclude<RunMode, "auto">;
  const policy = MODE_POLICIES[mode];
  const questions = generateClarifyingQuestions(input);
  const waitingRequired =
    input.mode === "auto" && questions.length > 0 && input.clarificationAnswers.length === 0;

  return {
    mode,
    reason: input.mode === "auto" ? `auto mode inference: ${inferred.reason}` : inferred.reason,
    policy,
    questions,
    waitingRequired
  };
}

export function listModePolicies(): Record<Exclude<RunMode, "auto">, ModePolicy> {
  return MODE_POLICIES;
}
