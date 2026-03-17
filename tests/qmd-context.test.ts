import { describe, expect, it } from "vitest";
import { buildProjectQmdContextPayload } from "../src/retrieval/qmd-context.js";

describe("buildProjectQmdContextPayload", () => {
  it("builds global and module-scoped contexts from analysis output", () => {
    const payload = buildProjectQmdContextPayload({
      project: {
        name: "dcp-services",
        description: "backend monorepo",
      },
      summary: "퇴직연금과 보험 도메인이 공통 게이트웨이와 EAI를 통해 연결된다.",
      architecture: [
        "dcp-gateway routes /gw/api to domain services",
        "dcp-core provides shared EAI/header/runtime support",
      ],
      keyModules: [
        {
          name: "dcp-gateway",
          path: "dcp-gateway/src/main/java/com/example/RouteController.java",
          role: "gateway routing",
        },
        {
          name: "dcp-pension",
          path: "dcp-pension/src/main/java/com/example/IrpJoinService.java",
          role: "retire-pension business services",
        },
      ],
      ontologyGraph: {
        topChannels: [{ id: "monimo", count: 3 }],
        topDomains: [{ id: "retire-pension", count: 8 }],
      },
      ontologyProjections: {
        topProjectionTypes: ["front-back-flow", "integration"],
      },
      eaiCatalog: {
        interfaceCount: 12,
        topInterfaces: [
          {
            interfaceId: "F14090150",
            interfaceName: "가입자일괄조회",
            purpose: "retire pension member lookup",
          },
        ],
      },
      frontBackGraph: {
        workspaceCount: 1,
        linkCount: 42,
      },
      learnedKnowledge: {
        candidateCount: 3,
        validatedCount: 1,
        staleCount: 1,
        topCandidates: [
          {
            label: "irp-join",
            kind: "domain",
            status: "validated",
            score: 0.91,
          },
        ],
      },
    });

    expect(payload.globalContext).toContain("dcp-services");
    expect(payload.globalContext).toContain("ontology-concepts: retire-pension(8)");
    expect(payload.globalContext).toContain("ontology-channels: monimo(3)");
    expect(payload.globalContext).toContain("ontology-projections: front-back-flow, integration");
    expect(payload.globalContext).toContain("front-back-graph: 1 frontend workspaces, 42 links");
    expect(payload.globalContext).toContain("learned-knowledge: 3 candidates, 1 validated, 1 stale");

    expect(payload.contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pathPrefix: "/dcp-gateway",
          contextText: expect.stringContaining("gateway routing"),
        }),
        expect.objectContaining({
          pathPrefix: "/dcp-pension",
          contextText: expect.stringContaining("retire-pension business services"),
        }),
        expect.objectContaining({
          pathPrefix: "/",
          contextText: expect.stringContaining("F14090150 가입자일괄조회"),
        }),
      ])
    );
  });
});
