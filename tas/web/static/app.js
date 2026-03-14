const statusEl = document.getElementById("status");
const listEl = document.getElementById("sessionList");
const filterEl = document.getElementById("filter");
const detailTitleEl = document.getElementById("detailTitle");
const detailMetaEl = document.getElementById("detailMeta");
const detailTextEl = document.getElementById("detailText");
const timelineViewEl = document.getElementById("timelineView");
const btnRefresh = document.getElementById("btnRefresh");
const btnPreview = document.getElementById("btnPreview");
const btnFull = document.getElementById("btnFull");
const wrapToggle = document.getElementById("wrapToggle");
const btnStructured = document.getElementById("btnStructured");
const btnRaw = document.getElementById("btnRaw");
const btnLoadMore = document.getElementById("btnLoadMore");
const listMetaEl = document.getElementById("listMeta");

const cardTotal = document.getElementById("cardTotal");
const cardRange = document.getElementById("cardRange");
const cardScan = document.getElementById("cardScan");
const cardRefresh = document.getElementById("cardRefresh");
const activityChart = document.getElementById("activityChart");
const typeChart = document.getElementById("typeChart");

const sinceInput = document.getElementById("sinceInput");
const untilInput = document.getElementById("untilInput");
const btnApply = document.getElementById("btnApply");

const state = {
  sessions: [],
  selectedId: null,
  confirmBytes: 0,
  previewBytes: 0,
  fullBytes: 0,
  refreshIntervalSec: 30,
  offset: 0,
  limit: 50,
  total: 0,
  loading: false,
  hasMore: true,
  since: "",
  until: "",
  bucket: "hour",
  view: "structured",
  structuredAvailable: false,
  autoFullAttempted: new Set(),
};

const FIELD_KEYS = {
  time: ["timestamp", "time", "created_at", "createdAt", "date", "ts"],
  title: ["title", "name", "summary", "event", "action"],
  tags: ["tags", "labels", "tag", "label", "model", "model_provider", "source"],
  badge: ["level", "status", "type", "severity", "role"],
  body: ["content", "message", "text", "body", "detail", "details"],
};

function fmtTime(ts) {
  if (!ts) return "-";
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

function formatLocal(dt) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
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
  cardScan.textContent = lastScan;
  cardRefresh.textContent = `Refresh: ${state.refreshIntervalSec}s`;
}

async function fetchStats() {
  const params = new URLSearchParams();
  if (state.since) params.set("since", state.since);
  if (state.until) params.set("until", state.until);
  params.set("bucket", state.bucket);
  const res = await fetch(`/api/stats?${params.toString()}`);
  const data = await res.json();
  cardTotal.textContent = data.total ?? 0;
  if (state.since || state.until) {
    cardRange.textContent = `${state.since || "-"} to ${state.until || "-"}`;
  } else {
    cardRange.textContent = "All time";
  }
  renderActivityChart(data.buckets || []);
  renderTypeChart(data.types || {});
}

async function fetchSessions(reset) {
  if (state.loading) return;
  if (reset) {
    state.offset = 0;
    state.sessions = [];
    state.hasMore = true;
    listEl.innerHTML = "";
  }
  if (!state.hasMore) return;
  state.loading = true;
  const params = new URLSearchParams({
    offset: String(state.offset),
    limit: String(state.limit),
  });
  if (state.since) params.set("since", state.since);
  if (state.until) params.set("until", state.until);

  const res = await fetch(`/api/sessions?${params.toString()}`);
  const data = await res.json();
  const sessions = data.sessions || [];
  state.total = data.total ?? sessions.length;
  state.sessions = state.sessions.concat(sessions);
  state.offset += sessions.length;
  state.hasMore = sessions.length === state.limit;
  renderList();
  state.loading = false;
}

function renderList() {
  const filter = (filterEl.value || "").toLowerCase();
  listEl.innerHTML = "";
  const sessions = state.sessions.filter((s) => s.path.toLowerCase().includes(filter));
  listMetaEl.textContent = `Showing ${sessions.length} / ${state.total}`;
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

    const metaLeft = document.createElement("span");
    metaLeft.textContent = `${fmtSize(session.size)} | ${fmtTime(session.mtime)}`;

    const metaRight = document.createElement("span");
    metaRight.className = "session-ext";
    metaRight.textContent = session.ext || "file";

    meta.appendChild(metaLeft);
    meta.appendChild(metaRight);

    li.appendChild(title);
    li.appendChild(path);
    li.appendChild(meta);
    li.addEventListener("click", () => selectSession(session.id));

    listEl.appendChild(li);

    if (idx < 6) {
      li.style.animationDelay = `${idx * 0.04}s`;
    }
  });
  btnLoadMore.disabled = !state.hasMore;
  btnLoadMore.textContent = state.hasMore ? "Load more" : "No more";
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
    const warning = `Content size ${fmtSize(data.size)} exceeds threshold ${fmtSize(data.confirm_bytes)}. Continue?`;
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
  renderStructured(data.text || "", data.mtime, { truncated: data.truncated, full: data.full, ext: data.ext });
}

