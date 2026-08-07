const state = {
  view: "generate",
  archive: [],
  challenge: [],
  health: null,
  audit: [],
  verification: null,
  selectedId: null,
  boardFilter: "open",
  report: null,
  reportTimer: null,
  reports: [],
  selectedReport: null,
  reportTab: null,
  reportRequestId: null,
  reportRequestStartedAt: null,
  reportRequestTimer: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtMoney(value, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "NOT OBSERVED";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPct(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function shortStamp(value) {
  if (!value) return "NO AS-OF STAMP";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) + " CT";
}

function latestDate(rows) {
  const values = rows.map((row) => row.date).filter(Boolean).sort();
  return values.at(-1) || null;
}

function isClosed(row) {
  return row.outcome !== null && row.outcome !== undefined && row.outcome !== "";
}

function callType(row) {
  if (row.call_type) return row.call_type;
  const call = String(row.final_call || "").toLowerCase();
  if (call.includes("no trade") || call.includes("pass")) return "pass";
  if (call.includes("conditional") || call.includes("gate") || row.trigger) return "conditional";
  if (call.includes("hedge")) return "hedge";
  if (call.includes("long") || call.includes("accumulate")) return "long";
  return "review";
}

function lastValue(row) {
  return typeof row.last === "number" ? fmtMoney(row.last) : "NOT OBSERVED";
}

function checkpointCount() {
  return state.archive.reduce((total, row) => total + Object.values(row.checkpoints || {}).filter((point) => point && point.verdict && point.verdict !== "not_scorable").length, 0);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || body?.reason || `Request failed (${response.status})`);
  return body;
}

function toast(message, error = false) {
  const node = $("#toast");
  node.textContent = message;
  node.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.className = "toast"; }, 2600);
}

function tickClocks() {
  const now = new Date();
  $("#clock-ct").textContent = now.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour12: false });
  $("#clock-et").textContent = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
}

function setView(view) {
  state.view = view;
  $$(".rail-button").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $$(".view").forEach((section) => section.classList.toggle("is-active", section.id === `view-${view}`));
  if (view === "generate" || view === "library") loadReports().catch((error) => showReportsUnavailable(error));
}

function renderSystem() {
  $("#book-count").textContent = state.archive.length ? `${state.archive.length} ROWS` : "UNAVAILABLE";
  const archiveGood = state.archive.length > 0;
  const data = $("#data-state");
  data.textContent = archiveGood ? "LOCAL / AS-OF" : "UNAVAILABLE";
  data.className = archiveGood ? "status-good" : "status-warn";
  $("#footer-stamp").textContent = latestDate(state.archive) ? `BOOK THROUGH ${latestDate(state.archive)}` : "LOCAL SNAPSHOT";
}

function renderEvidence() {
  const archiveNode = $("#archive-evidence");
  const archiveItem = archiveNode.closest(".evidence-item");
  if (state.archive.length) {
    archiveNode.textContent = `${state.archive.length} ROWS LOADED`;
    $("#archive-asof").textContent = `Book through ${latestDate(state.archive)}`;
    archiveItem.className = "evidence-item good";
  } else {
    archiveNode.textContent = "UNAVAILABLE";
    $("#archive-asof").textContent = "The local book could not be read";
    archiveItem.className = "evidence-item bad";
  }

  const auditNode = $("#audit-evidence");
  const auditItem = auditNode.closest(".evidence-item");
  const light = $("#integrity-light");
  if (state.verification?.ok) {
    auditNode.textContent = `INTACT / ${state.verification.count}`;
    $("#audit-asof").textContent = "Hash-linked local events";
    auditItem.className = "evidence-item good";
    light.className = "integrity-light good";
    $("#integrity-short").textContent = "CHAIN OK";
  } else if (state.verification) {
    auditNode.textContent = `BROKEN @ ${state.verification.brokenAtSeq ?? "UNKNOWN"}`;
    $("#audit-asof").textContent = "Do not trust the activity trail";
    auditItem.className = "evidence-item bad";
    light.className = "integrity-light bad";
    $("#integrity-short").textContent = "CHAIN BAD";
  }

  const providers = state.health?.providers || {};
  const connected = Object.values(providers).filter((provider) => provider.kind === "model" && provider.enabled && provider.connected);
  const modelNode = $("#model-evidence");
  const modelItem = modelNode.closest(".evidence-item");
  if (connected.length) {
    modelNode.textContent = connected.map((provider) => provider.label.toUpperCase()).join(" + ");
    $("#model-detail").textContent = connected.map((provider) => `${provider.label}: ${provider.via}`).join(" · ");
    modelItem.className = "evidence-item good";
  } else {
    modelNode.textContent = "NO MODEL CONNECTED";
    $("#model-detail").textContent = "Price refresh can run; analysis cannot";
    modelItem.className = "evidence-item bad";
  }
}

