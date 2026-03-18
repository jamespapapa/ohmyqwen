import { describe, expect, it } from "vitest";
import {
  classifyAskQuestionType,
  extractAskQuestionFlowTargets,
  inferQuestionActionHints,
  getAskQuestionTypeContract,
  getAskQuestionTypeRetrievalContract
} from "../src/server/question-types.js";

describe("question types", () => {
  it("classifies explicit frontend-backend flow questions as cross_layer_flow", () => {
    const result = classifyAskQuestionType({
      question: "보험금 청구 로직이 frontend부터 backend까지 어떻게 이어지는지 추적해줘.",
      strategy: "cross_layer_flow"
    });

    expect(result.type).toBe("cross_layer_flow");
  });

  it("classifies module role questions as module_role_explanation", () => {
    const result = classifyAskQuestionType({
      question: "dcp-async 프로젝트는 어떤 역할을 하는 것인가?",
      strategy: "architecture_overview",
      moduleCandidates: ["dcp-async"]
    });

    expect(result.type).toBe("module_role_explanation");
  });

  it("classifies channel integration questions as channel_or_partner_integration", () => {
    const result = classifyAskQuestionType({
      question: "모니모 회원인증은 어떻게 연동되는지 설명해줘.",
      strategy: "general",
      questionTags: ["member-auth", "channel:monimo"]
    });

    expect(result.type).toBe("channel_or_partner_integration");
  });

  it("classifies redis/session schema questions as state_store_schema", () => {
    const result = classifyAskQuestionType({
      question: "redis 세션 정보는 어떤 값들이 저장되고 TTL은 어떻게 관리되나?",
      strategy: "config_resource",
      matchedKnowledgeIds: ["store:redis"]
    });

    expect(result.type).toBe("state_store_schema");
  });

  it("classifies batch/process questions as process_or_batch_trace", () => {
    const result = classifyAskQuestionType({
      question: "배치 job 이 어떤 step과 tasklet으로 동작하는지 추적해줘.",
      strategy: "module_flow_topdown"
    });

    expect(result.type).toBe("process_or_batch_trace");
  });

  it("classifies symbol/method questions as symbol_deep_trace", () => {
    const result = classifyAskQuestionType({
      question: "AccBenefitClaimService.saveBenefitClaimDoc 이후 호출흐름을 분석해줘.",
      strategy: "method_trace"
    });

    expect(result.type).toBe("symbol_deep_trace");
  });

  it("classifies broad domain questions as domain_capability_overview", () => {
    const result = classifyAskQuestionType({
      question: "퇴직연금 관련 로직이 어떻게 구현되어 있는지 면밀히 분석해줘.",
      strategy: "architecture_overview",
      questionTags: ["retire-pension"]
    });

    expect(result.type).toBe("domain_capability_overview");
  });

  it("classifies capability execution questions as business_capability_trace", () => {
    const result = classifyAskQuestionType({
      question: "보험금 청구 저장 로직이 서비스 내부에서 어떻게 처리되는지 설명해줘.",
      strategy: "module_flow_topdown",
      questionTags: ["benefit-claim", "claim-submit"]
    });

    expect(result.type).toBe("business_capability_trace");
  });

  it("returns stricter contracts for cross-layer and symbol trace questions", () => {
    expect(getAskQuestionTypeContract("cross_layer_flow").requireBusinessTraceDetail).toBe(true);
    expect(getAskQuestionTypeContract("symbol_deep_trace").requireTargetSymbolDetail).toBe(true);
    expect(getAskQuestionTypeContract("config_or_resource_explanation").requireCodeEvidence).toBe(false);
    expect(getAskQuestionTypeContract("state_store_schema").requireResourceSchemaDetail).toBe(true);
  });

  it("returns retrieval preferences per question type", () => {
    const moduleRole = getAskQuestionTypeRetrievalContract("module_role_explanation");
    expect(moduleRole.preferredMemoryFiles[0]).toBe("ontology-projections/latest.md");
    expect(moduleRole.preferredUnitTypes).toContain("module-overview");
    expect(moduleRole.queryHints).toContain("role");

    const channel = getAskQuestionTypeRetrievalContract("channel_or_partner_integration");
    expect(channel.preferredMemoryFiles.slice(0, 2)).toEqual([
      "ontology-projections/latest.md",
      "ontology-graph/latest.md"
    ]);
    expect(channel.preferredUnitTypes).toContain("flow");
    expect(channel.queryHints).toContain("callback");

    const storeSchema = getAskQuestionTypeRetrievalContract("state_store_schema");
    expect(storeSchema.preferredUnitTypes[0]).toBe("resource-schema");
    expect(storeSchema.queryHints).toContain("redis");
  });

  it("extracts generic action hints from implementation questions", () => {
    expect(inferQuestionActionHints("모니모 회원 인증 로직이 어떻게 구현되는지 설명해줘.")).toEqual(
      expect.arrayContaining(["action-auth"])
    );
    expect(inferQuestionActionHints("회원 상태 조회와 redis 세션 정보를 확인해줘.")).toEqual(
      expect.arrayContaining(["action-status-read", "action-state-store"])
    );
  });

  it("extracts explicit endpoint and ordered workflow targets from questions", () => {
    const targets = extractAskQuestionFlowTargets(
      "AccBenefitClaimController 안의 claim/doc/insert api를 분석하고, spotSave, validate, insert, doc/insert 순으로 호출하는 흐름도 봐줘."
    );

    expect(targets.endpointPaths).toEqual(expect.arrayContaining(["claim/doc/insert", "doc/insert"]));
    expect(targets.controllerClasses).toContain("AccBenefitClaimController");
    expect(targets.workflowSequence).toEqual(
      expect.arrayContaining(["spotSave", "validate", "insert", "doc/insert"])
    );
  });

  it("classifies explicit endpoint/controller questions as symbol_deep_trace even when api/controller words are present", () => {
    const result = classifyAskQuestionType({
      question:
        "보험금 청구 로직 내에서 AccBenefitClaimController 안에 claim/doc/insert api가 있어. 이 api가 하는 일을 분석해줘.",
      strategy: "cross_layer_flow"
    });

    expect(result.type).toBe("symbol_deep_trace");
  });
});
