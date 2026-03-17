import { describe, expect, it } from "vitest";
import {
  findStructureEntryByClassName,
  scoreAskHitRelevance,
  type ProjectSearchHit
} from "../src/server/projects.js";

describe("server evidence ranking", () => {
  it("prefers ontology-aligned ask hits during hydration ranking", () => {
    const rerankContext = {
      preferredPathPrefixes: ["dcp-insurance/"],
      preferredPathTokens: ["insurance", "benefit", "claim"],
      preferredTextTokens: ["benefit claim"]
    };

    const alignedHit = {
      path: "dcp-insurance/src/main/java/com/acme/BenefitClaimService.java",
      score: 7.2,
      source: "qmd",
      title: "BenefitClaimService",
      snippet: "saveBenefitClaim applies benefit claim validation"
    } satisfies ProjectSearchHit;
    const unrelatedHit = {
      path: "dcp-loan/src/main/java/com/acme/LoanRequestService.java",
      score: 8.4,
      source: "qmd",
      title: "LoanRequestService",
      snippet: "loan request validation flow"
    } satisfies ProjectSearchHit;

    const alignedScore = scoreAskHitRelevance({
      hit: alignedHit,
      question: "보험금 청구 로직이 프론트부터 백엔드까지 어떻게 돌아가는지 설명해줘.",
      strategy: "cross_layer_flow",
      moduleCandidates: [],
      focusTokens: ["insurance", "benefit", "claim"],
      rerankContext
    });
    const unrelatedScore = scoreAskHitRelevance({
      hit: unrelatedHit,
      question: "보험금 청구 로직이 프론트부터 백엔드까지 어떻게 돌아가는지 설명해줘.",
      strategy: "cross_layer_flow",
      moduleCandidates: [],
      focusTokens: ["insurance", "benefit", "claim"],
      rerankContext
    });

    expect(alignedScore).toBeGreaterThan(unrelatedScore);
  });

  it("chooses ontology-aligned structure entries when duplicate class names exist", () => {
    const selected = findStructureEntryByClassName({
      structure: {
        version: 1,
        generatedAt: "2026-03-18T00:00:00.000Z",
        workspaceDir: "/tmp/demo",
        stats: {
          fileCount: 2,
          packageCount: 2,
          classCount: 2,
          methodCount: 0,
          changedFiles: 2,
          reusedFiles: 0
        },
        topPackages: [],
        topMethods: [],
        entries: {
          "dcp-loan/src/main/java/com/acme/SessionService.java": {
            path: "dcp-loan/src/main/java/com/acme/SessionService.java",
            size: 1,
            mtimeMs: 1,
            hash: "loan",
            classes: [{ name: "SessionService", line: 1 }],
            methods: [],
            functions: [],
            calls: [],
            summary: "loan session service"
          },
          "dcp-insurance/src/main/java/com/acme/SessionService.java": {
            path: "dcp-insurance/src/main/java/com/acme/SessionService.java",
            size: 1,
            mtimeMs: 1,
            hash: "insurance",
            classes: [{ name: "SessionService", line: 1 }],
            methods: [],
            functions: [],
            calls: [],
            summary: "insurance session service"
          }
        }
      },
      className: "SessionService",
      moduleCandidates: [],
      rerankContext: {
        preferredPathPrefixes: ["dcp-insurance/"],
        preferredPathTokens: ["insurance", "benefit", "claim"],
        preferredTextTokens: ["benefit claim"]
      }
    });

    expect(selected?.path).toBe("dcp-insurance/src/main/java/com/acme/SessionService.java");
  });
});
