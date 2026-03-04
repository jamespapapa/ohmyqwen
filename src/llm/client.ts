import {
  AnalyzeInput,
  ImplementOutput,
  ImplementOutputSchema,
  PlanOutput,
  PlanOutputSchema
} from "../core/types.js";
import { PackedContext, renderPackedContext } from "../context/packer.js";

export interface LlmCallTrace {
  mode: "live" | "fallback";
  model: string;
  endpoint: string;
  systemPrompt: string;
  userPrompt: string;
  rawResponse: string;
}

export interface LlmCallResult<T> {
  output: T;
  trace: LlmCallTrace;
}

export interface ProposePlanParams {
  input: AnalyzeInput;
  context: PackedContext;
}

export interface ProposeImplementationParams {
  input: AnalyzeInput;
  plan: PlanOutput;
  context: PackedContext;
  patchAttempt: number;
  strategy: string;
  lastFailure?: string;
}

export interface LlmClient {
  proposePlan(params: ProposePlanParams): Promise<LlmCallResult<PlanOutput>>;
  proposeImplementation(
    params: ProposeImplementationParams
  ): Promise<LlmCallResult<ImplementOutput>>;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

const DEFAULT_MODEL = "fallback-model";

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/v1/chat/completions`;
}

function extractMessageText(payload: OpenAIChatResponse): string {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }

  return "";
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  return text.trim();
}

function extractJsonObject(text: string): unknown {
  const normalized = stripCodeFence(text);
  try {
    return JSON.parse(normalized);
  } catch {
    // Keep trying with substring extraction.
  }

  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = normalized.slice(start, end + 1);
    return JSON.parse(candidate);
  }

  throw new Error("LLM response does not contain valid JSON object");
}

function makePlanSystemPrompt(): string {
  return [
    "You are a coding planner for a controlled runtime.",
    "Return ONLY one JSON object.",
    "Do not include markdown fences.",
    "Respect short-session execution and state-machine constraints.",
    "Output keys: summary, steps, risks, targetSymbols, successCriteria."
  ].join("\n");
}

function makeImplementSystemPrompt(): string {
  return [
    "You are a coding implementer under strict runtime control.",
    "Return ONLY one JSON object.",
    "Do not include markdown fences.",
    "Use small, surgical edits using actions.",
    "Action types: write_file, patch_file, run_command.",
    "Output keys: summary, changes, actions, notes, strategy."
  ].join("\n");
}

function makePlanUserPrompt(params: ProposePlanParams): string {
  return JSON.stringify(
    {
      phase: "PLAN",
      taskId: params.input.taskId,
      objective: params.input.objective,
      constraints: params.input.constraints,
      packedContext: params.context.payload,
      tokenBudget: {
        cap: params.context.hardCapTokens,
        used: params.context.usedTokens,
        truncated: params.context.truncated
      }
    },
    null,
    2
  );
}

function makeImplementUserPrompt(params: ProposeImplementationParams): string {
  return JSON.stringify(
    {
      phase: "IMPLEMENT",
      taskId: params.input.taskId,
      objective: params.input.objective,
      plan: params.plan,
      patchAttempt: params.patchAttempt,
      strategy: params.strategy,
      lastFailure: params.lastFailure ?? null,
      packedContext: params.context.payload,
      contextPreview: renderPackedContext(params.context)
    },
    null,
    2
  );
}

export class OpenAICompatibleLlmClient implements LlmClient {
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly model: string;

  public constructor(config?: { baseUrl?: string; apiKey?: string; model?: string }) {
    this.baseUrl = config?.baseUrl?.trim() || process.env.OHMYQWEN_LLM_BASE_URL?.trim();
    this.apiKey = config?.apiKey?.trim() || process.env.OHMYQWEN_LLM_API_KEY?.trim();
    this.model = config?.model?.trim() || process.env.OHMYQWEN_LLM_MODEL?.trim() || DEFAULT_MODEL;
  }

  private get endpoint(): string {
    if (!this.baseUrl) {
      return "fallback://local-stub";
    }

    return normalizeBaseUrl(this.baseUrl);
  }

  private get useLiveCall(): boolean {
    return Boolean(this.baseUrl && this.model && this.model !== DEFAULT_MODEL);
  }

  private async callChat(systemPrompt: string, userPrompt: string): Promise<LlmCallTrace> {
    if (!this.useLiveCall) {
      return {
        mode: "fallback",
        model: this.model,
        endpoint: this.endpoint,
        systemPrompt,
        userPrompt,
        rawResponse: ""
      };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${message}`);
    }

    const payload = (await response.json()) as OpenAIChatResponse;
    const rawResponse = extractMessageText(payload);

    if (!rawResponse) {
      throw new Error("LLM response is empty");
    }

    return {
      mode: "live",
      model: this.model,
      endpoint: this.endpoint,
      systemPrompt,
      userPrompt,
      rawResponse
    };
  }

  public async proposePlan(params: ProposePlanParams): Promise<LlmCallResult<PlanOutput>> {
    const systemPrompt = makePlanSystemPrompt();
    const userPrompt = makePlanUserPrompt(params);

    const trace = await this.callChat(systemPrompt, userPrompt);
    if (trace.mode === "fallback") {
      const output = PlanOutputSchema.parse({
        summary: `Plan for '${params.input.taskId}'`,
        steps: [
          "Review symbols/error logs/diff summaries",
          "Propose minimal controlled edits",
          "Run verify gates and finalize"
        ],
        risks: ["Fallback plan generated because LLM env is not fully configured"],
        targetSymbols: params.context.payload.symbols,
        successCriteria: ["build/test/lint all pass"],
        retryPolicy: params.input.retryPolicy
      });

      return { output, trace };
    }

    const parsed = extractJsonObject(trace.rawResponse);
    const output = PlanOutputSchema.parse(parsed);
    return { output, trace };
  }

  public async proposeImplementation(
    params: ProposeImplementationParams
  ): Promise<LlmCallResult<ImplementOutput>> {
    const systemPrompt = makeImplementSystemPrompt();
    const userPrompt = makeImplementUserPrompt(params);

    const trace = await this.callChat(systemPrompt, userPrompt);
    if (trace.mode === "fallback") {
      const output = ImplementOutputSchema.parse({
        summary: `Fallback implementation for '${params.input.taskId}'`,
        changes: [
          {
            path: "src/",
            summary: `No-op controlled implementation (strategy=${params.strategy})`
          }
        ],
        actions: [],
        notes: ["No live LLM response; fallback keeps runtime deterministic"],
        strategy: params.strategy,
        retryPolicy: params.input.retryPolicy
      });

      return { output, trace };
    }

    const parsed = extractJsonObject(trace.rawResponse);
    const output = ImplementOutputSchema.parse(parsed);
    return { output, trace };
  }
}