function boardRows() {
  if (state.boardFilter === "closed") return state.archive.filter(isClosed).reverse();
  if (state.boardFilter === "all") return [...state.archive].reverse();
  return state.archive.filter((row) => !isClosed(row)).reverse();
}

function stateChip(row) {
  if (isClosed(row)) {
    const outcome = String(row.outcome || "closed");
    const loss = outcome.toLowerCase().includes("loss") || (typeof row.pct_move === "number" && row.pct_move < 0);
    return `<span class="state-chip closed${loss ? " loss" : ""}">${escapeHtml(outcome)} ${typeof row.pct_move === "number" ? escapeHtml(fmtPct(row.pct_move)) : ""}</span>`;
  }
  const type = callType(row);
  return `<span class="state-chip ${type === "conditional" ? "conditional" : ""}">${escapeHtml(type)}</span>`;
}

function renderBoard() {
  const rows = boardRows();
  if (!state.selectedId && rows.length) state.selectedId = rows[0].id;
  $("#board-body").innerHTML = rows.length ? rows.map((row) => `
    <tr tabindex="0" data-id="${escapeHtml(row.id)}" class="${row.id === state.selectedId ? "is-selected" : ""}">
      <td><span class="row-id">${escapeHtml(row.id)}</span></td>
      <td><span class="row-ticker">${escapeHtml(row.ticker)}</span></td>
      <td class="numeric"><span class="row-price">${fmtMoney(row.review_price)}</span><span class="source-meta">${escapeHtml(row.review_time || row.date || "NO STAMP")}</span></td>
      <td class="numeric"><span class="row-price">${lastValue(row)}</span><span class="source-meta">${escapeHtml(row.last_source || "NO SOURCE")}</span></td>
      <td>${stateChip(row)}</td>
    </tr>`).join("") : '<tr><td colspan="5" class="empty-cell">No rows match this filter.</td></tr>';
  renderResearch();
}

function renderResearch() {
  const row = state.archive.find((item) => item.id === state.selectedId);
  const detail = $("#research-detail");
  if (!row) {
    detail.innerHTML = '<div class="empty-state">Select a row to inspect its thesis, gates, and evidence.</div>';
    return;
  }
  const grades = row.grades || {};
  $("#selected-source").textContent = `${String(row.last_source || "LOCAL BOOK").toUpperCase()} / ${shortStamp(row.last_checked)}`;
  detail.innerHTML = `
    <div class="research-hero">
      <div>
        <div class="research-symbol">$${escapeHtml(row.ticker)}</div>
        <div class="research-meta">${escapeHtml(row.id)} / ${escapeHtml(row.date || "NO DATE")} / REVIEW ${fmtMoney(row.review_price)}</div>
      </div>
      <div class="score-block"><span>OPPORTUNITY SCORE</span><strong>${typeof row.opportunity_score === "number" ? row.opportunity_score : "—"}</strong></div>
    </div>
    <div class="research-call">${escapeHtml(row.final_call || "No written call recorded.")}</div>
    <div class="grade-grid">
      <div><span>TECHNICAL</span><strong>${escapeHtml(grades.technical || "—")}</strong></div>
      <div><span>FUNDAMENTAL</span><strong>${escapeHtml(grades.fundamental || "—")}</strong></div>
      <div><span>EXECUTION</span><strong>${escapeHtml(grades.execution || "—")}</strong></div>
      <div><span>OVERALL</span><strong>${escapeHtml(grades.overall || "—")}</strong></div>
    </div>
    <div class="gate-grid">
      <div class="gate"><span>TRIGGER</span><strong>${escapeHtml(row.trigger || "NOT RECORDED")}</strong></div>
      <div class="gate"><span>INVALIDATION</span><strong>${escapeHtml(row.invalidation || "NOT RECORDED")}</strong></div>
      <div class="gate"><span>LAST OBSERVED</span><strong>${lastValue(row)} / ${escapeHtml(row.last_source || "NO SOURCE")}</strong></div>
      <div class="gate"><span>CONFIDENCE</span><strong>${typeof row.confidence_pct === "number" ? `${row.confidence_pct}%` : "NOT RECORDED"}</strong></div>
    </div>
    <div class="lesson">${escapeHtml(row.lesson || "No lesson recorded yet. Open calls remain unresolved until the evidence closes them.")}</div>`;
}

