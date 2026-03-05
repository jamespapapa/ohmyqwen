import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { ImplementAction } from "../core/types.js";

const execFileAsync = promisify(execFile);
const COMMAND_OPTIONS_WITH_VALUE = new Set(["--prefix", "--dir", "-C"]);

const DEFAULT_ALLOWLIST = {
  version: 1,
  commands: {
    npm: {
      allowArgPrefixes: [
        "run",
        "start",
        "install",
        "test",
        "build",
        "lint",
        "typecheck",
        "serve",
        "init",
        "pkg",
        "-v",
        "--version"
      ]
    },
    pnpm: {
      allowArgPrefixes: [
        "run",
        "start",
        "install",
        "test",
        "build",
        "lint",
        "typecheck",
        "serve",
        "init",
        "pkg",
        "-v",
        "--version"
      ]
    },
    node: {
      allowArgPrefixes: ["-e", "-v", "--version", "dist/", "scripts/"]
    },
    git: {
      allowArgPrefixes: ["diff", "status", "log"]
    },
    npx: {
      allowArgPrefixes: ["--no-install", "vitest", "tsc", "ohmyqwen"]
    },
    "./gradlew": {
      allowArgPrefixes: [
        "wrapper",
        "build",
        "test",
        "check",
        "bootRun",
        "clean",
        "tasks",
        "-v",
        "--version"
      ]
    },
    gradle: {
      allowArgPrefixes: [
        "wrapper",
        "build",
        "test",
        "check",
        "bootRun",
        "clean",
        "tasks",
        "-v",
        "--version"
      ]
    },
    "./mvnw": {
      allowArgPrefixes: ["package", "test", "verify", "clean", "-v", "--version"]
    },
    mvn: {
      allowArgPrefixes: ["package", "test", "verify", "clean", "-v", "--version"]
    }
  },
  denyPatterns: ["rm -rf", ":(){", "shutdown", "reboot"]
};

const AllowlistSchema = z.object({
  version: z.literal(1),
  commands: z.record(
    z.string(),
    z.object({
      allowArgPrefixes: z.array(z.string()).default([]),
      denyArgPatterns: z.array(z.string()).default([])
    })
  ),
  denyPatterns: z.array(z.string()).default([])
});

type AllowlistConfig = z.infer<typeof AllowlistSchema>;

const DEFAULT_ALLOWLIST_PATH = path.resolve("config", "commands.allowlist.json");

export interface ToolExecResult {
  command: string;
  args: string[];
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  dryRun?: boolean;
}

export interface ActionExecResult {
  type: ImplementAction["type"];
  target: string;
  ok: boolean;
  details: string;
  durationMs: number;
  dryRun?: boolean;
}

export interface ActionProgressEvent {
  phase: "start" | "finish";
  index: number;
  total: number;
  action: ImplementAction;
  result?: ActionExecResult;
}

export interface CommandExecOptions {
  timeoutMs?: number;
  cwd?: string;
  dryRun?: boolean;
  allowlistPath?: string;
  toolLogPath?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ActionExecOptions {
  dryRun?: boolean;
  transaction?: PatchTransaction;
  toolLogPath?: string;
  allowlistPath?: string;
  onActionEvent?: (event: ActionProgressEvent) => Promise<void> | void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function summarizeText(text: string, max = 600): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max)}...`;
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

async function appendToolLog(logPath: string | undefined, entry: Record<string, unknown>): Promise<void> {
  if (!logPath) {
    return;
  }

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify({ timestamp: nowIso(), ...entry })}\n`, "utf8");
}

function resolveWorkspacePath(targetPath: string, cwd = process.cwd()): string {
  const root = path.resolve(cwd);
  const absolute = path.resolve(root, targetPath);

  if (absolute === root || absolute.startsWith(`${root}${path.sep}`)) {
    return absolute;
  }

  throw new Error(`Path escapes workspace: ${targetPath}`);
}

async function loadAllowlist(cwd = process.cwd(), allowlistPath?: string): Promise<AllowlistConfig> {
  const candidate = path.resolve(cwd, allowlistPath ?? DEFAULT_ALLOWLIST_PATH);

  try {
    const raw = await fs.readFile(candidate, "utf8");
    return AllowlistSchema.parse(JSON.parse(raw));
  } catch {
    return AllowlistSchema.parse(DEFAULT_ALLOWLIST);
  }
}

