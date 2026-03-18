"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildOntologyEdgePath,
  buildOntologyRenderableGraph
} from "../lib/ontology-graph-layout.js";

const CORE_STAGES = ["ANALYZE", "PLAN", "IMPLEMENT", "VERIFY", "PATCH", "FINISH"];
const QUERY_MODES = ["query_then_search", "search_only", "query_only"];

function statusClass(status) {
  if (status === "finished") return "ok";
  if (status === "failed") return "fail";
  if (status === "running") return "running";
  if (status === "waiting") return "waiting";
  return "";
}

function stageClass(stage, currentStage, runStatus, transitionStates) {
  if (runStatus === "failed" && (stage === "VERIFY" || stage === "PATCH")) {
    return "fail";
  }

  if (stage === currentStage && (runStatus === "running" || runStatus === "waiting")) {
    return "active";
  }

  if (transitionStates.has(stage) || (runStatus === "finished" && stage === "FINISH")) {
    return "done";
  }

  return "";
}

function actionTypeKo(actionType) {
  if (actionType === "write_file") return "파일 작성";
  if (actionType === "patch_file") return "파일 패치";
  if (actionType === "run_command") return "명령 실행";
  return actionType;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function shortText(text, max = 150) {
  const normalized = cleanText(text).replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function translateReason(reason) {
  const value = String(reason || "").trim();
  const compact = value.replace(/\s+/g, " ").trim();

  if (!value) return "진행 상태를 확인 중입니다.";
  if (compact === "analyze complete") return "요청 분석이 완료되어 계획 단계로 이동했습니다.";
  if (compact === "plan complete") return "계획이 완료되어 구현 단계로 이동했습니다.";
  if (compact === "all quality gates passed") return "품질 게이트(build/test/lint)를 모두 통과했습니다.";
  if (compact === "quality gate verification started") return "품질 게이트 검증을 시작했습니다.";
  if (compact === "planning response generation started") return "LLM에 계획안 생성을 요청하고 있습니다.";
  if (compact.includes("implementation actions failed; moving to PATCH strategy")) {
    return "구현 액션에서 실패가 발생해 PATCH 재시도 전략으로 전환합니다.";
  }

  let matched = compact.match(/^implementation proposal generation started \(attempt=(\d+), strategy=([^)]+)\)$/);
  if (matched) {
    return `구현안 생성을 요청 중입니다. (시도 ${Number(matched[1]) + 1}, 전략 ${matched[2]})`;
  }

  matched = compact.match(/^plan-step (\d+)\/(\d+) in-progress: (.+)$/);
  if (matched) {
    return `플랜 단계 ${matched[1]}/${matched[2]} 진행 중: ${shortText(matched[3], 100)}`;
  }

  matched = compact.match(/^plan-step (\d+)\/(\d+) completed: (.+)$/);
  if (matched) {
    return `플랜 단계 ${matched[1]}/${matched[2]} 완료: ${shortText(matched[3], 100)}`;
  }

  matched = compact.match(/^plan-step (\d+)\/(\d+) failed: (.+)$/);
  if (matched) {
    return `플랜 단계 ${matched[1]}/${matched[2]} 실패: ${shortText(matched[3], 100)}`;
  }

  matched = compact.match(/^implementation attempt (\d+)$/);
  if (matched) {
    return `구현 시도 ${Number(matched[1]) + 1} 결과를 검증 단계로 전달했습니다.`;
  }

  matched = compact.match(/^implementation attempt (\d+) action failures$/);
  if (matched) {
    return `구현 시도 ${Number(matched[1]) + 1}에서 액션 실패가 발생했습니다.`;
  }

  matched = compact.match(/^implementation action execution started \((\d+) action(?:s)?\)$/);
  if (matched) {
    return `구현 액션 ${matched[1]}개를 순서대로 실행하고 있습니다.`;
  }

  matched = compact.match(/^action (\d+)\/(\d+) started: ([a-z_]+)$/);
  if (matched) {
    return `액션 ${matched[1]}/${matched[2]} 시작: ${actionTypeKo(matched[3])}`;
  }

  matched = compact.match(/^action (\d+)\/(\d+) completed: (.+)$/);
  if (matched) {
    const rawDetail = matched[3].trim();
    const detail =
      rawDetail === "file written"
        ? "파일 작성 완료"
        : rawDetail === "dry-run file write simulated"
          ? "드라이런 파일 작성 시뮬레이션 완료"
          : shortText(rawDetail, 120);
    return `액션 ${matched[1]}/${matched[2]} 완료: ${detail}`;
  }

  matched = compact.match(/^action (\d+)\/(\d+) failed: (.+)$/);
  if (matched) {
    return `액션 ${matched[1]}/${matched[2]} 실패: ${shortText(matched[3], 120)}`;
  }

  matched = compact.match(/^verify gate (\d+)\/(\d+) started: ([a-zA-Z0-9_-]+)$/);
  if (matched) {
    return `검증 ${matched[1]}/${matched[2]} 시작: ${matched[3]} 게이트`;
  }

  matched = compact.match(/^verify gate (\d+)\/(\d+) (passed|failed): ([a-zA-Z0-9_-]+)$/);
  if (matched) {
    const status = matched[3] === "passed" ? "통과" : "실패";
    return `검증 ${matched[1]}/${matched[2]} ${status}: ${matched[4]} 게이트`;
  }

  matched = compact.match(/^patch retry #(\d+) \(([^)]+)\)$/);
  if (matched) {
    return `패치 재시도 ${matched[1]}회를 시작합니다. (전략: ${matched[2]})`;
  }

  matched = compact.match(/^verify failed \(([^)]+)\), retry patch$/);
  if (matched) {
    return `검증 실패(${matched[1]})로 패치 재시도를 진행합니다.`;
  }

  matched = compact.match(/^verify failed \(([^)]+)\), strategy switched to (.+)$/);
  if (matched) {
    return `검증 실패(${matched[1]})로 전략을 ${matched[2]}(으)로 전환했습니다.`;
  }

  matched = compact.match(/^retry-guidance: (.+)$/);
  if (matched) {
    return `재시도 가이드: ${shortText(matched[1], 150)}`;
  }

  if (value.startsWith("runtime error:")) {
    return `런타임 오류: ${shortText(value.replace("runtime error:", "").trim())}`;
  }
  if (value.startsWith("FAIL_WITH_ARTIFACT:")) {
    const payload = value.replace("FAIL_WITH_ARTIFACT:", "").trim();
    const [main, ...causeParts] = payload.split("; cause=");
    if (causeParts.length > 0) {
      return `실패로 종료되었습니다: ${shortText(main)} (원인: ${shortText(causeParts.join("; cause="), 120)})`;
    }
    return `실패로 종료되었습니다: ${shortText(payload)}`;
  }

  return value;
}

function formatRelative(iso, nowTick) {
  if (!iso) return "-";
  const diff = Math.max(0, Math.floor((nowTick - new Date(iso).getTime()) / 1000));
  if (diff < 2) return "방금 전";
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  return `${Math.floor(diff / 3600)}시간 전`;
}

function summarizeLive(run, events, nowTick) {
  if (!run) {
    return {
      currentStage: "IDLE",
      title: "대기 중",
      summary: "Run 시작을 기다리고 있습니다.",
      updatedText: "-"
    };
  }

  const latest = events[events.length - 1];
  const currentStage = run.currentState || latest?.state || "ANALYZE";
  const title = `현재 단계: ${currentStage}`;
  const summary = latest ? translateReason(latest.reason) : translateReason(run.currentSummary);
  const updatedText = formatRelative(run.updatedAt || latest?.timestamp || run.createdAt, nowTick);

  return { currentStage, title, summary, updatedText };
}

function normalizeActionDetail(rawDetail) {
  const text = String(rawDetail || "").trim();
  if (!text) return "";
  if (text === "file written") return "파일 작성 완료";
  if (text === "dry-run file write simulated") return "드라이런 파일 작성 시뮬레이션 완료";
  return shortText(text, 80);
}

function buildActionProgress(events) {
  let attempt = 0;
  let block = null;

  for (const event of events) {
    const reason = String(event.reason || "");
    const compact = reason.replace(/\s+/g, " ").trim();
    const startMatch = compact.match(/^implementation action execution started \((\d+) action(?:s)?\)$/);
    if (startMatch) {
      attempt += 1;
      const total = Number(startMatch[1]);
      block = {
        attempt,
        total,
        cards: Array.from({ length: total }, (_, index) => ({
          id: index + 1,
          title: `액션 ${index + 1}`,
          status: "pending",
          detail: "대기 중"
        }))
      };
      continue;
    }

    if (!block) continue;

    let matched = compact.match(/^action (\d+)\/(\d+) started: ([a-z_]+)$/);
    if (matched) {
      const card = block.cards[Number(matched[1]) - 1];
      if (card) {
        card.status = "running";
        card.detail = `${actionTypeKo(matched[3])} 실행 중`;
      }
      continue;
    }

    matched = compact.match(/^action (\d+)\/(\d+) completed: (.+)$/);
    if (matched) {
      const card = block.cards[Number(matched[1]) - 1];
      if (card) {
        card.status = "completed";
        card.detail = normalizeActionDetail(matched[3]);
      }
      continue;
    }

    matched = compact.match(/^action (\d+)\/(\d+) failed: (.+)$/);
    if (matched) {
      const card = block.cards[Number(matched[1]) - 1];
      if (card) {
        card.status = "failed";
        card.detail = shortText(matched[3], 80);
      }
    }
  }

  return block;
}

function buildVerifyProgress(events) {
  let cycle = 0;
  let block = null;

  for (const event of events) {
    const reason = String(event.reason || "");
    const compact = reason.replace(/\s+/g, " ").trim();

    const actionFailureMatch = compact.match(/^implementation attempt (\d+) action failures$/);
    if (actionFailureMatch) {
      cycle += 1;
      block = {
        cycle,
        cards: [
          {
            id: 1,
            title: "implement-actions",
            status: "failed",
            detail: "구현 액션 실패로 검증 게이트 실행 전 중단"
          }
        ]
      };
      continue;
    }

    if (compact === "quality gate verification started") {
      cycle += 1;
      block = {
        cycle,
        cards: []
      };
      continue;
    }

    if (!block) continue;

    let matched = compact.match(/^verify gate (\d+)\/(\d+) started: ([a-zA-Z0-9_-]+)$/);
    if (matched) {
      const index = Number(matched[1]) - 1;
      if (!block.cards[index]) {
        block.cards[index] = {
          id: index + 1,
          title: matched[3],
          status: "running",
          detail: "검증 중"
        };
      } else {
        block.cards[index].status = "running";
        block.cards[index].detail = "검증 중";
      }
      continue;
    }

    matched = compact.match(/^verify gate (\d+)\/(\d+) (passed|failed): ([a-zA-Z0-9_-]+)$/);
    if (matched) {
      const index = Number(matched[1]) - 1;
      const passed = matched[3] === "passed";
      if (!block.cards[index]) {
        block.cards[index] = {
          id: index + 1,
          title: matched[4],
          status: passed ? "completed" : "failed",
          detail: passed ? "통과" : "실패"
        };
      } else {
        block.cards[index].status = passed ? "completed" : "failed";
        block.cards[index].detail = passed ? "통과" : "실패";
      }
    }
  }

  if (!block) {
    return null;
  }

  block.cards = block.cards.filter(Boolean);
  return block;
}

function translateFailureCode(code) {
  if (code === "INLINE_NODE_EVAL_SYNTAX") return "인라인 node -e 구문 오류";
  if (code === "ALLOWLIST_BLOCKED") return "allowlist 차단";
  if (code === "PORT_IN_USE") return "포트 충돌";
  if (code === "VERIFY_SCRIPTS_MISSING") return "검증 스크립트 누락";
  if (code === "PNPM_SCRIPT_MISSING") return "pnpm 스크립트 누락";
  if (code === "PATCH_TARGET_NOT_FOUND") return "패치 대상 미일치";
  if (!code) return "-";
  return code;
}

function buildPlanProgress(planSteps, events, runStatus) {
  if (!Array.isArray(planSteps) || planSteps.length === 0) {
    return null;
  }

  let cards = planSteps.map((step, index) => ({
    id: index + 1,
    title: String(step || `단계 ${index + 1}`),
    status: "pending"
  }));

  let currentIndex = -1;

  const resetCards = () => {
    cards = planSteps.map((step, index) => ({
      id: index + 1,
      title: String(step || `단계 ${index + 1}`),
      status: "pending"
    }));
    currentIndex = -1;
  };

  for (const event of events) {
    const compact = String(event.reason || "").replace(/\s+/g, " ").trim();

    if (/^implementation proposal generation started \(attempt=\d+, strategy=/.test(compact)) {
      resetCards();
      continue;
    }

    let matched = compact.match(/^plan-step (\d+)\/(\d+) in-progress: (.+)$/);
    if (matched) {
      const idx = Math.min(Math.max(Number(matched[1]) - 1, 0), cards.length - 1);
      currentIndex = idx;
      for (let i = 0; i < cards.length; i += 1) {
        if (i < idx) {
          cards[i].status = "completed";
        } else if (i === idx) {
          cards[i].status = "running";
        } else if (cards[i].status !== "failed") {
          cards[i].status = "pending";
        }
      }
      continue;
    }

    matched = compact.match(/^plan-step (\d+)\/(\d+) completed: (.+)$/);
    if (matched) {
      const idx = Math.min(Math.max(Number(matched[1]) - 1, 0), cards.length - 1);
      currentIndex = idx;
      cards[idx].status = "completed";
      continue;
    }

    matched = compact.match(/^plan-step (\d+)\/(\d+) failed: (.+)$/);
    if (matched) {
      const idx = Math.min(Math.max(Number(matched[1]) - 1, 0), cards.length - 1);
      currentIndex = idx;
      cards[idx].status = "failed";
      continue;
    }

    if (compact === "all quality gates passed") {
      currentIndex = cards.length - 1;
      for (const card of cards) {
        card.status = "completed";
      }
    }
  }

  if (runStatus === "finished") {
    for (const card of cards) {
      card.status = "completed";
    }
  } else if (runStatus === "failed" && currentIndex >= 0) {
    cards[currentIndex].status = "failed";
  }

  return {
    cards,
    currentIndex
  };
}

function planStepStatusLabel(status) {
  if (status === "completed") return "완료";
  if (status === "running") return "진행 중";
  if (status === "failed") return "실패";
  return "대기";
}

function cardStatusClass(status) {
  if (status === "completed") return "done";
  if (status === "failed") return "fail";
  if (status === "running") return "running";
  return "";
}

function ontologyNodeTypeColor(type) {
  const colors = {
    route: "#2563eb",
    "ui-action": "#0f766e",
    api: "#0891b2",
    "gateway-handler": "#7c3aed",
    controller: "#4f46e5",
    service: "#9333ea",
    "data-contract": "#f59e0b",
    "data-query": "#ea580c",
    "data-table": "#b45309",
    "data-store": "#dc2626",
    "cache-key": "#be123c",
    "async-channel": "#db2777",
    "eai-interface": "#c026d3",
    "control-guard": "#65a30d",
    "decision-path": "#84cc16",
    "knowledge-cluster": "#475569",
    "retrieval-unit": "#334155",
    path: "#64748b"
  };
  return colors[type] || "#64748b";
}

function ontologyStatusColor(status) {
  if (status === "validated") return "#166534";
  if (status === "candidate") return "#b45309";
  if (status === "contested") return "#b91c1c";
  if (status === "deprecated") return "#6b7280";
  if (status === "stale") return "#92400e";
  return "#475569";
}

function pickDefaultOntologyNodeId(ontology) {
  if (!ontology?.selectedProjection) {
    return "";
  }
  return (
    ontology.selectedProjection.highlightedNodeIds?.[0] ||
    ontology.selectedProjection.representativePaths?.[0]?.nodeIds?.[0] ||
    ontology.selectedProjection.nodes?.[0]?.id ||
    ""
  );
}

async function getJson(url, init) {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {})
    }
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || "non-json response" };
  }

  if (!response.ok) {
    throw new Error(payload.error || `request failed (${response.status})`);
  }

  return payload;
}

