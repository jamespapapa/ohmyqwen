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
  planningTemplate?: string;
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

interface OpenCodeSessionResponse {
  id: string;
}

interface OpenCodeMessageResponse {
  parts?: Array<{
    type?: string;
    text?: string;
  }>;
}

const DEFAULT_MODEL = "fallback-model";

function buildBasicAuthToken(options: {
  basicAuth?: string;
  basicAuthUser?: string;
  basicAuthPassword?: string;
}): string | undefined {
  const direct = options.basicAuth?.trim();
  if (direct) {
    const separator = direct.includes(":") ? ":" : direct.includes("/") ? "/" : "";
    if (!separator) {
      return direct;
    }

    const [username, ...rest] = direct.split(separator);
    const password = rest.join(separator);
    return Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  }

  const user = options.basicAuthUser?.trim();
  const pass = options.basicAuthPassword?.trim();
  if (!user && !pass) {
    return undefined;
  }

  return Buffer.from(`${user ?? ""}:${pass ?? ""}`, "utf8").toString("base64");
}

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

function normalizeRootUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (trimmed.endsWith("/v1/chat/completions")) {
    return trimmed.slice(0, -"/v1/chat/completions".length);
  }

  if (trimmed.endsWith("/chat/completions")) {
    return trimmed.slice(0, -"/chat/completions".length);
  }

  if (trimmed.endsWith("/v1")) {
    return trimmed.slice(0, -"/v1".length);
  }

  return trimmed;
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

function extractOpenCodeText(payload: OpenCodeMessageResponse): string {
  const parts = payload.parts ?? [];
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  return text.trim();
}

function extractJsonObject(text: string): unknown {
  const tryParseCandidate = (candidate: string): unknown | undefined => {
    const normalizedCandidate = candidate.trim();
    if (!normalizedCandidate) {
      return undefined;
    }

    const attempts = [
      normalizedCandidate,
      repairLikelyJson(normalizedCandidate, { includeBareValueRepair: false }),
      repairLikelyJson(normalizedCandidate, { includeBareValueRepair: true })
    ];

    for (const entry of attempts) {
      try {
        return JSON.parse(entry);
      } catch {
        // keep trying
      }
    }

    return undefined;
  };

  const closePossiblyTruncatedJson = (candidate: string): string => {
    const source = candidate.trimEnd();
    let output = "";
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index] as string;
      output += char;

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        escaped = false;
      } else if (char === "{") {
        stack.push("}");
      } else if (char === "[") {
        stack.push("]");
      } else if (char === "}" || char === "]") {
        if (stack[stack.length - 1] === char) {
          stack.pop();
        }
      }
    }

    if (inString) {
      output += "\"";
    }

    output = output.replace(/,\s*$/, "");
    while (stack.length > 0) {
      output += stack.pop();
    }

    return output;
  };

  const tryParseTruncatedTail = (candidate: string): unknown | undefined => {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith("{")) {
      return undefined;
    }

    const minLength = Math.max(60, trimmed.length - 2400);
    for (let cut = trimmed.length; cut >= minLength; cut -= 8) {
      const partial = trimmed.slice(0, cut).trimEnd();
      if (!partial.startsWith("{")) {
        continue;
      }

      const repaired = closePossiblyTruncatedJson(partial);
      const parsed = tryParseCandidate(repaired);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    }

    return undefined;
  };

  const normalized = stripCodeFence(text);
  {
    const parsed = tryParseCandidate(normalized);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start >= 0) {
    const candidate = end > start ? normalized.slice(start, end + 1) : normalized.slice(start);
    const parsed = tryParseCandidate(candidate);
    if (parsed !== undefined) {
      return parsed;
    }

    const tailParsed = tryParseTruncatedTail(candidate);
    if (tailParsed !== undefined) {
      return tailParsed;
    }
  }

  throw new Error("LLM response does not contain valid JSON object");
}