function isArgAllowedByPrefix(args: string[], prefixes: string[]): boolean {
  if (prefixes.length === 0) {
    return true;
  }

  if (args.length === 0) {
    return false;
  }

  const joined = args.join(" ");
  if (prefixes.some((prefix) => args[0] === prefix || joined.startsWith(prefix))) {
    return true;
  }

  let firstNonOption: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("-")) {
      firstNonOption = token;
      break;
    }

    if (COMMAND_OPTIONS_WITH_VALUE.has(token)) {
      index += 1;
    }
  }

  if (!firstNonOption) {
    return false;
  }

  return prefixes.some((prefix) => firstNonOption === prefix);
}

function validateCommandByAllowlist(
  command: string,
  args: string[],
  config: AllowlistConfig,
  cwd: string
): { ok: boolean; reason?: string } {
  const rule = config.commands[command];
  if (!rule) {
    return { ok: false, reason: `Command not allowed: ${command}` };
  }

  if (!isArgAllowedByPrefix(args, rule.allowArgPrefixes)) {
    return {
      ok: false,
      reason: `Command args not allowed by allowlist: ${command} ${args.join(" ")}`.trim()
    };
  }

  const joined = `${command} ${args.join(" ")}`.trim();

  for (const pattern of config.denyPatterns) {
    if (!pattern) {
      continue;
    }

    if (joined.includes(pattern)) {
      return { ok: false, reason: `Command blocked by deny pattern: ${pattern}` };
    }
  }

  for (const pattern of rule.denyArgPatterns) {
    if (!pattern) {
      continue;
    }
    if (joined.includes(pattern)) {
      return { ok: false, reason: `Command blocked by rule deny pattern: ${pattern}` };
    }
  }

  if (command === "pnpm" || command === "npm") {
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (!COMMAND_OPTIONS_WITH_VALUE.has(token)) {
        continue;
      }

      const candidate = args[index + 1];
      if (!candidate) {
        return { ok: false, reason: `Command args missing value for option: ${token}` };
      }

      const normalizedCandidate = stripWrappingQuotes(candidate);
      try {
        resolveWorkspacePath(normalizedCandidate, cwd);
      } catch {
        return {
          ok: false,
          reason: `Command args path escapes workspace for option ${token}: ${normalizedCandidate}`
        };
      }

      index += 1;
    }
  }

  return { ok: true };
}

function normalizeCommandInvocation(
  command: string,
  args: string[]
): { command: string; args: string[] } {
  if (command !== "pnpm" && command !== "npm") {
    return { command, args };
  }

  const optionIndex = args.findIndex((token) => COMMAND_OPTIONS_WITH_VALUE.has(token));
  if (optionIndex < 0 || optionIndex === 0 || !args[optionIndex + 1]) {
    return { command, args };
  }

  const option = args[optionIndex] as string;
  const optionValue = args[optionIndex + 1] as string;
  const reordered = args.filter((_, index) => index !== optionIndex && index !== optionIndex + 1);
  return {
    command,
    args: [option, optionValue, ...reordered]
  };
}

export class PatchTransaction {
  private readonly backups = new Map<string, string | null>();
  private rolledBack = false;

  public constructor(private readonly cwd = process.cwd()) {}

  public async snapshot(filePath: string): Promise<void> {
    if (this.backups.has(filePath)) {
      return;
    }

    const resolved = resolveWorkspacePath(filePath, this.cwd);

    try {
      const content = await fs.readFile(resolved, "utf8");
      this.backups.set(filePath, content);
    } catch {
      this.backups.set(filePath, null);
    }
  }

  public async rollback(): Promise<void> {
    for (const [filePath, content] of this.backups.entries()) {
      const resolved = resolveWorkspacePath(filePath, this.cwd);
      if (content === null) {
        await fs.rm(resolved, { force: true });
        continue;
      }

      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, "utf8");
    }

    this.rolledBack = true;
  }

  public get touchedFiles(): string[] {
    return Array.from(this.backups.keys());
  }

  public get isRolledBack(): boolean {
    return this.rolledBack;
  }
}

