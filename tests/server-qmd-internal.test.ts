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
  it("accepts ontology inputs and feeds ontology matches into analyze/search/ask", async () => {
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
      name: "external-demo-ontology",
      workspaceDir,
      retrieval: {
        qmd: {
          integrationMode: "internal-runtime",
          command: "definitely-missing-qmd"
        }
      }
    });

    await projectsModule.analyzeServerProject({
      projectId: project.id,
      maxFiles: 20
    });

    const ontologyInput = await projectsModule.recordServerProjectOntologyInput({
      projectId: project.id,
      kind: "structured",
      scope: "channel",
      title: "모니모 회원인증",
      message: "모니모 회원인증은 브릿지와 등록 흐름이 핵심이다.",
      tags: ["channel:monimo", "domain:member-auth", "action:register"],
      positiveExamples: ["/monimo/registe", "EmbededMemberLoginController"],
      relatedNodeIds: ["controller:RegisteUseDcpChnelController.registe"]
    });
    expect(ontologyInput.artifact.kind).toBe("structured");
    expect(ontologyInput.summary.totalInputs).toBeGreaterThanOrEqual(1);

    const analysis = await projectsModule.analyzeServerProject({
      projectId: project.id,
      maxFiles: 20
    });
    expect(analysis.ontologyInputs?.totalInputs).toBeGreaterThanOrEqual(1);
    expect(analysis.ontologyReview?.totalTargets).toBeGreaterThanOrEqual(0);
    expect(analysis.ontologyGraph?.nodeCount).toBeGreaterThan(0);
    expect(analysis.ontologyProjections?.projectionCount).toBeGreaterThan(0);

    const search = await projectsModule.searchServerProject({
      projectId: project.id,
      query: "모니모 회원인증 등록 흐름"
    });
    expect(search.diagnostics.ontologyGraphLoaded).toBe(true);
    expect((search.diagnostics.matchedOntologyNodeIds ?? []).length).toBeGreaterThan(0);
    expect((search.diagnostics.matchedOntologyProjectionIds ?? []).length).toBeGreaterThan(0);

    const ask = await projectsModule.askServerProject({
      projectId: project.id,
      question: "모니모 회원인증의 흐름이 프론트에서부터 백엔드까지 어떻게 이루어지는지 설명해줘.",
      maxAttempts: 2,
      deterministicOnly: false,
      domainSelectionMode: "auto"
    });
    expect(ask.diagnostics.ontologyGraphLoaded).toBe(true);
    expect((ask.diagnostics.matchedOntologyNodeIds ?? []).length).toBeGreaterThan(0);
    expect((ask.diagnostics.matchedOntologyProjectionIds ?? []).length).toBeGreaterThan(0);
    expect((ask.diagnostics.memoryFiles ?? []).some((entry) => entry.includes("ontology-graph/latest.md"))).toBe(true);

    const ontologyInputPath = path.join(appRoot, ".project-home", "memory", "ontology-inputs", "summary.json");
    const ontologyReviewPath = path.join(appRoot, ".project-home", "memory", "ontology-review", "latest.json");
    const ontologyInputSnapshot = JSON.parse(await readFile(ontologyInputPath, "utf8")) as { summary?: { totalInputs?: number } };
    const ontologyReviewSnapshot = JSON.parse(await readFile(ontologyReviewPath, "utf8")) as { summary?: { totalTargets?: number } };
    expect(Number(ontologyInputSnapshot.summary?.totalInputs ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(ontologyReviewSnapshot.summary?.totalTargets ?? 0)).toBeGreaterThanOrEqual(0);
  });

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
    expect(analysis.ontologyGraph?.nodeCount).toBeGreaterThan(0);
    expect(analysis.ontologyProjections?.projectionCount).toBeGreaterThan(0);
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
    const ontologyGraphPath = path.join(
      appRoot,
      ".project-home",
      "memory",
      "ontology-graph",
      "latest.json"
    );
    const ontologyGraph = JSON.parse(await readFile(ontologyGraphPath, "utf8")) as {
      summary?: { nodeCount?: number; edgeCount?: number };
    };
    expect(Number(ontologyGraph.summary?.nodeCount ?? 0)).toBeGreaterThan(0);
    expect(Number(ontologyGraph.summary?.edgeCount ?? 0)).toBeGreaterThan(0);
    const ontologyProjectionPath = path.join(
      appRoot,
      ".project-home",
      "memory",
      "ontology-projections",
      "latest.json"
    );
    const ontologyProjections = JSON.parse(await readFile(ontologyProjectionPath, "utf8")) as {
      summary?: { projectionCount?: number };
    };
    expect(Number(ontologyProjections.summary?.projectionCount ?? 0)).toBeGreaterThan(0);

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
    expect(ask.diagnostics.questionType).toBe("domain_capability_overview");
    expect((ask.diagnostics.matchedRetrievalUnitIds ?? []).length).toBeGreaterThan(0);
    expect((ask.diagnostics.memoryFiles ?? []).some((entry) => entry.includes("evaluation-artifacts/latest.md"))).toBe(true);
    expect((ask.diagnostics.memoryFiles ?? []).some((entry) => entry.includes("evaluation-replay/latest.md"))).toBe(true);
    expect((ask.diagnostics.memoryFiles ?? []).some((entry) => entry.includes("evaluation-trends/latest.md"))).toBe(true);
    const askEvaluationPath = path.join(
      appRoot,
      ".project-home",
      "memory",
      "evaluation-artifacts",
      "latest.json"
    );
    const askEvaluation = JSON.parse(await readFile(askEvaluationPath, "utf8")) as {
      kind?: string;
      questionType?: string;
      metrics?: { retrievalCoverageScore?: number };
    };
    expect(askEvaluation.kind).toBe("ask");
    expect(askEvaluation.questionType).toBe("domain_capability_overview");
    expect(Number(askEvaluation.metrics?.retrievalCoverageScore ?? 0)).toBeGreaterThan(0);

    const roleSearch = await projectsModule.searchServerProject({
      projectId: project.id,
      query: "이 프로젝트는 어떤 역할을 하는가?"
    });
    expect(roleSearch.diagnostics.questionType).toBe("module_role_explanation");
    expect(roleSearch.diagnostics.retrievalUnitLoaded).toBe(true);
    expect((roleSearch.diagnostics.matchedRetrievalUnitIds ?? []).length).toBeGreaterThan(0);
    expect((roleSearch.diagnostics.matchedRetrievalUnitStatuses ?? []).length).toBeGreaterThan(0);
    const searchEvaluation = JSON.parse(await readFile(askEvaluationPath, "utf8")) as {
      kind?: string;
      questionType?: string;
      metrics?: { retrievalCoverageScore?: number };
    };
    expect(searchEvaluation.kind).toBe("search");
    expect(searchEvaluation.questionType).toBe("module_role_explanation");
    expect(Number(searchEvaluation.metrics?.retrievalCoverageScore ?? 0)).toBeGreaterThan(0);
    const replayPath = path.join(
      appRoot,
      ".project-home",
      "memory",
      "evaluation-replay",
      "latest.json"
    );
    const replay = JSON.parse(await readFile(replayPath, "utf8")) as {
      summary?: { totalArtifacts?: number; askCount?: number; searchCount?: number };
      replayCandidates?: Array<{ kind?: string }>;
    };
    expect(Number(replay.summary?.totalArtifacts ?? 0)).toBeGreaterThanOrEqual(2);
    expect(Number(replay.summary?.askCount ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(replay.summary?.searchCount ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(replay.replayCandidates)).toBe(true);
    const trendPath = path.join(
      appRoot,
      ".project-home",
      "memory",
      "evaluation-trends",
      "latest.json"
    );
    const trends = JSON.parse(await readFile(trendPath, "utf8")) as {
      summary?: { totalArtifacts?: number; questionTypeCount?: number };
      byQuestionType?: Array<{ questionType?: string; total?: number }>;
    };
    expect(Number(trends.summary?.totalArtifacts ?? 0)).toBeGreaterThanOrEqual(2);
    expect(Number(trends.summary?.questionTypeCount ?? 0)).toBeGreaterThanOrEqual(2);
    expect((trends.byQuestionType ?? []).some((entry) => entry.questionType === "domain_capability_overview")).toBe(true);

    const cachedAnalysis = await projectsModule.analyzeServerProject({
      projectId: project.id,
      maxFiles: 20
    });
    expect(cachedAnalysis.evaluationTrends?.totalArtifacts).toBeGreaterThanOrEqual(2);
    expect((cachedAnalysis.evaluationTrends?.topQuestionTypes ?? []).length).toBeGreaterThan(0);
    expect(cachedAnalysis.evaluationReplay?.totalArtifacts).toBeGreaterThanOrEqual(2);
    expect(cachedAnalysis.evaluationPromotions?.totalActions ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("promotes matched learned knowledge from accumulated search and ask evaluations", async () => {
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
      name: "external-demo-promotion",
      workspaceDir,
      retrieval: {
        qmd: {
          integrationMode: "internal-runtime",
          command: "definitely-missing-qmd"
        }
      }
    });

    await projectsModule.analyzeServerProject({
      projectId: project.id,
      maxFiles: 20
    });

    const learnedKnowledgePath = path.join(
      appRoot,
      ".project-home",
      "memory",
      "learned-knowledge",
      "latest.json"
    );
    await mkdir(path.dirname(learnedKnowledgePath), { recursive: true });
    await writeFile(
      learnedKnowledgePath,
      `${JSON.stringify(
        {
          version: 1,
          generatedAt: "2026-03-16T00:00:00.000Z",
          candidates: [
            {
              id: "module:loan-runtime",
              kind: "module-role",
              status: "candidate",
              label: "loan runtime",
              description: "",
              tags: ["loan"],
              aliases: ["loan runtime", "loan runtime 역할", "loan runtime 모듈"],
              apiPrefixes: [],
              screenPrefixes: [],
              controllerHints: ["LoanController"],
              serviceHints: ["LoanService"],
              pathHints: ["src"],
              searchTerms: ["loan runtime", "loan", "controller", "service"],
              evidence: ["src/LoanController.java"],
              score: 28,
              counts: {
                links: 1,
                screens: 0,
                backend: 1,
                eai: 0,
                uses: 0,
                successes: 0,
                failures: 0
              },
              firstSeenAt: "2026-03-16T00:00:00.000Z",
              lastSeenAt: "2026-03-16T00:00:00.000Z"
            }
          ],
          summary: {
            candidateCount: 1,
            validatedCount: 0,
            staleCount: 0,
            domainCount: 0,
            moduleRoleCount: 1,
            processCount: 0,
            channelCount: 0,
            strongestCandidates: ["module:loan-runtime"]
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const roleSearch = await projectsModule.searchServerProject({
      projectId: project.id,
      query: "loan runtime 모듈은 어떤 역할을 하는가?"
    });
    expect(roleSearch.diagnostics.questionType).toBe("module_role_explanation");
    expect(roleSearch.diagnostics.matchedLearnedKnowledgeIds).toContain("module:loan-runtime");

    const roleSearch2 = await projectsModule.searchServerProject({
      projectId: project.id,
      query: "loan runtime 프로젝트는 어떤 역할을 하는가?"
    });
    expect(roleSearch2.diagnostics.questionType).toBe("module_role_explanation");
    expect(roleSearch2.diagnostics.matchedLearnedKnowledgeIds).toContain("module:loan-runtime");

    const replayPath = path.join(
      appRoot,
      ".project-home",
      "memory",
      "evaluation-replay",
      "latest.json"
    );
    await writeFile(
      replayPath,
      `${JSON.stringify(
        {
          version: 1,
          generatedAt: "2026-03-16T00:00:03.000Z",
          summary: {
            totalArtifacts: 2,
            askCount: 0,
            searchCount: 2,
            failedAskCount: 0,
            staleBackedCount: 0,
            topQuestionTypes: [{ id: "module_role_explanation", count: 2 }],
            topFailureCodes: [],
            averageRetrievalCoverage: 62,
            averageQualityRisk: 18
          },
          replayCandidates: [
            {
              kind: "search",
              projectId: project.id,
              projectName: project.name,
              questionOrQuery: "loan runtime 프로젝트는 어떤 역할을 하는가?",
              questionType: "module_role_explanation",
              score: 64,
              reasons: ["manual-replay"],
              generatedAt: "2026-03-16T00:00:03.000Z"
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const replayExecution = await projectsModule.executeServerProjectReplay({
      projectId: project.id,
      limit: 1,
      kinds: ["search"]
    });
    expect(replayExecution.totalCandidates).toBeGreaterThanOrEqual(1);
    expect(replayExecution.executedCount).toBe(1);
    expect(replayExecution.results[0]?.kind).toBe("search");
    expect(replayExecution.results[0]?.provider).toBe("qmd");

    const promotionPath = path.join(
      appRoot,
      ".project-home",
      "memory",
      "evaluation-promotions",
      "latest.json"
    );
    const promotions = JSON.parse(await readFile(promotionPath, "utf8")) as {
      actions?: Array<{ candidateId?: string; targetStatus?: string }>;
      summary?: { totalActions?: number };
    };
    expect(Array.isArray(promotions.actions)).toBe(true);
    expect(Number(promotions.summary?.totalActions ?? 0)).toBeGreaterThanOrEqual(0);


    await projectsModule.recordServerProjectFeedback({
      projectId: project.id,
      kind: "search",
      prompt: "loan runtime 프로젝트는 어떤 역할을 하는가?",
      questionType: "module_role_explanation",
      verdict: "correct",
      scope: "node",
      matchedKnowledgeIds: ["module:loan-runtime"],
      matchedRetrievalUnitIds: ["unit:module:module:loan-runtime"],
      targets: [{ kind: "node", id: "module:loan-runtime", label: "loan runtime module" }],
      notes: "사용자 확인 정답"
    });

    const feedbackPath = path.join(
      appRoot,
      ".project-home",
      "memory",
      "user-feedback",
      "latest.json"
    );
    const feedback = JSON.parse(await readFile(feedbackPath, "utf8")) as {
      verdict?: string;
      matchedKnowledgeIds?: string[];
      scope?: string;
      targets?: Array<{ kind?: string; id?: string }>;
    };
    expect(feedback.verdict).toBe("correct");
    expect(feedback.scope).toBe("node");
    expect(feedback.matchedKnowledgeIds).toContain("module:loan-runtime");
    expect(feedback.targets?.[0]?.kind).toBe("node");
    expect(feedback.targets?.[0]?.id).toBe("module:loan-runtime");

    const updatedLearnedKnowledge = JSON.parse(await readFile(learnedKnowledgePath, "utf8")) as {
      candidates?: Array<{ id?: string; status?: string; counts?: { uses?: number; successes?: number } }>;
    };
    const updatedCandidate = (updatedLearnedKnowledge.candidates ?? []).find((candidate) => candidate.id === "module:loan-runtime");
    expect(updatedCandidate?.status).toBe("validated");
    expect(Number(updatedCandidate?.counts?.uses ?? 0)).toBeGreaterThanOrEqual(2);
    expect(Number(updatedCandidate?.counts?.successes ?? 0)).toBeGreaterThanOrEqual(2);

    const cachedAfterFeedback = await projectsModule.analyzeServerProject({
      projectId: project.id,
      maxFiles: 20
    });
    expect(cachedAfterFeedback.userFeedback?.totalFeedback).toBeGreaterThanOrEqual(1);
    expect(cachedAfterFeedback.userFeedback?.correctCount).toBeGreaterThanOrEqual(1);
    expect(cachedAfterFeedback.userFeedback?.targetedNodeCount).toBeGreaterThanOrEqual(1);
    expect(cachedAfterFeedback.evaluationPromotions?.promoteCount).toBeGreaterThanOrEqual(1);
    expect(cachedAfterFeedback.ontologyGraph?.feedbackNodeCount).toBeGreaterThanOrEqual(1);
    expect(cachedAfterFeedback.ontologyProjections?.lifecycleProjectionPathCount).toBeGreaterThanOrEqual(0);
  });
});