function renderChallenge() {
  const row = state.challenge.at(-1);
  if (!row) {
    $("#challenge-note").textContent = "Challenge ledger unavailable. No values are being inferred.";
    return;
  }
  const position = (row.equity_value || 0) + (row.options_value || 0) > 0 ? "CAPITAL DEPLOYED" : "100% CASH";
  const metrics = [
    ["ACCOUNT VALUE", fmtMoney(row.total_value)],
    ["CONTRIBUTED", fmtMoney(row.contributed)],
    ["TRADING P&L", fmtMoney(row.trading_pnl)],
    ["TO TARGET", `${Number(row.multiple_to_target || 0).toFixed(2)}×`],
    ["POSITION STATE", position],
  ];
  $("#challenge-metrics").innerHTML = metrics.map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  $("#challenge-note").textContent = `${row.date} / ${row.source || "no source"}. ${row.note || "No note."}`;
}

function renderBook() {
  const open = state.archive.filter((row) => !isClosed(row)).length;
  const closed = state.archive.length - open;
  const engines = new Set(state.archive.map((row) => row.engine).filter(Boolean));
  const missingTriggers = state.archive.filter((row) => callType(row) === "conditional" && !row.trigger).length;
  const metrics = [
    ["TOTAL ROWS", state.archive.length],
    ["OPEN", open],
    ["CLOSED", closed],
    ["SCORED CHECKPOINTS", checkpointCount()],
    ["MISSING CONDITIONAL TRIGGERS", missingTriggers],
  ];
  $("#book-metrics").innerHTML = metrics.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
  renderBookTable();
}

