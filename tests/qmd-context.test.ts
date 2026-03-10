import { describe, expect, it } from "vitest";
import { buildProjectQmdContextPayload } from "../src/retrieval/qmd-context.js";

describe("buildProjectQmdContextPayload", () => {
  it("builds global and module-scoped contexts from analysis output", () => {
    const payload = buildProjectQmdContextPayload({
      project: {
        name: "dcp-services",
        description: "backend monorepo",
      },
      projectPreset: {
        name: "dcp-services",
        summary: "gateway + domain services + EAI",
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
      domains: [
        {
          id: "retire-pension",
          name: "Retire Pension",
          score: 88,
          band: "strong",
        },
      ],
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
    expect(payload.globalContext).toContain("active-domains: retire-pension");
    expect(payload.globalContext).toContain("front-back-graph: 1 frontend workspaces, 42 links");

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
