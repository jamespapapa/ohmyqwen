const taskEl = document.getElementById("task");
const modeEl = document.getElementById("mode");
const dryRunEl = document.getElementById("dryRun");
const startBtn = document.getElementById("startBtn");
const runIdEl = document.getElementById("runId");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const timelineEl = document.getElementById("timeline");
const artifactsEl = document.getElementById("artifacts");

let activeRunId = null;
let pollTimer = null;

function renderTimeline(events) {
  timelineEl.innerHTML = "";
  for (const event of events) {
    const item = document.createElement("div");
    item.className = "timeline-item";
    item.textContent = `${event.timestamp} | ${event.state} | ${event.reason}`;
    timelineEl.appendChild(item);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }

  return payload;
}

async function refreshRun() {
  if (!activeRunId) {
    return;
  }

  try {
    const run = await api(`/api/runs/${activeRunId}`);
    statusEl.textContent = run.status;
    errorEl.textContent = run.failReason || "";

    const events = await api(`/api/runs/${activeRunId}/events`);
    renderTimeline(events.events || []);

    if (["finished", "failed"].includes(run.status)) {
      const artifacts = await api(`/api/runs/${activeRunId}/artifacts`);
      artifactsEl.textContent = JSON.stringify(artifacts.files || [], null, 2);
      clearInterval(pollTimer);
      pollTimer = null;
    }
  } catch (error) {
    errorEl.textContent = error instanceof Error ? error.message : String(error);
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

startBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  artifactsEl.textContent = "[]";
  timelineEl.innerHTML = "";

  const task = taskEl.value.trim();
  if (!task) {
    errorEl.textContent = "Task is required.";
    return;
  }

  try {
    const payload = {
      task,
      mode: modeEl.value,
      dryRun: dryRunEl.checked
    };

    const run = await api("/api/runs", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    activeRunId = run.runId;
    runIdEl.textContent = activeRunId;
    statusEl.textContent = run.status;

    if (pollTimer) {
      clearInterval(pollTimer);
    }

    pollTimer = setInterval(refreshRun, 1200);
    await refreshRun();
  } catch (error) {
    errorEl.textContent = error instanceof Error ? error.message : String(error);
  }
});