function renderBookTable() {
  const query = $("#book-search").value.trim().toLowerCase();
  const rows = [...state.archive].reverse().filter((row) => !query || [row.id, row.ticker, row.final_call, row.lesson, row.outcome].some((value) => String(value || "").toLowerCase().includes(query)));
  $("#book-body").innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td><span class="row-id">${escapeHtml(row.id)}</span></td>
      <td class="row-id">${escapeHtml(row.date || "—")}</td>
      <td><span class="row-ticker">${escapeHtml(row.ticker)}</span></td>
      <td>${stateChip(row)}</td>
      <td class="numeric row-price">${fmtMoney(row.review_price)}</td>
      <td class="numeric row-price">${lastValue(row)}</td>
      <td>${escapeHtml(row.final_call || "—")}</td>
      <td>${escapeHtml(row.grade_verdict || row.outcome || "OPEN")}</td>
    </tr>`).join("") : '<tr><td colspan="8" class="empty-cell">No book rows match that search.</td></tr>';
}

function renderAudit() {
  const verdict = $("#audit-verdict");
  if (state.verification?.ok) {
    verdict.textContent = `CHAIN INTACT / ${state.verification.count} EVENTS`;
    verdict.className = "audit-verdict good";
  } else if (state.verification) {
    verdict.textContent = `CHAIN BROKEN / SEQ ${state.verification.brokenAtSeq ?? "UNKNOWN"}`;
    verdict.className = "audit-verdict bad";
  }
  $("#audit-body").innerHTML = state.audit.length ? state.audit.map((row) => `
    <tr>
      <td class="row-id">${escapeHtml(row.seq)}</td>
      <td class="row-id">${escapeHtml(shortStamp(row.ts))}</td>
      <td>${escapeHtml(row.kind || "—")}</td>
      <td>${escapeHtml(row.actor || "—")}</td>
      <td>${escapeHtml(row.target || row.reason || "—")}</td>
      <td>${escapeHtml(row.decision || "n/a")}</td>
    </tr>`).join("") : '<tr><td colspan="6" class="empty-cell">No audit events recorded.</td></tr>';
}

function renderSettings() {
  const providers = state.health?.providers || {};
  const models = Object.entries(providers).filter(([, provider]) => provider.kind === "model");
  $("#provider-settings").innerHTML = models.length ? models.map(([id, provider]) => {
    const secret = id === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    return `<div class="provider-row">
      <div class="provider-name"><strong>${escapeHtml(provider.label)}</strong><span>${escapeHtml(provider.kind)} / ${escapeHtml(provider.via || "none")}</span></div>
      <input class="provider-input" type="password" data-secret="${secret}" autocomplete="new-password" placeholder="${provider.connected ? "Saved locally — paste to replace" : "Paste key — stored on this PC"}">
      <button class="text-button save-provider" data-id="${escapeHtml(id)}" data-secret="${secret}">SAVE</button>
      <span class="provider-state ${provider.connected ? "good" : ""}">${provider.connected ? "CONNECTED" : "NOT CONNECTED"}</span>
    </div>`;
  }).join("") : '<div class="empty-state">Provider status unavailable.</div>';
}

async function loadArchive() {
  state.archive = await fetchJson("/api/archive");
  if (!state.selectedId && state.archive.length) state.selectedId = state.archive.at(-1).id;
  renderSystem();
  renderBoard();
  renderBook();
  renderEvidence();
}

async function loadChallenge() {
  state.challenge = await fetchJson("/api/challenge");
  renderChallenge();
}

async function loadHealth() {
  state.health = await fetchJson("/api/health");
  renderEvidence();
  renderSettings();
}

async function loadAudit() {
  const [events, verification] = await Promise.all([
    fetchJson("/api/audit?limit=100"),
    fetchJson("/api/audit/verify"),
  ]);
  state.audit = events.rows || [];
  state.verification = verification;
  renderEvidence();
  renderAudit();
}

function setRunStatus(message, kind = "") {
  $("#run-state").className = `run-state${kind ? ` ${kind}` : ""}`;
  $("#run-state-text").textContent = message;
}

function runButtonsDisabled(disabled) {
  $("#run-market-button").disabled = disabled;
  $("#run-ticker-button").disabled = disabled;
}

const stepLabels = {
  starting: "Starting the real report engine",
  loadArchive: "Loading the append-only book",
  fetchDataPacket: "Pulling price and history sources",
  reconcileArchive: "Reconciling observed prices",
  selectAngle: "Testing narrative against evidence",
  present: "Assembling the reviewable report",
  done: "Run complete",
};

function progressLabel(step) {
  if (!step) return "Working";
  const match = Object.entries(stepLabels).find(([key]) => step.startsWith(key));
  return match ? match[1] : step;
}

async function startRun(target) {
  if (state.reportTimer) return;
  runButtonsDisabled(true);
  setRunStatus("Starting the real report engine…", "running");
  try {
    const result = await fetchJson("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ target }),
    });
    if (!result.started) throw new Error(result.reason || "A report is already running");
    state.reportTimer = window.setInterval(pollRun, 900);
    await pollRun();
  } catch (error) {
    runButtonsDisabled(false);
    setRunStatus(error.message, "error");
    toast(error.message, true);
  }
}

async function pollRun() {
  try {
    const status = await fetchJson("/api/report/status");
    if (status.running) {
      setRunStatus(`${progressLabel(status.step)} / ${(status.elapsed_ms / 1000).toFixed(1)}s`, "running");
      return;
    }
    if (!status.result) return;
    clearInterval(state.reportTimer);
    state.reportTimer = null;
    runButtonsDisabled(false);
    state.report = status.result;
    renderReport();
    setRunStatus(status.result.ok ? `Complete / ${shortStamp(status.result.stamp)}` : `Complete with ${status.result.errors?.length || 1} issue(s)`, status.result.ok ? "" : "error");
    await Promise.allSettled([loadArchive(), loadAudit()]);
  } catch (error) {
    clearInterval(state.reportTimer);
    state.reportTimer = null;
    runButtonsDisabled(false);
    setRunStatus(error.message, "error");
  }
}

function renderReport() {
  const report = state.report;
  const panel = $("#report-panel");
  if (!report) return;
  panel.classList.remove("is-hidden");
  const errors = report.errors?.length ? `<div class="report-errors"><strong>PROBLEMS THIS RUN</strong><br>${report.errors.map(escapeHtml).join("<br>")}</div>` : "";
  const observed = (report.board || []).map((row) => `${row.id}  $${row.ticker}  ${typeof row.last === "number" ? fmtMoney(row.last) : row.last}  / ${row.source}${row.provisional ? " / delayed" : ""}`).join("\n");
  $("#report-content").innerHTML = `${errors}
    <div class="report-section"><h3>OBSERVED BOARD / ${escapeHtml(shortStamp(report.stamp || report.packet?.review_stamp))}</h3><pre class="report-copy">${escapeHtml(observed || "No board values returned.")}</pre></div>
    <div class="report-section"><h3>FULL REPORT / REVIEW BEFORE USE</h3><pre class="report-copy">${escapeHtml(report.report_text || "No report text returned.")}</pre></div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function normalizeReports(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.reports)) return payload.reports;
  return [];
}

