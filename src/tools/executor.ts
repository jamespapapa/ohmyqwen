import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ImplementAction } from "../core/types.js";

const execFileAsync = promisify(execFile);

const ALLOWED_COMMANDS = new Set(["pnpm", "node", "git", "npx"]);

export interface ToolExecResult {
  command: string;
  args: string[];
  code: number;
  stdout: string;
  stderr: string;
}

export interface ActionExecResult {
  type: ImplementAction["type"];
  target: string;
  ok: boolean;
  details: string;
}

function resolveWorkspacePath(targetPath: string, cwd = process.cwd()): string {
  const root = path.resolve(cwd);
  const absolute = path.resolve(root, targetPath);

  if (absolute === root || absolute.startsWith(`${root}${path.sep}`)) {
    return absolute;
  }

  throw new Error(`Path escapes workspace: ${targetPath}`);
}

export async function executeCommand(
  command: string,
  args: string[] = [],
  options?: { timeoutMs?: number; cwd?: string }
): Promise<ToolExecResult> {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Command not allowed: ${command}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: options?.timeoutMs ?? 30_000,
      encoding: "utf8",
      cwd: options?.cwd ?? process.cwd()
    });

    return { command, args, code: 0, stdout, stderr };
  } catch (error) {
    const err = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message: string;
    };

    return {
      command,
      args,
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message
    };
  }
}

export async function readWorkspaceFile(filePath: string, cwd = process.cwd()): Promise<string> {
  const resolved = resolveWorkspacePath(filePath, cwd);
  return fs.readFile(resolved, "utf8");
}

export async function writeWorkspaceFile(
  filePath: string,
  content: string,
  cwd = process.cwd()
): Promise<void> {
  const resolved = resolveWorkspacePath(filePath, cwd);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf8");
}

export async function patchWorkspaceFile(
  filePath: string,
  find: string,
  replace: string,
  all = false,
  cwd = process.cwd()
): Promise<{ replaced: number; path: string }> {
  if (!find) {
    throw new Error("patch_file requires non-empty 'find' value");
  }

  const current = await readWorkspaceFile(filePath, cwd);
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(escaped, all ? "g" : "");
  const matches = current.match(matcher);
  const replaced = matches?.length ?? 0;

  if (replaced === 0) {
    throw new Error(`patch_file could not find target text in ${filePath}`);
  }

  const updated = current.replace(matcher, replace);
  await writeWorkspaceFile(filePath, updated, cwd);

  return { replaced, path: filePath };
}

export async function executeImplementationActions(
  actions: ImplementAction[],
  cwd = process.cwd()
): Promise<ActionExecResult[]> {
  const results: ActionExecResult[] = [];

  for (const action of actions) {
    if (action.type === "write_file") {
      try {
        await writeWorkspaceFile(action.path, action.content, cwd);
        results.push({
          type: action.type,
          target: action.path,
          ok: true,
          details: "file written"
        });
      } catch (error) {
        results.push({
          type: action.type,
          target: action.path,
          ok: false,
          details: error instanceof Error ? error.message : String(error)
        });
      }
      continue;
    }

    if (action.type === "patch_file") {
      try {
        const patched = await patchWorkspaceFile(
          action.path,
          action.find,
          action.replace,
          action.all,
          cwd
        );
        results.push({
          type: action.type,
          target: patched.path,
          ok: true,
          details: `replacements=${patched.replaced}`
        });
      } catch (error) {
        results.push({
          type: action.type,
          target: action.path,
          ok: false,
          details: error instanceof Error ? error.message : String(error)
        });
      }
      continue;
    }

    const commandResult = await executeCommand(action.command, action.args, { cwd });
    results.push({
      type: action.type,
      target: `${action.command} ${action.args.join(" ")}`.trim(),
      ok: commandResult.code === 0,
      details:
        commandResult.code === 0
          ? commandResult.stdout.trim() || "ok"
          : (commandResult.stderr || commandResult.stdout || "failed").trim()
    });
  }

  return results;
}

export { ALLOWED_COMMANDS };
