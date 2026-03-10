import { describe, expect, it } from "vitest";
import { qualityGateForAskOutput } from "../src/server/ask-quality.js";

describe("ask quality gate", () => {
  it("passes module topdown answers only when module-scoped code evidence is present", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "Entry -> Controller -> Service -> downstream 흐름이며 saveBenefitClaimDoc 가 서비스 핵심 메서드로 실행된다.",
        confidence: 0.72,
        evidence: ["controller evidence", "service evidence"],
        caveats: []
      },
      question: "dcp-insurance 내부에서 보험금 청구 로직을 탑다운으로 설명해줘.",
      hitPaths: [
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java",
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java"
      ],
      strategy: "module_flow_topdown",
      moduleCandidates: ["dcp-insurance"],
      hydratedEvidence: [
        {
          path: "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java",
          reason: "method:AccBenefitClaimController.insertBenefitClaimDoc",
          codeFile: true,
          moduleMatched: true
        },
        {
          path: "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java",
          reason: "callee:AccBenefitClaimService.saveBenefitClaimDoc",
          codeFile: true,
          moduleMatched: true
        }
      ]
    });

    expect(gate.passed).toBe(true);
    expect(gate.failures).toEqual([]);
  });

  it("fails module topdown answers when hydrated service callee detail is omitted", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "Entry -> Controller -> Service -> downstream 흐름이다.",
        confidence: 0.72,
        evidence: ["controller evidence", "service evidence"],
        caveats: []
      },
      question: "dcp-insurance 내부에서 보험금 청구 로직을 탑다운으로 설명해줘.",
      hitPaths: [
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java",
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java"
      ],
      strategy: "module_flow_topdown",
      moduleCandidates: ["dcp-insurance"],
      hydratedEvidence: [
        {
          path: "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java",
          reason: "callee:AccBenefitClaimService.saveBenefitClaimDoc",
          codeFile: true,
          moduleMatched: true
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-service-callee-detail");
  });

  it("fails logic answers when only resource/xml evidence exists", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "보험금 청구는 XML과 설정 중심으로 보인다.",
        confidence: 0.51,
        evidence: ["xml evidence", "menu evidence"],
        caveats: []
      },
      question: "보험금 청구 로직이 어떻게 실행되는지 설명해줘.",
      hitPaths: ["resources/eai/env/dev/io/sli/ea2/F10480013_service.xml"],
      strategy: "architecture_overview",
      hydratedEvidence: []
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-code-evidence");
    expect(gate.failures).toContain("missing-code-body-evidence");
  });

  it("fails module-scoped answers when hydrated evidence does not stay inside the requested module", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "Controller -> Service -> mapper 흐름이며 saveBenefitClaimDoc 가 핵심이다.",
        confidence: 0.71,
        evidence: ["controller evidence", "service evidence"],
        caveats: []
      },
      question: "dcp-insurance 내부에서 보험금 청구 로직을 탑다운으로 설명해줘.",
      hitPaths: [
        "dcp-core/src/main/java/com/acme/CommonClaimService.java",
        "dcp-core/src/main/java/com/acme/CommonClaimMapper.java"
      ],
      strategy: "module_flow_topdown",
      moduleCandidates: ["dcp-insurance"],
      hydratedEvidence: [
        {
          path: "dcp-core/src/main/java/com/acme/CommonClaimService.java",
          reason: "callee:CommonClaimService.saveBenefitClaimDoc",
          codeFile: true,
          moduleMatched: false
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-module-scoped-code-evidence");
  });

  it("fails topdown answers when direct linked EAI evidence exists but answer omits the interface detail", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "Entry -> Controller -> Service -> downstream 흐름이며 saveBenefitClaimDoc 가 서비스 핵심 메서드로 실행된다.",
        confidence: 0.74,
        evidence: ["controller evidence", "service evidence"],
        caveats: []
      },
      question: "dcp-insurance 내부에서 보험금 청구 로직을 탑다운으로 설명해줘.",
      hitPaths: [
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java",
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java"
      ],
      strategy: "module_flow_topdown",
      moduleCandidates: ["dcp-insurance"],
      hydratedEvidence: [
        {
          path: "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java",
          reason: "callee:AccBenefitClaimService.saveBenefitClaimDoc",
          codeFile: true,
          moduleMatched: true
        }
      ],
      linkedEaiEvidence: [
        {
          interfaceId: "F1FCZ0045",
          interfaceName: "홈페이지 사고보험금접수 명세 반영"
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-linked-eai-detail");
  });

  it("fails cross-layer flow answers when graph evidence exists but frontend/api/backend chain detail is missing", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "서비스 로직 중심으로 처리되며 saveDivisionExpiry 가 실행된다.",
        confidence: 0.74,
        evidence: ["frontend screen evidence", "backend controller evidence"],
        caveats: []
      },
      question: "프론트에서 분할만기보험금 화면 진입 후 어떤 API를 거쳐 백엔드 서비스까지 가는지 추적해줘.",
      hitPaths: [
        "dcp-front-develop/src/views/mo/mysamsunglife/insurance/give/MDP-MYINT022231M.vue",
        "dcp-services-mevelop/dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/give/controller/DivisionExpController.java"
      ],
      linkedFlowEvidence: [
        {
          routePath: "/mo/mysamsunglife/insurance/give/MDP-MYINT022231M",
          screenCode: "MDP-MYINT022231M",
          apiUrl: "/gw/api/insurance/division/appexpiry/inqury",
          backendPath: "/insurance/division/appexpiry/inqury",
          backendControllerMethod: "DivisionExpController.inqury",
          serviceHints: ["DivisionExpService.selectDivisionExpiry"]
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-frontend-route-evidence");
    expect(gate.failures).toContain("missing-api-url-evidence");
    expect(gate.failures).toContain("missing-backend-route-evidence");
    expect(gate.failures).toContain("missing-cross-layer-chain-detail");
  });

  it("passes cross-layer flow answers when frontend/api/backend chain detail is explicit", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "MDP-MYINT022231M 화면에서 /gw/api/insurance/division/appexpiry/inqury 를 호출하고, 이 요청은 gateway RouteController.route 를 거쳐 dcp-insurance 의 DivisionExpController.inqury 와 DivisionExpService.selectDivisionExpiry 로 이어진다.",
        confidence: 0.82,
        evidence: ["frontend screen evidence", "backend controller evidence"],
        caveats: []
      },
      question: "프론트에서 분할만기보험금 화면 진입 후 어떤 API를 거쳐 백엔드 서비스까지 가는지 추적해줘.",
      hitPaths: [
        "dcp-front-develop/src/views/mo/mysamsunglife/insurance/give/MDP-MYINT022231M.vue",
        "dcp-services-mevelop/dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/give/controller/DivisionExpController.java"
      ],
      linkedFlowEvidence: [
        {
          routePath: "/mo/mysamsunglife/insurance/give/MDP-MYINT022231M",
          screenCode: "MDP-MYINT022231M",
          apiUrl: "/gw/api/insurance/division/appexpiry/inqury",
          backendPath: "/insurance/division/appexpiry/inqury",
          backendControllerMethod: "DivisionExpController.inqury",
          serviceHints: ["DivisionExpService.selectDivisionExpiry"]
        }
      ]
    });

    expect(gate.passed).toBe(true);
  });

  it("passes topdown answers when direct linked EAI evidence is explicitly named", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "Entry -> Controller -> Service -> downstream 흐름이며 saveBenefitClaimDoc 이후 callF1FCZ0045 를 통해 F1FCZ0045(홈페이지 사고보험금접수 명세 반영) 인터페이스를 호출한다.",
        confidence: 0.79,
        evidence: ["controller evidence", "service evidence"],
        caveats: []
      },
      question: "dcp-insurance 내부에서 보험금 청구 로직을 탑다운으로 설명해줘.",
      hitPaths: [
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java",
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java"
      ],
      strategy: "module_flow_topdown",
      moduleCandidates: ["dcp-insurance"],
      hydratedEvidence: [
        {
          path: "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java",
          reason: "callee:AccBenefitClaimService.saveBenefitClaimDoc",
          codeFile: true,
          moduleMatched: true
        }
      ],
      linkedEaiEvidence: [
        {
          interfaceId: "F1FCZ0045",
          interfaceName: "홈페이지 사고보험금접수 명세 반영"
        }
      ]
    });

    expect(gate.passed).toBe(true);
  });


  it("fails cross-layer questions when no linked flow evidence exists", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "프론트에서 시작해 백엔드로 이어지는 흐름으로 보인다.",
        confidence: 0.58,
        evidence: ["generic evidence", "generic evidence 2"],
        caveats: []
      },
      question: "보험금 청구 로직이 frontend부터 backend까지 어떤 흐름으로 진행되는지 면밀히 분석해줘.",
      hitPaths: [
        "dcp-insurance/src/main/java/com/acme/BenefitClaimController.java",
        "dcp-insurance/src/main/java/com/acme/BenefitClaimService.java"
      ],
      strategy: "cross_layer_flow",
      hydratedEvidence: [
        {
          path: "dcp-insurance/src/main/java/com/acme/BenefitClaimService.java",
          reason: "callee:BenefitClaimService.saveBenefitClaim",
          codeFile: true,
          moduleMatched: true
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-linked-flow-evidence");
  });

  it("fails cross-layer claim answers when only adjacent non-claim flow evidence is used", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "MDP-MYINT022231M 화면에서 /gw/api/insurance/division/appexpiry/inqury 를 호출하고 gateway RouteController.route 를 거쳐 DivisionExpController.inqury 와 DivisionExpService.selectDivisionExpiry 로 이어진다.",
        confidence: 0.63,
        evidence: ["frontend evidence", "backend evidence"],
        caveats: []
      },
      question: "보험금 청구 로직이 frontend부터 backend까지 어떤 흐름으로 진행되는지 면밀히 분석해줘.",
      hitPaths: [
        "dcp-front-develop/src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M.vue",
        "dcp-services-mevelop/dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/controller/BenefitClaimController.java"
      ],
      strategy: "cross_layer_flow",
      hydratedEvidence: [
        {
          path: "dcp-services-mevelop/dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/BenefitClaimService.java",
          reason: "callee:BenefitClaimService.saveBenefitClaim",
          codeFile: true,
          moduleMatched: true
        }
      ],
      linkedFlowEvidence: [
        {
          routePath: "/mo/mysamsunglife/insurance/give/MDP-MYINT022231M",
          screenCode: "MDP-MYINT022231M",
          apiUrl: "/gw/api/insurance/division/appexpiry/inqury",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/division/appexpiry/inqury",
          backendControllerMethod: "DivisionExpController.inqury",
          serviceHints: ["DivisionExpService.selectDivisionExpiry"],
          capabilityTags: ["division-expiry", "gateway-api"]
        },
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M",
          screenCode: "MDP-MYINT020210M",
          apiUrl: "/gw/api/insurance/benefit/claim/insert",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/insert",
          backendControllerMethod: "BenefitClaimController.insertBenefitClaim",
          serviceHints: ["BenefitClaimService.saveBenefitClaim"],
          capabilityTags: ["benefit-claim", "claim-submit", "insurance-internet", "gateway-api"]
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-aligned-flow-detail");
  });

});