function reportId(report) {
  return String(report?.id || report?.report_id || "");
}

function reportTarget(report) {
  return String(report?.target || report?.ticker || report?.scope || "MARKET").toUpperCase();
}

function reportStatus(report) {
  const raw = String(report?.status || "").toLowerCase();
  if (["complete", "completed", "done", "saved", "success"].includes(raw)) return "complete";
  if (["failed", "error", "attention"].includes(raw) || report?.ok === false) return "failed";
  if (["running", "pending", "queued", "generating"].includes(raw)) return "running";
  if (report?.completed_at || report?.report_text || report?.sections) return "complete";
  return raw || "saved";
}

function reportStamp(report) {
  return report?.as_of || report?.completed_at || report?.created_at || report?.stamp || null;
}

function reportTitle(report) {
  return report?.title || `${reportTarget(report)} research report`;
}

function reportSummary(report) {
  return report?.summary || report?.executive_summary || report?.subtitle || "No executive summary was saved with this report.";
}

function reportCard(report, compact = false) {
  const id = reportId(report);
  const status = reportStatus(report);
  return `<button class="report-card${compact ? " compact" : ""}" type="button" data-report-id="${escapeHtml(id)}" ${id ? "" : "disabled"}>
    <span class="report-card-top"><span class="report-target">${escapeHtml(reportTarget(report))}</span><span class="report-status ${escapeHtml(status)}">${escapeHtml(status.toUpperCase())}</span></span>
    <h3>${escapeHtml(reportTitle(report))}</h3>
    <p>${escapeHtml(reportSummary(report))}</p>
    <time>${escapeHtml(shortStamp(reportStamp(report)))}</time>
  </button>`;
}

function renderRecentReports() {
  const node = $("#recent-reports");
  const reports = state.reports.slice(0, 3);
  node.innerHTML = reports.length
    ? reports.map((report) => reportCard(report, true)).join("")
    : '<div class="empty-state">No saved reports yet. Generate one to open the first report room.</div>';
}

function reportMatchesFilter(report) {
  const query = $("#report-search")?.value.trim().toLowerCase() || "";
  const filter = $("#report-status-filter")?.value || "all";
  const status = reportStatus(report);
  const haystack = [reportId(report), reportTarget(report), reportTitle(report), reportSummary(report)].join(" ").toLowerCase();
  return (!query || haystack.includes(query)) && (filter === "all" || filter === status);
}

function renderReportLibrary() {
  const reports = state.reports.filter(reportMatchesFilter);
  const counts = {
    total: state.reports.length,
    complete: state.reports.filter((report) => reportStatus(report) === "complete").length,
    running: state.reports.filter((report) => reportStatus(report) === "running").length,
    failed: state.reports.filter((report) => reportStatus(report) === "failed").length,
  };
  $("#report-metrics").innerHTML = [
    ["SAVED REPORTS", counts.total],
    ["COMPLETE", counts.complete],
    ["RUNNING", counts.running],
    ["FAILED", counts.failed],
    ["LATEST AS-OF", state.reports.length ? shortStamp(reportStamp(state.reports[0])) : "NONE"],
  ].map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  $("#report-library").innerHTML = reports.length ? reports.map((report) => {
    const id = reportId(report);
    const status = reportStatus(report);
    return `<article class="library-report">
      <div><span class="report-target">${escapeHtml(reportTarget(report))}</span><time>${escapeHtml(shortStamp(reportStamp(report)))}</time></div>
      <div class="library-report-top"><span class="report-status ${escapeHtml(status)}">${escapeHtml(status.toUpperCase())}</span></div>
      <div class="library-report-copy"><h3>${escapeHtml(reportTitle(report))}</h3><p>${escapeHtml(reportSummary(report))}</p></div>
      <div class="library-report-asof"><span>REPORT ID</span><strong>${escapeHtml(id || "UNAVAILABLE")}</strong></div>
      <button class="text-button" type="button" data-report-id="${escapeHtml(id)}" ${id ? "" : "disabled"}>OPEN ROOM</button>
    </article>`;
  }).join("") : '<div class="empty-state">No reports match this view.</div>';
}

async function loadReports() {
  const payload = await fetchJson("/api/reports");
  state.reports = normalizeReports(payload).sort((a, b) => new Date(reportStamp(b) || 0) - new Date(reportStamp(a) || 0));
  renderRecentReports();
  renderReportLibrary();
}

