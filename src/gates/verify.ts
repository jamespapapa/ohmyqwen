import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FailureCategory, FailureSummary, VerifyOutput } from "../core/types.js";
import { executeCommand } from "../tools/executor.js";

export interface VerifyGate {
  name: string;
  command: string;
  args: string[];
  timeoutMs?: number;
}

export type VerifyProfileMap = Record<string, VerifyGate[]>;

export interface VerifyGateProgressEvent {
  phase: "start" | "finish";
  gate: VerifyGate;
  index: number;
  total: number;
  passed?: boolean;
  details?: string;
  durationMs?: number;
}

const VERIFY_PROFILES: VerifyProfileMap = {
  default: [
    { name: "build", command: "npm", args: ["run", "build"] },
    { name: "test", command: "npm", args: ["run", "test"] },
    { name: "lint", command: "npm", args: ["run", "lint"] }
  ],
  strict: [
    { name: "build", command: "npm", args: ["run", "build"] },
    { name: "test", command: "npm", args: ["run", "test"] },
    { name: "lint", command: "npm", args: ["run", "lint"] }
  ],
  service: [
    { name: "build", command: "npm", args: ["run", "build"] },
    { name: "test", command: "npm", args: ["run", "test"] },
    { name: "lint", command: "npm", args: ["run", "lint"] }
  ],
  gradle: [
    { name: "build", command: "./gradlew", args: ["build"] },
    { name: "test", command: "./gradlew", args: ["test"] },
    { name: "lint", command: "./gradlew", args: ["check"] }
  ],
  maven: [
    { name: "build", command: "./mvnw", args: ["-q", "-DskipTests", "package"] },
    { name: "test", command: "./mvnw", args: ["-q", "test"] },
    { name: "lint", command: "./mvnw", args: ["-q", "verify"] }
  ]
};

function buildSanitizedVerifyEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("OHMYQWEN_")) {
      delete env[key];
    }
  }

  const normalizeJvmOptionValue = (value: string | undefined): string | undefined => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return trimmed;
    }

    if (
      (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1).trim();
    }

    return trimmed;
  };

  for (const key of ["MAVEN_OPTS", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "GRADLE_OPTS"]) {
    if (key in env) {
      env[key] = normalizeJvmOptionValue(env[key]);
    }
  }

  return env;
}

function classifyFailure(gateName: string, details: string): FailureCategory {
  const message = `${gateName} ${details}`.toLowerCase();

  if (/command not allowed|not found|enoent|permission denied|blocked|could not find or load main class/.test(message)) {
    return "tooling";
  }

  if (/ts\d+|compile|cannot find name|type error|syntaxerror/.test(message)) {
    return "compile";
  }

  if (/test|expect\(|assertion|vitest|jest|failing test/.test(message)) {
    return "test";
  }

  if (/eslint|lint|prettier|style/.test(message)) {
    return "lint";
  }

  if (/timeout|econn|network|socket|dns|infra/.test(message)) {
    return "infra";
  }

  return "runtime";
}

function extractCoreFailureLines(details: string): string[] {
  const candidates = details
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        /error|failed|exception|enoent|ts\d+|✗|×|cannot|missing|lint|warning/i.test(line) ||
        /\.tsx?:\d+|\.js:\d+/.test(line)
    );

  return candidates.slice(0, 8);
}

function extractRelatedFiles(lines: string[]): string[] {
  const files = new Set<string>();
  for (const line of lines) {
    const matches = line.match(/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md)/g) ?? [];
    for (const match of matches) {
      files.add(match);
    }
  }

  return Array.from(files).slice(0, 12);
}

function extractMissingScripts(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /missing script:?\s*([a-zA-Z0-9:_-]+)/gi,
    /script\s+([a-zA-Z0-9:_-]+)\s+not found/gi
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const script = (match[1] ?? "").trim();
      if (script) {
        found.add(script);
      }
    }
  }

  return Array.from(found);
}

function buildRecommendation(failedGates: VerifyOutput["gateResults"]): string {
  const combined = failedGates.map((gate) => gate.details).join("\n").toLowerCase();
  const missingScripts = extractMissingScripts(combined);
  const hasBuild = missingScripts.includes("build");
  const hasTest = missingScripts.includes("test");
  const hasLint = missingScripts.includes("lint");

  if (hasBuild || hasTest || hasLint) {
    if (hasBuild && hasTest && hasLint) {
      return "Define build/test/lint scripts in the active workspace package.json (or run in the project directory where those scripts exist)";
    }
    return `Define missing script(s): ${missingScripts.join(", ")} before running verify`;
  }

  if (/args not allowed by allowlist|command not allowed/.test(combined)) {
    return "Use allowlisted commands/arguments only and avoid shell-only utilities";
  }

  if (/unterminated string constant|syntaxerror|invalid or unexpected token/.test(combined)) {
    return "Avoid brittle inline node -e scripts; write files and run direct commands";
  }

  if (/eaddrinuse|address already in use/.test(combined)) {
    return "Avoid long-running server start during verify; prefer deterministic one-shot checks";
  }

  return "Patch only related files with minimal edits and re-run failing gate first";
}

