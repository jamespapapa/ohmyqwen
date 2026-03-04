import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeImplementationActions,
  patchWorkspaceFile,
  readWorkspaceFile,
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

  it("executes implement actions", async () => {
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
          type: "patch_file",
          path: "demo.txt",
          find: "0.1",
          replace: "0.1-loop",
          all: false
        },
        {
          type: "run_command",
          command: "node",
          args: ["-e", "process.stdout.write('ok')"]
        }
      ],
      workspace
    );

    expect(results).toHaveLength(3);
    expect(results.every((entry) => entry.ok)).toBe(true);

    const content = await readWorkspaceFile("demo.txt", workspace);
    expect(content).toBe("v0.1-loop");
  });
});