export default function HomePage() {
  const [task, setTask] = useState("Node.js로 Hello World 프로젝트를 생성하고 실행 스크립트를 추가해줘.");
  const [projects, setProjects] = useState([]);
  const [presets, setPresets] = useState([]);
  const [presetLoading, setPresetLoading] = useState(false);
  const [presetError, setPresetError] = useState("");
  const [domainPacks, setDomainPacks] = useState([]);
  const [domainPackLoading, setDomainPackLoading] = useState(false);
  const [domainPackError, setDomainPackError] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectMessage, setProjectMessage] = useState("");
  const [projectError, setProjectError] = useState("");
  const [llmSettings, setLlmSettings] = useState(null);
  const [llmSettingsLoading, setLlmSettingsLoading] = useState(false);
  const [selectedLlmModelId, setSelectedLlmModelId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presetSummary, setPresetSummary] = useState("");
  const [presetFactsText, setPresetFactsText] = useState("");
  const [presetDomainPackIds, setPresetDomainPackIds] = useState([]);
  const [presetWorkspaceRules, setPresetWorkspaceRules] = useState("");
  const [presetProjectNameRules, setPresetProjectNameRules] = useState("");
  const [presetRequiredPaths, setPresetRequiredPaths] = useState("");
  const [presetEaiEnabled, setPresetEaiEnabled] = useState(false);
  const [presetEaiAsOfDate, setPresetEaiAsOfDate] = useState("");
  const [presetEaiServiceIncludes, setPresetEaiServiceIncludes] = useState("");
  const [presetEaiOverridesFile, setPresetEaiOverridesFile] = useState("");
  const [selectedDomainPackId, setSelectedDomainPackId] = useState("");
  const [domainPackName, setDomainPackName] = useState("");
  const [domainPackDescription, setDomainPackDescription] = useState("");
  const [domainPackFamiliesText, setDomainPackFamiliesText] = useState("");
  const [domainPackEnabledByDefault, setDomainPackEnabledByDefault] = useState(true);
  const [domainPackCapabilitiesJson, setDomainPackCapabilitiesJson] = useState("[]");
  const [domainPackRankingPriorsJson, setDomainPackRankingPriorsJson] = useState("[]");
  const [domainPackExemplarsJson, setDomainPackExemplarsJson] = useState("[]");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState(20);
  const [searchResult, setSearchResult] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedSearchHit, setSelectedSearchHit] = useState(null);
  const [selectedFileDetail, setSelectedFileDetail] = useState(null);
  const [selectedFileLoading, setSelectedFileLoading] = useState(false);
  const [selectedFileError, setSelectedFileError] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [ontologyViewData, setOntologyViewData] = useState(null);
  const [ontologyViewLoading, setOntologyViewLoading] = useState(false);
  const [ontologyViewError, setOntologyViewError] = useState("");
  const [ontologyProjectionId, setOntologyProjectionId] = useState("projection:front-back-flow");
  const [ontologyNodeTypeFilter, setOntologyNodeTypeFilter] = useState("all");
  const [ontologyFocusMode, setOntologyFocusMode] = useState("path");
  const [ontologySearchInput, setOntologySearchInput] = useState("");
  const [ontologyAppliedSearch, setOntologyAppliedSearch] = useState("");
  const [ontologySelectedPathId, setOntologySelectedPathId] = useState("");
  const [ontologySelectedComponentId, setOntologySelectedComponentId] = useState("");
  const [ontologySelectedNodeId, setOntologySelectedNodeId] = useState("");
  const [askQuestion, setAskQuestion] = useState("");
  const [askMaxAttempts, setAskMaxAttempts] = useState(3);
  const [askDeterministicOnly, setAskDeterministicOnly] = useState(false);
  const [askLoading, setAskLoading] = useState(false);
  const [askResult, setAskResult] = useState(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [ontologyInputKind, setOntologyInputKind] = useState("note");
  const [ontologyInputScope, setOntologyInputScope] = useState("general");
  const [ontologyInputTitle, setOntologyInputTitle] = useState("");
  const [ontologyInputMessage, setOntologyInputMessage] = useState("");
  const [ontologyInputTagsText, setOntologyInputTagsText] = useState("");
  const [ontologyInputPositiveText, setOntologyInputPositiveText] = useState("");
  const [ontologyInputNegativeText, setOntologyInputNegativeText] = useState("");
  const [ontologyInputBoundaryText, setOntologyInputBoundaryText] = useState("");
  const [ontologyInputNodeIdsText, setOntologyInputNodeIdsText] = useState("");
  const [ontologyInputEdgeIdsText, setOntologyInputEdgeIdsText] = useState("");
  const [ontologyInputPathIdsText, setOntologyInputPathIdsText] = useState("");
  const [ontologyInputKnowledgeIdsText, setOntologyInputKnowledgeIdsText] = useState("");
  const [ontologyInputCsvText, setOntologyInputCsvText] = useState("");
  const [ontologyInputNotes, setOntologyInputNotes] = useState("");
  const [ontologyInputLoading, setOntologyInputLoading] = useState(false);
  const [ontologyInputMessageText, setOntologyInputMessageText] = useState("");
  const [ontologyDraftData, setOntologyDraftData] = useState(null);
  const [ontologyDraftLoading, setOntologyDraftLoading] = useState(false);
  const [ontologyDraftMessage, setOntologyDraftMessage] = useState("");
  const [ontologyDraftOpKind, setOntologyDraftOpKind] = useState("override-node");
  const [ontologyDraftNodeType, setOntologyDraftNodeType] = useState("service");
  const [ontologyDraftEdgeType, setOntologyDraftEdgeType] = useState("calls");
  const [ontologyDraftTargetId, setOntologyDraftTargetId] = useState("");
  const [ontologyDraftNodeId, setOntologyDraftNodeId] = useState("");
  const [ontologyDraftEdgeId, setOntologyDraftEdgeId] = useState("");
  const [ontologyDraftFromId, setOntologyDraftFromId] = useState("");
  const [ontologyDraftToId, setOntologyDraftToId] = useState("");
  const [ontologyDraftLabel, setOntologyDraftLabel] = useState("");
  const [ontologyDraftSummaryText, setOntologyDraftSummaryText] = useState("");
  const [ontologyDraftStatus, setOntologyDraftStatus] = useState("candidate");
  const [ontologyDraftDomainsText, setOntologyDraftDomainsText] = useState("");
  const [ontologyDraftChannelsText, setOntologyDraftChannelsText] = useState("");
  const [ontologyDraftActionsText, setOntologyDraftActionsText] = useState("");
  const [ontologyDraftModuleRolesText, setOntologyDraftModuleRolesText] = useState("");
  const [ontologyDraftProcessRolesText, setOntologyDraftProcessRolesText] = useState("");
  const [ontologyDraftNotes, setOntologyDraftNotes] = useState("");
  const [ontologyDraftOperations, setOntologyDraftOperations] = useState([]);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayResult, setReplayResult] = useState(null);
  const [debugEvents, setDebugEvents] = useState([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [workspaceDir, setWorkspaceDir] = useState("");
  const [linkedWorkspaceDirsText, setLinkedWorkspaceDirsText] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectQueryMode, setProjectQueryMode] = useState("query_then_search");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerData, setPickerData] = useState(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [mode, setMode] = useState("feature");
  const [dryRun, setDryRun] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  const [runId, setRunId] = useState("");
  const [run, setRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [error, setError] = useState("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) || null,
    [presets, selectedPresetId]
  );
  const selectedDomainPack = useMemo(
    () => domainPacks.find((domainPack) => domainPack.id === selectedDomainPackId) || null,
    [domainPacks, selectedDomainPackId]
  );
  const done = useMemo(() => {
    const status = run?.status;
    return status === "finished" || status === "failed";
  }, [run?.status]);

  const transitionStates = useMemo(
    () => new Set(events.filter((event) => event.kind === "transition").map((event) => event.state)),
    [events]
  );

  const live = useMemo(() => summarizeLive(run, events, nowTick), [run, events, nowTick]);
  const planProgress = useMemo(
    () => buildPlanProgress(run?.report?.planSteps || [], events, run?.status),
    [run?.report?.planSteps, events, run?.status]
  );
  const actionProgress = useMemo(() => buildActionProgress(events), [events]);
  const verifyProgress = useMemo(() => buildVerifyProgress(events), [events]);
  const latestDebugEvent = useMemo(
    () => (debugEvents.length > 0 ? debugEvents[debugEvents.length - 1] : null),
    [debugEvents]
  );
  const ontologyViewer = ontologyViewData?.ontology || null;
  const ontologySelectedProjection = ontologyViewer?.selectedProjection || null;
  const ontologySelectedNode = useMemo(
    () =>
      ontologySelectedProjection?.nodes?.find((node) => node.id === ontologySelectedNodeId) ||
      ontologySelectedProjection?.nodes?.[0] ||
      null,
    [ontologySelectedNodeId, ontologySelectedProjection]
  );
  const ontologyAdjacentEdges = useMemo(() => {
    if (!ontologySelectedProjection || !ontologySelectedNode) {
      return [];
    }
    return (ontologySelectedProjection.edges || []).filter(
      (edge) => edge.fromId === ontologySelectedNode.id || edge.toId === ontologySelectedNode.id
    );
  }, [ontologySelectedNode, ontologySelectedProjection]);
  const ontologyRenderableGraph = useMemo(
    () =>
      buildOntologyRenderableGraph({
        nodes: ontologySelectedProjection?.nodes || [],
        edges: ontologySelectedProjection?.edges || [],
        representativePaths: ontologySelectedProjection?.representativePaths || [],
        selectedPathId: ontologySelectedPathId,
        focusMode: ontologyFocusMode
      }),
    [
      ontologyFocusMode,
      ontologySelectedPathId,
      ontologySelectedProjection?.edges,
      ontologySelectedProjection?.nodes,
      ontologySelectedProjection?.representativePaths
    ]
  );
  const ontologySvgLayout = ontologyRenderableGraph.layout;
  const runBusy = Boolean(runId) && (run?.status === "running" || run?.status === "waiting");
  const activeOps = useMemo(() => {
    const items = [];
    if (isStarting) items.push("Run 시작 준비");
    if (indexing) items.push("QMD 색인");
    if (analysisLoading) items.push("LLM 구조 분석");
    if (searchLoading) items.push("프로젝트 검색");
    if (askLoading) items.push("프로젝트 질문 분석");
    if (runBusy) items.push(`Runtime 실행 (${live.currentStage || "ANALYZE"})`);
    return items;
  }, [analysisLoading, askLoading, indexing, isStarting, live.currentStage, runBusy, searchLoading]);
  const projectBusy = analysisLoading || askLoading || searchLoading || indexing;

  async function loadPresets() {
    setPresetLoading(true);
    setPresetError("");
    try {
      const response = await getJson("/api/presets");
      setPresets(response.presets || []);
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : String(e));
    } finally {
      setPresetLoading(false);
    }
  }

  async function loadDomainPacks() {
    setDomainPackLoading(true);
    setDomainPackError("");
    try {
      const response = await getJson("/api/domain-packs");
      setDomainPacks(response.domainPacks || []);
    } catch (e) {
      setDomainPackError(e instanceof Error ? e.message : String(e));
    } finally {
      setDomainPackLoading(false);
    }
  }

  async function loadLlmSettings() {
    setLlmSettingsLoading(true);
    try {
      const response = await getJson("/api/llm/models");
      setLlmSettings(response);
      if (!selectedLlmModelId && response?.defaultModelId) {
        setSelectedLlmModelId(response.defaultModelId);
      }
    } catch {
      setLlmSettings(null);
    } finally {
      setLlmSettingsLoading(false);
    }
  }

  async function loadProjects(keepMessage = false) {
    setProjectLoading(true);
    setProjectError("");
    if (!keepMessage) {
      setProjectMessage("");
    }

    try {
      const response = await getJson("/api/projects");
      const items = response.projects || [];
      setProjects(items);

      if (items.length === 0) {
        setSelectedProjectId("");
        return;
      }

      if (!selectedProjectId || !items.some((project) => project.id === selectedProjectId)) {
        setSelectedProjectId(items[0].id);
      }
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setProjectLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
    void loadLlmSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    setProjectName(selectedProject.name || "");
    setWorkspaceDir(selectedProject.workspaceDir || "");
    setLinkedWorkspaceDirsText((selectedProject.linkedWorkspaceDirs || []).join("\n"));
    setProjectDescription(selectedProject.description || "");
    setSelectedLlmModelId(selectedProject.llm?.modelId || llmSettings?.defaultModelId || "");
    setProjectQueryMode(selectedProject.retrieval?.qmd?.queryMode || "query_then_search");
    setMode(selectedProject.defaultMode || "feature");
    setDryRun(Boolean(selectedProject.defaultDryRun));
    setSearchResult(null);
    setSelectedSearchHit(null);
    setSelectedFileDetail(null);
    setSelectedFileError("");
    setOntologyDraftMessage("");
    setOntologyViewError("");
    setOntologySelectedNodeId("");
    void loadDebugEvents(selectedProject.id);
    void loadOntologyDraft(selectedProject.id, { silent: true });
    void loadOntologyView(selectedProject.id, { silent: true, allowMissing: true });
  }, [selectedProject, llmSettings?.defaultModelId]);

  useEffect(() => {
    if (!selectedProjectId || !projectBusy) {
      return;
    }

    let active = true;
    const poll = async () => {
      if (!active) {
        return;
      }
      await loadDebugEvents(selectedProjectId, { silent: true });
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedProjectId, projectBusy]);

  useEffect(() => {
    if (!selectedPreset) {
      if (!selectedPresetId) {
        setPresetName("");
        setPresetSummary("");
        setPresetFactsText("");
        setPresetDomainPackIds([]);
        setPresetWorkspaceRules("");
        setPresetProjectNameRules("");
        setPresetRequiredPaths("");
        setPresetEaiEnabled(false);
        setPresetEaiAsOfDate("");
        setPresetEaiServiceIncludes("");
        setPresetEaiOverridesFile("");
      }
      return;
    }

    setPresetName(selectedPreset.name || "");
    setPresetSummary(selectedPreset.summary || "");
    setPresetFactsText((selectedPreset.keyFacts || []).join("\n"));
    setPresetDomainPackIds(selectedPreset.domainPackIds || []);
    setPresetWorkspaceRules((selectedPreset.rules?.workspaceIncludes || []).join("\n"));
    setPresetProjectNameRules((selectedPreset.rules?.projectNameIncludes || []).join("\n"));
    setPresetRequiredPaths((selectedPreset.rules?.requiredPaths || []).join("\n"));
    setPresetEaiEnabled(Boolean(selectedPreset.eai?.enabled));
    setPresetEaiAsOfDate(selectedPreset.eai?.asOfDate || "");
    setPresetEaiServiceIncludes((selectedPreset.eai?.servicePathIncludes || []).join("\n"));
    setPresetEaiOverridesFile(selectedPreset.eai?.manualOverridesFile || "");
  }, [selectedPreset, selectedPresetId]);

  useEffect(() => {
    if (!selectedDomainPack) {
      if (!selectedDomainPackId) {
        setDomainPackName("");
        setDomainPackDescription("");
        setDomainPackFamiliesText("");
        setDomainPackEnabledByDefault(true);
        setDomainPackCapabilitiesJson("[]");
        setDomainPackRankingPriorsJson("[]");
        setDomainPackExemplarsJson("[]");
      }
      return;
    }

    setDomainPackName(selectedDomainPack.name || "");
    setDomainPackDescription(selectedDomainPack.description || "");
    setDomainPackFamiliesText((selectedDomainPack.families || []).join("\n"));
    setDomainPackEnabledByDefault(Boolean(selectedDomainPack.enabledByDefault));
    setDomainPackCapabilitiesJson(JSON.stringify(selectedDomainPack.capabilityTags || [], null, 2));
    setDomainPackRankingPriorsJson(JSON.stringify(selectedDomainPack.rankingPriors || [], null, 2));
    setDomainPackExemplarsJson(JSON.stringify(selectedDomainPack.exemplars || [], null, 2));
  }, [selectedDomainPack, selectedDomainPackId]);

  useEffect(() => {
    if (done || !runId) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [done, runId]);

  useEffect(() => {
    if (!runId || done) return;

    let active = true;
    async function poll() {
      try {
        const [runRes, eventsRes] = await Promise.all([
          getJson(`/api/runs/${runId}`),
          getJson(`/api/runs/${runId}/events`)
        ]);

        if (!active) return;
        setRun(runRes);
        setEvents(eventsRes.events || []);

        if (runRes.status === "finished" || runRes.status === "failed") {
          try {
            const artifactsRes = await getJson(`/api/runs/${runId}/artifacts`);
            if (!active) return;
            setArtifacts(artifactsRes.files || []);
          } catch {
            // noop
          }
        }
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [runId, done]);

  async function loadPicker(pathValue) {
    setPickerLoading(true);
    setPickerError("");
    try {
      const query = new URLSearchParams();
      if (pathValue && String(pathValue).trim()) {
        query.set("path", String(pathValue).trim());
      }
      const response = await getJson(`/api/fs/children${query.toString() ? `?${query.toString()}` : ""}`);
      setPickerData(response);
    } catch (e) {
      setPickerError(e instanceof Error ? e.message : String(e));
    } finally {
      setPickerLoading(false);
    }
  }

  async function onOpenPicker() {
    setPickerOpen(true);
    await loadPicker(pickerData?.path || "");
  }

  function parseLines(value) {
    return Array.from(
      new Set(
        String(value || "")
          .split(/\r?\n|,/)
          .map((line) => line.trim())
          .filter(Boolean)
      )
    );
  }

  function parseJsonText(value, label) {
    const raw = String(value || "").trim();
    if (!raw) {
      return [];
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`${label} JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function togglePresetDomainPack(domainPackId) {
    setPresetDomainPackIds((prev) =>
      prev.includes(domainPackId) ? prev.filter((id) => id !== domainPackId) : [...prev, domainPackId]
    );
  }

  async function onSavePreset() {
    if (!presetName.trim()) {
      setPresetError("프리셋 이름을 입력해주세요.");
      return;
    }
    if (!presetSummary.trim()) {
      setPresetError("프리셋 요약을 입력해주세요.");
      return;
    }
    const keyFacts = parseLines(presetFactsText);
    if (keyFacts.length === 0) {
      setPresetError("프리셋 핵심 사실을 최소 1개 입력해주세요.");
      return;
    }

    setPresetLoading(true);
    setPresetError("");
    try {
      const payload = {
        id: selectedPreset?.builtIn ? undefined : selectedPresetId || undefined,
        name: presetName.trim(),
        summary: presetSummary.trim(),
        keyFacts,
        domainPackIds: presetDomainPackIds,
        rules: {
          workspaceIncludes: parseLines(presetWorkspaceRules),
          projectNameIncludes: parseLines(presetProjectNameRules),
          requiredPaths: parseLines(presetRequiredPaths)
        },
        eai: {
          enabled: presetEaiEnabled,
          asOfDate: presetEaiAsOfDate.trim() || undefined,
          servicePathIncludes: parseLines(presetEaiServiceIncludes),
          manualOverridesFile: presetEaiOverridesFile.trim() || undefined
        }
      };
      const response = await getJson("/api/presets", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await loadPresets();
      setSelectedPresetId(response.preset?.id || "");
      setProjectMessage("프리셋이 저장되었습니다.");
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : String(e));
    } finally {
      setPresetLoading(false);
    }
  }

  async function onDeletePreset() {
    if (!selectedPresetId) {
      return;
    }
    if (selectedPreset?.builtIn) {
      setPresetError("내장 프리셋은 삭제할 수 없습니다.");
      return;
    }

    setPresetLoading(true);
    setPresetError("");
    try {
      await getJson(`/api/presets/${selectedPresetId}`, {
        method: "DELETE"
      });
      setSelectedPresetId("");
      await loadPresets();
      setProjectMessage("프리셋이 삭제되었습니다.");
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : String(e));
    } finally {
      setPresetLoading(false);
    }
  }

  async function onSaveDomainPack() {
    if (!domainPackName.trim()) {
      setDomainPackError("도메인 이름을 입력해주세요.");
      return;
    }

    setDomainPackLoading(true);
    setDomainPackError("");
    try {
      const payload = {
        id: selectedDomainPack?.builtIn ? undefined : selectedDomainPackId || undefined,
        name: domainPackName.trim(),
        description: domainPackDescription.trim(),
        families: parseLines(domainPackFamiliesText),
        enabledByDefault: domainPackEnabledByDefault,
        capabilityTags: parseJsonText(domainPackCapabilitiesJson, "capabilityTags"),
        rankingPriors: parseJsonText(domainPackRankingPriorsJson, "rankingPriors"),
        exemplars: parseJsonText(domainPackExemplarsJson, "exemplars")
      };
      const response = await getJson("/api/domain-packs", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await loadDomainPacks();
      setSelectedDomainPackId(response.domainPack?.id || "");
      setProjectMessage("도메인 팩이 저장되었습니다.");
    } catch (e) {
      setDomainPackError(e instanceof Error ? e.message : String(e));
    } finally {
      setDomainPackLoading(false);
    }
  }

  async function onDeleteDomainPack() {
    if (!selectedDomainPackId) {
      return;
    }
    if (selectedDomainPack?.builtIn) {
      setDomainPackError("내장 도메인 팩은 삭제할 수 없습니다.");
      return;
    }

    setDomainPackLoading(true);
    setDomainPackError("");
    try {
      await getJson(`/api/domain-packs/${selectedDomainPackId}`, {
        method: "DELETE"
      });
      setSelectedDomainPackId("");
      await loadDomainPacks();
      setProjectMessage("도메인 팩이 삭제되었습니다.");
    } catch (e) {
      setDomainPackError(e instanceof Error ? e.message : String(e));
    } finally {
      setDomainPackLoading(false);
    }
  }

  async function loadDebugEvents(projectId = selectedProjectId, options = {}) {
    const silent = Boolean(options.silent);
    if (!projectId) {
      setDebugEvents([]);
      return;
    }

    if (!silent) {
      setDebugLoading(true);
    }
    try {
      const response = await getJson(`/api/projects/${projectId}/debug?limit=80`);
      setDebugEvents(response.events || []);
    } catch {
      setDebugEvents([]);
    } finally {
      if (!silent) {
        setDebugLoading(false);
      }
    }
  }

  async function onSaveProject() {
    if (!projectName.trim()) {
      setProjectError("프로젝트 이름을 입력해주세요.");
      return;
    }

    if (!workspaceDir.trim()) {
      setProjectError("워크스페이스 경로를 입력해주세요.");
      return;
    }

    setProjectLoading(true);
    setProjectError("");
    setProjectMessage("");

    try {
      const payload = {
        id: selectedProjectId || undefined,
        name: projectName.trim(),
        workspaceDir: workspaceDir.trim(),
        linkedWorkspaceDirs: parseLines(linkedWorkspaceDirsText),
        description: projectDescription.trim(),
        llm: {
          modelId: selectedLlmModelId || undefined
        },
        defaultMode: mode,
        defaultDryRun: dryRun,
        retrieval: {
          qmd: {
            queryMode: projectQueryMode
          }
        }
      };

      const response = await getJson("/api/projects", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      const savedProjectId = response?.project?.id;
      await loadProjects(true);
      if (savedProjectId) {
        setSelectedProjectId(savedProjectId);
      }
      setProjectMessage("프로젝트 설정이 저장되었습니다.");
      await loadDebugEvents(savedProjectId || selectedProjectId);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setProjectLoading(false);
    }
  }

  async function onDeleteProject() {
    if (!selectedProjectId) {
      return;
    }

    setProjectLoading(true);
    setProjectError("");
    setProjectMessage("");

    try {
      await getJson(`/api/projects/${selectedProjectId}`, {
        method: "DELETE"
      });
      setSearchResult(null);
      setProjectMessage("프로젝트를 삭제했습니다.");
      await loadProjects(true);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setProjectLoading(false);
    }
  }

  async function onWarmupIndex() {
    if (!selectedProjectId) {
      setProjectError("먼저 프로젝트를 선택해주세요.");
      return;
    }

    setIndexing(true);
    setProjectError("");
    setProjectMessage("");

    try {
      const response = await getJson(`/api/projects/${selectedProjectId}/index`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setProjectMessage(
        `인덱싱 완료: files=${response.fileCount}, changed=${response.changedFiles}, provider=${response.selectedProvider}`
      );
      await loadProjects(true);
      await loadDebugEvents();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setIndexing(false);
    }
  }

  async function onAnalyzeProject() {
    if (!selectedProjectId) {
      setProjectError("먼저 프로젝트를 선택해주세요.");
      return;
    }

    setAnalysisLoading(true);
    setProjectError("");
    setProjectMessage("");

    try {
      const response = await getJson(`/api/projects/${selectedProjectId}/analyze`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setAnalysisResult(response);
      await loadOntologyView(selectedProjectId, { silent: true, allowMissing: true });
      setProjectMessage(
        `분석 완료: confidence=${Number(response.confidence || 0).toFixed(2)}, memory=${response.memoryFiles?.length || 0} files`
      );
      await loadProjects(true);
      await loadDebugEvents();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
      setAnalysisResult(null);
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function refreshAnalysisSummary() {
    if (!selectedProjectId) {
      return;
    }
    const response = await getJson(`/api/projects/${selectedProjectId}/analyze`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setAnalysisResult(response);
    await loadOntologyView(selectedProjectId, { silent: true, allowMissing: true });
  }

  async function loadOntologyView(projectId = selectedProjectId, options = {}) {
    if (!projectId) {
      setOntologyViewData(null);
      return;
    }
    if (!options.silent) {
      setOntologyViewLoading(true);
      setOntologyViewError("");
    }
    try {
      const query = new URLSearchParams();
      const projectionId = options.projectionId ?? ontologyProjectionId;
      const nodeType = options.nodeType ?? ontologyNodeTypeFilter;
      const focusMode = options.focusMode ?? ontologyFocusMode;
      const selectedPathId = options.selectedPathId ?? ontologySelectedPathId;
      const selectedComponentId = options.selectedComponentId ?? ontologySelectedComponentId;
      const search = options.search ?? ontologyAppliedSearch;
      if (projectionId) query.set("projectionId", projectionId);
      if (nodeType && nodeType !== "all") query.set("nodeType", nodeType);
      if (focusMode) query.set("focusMode", focusMode);
      if (selectedPathId) query.set("selectedPathId", selectedPathId);
      if (selectedComponentId) query.set("selectedComponentId", selectedComponentId);
      if (search && String(search).trim()) query.set("search", String(search).trim());
      query.set("nodeLimit", String(options.nodeLimit ?? 72));
      query.set("edgeLimit", String(options.edgeLimit ?? 160));

      const response = await getJson(`/api/projects/${projectId}/ontology?${query.toString()}`);
      setOntologyViewData(response);
      setOntologyProjectionId(response?.ontology?.filters?.selectedProjectionId || projectionId || "projection:front-back-flow");
      setOntologyFocusMode(response?.ontology?.filters?.focusMode || focusMode || "path");
      setOntologySelectedPathId(response?.ontology?.filters?.selectedPathId || "");
      setOntologySelectedComponentId(response?.ontology?.filters?.selectedComponentId || "");
      setOntologySelectedNodeId((current) => {
        const nodes = response?.ontology?.selectedProjection?.nodes || [];
        if (current && nodes.some((node) => node.id === current)) {
          return current;
        }
        return pickDefaultOntologyNodeId(response?.ontology);
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (options.allowMissing && message.includes("run analyze first")) {
        setOntologyViewData(null);
        setOntologyViewError("");
      } else {
        setOntologyViewError(message);
      }
    } finally {
      if (!options.silent) {
        setOntologyViewLoading(false);
      }
    }
  }

  async function loadOntologyDraft(projectId = selectedProjectId, options = {}) {
    if (!projectId) {
      setOntologyDraftData(null);
      return;
    }
    if (!options.silent) {
      setOntologyDraftLoading(true);
    }
    try {
      const response = await getJson(`/api/projects/${projectId}/ontology-draft`);
      setOntologyDraftData(response);
      setOntologyDraftOperations(response.draft?.operations || []);
    } catch (e) {
      if (!options.silent) {
        setProjectError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!options.silent) {
        setOntologyDraftLoading(false);
      }
    }
  }

  async function onSearchProject() {
    if (!selectedProjectId) {
      setProjectError("먼저 프로젝트를 선택해주세요.");
      return;
    }

    if (!searchQuery.trim()) {
      setProjectError("검색어를 입력해주세요.");
      return;
    }

    setSearchLoading(true);
    setProjectError("");
    setSelectedSearchHit(null);
    setSelectedFileDetail(null);
    setSelectedFileError("");

    try {
      const response = await getJson(`/api/projects/${selectedProjectId}/search`, {
        method: "POST",
        body: JSON.stringify({
          query: searchQuery.trim(),
          limit: Number(searchLimit) || 20,
          queryMode: projectQueryMode
        })
      });
      setSearchResult(response);
      await loadDebugEvents();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
      setSearchResult(null);
    } finally {
      setSearchLoading(false);
    }
  }

  async function onSelectSearchHit(hit) {
    if (!selectedProjectId || !hit?.path) {
      return;
    }

    setSelectedSearchHit(hit);
    setSelectedFileLoading(true);
    setSelectedFileError("");
    setSelectedFileDetail(null);

    try {
      const query = new URLSearchParams({
        path: String(hit.path)
      });
      const response = await getJson(`/api/projects/${selectedProjectId}/file?${query.toString()}`);
      setSelectedFileDetail(response);
      await loadDebugEvents();
    } catch (e) {
      setSelectedFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setSelectedFileLoading(false);
    }
  }

  async function onAskProject() {
    if (!selectedProjectId) {
      setProjectError("먼저 프로젝트를 선택해주세요.");
      return;
    }

    if (!askQuestion.trim()) {
      setProjectError("질문을 입력해주세요.");
      return;
    }

    setAskLoading(true);
    setProjectError("");
    setProjectMessage("질의 분석/검색/응답 생성 진행 중...");
    setAskResult(null);

    try {
      const response = await getJson(`/api/projects/${selectedProjectId}/ask`, {
        method: "POST",
        body: JSON.stringify({
          question: askQuestion.trim(),
          maxAttempts: Math.max(0, Math.min(Number(askMaxAttempts) || 0, 5)),
          deterministicOnly: askDeterministicOnly
        })
      });
      setAskResult(response);
      setProjectMessage(
        `답변 완료: confidence=${Number(response.confidence || 0).toFixed(2)}, llmCalls=${
          response.diagnostics?.llmCallCount ?? "-"
        }`
      );
      await loadDebugEvents();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
      setProjectMessage("");
    } finally {
      setAskLoading(false);
    }
  }

  async function submitProjectFeedback({
    kind,
    prompt,
    questionType,
    matchedKnowledgeIds,
    matchedRetrievalUnitIds,
    verdict
  }) {
    if (!selectedProjectId) {
      setProjectError("먼저 프로젝트를 선택해주세요.");
      return;
    }
    setFeedbackLoading(true);
    setFeedbackMessage("");
    setProjectError("");
    try {
      const response = await getJson(`/api/projects/${selectedProjectId}/feedback`, {
        method: "POST",
        body: JSON.stringify({
          kind,
          prompt,
          questionType,
          verdict,
          matchedKnowledgeIds,
          matchedRetrievalUnitIds
        })
      });
      setFeedbackMessage(
        `피드백 기록 완료: verdict=${response.artifact?.verdict || verdict}, learnedKnowledgeUpdated=${
          response.learnedKnowledgeUpdated ? "yes" : "no"
        }`
      );
      await refreshAnalysisSummary();
      await loadDebugEvents();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setFeedbackLoading(false);
    }
  }

  async function onSubmitOntologyInput() {
    if (!selectedProjectId) {
      setProjectError("먼저 프로젝트를 선택해주세요.");
      return;
    }
    if (!ontologyInputTitle.trim()) {
      setProjectError("온톨로지 입력 제목을 입력해주세요.");
      return;
    }
    const splitLines = (value) =>
      String(value || "")
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);

    setOntologyInputLoading(true);
    setOntologyInputMessageText("");
    setProjectError("");
    try {
      const response = await getJson(`/api/projects/${selectedProjectId}/ontology-inputs`, {
        method: "POST",
        body: JSON.stringify({
          kind: ontologyInputKind,
          scope: ontologyInputScope,
          title: ontologyInputTitle.trim(),
          message: ontologyInputMessage.trim(),
          tags: splitLines(ontologyInputTagsText),
          positiveExamples: splitLines(ontologyInputPositiveText),
          negativeExamples: splitLines(ontologyInputNegativeText),
          boundaryNotes: splitLines(ontologyInputBoundaryText),
          relatedNodeIds: splitLines(ontologyInputNodeIdsText),
          relatedEdgeIds: splitLines(ontologyInputEdgeIdsText),
          relatedPathIds: splitLines(ontologyInputPathIdsText),
          relatedKnowledgeIds: splitLines(ontologyInputKnowledgeIdsText),
          csvText: ontologyInputKind === "csv" ? ontologyInputCsvText : "",
          notes: ontologyInputNotes.trim()
        })
      });
      setOntologyInputMessageText(
        `온톨로지 입력 저장 완료: total=${response.summary?.totalInputs || 0}, csvRows=${response.summary?.csvRowCount || 0}`
      );
      await refreshAnalysisSummary();
      await loadDebugEvents();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setOntologyInputLoading(false);
    }
  }

  function splitDraftLines(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function resetOntologyDraftForm() {
    setOntologyDraftTargetId("");
    setOntologyDraftNodeId("");
    setOntologyDraftEdgeId("");
    setOntologyDraftFromId("");
    setOntologyDraftToId("");
    setOntologyDraftLabel("");
    setOntologyDraftSummaryText("");
    setOntologyDraftDomainsText("");
    setOntologyDraftChannelsText("");
    setOntologyDraftActionsText("");
    setOntologyDraftModuleRolesText("");
    setOntologyDraftProcessRolesText("");
    setOntologyDraftNotes("");
    setOntologyDraftStatus("candidate");
  }

  function onAddOntologyDraftOperation() {
    const createdAt = new Date().toISOString();
    let operation = null;
    const metadata = {
      domains: splitDraftLines(ontologyDraftDomainsText),
      channels: splitDraftLines(ontologyDraftChannelsText),
      actions: splitDraftLines(ontologyDraftActionsText),
      moduleRoles: splitDraftLines(ontologyDraftModuleRolesText),
      processRoles: splitDraftLines(ontologyDraftProcessRolesText),
      validatedStatus: ontologyDraftStatus
    };
    if (ontologyDraftOpKind === "add-node") {
      if (!ontologyDraftNodeId.trim() || !ontologyDraftLabel.trim()) {
        setProjectError("add-node에는 nodeId와 label이 필요합니다.");
        return;
      }
      operation = {
        id: `draft-node-${ontologyDraftOperations.length + 1}`,
        createdAt,
        kind: "add-node",
        nodeId: ontologyDraftNodeId.trim(),
        nodeType: ontologyDraftNodeType,
        label: ontologyDraftLabel.trim(),
        summary: ontologyDraftSummaryText.trim(),
        metadata,
        notes: ontologyDraftNotes.trim()
      };
    } else if (ontologyDraftOpKind === "remove-node") {
      if (!ontologyDraftTargetId.trim()) {
        setProjectError("remove-node에는 targetId가 필요합니다.");
        return;
      }
      operation = {
        id: `draft-remove-node-${ontologyDraftOperations.length + 1}`,
        createdAt,
        kind: "remove-node",
        targetId: ontologyDraftTargetId.trim(),
        notes: ontologyDraftNotes.trim()
      };
    } else if (ontologyDraftOpKind === "add-edge") {
      if (!ontologyDraftEdgeId.trim() || !ontologyDraftFromId.trim() || !ontologyDraftToId.trim()) {
        setProjectError("add-edge에는 edgeId/fromId/toId가 필요합니다.");
        return;
      }
      operation = {
        id: `draft-edge-${ontologyDraftOperations.length + 1}`,
        createdAt,
        kind: "add-edge",
        edgeId: ontologyDraftEdgeId.trim(),
        edgeType: ontologyDraftEdgeType,
        fromId: ontologyDraftFromId.trim(),
        toId: ontologyDraftToId.trim(),
        label: ontologyDraftLabel.trim(),
        metadata,
        notes: ontologyDraftNotes.trim()
      };
    } else if (ontologyDraftOpKind === "remove-edge") {
      if (!ontologyDraftTargetId.trim()) {
        setProjectError("remove-edge에는 targetId가 필요합니다.");
        return;
      }
      operation = {
        id: `draft-remove-edge-${ontologyDraftOperations.length + 1}`,
        createdAt,
        kind: "remove-edge",
        targetId: ontologyDraftTargetId.trim(),
        notes: ontologyDraftNotes.trim()
      };
    } else if (ontologyDraftOpKind === "override-node") {
      if (!ontologyDraftTargetId.trim()) {
        setProjectError("override-node에는 targetId가 필요합니다.");
        return;
      }
      operation = {
        id: `draft-override-node-${ontologyDraftOperations.length + 1}`,
        createdAt,
        kind: "override-node",
        targetId: ontologyDraftTargetId.trim(),
        label: ontologyDraftLabel.trim() || undefined,
        summary: ontologyDraftSummaryText.trim() || undefined,
        metadata,
        notes: ontologyDraftNotes.trim()
      };
    } else {
      if (!ontologyDraftTargetId.trim()) {
        setProjectError("override-edge에는 targetId가 필요합니다.");
        return;
      }
      operation = {
        id: `draft-override-edge-${ontologyDraftOperations.length + 1}`,
        createdAt,
        kind: "override-edge",
        targetId: ontologyDraftTargetId.trim(),
        label: ontologyDraftLabel.trim() || undefined,
        metadata,
        notes: ontologyDraftNotes.trim()
      };
    }

    setOntologyDraftOperations((current) => [...current, operation]);
    setProjectError("");
    setOntologyDraftMessage(`draft operation 추가: ${operation.kind}`);
    resetOntologyDraftForm();
  }

  function onRemoveOntologyDraftOperation(index) {
    setOntologyDraftOperations((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function onSaveOntologyDraft() {
    if (!selectedProjectId) {
      setProjectError("먼저 프로젝트를 선택해주세요.");
      return;
    }
    setOntologyDraftLoading(true);
    setOntologyDraftMessage("");
    setProjectError("");
    try {
      const response = await getJson(`/api/projects/${selectedProjectId}/ontology-draft`, {
        method: "POST",
        body: JSON.stringify({
          notes: ontologyDraftNotes.trim(),
          operations: ontologyDraftOperations
        })
      });
      setOntologyDraftData(response);
      setOntologyDraftOperations(response.draft?.operations || []);
      setOntologyDraftMessage(`draft 저장 완료: version=${response.draft?.draftVersion || 0}, ops=${response.draft?.summary?.operationCount || 0}`);
      await refreshAnalysisSummary();
      await loadDebugEvents();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setOntologyDraftLoading(false);
    }
  }

  async function onEvaluateOntologyDraft() {
    if (!selectedProjectId) {
      setProjectError("먼저 프로젝트를 선택해주세요.");
      return;
    }
    setOntologyDraftLoading(true);
    setOntologyDraftMessage("");
    setProjectError("");
    try {
      const response = await getJson(`/api/projects/${selectedProjectId}/ontology-draft/evaluate`, {
        method: "POST"
      });
      setOntologyDraftData((current) => ({ ...(current || {}), draft: response.draft, evaluation: response.evaluation }));
      setOntologyDraftMessage(
        `draft 평가 완료: ${response.evaluation?.summary?.recommendation || "-"} / risk=${response.evaluation?.summary?.riskBand || "-"}`
      );
      await refreshAnalysisSummary();
      await loadDebugEvents();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setOntologyDraftLoading(false);
    }
  }

  async function onRevertOntologyDraft() {
    if (!selectedProjectId) {
      setProjectError("먼저 프로젝트를 선택해주세요.");
      return;
    }
    setOntologyDraftLoading(true);
    setOntologyDraftMessage("");
    setProjectError("");
    try {
      const response = await getJson(`/api/projects/${selectedProjectId}/ontology-draft/revert`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setOntologyDraftData(response);
      setOntologyDraftOperations(response.draft?.operations || []);
      setOntologyDraftMessage(`draft 되돌리기 완료: version=${response.draft?.draftVersion || 0}`);
      await refreshAnalysisSummary();
      await loadDebugEvents();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setOntologyDraftLoading(false);
    }
  }

  async function onReplayProject() {
    if (!selectedProjectId) {
      setProjectError("먼저 프로젝트를 선택해주세요.");
      return;
    }
    setReplayLoading(true);
    setReplayResult(null);
    setProjectError("");
    setProjectMessage("replay queue 실행 중...");
    try {
      const response = await getJson(`/api/projects/${selectedProjectId}/replay`, {
        method: "POST",
        body: JSON.stringify({
          limit: 3
        })
      });
      setReplayResult(response);
      setProjectMessage(
        `replay 완료: executed=${response.executedCount || 0}/${response.totalCandidates || 0}`
      );
      await refreshAnalysisSummary();
      await loadDebugEvents();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setReplayLoading(false);
    }
  }

  async function onStartRun() {
    if (!selectedProjectId) {
      setError("프로젝트를 먼저 선택 또는 생성해주세요.");
      return;
    }

    if (!task.trim()) {
      setError("Task를 입력해주세요.");
      return;
    }

    setIsStarting(true);
    setError("");
    setArtifacts([]);
    setEvents([]);
    setRun(null);

    try {
      const created = await getJson(`/api/projects/${selectedProjectId}/runs`, {
        method: "POST",
        body: JSON.stringify({
          task,
          mode,
          dryRun,
          retrieval: {
            qmd: {
              queryMode: projectQueryMode
            }
          }
        })
      });

      setRunId(created.runId);
      setRun({
        runId: created.runId,
        status: created.status || "running",
        createdAt: created.createdAt || new Date().toISOString(),
        updatedAt: created.createdAt || new Date().toISOString(),
        mode,
        workspaceDir: selectedProject?.workspaceDir || workspaceDir.trim() || "(server cwd)",
        currentState: "ANALYZE",
        currentSummary: "run queued"
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsStarting(false);
    }
  }

  const ontologyDraftPanel = selectedProjectId ? (
    <>
      <div className="label" style={{ marginTop: 8 }}>Ontology Draft</div>
      <div className="report-box" style={{ marginTop: 8 }}>
        <div className="report-row"><span>Saved Draft</span><span>{ontologyDraftData?.draft ? `v${ontologyDraftData.draft.draftVersion} · ops=${ontologyDraftData.draft.summary?.operationCount || 0}` : "(none)"}</span></div>
        <div className="report-row"><span>History</span><span>{ontologyDraftData?.history?.length || 0}</span></div>
        <div className="report-row"><span>Last Eval</span><span>{ontologyDraftData?.evaluation ? `${ontologyDraftData.evaluation.summary?.recommendation || "-"} / ${ontologyDraftData.evaluation.summary?.riskBand || "-"}` : "(none)"}</span></div>
        <div className="report-row"><span>Op Kind</span><span><select value={ontologyDraftOpKind} onChange={(e) => setOntologyDraftOpKind(e.target.value)}>
          {['add-node','remove-node','add-edge','remove-edge','override-node','override-edge'].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
        </select></span></div>
        {ontologyDraftOpKind === 'add-node' ? (
          <>
            <div className="label" style={{ marginTop: 8 }}>Node Id / Type</div>
            <input value={ontologyDraftNodeId} onChange={(e) => setOntologyDraftNodeId(e.target.value)} placeholder="node id" />
            <select value={ontologyDraftNodeType} onChange={(e) => setOntologyDraftNodeType(e.target.value)} style={{ marginTop: 8 }}>
              {['module','file','symbol','route','api','controller','service','eai-interface','data-store','data-model','data-query','data-table','cache-key','control-guard','knowledge-cluster','retrieval-unit','knowledge-input','review-target','feedback-record','replay-candidate','path'].map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </>
        ) : null}
        {ontologyDraftOpKind === 'add-edge' ? (
          <>
            <div className="label" style={{ marginTop: 8 }}>Edge Id / Type</div>
            <input value={ontologyDraftEdgeId} onChange={(e) => setOntologyDraftEdgeId(e.target.value)} placeholder="edge id" />
            <select value={ontologyDraftEdgeType} onChange={(e) => setOntologyDraftEdgeType(e.target.value)} style={{ marginTop: 8 }}>
              {['contains','declares','calls','routes-to','maps-to','uses-eai','uses-store','stores-model','maps-to-table','queries-table','uses-cache-key','validates','depends-on','belongs-to-domain','belongs-to-channel','belongs-to-process','supports-module-role','references-entity','references-edge','targets-node','targets-edge','targets-path'].map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <input style={{ marginTop: 8 }} value={ontologyDraftFromId} onChange={(e) => setOntologyDraftFromId(e.target.value)} placeholder="fromId" />
            <input style={{ marginTop: 8 }} value={ontologyDraftToId} onChange={(e) => setOntologyDraftToId(e.target.value)} placeholder="toId" />
          </>
        ) : null}
        {ontologyDraftOpKind === 'remove-node' || ontologyDraftOpKind === 'remove-edge' || ontologyDraftOpKind === 'override-node' || ontologyDraftOpKind === 'override-edge' ? (
          <>
            <div className="label" style={{ marginTop: 8 }}>Target Id</div>
            <input value={ontologyDraftTargetId} onChange={(e) => setOntologyDraftTargetId(e.target.value)} placeholder="existing node/edge id" />
          </>
        ) : null}
        {ontologyDraftOpKind !== 'remove-node' && ontologyDraftOpKind !== 'remove-edge' ? (
          <>
            <div className="label" style={{ marginTop: 8 }}>Label / Summary</div>
            <input value={ontologyDraftLabel} onChange={(e) => setOntologyDraftLabel(e.target.value)} placeholder="label" />
            <textarea rows={2} style={{ marginTop: 8 }} value={ontologyDraftSummaryText} onChange={(e) => setOntologyDraftSummaryText(e.target.value)} placeholder="summary" />
            <div className="label" style={{ marginTop: 8 }}>Status</div>
            <select value={ontologyDraftStatus} onChange={(e) => setOntologyDraftStatus(e.target.value)}>
              {['candidate','validated','derived','stale','contested','deprecated'].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <div className="label" style={{ marginTop: 8 }}>Domains / Channels / Actions / Roles (one per line)</div>
            <textarea rows={2} value={ontologyDraftDomainsText} onChange={(e) => setOntologyDraftDomainsText(e.target.value)} placeholder="domains" />
            <textarea rows={2} style={{ marginTop: 8 }} value={ontologyDraftChannelsText} onChange={(e) => setOntologyDraftChannelsText(e.target.value)} placeholder="channels" />
            <textarea rows={2} style={{ marginTop: 8 }} value={ontologyDraftActionsText} onChange={(e) => setOntologyDraftActionsText(e.target.value)} placeholder="actions" />
            <textarea rows={2} style={{ marginTop: 8 }} value={ontologyDraftModuleRolesText} onChange={(e) => setOntologyDraftModuleRolesText(e.target.value)} placeholder="module roles" />
            <textarea rows={2} style={{ marginTop: 8 }} value={ontologyDraftProcessRolesText} onChange={(e) => setOntologyDraftProcessRolesText(e.target.value)} placeholder="process roles" />
          </>
        ) : null}
        <div className="label" style={{ marginTop: 8 }}>Notes</div>
        <textarea rows={2} value={ontologyDraftNotes} onChange={(e) => setOntologyDraftNotes(e.target.value)} placeholder="draft notes" />
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={onAddOntologyDraftOperation} disabled={!selectedProjectId || ontologyDraftLoading}>operation 추가</button>
          <button type="button" className="secondary" onClick={onSaveOntologyDraft} disabled={!selectedProjectId || ontologyDraftLoading || ontologyDraftOperations.length === 0}>{ontologyDraftLoading ? '처리 중' : 'draft 저장'}</button>
          <button type="button" className="secondary" onClick={onEvaluateOntologyDraft} disabled={!selectedProjectId || ontologyDraftLoading || !ontologyDraftData?.draft}>평가</button>
          <button type="button" className="secondary" onClick={onRevertOntologyDraft} disabled={!selectedProjectId || ontologyDraftLoading || !ontologyDraftData?.draft}>되돌리기</button>
        </div>
        <div className="label" style={{ marginTop: 8 }}>Current Operations</div>
        {(ontologyDraftOperations || []).length === 0 ? <div className="hint">(none)</div> : (
          <ul className="bullet-list compact">
            {ontologyDraftOperations.map((operation, index) => (
              <li key={operation.id || `${operation.kind}-${index}`}>
                <strong>{operation.kind}</strong>{' '}
                <span>{operation.targetId || operation.nodeId || operation.edgeId || '-'}</span>{' '}
                <button type="button" className="link-button" onClick={() => onRemoveOntologyDraftOperation(index)}>제거</button>
              </li>
            ))}
          </ul>
        )}
        {ontologyDraftData?.evaluation ? (
          <div className="hint" style={{ marginTop: 8 }}>
            {`recommendation=${ontologyDraftData.evaluation.summary?.recommendation || '-'} · risk=${ontologyDraftData.evaluation.summary?.riskBand || '-'} · affected=${ontologyDraftData.evaluation.metrics?.affectedArtifactCount || 0} · regressed=${ontologyDraftData.evaluation.metrics?.regressedArtifactCount || 0}`}
          </div>
        ) : null}
        {ontologyDraftMessage ? <div className="hint" style={{ marginTop: 8 }}>{ontologyDraftMessage}</div> : null}
      </div>
    </>
  ) : null;

  const ontologyInputPanel = selectedProjectId ? (
    <>
      <div className="label" style={{ marginTop: 8 }}>Ontology Input</div>
      <div className="report-box" style={{ marginTop: 8 }}>
        <div className="report-row">
          <span>Kind</span>
          <span>
            <select value={ontologyInputKind} onChange={(e) => setOntologyInputKind(e.target.value)}>
              <option value="note">note</option>
              <option value="structured">structured</option>
              <option value="csv">csv</option>
            </select>
          </span>
        </div>
        <div className="report-row">
          <span>Scope</span>
          <span>
            <select value={ontologyInputScope} onChange={(e) => setOntologyInputScope(e.target.value)}>
              {["general", "domain", "subdomain", "channel", "action", "module-role", "process-role", "boundary", "path"].map((scope) => (
                <option key={scope} value={scope}>{scope}</option>
              ))}
            </select>
          </span>
        </div>
        <div className="label" style={{ marginTop: 8 }}>Title</div>
        <input value={ontologyInputTitle} onChange={(e) => setOntologyInputTitle(e.target.value)} placeholder="예: 모니모 회원인증" />
        <div className="label" style={{ marginTop: 8 }}>Message</div>
        <textarea rows={3} value={ontologyInputMessage} onChange={(e) => setOntologyInputMessage(e.target.value)} placeholder="자유 메모 / 설명" />
        <div className="label" style={{ marginTop: 8 }}>Tags (one per line)</div>
        <textarea rows={3} value={ontologyInputTagsText} onChange={(e) => setOntologyInputTagsText(e.target.value)} placeholder={"channel:monimo\ndomain:member-auth\naction:register"} />
        <div className="label" style={{ marginTop: 8 }}>Positive Examples</div>
        <textarea rows={2} value={ontologyInputPositiveText} onChange={(e) => setOntologyInputPositiveText(e.target.value)} placeholder={"/monimo/registe\nEmbededMemberLoginController"} />
        <div className="label" style={{ marginTop: 8 }}>Negative Examples / Boundary Notes</div>
        <textarea rows={2} value={ontologyInputNegativeText} onChange={(e) => setOntologyInputNegativeText(e.target.value)} placeholder="관련 없는 예시" />
        <textarea rows={2} value={ontologyInputBoundaryText} onChange={(e) => setOntologyInputBoundaryText(e.target.value)} placeholder="경계/제외 규칙" style={{ marginTop: 8 }} />
        <div className="label" style={{ marginTop: 8 }}>Related Node IDs</div>
        <textarea rows={2} value={ontologyInputNodeIdsText} onChange={(e) => setOntologyInputNodeIdsText(e.target.value)} placeholder="controller:RegisteUseDcpChnelController.registe" />
        <div className="label" style={{ marginTop: 8 }}>Related Edge IDs</div>
        <textarea rows={2} value={ontologyInputEdgeIdsText} onChange={(e) => setOntologyInputEdgeIdsText(e.target.value)} placeholder="edge:route-api" />
        <div className="label" style={{ marginTop: 8 }}>Related Path IDs / Knowledge IDs</div>
        <textarea rows={2} value={ontologyInputPathIdsText} onChange={(e) => setOntologyInputPathIdsText(e.target.value)} placeholder="path ids" />
        <textarea rows={2} value={ontologyInputKnowledgeIdsText} onChange={(e) => setOntologyInputKnowledgeIdsText(e.target.value)} placeholder="knowledge ids" style={{ marginTop: 8 }} />
        {ontologyInputKind === "csv" ? (
          <>
            <div className="label" style={{ marginTop: 8 }}>CSV Text</div>
            <textarea rows={6} value={ontologyInputCsvText} onChange={(e) => setOntologyInputCsvText(e.target.value)} placeholder={"screen,api\nMDP-MYCER999999M,/monimo/registe"} />
          </>
        ) : null}
        <div className="label" style={{ marginTop: 8 }}>Notes</div>
        <textarea rows={2} value={ontologyInputNotes} onChange={(e) => setOntologyInputNotes(e.target.value)} placeholder="추가 메모" />
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={onSubmitOntologyInput} disabled={!selectedProjectId || ontologyInputLoading}>
            {ontologyInputLoading ? "저장 중" : "온톨로지 입력 저장"}
          </button>
        </div>
        {ontologyInputMessageText ? <div className="hint" style={{ marginTop: 8 }}>{ontologyInputMessageText}</div> : null}
      </div>
    </>
  ) : null;

  const ontologyViewerPanel = selectedProjectId ? (
    <>
      <div className="label" style={{ marginTop: 8 }}>Ontology Graph Viewer</div>
      <div className="report-box" style={{ marginTop: 8 }}>
        <div className="toolbar" style={{ marginTop: 0, alignItems: "center" }}>
          <select
            value={ontologyProjectionId}
            onChange={(e) => {
              const value = e.target.value;
              setOntologyProjectionId(value);
              setOntologySelectedPathId("");
              setOntologySelectedComponentId("");
              setOntologySelectedNodeId("");
              void loadOntologyView(selectedProjectId, {
                projectionId: value,
                nodeType: ontologyNodeTypeFilter,
                focusMode: ontologyFocusMode,
                selectedPathId: "",
                selectedComponentId: "",
                search: ontologyAppliedSearch
              });
            }}
            disabled={!selectedProjectId || ontologyViewLoading}
            style={{ minWidth: 220 }}
          >
            {((ontologyViewer?.projections || []).length > 0 ? ontologyViewer.projections : [
              { id: "projection:front-back-flow", title: "Front to Back Flow", type: "front-back-flow" }
            ]).map((projection) => (
              <option key={projection.id} value={projection.id}>
                {projection.title} · {projection.type}
              </option>
            ))}
          </select>
          <select
            value={ontologyNodeTypeFilter}
            onChange={(e) => {
              const value = e.target.value;
              setOntologyNodeTypeFilter(value);
              setOntologySelectedNodeId("");
              void loadOntologyView(selectedProjectId, {
                projectionId: ontologyProjectionId,
                nodeType: value,
                focusMode: ontologyFocusMode,
                selectedPathId: ontologySelectedPathId,
                selectedComponentId: ontologySelectedComponentId,
                search: ontologyAppliedSearch
              });
            }}
            disabled={!selectedProjectId || ontologyViewLoading}
            style={{ minWidth: 160 }}
          >
            <option value="all">all node types</option>
            {(ontologySelectedProjection?.availableNodeTypes || []).map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select
            value={ontologyFocusMode}
            onChange={(e) => {
              const value = e.target.value;
              setOntologyFocusMode(value);
              setOntologySelectedNodeId("");
              if (value !== "path") {
                setOntologySelectedPathId("");
              }
              if (value !== "component") {
                setOntologySelectedComponentId("");
              }
              void loadOntologyView(selectedProjectId, {
                projectionId: ontologyProjectionId,
                nodeType: ontologyNodeTypeFilter,
                focusMode: value,
                selectedPathId: value === "path" ? ontologySelectedPathId : "",
                selectedComponentId: value === "component" ? ontologySelectedComponentId : "",
                search: ontologyAppliedSearch
              });
            }}
            disabled={!selectedProjectId || ontologyViewLoading}
            style={{ minWidth: 170 }}
          >
            <option value="path">대표 path 중심</option>
            <option value="component">구조 컴포넌트 중심</option>
            <option value="projection">전체 projection</option>
          </select>
          <input
            value={ontologySearchInput}
            onChange={(e) => setOntologySearchInput(e.target.value)}
            placeholder="node / path / action 검색"
            style={{ minWidth: 220, flex: 1 }}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setOntologyAppliedSearch(ontologySearchInput.trim());
              setOntologySelectedNodeId("");
              void loadOntologyView(selectedProjectId, {
                projectionId: ontologyProjectionId,
                nodeType: ontologyNodeTypeFilter,
                focusMode: ontologyFocusMode,
                selectedPathId: ontologySelectedPathId,
                selectedComponentId: ontologySelectedComponentId,
                search: ontologySearchInput.trim()
              });
            }}
            disabled={!selectedProjectId || ontologyViewLoading}
          >
            적용
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setOntologySearchInput("");
              setOntologyAppliedSearch("");
              setOntologyNodeTypeFilter("all");
              setOntologySelectedNodeId("");
              void loadOntologyView(selectedProjectId, {
                projectionId: ontologyProjectionId,
                nodeType: "all",
                focusMode: ontologyFocusMode,
                selectedPathId: ontologyFocusMode === "path" ? ontologySelectedPathId : "",
                selectedComponentId: ontologyFocusMode === "component" ? ontologySelectedComponentId : "",
                search: ""
              });
            }}
            disabled={!selectedProjectId || ontologyViewLoading}
          >
            필터 초기화
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void loadOntologyView(selectedProjectId, {
              projectionId: ontologyProjectionId,
              nodeType: ontologyNodeTypeFilter,
              focusMode: ontologyFocusMode,
              selectedPathId: ontologySelectedPathId,
              selectedComponentId: ontologySelectedComponentId,
              search: ontologyAppliedSearch
            })}
            disabled={!selectedProjectId || ontologyViewLoading}
          >
            {ontologyViewLoading ? "불러오는 중" : "새로고침"}
          </button>
          <a
            href={selectedProjectId ? `/ontology/${selectedProjectId}` : "#"}
            className="secondary"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              textDecoration: "none",
              minHeight: 44,
              padding: "0 14px",
              borderRadius: 10,
              pointerEvents: selectedProjectId ? "auto" : "none",
              opacity: selectedProjectId ? 1 : 0.5
            }}
          >
            전체화면 보기
          </a>
        </div>

        <div className="hint" style={{ marginTop: 8 }}>
          현재 ontology는 LLM 구조분석 시 메모리에 materialize되고, 동시에 filesystem artifact로 저장된다.
          source={ontologyViewer?.storage?.kind || "filesystem-artifacts"} · graph=
          {ontologyViewer?.storage?.graphSnapshotPath || "-"}
        </div>
        {ontologyViewError ? <div className="error" style={{ marginTop: 8 }}>{ontologyViewError}</div> : null}

        {ontologyViewer ? (
          <>
            <div className="status-grid" style={{ marginTop: 10 }}>
              <div className="status-box">
                <div className="k">Projection</div>
                <div className="v">{ontologySelectedProjection?.title || "-"}</div>
              </div>
              <div className="status-box">
                <div className="k">Visible Nodes</div>
                <div className="v">
                  {ontologySelectedProjection?.nodes?.length ?? 0}/{ontologySelectedProjection?.filteredNodeCount ?? 0}
                </div>
              </div>
              <div className="status-box">
                <div className="k">Visible Edges</div>
                <div className="v">
                  {ontologySelectedProjection?.edges?.length ?? 0}/{ontologySelectedProjection?.filteredEdgeCount ?? 0}
                </div>
              </div>
              <div className="status-box">
                <div className="k">Representative Paths</div>
                <div className="v">{ontologySelectedProjection?.representativePaths?.length ?? 0}</div>
              </div>
              <div className="status-box">
                <div className="k">Hidden</div>
                <div className="v">
                  n={ontologySelectedProjection?.hiddenNodeCount ?? 0} / e={ontologySelectedProjection?.hiddenEdgeCount ?? 0}
                </div>
              </div>
              <div className="status-box">
                <div className="k">Generated</div>
                <div className="v">{ontologyViewer.generatedAt || "-"}</div>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                border: "1px solid #d7dde7",
                borderRadius: 12,
                overflow: "auto",
                background: "#f8fafc"
              }}
            >
              <svg
                viewBox={`0 0 ${ontologySvgLayout.width} ${ontologySvgLayout.height}`}
                style={{ width: "100%", minHeight: 320, display: "block" }}
              >
                <defs>
                  <pattern id="ontology-grid-main" width="24" height="24" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="2" r="1.1" fill="#dbe4f0" />
                  </pattern>
                  <marker id="ontology-arrow-main" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
                  </marker>
                </defs>
                <rect x="0" y="0" width={ontologySvgLayout.width} height={ontologySvgLayout.height} fill="#f8fafc" />
                <rect x="0" y="0" width={ontologySvgLayout.width} height={ontologySvgLayout.height} fill="url(#ontology-grid-main)" opacity="0.7" />
                {ontologySvgLayout.mode === "path" ? (
                  <>
                    <line
                      x1="72"
                      y1={430}
                      x2={ontologySvgLayout.width - 72}
                      y2={430}
                      stroke="#cbd5e1"
                      strokeDasharray="7 10"
                      strokeWidth={2}
                    />
                    <text x="74" y="404" fontSize="11" fill="#64748b">
                      canonical path spine
                    </text>
                  </>
                ) : null}
                {(ontologySvgLayout.lanes || []).map((lane) => (
                  <g key={`lane:${lane.key}`}>
                    <line
                      x1={lane.x}
                      y1={26}
                      x2={lane.x}
                      y2={ontologySvgLayout.height - 22}
                      stroke="#e2e8f0"
                      strokeDasharray="4 8"
                      strokeWidth={1}
                    />
                    <text x={lane.x} y={18} textAnchor="middle" fontSize="12" fill="#64748b">
                      {lane.label}
                    </text>
                  </g>
                ))}
                {ontologyRenderableGraph.edges.map((edge) => {
                  const from = ontologySvgLayout.positions[edge.fromId];
                  const to = ontologySvgLayout.positions[edge.toId];
                  if (!from || !to) return null;
                  const selected =
                    ontologySelectedNode &&
                    (edge.fromId === ontologySelectedNode.id || edge.toId === ontologySelectedNode.id);
                  const isSpineEdge =
                    ontologySvgLayout.pathNodeIds?.has(edge.fromId) && ontologySvgLayout.pathNodeIds?.has(edge.toId);
                  return (
                    <path
                      key={edge.id}
                      d={buildOntologyEdgePath(edge, ontologySvgLayout)}
                      fill="none"
                      stroke={selected ? "#0f172a" : isSpineEdge ? "#334155" : edge.isHighlighted ? "#64748b" : "#cbd5e1"}
                      strokeWidth={selected ? 2.4 : isSpineEdge ? 2 : edge.isHighlighted ? 1.7 : 1.15}
                      opacity={selected ? 0.95 : isSpineEdge ? 0.92 : edge.isHighlighted ? 0.8 : 0.62}
                      markerEnd="url(#ontology-arrow-main)"
                    />
                  );
                })}
                {ontologyRenderableGraph.nodes.map((node) => {
                  const position = ontologySvgLayout.positions[node.id];
                  if (!position) return null;
                  const selected = ontologySelectedNode?.id === node.id;
                  const onSpine = ontologySvgLayout.pathNodeIds?.has(node.id);
                  const fill = ontologyNodeTypeColor(node.type);
                  const stroke = selected ? "#0f172a" : onSpine ? "#334155" : node.isHighlighted ? "#1e293b" : "#cbd5e1";
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${position.x}, ${position.y})`}
                      onClick={() => setOntologySelectedNodeId(node.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <circle r={selected ? 21 : onSpine ? 18 : 15} fill={fill} opacity={node.isHighlighted ? 0.95 : 0.84} stroke={stroke} strokeWidth={selected ? 3 : onSpine ? 2.1 : 1.4} />
                      <rect x={-66} y={selected ? 24 : 22} width="132" height="22" rx="10" fill="rgba(248,250,252,0.96)" stroke={selected ? "#94a3b8" : "#dbe4f0"} />
                      <text x="0" y={selected ? 39 : 37} textAnchor="middle" fontSize="11.5" fill="#0f172a">
                        {shortText(node.label, 24)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="status-grid" style={{ marginTop: 12, alignItems: "stretch" }}>
              <div className="status-box" style={{ minHeight: 220 }}>
                <div className="k">Representative Paths</div>
                <ul className="artifacts" style={{ maxHeight: 210, marginTop: 8 }}>
                  {(ontologySelectedProjection?.representativePaths || []).length === 0 ? (
                    <li><span>대표 path 없음</span><span>-</span></li>
                  ) : (
                    ontologySelectedProjection.representativePaths.map((path, index) => (
                      <li key={`${path.id}-${index}`} title={`${path.nodeIds.join(" -> ")}`}>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setOntologyFocusMode("path");
                            setOntologySelectedPathId(path.id);
                            setOntologySelectedComponentId("");
                            setOntologySelectedNodeId(path.nodeIds[0] || "");
                            void loadOntologyView(selectedProjectId, {
                              projectionId: ontologyProjectionId,
                              nodeType: ontologyNodeTypeFilter,
                              focusMode: "path",
                              selectedPathId: path.id,
                              selectedComponentId: "",
                              search: ontologyAppliedSearch
                            });
                          }}
                          style={{
                            width: "100%",
                            justifyContent: "space-between",
                            display: "inline-flex",
                            alignItems: "center",
                            textAlign: "left",
                            background: ontologySelectedPathId === path.id ? "rgba(99,102,241,0.12)" : undefined,
                            borderColor: ontologySelectedPathId === path.id ? "#6366f1" : undefined
                          }}
                        >
                          <span>{shortText(path.label, 48)}</span>
                          <span>{path.nodeIds.length}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div className="status-box" style={{ minHeight: 220 }}>
                <div className="k">Components</div>
                <ul className="artifacts" style={{ maxHeight: 210, marginTop: 8 }}>
                  {(ontologySelectedProjection?.components || []).length === 0 ? (
                    <li><span>component 없음</span><span>-</span></li>
                  ) : (
                    ontologySelectedProjection.components.map((component) => (
                      <li key={component.id} title={component.label}>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setOntologyFocusMode("component");
                            setOntologySelectedComponentId(component.id);
                            setOntologySelectedNodeId("");
                            void loadOntologyView(selectedProjectId, {
                              projectionId: ontologyProjectionId,
                              nodeType: ontologyNodeTypeFilter,
                              focusMode: "component",
                              selectedPathId: "",
                              selectedComponentId: component.id,
                              search: ontologyAppliedSearch
                            });
                          }}
                          style={{
                            width: "100%",
                            justifyContent: "space-between",
                            display: "inline-flex",
                            alignItems: "center",
                            textAlign: "left",
                            background: ontologySelectedComponentId === component.id ? "rgba(14,165,233,0.12)" : undefined,
                            borderColor: ontologySelectedComponentId === component.id ? "#0ea5e9" : undefined
                          }}
                        >
                          <span>{shortText(component.label, 48)}</span>
                          <span>{component.nodeCount}/{component.edgeCount}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div className="status-box" style={{ minHeight: 220 }}>
                <div className="k">Selected Node</div>
                {ontologySelectedNode ? (
                  <>
                    <div className="hint" style={{ marginTop: 8 }}>
                      {ontologySelectedNode.id}
                    </div>
                    <div className="report-box" style={{ marginTop: 8 }}>
                      <div className="report-row">
                        <span>type / status</span>
                        <span>
                          <span style={{ color: ontologyNodeTypeColor(ontologySelectedNode.type) }}>{ontologySelectedNode.type}</span>
                          {" · "}
                          <span style={{ color: ontologyStatusColor(ontologySelectedNode.status) }}>{ontologySelectedNode.status}</span>
                        </span>
                      </div>
                      <div className="report-row">
                        <span>confidence / degree</span>
                        <span>{Number(ontologySelectedNode.confidence || 0).toFixed(2)} · {ontologySelectedNode.degree}</span>
                      </div>
                      <div className="report-row">
                        <span>summary</span>
                        <span>{shortText(ontologySelectedNode.summary || "-", 120)}</span>
                      </div>
                      <div className="report-row">
                        <span>domains</span>
                        <span>{(ontologySelectedNode.domains || []).join(", ") || "-"}</span>
                      </div>
                      <div className="report-row">
                        <span>channels / actions</span>
                        <span>{[...(ontologySelectedNode.channels || []), ...(ontologySelectedNode.actions || [])].join(", ") || "-"}</span>
                      </div>
                    </div>
                    {(ontologySelectedNode.attributePreview || []).length > 0 ? (
                      <ul className="artifacts" style={{ maxHeight: 140, marginTop: 8 }}>
                        {ontologySelectedNode.attributePreview.map((entry) => (
                          <li key={`${ontologySelectedNode.id}:${entry.key}`}>
                            <span>{entry.key}</span>
                            <span>{shortText(entry.value, 48)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <div className="hint" style={{ marginTop: 8 }}>노드를 선택하면 상세를 표시한다.</div>
                )}
              </div>
            </div>

            <div className="status-grid" style={{ marginTop: 12, alignItems: "stretch" }}>
              <div className="status-box" style={{ minHeight: 220 }}>
                <div className="k">Visible Nodes</div>
                <ul className="artifacts" style={{ maxHeight: 220, marginTop: 8 }}>
                  {(ontologySelectedProjection?.nodes || []).map((node) => (
                    <li
                      key={node.id}
                      title={node.id}
                      onClick={() => setOntologySelectedNodeId(node.id)}
                      style={{ cursor: "pointer", background: ontologySelectedNode?.id === node.id ? "#eef2ff" : "transparent" }}
                    >
                      <span>
                        {shortText(node.label, 34)} · {node.type}
                      </span>
                      <span style={{ color: ontologyStatusColor(node.status) }}>{node.status}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="status-box" style={{ minHeight: 220 }}>
                <div className="k">Visible Edges</div>
                <ul className="artifacts" style={{ maxHeight: 220, marginTop: 8 }}>
                  {(ontologySelectedProjection?.edges || []).length === 0 ? (
                    <li><span>edge 없음</span><span>-</span></li>
                  ) : (
                    ontologySelectedProjection.edges.map((edge) => (
                      <li key={edge.id} title={`${edge.fromId} -> ${edge.toId}`}>
                        <span>{shortText(edge.type, 18)} · {shortText(edge.label || `${edge.fromId} -> ${edge.toId}`, 44)}</span>
                        <span style={{ color: ontologyStatusColor(edge.status) }}>{edge.status}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>

            {ontologyAdjacentEdges.length > 0 ? (
              <>
                <div className="label" style={{ marginTop: 12 }}>Selected Node Adjacency</div>
                <ul className="artifacts" style={{ maxHeight: 180, marginTop: 8 }}>
                  {ontologyAdjacentEdges.map((edge) => (
                    <li key={`adj-${edge.id}`} title={`${edge.fromId} -> ${edge.toId}`}>
                      <span>{shortText(edge.type, 18)} · {shortText(edge.fromId, 28)} → {shortText(edge.toId, 28)}</span>
                      <span>{Number(edge.confidence || 0).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : (
          <div className="hint" style={{ marginTop: 8 }}>
            아직 ontology viewer data가 없다. 구조분석을 먼저 실행하거나 새로고침해라.
          </div>
        )}
      </div>
    </>
  ) : null;

  return (
    <main className="page">
      <div className="wrap">
        <section className="hero">
          <h1>ohmyqwen Runtime Console</h1>
          <p>현재 단계와 수행 내용이 한국어로 실시간 표시됩니다.</p>
        </section>

        <section className={`ops-banner ${activeOps.length > 0 ? "active" : "idle"}`}>
          <div className="ops-main">
            <span className={`ops-dot ${activeOps.length > 0 ? "active" : "idle"}`} />
            <strong>{activeOps.length > 0 ? "작업 진행 중" : "대기 중"}</strong>
            {activeOps.length > 0 ? <span className="ops-count">{activeOps.length}개</span> : null}
          </div>
          {activeOps.length > 0 ? (
            <div className="ops-chip-list">
              {activeOps.map((op) => (
                <span key={op} className="ops-chip">
                  {op}
                </span>
              ))}
            </div>
          ) : (
            <div className="ops-meta">현재 백그라운드 작업이 없습니다.</div>
          )}
          <div className="ops-meta">
            {latestDebugEvent
              ? `[${latestDebugEvent.stage}/${latestDebugEvent.status}] ${shortText(
                  latestDebugEvent.message,
                  140
                )} · ${latestDebugEvent.timestamp}`
              : runBusy
                ? shortText(live.summary, 140)
                : "최근 작업 로그 없음"}
          </div>
        </section>

        <section className="grid">
          <div className="card">
            <h3>프로젝트 관리 / Run 생성</h3>
            <div className="label">프로젝트 선택</div>
            <div className="workspace-row">
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                disabled={projectLoading}
              >
                <option value="">(프로젝트 선택)</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {project.workspaceDir}
                  </option>
                ))}
              </select>
              <button type="button" className="secondary" onClick={() => loadProjects(true)} disabled={projectLoading}>
                새로고침
              </button>
            </div>

            <div className="label" style={{ marginTop: 10 }}>프로젝트 이름</div>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="예: ohmyqwen-core"
            />

            <div className="label" style={{ marginTop: 10 }}>Workspace 경로</div>
            <div className="workspace-row">
              <input
                value={workspaceDir}
                onChange={(e) => setWorkspaceDir(e.target.value)}
                placeholder="/Users/jules/Desktop/work/ohmyqwen"
              />
              <button type="button" className="secondary" onClick={onOpenPicker}>
                폴더 선택
              </button>
            </div>

            <div className="label" style={{ marginTop: 10 }}>연결 Workspace 경로(선택, 줄바꿈 구분)</div>
            <textarea
              value={linkedWorkspaceDirsText}
              onChange={(e) => setLinkedWorkspaceDirsText(e.target.value)}
              placeholder={"/Users/jules/Desktop/work/untitle/dcp/dcp-front-develop"}
            />
            <div className="hint">프론트/보조 저장소를 줄바꿈으로 추가하면 analyze 시 함께 연결 그래프를 만듭니다.</div>

            <div className="label" style={{ marginTop: 10 }}>설명(선택)</div>
            <input
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="프로젝트 메모"
            />

            <div className="hint" style={{ marginTop: 10 }}>프로젝트 설정은 온톨로지/경로 기반으로 동작합니다. 프리셋/도메인 팩은 코어 분석 경로에서 사용하지 않습니다.</div>

            <div className="label" style={{ marginTop: 10 }}>LLM 모델</div>
            <select
              value={selectedLlmModelId}
              onChange={(e) => setSelectedLlmModelId(e.target.value)}
              disabled={llmSettingsLoading}
            >
              {(llmSettings?.models || []).length === 0 ? (
                <option value="">(모델 정보 로딩 실패)</option>
              ) : null}
              {(llmSettings?.models || []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label || model.id} · ctx={model.contextWindowTokens} · out={model.maxOutputTokens}
                </option>
              ))}
            </select>

            <div className="label" style={{ marginTop: 10 }}>QMD Query Mode</div>
            <select value={projectQueryMode} onChange={(e) => setProjectQueryMode(e.target.value)}>
              {QUERY_MODES.map((queryMode) => (
                <option key={queryMode} value={queryMode}>
                  {queryMode}
                </option>
              ))}
            </select>

            <div className="hint">
              권장: 정확도 우선은 <code>query_then_search</code> 입니다.
            </div>

            <div className="label">Task</div>
            <textarea value={task} onChange={(e) => setTask(e.target.value)} />

            {pickerOpen ? (
              <div className="picker-box">
                <div className="picker-head">
                  <div className="picker-path">{pickerData?.path || workspaceDir || "(경로 불러오는 중)"}</div>
                  <div className="picker-head-actions">
                    <button
                      type="button"
                      className="tiny secondary"
                      onClick={() => loadPicker(pickerData?.home || "")}
                    >
                      Home
                    </button>
                    <button
                      type="button"
                      className="tiny secondary"
                      onClick={() => loadPicker(pickerData?.cwd || "")}
                    >
                      CWD
                    </button>
                    <button type="button" className="tiny secondary" onClick={() => setPickerOpen(false)}>
                      닫기
                    </button>
                  </div>
                </div>

                {pickerError ? <div className="error">{pickerError}</div> : null}
                <div className="picker-list">
                  {pickerLoading ? (
                    <div className="hint">폴더 목록을 불러오는 중...</div>
                  ) : (
                    <>
                      {pickerData?.parent ? (
                        <button
                          type="button"
                          className="picker-item"
                          onClick={() => loadPicker(pickerData.parent)}
                        >
                          ⬆ 상위 폴더
                        </button>
                      ) : null}

                      {(pickerData?.entries || []).map((entry) => (
                        <button
                          type="button"
                          key={entry.path}
                          className="picker-item"
                          onClick={() => loadPicker(entry.path)}
                        >
                          📁 {entry.name}
                        </button>
                      ))}

                      {(pickerData?.entries || []).length === 0 ? (
                        <div className="hint">하위 폴더가 없습니다.</div>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="picker-foot">
                  <button
                    type="button"
                    onClick={() => {
                      if (pickerData?.path) {
                        setWorkspaceDir(pickerData.path);
                      }
                      setPickerOpen(false);
                    }}
                  >
                    이 폴더 사용
                  </button>
                </div>
              </div>
            ) : null}

            <div className="action-row">
              <button type="button" className="secondary" onClick={onSaveProject} disabled={projectLoading}>
                {selectedProjectId ? "프로젝트 저장" : "프로젝트 생성"}
              </button>
              <button type="button" className="secondary" onClick={onDeleteProject} disabled={!selectedProjectId || projectLoading}>
                프로젝트 삭제
              </button>
              <button type="button" className="secondary" onClick={onWarmupIndex} disabled={!selectedProjectId || indexing}>
                {indexing ? "색인 중..." : "QMD 색인"}
              </button>
              <button type="button" className="secondary" onClick={onAnalyzeProject} disabled={!selectedProjectId || analysisLoading}>
                {analysisLoading ? "분석 중..." : "LLM 구조 분석"}
              </button>
            </div>

            <div className="label" style={{ marginTop: 10 }}>프로젝트 검색</div>
            <div className="search-row">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="예: state machine transition logic"
              />
              <input
                value={searchLimit}
                onChange={(e) => setSearchLimit(e.target.value)}
                type="number"
                min="1"
                max="200"
              />
              <button type="button" onClick={onSearchProject} disabled={searchLoading || !selectedProjectId}>
                {searchLoading ? "검색 중..." : "검색"}
              </button>
            </div>

            {searchResult ? (
              <div className="search-result-box">
                <div className="hint">
                  provider={searchResult.provider}, fallback={searchResult.fallbackUsed ? "yes" : "no"}
                  {searchResult.modeUsed ? `, mode=${searchResult.modeUsed}` : ""}
                </div>
                <div className="hint" style={{ marginTop: 4 }}>
                  questionType={searchResult.diagnostics?.questionType || "-"}
                  {(searchResult.diagnostics?.matchedLearnedKnowledgeIds || []).length > 0
                    ? ` · matchedKnowledge=${searchResult.diagnostics.matchedLearnedKnowledgeIds.join(",")}`
                    : ""}
                </div>
                <div className="action-row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="tiny secondary"
                    disabled={feedbackLoading}
                    onClick={() =>
                      submitProjectFeedback({
                        kind: "search",
                        prompt: searchResult.query,
                        questionType: searchResult.diagnostics?.questionType || "domain_capability_overview",
                        matchedKnowledgeIds: searchResult.diagnostics?.matchedLearnedKnowledgeIds || [],
                        matchedRetrievalUnitIds: searchResult.diagnostics?.matchedRetrievalUnitIds || [],
                        verdict: "correct"
                      })
                    }
                  >
                    검색 정답
                  </button>
                  <button
                    type="button"
                    className="tiny secondary"
                    disabled={feedbackLoading}
                    onClick={() =>
                      submitProjectFeedback({
                        kind: "search",
                        prompt: searchResult.query,
                        questionType: searchResult.diagnostics?.questionType || "domain_capability_overview",
                        matchedKnowledgeIds: searchResult.diagnostics?.matchedLearnedKnowledgeIds || [],
                        matchedRetrievalUnitIds: searchResult.diagnostics?.matchedRetrievalUnitIds || [],
                        verdict: "partial"
                      })
                    }
                  >
                    검색 부분정답
                  </button>
                  <button
                    type="button"
                    className="tiny secondary"
                    disabled={feedbackLoading}
                    onClick={() =>
                      submitProjectFeedback({
                        kind: "search",
                        prompt: searchResult.query,
                        questionType: searchResult.diagnostics?.questionType || "domain_capability_overview",
                        matchedKnowledgeIds: searchResult.diagnostics?.matchedLearnedKnowledgeIds || [],
                        matchedRetrievalUnitIds: searchResult.diagnostics?.matchedRetrievalUnitIds || [],
                        verdict: "incorrect"
                      })
                    }
                  >
                    검색 오답
                  </button>
                </div>
                <ul className="artifacts" style={{ marginTop: 6, maxHeight: 180 }}>
                  {(searchResult.hits || []).length === 0 ? (
                    <li>
                      <span>검색 결과 없음</span>
                      <span>-</span>
                    </li>
                  ) : (
                    searchResult.hits.map((hit, index) => (
                      <li
                        key={`${hit.path}-${index}`}
                        className={`clickable ${selectedSearchHit?.path === hit.path ? "selected" : ""}`}
                        onClick={() => onSelectSearchHit(hit)}
                      >
                        <span title={hit.path}>
                          {shortText(hit.path, 60)}
                          {hit.reasons?.length ? ` · ${shortText(hit.reasons[0], 40)}` : ""}
                        </span>
                        <span>{hit.score?.toFixed ? hit.score.toFixed(2) : hit.score}</span>
                      </li>
                    ))
                  )}
                </ul>

                {selectedSearchHit ? (
                  <div style={{ marginTop: 8 }}>
                    <div className="label">파일 상세: {selectedSearchHit.path}</div>
                    {selectedSearchHit.reasons?.length ? (
                      <ul className="reason-list">
                        {selectedSearchHit.reasons.map((reason, index) => (
                          <li key={`reason-${index}`}>{reason}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="hint">검색 사유가 제공되지 않아 파일 내용을 표시합니다.</div>
                    )}

                    {selectedFileError ? <div className="error">{selectedFileError}</div> : null}
                    {selectedFileLoading ? <div className="hint">파일 내용을 불러오는 중...</div> : null}
                    {selectedFileDetail?.content ? (
                      <>
                        <div className="hint">
                          {selectedFileDetail.path} · {selectedFileDetail.sizeBytes} bytes
                          {selectedFileDetail.truncated ? " (크기 제한으로 일부만 표시)" : ""}
                        </div>
                        <pre className="file-scroll-view">{selectedFileDetail.content}</pre>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {analysisResult ? (
              <div className="search-result-box" style={{ marginTop: 10 }}>
                <div className="label">프로젝트 구조/아키텍처 분석</div>
                <div className="hint">
                  confidence={Number(analysisResult.confidence || 0).toFixed(2)} · analyzedAt={analysisResult.analyzedAt} · llmCalls=
                  {analysisResult.diagnostics?.llmCallCount ?? "-"}
                </div>
                <div className="report-box" style={{ marginTop: 8 }}>
                  <div className="report-row">
                    <span>요약</span>
                    <span>{shortText(analysisResult.summary || "-", 160)}</span>
                  </div>
                  <div className="report-row">
                    <span>메모리 경로</span>
                    <span title={analysisResult.memoryHome}>{shortText(analysisResult.memoryHome || "-", 70)}</span>
                  </div>
                  <div className="report-row">
                    <span>온톨로지 개념</span>
                    <span>
                      {analysisResult.ontologyGraph?.topDomains?.length
                        ? analysisResult.ontologyGraph.topDomains.slice(0, 4).map((item) => item.id).join(", ")
                        : "-"}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>온톨로지 채널</span>
                    <span>
                      {analysisResult.ontologyGraph?.topChannels?.length
                        ? analysisResult.ontologyGraph.topChannels.slice(0, 4).map((item) => item.id).join(", ")
                        : "-"}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>학습 지식 후보</span>
                    <span>
                      {analysisResult.learnedKnowledge?.candidateCount ?? 0}개 · validated=
                      {analysisResult.learnedKnowledge?.validatedCount ?? 0}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>온톨로지 그래프</span>
                    <span>
                      {analysisResult.ontologyGraph
                        ? `nodes=${analysisResult.ontologyGraph.nodeCount}, edges=${analysisResult.ontologyGraph.edgeCount}, feedback=${analysisResult.ontologyGraph.feedbackNodeCount}${analysisResult.ontologyGraph.truncated ? " · compact" : ""}`
                        : "-"}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>온톨로지 프로젝션</span>
                    <span>
                      {analysisResult.ontologyProjections
                        ? `count=${analysisResult.ontologyProjections.projectionCount}, paths=${analysisResult.ontologyProjections.totalRepresentativePathCount}, largest=${analysisResult.ontologyProjections.largestProjectionType || "-"}${analysisResult.ontologyProjections.truncated ? " · compact" : ""}`
                        : "-"}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>온톨로지 드래프트</span>
                    <span>
                      {analysisResult.ontologyDraft
                        ? `v${analysisResult.ontologyDraft.draftVersion}, ops=${analysisResult.ontologyDraft.operationCount}, history=${analysisResult.ontologyDraft.historyCount}${analysisResult.ontologyDraft.isBaseChanged ? " · base-changed" : ""}`
                        : "-"}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>드래프트 평가</span>
                    <span>
                      {analysisResult.ontologyDraftEvaluation
                        ? `${analysisResult.ontologyDraftEvaluation.recommendation}, risk=${analysisResult.ontologyDraftEvaluation.riskBand}, regressed=${analysisResult.ontologyDraftEvaluation.regressedArtifactCount}`
                        : "-"}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>평가 추세</span>
                    <span>
                      {analysisResult.evaluationTrends
                        ? `artifacts=${analysisResult.evaluationTrends.totalArtifacts}, risk=${analysisResult.evaluationTrends.averageQualityRisk}, coverage=${analysisResult.evaluationTrends.averageRetrievalCoverage}`
                        : "-"}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>Replay 큐</span>
                    <span>
                      {analysisResult.evaluationReplay
                        ? `artifacts=${analysisResult.evaluationReplay.totalArtifacts}, queue=${analysisResult.evaluationReplay.replayCandidateCount}, failedAsk=${analysisResult.evaluationReplay.failedAskCount}`
                        : "-"}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>승격 액션</span>
                    <span>
                      {analysisResult.evaluationPromotions
                        ? `total=${analysisResult.evaluationPromotions.totalActions}, promote=${analysisResult.evaluationPromotions.promoteCount}, stale=${analysisResult.evaluationPromotions.staleCount}`
                        : "-"}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>사용자 피드백</span>
                    <span>
                      {analysisResult.userFeedback
                        ? `total=${analysisResult.userFeedback.totalFeedback}, correct=${analysisResult.userFeedback.correctCount}, incorrect=${analysisResult.userFeedback.incorrectCount}`
                        : "-"}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>Replay 실행</span>
                    <span>
                      <button
                        type="button"
                        className="tiny secondary"
                        style={{ width: "auto" }}
                        onClick={onReplayProject}
                        disabled={!selectedProjectId || replayLoading || !(analysisResult.evaluationReplay?.replayCandidateCount > 0)}
                      >
                        {replayLoading ? "실행 중" : "Top 3 replay"}
                      </button>
                    </span>
                  </div>
                  <div className="report-row">
                    <span>연결 Workspace</span>
                    <span>{selectedProject?.linkedWorkspaceDirs?.length ?? 0}개</span>
                  </div>
                  <div className="report-row">
                    <span>EAI 사전</span>
                    <span>{analysisResult.eaiCatalog?.interfaceCount ?? 0} entries</span>
                  </div>
                  <div className="report-row">
                    <span>EAI 기준일</span>
                    <span>{analysisResult.eaiCatalog?.asOfDate || "-"}</span>
                  </div>
                  <div className="report-row">
                    <span>EAI override</span>
                    <span>{analysisResult.eaiCatalog?.manualOverridesApplied ?? 0}</span>
                  </div>
                  <div className="report-row">
                    <span>구조 인덱스</span>
                    <span>
                      files={analysisResult.structureCatalog?.fileCount ?? 0}, methods=
                      {analysisResult.structureCatalog?.methodCount ?? 0}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>Front Catalog</span>
                    <span>
                      screens={analysisResult.frontCatalog?.screenCount ?? 0}, apis=
                      {analysisResult.frontCatalog?.apiCount ?? 0}
                    </span>
                  </div>
                  <div className="report-row">
                    <span>Front→Back Graph</span>
                    <span>links={analysisResult.frontBackGraph?.linkCount ?? 0}</span>
                  </div>
                </div>

                <div className="label" style={{ marginTop: 8 }}>핵심 모듈</div>
                <ul className="artifacts" style={{ maxHeight: 160 }}>
                  {(analysisResult.keyModules || []).length === 0 ? (
                    <li>
                      <span>핵심 모듈 없음</span>
                      <span>-</span>
                    </li>
                  ) : (
                    analysisResult.keyModules.slice(0, 12).map((module, index) => (
                      <li key={`${module.path}-${index}`}>
                        <span title={`${module.path} | ${module.role}`}>
                          {shortText(module.path, 55)} · {shortText(module.role, 24)}
                        </span>
                        <span>{Number(module.confidence || 0).toFixed(2)}</span>
                      </li>
                    ))
                  )}
                </ul>

                {(analysisResult.eaiCatalog?.topInterfaces || []).length > 0 ? (
                  <>
                    <div className="label" style={{ marginTop: 8 }}>EAI Top Interfaces</div>
                    <ul className="artifacts" style={{ maxHeight: 140 }}>
                      {analysisResult.eaiCatalog.topInterfaces.slice(0, 8).map((entry, index) => (
                        <li key={`${entry.interfaceId}-${index}`}>
                          <span title={`${entry.interfaceId} ${entry.interfaceName} ${entry.purpose}`}>
                            {shortText(entry.interfaceId, 24)} · {shortText(entry.interfaceName, 30)}
                          </span>
                          <span>{entry.usagePaths?.length || 0}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {(analysisResult.frontCatalog?.topScreens || []).length > 0 ? (
                  <>
                    <div className="label" style={{ marginTop: 8 }}>Front Top Screens</div>
                    <ul className="artifacts" style={{ maxHeight: 140 }}>
                      {analysisResult.frontCatalog.topScreens.slice(0, 8).map((entry, index) => (
                        <li key={`${entry.filePath}-${index}`}>
                          <span title={`${entry.filePath} | ${entry.routePaths.join(", ")} | ${entry.apiPaths.join(", ")}`}>
                            {shortText(entry.screenCode || entry.filePath, 26)} · {shortText(entry.filePath, 34)}
                          </span>
                          <span>{entry.apiPaths?.length || 0}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {(analysisResult.frontBackGraph?.topLinks || []).length > 0 ? (
                  <>
                    <div className="label" style={{ marginTop: 8 }}>Front→Back Top Links</div>
                    <ul className="artifacts" style={{ maxHeight: 140 }}>
                      {analysisResult.frontBackGraph.topLinks.slice(0, 8).map((entry, index) => (
                        <li key={`${entry.apiUrl}-${index}`}>
                          <span title={`${entry.routePath || entry.screenCode || "-"} | ${entry.apiUrl} -> ${entry.controllerMethod}`}>
                            {shortText(entry.screenCode || entry.routePath || entry.apiUrl, 26)} · {shortText(entry.apiUrl, 28)}
                          </span>
                          <span>{Number(entry.confidence || 0).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {(analysisResult.learnedKnowledge?.topCandidates || []).length > 0 ? (
                  <>
                    <div className="label" style={{ marginTop: 8 }}>
                      Learned Knowledge Candidates
                      {analysisResult.learnedKnowledge
                        ? ` · validated=${analysisResult.learnedKnowledge.validatedCount}/${analysisResult.learnedKnowledge.candidateCount}`
                        : ""}
                    </div>
                    <ul className="artifacts" style={{ maxHeight: 180 }}>
                      {analysisResult.learnedKnowledge.topCandidates.slice(0, 12).map((candidate, index) => (
                        <li key={`${candidate.id}-${index}`}>
                          <span title={`${candidate.id} | ${candidate.kind} | terms=${(candidate.searchTerms || []).join(", ")}`}>
                            {shortText(candidate.label, 24)} · {candidate.kind} · {candidate.status}
                          </span>
                          <span>{candidate.score}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {analysisResult.ontologyGraph ? (
                  <>
                    <div className="label" style={{ marginTop: 8 }}>
                      Ontology Graph
                      {analysisResult.ontologyGraph
                        ? ` · nodes=${analysisResult.ontologyGraph.nodeCount} · edges=${analysisResult.ontologyGraph.edgeCount}`
                        : ""}
                    </div>
                    <ul className="artifacts" style={{ maxHeight: 140 }}>
                      {(analysisResult.ontologyGraph.topDomains || []).slice(0, 8).map((entry, index) => (
                        <li key={`${entry.id}-${index}`}>
                          <span title={`channelTop=${(analysisResult.ontologyGraph.topChannels || []).map((item) => `${item.id}:${item.count}`).join(", ")}`}>
                            {shortText(entry.id, 28)} · ontology-domain
                          </span>
                          <span>{entry.count}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {analysisResult.ontologyProjections ? (
                  <>
                    <div className="label" style={{ marginTop: 8 }}>
                      Ontology Projections
                      {analysisResult.ontologyProjections
                        ? ` · lifecyclePaths=${analysisResult.ontologyProjections.lifecycleProjectionPathCount}`
                        : ""}
                    </div>
                    <ul className="artifacts" style={{ maxHeight: 120 }}>
                      {(analysisResult.ontologyProjections.topProjectionTypes || []).slice(0, 8).map((entry, index) => (
                        <li key={`${entry}-${index}`}>
                          <span>{entry}</span>
                          <span>{analysisResult.ontologyProjections.projectionTypeCounts?.[entry] ?? 0}</span>
                        </li>
                      ))}
                    </ul>
                    {(analysisResult.ontologyProjections.projections || []).length > 0 ? (
                      <ul className="artifacts" style={{ maxHeight: 180, marginTop: 8 }}>
                        {analysisResult.ontologyProjections.projections.slice(0, 12).map((projection) => (
                          <li key={projection.id} title={(projection.samplePaths || []).join(", ") || projection.id}>
                            <span>
                              {shortText(projection.title, 24)} · {projection.type} · nodes={projection.nodeCount} · edges={projection.edgeCount}
                            </span>
                            <span>{projection.pathCount}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}

                {ontologyViewerPanel}

                {analysisResult.ontologyInputs ? (
                  <>
                    <div className="label" style={{ marginTop: 8 }}>
                      Ontology Inputs
                      {` · total=${analysisResult.ontologyInputs.totalInputs} · csvRows=${analysisResult.ontologyInputs.csvRowCount}`}
                    </div>
                    <ul className="artifacts" style={{ maxHeight: 120 }}>
                      {(analysisResult.ontologyInputs.topScopes || []).slice(0, 8).map((entry, index) => (
                        <li key={`${entry.scope}-${index}`}>
                          <span>{entry.scope}</span>
                          <span>{entry.count}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {analysisResult.ontologyReview ? (
                  <>
                    <div className="label" style={{ marginTop: 8 }}>
                      Ontology Review
                      {` · validated=${analysisResult.ontologyReview.validatedCount} · contested=${analysisResult.ontologyReview.contestedCount} · deprecated=${analysisResult.ontologyReview.deprecatedCount}`}
                    </div>
                    <ul className="artifacts" style={{ maxHeight: 140 }}>
                      {(analysisResult.ontologyReview.topTargets || []).slice(0, 8).map((entry, index) => (
                        <li key={`${entry.targetKind}:${entry.targetId}:${index}`}>
                          <span title={`${entry.targetKind}:${entry.targetId}`}>
                            {shortText(entry.targetId, 36)} · {entry.status}
                          </span>
                          <span>{entry.feedbackCount}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {ontologyDraftPanel}
                {ontologyInputPanel}

                {(analysisResult.evaluationTrends?.topQuestionTypes || []).length > 0 ? (
                  <>
                    <div className="label" style={{ marginTop: 8 }}>
                      Evaluation Trends
                      {analysisResult.evaluationTrends
                        ? ` · risk=${analysisResult.evaluationTrends.averageQualityRisk} · coverage=${analysisResult.evaluationTrends.averageRetrievalCoverage}`
                        : ""}
                    </div>
                    <ul className="artifacts" style={{ maxHeight: 180 }}>
                      {analysisResult.evaluationTrends.topQuestionTypes.slice(0, 8).map((entry, index) => (
                        <li key={`${entry.questionType}-${index}`}>
                          <span
                            title={`risk=${entry.averageQualityRisk} | coverage=${entry.averageRetrievalCoverage}`}
                          >
                            {shortText(entry.questionType, 28)} · total={entry.total}
                          </span>
                          <span>{entry.averageQualityRisk}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {(analysisResult.userFeedback?.topQuestionTypes || []).length > 0 ? (
                  <>
                    <div className="label" style={{ marginTop: 8 }}>
                      User Feedback
                      {analysisResult.userFeedback
                        ? ` · total=${analysisResult.userFeedback.totalFeedback} · incorrect=${analysisResult.userFeedback.incorrectCount}`
                        : ""}
                    </div>
                    <ul className="artifacts" style={{ maxHeight: 150 }}>
                      {analysisResult.userFeedback.topQuestionTypes.slice(0, 8).map((entry, index) => (
                        <li key={`${entry.questionType}-${index}`}>
                          <span>{shortText(entry.questionType, 28)}</span>
                          <span>{entry.count}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}

            {!analysisResult ? ontologyViewerPanel : null}
            {!analysisResult ? (<>{ontologyDraftPanel}{ontologyInputPanel}</>) : null}

            <div className="label" style={{ marginTop: 10 }}>프로젝트 Q&A</div>
            {projectBusy && latestDebugEvent ? (
              <div className="hint">
                작업중: [{latestDebugEvent.stage}/{latestDebugEvent.status}]{" "}
                {shortText(latestDebugEvent.message, 120)} · {latestDebugEvent.timestamp}
              </div>
            ) : null}
            <div className="ask-row">
              <input
                value={askQuestion}
                onChange={(e) => setAskQuestion(e.target.value)}
                placeholder='예: 보험금 청구 로직이 어떻게 이루어지는지 확인해줘'
              />
              <input
                type="number"
                min={0}
                max={5}
                value={askMaxAttempts}
                onChange={(e) => setAskMaxAttempts(e.target.value)}
                title="LLM 최대 재시도 횟수"
                style={{ width: 80 }}
              />
              <label className="hint" style={{ whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={askDeterministicOnly}
                  onChange={(e) => setAskDeterministicOnly(e.target.checked)}
                  style={{ width: 14, marginRight: 4 }}
                />
                deterministic only(심볼질문 전용)
              </label>
              <button type="button" onClick={onAskProject} disabled={!selectedProjectId || askLoading}>
                {askLoading ? "응답 생성 중..." : "질문 실행"}
              </button>
            </div>
            {askResult ? (
              <div className="search-result-box">
                <div className="hint">
                  answerConfidence={Number(askResult.confidence || 0).toFixed(2)} · qualityGate=
                  {askResult.qualityGatePassed ? "passed" : "failed"} · attempts={askResult.attempts} · llmCalls=
                  {askResult.diagnostics?.llmCallCount ?? "-"} /{" "}
                  {(askResult.diagnostics?.llmCallBudget ?? 0) <= 0 ? "∞" : askResult.diagnostics?.llmCallBudget}
                  {askResult.diagnostics?.strategyType
                    ? ` · strategy=${askResult.diagnostics.strategyType}(${Number(
                        askResult.diagnostics?.strategyConfidence || 0
                      ).toFixed(2)})`
                    : ""}
                  {(askResult.diagnostics?.scopeModules || []).length > 0
                    ? ` · modules=${askResult.diagnostics.scopeModules.join(",")}`
                    : ""}
                  {(askResult.diagnostics?.matchedOntologyConcepts || []).length > 0
                    ? ` · matchedOntologyConcepts=${askResult.diagnostics.matchedOntologyConcepts.join(",")}`
                    : ""}
                  {(askResult.diagnostics?.matchedLearnedKnowledgeIds || []).length > 0
                    ? ` · matchedKnowledge=${askResult.diagnostics.matchedLearnedKnowledgeIds.join(",")}`
                    : ""}
                  {Number(askResult.diagnostics?.hydratedEvidenceCount || 0) > 0
                    ? ` · hydrated=${askResult.diagnostics.hydratedEvidenceCount}`
                    : ""}
                  {Number(askResult.diagnostics?.frontBackEvidenceUsedCount || 0) > 0
                    ? ` · flowLinks=${askResult.diagnostics.frontBackEvidenceUsedCount}/${askResult.diagnostics.frontBackLinkCount || 0}`
                    : ""}
                  {askResult.diagnostics?.deterministicUsed
                    ? ` · deterministic=${askResult.diagnostics?.deterministicSymbol || "true"}`
                    : ""}
                </div>
                <div className="action-row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="tiny secondary"
                    disabled={feedbackLoading}
                    onClick={() =>
                      submitProjectFeedback({
                        kind: "ask",
                        prompt: askResult.question || askQuestion,
                        questionType: askResult.diagnostics?.questionType || "domain_capability_overview",
                        matchedKnowledgeIds: askResult.diagnostics?.matchedLearnedKnowledgeIds || [],
                        matchedRetrievalUnitIds: askResult.diagnostics?.matchedRetrievalUnitIds || [],
                        verdict: "correct"
                      })
                    }
                  >
                    답변 정답
                  </button>
                  <button
                    type="button"
                    className="tiny secondary"
                    disabled={feedbackLoading}
                    onClick={() =>
                      submitProjectFeedback({
                        kind: "ask",
                        prompt: askResult.question || askQuestion,
                        questionType: askResult.diagnostics?.questionType || "domain_capability_overview",
                        matchedKnowledgeIds: askResult.diagnostics?.matchedLearnedKnowledgeIds || [],
                        matchedRetrievalUnitIds: askResult.diagnostics?.matchedRetrievalUnitIds || [],
                        verdict: "partial"
                      })
                    }
                  >
                    답변 부분정답
                  </button>
                  <button
                    type="button"
                    className="tiny secondary"
                    disabled={feedbackLoading}
                    onClick={() =>
                      submitProjectFeedback({
                        kind: "ask",
                        prompt: askResult.question || askQuestion,
                        questionType: askResult.diagnostics?.questionType || "domain_capability_overview",
                        matchedKnowledgeIds: askResult.diagnostics?.matchedLearnedKnowledgeIds || [],
                        matchedRetrievalUnitIds: askResult.diagnostics?.matchedRetrievalUnitIds || [],
                        verdict: "incorrect"
                      })
                    }
                  >
                    답변 오답
                  </button>
                </div>
                <pre className="file-scroll-view" style={{ maxHeight: 240 }}>{askResult.answer}</pre>
                <div className="label" style={{ marginTop: 8 }}>근거</div>
                <ul className="reason-list">
                  {(askResult.evidence || []).map((line, index) => (
                    <li key={`ask-evidence-${index}`}>{line}</li>
                  ))}
                </ul>
                {(askResult.caveats || []).length > 0 ? (
                  <>
                    <div className="label" style={{ marginTop: 8 }}>주의사항</div>
                    <ul className="reason-list">
                      {(askResult.caveats || []).map((line, index) => (
                        <li key={`ask-caveat-${index}`}>{line}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="search-result-box" style={{ marginTop: 10 }}>
              <div className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>트러블슈팅 로그</span>
                <button
                  type="button"
                  className="tiny secondary"
                  style={{ width: "auto" }}
                  onClick={() => loadDebugEvents()}
                  disabled={!selectedProjectId || debugLoading}
                >
                  {debugLoading ? "갱신 중" : "새로고침"}
                </button>
              </div>
              <div className="hint">{debugLoading ? "로그 갱신 중..." : `events=${debugEvents.length}`}</div>
              <ul className="artifacts" style={{ marginTop: 6, maxHeight: 180 }}>
                {debugEvents.length === 0 ? (
                  <li>
                    <span>로그 없음</span>
                    <span>-</span>
                  </li>
                ) : (
                  debugEvents.map((event, index) => (
                    <li key={`${event.timestamp}-${index}`}>
                      <span title={JSON.stringify(event.metadata || {}, null, 2)}>
                        [{event.stage}/{event.status}] {shortText(event.message, 70)}
                      </span>
                      <span>{event.timestamp}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <div>
                <div className="label">Mode</div>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="auto">auto</option>
                  <option value="feature">feature</option>
                  <option value="refactor">refactor</option>
                  <option value="medium">medium</option>
                  <option value="microservice">microservice</option>
                </select>
              </div>
              <div>
                <div className="label">Dry-run</div>
                <label style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                    style={{ width: 16, marginRight: 6 }}
                  />
                  simulate only
                </label>
              </div>
              <div>
                <button onClick={onStartRun} disabled={isStarting || !selectedProjectId}>
                  {isStarting ? "Starting..." : "Start Run"}
                </button>
              </div>
            </div>

            {projectMessage ? <div className="hint">{projectMessage}</div> : null}
            {feedbackMessage ? <div className="hint">{feedbackMessage}</div> : null}
            {replayResult ? (
              <div className="hint">
                replay executed={replayResult.executedCount || 0}/{replayResult.totalCandidates || 0}
              </div>
            ) : null}
            {projectError ? <div className="error">{projectError}</div> : null}
            {error ? <div className="error">{error}</div> : null}
          </div>

          <div className="card">
            <h3>현재 진행 요약</h3>
            <div className="live-block">
              <div className="live-title">{live.title}</div>
              <div className="live-summary">{live.summary}</div>
              <div className="live-meta">마지막 업데이트: {live.updatedText}</div>
            </div>

            <div className="stage-strip">
              {CORE_STAGES.map((stage) => (
                <span
                  key={stage}
                  className={`stage-pill ${stageClass(stage, live.currentStage, run?.status, transitionStates)}`}
                >
                  {stage}
                </span>
              ))}
            </div>

            <div className="status-grid" style={{ marginTop: 10 }}>
              <div className="status-box">
                <div className="k">Run ID</div>
                <div className="v">{runId || "-"}</div>
              </div>
              <div className="status-box">
                <div className="k">Status</div>
                <div className={`v ${statusClass(run?.status)}`}>{run?.status || "idle"}</div>
              </div>
              <div className="status-box">
                <div className="k">Final State</div>
                <div className="v">{run?.finalState || "-"}</div>
              </div>
              <div className="status-box">
                <div className="k">Mode</div>
                <div className="v">{run?.mode || mode}</div>
              </div>
              <div className="status-box">
                <div className="k">Workspace</div>
                <div className="v">{run?.workspaceDir || workspaceDir || "(server cwd)"}</div>
              </div>
              <div className="status-box">
                <div className="k">Updated</div>
                <div className="v">{run?.updatedAt || "-"}</div>
              </div>
            </div>
            {run?.failReason ? <div className="error">{run.failReason}</div> : null}

            {run?.report ? (
              <div style={{ marginTop: 12 }}>
                <div className="label">완료 보고</div>
                <div className="report-box">
                  <div className="report-row">
                    <span>계획 요약</span>
                    <span>{run.report.planSummary ? shortText(run.report.planSummary, 80) : "-"}</span>
                  </div>
                  <div className="report-row">
                    <span>구현 요약</span>
                    <span>{run.report.implementSummary ? shortText(run.report.implementSummary, 80) : "-"}</span>
                  </div>
                  <div className="report-row">
                    <span>검증 통과 여부</span>
                    <span>{run.report.verifyPassed ? "통과" : "실패"}</span>
                  </div>
                  {run.report.failureSignature ? (
                    <div className="report-row">
                      <span>실패 시그니처</span>
                      <span>{run.report.failureSignature}</span>
                    </div>
                  ) : null}
                </div>

                <div className="label" style={{ marginTop: 10 }}>검증 결과</div>
                <ul className="artifacts">
                  {(run.report.gateResults || []).length === 0 ? (
                    <li>
                      <span>검증 정보 없음</span>
                      <span>-</span>
                    </li>
                  ) : (
                    run.report.gateResults.map((gate, idx) => (
                      <li key={`${gate.name}-${idx}`}>
                        <span>
                          {gate.name} ({gate.passed ? "통과" : "실패"}){gate.category ? ` · ${gate.category}` : ""}
                        </span>
                        <span>{shortText(gate.details, 120)}</span>
                      </li>
                    ))
                  )}
                </ul>

                {run.report.failureDiagnosis ? (
                  <>
                    <div className="label" style={{ marginTop: 10 }}>정확한 실패 원인</div>
                    <div className="report-box">
                      <div className="report-row">
                        <span>원인 코드</span>
                        <span>{translateFailureCode(run.report.failureDiagnosis.code)}</span>
                      </div>
                      <div className="report-row">
                        <span>설명</span>
                        <span>{shortText(run.report.failureDiagnosis.message, 180)}</span>
                      </div>
                    </div>
                    <ul className="artifacts" style={{ marginTop: 8 }}>
                      {(run.report.failureDiagnosis.evidence || []).map((line, idx) => (
                        <li key={`diag-evidence-${idx}`}>
                          <span>{shortText(line, 100)}</span>
                          <span>근거</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {run.report.failureSummary ? (
                  <>
                    <div className="label" style={{ marginTop: 10 }}>부족한 점 / 재시도 가이드</div>
                    <div className="report-box">
                      <div className="report-row">
                        <span>실패 유형</span>
                        <span>{run.report.failureSummary.category}</span>
                      </div>
                      <div className="report-row">
                        <span>가이드</span>
                        <span>{shortText(run.report.failureSummary.recommendation, 120)}</span>
                      </div>
                    </div>
                    <ul className="artifacts" style={{ marginTop: 8 }}>
                      {(run.report.failureSummary.coreLines || []).map((line, idx) => (
                        <li key={`core-line-${idx}`}>
                          <span>{shortText(line, 90)}</span>
                          <span>원인</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid">
          <div className="card">
            <h3>진행 카드</h3>
            <div className="label">플랜 단계 진행</div>
            <div className="progress-card-grid">
              {(planProgress?.cards || []).length === 0 ? (
                <div className="hint">플랜 단계 정보가 아직 없습니다.</div>
              ) : (
                planProgress.cards.map((card) => (
                  <div key={`plan-${card.id}`} className={`progress-card ${cardStatusClass(card.status)}`}>
                    <div className="progress-title">{`${card.id}. ${card.title}`}</div>
                    <div className="progress-detail">{planStepStatusLabel(card.status)}</div>
                  </div>
                ))
              )}
            </div>

            <div className="label">구현 액션 진행</div>
            <div className="progress-card-grid">
              {(actionProgress?.cards || []).length === 0 ? (
                <div className="hint">아직 액션 실행 기록이 없습니다.</div>
              ) : (
                actionProgress.cards.map((card) => (
                  <div key={`action-${card.id}`} className={`progress-card ${cardStatusClass(card.status)}`}>
                    <div className="progress-title">{card.title}</div>
                    <div className="progress-detail">{card.detail}</div>
                  </div>
                ))
              )}
            </div>

            <div className="label" style={{ marginTop: 10 }}>검증 게이트 진행</div>
            <div className="progress-card-grid">
              {(verifyProgress?.cards || []).length === 0 ? (
                <div className="hint">아직 검증 기록이 없습니다.</div>
              ) : (
                verifyProgress.cards.map((card) => (
                  <div key={`gate-${card.id}`} className={`progress-card ${cardStatusClass(card.status)}`}>
                    <div className="progress-title">{card.title}</div>
                    <div className="progress-detail">{card.detail}</div>
                  </div>
                ))
              )}
            </div>

            <h3 style={{ marginTop: 14 }}>Stage Timeline (한국어)</h3>
            <div className="timeline">
              {events.length === 0 ? (
                <div className="hint">아직 이벤트가 없습니다.</div>
              ) : (
                events.map((event, index) => (
                  <div
                    className={`event ${event.kind === "progress" ? "progress" : "transition"}`}
                    key={`${event.timestamp}-${index}`}
                  >
                    <div className="state">
                      {event.state}
                      <span className="event-kind">{event.kind || "transition"}</span>
                    </div>
                    <div className="reason">{translateReason(event.reason)}</div>
                    <div className="time">{event.timestamp}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card">
            <h3>결과 파일</h3>
            <div className="label">실제 변경 파일</div>
            <ul className="artifacts">
              {(run?.changedFiles || []).length === 0 ? (
                <li>
                  <span>변경 파일 정보 없음</span>
                  <span>-</span>
                </li>
              ) : (
                run.changedFiles.map((change, idx) => (
                  <li key={`${change.path}-${idx}`}>
                    <span>{change.path}</span>
                    <span>{shortText(change.summary, 38)}</span>
                  </li>
                ))
              )}
            </ul>

            <div className="label" style={{ marginTop: 12 }}>런타임 아티팩트</div>
            <ul className="artifacts">
              {artifacts.length === 0 ? (
                <li>
                  <span>아직 아티팩트가 없습니다.</span>
                  <span>-</span>
                </li>
              ) : (
                artifacts.map((artifact) => (
                  <li key={artifact.path}>
                    <span>{artifact.path}</span>
                    <span>{artifact.size} B</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
