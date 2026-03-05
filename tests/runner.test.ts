import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyzeInput } from "../src/core/types.js";
import { runLoop } from "../src/loop/runner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.OHMYQWEN_AVAILABLE_LIBRARIES_URL;
  delete process.env.OHMYQWEN_LIBRARY_INDEX_URL;
  delete process.env.OHMYQWEN_QMD_FORCE_FAIL;
  vi.unstubAllGlobals();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function baseInput(): AnalyzeInput {
  return {
    taskId: "runner-test",
    objective: "Implement feature safely",
    constraints: ["short-session"],
    files: ["src/demo.ts"],
    symbols: ["demo"],
    errorLogs: [],
    diffSummary: [],
    contextTier: "small",
    contextTokenBudget: 1200,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 0,
      sameFailureLimit: 2,
      rollbackOnVerifyFail: false
    },
    mode: "feature",
    clarificationAnswers: [],
    retrieval: {
      qmd: {
        enabled: false
      }
    },
    dryRun: true
  };
}

describe("runLoop durable state", () => {
  it("executes exactly one controlled short-session loop and persists context artifacts", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-run-controlled-pass-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src/demo.ts"), "export const demo = 1;", "utf8");

    const input: AnalyzeInput = {
      ...baseInput(),
      constraints: [
        "short-session",
        "state-machine-control",
        "structured-json-io",
        "quality-gate-before-finish"
      ],
      dryRun: true
    };

    const result = await runLoop(input, {
      cwd: workspace,
      runId: "controlled-pass",
      dryRun: true
    });

    expect(result.finalState).toBe("FINISH");
    expect(result.failed).toBe(false);
    expect(result.snapshot.patchAttempts).toBe(0);
    expect(result.persistedArtifacts.some((file) => file.includes("context.packed.plan"))).toBe(true);
    expect(result.persistedArtifacts.some((file) => file.includes("context.packed.implement"))).toBe(true);

    const implementContextPath = result.persistedArtifacts.find((file) =>
      file.includes("context.packed.implement")
    );
    expect(implementContextPath).toBeTruthy();

    const packedRaw = await readFile(implementContextPath as string, "utf8");
    const packed = JSON.parse(packedRaw) as {
      runId: string;
      patchAttempt: number;
      payload: { constraints?: string[]; symbols: string[] };
      constraintFlags: string[];
      hash: string;
    };

    expect(packed.runId).toBe("controlled-pass");
    expect(packed.patchAttempt).toBe(0);
    expect(packed.constraintFlags).toContain("state-machine-control");
    expect(packed.payload.symbols.length).toBeGreaterThan(0);
    expect(packed.hash).toHaveLength(16);

    const retrievalRaw = await readFile(
      path.join(
        workspace,
        ".ohmyqwen",
        "runs",
        "controlled-pass",
        "outputs",
        "retrieval.implement.attempt-0.json"
      ),
      "utf8"
    );
    const retrieval = JSON.parse(retrievalRaw) as {
      retrieval: { selectedProvider: string; fallbackUsed: boolean };
    };
    expect(retrieval.retrieval.selectedProvider.length).toBeGreaterThan(0);
  });

  it("applies analyze tuning when availableLibraries are provided", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-run-tuning-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src/demo.ts"), "export const demo = 1;", "utf8");

    const input: AnalyzeInput = {
      ...baseInput(),
      objective: "작업 디렉터리에서 안전하게 기능을 구현해줘.",
      availableLibraries: ["express", "zod"],
      constraints: ["short-session", "state-machine-control"],
      dryRun: true
    };

    const result = await runLoop(input, {
      cwd: workspace,
      runId: "tuning-pass",
      dryRun: true
    });

    expect(result.finalState).toBe("FINISH");

    const tuningRaw = await readFile(
      path.join(workspace, ".ohmyqwen", "runs", "tuning-pass", "outputs", "analyze.tuning.json"),
      "utf8"
    );
    const tuning = JSON.parse(tuningRaw) as { constraints: string[]; availableLibraries: string[] };
    expect(tuning.availableLibraries).toEqual(["express", "zod"]);
    expect(tuning.constraints).toContain("dependency-allowlist-only");
  });

  it("records retrieval fallback evidence when qmd provider fails", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-run-retrieval-fallback-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src/demo.ts"), "export const demo = 1;", "utf8");

    const result = await runLoop(
      {
        ...baseInput(),
        constraints: ["short-session", "state-machine-control"],
        retrieval: {
          qmd: {
            enabled: true,
            forceFailure: true
          }
        },
        dryRun: true
      },
      {
        cwd: workspace,
        runId: "retrieval-fallback-pass",
        dryRun: true
      }
    );

    expect(result.finalState).toBe("FINISH");

    const retrievalRaw = await readFile(
      path.join(
        workspace,
        ".ohmyqwen",
        "runs",
        "retrieval-fallback-pass",
        "outputs",
        "retrieval.implement.attempt-0.json"
      ),
      "utf8"
    );
    const retrieval = JSON.parse(retrievalRaw) as {
      retrieval: {
        fallbackUsed: boolean;
        providerResults: Array<{ provider: string; status: string }>;
      };
    };

    expect(retrieval.retrieval.fallbackUsed).toBe(true);
    expect(
      retrieval.retrieval.providerResults.some(
        (resultEntry) => resultEntry.provider === "qmd" && resultEntry.status === "failed"
      )
    ).toBe(true);
  });

  it("loads availableLibraries from workspace file when input list is absent", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-run-lib-file-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await mkdir(path.join(workspace, ".ohmyqwen"), { recursive: true });
    await writeFile(path.join(workspace, "src/demo.ts"), "export const demo = 1;", "utf8");
    await writeFile(
      path.join(workspace, ".ohmyqwen", "available-libraries.json"),
      JSON.stringify({ availableLibraries: ["express", "zod"] }, null, 2),
      "utf8"
    );

    const input: AnalyzeInput = {
      ...baseInput(),
      objective: "작업 디렉터리에서 안전하게 기능을 구현해줘.",
      constraints: ["short-session", "state-machine-control"],
      dryRun: true
    };

    const result = await runLoop(input, {
      cwd: workspace,
      runId: "lib-file-pass",
      dryRun: true
    });

    expect(result.finalState).toBe("FINISH");

    const analyzeRaw = await readFile(
      path.join(workspace, ".ohmyqwen", "runs", "lib-file-pass", "outputs", "analyze.input.json"),
      "utf8"
    );
    const analyze = JSON.parse(analyzeRaw) as { availableLibraries?: string[] };
    expect(analyze.availableLibraries).toEqual(["express", "zod"]);
  });

  it("fetches availableLibraries from URL when file is missing", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-run-lib-url-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src/demo.ts"), "export const demo = 1;", "utf8");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ libraries: ["express", "axios"] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OHMYQWEN_AVAILABLE_LIBRARIES_URL = "https://example.com/libs.json";

    const input: AnalyzeInput = {
      ...baseInput(),
      objective: "작업 디렉터리에서 안전하게 기능을 구현해줘.",
      constraints: ["short-session", "state-machine-control"],
      dryRun: true
    };

    const result = await runLoop(input, {
      cwd: workspace,
      runId: "lib-url-pass",
      dryRun: true
    });

    expect(result.finalState).toBe("FINISH");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const analyzeRaw = await readFile(
      path.join(workspace, ".ohmyqwen", "runs", "lib-url-pass", "outputs", "analyze.input.json"),
      "utf8"
    );
    const analyze = JSON.parse(analyzeRaw) as { availableLibraries?: string[] };
    expect(analyze.availableLibraries).toEqual(["express", "axios"]);
  });

  it("fails after one controlled attempt when verify gates fail", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-run-controlled-fail-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src/demo.ts"), "export const demo = 1;", "utf8");

    const input: AnalyzeInput = {
      ...baseInput(),
      constraints: ["short-session", "state-machine-control", "quality-gate-before-finish"],
      dryRun: false
    };

    const result = await runLoop(input, {
      cwd: workspace,
      runId: "controlled-fail"
    });

    expect(result.finalState).toBe("FAIL");
    expect(result.failed).toBe(true);
    expect(result.snapshot.patchAttempts).toBe(0);
    expect(result.failureSummary).toContain("build/");

    const transitions = await readFile(
      path.join(workspace, ".ohmyqwen", "runs", "controlled-fail", "state-transitions.jsonl"),
      "utf8"
    );
    expect(transitions).not.toContain("retry patch");
    expect(transitions).not.toContain("strategy switched");

    const failureSummaryRaw = await readFile(
      path.join(workspace, ".ohmyqwen", "runs", "controlled-fail", "outputs", "failure-summary.json"),
      "utf8"
    );
    const failureSummary = JSON.parse(failureSummaryRaw) as { failed: boolean; summaryText: string };
    expect(failureSummary.failed).toBe(true);
    expect(failureSummary.summaryText.length).toBeGreaterThan(0);
  });

  it("supports wait -> resume flow after clarification", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-run-resume-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src/demo.ts"), "export const demo = 1;", "utf8");

    const waitingInput = {
      ...baseInput(),
      objective: "fix it",
      mode: "auto" as const,
      clarificationAnswers: []
    };

    const first = await runLoop(waitingInput, {
      cwd: workspace,
      runId: "resume-flow",
      dryRun: true
    });

    expect(first.finalState).toBe("WAIT_CLARIFICATION");

    const resumed = await runLoop(
      {
        ...waitingInput,
        clarificationAnswers: ["Change only src/demo.ts and pass verify"]
      },
      {
        cwd: workspace,
        runId: "resume-flow",
        resume: true,
        dryRun: true
      }
    );

    expect(resumed.finalState).toBe("FINISH");

    const manifestRaw = await readFile(
      path.join(workspace, ".ohmyqwen", "runs", "resume-flow", "run.json"),
      "utf8"
    );
    const manifest = JSON.parse(manifestRaw) as { status: string; currentState: string };
    expect(manifest.status).toBe("finished");
    expect(manifest.currentState).toBe("FINISH");
  });

  it("skips already-applied attempt actions during resume", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-run-idempotent-"));
    tempDirs.push(workspace);

    const input = baseInput();
    const runDir = path.join(workspace, ".ohmyqwen", "runs", "resume-idempotent");
    await mkdir(path.join(runDir, "outputs"), { recursive: true });
    await mkdir(path.join(runDir, "prompts"), { recursive: true });

    await writeFile(path.join(workspace, "guard.txt"), "once", "utf8");
    await writeFile(path.join(runDir, "outputs", "analyze.input.json"), JSON.stringify(input), "utf8");
    await writeFile(
      path.join(runDir, "outputs", "plan.output.json"),
      JSON.stringify({
        output: {
          summary: "plan",
          steps: ["step"],
          risks: [],
          targetSymbols: [],
          successCriteria: []
        }
      }),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "outputs", "implement.output.attempt-0.json"),
      JSON.stringify({
        output: {
          summary: "impl",
          changes: [{ path: "guard.txt", summary: "would overwrite" }],
          actions: [{ type: "write_file", path: "guard.txt", content: "twice" }],
          notes: [],
          strategy: "focused-fix"
        }
      }),
      "utf8"
    );

    await writeFile(
      path.join(runDir, "run.json"),
      JSON.stringify({
        runId: "resume-idempotent",
        taskId: input.taskId,
        status: "running",
        currentState: "IMPLEMENT",
        mode: "feature",
        modeReason: "manual test",
        loopCount: 1,
        patchAttempts: 0,
        sameFailureCount: 0,
        strategyIndex: 0,
        lastFailureSignature: "",
        waitingQuestions: [],
        checkpoints: {
          planCompleted: true,
          attempts: [
            {
              attempt: 0,
              strategy: "focused-fix",
              implementOutputFile: "implement.output.attempt-0.json",
              actionsFile: "implement.actions.attempt-0.json",
              verifyFile: "verify.output.attempt-0.json",
              actionsApplied: true,
              verifyCompleted: false,
              rolledBack: false
            }
          ]
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      "utf8"
    );

    const resumed = await runLoop(input, {
      cwd: workspace,
      runId: "resume-idempotent",
      resume: true,
      dryRun: true
    });

    expect(resumed.finalState).toBe("FINISH");
    const guard = await readFile(path.join(workspace, "guard.txt"), "utf8");
    expect(guard).toBe("once");
  });

  it("switches patch strategy on repeated failure signature then fails with artifact", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-run-switch-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src/demo.ts"), "export const demo = 1;", "utf8");

    const input: AnalyzeInput = {
      ...baseInput(),
      objective: "Implement a resilient verify patch strategy",
      dryRun: false,
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 0,
        sameFailureLimit: 1,
        rollbackOnVerifyFail: false
      }
    };

    const result = await runLoop(input, {
      cwd: workspace,
      runId: "strategy-switch"
    });

    expect(result.finalState).toBe("FAIL");
    expect(result.snapshot.failReason ?? "").toContain("FAIL_WITH_ARTIFACT");

    const transitions = await readFile(
      path.join(workspace, ".ohmyqwen", "runs", "strategy-switch", "state-transitions.jsonl"),
      "utf8"
    );
    expect(transitions).toContain("strategy switched to wider-context");
  });

  it("prefers Maven verify profile when objective explicitly requests Maven", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-run-maven-profile-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src/main/java/com/example/demo"), { recursive: true });
    await mkdir(path.join(workspace, "src/test/java/com/example/demo"), { recursive: true });
    await writeFile(
      path.join(workspace, "pom.xml"),
      [
        "<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"",
        "         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">",
        "  <modelVersion>4.0.0</modelVersion>",
        "  <groupId>com.example</groupId>",
        "  <artifactId>demo</artifactId>",
        "  <version>0.0.1-SNAPSHOT</version>",
        "  <parent>",
        "    <groupId>org.springframework.boot</groupId>",
        "    <artifactId>spring-boot-starter-parent</artifactId>",
        "    <version>3.3.2</version>",
        "  </parent>",
        "</project>"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(workspace, "src/main/java/com/example/demo/HelloController.java"),
      [
        "package com.example.demo;",
        "import org.springframework.web.bind.annotation.GetMapping;",
        "import org.springframework.web.bind.annotation.RestController;",
        "@RestController",
        "public class HelloController {",
        "  @GetMapping(\"/hello\")",
        "  public String hello() { return \"Hello World!\"; }",
        "}"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(workspace, "src/test/java/com/example/demo/HelloControllerTest.java"),
      [
        "package com.example.demo;",
        "import org.junit.jupiter.api.Test;",
        "class HelloControllerTest {",
        "  @Test",
        "  void contract() {",
        "    String endpoint = \"/hello\";",
        "    String expected = \"Hello World!\";",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );

    const events: string[] = [];
    const input: AnalyzeInput = {
      ...baseInput(),
      objective:
        "springboot 프로젝트를 maven으로 구성하고 /hello 에서 Hello World! 반환하도록 구현해줘. 빌드는 maven 사용",
      dryRun: true
    };

    const result = await runLoop(input, {
      cwd: workspace,
      runId: "maven-profile",
      dryRun: true,
      onEvent: async (event) => {
        if (event.kind === "progress") {
          events.push(event.reason);
        }
      }
    });

    expect(result.finalState).toBe("FINISH");
    expect(events.some((reason) => reason.includes("verify profile selected: maven"))).toBe(true);
  });

  it("defaults Spring objective verify profile to Maven when tool is unspecified", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-run-spring-default-maven-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src/main/java/com/example/demo"), { recursive: true });
    await mkdir(path.join(workspace, "src/test/java/com/example/demo"), { recursive: true });
    await writeFile(
      path.join(workspace, "pom.xml"),
      [
        "<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"",
        "         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">",
        "  <modelVersion>4.0.0</modelVersion>",
        "  <groupId>com.example</groupId>",
        "  <artifactId>demo</artifactId>",
        "  <version>0.0.1-SNAPSHOT</version>",
        "  <parent>",
        "    <groupId>org.springframework.boot</groupId>",
        "    <artifactId>spring-boot-starter-parent</artifactId>",
        "    <version>3.3.2</version>",
        "  </parent>",
        "</project>"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(workspace, "src/main/java/com/example/demo/HelloController.java"),
      [
        "package com.example.demo;",
        "import org.springframework.web.bind.annotation.GetMapping;",
        "import org.springframework.web.bind.annotation.RestController;",
        "@RestController",
        "public class HelloController {",
        "  @GetMapping(\"/hello\")",
        "  public String hello() { return \"Hello World!\"; }",
        "}"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(workspace, "src/test/java/com/example/demo/HelloControllerTest.java"),
      [
        "package com.example.demo;",
        "import org.junit.jupiter.api.Test;",
        "class HelloControllerTest {",
        "  @Test",
        "  void contract() {",
        "    String endpoint = \"/hello\";",
        "    String expected = \"Hello World!\";",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );

    const events: string[] = [];
    const input: AnalyzeInput = {
      ...baseInput(),
      objective: "springboot 3으로 /hello 엔드포인트가 있는 hello world 프로젝트를 만들어줘",
      dryRun: true
    };

    const result = await runLoop(input, {
      cwd: workspace,
      runId: "spring-default-maven-profile",
      dryRun: true,
      onEvent: async (event) => {
        if (event.kind === "progress") {
          events.push(event.reason);
        }
      }
    });

    expect(result.finalState).toBe("FINISH");
    expect(events.some((reason) => reason.includes("verify profile selected: maven"))).toBe(true);
  });
});