function shortenForPrompt(value: string, max = 2000): string {
  const normalized = value.trim();
  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max)}\n...<truncated>`;
}

function normalizeJsonStringLiterals(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;

    if (!inString) {
      if (char === "\"") {
        inString = true;
        escaped = false;
      }
      out += char;
      continue;
    }

    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      out += char;
      escaped = true;
      continue;
    }

    if (char === "\n" || char === "\r") {
      out += "\\n";
      continue;
    }

    if (char === "\"") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead] as string)) {
        lookahead += 1;
      }

      const next = text[lookahead];
      const isClosing =
        next === undefined || next === "," || next === "}" || next === "]" || next === ":";
      if (isClosing) {
        inString = false;
        out += char;
      } else {
        out += "\\\"";
      }

      continue;
    }

    out += char;
  }

  if (inString) {
    out += "\"";
  }

  return out;
}

function repairLikelyJson(text: string, options?: { includeBareValueRepair?: boolean }): string {
  let fixed = text.trim();

  fixed = fixed
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");

  fixed = normalizeJsonStringLiterals(fixed);
  fixed = fixed.replace(/:\s*'([^']*)'/g, ': "$1"');

  if (options?.includeBareValueRepair) {
    fixed = fixed.replace(
      /(:\s*)([^"{\[\],\n][^,\}\]\n]*)(\s*[,}\]])/g,
      (_full, prefix: string, rawValue: string, suffix: string) => {
        const value = rawValue.trim();
        if (!value) {
          return `${prefix}""${suffix}`;
        }

        if (
          value.startsWith("\"") ||
          value.startsWith("{") ||
          value.startsWith("[") ||
          /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value) ||
          /^(true|false|null)$/i.test(value)
        ) {
          return `${prefix}${value}${suffix}`;
        }

        const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
        return `${prefix}"${escaped}"${suffix}`;
      }
    );
  }

  return fixed;
}

function normalizeTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["summary", "step", "title", "text", "name", "description", "impact"]) {
      if (typeof record[key] === "string" && record[key].trim()) {
        return record[key].trim();
      }
    }

    try {
      return JSON.stringify(record);
    } catch {
      return "";
    }
  }

  return "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeTextValue(item)).filter(Boolean);
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function coercePlanOutputShape(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const value = raw as Record<string, unknown>;
  return {
    ...value,
    summary: normalizeTextValue(value.summary),
    steps: normalizeStringArray(value.steps),
    risks: normalizeStringArray(value.risks),
    targetSymbols: normalizeStringArray(value.targetSymbols),
    successCriteria: normalizeStringArray(value.successCriteria)
  };
}

function tokenizeArgs(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripShellControlTokens(args: string[]): string[] {
  const controls = new Set(["&&", "||", ";", "|"]);
  const index = args.findIndex((token) => controls.has(token));
  if (index < 0) {
    return args;
  }

  return args.slice(0, index);
}

function isEnvAssignmentToken(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token.trim());
}

function normalizeActionPath(pathValue: string): string {
  const cleaned = stripWrappingQuotes(pathValue).replace(/\\/g, "/");
  if (!cleaned) {
    return cleaned;
  }

  if (cleaned.startsWith("file://")) {
    return normalizeActionPath(cleaned.slice("file://".length));
  }

  const windowsAbsolute = /^[A-Za-z]:\//.test(cleaned);
  if (cleaned.startsWith("/") || windowsAbsolute) {
    const segments = cleaned
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .filter((segment) => !/^[A-Za-z]:$/.test(segment));

    if (segments.length >= 2) {
      return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
    }

    return segments[segments.length - 1] ?? cleaned;
  }

  return cleaned.replace(/^\.\//, "");
}

function normalizeRunCommand(command: string, args: string[]): { command: string; args: string[] } {
  let nextCommand = command.trim();
  let nextArgs = stripShellControlTokens(
    args.map((item) => stripWrappingQuotes(item)).filter(Boolean)
  );

  if (nextCommand.includes(" ") && nextArgs.length === 0) {
    const [head, ...rest] = tokenizeArgs(nextCommand);
    nextCommand = head ?? nextCommand;
    nextArgs = stripShellControlTokens(rest);
  }

  if (isEnvAssignmentToken(nextCommand)) {
    const combined = [nextCommand, ...nextArgs];
    const firstCommandIndex = combined.findIndex((token) => !isEnvAssignmentToken(token));
    if (firstCommandIndex >= 0) {
      nextCommand = combined[firstCommandIndex] as string;
      nextArgs = combined.slice(firstCommandIndex + 1);
    }
  }

  const isNodePackageManager = nextCommand === "npm" || nextCommand === "pnpm";
  if (isNodePackageManager) {
    // Runtime policy: prefer npm for Node projects.
    nextCommand = "npm";
    if (nextArgs.length === 0) {
      nextArgs = ["run", "start"];
    } else if (nextArgs[0]?.startsWith("-")) {
      nextArgs = [...nextArgs];
    } else if (nextArgs[0] === "run") {
      nextArgs = ["run", ...nextArgs.slice(1)];
    } else if (
      [
        "install",
        "init",
        "test",
        "add",
        "remove",
        "uninstall",
        "exec",
        "dlx",
        "pkg",
        "ci",
        "start"
      ].includes(nextArgs[0])
    ) {
      nextArgs = [...nextArgs];
    } else {
      nextArgs = ["run", ...nextArgs];
    }
  }

  if (nextCommand === "npm" && nextArgs[0] === "run" && nextArgs[1] === "init") {
    nextArgs = ["init", ...nextArgs.slice(2)];
  }

  if (nextCommand === "npm" && nextArgs[0] === "run" && nextArgs[1] === "pkg") {
    nextArgs = ["pkg", ...nextArgs.slice(2)];
  }

  if (nextCommand === "npm") {
    const prefixOptionIndex = nextArgs.findIndex((token) => token === "--prefix" || token === "--dir" || token === "-C");
    if (prefixOptionIndex >= 0 && nextArgs[prefixOptionIndex + 1]) {
      const optionToken = nextArgs[prefixOptionIndex] as string;
      const optionValue = nextArgs[prefixOptionIndex + 1] as string;
      const withoutPrefix = nextArgs.filter(
        (_token, index) => index !== prefixOptionIndex && index !== prefixOptionIndex + 1
      );
      nextArgs = [optionToken, optionValue, ...withoutPrefix];
    }
  }

  return { command: nextCommand, args: nextArgs };
}

function coerceImplementAction(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const value = raw as Record<string, unknown>;
  const declaredType = normalizeTextValue(value.type || value.action || value.kind).toLowerCase();
  const pathValue = normalizeActionPath(normalizeTextValue(value.path || value.file || value.target));
  const contentValue = normalizeTextValue(value.content || value.text || value.value || value.newContent);
  const findValue = normalizeTextValue(value.find || value.old || value.pattern || value.before);
  const replaceValue = normalizeTextValue(value.replace || value.new || value.replacement || value.after);

    if (
      declaredType === "run_command" ||
      declaredType === "run" ||
      declaredType === "command" ||
      typeof value.command === "string" ||
    typeof value.cmd === "string"
  ) {
    const command = normalizeTextValue(value.command || value.cmd);
    if (!command) {
      return undefined;
    }

    const rawArgs = value.args;
    let args: string[] = [];
    if (Array.isArray(rawArgs)) {
      args = rawArgs.map((item) => normalizeTextValue(item)).filter(Boolean);
    } else if (typeof rawArgs === "string") {
      args = tokenizeArgs(rawArgs);
    }

    const normalized = normalizeRunCommand(command, args);
    const allowedRuntimeCommands = new Set([
      "npm",
      "pnpm",
      "node",
      "git",
      "npx",
      "./gradlew",
      "gradle",
      "./mvnw",
      "mvn"
    ]);
    const blockedUtilityCommands = new Set(["mkdir", "cd", "pwd", "ls", "curl", "wget"]);
    const normalizedCommand = normalized.command.toLowerCase();
    if (blockedUtilityCommands.has(normalizedCommand)) {
      return undefined;
    }

    if (!allowedRuntimeCommands.has(normalizedCommand)) {
      return undefined;
    }

    if (normalizedCommand === "node" && normalized.args[0] === "-e") {
      return undefined;
    }

    return {
      type: "run_command",
      command: normalized.command,
      args: normalized.args
    };
  }

  if (
    declaredType === "patch_file" ||
    declaredType === "patch" ||
    (pathValue && findValue && (replaceValue || replaceValue === ""))
  ) {
    if (!pathValue || !findValue) {
      return undefined;
    }

    return {
      type: "patch_file",
      path: pathValue,
      find: findValue,
      replace: replaceValue,
      all: Boolean(value.all)
    };
  }

  if (
    declaredType === "write_file" ||
    declaredType === "write" ||
    declaredType === "create_file" ||
    declaredType === "create" ||
    (pathValue && contentValue)
  ) {
    if (!pathValue) {
      return undefined;
    }

    return {
      type: "write_file",
      path: pathValue,
      content: contentValue
    };
  }

  return undefined;
}

function coerceImplementOutputShape(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const value = raw as Record<string, unknown>;

  const rawChanges = Array.isArray(value.changes) ? value.changes : [];
  const changes = rawChanges
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          path: "(unknown)",
          summary: entry
        };
      }

      if (!entry || typeof entry !== "object") {
        return undefined;
      }

      const record = entry as Record<string, unknown>;
      const path = normalizeTextValue(record.path || record.file || record.target || record.name);
      const normalizedPath = normalizeActionPath(path);
      const summary = normalizeTextValue(
        record.summary || record.change || record.description || record.text || record.reason
      );

      if (!normalizedPath || !summary) {
        return undefined;
      }

      return { path: normalizedPath, summary };
    })
    .filter(Boolean);

  const rawActions = Array.isArray(value.actions) ? value.actions : [];
  const actions = rawActions.map((entry) => coerceImplementAction(entry)).filter(Boolean);

  return {
    ...value,
    summary: normalizeTextValue(value.summary),
    changes,
    actions,
    notes: normalizeStringArray(value.notes),
    strategy: normalizeTextValue(value.strategy || value.patchStrategy)
  };
}

function makePlanSystemPrompt(planningTemplate?: string): string {
  const lines = [
    "You are a coding planner for a controlled runtime.",
    "Return ONLY one JSON object.",
    "Do not include markdown fences.",
    "Respect short-session execution and state-machine constraints.",
    "Output keys: summary, steps, risks, targetSymbols, successCriteria."
  ];

  if (planningTemplate) {
    lines.push(`Mode planning template: ${planningTemplate}`);
  }

  return lines.join("\n");
}

function makeImplementSystemPrompt(): string {
  return [
    "You are a coding implementer under strict runtime control.",
    "Return ONLY one JSON object.",
    "Do not include markdown fences.",
    "Use small, surgical edits using actions.",
    "Action types: write_file, patch_file, run_command.",
    "All file paths must be workspace-relative (never absolute paths).",
    "Do not use workdir/cwd fields in actions.",
    "Do not use mkdir/cd for setup. Use write_file to create files/directories.",
    "Do not use curl/wget/network probing commands.",
    "Use npm (not pnpm) for Node script/build/test/lint/install commands unless objective explicitly requires another tool.",
    "Do not use node -e inline scripts. Prefer write_file/patch_file for code and package.json updates.",
    "Do not run build/test/lint/wrapper commands during IMPLEMENT; VERIFY phase executes quality gates.",
    "Avoid long-running server start commands unless explicitly requested.",
    "For API/server objectives, include at least one automated test file validating the endpoint contract.",
    "For patch_file, always provide explicit find and replace fields.",
    "Do not claim execution success. Propose actions only.",
    "Output keys: summary, changes, actions, notes, strategy."
  ].join("\n");
}

function makePlanUserPrompt(params: ProposePlanParams): string {
  const objectiveHints = buildObjectiveHints(params.input.objective);
  return JSON.stringify(
    {
      phase: "PLAN",
      taskId: params.input.taskId,
      objective: params.input.objective,
      objectiveHints,
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

function detectObjectiveRuntime(objective: string): "spring" | "node" | "generic" {
  if (/spring\s*boot|springboot|\bgradle\b|\bmaven\b|\bmvn\b|\bjava\b/i.test(objective)) {
    return "spring";
  }

  if (/\bnode(\.js)?\b|\bnpm\b|\bpnpm\b|\bexpress\b/i.test(objective)) {
    return "node";
  }

  return "generic";
}

function detectPreferredJvmBuildTool(objective: string): "maven" | "gradle" {
  const normalized = objective.toLowerCase();
  if (/\bgradle\b/.test(normalized)) {
    return "gradle";
  }

  if (/\bmaven\b|\bmvn\b/.test(normalized)) {
    return "maven";
  }

  // default JVM preference
  return "maven";
}

function detectSpringCrudMemberIntent(objective: string): boolean {
  const normalized = objective.toLowerCase();
  const mentionsMember = /\bmember\b|회원|멤버/.test(normalized);
  const mentionsCrud =
    /\bcrud\b|생성|수정|삭제|조회|create|update|delete|read|list|get/.test(normalized);
  return mentionsMember && mentionsCrud;
}

function buildObjectiveHints(objective: string): string[] {
  const hints: string[] = [];
  const normalized = objective.trim();
  const lower = normalized.toLowerCase();
  const runtime = detectObjectiveRuntime(normalized);

  const mentionsHelloWorld = /hello\s*world/i.test(normalized);
  const requestsApi =
    /\bexpress\b/i.test(normalized) ||
    /(rest\s*api|restful|api|endpoint|엔드포인트|server|서버|http)/i.test(normalized);
  const requestsStart = /\b(?:npm|pnpm)\s+(?:run\s+)?start\b/i.test(lower);
  const requestsDev = /\b(?:npm|pnpm)\s+(?:run\s+)?dev\b/i.test(lower);
  const requestsLatestExpress = /express.{0,20}(latest|최신)/i.test(normalized);
  const requestedEndpoint = normalized.match(/\/[a-zA-Z0-9._~-]+/g)?.[0];

  if (runtime !== "spring" && mentionsHelloWorld && !requestsApi) {
    hints.push("Prefer minimal CLI hello-world output (console.log) without web server/framework.");
  }

  if (runtime === "spring") {
    const preferredTool = detectPreferredJvmBuildTool(normalized);
    hints.push("This objective requests Spring Boot/Java. Do not generate Node.js/Express artifacts.");
    hints.push(`Preferred JVM build tool: ${preferredTool}`);
    if (detectSpringCrudMemberIntent(normalized)) {
      hints.push("Implement member CRUD API (create/read/update/delete) with JPA + H2 and add endpoint integration tests.");
    } else {
      hints.push("Add at least one automated endpoint contract test (e.g., MockMvc).");
    }
  } else if (requestsApi) {
    hints.push(
      "This objective explicitly requests API/server behavior. Generate express-based server files and avoid replacing it with CLI-only output."
    );
    hints.push("Add at least one automated endpoint contract test for the requested endpoint.");
  }

  if (requestedEndpoint) {
    hints.push(`Required endpoint path detected: ${requestedEndpoint}`);
  }

  if (requestsStart) {
    hints.push("scripts.start must exist and boot the requested runtime behavior.");
  }

  if (requestsDev) {
    hints.push("scripts.dev is explicitly requested and must be included.");
  }

  if (requestsLatestExpress) {
    hints.push("Express latest requirement detected: ensure dependency uses latest-compatible range.");
  }

  return hints;
}

function extractExpectedHelloText(objective: string): string {
  const normalized = objective.trim();
  const quoted = normalized.match(/["'`“”‘’]([^"'`“”‘’]{1,120})["'`“”‘’]/)?.[1]?.trim();
  if (quoted) {
    return quoted;
  }

  if (/hello\s*world!?/i.test(normalized)) {
    return "Hello World!";
  }

  return "Hello World";
}

function buildPlanParseFallback(
  params: ProposePlanParams,
  reason: string,
  rawResponse: string
): PlanOutput {
  const objective = params.input.objective;
  const runtime = detectObjectiveRuntime(objective);
  const preferredJvmTool = detectPreferredJvmBuildTool(objective);
  const isApiObjective =
    /\bexpress\b/i.test(objective) ||
    /(rest\s*api|api|endpoint|엔드포인트|server|서버|http)/i.test(objective);
  const endpoint = objective.match(/\/[a-zA-Z0-9._~-]+/g)?.[0] ?? "/hello";

  const steps = runtime === "spring"
    ? [
        `프로젝트 골격 생성 (${preferredJvmTool} + Spring Boot 3+)`,
        "애플리케이션 엔트리포인트 및 컨트롤러 구현",
        `필수 API '${endpoint}' 구현`,
        "빌드/테스트/검증 게이트 준비",
        "실패 원인 재현 및 수정 전략 수립"
      ]
    : isApiObjective
    ? [
        "프로젝트 메타데이터 점검 및 보강",
        "Express 서버 엔트리 파일 구현",
        `필수 API '${endpoint}' 추가`,
        "실행 및 동작 검증",
        "문서 최소 반영"
      ]
    : [
        "작업 대상 파일 확인",
        "최소 수정 구현",
        "로컬 검증 및 정리"
      ];

  return {
    summary: `Plan fallback: LLM JSON parse failure recovery (${reason.slice(0, 80)})`,
    steps,
    risks: [
      "Fallback plan generated because live LLM response was invalid/truncated JSON",
      `raw-preview=${rawResponse.slice(0, 120).replace(/\s+/g, " ")}`
    ],
    targetSymbols: params.context.payload.symbols,
    successCriteria: ["build/test/lint and objective contract gates pass"],
    retryPolicy: params.input.retryPolicy
  };
}

function buildImplementationParseFallback(
  params: ProposeImplementationParams,
  reason: string,
  rawResponse: string
): ImplementOutput {
  const objective = params.input.objective;
  const lower = objective.toLowerCase();
  const runtime = detectObjectiveRuntime(objective);
  const requiresApi =
    /\bexpress\b/i.test(objective) ||
    /(rest\s*api|api|endpoint|엔드포인트|server|서버|http)/i.test(objective);

  if (runtime === "spring") {
    const preferredTool = detectPreferredJvmBuildTool(objective);
    const isMemberCrud = detectSpringCrudMemberIntent(objective);
    const groupId = "com.example";
    const artifactId = isMemberCrud ? "member-crud-spring" : "hello-spring";
    const packageName = `${groupId}.${isMemberCrud ? "member" : "hello"}`;
    const packagePath = packageName.replace(/\./g, "/");
    const appClassName = `${artifactId
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}Application`;
    const endpoint = objective.match(/\/[a-zA-Z0-9._~-]+/g)?.[0] ?? (isMemberCrud ? "/members" : "/hello");
    const helloText = extractExpectedHelloText(objective);

    const buildGradle = [
      "plugins {",
      "  id 'java'",
      "  id 'org.springframework.boot' version '3.3.5'",
      "  id 'io.spring.dependency-management' version '1.1.6'",
      "}",
      "",
      `group = '${groupId}'`,
      "version = '0.0.1-SNAPSHOT'",
      "",
      "java {",
      "  toolchain {",
      "    languageVersion = JavaLanguageVersion.of(17)",
      "  }",
      "}",
      "",
      "repositories {",
      "  mavenCentral()",
      "}",
      "",
      "dependencies {",
      "  implementation 'org.springframework.boot:spring-boot-starter-web'",
      ...(isMemberCrud ? ["  implementation 'org.springframework.boot:spring-boot-starter-data-jpa'", "  runtimeOnly 'com.h2database:h2'"] : []),
      "  testImplementation 'org.springframework.boot:spring-boot-starter-test'",
      "}",
      "",
      "tasks.named('test') {",
      "  useJUnitPlatform()",
      "}",
      ""
    ].join("\n");

    const settingsGradle = `rootProject.name = '${artifactId}'\n`;
    const applicationSource = [
      `package ${packageName};`,
      "",
      "import org.springframework.boot.SpringApplication;",
      "import org.springframework.boot.autoconfigure.SpringBootApplication;",
      "",
      "@SpringBootApplication",
      `public class ${appClassName} {`,
      "  public static void main(String[] args) {",
      `    SpringApplication.run(${appClassName}.class, args);`,
      "  }",
      "}",
      ""
    ].join("\n");
    const controllerSource = isMemberCrud
      ? [
          `package ${packageName};`,
          "",
          "import org.springframework.http.ResponseEntity;",
          "import org.springframework.web.bind.annotation.DeleteMapping;",
          "import org.springframework.web.bind.annotation.GetMapping;",
          "import org.springframework.web.bind.annotation.PathVariable;",
          "import org.springframework.web.bind.annotation.PostMapping;",
          "import org.springframework.web.bind.annotation.PutMapping;",
          "import org.springframework.web.bind.annotation.RequestBody;",
          "import org.springframework.web.bind.annotation.RequestMapping;",
          "import org.springframework.web.bind.annotation.RestController;",
          "",
          "import java.net.URI;",
          "import java.util.List;",
          "",
          "@RestController",
          "@RequestMapping(\"/members\")",
          "public class MemberController {",
          "  private final MemberRepository memberRepository;",
          "",
          "  public MemberController(MemberRepository memberRepository) {",
          "    this.memberRepository = memberRepository;",
          "  }",
          "",
          "  @PostMapping",
          "  public ResponseEntity<Member> create(@RequestBody MemberRequest request) {",
          "    Member saved = memberRepository.save(new Member(null, request.name(), request.email()));",
          "    return ResponseEntity.created(URI.create(\"/members/\" + saved.getId())).body(saved);",
          "  }",
          "",
          "  @GetMapping",
          "  public List<Member> list() {",
          "    return memberRepository.findAll();",
          "  }",
          "",
          "  @GetMapping(\"/{id}\")",
          "  public ResponseEntity<Member> get(@PathVariable Long id) {",
          "    return memberRepository.findById(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());",
          "  }",
          "",
          "  @PutMapping(\"/{id}\")",
          "  public ResponseEntity<Member> update(@PathVariable Long id, @RequestBody MemberRequest request) {",
          "    return memberRepository.findById(id)",
          "      .map(member -> {",
          "        member.setName(request.name());",
          "        member.setEmail(request.email());",
          "        return ResponseEntity.ok(memberRepository.save(member));",
          "      })",
          "      .orElseGet(() -> ResponseEntity.notFound().build());",
          "  }",
          "",
          "  @DeleteMapping(\"/{id}\")",
          "  public ResponseEntity<Void> delete(@PathVariable Long id) {",
          "    if (!memberRepository.existsById(id)) {",
          "      return ResponseEntity.notFound().build();",
          "    }",
          "    memberRepository.deleteById(id);",
          "    return ResponseEntity.noContent().build();",
          "  }",
          "}",
          ""
        ].join("\n")
      : [
          `package ${packageName};`,
          "",
          "import org.springframework.web.bind.annotation.GetMapping;",
          "import org.springframework.web.bind.annotation.RestController;",
      "",
      "@RestController",
      "public class HelloController {",
      `  @GetMapping("${endpoint}")`,
      "  public String hello() {",
      `    return "${helloText.replace(/"/g, '\\"')}";`,
          "  }",
          "}",
          ""
        ].join("\n");
    const controllerTestSource = isMemberCrud
      ? [
          `package ${packageName};`,
          "",
          "import com.fasterxml.jackson.databind.ObjectMapper;",
          "import org.junit.jupiter.api.Test;",
          "import org.springframework.beans.factory.annotation.Autowired;",
          "import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;",
          "import org.springframework.boot.test.context.SpringBootTest;",
          "import org.springframework.http.MediaType;",
          "import org.springframework.test.web.servlet.MockMvc;",
          "",
          "import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;",
          "import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;",
          "import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;",
          "import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;",
          "",
          "@SpringBootTest",
          "@AutoConfigureMockMvc",
          "class MemberControllerTest {",
          "  @Autowired",
          "  private MockMvc mockMvc;",
          "",
          "  @Autowired",
          "  private ObjectMapper objectMapper;",
          "",
          "  @Test",
          "  void createAndReadMember() throws Exception {",
          "    MemberRequest request = new MemberRequest(\"Alice\", \"alice@example.com\");",
          "",
          "    mockMvc.perform(post(\"/members\")",
          "        .contentType(MediaType.APPLICATION_JSON)",
          "        .content(objectMapper.writeValueAsString(request)))",
          "      .andExpect(status().isCreated())",
          "      .andExpect(jsonPath(\"$.name\").value(\"Alice\"));",
          "",
          "    mockMvc.perform(get(\"/members\"))",
          "      .andExpect(status().isOk())",
          "      .andExpect(jsonPath(\"$[0].email\").value(\"alice@example.com\"));",
          "  }",
          "}",
          ""
        ].join("\n")
      : [
      `package ${packageName};`,
      "",
      "import org.junit.jupiter.api.Test;",
      "import org.springframework.beans.factory.annotation.Autowired;",
      "import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;",
      "import org.springframework.boot.test.context.SpringBootTest;",
      "import org.springframework.test.web.servlet.MockMvc;",
      "",
      "import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;",
      "import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;",
      "import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;",
      "",
      "@SpringBootTest",
      "@AutoConfigureMockMvc",
      "class HelloControllerTest {",
      "  @Autowired",
      "  private MockMvc mockMvc;",
      "",
      "  @Test",
      "  void helloReturnsExpectedResponse() throws Exception {",
      `    mockMvc.perform(get("${endpoint}"))`,
      "      .andExpect(status().isOk())",
      `      .andExpect(content().string("${helloText.replace(/"/g, '\\"')}"));`,
      "  }",
      "}",
      ""
        ].join("\n");
    const memberEntitySource = [
      `package ${packageName};`,
      "",
      "import jakarta.persistence.Entity;",
      "import jakarta.persistence.GeneratedValue;",
      "import jakarta.persistence.GenerationType;",
      "import jakarta.persistence.Id;",
      "import jakarta.persistence.Table;",
      "",
      "@Entity",
      "@Table(name = \"members\")",
      "public class Member {",
      "  @Id",
      "  @GeneratedValue(strategy = GenerationType.IDENTITY)",
      "  private Long id;",
      "  private String name;",
      "  private String email;",
      "",
      "  public Member() {}",
      "",
      "  public Member(Long id, String name, String email) {",
      "    this.id = id;",
      "    this.name = name;",
      "    this.email = email;",
      "  }",
      "",
      "  public Long getId() { return id; }",
      "  public void setId(Long id) { this.id = id; }",
      "  public String getName() { return name; }",
      "  public void setName(String name) { this.name = name; }",
      "  public String getEmail() { return email; }",
      "  public void setEmail(String email) { this.email = email; }",
      "}",
      ""
    ].join("\n");
    const memberRepositorySource = [
      `package ${packageName};`,
      "",
      "import org.springframework.data.jpa.repository.JpaRepository;",
      "",
      "public interface MemberRepository extends JpaRepository<Member, Long> {}",
      ""
    ].join("\n");
    const memberRequestSource = [
      `package ${packageName};`,
      "",
      "public record MemberRequest(String name, String email) {}",
      ""
    ].join("\n");
    const applicationPropertiesSource = [
      "spring.datasource.url=jdbc:h2:mem:memberdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE",
      "spring.datasource.driverClassName=org.h2.Driver",
      "spring.datasource.username=sa",
      "spring.datasource.password=",
      "spring.jpa.hibernate.ddl-auto=update",
      "spring.h2.console.enabled=true",
      ""
    ].join("\n");

    const pomXml = [
      "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"",
      "         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"",
      "         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">",
      "  <modelVersion>4.0.0</modelVersion>",
      "",
      "  <parent>",
      "    <groupId>org.springframework.boot</groupId>",
      "    <artifactId>spring-boot-starter-parent</artifactId>",
      "    <version>3.3.5</version>",
      "    <relativePath/>",
      "  </parent>",
      "",
      `  <groupId>${groupId}</groupId>`,
      `  <artifactId>${artifactId}</artifactId>`,
      "  <version>0.0.1-SNAPSHOT</version>",
      `  <name>${artifactId}</name>`,
      "",
      "  <properties>",
      "    <java.version>17</java.version>",
      "  </properties>",
      "",
      "  <dependencies>",
      "    <dependency>",
      "      <groupId>org.springframework.boot</groupId>",
      "      <artifactId>spring-boot-starter-web</artifactId>",
      "    </dependency>",
      ...(isMemberCrud
        ? [
            "    <dependency>",
            "      <groupId>org.springframework.boot</groupId>",
            "      <artifactId>spring-boot-starter-data-jpa</artifactId>",
            "    </dependency>",
            "    <dependency>",
            "      <groupId>com.h2database</groupId>",
            "      <artifactId>h2</artifactId>",
            "      <scope>runtime</scope>",
            "    </dependency>"
          ]
        : []),
      "    <dependency>",
      "      <groupId>org.springframework.boot</groupId>",
      "      <artifactId>spring-boot-starter-test</artifactId>",
      "      <scope>test</scope>",
      "    </dependency>",
      "  </dependencies>",
      "",
      "  <build>",
      "    <plugins>",
      "      <plugin>",
      "        <groupId>org.springframework.boot</groupId>",
      "        <artifactId>spring-boot-maven-plugin</artifactId>",
      "      </plugin>",
      "    </plugins>",
      "  </build>",
      "</project>",
      ""
    ].join("\n");

    if (preferredTool === "maven") {
      return {
        summary: `Implementation fallback: recovered Spring Boot baseline (maven) from invalid LLM JSON (${reason.slice(0, 80)})`,
        changes: [
          {
            path: "pom.xml",
            summary: `Configure Spring Boot 3 + ${isMemberCrud ? "web+jpa+h2" : "web"} dependencies with Maven`
          },
          {
            path: `src/main/java/${packagePath}/${appClassName}.java`,
            summary: "Add Spring Boot application entry point"
          },
          {
            path: `src/main/java/${packagePath}/${isMemberCrud ? "MemberController" : "HelloController"}.java`,
            summary: isMemberCrud
              ? "Add member CRUD controller endpoints"
              : `Add ${endpoint} endpoint returning ${helloText}`
          },
          ...(isMemberCrud
            ? [
                {
                  path: `src/main/java/${packagePath}/Member.java`,
                  summary: "Add JPA Member entity"
                },
                {
                  path: `src/main/java/${packagePath}/MemberRepository.java`,
                  summary: "Add MemberRepository (JpaRepository)"
                },
                {
                  path: `src/main/java/${packagePath}/MemberRequest.java`,
                  summary: "Add request DTO for member create/update"
                },
                {
                  path: "src/main/resources/application.properties",
                  summary: "Configure in-memory H2 datasource and JPA ddl-auto"
                }
              ]
            : []),
          {
            path: `src/test/java/${packagePath}/${isMemberCrud ? "MemberControllerTest" : "HelloControllerTest"}.java`,
            summary: isMemberCrud
              ? "Add MockMvc integration test for member CRUD endpoint flow"
              : `Add MockMvc contract test for ${endpoint} -> ${helloText}`
          }
        ],
        actions: [
          {
            type: "write_file",
            path: "pom.xml",
            content: pomXml
          },
          {
            type: "write_file",
            path: `src/main/java/${packagePath}/${appClassName}.java`,
            content: applicationSource
          },
          {
            type: "write_file",
            path: `src/main/java/${packagePath}/${isMemberCrud ? "MemberController" : "HelloController"}.java`,
            content: controllerSource
          },
          ...(isMemberCrud
            ? [
                {
                  type: "write_file" as const,
                  path: `src/main/java/${packagePath}/Member.java`,
                  content: memberEntitySource
                },
                {
                  type: "write_file" as const,
                  path: `src/main/java/${packagePath}/MemberRepository.java`,
                  content: memberRepositorySource
                },
                {
                  type: "write_file" as const,
                  path: `src/main/java/${packagePath}/MemberRequest.java`,
                  content: memberRequestSource
                },
                {
                  type: "write_file" as const,
                  path: "src/main/resources/application.properties",
                  content: applicationPropertiesSource
                }
              ]
            : []),
          {
            type: "write_file",
            path: `src/test/java/${packagePath}/${isMemberCrud ? "MemberControllerTest" : "HelloControllerTest"}.java`,
            content: controllerTestSource
          }
        ],
        notes: [
          "Spring fallback implementation generated because live LLM output JSON was invalid/truncated",
          "Maven profile will be used during VERIFY when objective requests Maven or defaults to JVM-safe path",
          `raw-preview=${rawResponse.slice(0, 120).replace(/\s+/g, " ")}`
        ],
        strategy: params.strategy,
        retryPolicy: params.input.retryPolicy
      };
    }

    return {
      summary: `Implementation fallback: recovered Spring Boot baseline (gradle) from invalid LLM JSON (${reason.slice(0, 80)})`,
      changes: [
        { path: "settings.gradle", summary: "Define project name for Gradle build" },
        {
          path: "build.gradle",
          summary: `Configure Spring Boot 3 + ${isMemberCrud ? "web+jpa+h2" : "web"} starter dependencies`
        },
        {
          path: `src/main/java/${packagePath}/${appClassName}.java`,
          summary: "Add Spring Boot application entry point"
        },
        {
          path: `src/main/java/${packagePath}/${isMemberCrud ? "MemberController" : "HelloController"}.java`,
          summary: isMemberCrud
            ? "Add member CRUD controller endpoints"
            : `Add ${endpoint} endpoint returning ${helloText}`
        },
        ...(isMemberCrud
          ? [
              {
                path: `src/main/java/${packagePath}/Member.java`,
                summary: "Add JPA Member entity"
              },
              {
                path: `src/main/java/${packagePath}/MemberRepository.java`,
                summary: "Add MemberRepository (JpaRepository)"
              },
              {
                path: `src/main/java/${packagePath}/MemberRequest.java`,
                summary: "Add request DTO for member create/update"
              },
              {
                path: "src/main/resources/application.properties",
                summary: "Configure in-memory H2 datasource and JPA ddl-auto"
              }
            ]
          : []),
        {
          path: `src/test/java/${packagePath}/${isMemberCrud ? "MemberControllerTest" : "HelloControllerTest"}.java`,
          summary: isMemberCrud
            ? "Add MockMvc integration test for member CRUD endpoint flow"
            : `Add MockMvc contract test for ${endpoint} -> ${helloText}`
        }
      ],
      actions: [
        {
          type: "write_file",
          path: "settings.gradle",
          content: settingsGradle
        },
        {
          type: "write_file",
          path: "build.gradle",
          content: buildGradle
        },
        {
          type: "write_file",
          path: `src/main/java/${packagePath}/${appClassName}.java`,
          content: applicationSource
        },
        {
          type: "write_file",
          path: `src/main/java/${packagePath}/${isMemberCrud ? "MemberController" : "HelloController"}.java`,
          content: controllerSource
        },
        ...(isMemberCrud
          ? [
              {
                type: "write_file" as const,
                path: `src/main/java/${packagePath}/Member.java`,
                content: memberEntitySource
              },
              {
                type: "write_file" as const,
                path: `src/main/java/${packagePath}/MemberRepository.java`,
                content: memberRepositorySource
              },
              {
                type: "write_file" as const,
                path: `src/main/java/${packagePath}/MemberRequest.java`,
                content: memberRequestSource
              },
              {
                type: "write_file" as const,
                path: "src/main/resources/application.properties",
                content: applicationPropertiesSource
              }
            ]
          : []),
        {
          type: "write_file",
          path: `src/test/java/${packagePath}/${isMemberCrud ? "MemberControllerTest" : "HelloControllerTest"}.java`,
          content: controllerTestSource
        }
      ],
      notes: [
        "Spring fallback implementation generated because live LLM output JSON was invalid/truncated",
        "Build/test/lint verification will run via detected JVM profile (gradle/maven) in VERIFY stage",
        `raw-preview=${rawResponse.slice(0, 120).replace(/\s+/g, " ")}`
      ],
      strategy: params.strategy,
      retryPolicy: params.input.retryPolicy
    };
  }

  if (requiresApi) {
    const endpoint = objective.match(/\/[a-zA-Z0-9._~-]+/g)?.[0] ?? "/hello";
    const helloText = extractExpectedHelloText(objective);
    const needsDev = /\b(?:npm|pnpm)\s+(?:run\s+)?dev\b/i.test(lower);

    const scripts: Record<string, string> = {
      start: "node server.js",
      build: "echo \"No build step required\"",
      test: "echo \"No tests configured\"",
      lint: "echo \"No lint configured\""
    };
    if (needsDev) {
      scripts.dev = "node server.js";
    }

    const packageJson = JSON.stringify(
      {
        name: "hello-world-express-api",
        version: "1.0.0",
        private: true,
        main: "server.js",
        scripts,
        dependencies: {
          express: "latest"
        }
      },
      null,
      2
    );

    const serverSource = [
      "const express = require('express');",
      "",
      "const app = express();",
      "const PORT = process.env.PORT || 3000;",
      "",
      `app.get('${endpoint}', (_req, res) => {`,
      `  res.type('text/plain').send('${helloText.replace(/'/g, "\\'")}');`,
      "});",
      "",
      "app.listen(PORT, () => {",
      "  console.log(`Server is running on port ${PORT}`);",
      "});",
      ""
    ].join("\n");

    return {
      summary: `Implementation fallback: recovered from invalid LLM JSON (${reason.slice(0, 80)})`,
      changes: [
        {
          path: "package.json",
          summary: "Add npm scripts and express dependency"
        },
        {
          path: "server.js",
          summary: `Add express server with '${endpoint}' endpoint`
        }
      ],
      actions: [
        {
          type: "write_file",
          path: "package.json",
          content: packageJson
        },
        {
          type: "write_file",
          path: "server.js",
          content: serverSource
        },
        {
          type: "run_command",
          command: "npm",
          args: ["install"]
        }
      ],
      notes: [
        "Fallback implementation generated because live LLM output JSON was invalid/truncated",
        `raw-preview=${rawResponse.slice(0, 120).replace(/\s+/g, " ")}`
      ],
      strategy: params.strategy,
      retryPolicy: params.input.retryPolicy
    };
  }

  return {
    summary: `Implementation fallback: invalid LLM JSON (${reason.slice(0, 80)})`,
    changes: [],
    actions: [],
    notes: [
      "No deterministic objective-specific fallback available; generated safe no-op implementation",
      `raw-preview=${rawResponse.slice(0, 120).replace(/\s+/g, " ")}`
    ],
    strategy: params.strategy,
    retryPolicy: params.input.retryPolicy
  };
}

function scriptNameFromRunCommand(command: string, args: string[]): string | undefined {
  const normalizedCommand = command.toLowerCase();
  if (normalizedCommand !== "npm" && normalizedCommand !== "pnpm") {
    return undefined;
  }

  if (args.length === 0) {
    return undefined;
  }

  if (args[0] === "run" && args[1]) {
    return args[1];
  }

  if (args[0] && !args[0].startsWith("-")) {
    return args[0];
  }

  return undefined;
}

function sanitizeImplementActionsByObjective(
  params: ProposeImplementationParams,
  output: ImplementOutput
): ImplementOutput {
  const objective = params.input.objective;
  const runtime = detectObjectiveRuntime(objective);

  if (runtime === "spring") {
    const keptActions = output.actions.filter((action) => action.type !== "run_command");
    if (keptActions.length === output.actions.length) {
      return output;
    }

    return {
      ...output,
      actions: keptActions,
      notes: [
        ...output.notes,
        "All run_command actions were removed for Spring objective during IMPLEMENT; VERIFY will run Gradle/Maven quality gates."
      ]
    };
  }

  const apiObjective =
    /\bexpress\b/i.test(objective) ||
    /(rest\s*api|api|endpoint|엔드포인트|server|서버|http)/i.test(objective);

  if (!apiObjective) {
    return output;
  }

  const blockedScripts = new Set(["start", "serve", "dev"]);
  const keptActions = output.actions.filter((action) => {
    if (action.type !== "run_command") {
      return true;
    }

    const scriptName = scriptNameFromRunCommand(action.command, action.args);
    if (!scriptName) {
      return true;
    }

    return !blockedScripts.has(scriptName.toLowerCase());
  });

  if (keptActions.length === output.actions.length) {
    return output;
  }

  return {
    ...output,
    actions: keptActions,
    notes: [
      ...output.notes,
      "Long-running npm/pnpm start/serve/dev action was removed during IMPLEMENT; objective-contract gate will verify runtime endpoint using an isolated port."
    ]
  };
}

function isLikelyTruncatedJsonResponse(rawResponse: string): boolean {
  const normalized = stripCodeFence(rawResponse).trim();
  if (!normalized.startsWith("{")) {
    return false;
  }

  if (!normalized.endsWith("}")) {
    return true;
  }

  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] as string;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      escaped = false;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    }
  }

  return depth !== 0 || inString;
}

