import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendFailureSummary, failed, runQualityGates, summarizeFailures } from "../src/gates/verify.js";

const tempDirs: string[] = [];
const itPosix = process.platform === "win32" ? it.skip : it;

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("verify pipeline", () => {
  it("supports profile override and failure classification/signature", async () => {
    const first = await runQualityGates({
      cwd: process.cwd(),
      profileName: "custom",
      profiles: {
        custom: [
          {
            name: "compile-check",
            command: "node",
            args: ["-e", "process.stderr.write('error TS2322 at src/a.ts:1\\n'); process.exit(1);"]
          }
        ]
      }
    });

    const second = await runQualityGates({
      cwd: process.cwd(),
      profileName: "custom",
      profiles: {
        custom: [
          {
            name: "compile-check",
            command: "node",
            args: ["-e", "process.stderr.write('error TS2322 at src/a.ts:1\\n'); process.exit(1);"]
          }
        ]
      }
    });

    expect(first.passed).toBe(false);
    expect(first.failureSummary?.category).toBe("compile");
    expect(first.failureSummary?.relatedFiles.join(" ")).toContain("src/a.ts");
    expect(first.failureSignature).toBeTruthy();
    expect(first.failureSignature).toBe(second.failureSignature);
  });

  it("keeps gate execution order in profile", async () => {
    const result = await runQualityGates({
      cwd: process.cwd(),
      profileName: "ordered",
      profiles: {
        ordered: [
          { name: "build", command: "node", args: ["-e", "process.exit(0)"] },
          { name: "test", command: "node", args: ["-e", "process.exit(0)"] },
          { name: "lint", command: "node", args: ["-e", "process.exit(0)"] }
        ]
      }
    });

    expect(result.gateResults.map((gate) => gate.name)).toEqual(["build", "test", "lint"]);
  });

  it("builds failure helpers for structured summaries", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-verify-summary-"));
    tempDirs.push(workspace);

    const output = await runQualityGates({
      cwd: workspace,
      profileName: "fail-once",
      profiles: {
        "fail-once": [
          {
            name: "test",
            command: "node",
            args: ["-e", "process.stderr.write('expect failed at src/fail.ts:3\\n'); process.exit(1);"]
          }
        ]
      }
    });

    const filePath = path.join(workspace, "failure-summary.json");
    await appendFailureSummary({ filePath, verifyOutput: output, patchAttempt: 0 });
    const summaryText = summarizeFailures(output);
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as { failed: boolean; summaryText: string };

    expect(failed(output)).toBe(true);
    expect(summaryText).toContain("test/");
    expect(persisted.failed).toBe(true);
    expect(persisted.summaryText).toContain("src/fail.ts:3");
  });

  it("records exit-code detail when a gate fails without stdout/stderr", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-verify-exitcode-"));
    tempDirs.push(workspace);

    const output = await runQualityGates({
      cwd: workspace,
      profileName: "silent-fail",
      profiles: {
        "silent-fail": [{ name: "build", command: "node", args: ["-e", "process.exit(1)"] }]
      }
    });

    expect(output.passed).toBe(false);
    expect(output.gateResults[0]?.passed).toBe(false);
    expect(output.gateResults[0]?.details).toContain("exit code=1");
    expect(summarizeFailures(output)).toContain("exit code=1");
  });

  it("normalizes quoted JVM option env vars for verify commands", async () => {
    const previous = process.env.MAVEN_OPTS;
    process.env.MAVEN_OPTS = '"-Xmx64m -Xms64m"';

    try {
      const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-verify-maven-opts-"));
      tempDirs.push(workspace);

      const output = await runQualityGates({
        cwd: workspace,
        profileName: "env-check",
        profiles: {
          "env-check": [
            {
              name: "build",
              command: "node",
              args: [
                "-e",
                "const v=process.env.MAVEN_OPTS||''; if(v !== '-Xmx64m -Xms64m'){process.stderr.write(v); process.exit(1);}"
              ]
            }
          ]
        }
      });

      expect(output.passed).toBe(true);
      expect(output.gateResults[0]?.passed).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.MAVEN_OPTS;
      } else {
        process.env.MAVEN_OPTS = previous;
      }
    }
  });

  it("normalizes quoted lines in .mvn/jvm.config before Maven verify gates", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-verify-jvm-config-"));
    tempDirs.push(workspace);

    await mkdir(path.join(workspace, ".mvn"), { recursive: true });
    await writeFile(
      path.join(workspace, ".mvn", "jvm.config"),
      ['"-Xmx64m"', "'-Xms64m'", "# comment"].join("\n"),
      "utf8"
    );

    const output = await runQualityGates({
      cwd: workspace,
      profileName: "maven-normalize",
      profiles: {
        "maven-normalize": [{ name: "build", command: "./mvnw", args: ["-q", "test"] }]
      },
      dryRun: true,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(output.gateResults[0]?.passed).toBe(true);
    const normalized = await readFile(path.join(workspace, ".mvn", "jvm.config"), "utf8");
    expect(normalized).toContain("-Xmx64m");
    expect(normalized).toContain("-Xms64m");
    expect(normalized).not.toContain("\"-Xmx64m\"");
    expect(normalized).not.toContain("'-Xms64m'");
  });

  it("auto-selects gradle profile when gradle files are present", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-verify-gradle-profile-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "build.gradle"), "plugins { id 'java' }\n", "utf8");
    await writeFile(path.join(workspace, "gradlew"), "#!/bin/sh\necho gradle\n", "utf8");

    const output = await runQualityGates({
      cwd: workspace,
      dryRun: true,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(output.gateResults[0]?.command).toBe("./gradlew");
    expect(output.gateResults[1]?.command).toBe("./gradlew");
    expect(output.gateResults[2]?.command).toBe("./gradlew");
  });

  it("overrides strict profile to gradle when workspace is gradle project", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-verify-gradle-strict-"));
    tempDirs.push(workspace);

    await writeFile(path.join(workspace, "build.gradle.kts"), "plugins { java }\n", "utf8");
    await writeFile(path.join(workspace, "gradlew"), "#!/bin/sh\necho gradle\n", "utf8");

    const output = await runQualityGates({
      cwd: workspace,
      profileName: "strict",
      dryRun: true,
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(output.gateResults[0]?.command).toBe("./gradlew");
  });

  itPosix("makes gradle wrapper executable before running", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-verify-gradle-chmod-"));
    tempDirs.push(workspace);

    const gradlewPath = path.join(workspace, "gradlew");
    await writeFile(gradlewPath, "#!/bin/sh\nexit 0\n", { mode: 0o644 });

    const output = await runQualityGates({
      cwd: workspace,
      profileName: "gradle",
      profiles: {
        gradle: [{ name: "build", command: "./gradlew", args: ["build"] }]
      },
      allowlistPath: path.resolve(process.cwd(), "config", "commands.allowlist.json")
    });

    expect(output.passed).toBe(true);
  });
});
