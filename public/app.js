const state = {
  view: "desk",
  archive: [],
  challenge: [],
  health: null,
  audit: [],
  verification: null,
  selectedId: null,
  boardFilter: "open",
  report: null,
  reportTimer: null,
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
      headers: { "content-type": "application/json" },
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
  tickClocks();
  setInterval(tickClocks, 1000);
  const results = await Promise.allSettled([loadArchive(), loadChallenge(), loadHealth(), loadAudit()]);
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length) {
    setRunStatus(`${failed.length} local data source${failed.length === 1 ? "" : "s"} unavailable`, "error");
    failed.forEach((result) => console.error(result.reason));
  }
}

boot();
