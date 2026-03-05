import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeCommand,
  executeImplementationActions,
  patchWorkspaceFile,
  PatchTransaction,
  readWorkspaceFile,
  rollbackTransaction,
  writeWorkspaceFile
} from "../src/tools/executor.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("executor", () => {
  it("reads/writes/patches workspace files", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-exec-"));
    tempDirs.push(workspace);

    await writeWorkspaceFile("tmp/sample.txt", "hello world", workspace);
    const read = await readWorkspaceFile("tmp/sample.txt", workspace);
    expect(read).toBe("hello world");

    const patched = await patchWorkspaceFile(
      "tmp/sample.txt",
      "world",
      "runtime",
      false,
      workspace
    );
    expect(patched.replaced).toBe(1);

    const updated = await readWorkspaceFile("tmp/sample.txt", workspace);
    expect(updated).toBe("hello runtime");
  });

  it("blocks writes outside workspace boundary", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-boundary-"));
    tempDirs.push(workspace);

    await expect(writeWorkspaceFile("../escape.txt", "blocked", workspace)).rejects.toThrow(
      "Path escapes workspace"
    );
  });

  it("blocks dangerous commands via allowlist", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-allowlist-"));
    tempDirs.push(workspace);

    const blocked = await executeCommand("git", ["push", "origin", "main"], {
      cwd: workspace,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(blocked.code).toBe(1);
    expect(blocked.stderr).toContain("not allowed");
  });

  it("rolls back patched files with transaction", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-rollback-"));
    tempDirs.push(workspace);

    await writeWorkspaceFile("demo.txt", "v0.1", workspace);
    const transaction = new PatchTransaction(workspace);

    await patchWorkspaceFile("demo.txt", "0.1", "0.2", false, workspace, {
      transaction
    });

    let content = await readWorkspaceFile("demo.txt", workspace);
    expect(content).toBe("v0.2");

    await rollbackTransaction(transaction);

    content = await readWorkspaceFile("demo.txt", workspace);
    expect(content).toBe("v0.1");
  });

  it("supports dry-run execution", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-action-"));
    tempDirs.push(workspace);

    const results = await executeImplementationActions(
      [
        {
          type: "write_file",
          path: "demo.txt",
          content: "v0.1"
        },
        {
          type: "run_command",
          command: "node",
          args: ["-e", "process.stdout.write('ok')"]
        }
      ],
      workspace,
      {
        dryRun: true,
        allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
      }
    );

    expect(results).toHaveLength(2);
    expect(results.every((entry) => entry.ok)).toBe(true);

    await expect(readWorkspaceFile("demo.txt", workspace)).rejects.toThrow();
  });

  it("allows pnpm start with workspace option when path stays inside workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-pnpm-prefix-"));
    tempDirs.push(workspace);

    const result = await executeCommand("pnpm", ["--prefix", "hello-world-node", "start"], {
      cwd: workspace,
      dryRun: true,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[dry-run]");
  });

  it("normalizes pnpm prefix option when it appears after run command", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-pnpm-prefix-reorder-"));
    tempDirs.push(workspace);

    const result = await executeCommand("pnpm", ["run", "start", "--prefix", "hello-world-node"], {
      cwd: workspace,
      dryRun: true,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("pnpm --prefix hello-world-node run start");
  });

  it("allows pnpm version flags", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-pnpm-version-"));
    tempDirs.push(workspace);

    const result = await executeCommand("pnpm", ["-v"], {
      cwd: workspace,
      dryRun: true,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(result.code).toBe(0);
  });

  it("allows pnpm pkg command", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-pnpm-pkg-"));
    tempDirs.push(workspace);

    const result = await executeCommand("pnpm", ["pkg", "get", "name"], {
      cwd: workspace,
      dryRun: true,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("pnpm pkg get name");
  });

  it("allows npm run build command", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-npm-run-"));
    tempDirs.push(workspace);

    const result = await executeCommand("npm", ["run", "build"], {
      cwd: workspace,
      dryRun: true,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("npm run build");
  });

  it("allows gradle wrapper command in allowlist", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-gradlew-"));
    tempDirs.push(workspace);

    const result = await executeCommand("./gradlew", ["wrapper", "--gradle-version", "8.8"], {
      cwd: workspace,
      dryRun: true,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("./gradlew wrapper --gradle-version 8.8");
  });

  it("blocks pnpm workspace option when path escapes workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-pnpm-prefix-escape-"));
    tempDirs.push(workspace);

    const result = await executeCommand("pnpm", ["--prefix", "/tmp", "start"], {
      cwd: workspace,
      dryRun: true,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("path escapes workspace");
  });

  it("includes exit code when command fails without stderr/stdout", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-action-exitcode-"));
    tempDirs.push(workspace);

    const [result] = await executeImplementationActions(
      [
        {
          type: "run_command",
          command: "node",
          args: ["-e", "process.exit(2)"]
        }
      ],
      workspace,
      {
        allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
      }
    );

    expect(result).toBeTruthy();
    expect(result?.ok).toBe(false);
    expect(result?.details).toContain("exit code=2");
  });

  it("captures error message when command exits without stderr output", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-command-message-"));
    tempDirs.push(workspace);

    const result = await executeCommand("node", ["-e", "process.exit(3)"], {
      cwd: workspace,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(result.code).toBe(3);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
