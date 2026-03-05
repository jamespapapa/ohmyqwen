"use client";

import { useEffect, useMemo, useState } from "react";

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
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectMessage, setProjectMessage] = useState("");
  const [projectError, setProjectError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState(20);
  const [searchResult, setSearchResult] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [workspaceDir, setWorkspaceDir] = useState("");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    setProjectName(selectedProject.name || "");
    setWorkspaceDir(selectedProject.workspaceDir || "");
    setProjectDescription(selectedProject.description || "");
    setProjectQueryMode(selectedProject.retrieval?.qmd?.queryMode || "query_then_search");
    setMode(selectedProject.defaultMode || "feature");
    setDryRun(Boolean(selectedProject.defaultDryRun));
  }, [selectedProject]);

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
    await loadPicker(workspaceDir || pickerData?.path || "");
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
        description: projectDescription.trim(),
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
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setIndexing(false);
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
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
      setSearchResult(null);
    } finally {
      setSearchLoading(false);
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

  return (
    <main className="page">
      <div className="wrap">
        <section className="hero">
          <h1>ohmyqwen Runtime Console</h1>
          <p>현재 단계와 수행 내용이 한국어로 실시간 표시됩니다.</p>
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

            <div className="label" style={{ marginTop: 10 }}>설명(선택)</div>
            <input
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="프로젝트 메모"
            />

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
                <ul className="artifacts" style={{ marginTop: 6, maxHeight: 180 }}>
                  {(searchResult.hits || []).length === 0 ? (
                    <li>
                      <span>검색 결과 없음</span>
                      <span>-</span>
                    </li>
                  ) : (
                    searchResult.hits.map((hit, index) => (
                      <li key={`${hit.path}-${index}`}>
                        <span>{shortText(hit.path, 60)}</span>
                        <span>{hit.score?.toFixed ? hit.score.toFixed(2) : hit.score}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : null}

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