function buildFailureSummary(failedGates: VerifyOutput["gateResults"]): FailureSummary | undefined {
  if (failedGates.length === 0) {
    return undefined;
  }

  const first = failedGates[0];
  const coreLines = failedGates
    .flatMap((gate) =>
      extractCoreFailureLines(gate.details).map((line) => `${gate.name}: ${line}`)
    )
    .slice(0, 10);
  const relatedFiles = extractRelatedFiles(coreLines);
  const category =
    failedGates
      .map((gate) => gate.category ?? classifyFailure(gate.name, gate.details))
      .find(Boolean) ?? (first.category ?? classifyFailure(first.name, first.details));

  const rawSignature = [
    category,
    ...failedGates.map((gate) => gate.name),
    ...coreLines.slice(0, 4),
    ...relatedFiles.slice(0, 2)
  ].join("\n");

  const signature = createHash("sha256").update(rawSignature).digest("hex").slice(0, 16);

  return {
    category,
    signature,
    coreLines,
    relatedFiles,
    recommendation: buildRecommendation(failedGates)
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectRuntimeProfile(cwd: string): Promise<"default" | "gradle" | "maven"> {
  const gradleFiles = [
    path.join(cwd, "build.gradle"),
    path.join(cwd, "build.gradle.kts"),
    path.join(cwd, "settings.gradle"),
    path.join(cwd, "settings.gradle.kts"),
    path.join(cwd, "gradlew")
  ];
  if ((await Promise.all(gradleFiles.map((target) => pathExists(target)))).some(Boolean)) {
    return "gradle";
  }

  const mavenFiles = [path.join(cwd, "pom.xml"), path.join(cwd, "mvnw")];
  if ((await Promise.all(mavenFiles.map((target) => pathExists(target)))).some(Boolean)) {
    return "maven";
  }

  return "default";
}

function normalizeJvmConfigLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return line;
  }

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const indent = line.match(/^\s*/)?.[0] ?? "";
    return `${indent}${trimmed.slice(1, -1).trim()}`;
  }

  return line;
}

async function normalizeMavenJvmConfig(cwd: string): Promise<void> {
  const configPath = path.join(cwd, ".mvn", "jvm.config");
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch {
    return;
  }

  const normalized = raw
    .split(/\r?\n/)
    .map((line) => normalizeJvmConfigLine(line))
    .join("\n");

  if (normalized !== raw) {
    await fs.writeFile(configPath, normalized, "utf8");
  }
}

async function withWrapperFallback(gates: VerifyGate[], cwd: string): Promise<VerifyGate[]> {
  const resolved: VerifyGate[] = [];
  for (const gate of gates) {
    if (gate.command === "./gradlew") {
      const wrapper = path.join(cwd, "gradlew");
      try {
        await fs.stat(wrapper);
        resolved.push(gate);
      } catch {
        resolved.push({ ...gate, command: "gradle" });
      }
      continue;
    }

    if (gate.command === "./mvnw") {
      const wrapper = path.join(cwd, "mvnw");
      try {
        await fs.stat(wrapper);
        resolved.push(gate);
      } catch {
        resolved.push({ ...gate, command: "mvn" });
      }
      continue;
    }

    resolved.push(gate);
  }

  return resolved;
}

async function resolveProfile(options?: {
  profileName?: string;
  profiles?: VerifyProfileMap;
  cwd?: string;
}): Promise<VerifyGate[]> {
  const mergedProfiles = {
    ...VERIFY_PROFILES,
    ...(options?.profiles ?? {})
  };

  const detected = await detectRuntimeProfile(options?.cwd ?? process.cwd());
  const requested = options?.profileName;

  let selectedProfileName: string;
  if (!requested) {
    selectedProfileName = detected;
  } else if (detected !== "default" && ["default", "strict", "service"].includes(requested)) {
    // Base profiles are Node-centric. For JVM projects, auto-promote to tool-specific profile.
    selectedProfileName = detected;
  } else {
    selectedProfileName = requested;
  }

  const selected = mergedProfiles[selectedProfileName] ?? mergedProfiles.default;
  return withWrapperFallback(selected, options?.cwd ?? process.cwd());
}

