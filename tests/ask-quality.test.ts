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

  it("fails state store schema answers when direct store/key evidence is omitted", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "회원 인증은 일반적인 상태 관리 흐름으로 처리된다.",
        confidence: 0.63,
        evidence: ["redis evidence", "session evidence"],
        caveats: []
      },
      question: "redis 세션 정보는 어떤 값들이 저장되는가?",
      questionType: "state_store_schema",
      hitPaths: [
        "dcp-member/src/main/java/com/acme/RedisSessionSupport.java",
        "dcp-member/src/main/java/com/acme/MemberSessionRepository.java"
      ],
      hydratedEvidence: [
        {
          path: "dcp-member/src/main/java/com/acme/RedisSessionSupport.java",
          reason: "callee:RedisSessionSupport.getRedisInfo",
          codeFile: true,
          moduleMatched: true
        }
      ],
      matchedOntologyNodeTypes: ["data-store", "cache-key", "data-table"],
      matchedOntologyNodeLabels: ["Redis Store", "member.login.status", "TB_MEMBER_SESSION"]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-store-schema-detail");
    expect(gate.failures).toContain("missing-direct-store-label-detail");
  });

  it("passes state store schema answers when redis/table/key details are explicit", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "Redis Store 에는 member.login.status, member.profile 같은 cache key 가 저장되고, 영속 데이터는 TB_MEMBER_SESSION 테이블과 MemberSessionEntity 모델을 통해 조회된다.",
        confidence: 0.78,
        evidence: ["redis key evidence", "table evidence"],
        caveats: []
      },
      question: "redis 세션 정보는 어떤 값들이 저장되는가?",
      questionType: "state_store_schema",
      hitPaths: [
        "dcp-member/src/main/java/com/acme/RedisSessionSupport.java",
        "dcp-member/src/main/java/com/acme/MemberSessionEntity.java",
        "dcp-member/src/main/java/com/acme/MemberSessionRepository.java"
      ],
      hydratedEvidence: [
        {
          path: "dcp-member/src/main/java/com/acme/RedisSessionSupport.java",
          reason: "callee:RedisSessionSupport.getRedisInfo",
          codeFile: true,
          moduleMatched: true
        }
      ],
      matchedOntologyNodeTypes: ["data-store", "cache-key", "data-model", "data-table"],
      matchedOntologyNodeLabels: ["Redis Store", "member.login.status", "MemberSessionEntity", "TB_MEMBER_SESSION"]
    });

    expect(gate.passed).toBe(true);
  });

  it("fails channel integration answers when only status-read actions back the evidence", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "모니모 회원 인증은 /member/user/redis/info 를 통해 Redis 세션 상태를 조회하는 구조로 구현된다.",
        confidence: 0.68,
        evidence: ["redis info flow", "gateway bridge flow"],
        caveats: []
      },
      question: "모니모 회원 인증 로직이 어떻게 구현되는지 면밀히 분석해줘.",
      questionType: "channel_or_partner_integration",
      hitPaths: [
        "dcp-member/src/main/java/com/acme/MemberStatusController.java",
        "dcp-member/src/main/java/com/acme/RedisSessionSupport.java"
      ],
      hydratedEvidence: [
        {
          path: "dcp-member/src/main/java/com/acme/MemberStatusController.java",
          reason: "callee:MemberStatusController.getMemberRedisInfo",
          codeFile: true,
          moduleMatched: true
        }
      ],
      matchedOntologyNodeTypes: ["controller", "data-store", "cache-key"],
      matchedOntologyNodeLabels: ["MemberStatusController.getMemberRedisInfo", "Redis Store", "member.login.status"],
      matchedOntologyNodeActions: ["action-read", "action-status-read", "action-state-store"],
      questionTags: ["channel:monimo", "member-auth"]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-aligned-action-evidence");
    expect(gate.failures).toContain("missing-aligned-action-detail");
  });

  it("passes channel integration answers when auth/register actions are explicit", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "모니모 회원 인증은 /gw/api/member/monimo/registe 브릿지 호출 뒤 RegisteUseDcpChnelController.registe 와 EmbededMemberLoginService.authenticate 가 회원 등록 및 인증 단계를 수행하는 구조다.",
        confidence: 0.81,
        evidence: ["channel flow", "service flow"],
        caveats: []
      },
      question: "모니모 회원 인증 로직이 어떻게 구현되는지 면밀히 분석해줘.",
      questionType: "channel_or_partner_integration",
      hitPaths: [
        "dcp-member/src/main/java/com/acme/RegisteUseDcpChnelController.java",
        "dcp-member/src/main/java/com/acme/EmbededMemberLoginService.java"
      ],
      hydratedEvidence: [
        {
          path: "dcp-member/src/main/java/com/acme/EmbededMemberLoginService.java",
          reason: "callee:EmbededMemberLoginService.authenticate",
          codeFile: true,
          moduleMatched: true
        }
      ],
      matchedOntologyNodeTypes: ["controller", "service"],
      matchedOntologyNodeLabels: [
        "RegisteUseDcpChnelController.registe",
        "EmbededMemberLoginService.authenticate"
      ],
      matchedOntologyNodeActions: ["action-auth", "action-register"],
      questionTags: ["channel:monimo", "member-auth"]
    });

    expect(gate.passed).toBe(true);
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
      ],
      questionTags: ["division", "appexpiry", "insurance", "action-read"]
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

  it("fails cross-layer answers that mention unaligned flows alongside the canonical path", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "MDP-MYINT020210M 화면에서 /gw/api/insurance/benefit/claim/insert 를 호출하고 RouteController.route 를 거쳐 BenefitClaimController.insertBenefitClaim 와 BenefitClaimService.saveBenefitClaim 으로 이어진다. 추가로 /gw/api/loan/v2/realty/request/house/collateral/status/check/customer 를 호출해 RealtyCollateralLoanV2StatusController.checkCustomer 로 간다.",
        confidence: 0.82,
        evidence: ["frontend evidence", "backend evidence"],
        caveats: []
      },
      question: "보험금 청구 로직이 frontend부터 backend까지 어떤 흐름으로 진행되는지 면밀히 분석해줘.",
      hitPaths: [
        "dcp-front-develop/src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M.vue",
        "dcp-services-mevelop/dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/controller/BenefitClaimController.java"
      ],
      strategy: "cross_layer_flow",
      linkedFlowEvidence: [
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020210M",
          screenCode: "MDP-MYINT020210M",
          apiUrl: "/gw/api/insurance/benefit/claim/insert",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/insert",
          backendControllerMethod: "BenefitClaimController.insertBenefitClaim",
          serviceHints: ["BenefitClaimService.saveBenefitClaim"],
          capabilityTags: ["insurance", "benefit", "claim", "insert", "action-write"]
        },
        {
          routePath: "/mo/mysamsunglife/loan/request/MDP-MYLOT021200M",
          screenCode: "MDP-MYLOT021200M",
          apiUrl: "/gw/api/loan/v2/realty/request/house/collateral/status/check/customer",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/loan/v2/realty/request/house/collateral/status/check/customer",
          backendControllerMethod: "RealtyCollateralLoanV2StatusController.checkCustomer",
          serviceHints: ["RealtyCollateralLoanV2StatusService.callF1CLN0130"],
          capabilityTags: ["loan", "collateral", "customer", "check", "action-check"]
        }
      ],
      questionTags: ["보험금", "청구", "benefit", "claim", "action-write"]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("contains-unaligned-flow-detail");
  });

  it("fails cross-layer answers that omit the representative canonical path", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "보험금 청구 관련 보조 단계로 /gw/api/insurance/benefit/claim/doc/insert 를 호출하고 RouteController.route 를 거쳐 BenefitClaimController.insertBenefitClaimDoc 와 BenefitClaimService.saveBenefitClaimDoc 로 이어진다.",
        confidence: 0.74,
        evidence: ["frontend evidence", "backend evidence"],
        caveats: []
      },
      question: "보험금 청구 로직이 프론트부터 백엔드까지 어떻게 돌아가는지 면밀히 분석해줘.",
      hitPaths: [
        "dcp-front-develop/src/views/mo/mysamsunglife/insurance/internet/MDP-MYINT020200M.vue",
        "dcp-services-mevelop/dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/controller/BenefitClaimController.java"
      ],
      strategy: "cross_layer_flow",
      linkedFlowEvidence: [
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020200M",
          screenCode: "MDP-MYINT020200M",
          apiUrl: "/gw/api/insurance/benefit/claim/inquiry",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/inquiry",
          backendControllerMethod: "BenefitClaimController.benefitClaimInquiry",
          serviceHints: ["BenefitClaimService.loadBenefitClaim"],
          capabilityTags: ["insurance", "benefit", "claim", "action-read"]
        },
        {
          routePath: "/mo/mysamsunglife/insurance/internet/MDP-MYINT020220M",
          screenCode: "MDP-MYINT020220M",
          apiUrl: "/gw/api/insurance/benefit/claim/doc/insert",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/insurance/benefit/claim/doc/insert",
          backendControllerMethod: "BenefitClaimController.insertBenefitClaimDoc",
          serviceHints: ["BenefitClaimService.saveBenefitClaimDoc"],
          capabilityTags: ["insurance", "benefit", "claim", "action-document"]
        }
      ],
      questionTags: ["보험금", "청구", "benefit", "claim", "action-read", "action-document"]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-representative-flow-detail");
  });

  it("fails cross-layer answers when a specific business question is answered with adjacent content flow only", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "MDP-PRREA000070M 화면에서 /gw/api/display/board/content/class 를 호출하고 RouteController.route 를 거쳐 DisplayBoardContentController.selectClassList 와 DisplayContentBoardService.selectClassList 로 이어진다.",
        confidence: 0.78,
        evidence: ["frontend evidence", "backend evidence"],
        caveats: []
      },
      question: "IRP가입 로직이 프론트부터 백엔드까지 어떻게 구성되는지 면밀히 분석해줘.",
      questionTags: ["irp", "가입", "irp-가입", "action-register"],
      hitPaths: [
        "dcp-front-develop/src/views/mo/products/pension/main/MDP-PRREA000070M.vue",
        "dcp-core/src/main/java/com/samsunglife/dcp/core/display/contents/board/DisplayBoardContentController.java"
      ],
      strategy: "cross_layer_flow",
      linkedFlowEvidence: [
        {
          routePath: "/mo/products/pension/main/MDP-PRREA000070M",
          screenCode: "MDP-PRREA000070M",
          apiUrl: "/gw/api/display/board/content/class",
          gatewayPath: "/api/**",
          gatewayControllerMethod: "RouteController.route",
          backendPath: "/display/board/content/class",
          backendControllerMethod: "DisplayBoardContentController.selectClassList",
          serviceHints: ["DisplayContentBoardService.selectClassList"],
          capabilityTags: ["display", "board", "content", "class", "action-read"]
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-question-signal-match");
    expect(gate.failures).toContain("missing-specific-ontology-signal-evidence");
    expect(gate.failures).toContain("missing-specific-ontology-signal-detail");
  });

  it("fails module-role answers when the answer omits the actual module responsibility", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "dcp-async는 여러 클래스가 있고 서비스/컨트롤러가 존재한다.",
        confidence: 0.71,
        evidence: ["module evidence", "service evidence"],
        caveats: []
      },
      question: "dcp-async 프로젝트는 어떤 역할을 하는 것인가?",
      hitPaths: [
        "dcp-async/src/main/java/com/samsunglife/dcp/async/core/AsyncDispatcherManager.java",
        "dcp-async/src/main/java/com/samsunglife/dcp/async/service/AsyncMsgService.java"
      ],
      strategy: "architecture_overview",
      questionType: "module_role_explanation",
      moduleCandidates: ["dcp-async"],
      hydratedEvidence: [
        {
          path: "dcp-async/src/main/java/com/samsunglife/dcp/async/core/AsyncDispatcherManager.java",
          reason: "callee:AsyncDispatcherManager.start",
          codeFile: true,
          moduleMatched: true
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-module-role-detail");
  });

  it("fails channel integration answers when channel boundary detail is omitted", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "회원인증은 백엔드 서비스에서 처리된다.",
        confidence: 0.72,
        evidence: ["member evidence", "controller evidence"],
        caveats: []
      },
      question: "모니모 회원인증은 어떻게 연동되는지 설명해줘.",
      hitPaths: [
        "dcp-member/src/main/java/com/samsunglife/dcp/member/login/controller/EmbededMemberLoginController.java",
        "dcp-async/src/main/java/com/samsunglife/dcp/async/controller/MonimoAsyncController.java"
      ],
      questionType: "channel_or_partner_integration",
      questionTags: ["member-auth", "channel:monimo"],
      matchedKnowledgeIds: ["channel:monimo"],
      hydratedEvidence: [
        {
          path: "dcp-member/src/main/java/com/samsunglife/dcp/member/login/controller/EmbededMemberLoginController.java",
          reason: "method:EmbededMemberLoginController.login",
          codeFile: true,
          moduleMatched: true
        }
      ],
      linkedFlowEvidence: [
        {
          apiUrl: "/gw/api/member/monimo/registe",
          routePath: "/mo/login/MDP-MYCER999999M",
          backendPath: "/member/monimo/registe",
          backendControllerMethod: "RegisteUseDcpChnelController.registeMonimo"
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-channel-integration-detail");
    expect(gate.failures).toContain("missing-channel-boundary-detail");
  });

  it("fails process questions when process structure detail is omitted", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "배치 로직은 서비스 메서드에서 처리된다.",
        confidence: 0.69,
        evidence: ["batch evidence", "service evidence"],
        caveats: []
      },
      question: "대출 배치 job 이 어떤 step 과 tasklet 으로 처리되는지 설명해줘.",
      hitPaths: [
        "dcp-batch/src/main/java/com/acme/batch/LoanBatchJobConfig.java",
        "dcp-batch/src/main/java/com/acme/batch/LoanBatchTasklet.java"
      ],
      questionType: "process_or_batch_trace",
      hydratedEvidence: [
        {
          path: "dcp-batch/src/main/java/com/acme/batch/LoanBatchTasklet.java",
          reason: "callee:LoanBatchTasklet.execute",
          codeFile: true,
          moduleMatched: true
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-process-structure-detail");
    expect(gate.failures).toContain("missing-process-callee-detail");
  });

  it("fails explanatory answers when only stale retrieval units backed the answer", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer: "dcp-async는 비동기 지원과 관련되어 보인다.",
        confidence: 0.78,
        evidence: ["module evidence", "knowledge evidence"],
        caveats: []
      },
      question: "dcp-async 프로젝트는 어떤 역할을 하는 것인가?",
      hitPaths: [
        "dcp-async/src/main/java/com/samsunglife/dcp/async/core/AsyncDispatcherManager.java"
      ],
      questionType: "module_role_explanation",
      moduleCandidates: ["dcp-async"],
      matchedRetrievalUnitStatuses: ["stale", "stale"]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("stale-retrieval-only");
  });

  it("fails exact endpoint trace answers when the named target api is omitted", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "AccBenefitClaimController.spotSave 는 service 를 호출하고 resolveResponse 를 반환한다.",
        confidence: 0.74,
        evidence: ["controller evidence", "service evidence"],
        caveats: []
      },
      question:
        "AccBenefitClaimController 안의 claim/doc/insert api가 하는 일을 면밀히 분석해줘.",
      questionType: "symbol_deep_trace",
      hitPaths: [
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java",
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimService.java"
      ],
      hydratedEvidence: [
        {
          path: "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java",
          reason: "callee:AccBenefitClaimController.insertBenefitClaimDoc",
          codeFile: true,
          moduleMatched: true
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-target-flow-detail");
  });

  it("fails workflow sequence answers when ordered steps are omitted", () => {
    const gate = qualityGateForAskOutput({
      output: {
        answer:
          "AccBenefitClaimController.insertBenefitClaimDoc 는 service 저장을 수행한다.",
        confidence: 0.72,
        evidence: ["controller evidence", "service evidence"],
        caveats: []
      },
      question:
        "spotSave, validate, insert, doc/insert 순으로 호출하는 흐름을 면밀히 분석해줘.",
      questionType: "symbol_deep_trace",
      hitPaths: [
        "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java"
      ],
      hydratedEvidence: [
        {
          path: "dcp-insurance/src/main/java/com/acme/AccBenefitClaimController.java",
          reason: "callee:AccBenefitClaimController.insertBenefitClaimDoc",
          codeFile: true,
          moduleMatched: true
        }
      ]
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("missing-workflow-sequence-detail");
  });

});
