import { describe, expect, it } from "vitest";
import { buildCanonicalFlowSupportUnits } from "../src/server/canonical-flow-support.js";
import type { CanonicalLinkedFlowPlan } from "../src/server/flow-links.js";
import type { RankedRetrievalUnit } from "../src/server/retrieval-units.js";

const canonicalFlowPlan: CanonicalLinkedFlowPlan = {
  primary: {
    screenCode: "MDP-MYINT020540M",
    routePath: "/mo/mysamsunglife/insurance/claim/MDP-MYINT020540M",
    screenPath: "src/views/mo/mysamsunglife/insurance/claim/MDP-MYINT020540M.vue",
    apiUrl: "/gw/api/insurance/accBenefit/claim/spotSave",
    backendPath: "/insurance/accBenefit/claim/spotSave",
    backendControllerMethod: "AccBenefitClaimController.spotSave",
    serviceHints: ["AccBenefitClaimService.spotSave", "CallAccBenefitClaimService.callAddinsert"],
    confidence: 0.91,
    reasons: ["cross-layer-question"]
  },
  canonicalFlows: [
    {
      screenCode: "MDP-MYINT020540M",
      routePath: "/mo/mysamsunglife/insurance/claim/MDP-MYINT020540M",
      screenPath: "src/views/mo/mysamsunglife/insurance/claim/MDP-MYINT020540M.vue",
      apiUrl: "/gw/api/insurance/accBenefit/claim/spotSave",
      backendPath: "/insurance/accBenefit/claim/spotSave",
      backendControllerMethod: "AccBenefitClaimController.spotSave",
      serviceHints: ["AccBenefitClaimService.spotSave", "CallAccBenefitClaimService.callAddinsert"],
      confidence: 0.91,
      reasons: ["cross-layer-question"]
    }
  ],
  droppedIncoherentFlowCount: 2,
  canonicalNamespaceCount: 1
};

function makeRankedUnit(input: Partial<RankedRetrievalUnit> & { unit: RankedRetrievalUnit["unit"] }): RankedRetrievalUnit {
  return {
    score: 10,
    reasons: ["base"],
    ...input
  };
}

describe("canonical flow support ranking", () => {
  it("prefers retrieval units aligned with canonical flow namespace and support edges", () => {
    const rankedUnits: RankedRetrievalUnit[] = [
      makeRankedUnit({
        score: 9,
        unit: {
          id: "unit:resource:insurance:claim",
          type: "resource-schema",
          title: "AccBenefitClaim request/response store support",
          summary: "AccBenefitClaimController.spotSave -> AccBenefitClaimService.spotSave -> Redis/EAI",
          confidence: 0.82,
          validatedStatus: "derived",
          entityIds: ["data-contract:claimsave", "store:redis", "data-table:tb_claim_doc"],
          edgeIds: [
            "edge:propagates-contract:controller:service:data-contract:claimsave:request",
            "edge:propagates-contract:service:store:data-contract:claimsave:response",
            "edge:transitions-to:service:store"
          ],
          searchText: ["insurance accBenefit claim spotSave request response redis eai"],
          domains: [],
          subdomains: [],
          channels: [],
          actions: ["action-write", "action-document"],
          moduleRoles: ["data-contract"],
          processRoles: ["contract-propagation"],
          evidencePaths: ["dcp-insurance/src/main/java/com/example/AccBenefitClaimService.java"]
        }
      }),
      makeRankedUnit({
        score: 11,
        unit: {
          id: "unit:flow:insurance:claim",
          type: "flow",
          title: "MDP-MYINT020540M -> AccBenefitClaimController.spotSave",
          summary: "insurance claim spotSave representative flow",
          confidence: 0.8,
          validatedStatus: "derived",
          entityIds: ["api:/insurance/accBenefit/claim/spotSave", "service:AccBenefitClaimService.spotSave", "store:redis"],
          edgeIds: [
            "edge:transitions-to:controller:service",
            "edge:propagates-contract:controller:service:data-contract:claimsave:request"
          ],
          searchText: ["insurance accBenefit claim spotSave controller service"],
          domains: [],
          subdomains: [],
          channels: [],
          actions: ["action-write"],
          moduleRoles: [],
          processRoles: ["state-transition"],
          evidencePaths: ["src/views/mo/mysamsunglife/insurance/claim/MDP-MYINT020540M.vue"]
        }
      }),
      makeRankedUnit({
        score: 10.5,
        unit: {
          id: "unit:flow:insurance:claim:progress",
          type: "flow",
          title: "MDP-MYINT021120M -> BenefitClaimProgressController.benefitClaimProgressGenInqury",
          summary: "insurance claim progress flow related to representative path",
          confidence: 0.79,
          validatedStatus: "derived",
          entityIds: [
            "api:/insurance/benefit/claim/progress/gen/inqury",
            "controller:BenefitClaimProgressController.benefitClaimProgressGenInqury"
          ],
          edgeIds: ["edge:transitions-to:api:/insurance/accBenefit/claim/spotSave:api:/insurance/benefit/claim/progress/gen/inqury:flow-family"],
          searchText: ["insurance benefit claim progress inqury controller service"],
          domains: [],
          subdomains: [],
          channels: [],
          actions: ["action-read"],
          moduleRoles: [],
          processRoles: ["state-transition"],
          evidencePaths: ["src/views/mo/mysamsunglife/insurance/claim/MDP-MYINT021120M.vue"]
        }
      }),
      makeRankedUnit({
        score: 14,
        unit: {
          id: "unit:flow:loan:noise",
          type: "flow",
          title: "MDP-MYLOT021200M -> RealtyCollateralLoanV2StatusController.checkCustomer",
          summary: "loan request status flow",
          confidence: 0.86,
          validatedStatus: "derived",
          entityIds: ["api:/loan/v2/realty/request/house/collateral/status/check/customer", "store:redis"],
          edgeIds: ["edge:transitions-to:controller:service"],
          searchText: ["loan realty collateral status check customer"],
          domains: [],
          subdomains: [],
          channels: [],
          actions: ["action-check"],
          moduleRoles: [],
          processRoles: ["state-transition"],
          evidencePaths: ["src/views/mo/mysamsunglife/loan/house/MDP-MYLOT021200M.vue"]
        }
      })
    ];

    const supportUnits = buildCanonicalFlowSupportUnits({
      canonicalFlowPlan,
      rankedUnits,
      limit: 3
    });

    expect(supportUnits[0]?.unitId).toBe("unit:flow:insurance:claim");
    expect(supportUnits[1]?.unitId).toBe("unit:flow:insurance:claim:progress");
    expect(supportUnits[2]?.unitId).toBe("unit:resource:insurance:claim");
    expect(supportUnits.some((item) => item.unitId === "unit:flow:loan:noise")).toBe(false);
    expect(supportUnits[0]?.reasons).toEqual(expect.arrayContaining(["transitions", "request-contract"]));
    expect(supportUnits[1]?.reasons).toEqual(expect.arrayContaining(["workflow-family"]));
    expect(supportUnits[2]?.reasons).toEqual(expect.arrayContaining(["response-contract", "support-entities"]));
  });
});