function showReportsUnavailable(error) {
  const message = `Report library unavailable: ${error.message}`;
  const recent = $("#recent-reports");
  const library = $("#report-library");
  if (recent) recent.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  if (library) library.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function setGenerationState(kind, label, message, detail) {
  const node = $("#generation-state");
  node.className = `generation-state${kind ? ` ${kind}` : ""}`;
  $("#generation-label").textContent = label;
  $("#generation-message").textContent = message;
  $("#generation-detail").textContent = detail;
}

function updateGenerationElapsed(elapsedMs) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  $("#generation-elapsed").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function stopReportRequest() {
  clearInterval(state.reportRequestTimer);
  state.reportRequestTimer = null;
  $("#generate-report-button").disabled = false;
}

function generationStepLabel(step) {
  return String(progressLabel(step || "Working")).toUpperCase();
}

async function generateSavedReport(event) {
  event.preventDefault();
  if (state.reportRequestTimer) return;
  const scope = $('input[name="report-scope"]:checked')?.value || "ticker";
  const ticker = $("#report-ticker").value.trim().replace(/^\$/, "").toUpperCase();
  if (scope === "ticker" && !/^[A-Z^.-]{1,8}$/.test(ticker)) return toast("Enter a valid ticker first.", true);
  const target = scope === "market" ? "market" : ticker;
  $("#report-ticker").value = ticker;
  $("#generate-report-button").disabled = true;
  state.reportRequestStartedAt = Date.now();
  const idempotencyKey = globalThis.crypto?.randomUUID?.() || `bench-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  updateGenerationElapsed(0);
  setGenerationState("running", "REQUESTING REPORT", `Opening the ${target === "market" ? "full-market" : `$${target}`} investigation...`, "Waiting for the server to accept the report request.");
  try {
    const started = await fetchJson("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ target }),
    });
    if (!started?.started || !started?.id) throw new Error(started?.reason || "The report request was not accepted");
    state.reportRequestId = String(started.id);
    state.reportRequestTimer = window.setInterval(() => {
      updateGenerationElapsed(Date.now() - state.reportRequestStartedAt);
      pollSavedReport().catch(handleSavedReportError);
    }, 900);
    await pollSavedReport();
  } catch (error) {
    handleSavedReportError(error);
  }
}

function handleSavedReportError(error) {
  stopReportRequest();
  setGenerationState("error", "REPORT FAILED", error.message, "No completed report or PDF is being claimed. Fix the reported problem and run it again.");
  toast(error.message, true);
}

async function pollSavedReport() {
  const id = state.reportRequestId;
  if (!id) return;
  const status = await fetchJson(`/api/reports/${encodeURIComponent(id)}/status`);
  updateGenerationElapsed(status.elapsed_ms ?? Date.now() - state.reportRequestStartedAt);
  if (status.running) {
    setGenerationState("running", generationStepLabel(status.step), `Building report ${id}`, `The report engine has been working for ${((status.elapsed_ms || 0) / 1000).toFixed(1)} seconds.`);
    return;
  }
  stopReportRequest();
  if (!status.result) throw new Error(status.error || status.reason || "The run ended without a saved report");
  const saved = status.result;
  const savedStatus = reportStatus(saved);
  if (savedStatus === "failed") {
    setGenerationState("error", "REPORT SAVED WITH ISSUES", reportTitle(saved), "The partial record and its limitations were preserved. Opening the report room for inspection.");
  } else {
    setGenerationState("complete", "REPORT SAVED", reportTitle(saved), "The report room is ready. Opening the saved evidence and PDF controls now.");
  }
  await Promise.allSettled([loadReports(), loadArchive(), loadAudit()]);
  await openReportRoom(reportId(saved), saved);
}

function setReportScope() {
  const market = $('input[name="report-scope"]:checked')?.value === "market";
  const field = $("#report-ticker-field");
  const input = $("#report-ticker");
  field.classList.toggle("is-disabled", market);
  input.disabled = market;
  input.required = !market;
}

function reportContentValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(reportContentValue).filter(Boolean).join("\n\n");
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${key.replaceAll("_", " ").toUpperCase()}\n${reportContentValue(item)}`).join("\n\n");
  return String(value);
}

