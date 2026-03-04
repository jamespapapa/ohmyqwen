import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ALLOWED_COMMANDS = new Set(["pnpm", "node", "git"]);

export interface ToolExecResult {
  command: string;
  args: string[];
  code: number;
  stdout: string;
  stderr: string;
}

export async function executeTool(
  command: string,
  args: string[] = [],
  timeoutMs = 30_000
): Promise<ToolExecResult> {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Command not allowed: ${command}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      encoding: "utf8"
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
