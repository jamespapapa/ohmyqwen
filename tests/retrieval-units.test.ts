import { describe, expect, it } from "vitest";
import { buildRetrievalUnitMarkdown, buildRetrievalUnitSnapshot } from "../src/server/retrieval-units.js";
import type { KnowledgeSchemaSnapshot } from "../src/server/knowledge-schema.js";

const snapshot: KnowledgeSchemaSnapshot = {
  version: 1,
  generatedAt: "2026-03-16T00:00:00.000Z",
  workspaceDir: "/workspace/dcp-services",
  entities: [
    {
      id: "module:dcp-member",
      type: "module",
      label: "dcp-member",
      summary: "member module",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["dcp-member"],
        sourceType: "structure-index",
        validatedStatus: "derived"
      },
      attributes: { moduleName: "dcp-member" }
    },
    {
      id: "file:frontend:src/views/login/MDP-MYCER999999M.vue",
      type: "file",
      label: "MDP-MYCER999999M",
      summary: "frontend screen",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.7,
        evidencePaths: ["src/views/login/MDP-MYCER999999M.vue"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { path: "src/views/login/MDP-MYCER999999M.vue", screenCode: "MDP-MYCER999999M" }
    },
    {
      id: "route:/mo/login/monimo/MDP-MYCER999999M:src/views/login/MDP-MYCER999999M.vue",
      type: "route",
      label: "MDP-MYCER999999M",
      summary: "monimo route",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["src/router/mo/login/route.js"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { routePath: "/mo/login/monimo/MDP-MYCER999999M" }
    },
    {
      id: "api:/member/monimo/registe",
      type: "api",
      label: "/gw/api/member/monimo/registe",
      summary: "monimo api",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.9,
        evidencePaths: ["src/views/login/MDP-MYCER999999M.vue"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { normalizedUrl: "/member/monimo/registe", rawUrl: "/gw/api/member/monimo/registe" }
    },
    {
      id: "controller:RegisteUseDcpChnelController.registe",
      type: "controller",
      label: "RegisteUseDcpChnelController.registe",
      summary: "backend controller",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.9,
        evidencePaths: ["dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { path: "/member/monimo/registe", controllerClass: "RegisteUseDcpChnelController", controllerMethod: "RegisteUseDcpChnelController.registe" }
    },
    {
      id: "service:EmbededMemberLoginService.authenticate",
      type: "service",
      label: "EmbededMemberLoginService.authenticate",
      summary: "login service",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.88,
        evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { path: "dcp-member/src/main/java/com/example/EmbededMemberLoginService.java", serviceClass: "EmbededMemberLoginService", serviceMethod: "authenticate" }
    },
    {
      id: "eai:F14090150",
      type: "eai-interface",
      label: "F14090150 가입자일괄조회",
      summary: "member lookup",
      metadata: {
        domains: [],
        subdomains: [],
        channels: [],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.95,
        evidencePaths: ["dcp-member/src/main/resources/eai/io/F14090150.xml"],
        sourceType: "eai-dictionary",
        validatedStatus: "validated"
      },
      attributes: { interfaceId: "F14090150" }
    },
    {
      id: "knowledge:pack:member-auth",
      type: "knowledge-cluster",
      label: "Member Auth",
      summary: "member auth domain pack",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: [],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.96,
        evidencePaths: [],
        sourceType: "domain-pack",
        validatedStatus: "validated"
      },
      attributes: { packId: "member-auth" }
    },
    {
      id: "knowledge:candidate:channel:monimo",
      type: "knowledge-cluster",
      label: "monimo channel",
      summary: "monimo channel candidate",
      metadata: {
        domains: [],
        subdomains: [],
        channels: ["monimo"],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.82,
        evidencePaths: ["MDP-MYCER999999M -> /gw/api/member/monimo/registe"],
        sourceType: "learned-knowledge",
        validatedStatus: "validated"
      },
      attributes: { candidateId: "channel:monimo" }
    }
  ],
  edges: [
    {
      id: "edge:contains:module:dcp-member:file:frontend:src/views/login/MDP-MYCER999999M.vue",
      type: "contains",
      fromId: "module:dcp-member",
      toId: "file:frontend:src/views/login/MDP-MYCER999999M.vue",
      label: "module contains file",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["monimo"],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["dcp-member"],
        sourceType: "structure-index",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:declares:file:frontend:src/views/login/MDP-MYCER999999M.vue:route",
      type: "declares",
      fromId: "file:frontend:src/views/login/MDP-MYCER999999M.vue",
      toId: "route:/mo/login/monimo/MDP-MYCER999999M:src/views/login/MDP-MYCER999999M.vue",
      label: "screen declares route",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.84,
        evidencePaths: ["src/router/mo/login/route.js"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:routes-to:route:api",
      type: "routes-to",
      fromId: "route:/mo/login/monimo/MDP-MYCER999999M:src/views/login/MDP-MYCER999999M.vue",
      toId: "api:/member/monimo/registe",
      label: "route issues api",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.9,
        evidencePaths: ["src/views/login/MDP-MYCER999999M.vue"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:routes-to:api:controller",
      type: "routes-to",
      fromId: "api:/member/monimo/registe",
      toId: "controller:RegisteUseDcpChnelController.registe",
      label: "api routed to controller",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.9,
        evidencePaths: ["dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:calls:controller:service",
      type: "calls",
      fromId: "controller:RegisteUseDcpChnelController.registe",
      toId: "service:EmbededMemberLoginService.authenticate",
      label: "controller calls service",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.88,
        evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:uses-eai:service:eai",
      type: "uses-eai",
      fromId: "service:EmbededMemberLoginService.authenticate",
      toId: "eai:F14090150",
      label: "service uses eai",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.92,
        evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
        sourceType: "eai-dictionary",
        validatedStatus: "validated"
      },
      attributes: {}
    },
    {
      id: "edge:belongs-to-domain:service:pack",
      type: "belongs-to-domain",
      fromId: "service:EmbededMemberLoginService.authenticate",
      toId: "knowledge:pack:member-auth",
      label: "service belongs to domain",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-check"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.88,
        evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:belongs-to-channel:route:cluster",
      type: "belongs-to-channel",
      fromId: "route:/mo/login/monimo/MDP-MYCER999999M:src/views/login/MDP-MYCER999999M.vue",
      toId: "knowledge:candidate:channel:monimo",
      label: "route linked to monimo",
      metadata: {
        domains: [],
        subdomains: [],
        channels: ["monimo"],
        actions: [],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.82,
        evidencePaths: ["MDP-MYCER999999M -> /gw/api/member/monimo/registe"],
        sourceType: "learned-knowledge",
        validatedStatus: "validated"
      },
      attributes: {}
    }
  ],
  summary: {
    entityCount: 9,
    edgeCount: 8,
    entityTypeCounts: {
      api: 1,
      controller: 1,
      "eai-interface": 1,
      file: 1,
      "knowledge-cluster": 2,
      module: 1,
      route: 1,
      service: 1
    },
    edgeTypeCounts: {
      "belongs-to-channel": 1,
      "belongs-to-domain": 1,
      calls: 1,
      contains: 1,
      declares: 1,
      "routes-to": 2,
      "uses-eai": 1
    },
    validatedClusterCount: 2,
    candidateClusterCount: 0,
    activeDomainCount: 1,
    topDomains: [{ id: "member-auth", count: 7 }],
    topModules: [{ id: "dcp-member", count: 1 }]
  }
};

describe("retrieval unit standardization", () => {
  it("builds module, flow, knowledge-cluster, symbol, and eai retrieval units from knowledge schema", () => {
    const units = buildRetrievalUnitSnapshot({ knowledgeSchema: snapshot });

    expect(units.summary.unitCount).toBeGreaterThan(0);
    expect(units.summary.unitTypeCounts["flow"]).toBeGreaterThanOrEqual(1);
    expect(units.summary.unitTypeCounts["eai-link"]).toBeGreaterThanOrEqual(1);
    expect(units.summary.unitTypeCounts["knowledge-cluster"]).toBeGreaterThanOrEqual(1);
    expect(units.summary.topDomains[0]?.id).toBe("member-auth");
    expect(units.summary.topChannels[0]?.id).toBe("monimo");

    const flowUnit = units.units.find((unit) => unit.type === "flow");
    expect(flowUnit?.title).toContain("MDP-MYCER999999M");
    expect(flowUnit?.searchText).toContain("/member/monimo/registe");

    const eaiUnit = units.units.find((unit) => unit.type === "eai-link");
    expect(eaiUnit?.title).toContain("F14090150");

    const knowledgeUnit = units.units.find((unit) => unit.id === "unit:knowledge:knowledge:candidate:channel:monimo");
    expect(knowledgeUnit?.channels).toContain("monimo");
  });

  it("renders a markdown summary of retrieval units", () => {
    const units = buildRetrievalUnitSnapshot({ knowledgeSchema: snapshot });
    const markdown = buildRetrievalUnitMarkdown(units);
    expect(markdown).toContain("# Retrieval Units");
    expect(markdown).toContain("## Unit Types");
    expect(markdown).toContain("## Representative Units");
  });
});
