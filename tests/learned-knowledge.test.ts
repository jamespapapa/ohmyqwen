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

  it("extracts generic channel candidates from repeated frontend and api path namespaces", () => {
    const snapshot = computeLearnedKnowledgeSnapshot({
      generatedAt: "2026-03-10T00:00:00.000Z",
      frontBackGraph: {
        frontend: {
          routes: [
            {
              routePath: "/mo/login/xpay/MDP-MYABC000001M",
              screenPath: "src/views/login/MDP-MYABC000001M.vue",
              screenCode: "MDP-MYABC000001M",
              notes: ["xpay bridge login"]
            },
            {
              routePath: "/mo/login/xpay/MDP-MYABC000002M",
              screenPath: "src/views/login/MDP-MYABC000002M.vue",
              screenCode: "MDP-MYABC000002M",
              notes: ["xpay register"]
            }
          ],
          screens: []
        },
        links: [
          {
            frontend: {
              screenCode: "MDP-MYABC000001M",
              screenPath: "src/views/login/MDP-MYABC000001M.vue",
              routePath: "/mo/login/xpay/MDP-MYABC000001M"
            },
            api: {
              rawUrl: "/gw/api/member/xpay/registe",
              normalizedUrl: "/member/xpay/registe"
            },
            gateway: {
              path: "/api/**",
              controllerMethod: "RouteController.route"
            },
            backend: {
              path: "/member/xpay/registe",
              controllerMethod: "XpayMemberController.registe",
              filePath: "dcp-member/src/main/java/com/acme/member/XpayMemberController.java",
              serviceHints: ["XpayMemberService.registe"]
            }
          },
          {
            frontend: {
              screenCode: "MDP-MYABC000002M",
              screenPath: "src/views/login/MDP-MYABC000002M.vue",
              routePath: "/mo/login/xpay/MDP-MYABC000002M"
            },
            api: {
              rawUrl: "/gw/api/member/xpay/callback",
              normalizedUrl: "/member/xpay/callback"
            },
            gateway: {
              path: "/api/**",
              controllerMethod: "RouteController.route"
            },
            backend: {
              path: "/member/xpay/callback",
              controllerMethod: "XpayCallbackController.callback",
              filePath: "dcp-member/src/main/java/com/acme/member/XpayCallbackController.java",
              serviceHints: ["XpayCallbackService.callback"]
            }
          }
        ]
      }
    });

    const candidate = snapshot.candidates.find((item) => item.id === "channel:xpay");
    expect(candidate).toBeTruthy();
    expect(candidate?.kind).toBe("channel");
    expect(candidate?.searchTerms).toEqual(expect.arrayContaining(["xpay", "/member/xpay/registe", "/member/xpay/callback"]));
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

  it("prefers ontology-aligned learned knowledge over unrelated high-score candidates", () => {
    const snapshot = {
      version: 1 as const,
      generatedAt: "2026-03-10T00:00:00.000Z",
      candidates: [
        {
          id: "channel:monimo",
          kind: "channel" as const,
          status: "validated" as const,
          label: "monimo channel",
          description: "monimo member registration and bridge",
          tags: ["channel:monimo", "member", "register"],
          aliases: ["모니모", "monimo"],
          apiPrefixes: ["/member/monimo/registe"],
          screenPrefixes: ["MDP-MYCER9999"],
          controllerHints: ["RegisteUseDcpChnelController"],
          serviceHints: ["EmbededMemberLoginService"],
          pathHints: ["dcp-member", "monimo"],
          searchTerms: ["모니모", "monimo", "/member/monimo/registe"],
          evidence: ["MDP-MYCER999999M -> /gw/api/member/monimo/registe"],
          score: 88,
          counts: { links: 1, screens: 1, backend: 1, eai: 0, uses: 0, successes: 0, failures: 0 },
          firstSeenAt: "2026-03-10T00:00:00.000Z",
          lastSeenAt: "2026-03-10T00:00:00.000Z"
        },
        {
          id: "graph:insurance-benefit-claim",
          kind: "domain" as const,
          status: "validated" as const,
          label: "insurance benefit claim",
          description: "insurance benefit claim insert/inquiry/document flow",
          tags: ["insurance", "benefit", "claim", "action-write", "action-read", "action-document"],
          aliases: ["보험금 청구", "benefit claim"],
          apiPrefixes: ["/insurance/benefit/claim/insert", "/insurance/benefit/claim/inquiry"],
          screenPrefixes: ["MDP-MYINT0202"],
          controllerHints: ["BenefitClaimController"],
          serviceHints: ["BenefitClaimService"],
          pathHints: ["dcp-insurance", "benefit/claim"],
          searchTerms: ["보험금", "청구", "benefit", "claim"],
          evidence: ["MDP-MYINT020210M -> /gw/api/insurance/benefit/claim/insert"],
          score: 72,
          counts: { links: 3, screens: 2, backend: 2, eai: 1, uses: 0, successes: 0, failures: 0 },
          firstSeenAt: "2026-03-10T00:00:00.000Z",
          lastSeenAt: "2026-03-10T00:00:00.000Z"
        }
      ],
      summary: {
        candidateCount: 2,
        validatedCount: 2,
        staleCount: 0,
        domainCount: 1,
        moduleRoleCount: 0,
        processCount: 0,
        channelCount: 1,
        strongestCandidates: ["channel:monimo", "graph:insurance-benefit-claim"]
      }
    };

    const matches = matchLearnedKnowledge(
      "보험금 청구 로직이 프론트부터 백엔드까지 어떻게 돌아가는지 면밀히 분석해줘.",
      snapshot,
      6,
      ["보험금", "청구", "benefit", "claim", "action-read", "action-write", "action-document"]
    );

    expect(matches[0]?.id).toBe("graph:insurance-benefit-claim");
    expect(matches.some((item) => item.id === "channel:monimo" && item.score >= matches[0]!.score)).toBe(false);
  });
});