function isWeakImplementOutput(output: ImplementOutput): boolean {
  if (output.actions.length > 0) {
    return false;
  }

  if (output.changes.length >= 2) {
    return false;
  }

  return true;
}

function makeImplementUserPrompt(params: ProposeImplementationParams): string {
  const objectiveHints = buildObjectiveHints(params.input.objective);

  return JSON.stringify(
    {
      phase: "IMPLEMENT",
      taskId: params.input.taskId,
      objective: params.input.objective,
      objectiveHints,
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
  private readonly basicAuthToken?: string;
  private readonly model: string;
  private readonly endpointKind: "auto" | "openai" | "opencode";

  public constructor(config?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    basicAuth?: string;
    basicAuthUser?: string;
    basicAuthPassword?: string;
    endpointKind?: "auto" | "openai" | "opencode";
  }) {
    this.baseUrl = config?.baseUrl?.trim() || process.env.OHMYQWEN_LLM_BASE_URL?.trim();
    this.apiKey = config?.apiKey?.trim() || process.env.OHMYQWEN_LLM_API_KEY?.trim();
    this.basicAuthToken = buildBasicAuthToken({
      basicAuth: config?.basicAuth?.trim() || process.env.OHMYQWEN_LLM_BASIC_AUTH?.trim(),
      basicAuthUser:
        config?.basicAuthUser?.trim() || process.env.OHMYQWEN_LLM_BASIC_AUTH_USER?.trim(),
      basicAuthPassword:
        config?.basicAuthPassword?.trim() ||
        process.env.OHMYQWEN_LLM_BASIC_AUTH_PASSWORD?.trim()
    });
    this.model = config?.model?.trim() || process.env.OHMYQWEN_LLM_MODEL?.trim() || DEFAULT_MODEL;
    this.endpointKind =
      config?.endpointKind ||
      (process.env.OHMYQWEN_LLM_ENDPOINT_KIND as "auto" | "openai" | "opencode" | undefined) ||
      "auto";
  }

  private get endpoint(): string {
    if (!this.baseUrl) {
      return "fallback://local-stub";
    }

    return normalizeBaseUrl(this.baseUrl);
  }

  private get rootEndpoint(): string {
    if (!this.baseUrl) {
      return "fallback://local-stub";
    }

    return normalizeRootUrl(this.baseUrl);
  }

  private get useLiveCall(): boolean {
    return Boolean(this.baseUrl && this.model && this.model !== DEFAULT_MODEL);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (this.basicAuthToken) {
      headers.Authorization = `Basic ${this.basicAuthToken}`;
    } else if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private async callOpenAiChat(systemPrompt: string, userPrompt: string): Promise<LlmCallTrace> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        max_tokens: 4096,
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

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      const preview = (await response.text()).slice(0, 180).replace(/\s+/g, " ").trim();
      throw new Error(
        `LLM endpoint is not OpenAI-compatible JSON (content-type=${contentType || "unknown"}). response=${preview}`
      );
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

  private async callOpenCodeChat(systemPrompt: string, userPrompt: string): Promise<LlmCallTrace> {
    const createSession = await fetch(`${this.rootEndpoint}/session`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({})
    });

    if (!createSession.ok) {
      const message = await createSession.text();
      throw new Error(`OpenCode session creation failed (${createSession.status}): ${message}`);
    }

    const sessionPayload = (await createSession.json()) as OpenCodeSessionResponse;
    const sessionId = sessionPayload.id;
    if (!sessionId) {
      throw new Error("OpenCode session creation returned empty id");
    }

    const combinedPrompt = [
      "SYSTEM INSTRUCTION:",
      systemPrompt,
      "",
      "USER REQUEST:",
      userPrompt
    ].join("\n");

    const messageResponse = await fetch(`${this.rootEndpoint}/session/${sessionId}/message`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        parts: [{ type: "text", text: combinedPrompt }]
      })
    });

    if (!messageResponse.ok) {
      const message = await messageResponse.text();
      throw new Error(`OpenCode message call failed (${messageResponse.status}): ${message}`);
    }

    const contentType = messageResponse.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      const preview = (await messageResponse.text()).slice(0, 180).replace(/\s+/g, " ").trim();
      throw new Error(
        `OpenCode message endpoint is not JSON (content-type=${contentType || "unknown"}). response=${preview}`
      );
    }

    const messagePayload = (await messageResponse.json()) as OpenCodeMessageResponse;
    const rawResponse = extractOpenCodeText(messagePayload);

    if (!rawResponse) {
      throw new Error("OpenCode response has no text parts");
    }

    return {
      mode: "live",
      model: this.model,
      endpoint: `${this.rootEndpoint}/session/{sessionId}/message`,
      systemPrompt,
      userPrompt,
      rawResponse
    };
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

    if (this.endpointKind === "opencode") {
      return this.callOpenCodeChat(systemPrompt, userPrompt);
    }

    if (this.endpointKind === "openai") {
      return this.callOpenAiChat(systemPrompt, userPrompt);
    }

    try {
      return await this.callOpenAiChat(systemPrompt, userPrompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("not OpenAI-compatible JSON") ||
        message.includes("Unexpected token '<'") ||
        message.includes("OpenCode")
      ) {
        return this.callOpenCodeChat(systemPrompt, userPrompt);
      }

      throw error;
    }
  }

  private async retryForValidJson(options: {
    phase: "PLAN" | "IMPLEMENT";
    systemPrompt: string;
    userPrompt: string;
    invalidRaw: string;
  }): Promise<LlmCallTrace | undefined> {
    if (!this.useLiveCall) {
      return undefined;
    }

    const retrySystem = [
      options.systemPrompt,
      "",
      "CRITICAL: Previous answer was invalid or truncated JSON.",
      "Return ONLY one complete and valid JSON object.",
      "No markdown fence. No prose. No trailing text."
    ].join("\n");
    const retryUser = [
      `PHASE=${options.phase}`,
      "",
      "ORIGINAL REQUEST:",
      options.userPrompt,
      "",
      "PREVIOUS INVALID OUTPUT (for repair context):",
      shortenForPrompt(options.invalidRaw, 1500),
      "",
      "Regenerate from scratch as strictly valid JSON object."
    ].join("\n");

    try {
      return await this.callChat(retrySystem, retryUser);
    } catch {
      return undefined;
    }
  }

  public async proposePlan(params: ProposePlanParams): Promise<LlmCallResult<PlanOutput>> {
    const systemPrompt = makePlanSystemPrompt(params.planningTemplate);
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

    try {
      const parsed = extractJsonObject(trace.rawResponse);
      const output = PlanOutputSchema.parse(coercePlanOutputShape(parsed));
      return { output, trace };
    } catch (error) {
      const retriedTrace = await this.retryForValidJson({
        phase: "PLAN",
        systemPrompt,
        userPrompt,
        invalidRaw: trace.rawResponse
      });
      if (retriedTrace) {
        try {
          const parsed = extractJsonObject(retriedTrace.rawResponse);
          const output = PlanOutputSchema.parse(coercePlanOutputShape(parsed));
          return { output, trace: retriedTrace };
        } catch {
          // continue to enriched error below
        }
      }

      const preview = trace.rawResponse.slice(0, 240).replace(/\s+/g, " ");
      const cause = error instanceof Error ? error.message : String(error);
      const output = PlanOutputSchema.parse(
        buildPlanParseFallback(params, cause, trace.rawResponse)
      );
      return {
        output,
        trace: {
          ...trace,
          rawResponse: `${trace.rawResponse}\n\n[ohmyqwen-fallback-plan] ${preview}`
        }
      };
    }
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

    let firstOutput: ImplementOutput | undefined;
    let firstError: unknown;

    try {
      const parsed = extractJsonObject(trace.rawResponse);
      firstOutput = ImplementOutputSchema.parse(coerceImplementOutputShape(parsed));
    } catch (error) {
      firstError = error;
    }

    const needsRetry =
      firstOutput === undefined ||
      isLikelyTruncatedJsonResponse(trace.rawResponse) ||
      isWeakImplementOutput(firstOutput);

    if (!needsRetry && firstOutput) {
      return {
        output: sanitizeImplementActionsByObjective(params, firstOutput),
        trace
      };
    }

    const retriedTrace = await this.retryForValidJson({
      phase: "IMPLEMENT",
      systemPrompt,
      userPrompt,
      invalidRaw: trace.rawResponse
    });

    if (retriedTrace) {
      try {
        const parsed = extractJsonObject(retriedTrace.rawResponse);
        const output = ImplementOutputSchema.parse(coerceImplementOutputShape(parsed));
        if (!isWeakImplementOutput(output) || !isLikelyTruncatedJsonResponse(retriedTrace.rawResponse)) {
          return {
            output: sanitizeImplementActionsByObjective(params, output),
            trace: retriedTrace
          };
        }

        // Retried output is still likely truncated/weak; continue to deterministic fallback.
      } catch (error) {
        firstError = firstError ?? error;
      }
    }

    const preview = trace.rawResponse.slice(0, 240).replace(/\s+/g, " ");
    const cause = firstError instanceof Error ? firstError.message : String(firstError ?? "invalid JSON");
    const output = ImplementOutputSchema.parse(
      buildImplementationParseFallback(params, cause, trace.rawResponse)
    );
    return {
      output: sanitizeImplementActionsByObjective(params, output),
      trace: {
        ...trace,
        rawResponse: `${trace.rawResponse}\n\n[ohmyqwen-fallback-implement] ${preview}`
      }
    };
  }
}
