const statusEl = document.getElementById("status");
const listEl = document.getElementById("sessionList");
const filterEl = document.getElementById("filter");
const detailTitleEl = document.getElementById("detailTitle");
const detailMetaEl = document.getElementById("detailMeta");
const detailTextEl = document.getElementById("detailText");
const btnRefresh = document.getElementById("btnRefresh");
const btnPreview = document.getElementById("btnPreview");
const btnFull = document.getElementById("btnFull");
const wrapToggle = document.getElementById("wrapToggle");

const state = {
  sessions: [],
  selectedId: null,
  confirmBytes: 0,
  previewBytes: 0,
  fullBytes: 0,
  refreshIntervalSec: 30,
};

function fmtTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

async function fetchStatus() {
  const res = await fetch("/api/status");
  const data = await res.json();
  state.confirmBytes = data.confirm_bytes || 0;
  state.previewBytes = data.preview_bytes || 0;
  state.fullBytes = data.full_bytes || 0;
  state.refreshIntervalSec = data.refresh_interval_sec || 30;
  const lastScan = data.last_scan ? fmtTime(data.last_scan) : "-";
  statusEl.textContent = `sessions: ${data.session_count} | last scan: ${lastScan} | refresh: ${state.refreshIntervalSec}s`;
}

async function fetchSessions() {
  const res = await fetch("/api/sessions");
  const data = await res.json();
  state.sessions = data.sessions || [];
  renderList();
}

function renderList() {
  const filter = (filterEl.value || "").toLowerCase();
  listEl.innerHTML = "";
  const sessions = state.sessions.filter((s) => s.path.toLowerCase().includes(filter));
  sessions.forEach((session, idx) => {
    const li = document.createElement("li");
    li.className = "session-item" + (session.id === state.selectedId ? " active" : "");
    li.dataset.id = session.id;

    const title = document.createElement("div");
    title.textContent = session.path.split("/").slice(-1)[0] || session.path;

    const path = document.createElement("div");
    path.className = "session-path";
    path.textContent = session.path;

    const meta = document.createElement("div");
    meta.className = "session-meta";
    meta.textContent = `${fmtSize(session.size)} | ${fmtTime(session.mtime)}`;

    li.appendChild(title);
    li.appendChild(path);
    li.appendChild(meta);
    li.addEventListener("click", () => selectSession(session.id));

    listEl.appendChild(li);

    if (idx < 6) {
      li.style.animationDelay = `${idx * 0.04}s`;
    }
  });
}

async function selectSession(id) {
  state.selectedId = id;
  renderList();
  await loadSession(false, false);
}

async function loadSession(full, forceConfirm) {
  if (!state.selectedId) return;
  const params = new URLSearchParams({
    id: state.selectedId,
    full: full ? "1" : "0",
  });
  if (forceConfirm) params.set("confirm", "1");

  const res = await fetch(`/api/session?${params.toString()}`);
  if (res.status === 409) {
    const data = await res.json();
    const warning = `WARNING: content size ${fmtSize(data.size)} exceeds threshold ${fmtSize(data.confirm_bytes)}. Continue?`;
    const ok = window.confirm(warning);
    if (ok) {
      await loadSession(full, true);
    }
    return;
  }
  if (!res.ok) {
    detailTextEl.textContent = "Failed to load session.";
    return;
  }
  const data = await res.json();
  detailTitleEl.textContent = data.path;
  detailMetaEl.textContent = `${fmtSize(data.size)} | ${fmtTime(data.mtime)} | ${data.full ? "full" : "preview"}`;
  detailTextEl.textContent = data.text || "";
  if (data.truncated) {
    detailTextEl.textContent += "\n[truncated]";
  }
}

btnRefresh.addEventListener("click", async () => {
  await fetchStatus();
  await fetchSessions();
});

btnPreview.addEventListener("click", async () => {
  await loadSession(false, false);
});

btnFull.addEventListener("click", async () => {
  await loadSession(true, false);
});

filterEl.addEventListener("input", () => {
  renderList();
});

wrapToggle.addEventListener("change", () => {
  if (wrapToggle.checked) {
    detailTextEl.classList.add("wrap");
  } else {
    detailTextEl.classList.remove("wrap");
  }
});

async function bootstrap() {
  await fetchStatus();
  await fetchSessions();
  setInterval(async () => {
    await fetchStatus();
    await fetchSessions();
  }, state.refreshIntervalSec * 1000);
}

bootstrap();
