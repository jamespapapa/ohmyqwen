import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
const trackedEnvKeys = [
  "OHMYQWEN_PROJECT_HOME",
  "OHMYQWEN_MEMORY_HOME",
  "OHMYQWEN_LLM_BASE_URL",
  "OHMYQWEN_LLM_MODEL",
  "OHMYQWEN_LLM_ENDPOINT_KIND",
  "OHMYQWEN_SERVER_TRACE"
] as const;
const originalEnv = new Map<string, string | undefined>(
  trackedEnvKeys.map((key) => [key, process.env[key]])
);

const tempDirs: string[] = [];

function jsonResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content
          }
        }
      ]
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    }
  );
}

function installFakeLlm(): void {
  globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    const prompt = (body.messages ?? []).map((entry) => entry.content ?? "").join("\n");

    if (prompt.includes('"task": "Classify the question to one strategy."')) {
      return jsonResponse(
        JSON.stringify({
          strategy: "architecture_overview",
          confidence: 0.82,
          reason: "broad project architecture question",
          targetSymbols: ["LoanController"]
        })
      );
    }

    if (prompt.includes('"task": "Analyze project structure and architecture for memory indexing."')) {
      return jsonResponse(
        JSON.stringify({
          summary: "LoanController orchestrates the sample project flow.",
          architecture: [
            "HTTP requests enter LoanController and delegate to LoanService.",
            "Project search evidence is supplied by the vendored internal qmd runtime."
          ],
          keyModules: [
            {
              name: "LoanController",
              path: "src/LoanController.java",
              role: "controller",
              confidence: 0.91
            }
          ],
          risks: [],
          confidence: 0.77,
          evidence: ["src/LoanController.java - controller entrypoint"]
        })
      );
    }

    if (prompt.includes('"task": "Answer user question using project analysis memory + retrieval evidence."')) {
      return jsonResponse(
        JSON.stringify({
          answer:
            "LoanController is the main entrypoint, and the vendored internal qmd runtime retrieved src/LoanController.java without any external qmd command.",
          confidence: 0.78,
          evidence: [
            "src/LoanController.java - controller entrypoint",
            "src/LoanService.java - delegated business logic"
          ],
          caveats: []
        })
      );
    }

    return jsonResponse(
      JSON.stringify({
        answer: "fallback",
        confidence: 0.4,
        evidence: [],
        caveats: ["unexpected fake llm prompt"]
      })
    );
  }) as typeof fetch;
}

async function writeFakeInternalQmdRuntime(appRoot: string): Promise<void> {
  const vendorRuntimeDir = path.join(appRoot, "vendor", "qmd", "dist");
  await mkdir(vendorRuntimeDir, { recursive: true });
  await writeFile(
    path.join(vendorRuntimeDir, "runtime.js"),
    `import path from "node:path";
export function ensureCollection() { return { added: true }; }
export async function indexCollection() { return { indexed: true }; }
export async function embedPending() { return { embedded: true }; }
export async function syncContexts() { return { added: 1, updated: 0, removed: 0, globalUpdated: true }; }
export async function queryRuntime(options) {
  const prefix = "qmd://" + options.collectionName + "/";
  const controllerPath = prefix + "src/LoanController.java";
  const servicePath = prefix + "src/LoanService.java";
  if (options.mode === "query" || options.mode === "search") {
    return [
      {
        path: controllerPath,
        score: 9.5,
        title: "LoanController",
        context: "controller",
        snippet: "class LoanController"
      },
      {
        path: servicePath,
        score: 8.4,
        title: "LoanService",
        context: "service",
        snippet: "class LoanService"
      }
    ];
  }
  return [];
}
`,
    "utf8"
  );
}

