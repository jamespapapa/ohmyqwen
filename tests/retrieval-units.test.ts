import { describe, expect, it } from "vitest";
import {
  buildRetrievalUnitSupportCandidates,
  buildRetrievalUnitMarkdown,
  buildRetrievalUnitSnapshot,
  rankRetrievalUnitsForQuestion,
  RetrievalUnitSnapshotSchema
} from "../src/server/retrieval-units.js";
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
      id: "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth",
      type: "ui-action",
      label: "requestMonimoAuth",
      summary: "requestMonimoAuth UI action in MDP-MYCER999999M",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth", "action-register"],
        moduleRoles: ["ui-submit"],
        processRoles: [],
        confidence: 0.82,
        evidencePaths: ["src/views/login/MDP-MYCER999999M.vue"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {
        functionName: "requestMonimoAuth",
        screenPath: "src/views/login/MDP-MYCER999999M.vue"
      }
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
      id: "gateway-handler:RouteController.route",
      type: "gateway-handler",
      label: "RouteController.route",
      summary: "/api/** gateway handler",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth", "action-register"],
        moduleRoles: ["gateway-routing"],
        processRoles: [],
        confidence: 0.86,
        evidencePaths: ["dcp-gateway/src/main/java/com/example/RouteController.java"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: { path: "/api/**", controllerMethod: "RouteController.route" }
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
      id: "symbol:method:EmbededMemberLoginService.authenticate:dcp-member/src/main/java/com/example/EmbededMemberLoginService.java",
      type: "symbol",
      label: "EmbededMemberLoginService.authenticate",
      summary: "authenticate method symbol",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth", "action-status-read"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.78,
        evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
        sourceType: "structure-index",
        validatedStatus: "derived"
      },
      attributes: { path: "dcp-member/src/main/java/com/example/EmbededMemberLoginService.java", className: "EmbededMemberLoginService", methodName: "authenticate" }
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
      id: "store:redis",
      type: "data-store",
      label: "Redis Store",
      summary: "Redis-backed state/session/cache store",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["cache-session"],
        actions: ["action-state-store", "action-read", "action-write"],
        moduleRoles: ["state-store"],
        processRoles: [],
        confidence: 0.9,
        evidencePaths: ["dcp-member/src/main/java/com/example/RedisSessionSupport.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { storeKind: "redis" }
    },
    {
      id: "store:database",
      type: "data-store",
      label: "Database Store",
      summary: "Database-backed persistence store",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: [],
        actions: ["action-read", "action-write"],
        moduleRoles: ["data-persistence"],
        processRoles: [],
        confidence: 0.88,
        evidencePaths: ["dcp-member/src/main/java/com/example/MemberSessionRepository.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { storeKind: "database" }
    },
    {
      id: "async-channel:monimo.auth.callback",
      type: "async-channel",
      label: "monimo.auth.callback",
      summary: "Async/message boundary monimo.auth.callback",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-callback"],
        moduleRoles: ["async-support"],
        processRoles: ["async-process"],
        confidence: 0.8,
        evidencePaths: ["dcp-async/src/main/java/com/example/MonimoAsyncController.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { channel: "monimo.auth.callback" }
    },
    {
      id: "data-model:membersessionentity",
      type: "data-model",
      label: "MemberSessionEntity",
      summary: "MemberSessionEntity maps to table TB_MEMBER_SESSION",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: [],
        actions: ["action-read", "action-write"],
        moduleRoles: ["data-model"],
        processRoles: [],
        confidence: 0.84,
        evidencePaths: ["dcp-member/src/main/java/com/example/MemberSessionEntity.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { modelName: "MemberSessionEntity", tableName: "TB_MEMBER_SESSION" }
    },
    {
      id: "data-contract:monimoauthrequest",
      type: "data-contract",
      label: "MonimoAuthRequest",
      summary: "MonimoAuthRequest request/input contract",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth", "action-register"],
        moduleRoles: ["data-contract"],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { contractName: "MonimoAuthRequest", direction: "request" }
    },
    {
      id: "decision-path:authenticate:switch-auth-status:service",
      type: "decision-path",
      label: "authenticate :: switch auth status",
      summary: "switch auth status decision/branch path",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth", "action-status-read"],
        moduleRoles: ["decision-control"],
        processRoles: [],
        confidence: 0.76,
        evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { decisionLabel: "switch auth status", ownerName: "authenticate" }
    },
    {
      id: "data-table:tb_member_session",
      type: "data-table",
      label: "TB_MEMBER_SESSION",
      summary: "Database table TB_MEMBER_SESSION",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: [],
        actions: ["action-read", "action-write"],
        moduleRoles: ["data-persistence"],
        processRoles: [],
        confidence: 0.84,
        evidencePaths: ["dcp-member/src/main/java/com/example/MemberSessionRepository.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { tableName: "TB_MEMBER_SESSION" }
    },
    {
      id: "cache-key:member.login.status",
      type: "cache-key",
      label: "member.login.status",
      summary: "Redis/cache key hint member.login.status",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["cache-session"],
        actions: ["action-state-store", "action-read"],
        moduleRoles: ["state-store"],
        processRoles: [],
        confidence: 0.82,
        evidencePaths: ["dcp-member/src/main/java/com/example/RedisSessionSupport.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { key: "member.login.status" }
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
      id: "edge:declares:file:frontend:src/views/login/MDP-MYCER999999M.vue:ui-action",
      type: "declares",
      fromId: "file:frontend:src/views/login/MDP-MYCER999999M.vue",
      toId: "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth",
      label: "screen declares ui action",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth", "action-register"],
        moduleRoles: ["ui-submit"],
        processRoles: [],
        confidence: 0.84,
        evidencePaths: ["src/views/login/MDP-MYCER999999M.vue"],
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
      id: "edge:calls:ui-action:api",
      type: "calls",
      fromId: "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth",
      toId: "api:/member/monimo/registe",
      label: "ui action calls api",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth", "action-register"],
        moduleRoles: ["ui-submit"],
        processRoles: [],
        confidence: 0.9,
        evidencePaths: ["src/views/login/MDP-MYCER999999M.vue"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:routes-to:api:gateway",
      type: "routes-to",
      fromId: "api:/member/monimo/registe",
      toId: "gateway-handler:RouteController.route",
      label: "api routed through gateway",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth", "action-register"],
        moduleRoles: ["gateway-routing"],
        processRoles: [],
        confidence: 0.88,
        evidencePaths: ["dcp-gateway/src/main/java/com/example/RouteController.java"],
        sourceType: "front-back-graph",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:routes-to:api:controller",
      type: "proxies-to",
      fromId: "gateway-handler:RouteController.route",
      toId: "controller:RegisteUseDcpChnelController.registe",
      label: "gateway proxies to controller",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth", "action-register"],
        moduleRoles: ["gateway-routing"],
        processRoles: [],
        confidence: 0.9,
        evidencePaths: [
          "dcp-gateway/src/main/java/com/example/RouteController.java",
          "dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java"
        ],
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
      id: "edge:transitions-to:controller:service",
      type: "transitions-to",
      fromId: "controller:RegisteUseDcpChnelController.registe",
      toId: "service:EmbededMemberLoginService.authenticate",
      label: "register -> auth",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-register", "action-auth"],
        moduleRoles: [],
        processRoles: ["state-transition"],
        confidence: 0.82,
        evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: { fromPhase: "action-register", toPhase: "action-auth" }
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
      id: "edge:uses-store:service:redis",
      type: "uses-store",
      fromId: "service:EmbededMemberLoginService.authenticate",
      toId: "store:redis",
      label: "service accesses redis store",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["cache-session"],
        actions: ["action-state-store", "action-read"],
        moduleRoles: ["state-store"],
        processRoles: [],
        confidence: 0.82,
        evidencePaths: ["dcp-member/src/main/java/com/example/RedisSessionSupport.java"],
        sourceType: "structure-index",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:consumes-from:service:async",
      type: "consumes-from",
      fromId: "service:EmbededMemberLoginService.authenticate",
      toId: "async-channel:monimo.auth.callback",
      label: "service consumes from async channel",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-callback"],
        moduleRoles: ["async-support"],
        processRoles: ["async-process"],
        confidence: 0.79,
        evidencePaths: ["dcp-async/src/main/java/com/example/MonimoAsyncController.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:uses-cache-key:service:key",
      type: "uses-cache-key",
      fromId: "service:EmbededMemberLoginService.authenticate",
      toId: "cache-key:member.login.status",
      label: "service uses cache key",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: ["cache-session"],
        actions: ["action-state-store", "action-read"],
        moduleRoles: ["state-store"],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["dcp-member/src/main/java/com/example/RedisSessionSupport.java"],
        sourceType: "structure-index",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:stores-model:service:model",
      type: "stores-model",
      fromId: "service:EmbededMemberLoginService.authenticate",
      toId: "data-model:membersessionentity",
      label: "service uses database model",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: [],
        actions: ["action-read", "action-write"],
        moduleRoles: ["data-persistence"],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["dcp-member/src/main/java/com/example/MemberSessionEntity.java"],
        sourceType: "structure-index",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:accepts-contract:controller:request",
      type: "accepts-contract",
      fromId: "controller:RegisteUseDcpChnelController.registe",
      toId: "data-contract:monimoauthrequest",
      label: "controller accepts request contract",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth", "action-register"],
        moduleRoles: ["data-contract"],
        processRoles: [],
        confidence: 0.78,
        evidencePaths: ["dcp-member/src/main/java/com/example/RegisteUseDcpChnelController.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:branches-to:service:decision",
      type: "branches-to",
      fromId: "service:EmbededMemberLoginService.authenticate",
      toId: "decision-path:authenticate:switch-auth-status:service",
      label: "service branches through decision path",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth", "action-status-read"],
        moduleRoles: ["decision-control"],
        processRoles: [],
        confidence: 0.77,
        evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:maps-to:service:symbol",
      type: "maps-to",
      fromId: "service:EmbededMemberLoginService.authenticate",
      toId: "symbol:method:EmbededMemberLoginService.authenticate:dcp-member/src/main/java/com/example/EmbededMemberLoginService.java",
      label: "service maps to method symbol",
      metadata: {
        domains: ["member-auth"],
        subdomains: ["embedded-login"],
        channels: ["monimo"],
        actions: ["action-auth"],
        moduleRoles: [],
        processRoles: [],
        confidence: 0.77,
        evidencePaths: ["dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:maps-to-table:model:table",
      type: "maps-to-table",
      fromId: "data-model:membersessionentity",
      toId: "data-table:tb_member_session",
      label: "model maps to table",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: [],
        actions: ["action-read", "action-write"],
        moduleRoles: ["data-model", "data-persistence"],
        processRoles: [],
        confidence: 0.85,
        evidencePaths: ["dcp-member/src/main/java/com/example/MemberSessionEntity.java"],
        sourceType: "derived",
        validatedStatus: "derived"
      },
      attributes: {}
    },
    {
      id: "edge:queries-table:service:table",
      type: "queries-table",
      fromId: "service:EmbededMemberLoginService.authenticate",
      toId: "data-table:tb_member_session",
      label: "service queries table",
      metadata: {
        domains: ["member-auth"],
        subdomains: [],
        channels: [],
        actions: ["action-read"],
        moduleRoles: ["data-persistence"],
        processRoles: [],
        confidence: 0.8,
        evidencePaths: ["dcp-member/src/main/java/com/example/MemberSessionRepository.java"],
        sourceType: "structure-index",
        validatedStatus: "derived"
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
    entityCount: 16,
    edgeCount: 15,
    entityTypeCounts: {
      api: 1,
      "cache-key": 1,
      controller: 1,
      "data-contract": 1,
      "decision-path": 1,
      "symbol": 2,
      "data-model": 1,
      "data-store": 2,
      "data-table": 1,
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
      "accepts-contract": 1,
      "branches-to": 1,
      "maps-to": 1,
      "maps-to-table": 1,
      "queries-table": 1,
      "routes-to": 2,
      "stores-model": 1,
      "uses-cache-key": 1,
      "uses-eai": 1,
      "uses-store": 1
    },
    validatedClusterCount: 2,
    candidateClusterCount: 0,
    staleClusterCount: 0,
    activeDomainCount: 1,
    topDomains: [{ id: "member-auth", count: 7 }],
    topModules: [{ id: "dcp-member", count: 1 }]
  }
};

describe("retrieval unit standardization", () => {
  it("builds module, flow, knowledge-cluster, symbol, eai, and resource retrieval units from knowledge schema", () => {
    const units = buildRetrievalUnitSnapshot({ knowledgeSchema: snapshot });

    expect(units.summary.unitCount).toBeGreaterThan(0);
    expect(units.summary.unitTypeCounts["flow"]).toBeGreaterThanOrEqual(1);
    expect(units.summary.unitTypeCounts["eai-link"]).toBeGreaterThanOrEqual(1);
    expect(units.summary.unitTypeCounts["knowledge-cluster"]).toBeGreaterThanOrEqual(1);
    expect(units.summary.unitTypeCounts["resource-schema"]).toBeGreaterThanOrEqual(1);
    expect(units.summary.topDomains[0]?.id).toBe("member-auth");
    expect(units.summary.topChannels[0]?.id).toBe("monimo");

    const flowUnit = units.units.find((unit) => unit.type === "flow");
    expect(flowUnit?.title).toContain("MDP-MYCER999999M");
    expect(flowUnit?.searchText).toContain("/member/monimo/registe");
    const uiActionFlowUnit = units.units.find(
      (unit) =>
        unit.type === "flow" &&
        unit.entityIds.includes("ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth")
    );
    expect(uiActionFlowUnit?.searchText).toContain("requestMonimoAuth");
    expect(uiActionFlowUnit?.searchText).toContain("RouteController.route");
    expect(uiActionFlowUnit?.searchText).toContain("MonimoAuthRequest");
    expect(uiActionFlowUnit?.searchText).toContain("authenticate :: switch auth status");
    expect(uiActionFlowUnit?.searchText).toContain("EmbededMemberLoginService.authenticate");
    expect(uiActionFlowUnit?.entityIds).toEqual(
      expect.arrayContaining([
        "ui-action:src/views/login/MDP-MYCER999999M.vue:requestmonimoauth",
        "gateway-handler:RouteController.route",
        "data-contract:monimoauthrequest",
        "decision-path:authenticate:switch-auth-status:service",
        "symbol:method:EmbededMemberLoginService.authenticate:dcp-member/src/main/java/com/example/EmbededMemberLoginService.java"
      ])
    );
    expect(uiActionFlowUnit?.edgeIds).toContain("edge:transitions-to:controller:service");

    const eaiUnit = units.units.find((unit) => unit.type === "eai-link");
    expect(eaiUnit?.title).toContain("F14090150");

    const resourceTexts = units.units
      .filter((unit) => unit.type === "resource-schema")
      .map((unit) => unit.searchText.join(" "));
    expect(resourceTexts.some((text) => /redis|session|member\.login\.status/i.test(text))).toBe(true);
    expect(resourceTexts.some((text) => /monimoauthrequest/i.test(text))).toBe(true);
    expect(resourceTexts.some((text) => /monimo\.auth\.callback/i.test(text))).toBe(true);

    const knowledgeUnit = units.units.find((unit) => unit.id === "unit:knowledge:knowledge:candidate:channel:monimo");
    expect(knowledgeUnit?.channels).toContain("monimo");
    expect(uiActionFlowUnit?.searchText).toContain("monimo.auth.callback");
    expect(uiActionFlowUnit?.entityIds).toContain("async-channel:monimo.auth.callback");
  });

  it("renders a markdown summary of retrieval units", () => {
    const units = buildRetrievalUnitSnapshot({ knowledgeSchema: snapshot });
    const markdown = buildRetrievalUnitMarkdown(units);
    expect(markdown).toContain("# Retrieval Units");
    expect(markdown).toContain("## Unit Types");
    expect(markdown).toContain("## Representative Units");
    expect(markdown).toContain("status=");
  });

  it("ranks flow units highest for channel integration questions", () => {
    const units = buildRetrievalUnitSnapshot({ knowledgeSchema: snapshot });
    const ranked = rankRetrievalUnitsForQuestion({
      snapshot: units,
      question: "모니모 회원인증은 프론트에서 백엔드까지 어떻게 연동되는지 설명해줘.",
      questionType: "channel_or_partner_integration",
      questionTags: ["member-auth", "channel:monimo"],
      matchedKnowledgeIds: ["channel:monimo"]
    });

    expect(ranked[0]?.unit.type).toBe("flow");
    expect(ranked[0]?.unit.title).toContain("MDP-MYCER999999M");
  });

  it("ranks module overview units highest for module role questions", () => {
    const units = buildRetrievalUnitSnapshot({ knowledgeSchema: snapshot });
    const ranked = rankRetrievalUnitsForQuestion({
      snapshot: units,
      question: "dcp-member 프로젝트는 어떤 역할을 하는가?",
      questionType: "module_role_explanation",
      moduleCandidates: ["dcp-member"]
    });

    expect(ranked[0]?.unit.type).toBe("module-overview");
    expect(ranked[0]?.unit.title).toBe("dcp-member");
  });

  it("ranks resource-schema units highest for state store schema questions", () => {
    const units = buildRetrievalUnitSnapshot({ knowledgeSchema: snapshot });
    const ranked = rankRetrievalUnitsForQuestion({
      snapshot: units,
      question: "redis 세션 정보는 어떤 값들이 저장되고 어떤 테이블과 연결되는가?",
      questionType: "state_store_schema",
      matchedKnowledgeIds: ["store:redis"]
    });

    expect(ranked[0]?.unit.type).toBe("resource-schema");
    expect(ranked[0]?.unit.searchText.join(" ")).toMatch(/redis|member\.login\.status|tb_member_session/i);
  });

  it("prefers action-aligned flow units over adjacent status-read flow units", () => {
    const actionSnapshot = RetrievalUnitSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-03-17T00:00:00.000Z",
      workspaceDir: "/workspace",
      units: [
        {
          id: "unit:flow:status",
          type: "flow",
          title: "member status read flow",
          summary: "redis info status lookup flow",
          confidence: 0.86,
          validatedStatus: "validated",
          entityIds: ["controller:MemberStatusController.getMemberRedisInfo"],
          edgeIds: [],
          searchText: ["member redis status info", "/member/user/redis/info"],
          domains: ["member-auth"],
          subdomains: [],
          channels: ["monimo"],
          actions: ["action-read", "action-status-read", "action-state-store"],
          moduleRoles: [],
          processRoles: [],
          evidencePaths: ["dcp-member/src/MemberStatusController.java"]
        },
        {
          id: "unit:flow:auth",
          type: "flow",
          title: "member auth registration flow",
          summary: "monimo authentication and registration flow",
          confidence: 0.83,
          validatedStatus: "validated",
          entityIds: ["controller:RegisteUseDcpChnelController.registe"],
          edgeIds: [],
          searchText: ["member auth register bridge", "/member/monimo/registe"],
          domains: ["member-auth"],
          subdomains: [],
          channels: ["monimo"],
          actions: ["action-auth", "action-register"],
          moduleRoles: ["bridge"],
          processRoles: [],
          evidencePaths: ["dcp-member/src/RegisteUseDcpChnelController.java"]
        }
      ],
      summary: {
        unitCount: 2,
        unitTypeCounts: { flow: 2 },
        unitStatusCounts: { validated: 2 },
        topDomains: [{ id: "member-auth", count: 2 }],
        topChannels: [{ id: "monimo", count: 2 }],
        topModuleRoles: [{ id: "bridge", count: 1 }]
      }
    });

    const ranked = rankRetrievalUnitsForQuestion({
      snapshot: actionSnapshot,
      question: "모니모 회원 인증 로직이 어떻게 구현되는지 면밀히 분석해줘.",
      questionType: "channel_or_partner_integration",
      questionTags: ["channel:monimo", "member-auth"]
    });

    expect(ranked[0]?.unit.id).toBe("unit:flow:auth");
    expect(ranked.find((item) => item.unit.id === "unit:flow:status")?.reasons).toContain("action-mismatch");
  });

  it("creates symbol-block retrieval units for control-guard nodes", () => {
    const guardSnapshot: KnowledgeSchemaSnapshot = {
      ...snapshot,
      entities: [
        ...snapshot.entities,
        {
          id: "control-guard:memberauthvalidator",
          type: "control-guard",
          label: "MemberAuthValidator",
          summary: "member auth guard",
          metadata: {
            domains: ["member-auth"],
            subdomains: [],
            channels: ["monimo"],
            actions: ["action-auth"],
            moduleRoles: ["validation-control"],
            processRoles: [],
            confidence: 0.82,
            evidencePaths: ["dcp-member/src/main/java/com/example/MemberAuthValidator.java"],
            sourceType: "structure-index",
            validatedStatus: "derived"
          },
          attributes: {
            path: "dcp-member/src/main/java/com/example/MemberAuthValidator.java",
            guardName: "MemberAuthValidator"
          }
        }
      ],
      edges: [
        ...snapshot.edges,
        {
          id: "edge:declares:file:guard",
          type: "declares",
          fromId: "module:dcp-member",
          toId: "control-guard:memberauthvalidator",
          label: "module declares guard",
          metadata: {
            domains: ["member-auth"],
            subdomains: [],
            channels: ["monimo"],
            actions: ["action-auth"],
            moduleRoles: ["validation-control"],
            processRoles: [],
            confidence: 0.7,
            evidencePaths: ["dcp-member/src/main/java/com/example/MemberAuthValidator.java"],
            sourceType: "derived",
            validatedStatus: "derived"
          },
          attributes: {}
        }
      ]
    };

    const units = buildRetrievalUnitSnapshot({ knowledgeSchema: guardSnapshot });
    const guardUnit = units.units.find((unit) => unit.title === "MemberAuthValidator");

    expect(guardUnit?.type).toBe("symbol-block");
    expect(guardUnit?.actions).toContain("action-auth");
  });

  it("creates symbol-block retrieval units for data-query nodes", () => {
    const querySnapshot: KnowledgeSchemaSnapshot = {
      ...snapshot,
      entities: [
        ...snapshot.entities,
        {
          id: "data-query:findactivesession",
          type: "data-query",
          label: "findActiveSession",
          summary: "repository query for active session lookup",
          metadata: {
            domains: ["member-auth"],
            subdomains: [],
            channels: [],
            actions: ["action-read"],
            moduleRoles: ["data-persistence"],
            processRoles: [],
            confidence: 0.84,
            evidencePaths: ["dcp-member/src/main/java/com/example/MemberSessionRepository.java"],
            sourceType: "structure-index",
            validatedStatus: "derived"
          },
          attributes: {
            path: "dcp-member/src/main/java/com/example/MemberSessionRepository.java",
            queryName: "findActiveSession"
          }
        }
      ],
      edges: [
        ...snapshot.edges,
        {
          id: "edge:declares:file:data-query",
          type: "declares",
          fromId: "module:dcp-member",
          toId: "data-query:findactivesession",
          label: "module declares query",
          metadata: {
            domains: ["member-auth"],
            subdomains: [],
            channels: [],
            actions: ["action-read"],
            moduleRoles: ["data-persistence"],
            processRoles: [],
            confidence: 0.7,
            evidencePaths: ["dcp-member/src/main/java/com/example/MemberSessionRepository.java"],
            sourceType: "derived",
            validatedStatus: "derived"
          },
          attributes: {}
        }
      ]
    };

    const units = buildRetrievalUnitSnapshot({ knowledgeSchema: querySnapshot });
    const queryUnit = units.units.find((unit) => unit.title === "findActiveSession");

    expect(queryUnit?.type).toBe("symbol-block");
    expect(queryUnit?.actions).toContain("action-read");
  });

  it("preserves stale lifecycle status for stale learned-knowledge clusters and penalizes them", () => {
    const staleSnapshot: KnowledgeSchemaSnapshot = {
      ...snapshot,
      entities: snapshot.entities.map((entity) =>
        entity.id === "knowledge:candidate:channel:monimo"
          ? {
              ...entity,
              metadata: {
                ...entity.metadata,
                validatedStatus: "stale" as const
              },
              summary: "stale monimo channel candidate"
            }
          : entity
      )
    };

    const units = buildRetrievalUnitSnapshot({ knowledgeSchema: staleSnapshot });
    const staleKnowledgeUnit = units.units.find((unit) => unit.id === "unit:knowledge:knowledge:candidate:channel:monimo");
    expect(staleKnowledgeUnit?.validatedStatus).toBe("stale");

    const ranked = rankRetrievalUnitsForQuestion({
      snapshot: units,
      question: "모니모 회원인증은 프론트에서 백엔드까지 어떻게 연동되는지 설명해줘.",
      questionType: "channel_or_partner_integration",
      questionTags: ["member-auth", "channel:monimo"],
      matchedKnowledgeIds: ["channel:monimo"]
    });

    const rankedFlow = ranked.find((item) => item.unit.type === "flow");
    const rankedKnowledge = ranked.find((item) => item.unit.id === "unit:knowledge:knowledge:candidate:channel:monimo");
    expect(rankedFlow).toBeDefined();
    if (rankedKnowledge) {
      expect((rankedFlow?.score ?? 0)).toBeGreaterThan(rankedKnowledge.score);
    } else {
      expect(ranked.some((item) => item.unit.id === "unit:knowledge:knowledge:candidate:channel:monimo")).toBe(false);
    }
  });

  it("derives retrieval support candidates from top-ranked units using evidence paths", () => {
    const units = buildRetrievalUnitSnapshot({ knowledgeSchema: snapshot });
    const ranked = rankRetrievalUnitsForQuestion({
      snapshot: units,
      question: "모니모 회원인증은 프론트에서 백엔드까지 어떻게 연동되는지 설명해줘.",
      questionType: "channel_or_partner_integration",
      questionTags: ["member-auth", "channel:monimo"],
      matchedKnowledgeIds: ["channel:monimo"]
    });

    const supports = buildRetrievalUnitSupportCandidates({
      rankedUnits: ranked,
      existingPaths: ["src/views/login/MDP-MYCER999999M.vue"],
      limit: 4
    });

    expect(supports.length).toBeGreaterThan(0);
    expect(supports[0]?.reasons.some((reason) => reason.startsWith("retrieval-unit-derived="))).toBe(true);
    expect(supports.some((item) => item.path.includes("RegisteUseDcpChnelController"))).toBe(true);
  });
});