export async function executeCommand(
  command: string,
  args: string[] = [],
  options?: CommandExecOptions
): Promise<ToolExecResult> {
  const normalized = normalizeCommandInvocation(command, args);
  command = normalized.command;
  args = normalized.args;

  const cwd = options?.cwd ?? process.cwd();
  const start = Date.now();
  const allowlist = await loadAllowlist(cwd, options?.allowlistPath);

  const validation = validateCommandByAllowlist(command, args, allowlist, cwd);
  if (!validation.ok) {
    const result: ToolExecResult = {
      command,
      args,
      code: 1,
      stdout: "",
      stderr: validation.reason ?? "command blocked",
      durationMs: Date.now() - start
    };

    await appendToolLog(options?.toolLogPath, {
      type: "command",
      command,
      args,
      exitCode: result.code,
      durationMs: result.durationMs,
      stdout: summarizeText(result.stdout),
      stderr: summarizeText(result.stderr),
      blocked: true
    });

    return result;
  }

  if (options?.dryRun) {
    const result: ToolExecResult = {
      command,
      args,
      code: 0,
      stdout: `[dry-run] ${command} ${args.join(" ")}`.trim(),
      stderr: "",
      durationMs: Date.now() - start,
      dryRun: true
    };

    await appendToolLog(options.toolLogPath, {
      type: "command",
      command,
      args,
      exitCode: result.code,
      durationMs: result.durationMs,
      stdout: summarizeText(result.stdout),
      stderr: summarizeText(result.stderr),
      dryRun: true
    });

    return result;
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: options?.timeoutMs ?? 30_000,
      encoding: "utf8",
      cwd,
      env: options?.env ?? process.env
    });

    const result: ToolExecResult = {
      command,
      args,
      code: 0,
      stdout,
      stderr,
      durationMs: Date.now() - start
    };

    await appendToolLog(options?.toolLogPath, {
      type: "command",
      command,
      args,
      exitCode: result.code,
      durationMs: result.durationMs,
      stdout: summarizeText(result.stdout),
      stderr: summarizeText(result.stderr)
    });

    return result;
  } catch (error) {
    const err = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message: string;
    };
    const exitCode = typeof err.code === "number" ? err.code : 1;
    const stderr = [err.stderr, err.message]
      .map((text) => (typeof text === "string" ? text.trim() : ""))
      .filter(Boolean)
      .join("\n");
    const normalizedStderr =
      stderr && /exit code=\d+/i.test(stderr) ? stderr : `${stderr || "command failed"} (exit code=${exitCode})`;

    const result: ToolExecResult = {
      command,
      args,
      code: exitCode,
      stdout: err.stdout ?? "",
      stderr: normalizedStderr,
      durationMs: Date.now() - start
    };

    await appendToolLog(options?.toolLogPath, {
      type: "command",
      command,
      args,
      exitCode: result.code,
      durationMs: result.durationMs,
      stdout: summarizeText(result.stdout),
      stderr: summarizeText(result.stderr)
    });

    return result;
  }
}

export async function readWorkspaceFile(filePath: string, cwd = process.cwd()): Promise<string> {
  const resolved = resolveWorkspacePath(filePath, cwd);
  return fs.readFile(resolved, "utf8");
}

export async function writeWorkspaceFile(
  filePath: string,
  content: string,
  cwd = process.cwd(),
  options?: { dryRun?: boolean; transaction?: PatchTransaction; toolLogPath?: string }
): Promise<void> {
  const start = Date.now();
  const resolved = resolveWorkspacePath(filePath, cwd);

  if (options?.transaction) {
    await options.transaction.snapshot(filePath);
  }

  if (!options?.dryRun) {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf8");
  }

  await appendToolLog(options?.toolLogPath, {
    type: "write_file",
    path: filePath,
    dryRun: Boolean(options?.dryRun),
    exitCode: 0,
    durationMs: Date.now() - start,
    size: content.length
  });
}