function renderStructured(text, fallbackTime, meta) {
  const parsed = parseStructured(text, meta);
  if (parsed.autoFull) {
    const id = state.selectedId;
    if (id && !state.autoFullAttempted.has(id)) {
      state.autoFullAttempted.add(id);
      timelineViewEl.innerHTML = "<div class=\"empty\">Preview truncated, fetching full content for structured view...</div>";
      loadSession(true, false);
      return;
    }
  }
  state.structuredAvailable = parsed.kind !== "text" && parsed.items.length > 0;
  if (!state.structuredAvailable) {
    const reason = parsed.reason || "Structured view not available for this session.";
    timelineViewEl.innerHTML = `<div class=\"empty\">${reason}</div>`;
    return;
  }
  const items = buildTimelineItems(parsed.items, fallbackTime);
  const container = document.createDocumentFragment();
  if (parsed.failed && parsed.failed > 0) {
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.textContent = `Skipped ${parsed.failed} invalid JSONL lines.`;
    container.appendChild(notice);
  }
  items.forEach((item) => {
    const node = document.createElement("div");
    node.className = "timeline-item";

    const timeEl = document.createElement("div");
    timeEl.className = "timeline-time";
    timeEl.textContent = item.timeLabel || "-";

    const titleEl = document.createElement("div");
    titleEl.className = "timeline-title";
    titleEl.textContent = item.title || "(untitled)";

    node.appendChild(timeEl);
    node.appendChild(titleEl);

    if (item.badge) {
      const badges = document.createElement("div");
      badges.className = "badges";
      const badgeEl = document.createElement("span");
      badgeEl.className = "badge";
      badgeEl.textContent = item.badge;
      badges.appendChild(badgeEl);
      node.appendChild(badges);
    }

    if (item.tags && item.tags.length) {
      const tags = document.createElement("div");
      tags.className = "tags";
      item.tags.forEach((tag) => {
        const tagEl = document.createElement("span");
        tagEl.className = "tag";
        tagEl.textContent = tag;
        tagEl.style.background = tagColor(tag);
        tags.appendChild(tagEl);
      });
      node.appendChild(tags);
    }

    if (item.body) {
      const bodyEl = document.createElement("div");
      bodyEl.className = "timeline-body";
      bodyEl.textContent = item.body;
      node.appendChild(bodyEl);
    }

    if (item.details && Object.keys(item.details).length) {
      const details = document.createElement("details");
      details.className = "details";
      const summary = document.createElement("summary");
      summary.textContent = "Details";
      const grid = document.createElement("div");
      grid.className = "detail-grid";
      Object.entries(item.details).forEach(([key, value]) => {
        const keyEl = document.createElement("div");
        keyEl.className = "detail-key";
        keyEl.textContent = key;
        const valEl = document.createElement("div");
        valEl.className = "detail-value";
        valEl.textContent = formatValue(value);
        grid.appendChild(keyEl);
        grid.appendChild(valEl);
      });
      details.appendChild(summary);
      details.appendChild(grid);
      node.appendChild(details);
    }

    container.appendChild(node);
  });
  timelineViewEl.innerHTML = "";
  timelineViewEl.appendChild(container);
}

function parseStructured(text, meta) {
  const trimmed = (text || "").trim();
  const ext = meta?.ext || "";
  const truncated = meta?.truncated;
  const full = meta?.full;
  if (!trimmed) return { kind: "text", items: [], reason: "No content to render." };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return { kind: "json", items: parsed };
      }
      if (parsed && typeof parsed === "object") {
        return { kind: "json", items: [parsed] };
      }
    } catch (_err) {
      if (!full && (truncated || ext === "json")) {
        return { kind: "json", items: [], autoFull: true, reason: "Preview truncated; fetch full to parse JSON." };
      }
      return { kind: "text", items: [], reason: "Invalid JSON." };
    }
  }
  let lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { kind: "text", items: [], reason: "No JSONL lines found." };
  if (truncated && lines.length > 1) {
    lines = lines.slice(0, -1);
  }
  const items = [];
  let failed = 0;
  for (const line of lines) {
    try {
      items.push(JSON.parse(line));
    } catch (_err) {
      failed += 1;
    }
  }
  if (items.length) {
    return { kind: "jsonl", items, failed };
  }
  if (!full && (truncated || ext === "jsonl")) {
    return { kind: "jsonl", items: [], autoFull: true, reason: "Preview truncated; fetch full to parse JSONL." };
  }
  return { kind: "text", items: [], reason: "Invalid JSONL content." };
}