async function writeWorkspaceFixture(workspaceDir: string): Promise<void> {
  await mkdir(path.join(workspaceDir, "src"), { recursive: true });
  await writeFile(
    path.join(workspaceDir, "src", "LoanController.java"),
    [
      "package demo;",
      "public class LoanController {",
      "  private final LoanService loanService = new LoanService();",
      "  public String apply() {",
      "    return loanService.apply();",
      "  }",
      "}"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(workspaceDir, "src", "LoanService.java"),
    [
      "package demo;",
      "public class LoanService {",
      "  public String apply() {",
      "    return \"approved\";",
      "  }",
      "}"
    ].join("\n"),
    "utf8"
  );
}

describe("server projects with vendored internal qmd runtime", () => {
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    vi.resetModules();
    for (const key of trackedEnvKeys) {
      const original = originalEnv.get(key);
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (!dir) {
        continue;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("supports search, analyze, and ask for an external workspace without any qmd CLI command", async () => {
    const appRoot = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-app-root-"));
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-external-workspace-"));
    tempDirs.push(appRoot, workspaceDir);

    await writeFakeInternalQmdRuntime(appRoot);
    await writeWorkspaceFixture(workspaceDir);
    await mkdir(path.join(appRoot, ".ohmyqwen", "runtime", "qmd", "models"), { recursive: true });
    await mkdir(path.join(appRoot, "config"), { recursive: true });

    installFakeLlm();
    process.chdir(appRoot);
    process.env.OHMYQWEN_PROJECT_HOME = path.join(appRoot, ".project-home");
    process.env.OHMYQWEN_SERVER_TRACE = "0";
    process.env.OHMYQWEN_LLM_BASE_URL = "http://fake-llm.local/v1";
    process.env.OHMYQWEN_LLM_MODEL = "Fake-Model";
    process.env.OHMYQWEN_LLM_ENDPOINT_KIND = "openai";

    const projectsModule = await import("../src/server/projects.js");

    const project = await projectsModule.upsertServerProject({
      name: "external-demo",
      workspaceDir,
      retrieval: {
        qmd: {
          integrationMode: "internal-runtime",
          command: "definitely-missing-qmd"
        }
      }
    });

    const search = await projectsModule.searchServerProject({
      projectId: project.id,
      query: "loan controller"
    });
    expect(search.provider).toBe("qmd");
    expect(search.fallbackUsed).toBe(false);
    expect(search.hits[0]?.path).toBe("src/LoanController.java");

    const analysis = await projectsModule.analyzeServerProject({
      projectId: project.id,
      maxFiles: 20
    });
    expect(analysis.summary).toContain("LoanController orchestrates the sample project flow.");
    expect(analysis.diagnostics.llmCallCount).toBeGreaterThan(0);
    expect(analysis.knowledgeSchema?.entityCount).toBeGreaterThan(0);
    expect(analysis.knowledgeSchema?.edgeCount).toBeGreaterThan(0);
    expect(analysis.retrievalUnits?.unitCount).toBeGreaterThan(0);
    const knowledgeSchemaPath = path.join(
      appRoot,
      ".project-home",
      "memory",
      "knowledge-schema",
      "latest.json"
    );
    const knowledgeSchema = JSON.parse(await readFile(knowledgeSchemaPath, "utf8")) as {
      summary?: { entityCount?: number; edgeCount?: number };
    };
    expect(Number(knowledgeSchema.summary?.entityCount ?? 0)).toBeGreaterThan(0);
    expect(Number(knowledgeSchema.summary?.edgeCount ?? 0)).toBeGreaterThan(0);
    const retrievalUnitPath = path.join(
      appRoot,
      ".project-home",
      "memory",
      "retrieval-units",
      "latest.json"
    );
    const retrievalUnits = JSON.parse(await readFile(retrievalUnitPath, "utf8")) as {
      summary?: { unitCount?: number };
    };
    expect(Number(retrievalUnits.summary?.unitCount ?? 0)).toBeGreaterThan(0);

    const ask = await projectsModule.askServerProject({
      projectId: project.id,
      question: "프로젝트 구조를 설명해줘.",
      maxAttempts: 2,
      deterministicOnly: false,
      domainSelectionMode: "auto"
    });
    expect(ask.answer).toContain("vendored internal qmd runtime");
    expect(ask.retrieval.provider).toBe("qmd");
    expect(ask.qualityGatePassed).toBe(true);
    expect(ask.diagnostics.llmCallCount).toBeGreaterThan(0);
  });
});