function detailSections(report) {
  if (Array.isArray(report?.sections) && report.sections.length) {
    return report.sections.map((section, index) => ({
      id: String(section.id || section.slug || `section-${index + 1}`),
      title: String(section.title || section.label || `Section ${index + 1}`),
      content: reportContentValue(section.content ?? section.body ?? section.text),
    })).filter((section) => section.content);
  }
  if (report?.sections && typeof report.sections === "object" && Object.keys(report.sections).length) {
    return Object.entries(report.sections).map(([key, value]) => ({ id: key, title: key.replaceAll("_", " "), content: reportContentValue(value) })).filter((section) => section.content);
  }
  const candidates = [
    ["overview", "Executive briefing", report.executive_summary || report.summary],
    ["thesis", "Thesis and invalidation", report.thesis || report.investment_thesis],
    ["technical", "Market tape and technicals", report.technicals || report.technical_condition],
    ["risk", "Risk and contradiction", report.risks || report.risk_analysis],
    ["book", "Book reconciliation", report.book_impact || report.reconciliation],
    ["marquee", "Marquee draft", report.marquee || report.marquee_draft || report.article_draft],
    ["full", "Full report", report.report_text || report.full_report],
  ];
  return candidates.map(([id, title, value]) => ({ id, title, content: reportContentValue(value) })).filter((section) => section.content);
}

