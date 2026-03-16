import { describe, expect, it } from "vitest";
import {
  applyLearnedKnowledgeObservation,
  computeLearnedKnowledgeSnapshot,
  extractLearnedKnowledgeTagsFromTexts,
  matchLearnedKnowledge,
  type LearnedKnowledgeFrontBackGraphLike,
  type LearnedKnowledgeStructureSnapshotLike
} from "../src/server/learned-knowledge.js";

describe("learned knowledge", () => {
  it("extracts reusable graph candidates from front-back links", () => {
    const frontBackGraph: LearnedKnowledgeFrontBackGraphLike = {
      frontend: {
        routes: [
          {
            routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021301C",
            screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021301C.vue",
            screenCode: "MDP-MYLOT021301C",
            notes: ["모바일햇살론 - 시간체크"]
          }
        ],
        screens: [
          {
            filePath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021301C.vue",
            screenCode: "MDP-MYLOT021301C",
            labels: ["모바일햇살론"],
            capabilityTags: ["sunshine-loan"],
            routePaths: ["/mo/mysamsunglife/loan/request/MDP-MYLOT021301C"],
            apiPaths: ["/loan/credit/low/worker/request/checktime"]
          }
        ]
      },
      links: [
        {
          frontend: {
            screenCode: "MDP-MYLOT021301C",
            screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021301C.vue",
            routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021301C"
          },
          api: {
            rawUrl: "/gw/api/loan/credit/low/worker/request/checktime",
            normalizedUrl: "/loan/credit/low/worker/request/checktime"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/loan/credit/low/worker/request/checktime",
            controllerMethod: "CreditLowWorkerLoanReauestController.checkTimeService",
            filePath: "dcp-loan/src/main/java/com/acme/CreditLowWorkerLoanReauestController.java",
            serviceHints: ["CreditLowWorkerLoanReauestService.validateAccessTime"]
          }
        },
        {
          frontend: {
            screenCode: "MDP-MYLOT021320M",
            screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021320M.vue",
            routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021320M"
          },
          api: {
            rawUrl: "/gw/api/loan/credit/low/worker/request/requestLoanMember",
            normalizedUrl: "/loan/credit/low/worker/request/requestLoanMember"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/loan/credit/low/worker/request/requestLoanMember",
            controllerMethod: "CreditLowWorkerLoanReauestController.registLoanMember",
            filePath: "dcp-loan/src/main/java/com/acme/CreditLowWorkerLoanReauestController.java",
            serviceHints: ["CreditLowWorkerLoanReauestService.registLoanMember"]
          }
        },
        {
          frontend: {
            screenCode: "MDP-MYLOT021370M",
            screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021370M.vue",
            routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021370M"
          },
          api: {
            rawUrl: "/gw/api/loan/credit/low/worker/request/make/owner/agreement",
            normalizedUrl: "/loan/credit/low/worker/request/make/owner/agreement"
          },
          gateway: {
            path: "/api/**",
            controllerMethod: "RouteController.route"
          },
          backend: {
            path: "/loan/credit/low/worker/request/make/owner/agreement",
            controllerMethod: "CreditLowWorkerLoanReauestController.makeOwnerAgreement",
            filePath: "dcp-loan/src/main/java/com/acme/CreditLowWorkerLoanReauestController.java",
            serviceHints: ["CreditLowWorkerLoanPdfReauestService.makeDocListBeforeApply"]
          }
        }
      ]
    };

    const snapshot = computeLearnedKnowledgeSnapshot({
      generatedAt: "2026-03-10T00:00:00.000Z",
      frontBackGraph
    });

    expect(snapshot.summary.candidateCount).toBeGreaterThan(0);
    expect(snapshot.candidates[0]?.id).toBe("graph:loan-credit-low-worker-request");
    expect(snapshot.candidates[0]?.status).toBe("validated");
    expect(snapshot.candidates[0]?.searchTerms).toEqual(
      expect.arrayContaining([
        "loan/credit/low/worker/request",
        "모바일햇살론",
        "CreditLowWorkerLoanReauestController"
      ])
    );
  });

  it("extracts module-role and process candidates from structure", () => {
    const structure: LearnedKnowledgeStructureSnapshotLike = {
      entries: {
        "a": {
          path: "dcp-core/src/main/java/com/acme/core/CoreSupport.java",
          packageName: "com.acme.core",
          classes: [{ name: "CoreSupport" }],
          methods: [{ name: "help" }],
          functions: [],
          calls: [],
          summary: "shared core module"
        },
        "b": {
          path: "dcp-batch/src/main/java/com/acme/batch/LoanBatchJob.java",
          packageName: "com.acme.batch",
          classes: [{ name: "LoanBatchJob" }, { name: "LoanScheduler" }],
          methods: [{ name: "runStep" }],
          functions: [],
          calls: [],
          summary: "batch job scheduler"
        },
        "c": {
          path: "dcp-batch/src/main/java/com/acme/batch/LoanBatchTasklet.java",
          packageName: "com.acme.batch",
          classes: [{ name: "LoanBatchTasklet" }],
          methods: [{ name: "execute" }],
          functions: [],
          calls: [],
          summary: "tasklet"
        },
        "d": {
          path: "dcp-batch/src/main/java/com/acme/batch/LoanBatchStep.java",
          packageName: "com.acme.batch",
          classes: [{ name: "LoanBatchStep" }],
          methods: [{ name: "processStep" }],
          functions: [],
          calls: [],
          summary: "step"
        },
        "e": {
          path: "dcp-batch/src/main/java/com/acme/batch/LoanBatchSupport.java",
          packageName: "com.acme.batch",
          classes: [{ name: "LoanBatchSupport" }],
          methods: [{ name: "prepare" }],
          functions: [],
          calls: [],
          summary: "batch support"
        },
        "f": {
          path: "dcp-batch/src/main/java/com/acme/batch/LoanBatchRunner.java",
          packageName: "com.acme.batch",
          classes: [{ name: "LoanBatchRunner" }],
          methods: [{ name: "runJob" }],
          functions: [],
          calls: [],
          summary: "job runner"
        }
      }
    };

    const snapshot = computeLearnedKnowledgeSnapshot({
      generatedAt: "2026-03-10T00:00:00.000Z",
      structure
    });

    expect(snapshot.candidates.some((candidate) => candidate.id === "module:dcp-core")).toBe(false);
    expect(snapshot.candidates.some((candidate) => candidate.id === "process:dcp-batch")).toBe(true);
  });

  it("matches questions and reinforces validated candidates over time", () => {
    const snapshot = computeLearnedKnowledgeSnapshot({
      generatedAt: "2026-03-10T00:00:00.000Z",
      frontBackGraph: {
        frontend: {
          routes: [
            {
              routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021301C",
              screenPath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021301C.vue",
              screenCode: "MDP-MYLOT021301C",
              notes: ["모바일햇살론"]
            }
          ],
          screens: [
            {
              filePath: "src/views/mo/mysamsunglife/loan/request/MDP-MYLOT021301C.vue",
              screenCode: "MDP-MYLOT021301C",
              labels: ["모바일햇살론"],
              capabilityTags: ["sunshine-loan"],
              routePaths: ["/mo/mysamsunglife/loan/request/MDP-MYLOT021301C"],
              apiPaths: ["/loan/credit/low/worker/request/checktime"]
            }
          ]
        },
        links: [
          {
            frontend: { screenCode: "MDP-MYLOT021301C", screenPath: "", routePath: "" },
            api: {
              rawUrl: "/gw/api/loan/credit/low/worker/request/checktime",
              normalizedUrl: "/loan/credit/low/worker/request/checktime"
            },
            gateway: { controllerMethod: "RouteController.route" },
            backend: {
              path: "/loan/credit/low/worker/request/checktime",
              controllerMethod: "CreditLowWorkerLoanReauestController.checkTimeService",
              filePath: "dcp-loan/src/main/java/com/acme/CreditLowWorkerLoanReauestController.java",
              serviceHints: ["CreditLowWorkerLoanReauestService.validateAccessTime"]
            }
          },
          {
            frontend: { screenCode: "MDP-MYLOT021320M", screenPath: "", routePath: "" },
            api: {
              rawUrl: "/gw/api/loan/credit/low/worker/request/apply",
              normalizedUrl: "/loan/credit/low/worker/request/apply"
            },
            gateway: { controllerMethod: "RouteController.route" },
            backend: {
              path: "/loan/credit/low/worker/request/apply",
              controllerMethod: "CreditLowWorkerLoanReauestController.apply",
              filePath: "dcp-loan/src/main/java/com/acme/CreditLowWorkerLoanReauestController.java",
              serviceHints: ["CreditLowWorkerLoanReauestService.apply"]
            }
          },
          {
            frontend: { screenCode: "MDP-MYLOT021370M", screenPath: "", routePath: "" },
            api: {
              rawUrl: "/gw/api/loan/credit/low/worker/request/make/owner/agreement",
              normalizedUrl: "/loan/credit/low/worker/request/make/owner/agreement"
            },
            gateway: { controllerMethod: "RouteController.route" },
            backend: {
              path: "/loan/credit/low/worker/request/make/owner/agreement",
              controllerMethod: "CreditLowWorkerLoanReauestController.makeOwnerAgreement",
              filePath: "dcp-loan/src/main/java/com/acme/CreditLowWorkerLoanReauestController.java",
              serviceHints: ["CreditLowWorkerLoanPdfReauestService.makeDocListBeforeApply"]
            }
          }
        ]
      }
    });

    const matches = matchLearnedKnowledge("햇살론 대출이 어떻게 흘러가는지 분석해줘", snapshot);
    expect(matches[0]?.id).toBe("graph:loan-credit-low-worker-request");

    const next = applyLearnedKnowledgeObservation({
      snapshot,
      matchedCandidateIds: [matches[0]!.id],
      successful: true,
      question: "햇살론 대출 프론트부터 백엔드 흐름"
    });

    const updated = next.candidates.find((candidate) => candidate.id === matches[0]!.id);
    expect(updated?.counts.uses).toBe(1);
    expect(updated?.counts.successes).toBe(1);
    expect(extractLearnedKnowledgeTagsFromTexts(["/loan/credit/low/worker/request/apply"], next)).toContain(
      "graph:loan-credit-low-worker-request"
    );
  });

  it("demotes repeatedly failing candidates to stale and excludes them from extracted tags", () => {
    const snapshot = {
      version: 1 as const,
      generatedAt: "2026-03-10T00:00:00.000Z",
      candidates: [
        {
          id: "channel:monimo",
          kind: "channel" as const,
          status: "candidate" as const,
          label: "monimo channel",
          description: "monimo login/auth integration",
          tags: ["channel:monimo", "member-auth"],
          aliases: ["모니모", "monimo"],
          apiPrefixes: ["/member/monimo/registe"],
          screenPrefixes: ["MDP-MYCER9999"],
          controllerHints: ["RegisteUseDcpChnelController"],
          serviceHints: ["EmbededMemberLoginService"],
          pathHints: ["dcp-member", "monimo"],
          searchTerms: ["모니모", "monimo", "/member/monimo/registe"],
          evidence: ["MDP-MYCER999999M -> /gw/api/member/monimo/registe"],
          score: 52,
          counts: {
            links: 1,
            screens: 1,
            backend: 1,
            eai: 0,
            uses: 0,
            successes: 0,
            failures: 0
          },
          firstSeenAt: "2026-03-10T00:00:00.000Z",
          lastSeenAt: "2026-03-10T00:00:00.000Z"
        }
      ],
      summary: {
        candidateCount: 1,
        validatedCount: 0,
        staleCount: 0,
        domainCount: 0,
        moduleRoleCount: 0,
        processCount: 0,
        channelCount: 1,
        strongestCandidates: ["channel:monimo"]
      }
    };

    let next = snapshot;
    for (let index = 0; index < 3; index += 1) {
      next = applyLearnedKnowledgeObservation({
        snapshot: next,
        matchedCandidateIds: ["channel:monimo"],
        successful: false,
        question: "모니모 회원인증 연동"
      });
    }

    const updated = next.candidates.find((candidate) => candidate.id === "channel:monimo");
    expect(updated?.status).toBe("stale");
    expect(next.summary.staleCount).toBeGreaterThanOrEqual(1);
    expect(extractLearnedKnowledgeTagsFromTexts(["/member/monimo/registe"], next)).not.toContain("channel:monimo");
  });
});