export async function patchWorkspaceFile(
  filePath: string,
  find: string,
  replace: string,
  all = false,
  cwd = process.cwd(),
  options?: { dryRun?: boolean; transaction?: PatchTransaction; toolLogPath?: string }
): Promise<{ replaced: number; path: string }> {
  if (!find) {
    throw new Error("patch_file requires non-empty 'find' value");
  }

  const start = Date.now();
  const current = await readWorkspaceFile(filePath, cwd);
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(escaped, all ? "g" : "");
  const matches = current.match(matcher);
  const replaced = matches?.length ?? 0;

  if (replaced === 0) {
    throw new Error(`patch_file could not find target text in ${filePath}`);
  }

  if (options?.transaction) {
    await options.transaction.snapshot(filePath);
  }

  const updated = current.replace(matcher, replace);
  if (!options?.dryRun) {
    await writeWorkspaceFile(filePath, updated, cwd, {
      dryRun: false,
      transaction: undefined,
      toolLogPath: undefined
    });
  }

  await appendToolLog(options?.toolLogPath, {
    type: "patch_file",
    path: filePath,
    dryRun: Boolean(options?.dryRun),
    exitCode: 0,
    durationMs: Date.now() - start,
    replaced
  });

  return { replaced, path: filePath };
}

export async function executeImplementationActions(
  actions: ImplementAction[],
  cwd = process.cwd(),
  options?: ActionExecOptions
): Promise<ActionExecResult[]> {
  const results: ActionExecResult[] = [];

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index] as ImplementAction;
    await options?.onActionEvent?.({
      phase: "start",
      index,
      total: actions.length,
      action
    });

    const start = Date.now();

    if (action.type === "write_file") {
      let result: ActionExecResult;
      try {
        await writeWorkspaceFile(action.path, action.content, cwd, {
          dryRun: options?.dryRun,
          transaction: options?.transaction,
          toolLogPath: options?.toolLogPath
        });

        result = {
          type: action.type,
          target: action.path,
          ok: true,
          details: options?.dryRun ? "dry-run file write simulated" : "file written",
          durationMs: Date.now() - start,
          dryRun: options?.dryRun
        };
      } catch (error) {
        result = {
          type: action.type,
          target: action.path,
          ok: false,
          details: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
          dryRun: options?.dryRun
        };
      }
      results.push(result);
      await options?.onActionEvent?.({
        phase: "finish",
        index,
        total: actions.length,
        action,
        result
      });
      continue;
    }

    if (action.type === "patch_file") {
      let result: ActionExecResult;
      try {
        const patched = await patchWorkspaceFile(action.path, action.find, action.replace, action.all, cwd, {
          dryRun: options?.dryRun,
          transaction: options?.transaction,
          toolLogPath: options?.toolLogPath
        });
        result = {
          type: action.type,
          target: patched.path,
          ok: true,
          details: `replacements=${patched.replaced}`,
          durationMs: Date.now() - start,
          dryRun: options?.dryRun
        };
      } catch (error) {
        result = {
          type: action.type,
          target: action.path,
          ok: false,
          details: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
          dryRun: options?.dryRun
        };
      }
      results.push(result);
      await options?.onActionEvent?.({
        phase: "finish",
        index,
        total: actions.length,
        action,
        result
      });
      continue;
    }

    const commandResult = await executeCommand(action.command, action.args, {
      cwd,
      dryRun: options?.dryRun,
      allowlistPath: options?.allowlistPath,
      toolLogPath: options?.toolLogPath
    });
    const failureText = [commandResult.stderr, commandResult.stdout]
      .map((text) => text.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    const result: ActionExecResult = {
      type: action.type,
      target: `${action.command} ${action.args.join(" ")}`.trim(),
      ok: commandResult.code === 0,
      details:
        commandResult.code === 0
          ? commandResult.stdout.trim() || "ok"
          : failureText || `failed (exit code=${commandResult.code})`,
      durationMs: Date.now() - start,
      dryRun: options?.dryRun
    };
    results.push(result);
    await options?.onActionEvent?.({
      phase: "finish",
      index,
      total: actions.length,
      action,
      result
    });
  }

  return results;
}

export const ALLOWED_COMMANDS = new Set(Object.keys(DEFAULT_ALLOWLIST.commands));

export async function rollbackTransaction(
  transaction: PatchTransaction | undefined,
  options?: { toolLogPath?: string }
): Promise<void> {
  if (!transaction) {
    return;
  }

  const start = Date.now();
  await transaction.rollback();
  await appendToolLog(options?.toolLogPath, {
    type: "rollback",
    touchedFiles: transaction.touchedFiles,
    exitCode: 0,
    durationMs: Date.now() - start
  });
}