export function finalizeVerifyOutput(gateResults: VerifyOutput["gateResults"]): VerifyOutput {
  const failures = gateResults.filter((gate) => !gate.passed);
  const failureSummary = buildFailureSummary(failures);

  return {
    passed: failures.length === 0,
    gateResults,
    failureSignature: failureSummary?.signature,
    failureSummary
  };
}

export async function runQualityGates(options?: {
  cwd?: string;
  verifyLogPath?: string;
  profileName?: string;
  profiles?: VerifyProfileMap;
  dryRun?: boolean;
  allowlistPath?: string;
  toolLogPath?: string;
  onGateEvent?: (event: VerifyGateProgressEvent) => Promise<void> | void;
}): Promise<VerifyOutput> {
  const gateResults: VerifyOutput["gateResults"] = [];
  const cwd = options?.cwd ?? process.cwd();
  const gates = await resolveProfile({
    profileName: options?.profileName,
    profiles: options?.profiles,
    cwd
  });

  if (gates.some((gate) => gate.command === "./mvnw" || gate.command === "mvn")) {
    await normalizeMavenJvmConfig(cwd);
  }

  for (let index = 0; index < gates.length; index += 1) {
    const gate = gates[index] as VerifyGate;
    await options?.onGateEvent?.({
      phase: "start",
      gate,
      index,
      total: gates.length
    });

    if (gate.command === "./gradlew" || gate.command === "./mvnw") {
      const wrapperPath = path.resolve(cwd, gate.command);
      try {
        const stat = await fs.stat(wrapperPath);
        if ((stat.mode & 0o111) === 0) {
          await fs.chmod(wrapperPath, 0o755);
        }
      } catch {
        // wrapper may be absent; executeCommand/allowlist result will surface the issue
      }
    }

    const result = await executeCommand(gate.command, [...gate.args], {
      cwd,
      timeoutMs: gate.timeoutMs,
      dryRun: options?.dryRun,
      allowlistPath: options?.allowlistPath,
      toolLogPath: options?.toolLogPath,
      env: buildSanitizedVerifyEnv()
    });

    const rawDetails = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    const details =
      rawDetails || (result.code === 0 ? "ok" : `failed (exit code=${result.code})`);
    const category = result.code === 0 ? undefined : classifyFailure(gate.name, details);
    const passed = result.code === 0;

    gateResults.push({
      name: gate.name,
      passed,
      command: gate.command,
      args: [...gate.args],
      details: details || "ok",
      durationMs: result.durationMs,
      category
    });

    if (options?.verifyLogPath) {
      await fs.appendFile(
        options.verifyLogPath,
        [
          `[${new Date().toISOString()}] gate=${gate.name} code=${result.code} category=${category ?? "ok"}`,
          details || "ok",
          ""
        ].join("\n"),
        "utf8"
      );
    }

    await options?.onGateEvent?.({
      phase: "finish",
      gate,
      index,
      total: gates.length,
      passed,
      details: details || "ok",
      durationMs: result.durationMs
    });
  }

  return finalizeVerifyOutput(gateResults);
}

export function failed(output: VerifyOutput): boolean {
  if (!output.passed) {
    return true;
  }

  return output.gateResults.some((gate) => !gate.passed);
}

export function summarizeFailures(output: VerifyOutput): string {
  const failing = output.gateResults.filter((gate) => !gate.passed);
  if (failing.length === 0) {
    return "verification failed";
  }

  return failing
    .map((gate) => {
      const lines = gate.details
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(" | ");
      return `${gate.name}/${gate.category ?? "unknown"}: ${lines}`;
    })
    .join("\n")
    .slice(0, 1800);
}

export async function appendFailureSummary(options: {
  filePath: string;
  verifyOutput: VerifyOutput;
  patchAttempt: number;
}): Promise<void> {
  const payload = {
    patchAttempt: options.patchAttempt,
    failed: failed(options.verifyOutput),
    failureSignature: options.verifyOutput.failureSignature,
    failureSummary: options.verifyOutput.failureSummary,
    summaryText: summarizeFailures(options.verifyOutput),
    gateResults: options.verifyOutput.gateResults
      .filter((gate) => !gate.passed)
      .map((gate) => ({
        name: gate.name,
        category: gate.category,
        details: gate.details.slice(0, 1000)
      })),
    generatedAt: new Date().toISOString()
  };

  await fs.writeFile(options.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function listVerifyProfiles(): VerifyProfileMap {
  return VERIFY_PROFILES;
}
