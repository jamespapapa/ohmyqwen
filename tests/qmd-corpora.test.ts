import { describe, expect, it } from "vitest";
import { buildQmdCorpusQueryCandidates, planQmdCorpusSearch } from "../src/retrieval/qmd-corpora.js";

describe("qmd corpora planning", () => {
  it("prefers frontend-code for frontend logic questions without excluding backend-code", () => {
    const plan = planQmdCorpusSearch({
      task: "청구 버튼을 누른 뒤 프론트에서 어떤 검증을 하고 어떤 API를 호출하는지 확인해줘"
    });

    const frontend = plan.corpora.find((entry) => entry.id === "frontend-code");
    const backend = plan.corpora.find((entry) => entry.id === "backend-code");
    const docs = plan.corpora.find((entry) => entry.id === "docs-memory");

    expect(frontend).toBeTruthy();
    expect(backend).toBeTruthy();
    expect(docs).toBeTruthy();
    expect(frontend!.weight).toBeGreaterThan(backend!.weight);
    expect(backend!.weight).toBeGreaterThan(0.2);
    expect(docs!.weight).toBeLessThan(backend!.weight);
  });

  it("prioritizes config-xml for interface/config questions without zeroing backend-code", () => {
    const plan = planQmdCorpusSearch({
      task: "F1FCZ0045 EAI 인터페이스 xml 설정과 requestSystemId 연결을 확인해줘"
    });

    const config = plan.corpora.find((entry) => entry.id === "config-xml");
    const backend = plan.corpora.find((entry) => entry.id === "backend-code");

    expect(config).toBeTruthy();
    expect(backend).toBeTruthy();
    expect(config!.weight).toBeGreaterThan(backend!.weight);
    expect(backend!.weight).toBeGreaterThan(0.15);
  });

  it("caps docs-memory when code signals are strong", () => {
    const plan = planQmdCorpusSearch({
      task: "AccBenefitClaimService saveBenefitClaimDoc 호출 흐름을 깊게 분석해줘"
    });

    const backend = plan.corpora.find((entry) => entry.id === "backend-code");
    const docs = plan.corpora.find((entry) => entry.id === "docs-memory");

    expect(backend).toBeTruthy();
    expect(docs).toBeTruthy();
    expect(backend!.weight).toBeGreaterThan(0.8);
    expect(docs!.weight).toBeLessThan(0.12);
  });

  it("builds corpus-shaped qmd query candidates", () => {
    const backendQueries = buildQmdCorpusQueryCandidates("backend-code", {
      task: "보험금 청구 로직을 탑다운으로 분석해줘"
    });
    const frontendQueries = buildQmdCorpusQueryCandidates("frontend-code", {
      task: "청구 버튼 클릭 후 프론트 검증 로직을 분석해줘"
    });
    const configQueries = buildQmdCorpusQueryCandidates("config-xml", {
      task: "보험금 청구 EAI xml 설정을 찾아줘"
    });

    expect(backendQueries.some((query) => /BenefitClaim(Service|Controller)|controller service/i.test(query))).toBe(true);
    expect(frontendQueries.some((query) => /component|page|button|form|api/i.test(query))).toBe(true);
    expect(configQueries.some((query) => /xml|eai|mapper|requestsystemid/i.test(query))).toBe(true);
    expect(frontendQueries[0]).toMatch(/component|page|button|form|api/i);
    expect(configQueries[0]).toMatch(/xml|eai|requestsystemid/i);
    expect(frontendQueries.every((query) => !/controller service|mapper dao/i.test(query))).toBe(true);
    expect(configQueries.slice(0, 2).every((query) => !/controller service/i.test(query))).toBe(true);
  });
});