function buildTimelineItems(items, fallbackTime) {
  const normalized = items
    .map((item, index) => normalizeItem(item, index, fallbackTime))
    .filter((entry) => entry !== null);

  const withTime = normalized.filter((item) => item.timeValue !== null);
  if (withTime.length >= Math.ceil(normalized.length / 2)) {
    normalized.sort((a, b) => (a.timeValue || 0) - (b.timeValue || 0));
  }
  return normalized;
}

function normalizeItem(item, index, fallbackTime) {
  if (!item || typeof item !== "object") return null;
  const payload = item.payload && typeof item.payload === "object" ? item.payload : null;
  const timeValue = pickTime(item) ?? pickTime(payload) ?? fallbackTime ?? null;
  const timeLabel = timeValue ? fmtTime(timeValue) : "-";

  let title = pickField(item, FIELD_KEYS.title) || pickField(payload, FIELD_KEYS.title);
  if (!title) {
    title = (payload && (payload.role || payload.type)) || item.type || `Entry ${index + 1}`;
  }
  let badge = pickField(item, FIELD_KEYS.badge) || pickField(payload, FIELD_KEYS.badge);
  if (!badge && payload && payload.role) badge = payload.role;

  const bodyInfo = extractBody(item, payload);
  const body = bodyInfo.text;
  const tags = mergeTags(pickTags(item), pickTags(payload));

  const usedKeys = new Set();
  FIELD_KEYS.time.concat(FIELD_KEYS.title, FIELD_KEYS.badge, FIELD_KEYS.body, FIELD_KEYS.tags).forEach((k) => usedKeys.add(k));
  if (payload) {
    usedKeys.add("payload");
    bodyInfo.usedPayloadKeys.forEach((key) => usedKeys.add(key));
  }

  const details = {};
  Object.keys(item).forEach((key) => {
    if (usedKeys.has(key)) return;
    details[key] = item[key];
  });
  if (payload && typeof payload === "object") {
    Object.keys(payload).forEach((key) => {
      if (usedKeys.has(key)) return;
      if (details[key] !== undefined) {
        details[`payload.${key}`] = payload[key];
      } else {
        details[key] = payload[key];
      }
    });
  }

  return { timeValue, timeLabel, title, badge, body, tags, details };
}

function pickField(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return String(obj[key]);
    }
  }
  return "";
}

function pickTags(obj) {
  if (!obj || typeof obj !== "object") return [];
  for (const key of FIELD_KEYS.tags) {
    const value = obj[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      return value.map((v) => String(v));
    }
    return [String(value)];
  }
  return [];
}

function pickTime(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of FIELD_KEYS.time) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "number") {
      return value > 1e12 ? value / 1000 : value;
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed / 1000;
      }
      const asNumber = Number(value);
      if (!Number.isNaN(asNumber)) {
        return asNumber > 1e12 ? asNumber / 1000 : asNumber;
      }
    }
  }
  return null;
}

function extractBody(item, payload) {
  const usedPayloadKeys = new Set();
  const direct = pickField(item, FIELD_KEYS.body) || pickField(payload, FIELD_KEYS.body);
  if (direct) return { text: direct, usedPayloadKeys };
  if (payload && payload.content) {
    usedPayloadKeys.add("content");
    if (typeof payload.content === "string") return { text: payload.content, usedPayloadKeys };
    if (Array.isArray(payload.content)) {
      const parts = [];
      payload.content.forEach((entry) => {
        if (!entry) return;
        if (typeof entry === "string") {
          parts.push(entry);
          return;
        }
        if (entry.text) parts.push(entry.text);
        else if (entry.summary_text) parts.push(entry.summary_text);
        else if (entry.content) parts.push(entry.content);
        else parts.push(JSON.stringify(entry));
      });
      return { text: truncateText(parts.join("\\n")), usedPayloadKeys };
    }
  }
  if (payload && Array.isArray(payload.summary)) {
    usedPayloadKeys.add("summary");
    const parts = payload.summary.map((s) => (s.summary_text ? s.summary_text : JSON.stringify(s)));
    return { text: truncateText(parts.join("\\n")), usedPayloadKeys };
  }
  return { text: "", usedPayloadKeys };
}