function reportSources(report) {
  const sources = report?.sources || report?.evidence || report?.source_ledger || report?.packet?.sources || [];
  return Array.isArray(sources) ? sources : Object.entries(sources || {}).map(([name, value]) => ({ name, ...(typeof value === "object" ? value : { detail: value }) }));
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function renderReportSources(report) {
  const sources = reportSources(report);
  $("#report-sources").innerHTML = sources.length ? sources.map((source, index) => {
    const item = typeof source === "string" ? { title: source } : source;
    const url = safeSourceUrl(item.url || item.href);
    const tag = url ? "a" : "div";
    const attrs = url ? ` href="${escapeHtml(url)}" target="_blank" rel="noreferrer"` : "";
    const sourceTitle = item.title || item.name || item.label || item.publisher || (item.ticker ? `$${item.ticker}` : "Untitled source");
    const sourceDetail = item.detail || item.excerpt || item.source || item.publisher || [item.quote && `Quote: ${item.quote}`, item.history && `History: ${item.history}`, item.provisional ? "Delayed / provisional" : null].filter(Boolean).join(" / ") || (url ? "Open original source" : "No source URL saved");
    return `<${tag} class="source-record"${attrs}>
      <span>SOURCE ${String(index + 1).padStart(2, "0")} / ${escapeHtml(shortStamp(item.as_of || item.timestamp || reportStamp(report)))}</span>
      <strong>${escapeHtml(sourceTitle)}</strong>
      <small>${escapeHtml(sourceDetail)}</small>
    </${tag}>`;
  }).join("") : '<div class="empty-state">This saved report does not include a source ledger.</div>';
}

function renderReportRoom(report) {
  state.selectedReport = report;
  const sections = detailSections(report);
  if (!sections.some((section) => section.id === state.reportTab)) state.reportTab = sections[0]?.id || null;
  const id = reportId(report);
  const status = reportStatus(report);
  $("#report-room-kicker").textContent = `REPORT ROOM / ${reportTarget(report)} / ${status.toUpperCase()}`;
  $("#report-room-title").textContent = reportTitle(report);
  $("#report-room-summary").textContent = reportSummary(report);
  $("#report-room-meta").innerHTML = [
    ["REPORT ID", id || "UNAVAILABLE"],
    ["STATUS", status.toUpperCase()],
    ["AS-OF", shortStamp(reportStamp(report))],
    ["SOURCES", reportSources(report).length],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  const download = $("#download-report-pdf");
  if (id && status !== "running") {
    download.href = `/api/reports/${encodeURIComponent(id)}/pdf`;
    download.setAttribute("download", "");
    download.classList.remove("is-disabled");
    download.removeAttribute("aria-disabled");
  } else {
    download.removeAttribute("href");
    download.removeAttribute("download");
    download.classList.add("is-disabled");
    download.setAttribute("aria-disabled", "true");
  }
  $("#report-tabs").innerHTML = sections.map((section) => `<button type="button" data-report-tab="${escapeHtml(section.id)}" class="${section.id === state.reportTab ? "is-active" : ""}">${escapeHtml(section.title.toUpperCase())}</button>`).join("");
  const selected = sections.find((section) => section.id === state.reportTab);
  const errors = report.errors?.length ? `<div class="report-errors-room"><strong>RUN ISSUES</strong><br>${report.errors.map(escapeHtml).join("<br>")}</div>` : "";
  $("#report-document").innerHTML = selected
    ? `${errors}<div class="report-section-title">${escapeHtml(selected.title.toUpperCase())}</div><div class="report-prose${selected.id === "full" ? " mono" : ""}">${escapeHtml(selected.content)}</div>`
    : `${errors}<div class="empty-state">The saved report has no readable sections.</div>`;
  renderReportSources(report);
}

async function openReportRoom(id, initial = null) {
  if (!id) return;
  state.reportTab = null;
  setView("report");
  $("#report-room-title").textContent = "Opening saved research...";
  $("#report-document").innerHTML = '<div class="empty-state">Loading the report room...</div>';
  try {
    const detail = await fetchJson(`/api/reports/${encodeURIComponent(id)}`);
    renderReportRoom(detail?.report || detail);
  } catch (error) {
    if (initial) renderReportRoom(initial);
    else {
      $("#report-room-title").textContent = "Report unavailable";
      $("#report-document").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }
}

async function saveProvider(button) {
  const secret = button.dataset.secret;
  const input = $(`input[data-secret="${secret}"]`);
  const value = input.value.trim();
  if (!value) return toast("Paste a key before saving.", true);
  button.disabled = true;
  try {
    await fetchJson("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secrets: { [secret]: value } }),
    });
    input.value = "";
    await loadHealth();
    toast("Provider key saved on this PC.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function wireEvents() {
  $$(".rail-button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$('[data-view-jump]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewJump)));
  $("#report-form").addEventListener("submit", generateSavedReport);
  $$('input[name="report-scope"]').forEach((input) => input.addEventListener("change", setReportScope));
  $("#report-search").addEventListener("input", renderReportLibrary);
  $("#report-status-filter").addEventListener("change", renderReportLibrary);
  $("#recent-reports").addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-report-id]");
    if (trigger) openReportRoom(trigger.dataset.reportId);
  });
  $("#report-library").addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-report-id]");
    if (trigger) openReportRoom(trigger.dataset.reportId);
  });
  $("#report-tabs").addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-report-tab]");
    if (!trigger || !state.selectedReport) return;
    state.reportTab = trigger.dataset.reportTab;
    renderReportRoom(state.selectedReport);
  });
  $("#copy-room-report").addEventListener("click", async () => {
    const section = detailSections(state.selectedReport || {}).find((item) => item.id === state.reportTab);
    const copy = section?.content || state.selectedReport?.report_text;
    if (!copy) return toast("No readable report section to copy.", true);
    try {
      await navigator.clipboard.writeText(copy);
      toast("Current report section copied.");
    } catch {
      toast("Clipboard access is unavailable.", true);
    }
  });
  $("#board-filters").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.boardFilter = button.dataset.filter;
    $$("button", event.currentTarget).forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
    renderBoard();
  });
  $("#board-body").addEventListener("click", (event) => selectBoardRow(event.target.closest("tr[data-id]")));
  $("#board-body").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectBoardRow(event.target.closest("tr[data-id]"));
    }
  });
  $("#book-search").addEventListener("input", renderBookTable);
  $("#run-market-button").addEventListener("click", () => startRun("market"));
  $("#run-ticker-button").addEventListener("click", runTicker);
  $("#run-ticker").addEventListener("keydown", (event) => { if (event.key === "Enter") runTicker(); });
  $("#copy-report-button").addEventListener("click", async () => {
    if (!state.report?.report_text) return;
    await navigator.clipboard.writeText(state.report.report_text);
    toast("Report copied.");
  });
  $("#provider-settings").addEventListener("click", (event) => {
    const button = event.target.closest(".save-provider");
    if (button) saveProvider(button);
  });
}

function selectBoardRow(row) {
  if (!row) return;
  state.selectedId = row.dataset.id;
  renderBoard();
}

function runTicker() {
  const ticker = $("#run-ticker").value.trim().replace(/^\$/, "").toUpperCase();
  if (!/^[A-Z^.-]{1,8}$/.test(ticker)) return toast("Enter a valid ticker first.", true);
  $("#run-ticker").value = ticker;
  startRun(ticker);
}

async function boot() {
  wireEvents();
  setReportScope();
  tickClocks();
  setInterval(tickClocks, 1000);
  loadReports().catch((error) => showReportsUnavailable(error));
  const results = await Promise.allSettled([loadArchive(), loadChallenge(), loadHealth(), loadAudit()]);
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length) {
    setRunStatus(`${failed.length} local data source${failed.length === 1 ? "" : "s"} unavailable`, "error");
    failed.forEach((result) => console.error(result.reason));
  }
}

boot();