function truncateText(text) {
  const max = 4000;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\\n...[truncated]`;
}

function mergeTags(primary, secondary) {
  const tags = [];
  (primary || []).forEach((t) => tags.push(t));
  (secondary || []).forEach((t) => tags.push(t));
  const seen = new Set();
  return tags.filter((tag) => {
    const key = String(tag);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 200 ? `${text.slice(0, 200)}...` : text;
  } catch (_err) {
    return String(value);
  }
}

function tagColor(tag) {
  const palette = ["#f9d7b9", "#dce7f5", "#f4c9d5", "#d1f0e0", "#f7e2a8", "#e1d1f5"];
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = (hash + tag.charCodeAt(i) * (i + 1)) % palette.length;
  }
  return palette[hash];
}

function renderActivityChart(buckets) {
  if (!buckets.length) {
    activityChart.textContent = "No data";
    return;
  }
  const width = 260;
  const height = 80;
  const max = Math.max(...buckets.map((b) => b.count || 0), 1);
  const step = buckets.length > 1 ? width / (buckets.length - 1) : width;
  const points = buckets.map((b, i) => {
    const x = i * step;
    const y = height - (b.count / max) * (height - 10) - 5;
    return [x, y];
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  activityChart.innerHTML = `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <path d="${path}" fill="none" stroke="${getComputedStyle(document.documentElement).getPropertyValue("--accent")}" stroke-width="2" />
    </svg>
  `;
}

function renderTypeChart(types) {
  const entries = Object.entries(types).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    typeChart.textContent = "No data";
    return;
  }
  const max = Math.max(...entries.map((entry) => entry[1]));
  typeChart.innerHTML = "";
  entries.forEach(([key, value]) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.marginBottom = "6px";

    const label = document.createElement("div");
    label.style.fontSize = "12px";
    label.style.color = "var(--muted)";
    label.style.minWidth = "40px";
    label.textContent = key;

    const barWrap = document.createElement("div");
    barWrap.style.flex = "1";
    barWrap.style.background = "rgba(25, 25, 25, 0.05)";
    barWrap.style.borderRadius = "999px";
    barWrap.style.height = "6px";

    const bar = document.createElement("div");
    bar.style.height = "6px";
    bar.style.borderRadius = "999px";
    bar.style.background = "var(--accent)";
    bar.style.width = `${(value / max) * 100}%`;

    barWrap.appendChild(bar);

    const count = document.createElement("div");
    count.style.fontSize = "11px";
    count.style.color = "var(--muted)";
    count.textContent = value;

    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(count);

    typeChart.appendChild(row);
  });
}

function applyFilters() {
  state.since = sinceInput.value.trim();
  state.until = untilInput.value.trim();
  fetchStats();
  fetchSessions(true);
}

btnRefresh.addEventListener("click", async () => {
  await fetchStatus();
  await fetchStats();
  await fetchSessions(true);
});

btnPreview.addEventListener("click", async () => {
  await loadSession(false, false);
});

btnFull.addEventListener("click", async () => {
  await loadSession(true, false);
});

btnApply.addEventListener("click", () => {
  applyFilters();
});

btnLoadMore.addEventListener("click", () => {
  fetchSessions(false);
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

btnStructured.addEventListener("click", () => {
  state.view = "structured";
  btnStructured.classList.add("active");
  btnRaw.classList.remove("active");
  timelineViewEl.classList.remove("hidden");
  detailTextEl.classList.add("hidden");
});

btnRaw.addEventListener("click", () => {
  state.view = "raw";
  btnRaw.classList.add("active");
  btnStructured.classList.remove("active");
  detailTextEl.classList.remove("hidden");
  timelineViewEl.classList.add("hidden");
});

function wirePresetButtons() {
  document.querySelectorAll("[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const now = new Date();
      let start = null;
      const range = btn.dataset.range;
      if (range === "1h") start = new Date(now.getTime() - 3600 * 1000);
      if (range === "24h") start = new Date(now.getTime() - 24 * 3600 * 1000);
      if (range === "7d") start = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      if (range === "all") start = null;
      sinceInput.value = start ? formatLocal(start) : "";
      untilInput.value = range === "all" ? "" : formatLocal(now);
      applyFilters();
    });
  });

  document.querySelectorAll("[data-bucket]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-bucket]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.bucket = btn.dataset.bucket;
      fetchStats();
    });
  });
  const initialBucket = document.querySelector(`[data-bucket='${state.bucket}']`);
  if (initialBucket) initialBucket.classList.add("active");
}

function setupInfiniteScroll() {
  const listPanel = document.getElementById("listPanel");
  listPanel.addEventListener("scroll", () => {
    if (state.loading || !state.hasMore) return;
    const threshold = 120;
    if (listPanel.scrollTop + listPanel.clientHeight >= listPanel.scrollHeight - threshold) {
      fetchSessions(false);
    }
  });
}

async function bootstrap() {
  wirePresetButtons();
  setupInfiniteScroll();
  await fetchStatus();
  await fetchStats();
  await fetchSessions(true);
  setInterval(async () => {
    await fetchStatus();
  }, state.refreshIntervalSec * 1000);
}

bootstrap();
