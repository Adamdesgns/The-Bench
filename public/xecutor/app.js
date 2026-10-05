"use strict";

const appState = {
  owner: {
    configured: false,
    authenticated: false,
    session_expires_at: null,
    session_token: "",
  },
  csrf: "",
  gateway: {
    mode: "unknown",
    kill_switch: true,
    live_execution: false,
    policy_version: "—",
  },
  proposals: [],
  audit: [],
  selectedAudit: [],
  selectedId: null,
  selectedProposal: null,
  filter: "pending",
  view: "inbox",
  busy: false,
  loading: true,
  selectionToken: 0,
  toastTimer: null,
  announcedExpired: new Set(),
};

const byId = (id) => document.getElementById(id);
const all = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  ownerGate: byId("owner-gate"),
  ownerGateStatus: byId("owner-gate-status"),
  ownerSetup: byId("owner-setup"),
  ownerRecheckButton: byId("owner-recheck-button"),
  ownerLoginForm: byId("owner-login-form"),
  ownerCode: byId("owner-code"),
  ownerLoginButton: byId("owner-login-button"),
  ownerLogoutButton: byId("owner-logout-button"),
  gatewayMode: byId("gateway-mode"),
  liveStatus: byId("live-status"),
  policyVersion: byId("policy-version"),
  proposalCount: byId("proposal-count"),
  killStatus: byId("kill-status"),
  killButton: byId("kill-switch-button"),
  railLight: byId("rail-light"),
  railStateText: byId("rail-state-text"),
  queueStatus: byId("queue-status"),
  proposalList: byId("proposal-list"),
  emptyQueue: byId("empty-queue"),
  pendingCount: byId("pending-count"),
  blockedCount: byId("blocked-count"),
  completeCount: byId("complete-count"),
  allCount: byId("all-count"),
  reviewTitle: byId("review-title"),
  reviewState: byId("review-state"),
  reviewEmpty: byId("review-empty"),
  reviewContent: byId("review-content"),
  identityId: byId("identity-id"),
  identitySource: byId("identity-source"),
  identityExpiry: byId("identity-expiry"),
  orderAction: byId("order-action"),
  orderTitle: byId("order-summary-title"),
  orderNotional: byId("order-notional"),
  orderDetails: byId("order-details"),
  gateVerdict: byId("gate-verdict"),
  gateList: byId("gate-list"),
  reviewMessage: byId("review-message"),
  rejectButton: byId("reject-button"),
  reviewButton: byId("review-button"),
  simulationBanner: byId("simulation-banner"),
  simulationDetail: byId("simulation-detail"),
  ledgerEmpty: byId("ledger-empty"),
  timeline: byId("timeline"),
  globalAuditBody: byId("global-audit-body"),
  auditEmpty: byId("audit-empty"),
  demoButton: byId("demo-button"),
  refreshAuditButton: byId("refresh-audit-button"),
  approvalDialog: byId("approval-dialog"),
  approvalForm: byId("approval-form"),
  approvalTitle: byId("approval-dialog-title"),
  approvalSummary: byId("approval-summary"),
  approvalRequiredText: byId("approval-required-text"),
  confirmationInput: byId("confirmation-input"),
  confirmationHelp: byId("confirmation-help"),
  approveButton: byId("approve-button"),
  cancelApprovalButton: byId("cancel-approval-button"),
  rejectDialog: byId("reject-dialog"),
  rejectForm: byId("reject-form"),
  rejectTitle: byId("reject-dialog-title"),
  rejectReason: byId("reject-reason"),
  cancelRejectButton: byId("cancel-reject-button"),
  unlockDialog: byId("unlock-dialog"),
  unlockForm: byId("unlock-form"),
  unlockTitle: byId("unlock-dialog-title"),
  unlockInput: byId("unlock-input"),
  unlockButton: byId("unlock-button"),
  cancelUnlockButton: byId("cancel-unlock-button"),
  toast: byId("toast"),
};

const FINAL_BLOCKED_STATES = new Set([
  "REJECTED",
  "REFUSED",
  "PREFLIGHT_REFUSED",
  "EXPIRED",
  "WITHDRAWN",
  "SIMULATION_INTERRUPTED",
  "CANCELED",
  "CANCELLED",
]);

const FINAL_COMPLETE_STATES = new Set([
  "SIMULATED",
  "SIMULATION_COMPLETE",
  "APPROVED_SIMULATION",
  "COMPLETE",
]);

function asText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function upper(value, fallback = "—") {
  return asText(value, fallback).toUpperCase();
}

function normalizedState(proposal) {
  return upper(proposal?.state, "RECEIVED").replaceAll("-", "_").replaceAll(" ", "_");
}

function handoffOf(proposal) {
  return proposal?.handoff && typeof proposal.handoff === "object" ? proposal.handoff : {};
}

function dateValue(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatStamp(value) {
  const date = dateValue(value);
  if (!date) return "NO TIMESTAMP";
  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }) + " CT";
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "NOT PROVIDED";
  return number.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function maximumNotional(proposal) {
  const handoff = handoffOf(proposal);
  const explicit = Number(
    proposal?.approval?.max_notional ??
    proposal?.simulation?.max_notional ??
    handoff.maximum_notional
  );
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;

  const value = Number(handoff.quantity_value);
  if (!Number.isFinite(value) || value < 0) return null;
  if (upper(handoff.quantity_mode, "") === "NOTIONAL") return value;

  const limit = Number(handoff.limit_price);
  if (upper(handoff.quantity_mode, "") === "SHARES" && Number.isFinite(limit)) {
    return value * limit;
  }
  return null;
}

function safeAccountAlias(value) {
  const alias = asText(value, "NOT PROVIDED");
  if (/\d{9,}/.test(alias)) return "ACCOUNT ALIAS BLOCKED";
  return alias;
}

function sourceLabel(value) {
  const raw = asText(value, "UNKNOWN SOURCE");
  const lowered = raw.toLowerCase();
  if (lowered.includes("chatgpt") || lowered.includes("openai")) return "CHATGPT";
  if (lowered.includes("claude") || lowered.includes("anthropic")) return "CLAUDE";
  if (lowered.includes("grok") || lowered.includes("xai") || lowered.includes("x.ai")) return "GROK";
  return raw.toUpperCase().slice(0, 40);
}

function isExpired(proposal, now = Date.now()) {
  const expiry = dateValue(proposal?.expires_at);
  return Boolean(expiry && expiry.getTime() <= now);
}

function timeRemaining(value) {
  const expiry = dateValue(value);
  if (!expiry) return "NO EXPIRY";
  const milliseconds = expiry.getTime() - Date.now();
  if (milliseconds <= 0) return "EXPIRED";
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${String(remainingMinutes).padStart(2, "0")}m`;
}

function validationRefusals(proposal) {
  const validation = proposal?.validation;
  if (!validation || typeof validation !== "object") return [];
  const candidates = Array.isArray(validation.refusals)
    ? validation.refusals
    : Array.isArray(validation.errors)
      ? validation.errors
      : [];
  return candidates.map((item) => {
    if (typeof item === "string") return { code: "REFUSAL", message: item };
    if (!item || typeof item !== "object") return { code: "REFUSAL", message: "Validation refused this proposal." };
    return {
      code: upper(item.code ?? item.id, "REFUSAL"),
      message: asText(item.message ?? item.reason ?? item.detail, "Validation refused this proposal."),
    };
  });
}

function simulationComplete(proposal) {
  const state = normalizedState(proposal);
  if (FINAL_COMPLETE_STATES.has(state)) return true;
  const simulation = proposal?.simulation;
  if (!simulation || typeof simulation !== "object") return false;
  const simulationState = upper(simulation.state ?? simulation.status, "").replaceAll("-", "_").replaceAll(" ", "_");
  return ["COMPLETE", "COMPLETED", "SIMULATED", "SIMULATION_COMPLETE", "SUCCESS"].includes(simulationState);
}

function isFinalBlocked(proposal) {
  return isExpired(proposal) || FINAL_BLOCKED_STATES.has(normalizedState(proposal));
}

function bucketFor(proposal) {
  if (simulationComplete(proposal)) return "complete";
  if (isFinalBlocked(proposal) || validationRefusals(proposal).length > 0) return "blocked";
  return "pending";
}

function gatewayIsSimulation() {
  const mode = upper(appState.gateway?.mode, "UNKNOWN");
  return ["SIMULATION_ONLY", "SIMULATION", "SIMULATOR", "PAPER"].includes(mode);
}

function eligibilityFor(proposal) {
  const reasons = [];
  if (!proposal) reasons.push("Select a proposal first.");
  if (!gatewayIsSimulation()) reasons.push("Gateway mode is not simulation.");
  if (appState.gateway?.live_execution !== false) reasons.push("Live execution must remain disabled.");
  if (appState.gateway?.kill_switch !== false) reasons.push("All order actions are blocked. Unlock the simulator first.");
  if (proposal?.validation?.ok !== true) reasons.push("Contract validation has not passed.");
  if (validationRefusals(proposal).length) reasons.push("The proposal has one or more named refusals.");
  if (isExpired(proposal)) reasons.push("The proposal has expired. A fresh proposal is required.");
  if (isFinalBlocked(proposal)) reasons.push("This proposal is in a final blocked state.");
  if (simulationComplete(proposal)) reasons.push("This proposal already has a completed simulation receipt.");
  if (!asText(proposal?.confirmation_text, "").trim()) reasons.push("No bound confirmation text was issued.");
  if (!asText(proposal?.order_hash, "").trim()) reasons.push("The frozen order fingerprint is missing.");
  return { ok: reasons.length === 0, reasons };
}

function setText(node, value) {
  if (node) node.textContent = asText(value);
}

function replaceChildren(node, children = []) {
  node.replaceChildren(...children);
}

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = asText(text);
  return node;
}

function showToast(message, isError = false) {
  clearTimeout(appState.toastTimer);
  elements.toast.textContent = asText(message, "Status updated.");
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.classList.add("is-visible");
  appState.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 4200);
}

async function api(path, options = {}) {
  const method = upper(options.method, "GET");
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  const init = {
    method,
    headers,
    credentials: "same-origin",
    signal: options.signal,
  };
  if (appState.owner.session_token) headers["x-xecutor-owner"] = appState.owner.session_token;

  if (method !== "GET" && method !== "HEAD") {
    const csrfRequired = options.csrf !== false;
    if (csrfRequired && !appState.csrf) throw new Error("The local approval session is missing its CSRF token. Refresh before acting.");
    headers["Content-Type"] = "application/json";
    if (csrfRequired) headers["x-xecutor-csrf"] = appState.csrf;
    init.body = JSON.stringify(options.body || {});
  }

  const response = await fetch(path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object"
      ? payload.error ?? payload.reason ?? payload.message
      : null;
    const error = new Error(asText(message, `Request failed (${response.status}).`));
    error.status = response.status;
    error.code = payload && typeof payload === "object" ? payload.code : null;
    throw error;
  }
  return payload;
}

function clearOwnerData() {
  appState.owner.authenticated = false;
  appState.owner.session_expires_at = null;
  appState.owner.session_token = "";
  appState.csrf = "";
  appState.gateway = { mode: "unknown", kill_switch: true, live_execution: false, policy_version: "—" };
  appState.proposals = [];
  appState.audit = [];
  appState.selectedAudit = [];
  appState.selectedId = null;
  appState.selectedProposal = null;
  appState.selectionToken += 1;
  elements.proposalList.replaceChildren();
  elements.orderDetails.replaceChildren();
  elements.gateList.replaceChildren();
  elements.timeline.replaceChildren();
  elements.globalAuditBody.replaceChildren();
  renderAll();
}

function showOwnerGate({ configured = false, message = "Owner authentication required.", isError = false } = {}) {
  appState.owner.configured = configured;
  appState.owner.authenticated = false;
  appState.owner.session_expires_at = null;
  document.body.classList.add("owner-pending");
  document.body.classList.remove("owner-authenticated");
  elements.ownerSetup.hidden = configured;
  elements.ownerLoginForm.hidden = !configured;
  elements.ownerGateStatus.classList.toggle("is-error", isError);
  setText(elements.ownerGateStatus, message);
  elements.ownerLoginButton.disabled = false;
  elements.ownerRecheckButton.disabled = false;
  if (configured) requestAnimationFrame(() => elements.ownerCode.focus());
}

function showOwnerConsole() {
  appState.owner.authenticated = true;
  document.body.classList.remove("owner-pending");
  document.body.classList.add("owner-authenticated");
  elements.ownerCode.value = "";
}

async function bootstrapOwner() {
  document.body.classList.add("owner-pending");
  document.body.classList.remove("owner-authenticated");
  elements.ownerSetup.hidden = true;
  elements.ownerLoginForm.hidden = true;
  setText(elements.ownerGateStatus, "Checking owner access…");
  elements.ownerGateStatus.classList.remove("is-error");

  try {
    const payload = await api("/api/owner/status");
    const configured = payload?.configured === true;
    const authenticated = payload?.authenticated === true;
    appState.owner = {
      configured,
      authenticated,
      session_expires_at: payload?.session_expires_at ?? null,
      session_token: appState.owner.session_token,
    };

    if (!authenticated) {
      clearOwnerData();
      showOwnerGate({
        configured,
        message: configured
          ? "Enter the local owner approval code to open proposal details."
          : "Owner approval has not been configured on this PC.",
      });
      return;
    }

    showOwnerConsole();
    await loadSession();
    await refreshProposals({ silent: true });
  } catch (error) {
    clearOwnerData();
    showOwnerGate({
      configured: false,
      message: `Owner access check failed: ${error.message}`,
      isError: true,
    });
  }
}

async function submitOwnerLogin(event) {
  event.preventDefault();
  const code = elements.ownerCode.value;
  elements.ownerCode.value = "";
  if (!code) {
    showOwnerGate({ configured: true, message: "Enter the owner approval code.", isError: true });
    return;
  }

  elements.ownerLoginButton.disabled = true;
  setText(elements.ownerGateStatus, "Checking the owner approval code…");
  elements.ownerGateStatus.classList.remove("is-error");
  try {
    const payload = await api("/api/owner/login", {
      method: "POST",
      body: { code },
      csrf: false,
    });
    if (typeof payload?.owner_session !== "string" || payload.owner_session.length < 32) {
      throw new Error("The local gateway did not return an owner session proof.");
    }
    appState.owner.session_token = payload.owner_session;
    await bootstrapOwner();
  } catch (error) {
    showOwnerGate({ configured: true, message: `Owner login refused: ${error.message}`, isError: true });
  } finally {
    elements.ownerLoginButton.disabled = false;
  }
}

async function logoutOwner() {
  elements.ownerLogoutButton.disabled = true;
  try {
    await api("/api/owner/logout", { method: "POST", body: {} });
    clearOwnerData();
    showOwnerGate({ configured: true, message: "Logged out. Enter the owner approval code to return." });
  } catch (error) {
    clearOwnerData();
    showOwnerGate({ configured: true, message: `The console was hidden, but logout could not be confirmed: ${error.message}`, isError: true });
  } finally {
    elements.ownerLogoutButton.disabled = false;
  }
}

function proposalsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.proposals)) return payload.proposals;
  return [];
}

function auditFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.audit)) return payload.audit;
  if (Array.isArray(payload?.events)) return payload.events;
  return [];
}

function proposalFrom(payload) {
  if (payload?.proposal && typeof payload.proposal === "object") return payload.proposal;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  return null;
}

function proposalById(id) {
  return appState.proposals.find((proposal) => asText(proposal?.id, "") === asText(id, "")) || null;
}

function mergeProposal(current, next) {
  if (!current) return next;
  if (!next) return current;
  return {
    ...current,
    ...next,
    handoff: next.handoff && typeof next.handoff === "object" ? next.handoff : current.handoff,
    validation: next.validation && typeof next.validation === "object" ? next.validation : current.validation,
    approval: next.approval && typeof next.approval === "object" ? next.approval : current.approval,
    simulation: next.simulation && typeof next.simulation === "object" ? next.simulation : current.simulation,
  };
}

function updateProposalInList(proposal) {
  if (!proposal) return;
  const id = asText(proposal.id, "");
  const index = appState.proposals.findIndex((item) => asText(item?.id, "") === id);
  if (index >= 0) appState.proposals[index] = mergeProposal(appState.proposals[index], proposal);
  else appState.proposals.unshift(proposal);
}

function renderSystem() {
  const mode = upper(appState.gateway?.mode, "UNKNOWN");
  setText(elements.gatewayMode, mode);
  elements.gatewayMode.className = gatewayIsSimulation() ? "safe-text" : "danger-text";

  const liveDisabled = appState.gateway?.live_execution === false;
  setText(elements.liveStatus, liveDisabled ? "DISABLED" : "UNSAFE STATE");
  elements.liveStatus.className = liveDisabled ? "safe-text" : "danger-text";
  setText(elements.policyVersion, appState.gateway?.policy_version ?? "NOT REPORTED");
  setText(elements.proposalCount, `${appState.proposals.length} TOTAL`);

  const blocked = appState.gateway?.kill_switch !== false;
  setText(elements.killStatus, blocked ? "ALL BLOCKED" : "SIMULATOR UNLOCKED");
  elements.killStatus.className = blocked ? "danger-text" : "";
  setText(elements.killButton, blocked ? "UNLOCK SIMULATOR" : "BLOCK ALL");
  elements.killButton.disabled = appState.loading || appState.busy;
  elements.killButton.classList.toggle("danger-button", !blocked);
  elements.killButton.classList.toggle("secondary-button", blocked);

  elements.railLight.classList.toggle("is-ready", !blocked && liveDisabled && gatewayIsSimulation());
  setText(elements.railStateText, blocked ? "BLOCKED" : "SIM READY");
  elements.demoButton.disabled = appState.loading || appState.busy || blocked;

  if (blocked && elements.approvalDialog.open) {
    elements.approvalDialog.close();
    elements.confirmationInput.value = "";
  }
}

function updateCounts() {
  const counts = { pending: 0, blocked: 0, complete: 0, all: appState.proposals.length };
  for (const proposal of appState.proposals) counts[bucketFor(proposal)] += 1;
  setText(elements.pendingCount, counts.pending);
  setText(elements.blockedCount, counts.blocked);
  setText(elements.completeCount, counts.complete);
  setText(elements.allCount, counts.all);
}

function orderDescription(proposal) {
  const handoff = handoffOf(proposal);
  const mode = upper(handoff.quantity_mode, "QUANTITY");
  const quantity = asText(handoff.quantity_value, "?");
  const orderType = upper(handoff.order_type, "ORDER");
  const limit = Number(handoff.limit_price);
  const limitText = Number.isFinite(limit) ? ` @ ${formatMoney(limit)}` : "";
  return `${upper(handoff.action, "ACTION")} ${quantity} ${mode}${limitText} ${orderType}`;
}

function visibleProposals() {
  if (appState.filter === "all") return appState.proposals;
  return appState.proposals.filter((proposal) => bucketFor(proposal) === appState.filter);
}

function renderQueue() {
  updateCounts();
  const proposals = visibleProposals();
  const rows = [];

  proposals.forEach((proposal) => {
    const wrapper = createElement("div", "proposal-row-wrap");
    wrapper.setAttribute("role", "listitem");

    const button = createElement("button", "proposal-row");
    button.type = "button";
    button.dataset.proposalId = asText(proposal.id, "");
    const selected = asText(proposal.id, "") === asText(appState.selectedId, "");
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.setAttribute("aria-label", `${sourceLabel(proposal.source_client)} proposal for ${upper(handoffOf(proposal).ticker, "unknown ticker")}, ${normalizedState(proposal)}`);

    const source = createElement("span", "proposal-source", sourceLabel(proposal.source_client));
    const state = createElement("span", "proposal-state", normalizedState(proposal).replaceAll("_", " "));
    const bucket = bucketFor(proposal);
    state.classList.add(bucket === "pending" ? "is-ready" : bucket === "complete" ? "is-complete" : "is-blocked");

    const ticker = createElement("strong", "proposal-ticker", `$${upper(handoffOf(proposal).ticker, "—")}`);
    const description = createElement("span", "proposal-description", orderDescription(proposal));
    const meta = createElement("span", "proposal-meta");
    const maximum = maximumNotional(proposal);
    const cost = createElement("span", "", `MAX ${maximum === null ? "NOT PROVIDED" : formatMoney(maximum)}`);
    const expiry = createElement("span", "countdown", timeRemaining(proposal.expires_at));
    expiry.dataset.expiresAt = asText(proposal.expires_at, "");
    meta.append(cost, expiry);

    button.append(source, state, ticker, description, meta);
    button.addEventListener("click", () => selectProposal(proposal.id));
    button.addEventListener("keydown", handleQueueArrowKey);
    wrapper.appendChild(button);
    rows.push(wrapper);
  });

  replaceChildren(elements.proposalList, rows);
  elements.emptyQueue.hidden = proposals.length > 0;
  elements.proposalList.hidden = proposals.length === 0;
  setText(
    elements.queueStatus,
    appState.loading ? "Loading proposals…" : `${proposals.length} ${appState.filter.toUpperCase()} PROPOSAL${proposals.length === 1 ? "" : "S"}`
  );
}

function handleQueueArrowKey(event) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = all(".proposal-row", elements.proposalList);
  if (!buttons.length) return;
  event.preventDefault();
  const index = buttons.indexOf(event.currentTarget);
  let next = index;
  if (event.key === "ArrowDown") next = Math.min(buttons.length - 1, index + 1);
  if (event.key === "ArrowUp") next = Math.max(0, index - 1);
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = buttons.length - 1;
  buttons[next].focus();
}

function appendDetail(list, label, value) {
  const pair = createElement("div", "detail-pair");
  const term = createElement("dt", "detail-label", label);
  const definition = createElement("dd", "", value);
  pair.append(term, definition);
  list.appendChild(pair);
}

function gateItem(label, detail, passed) {
  const item = createElement("div", "gate-item");
  item.classList.toggle("is-failed", !passed);
  const state = createElement("span", "gate-state", passed ? "PASS" : "BLOCK");
  const copy = createElement("div", "gate-copy");
  const title = createElement("strong", "", label);
  const message = createElement("span", "", detail);
  copy.append(title, message);
  item.append(state, copy);
  return item;
}

function statePresentation(proposal) {
  if (simulationComplete(proposal)) return { label: "SIMULATION COMPLETE", className: "complete" };
  if (isFinalBlocked(proposal) || validationRefusals(proposal).length) return { label: normalizedState(proposal).replaceAll("_", " "), className: "blocked" };
  if (eligibilityFor(proposal).ok) return { label: "READY FOR REVIEW", className: "ready" };
  return { label: normalizedState(proposal).replaceAll("_", " "), className: "neutral" };
}

function renderReview() {
  const proposal = appState.selectedProposal;
  const hasProposal = Boolean(proposal);
  elements.reviewEmpty.hidden = hasProposal;
  elements.reviewContent.hidden = !hasProposal;

  if (!proposal) {
    setText(elements.reviewTitle, "Select a proposal.");
    setText(elements.reviewState, "NO SELECTION");
    elements.reviewState.className = "state-badge neutral";
    renderLedger();
    return;
  }

  const handoff = handoffOf(proposal);
  const ticker = upper(handoff.ticker, "—");
  setText(elements.reviewTitle, `Review $${ticker}.`);
  const presentation = statePresentation(proposal);
  setText(elements.reviewState, presentation.label);
  elements.reviewState.className = `state-badge ${presentation.className}`;

  setText(elements.identityId, proposal.id);
  setText(elements.identitySource, sourceLabel(proposal.source_client));
  setText(elements.identityExpiry, `${timeRemaining(proposal.expires_at)} / ${formatStamp(proposal.expires_at)}`);
  elements.identityExpiry.dataset.expiresAt = asText(proposal.expires_at, "");

  setText(elements.orderAction, `${upper(handoff.action, "ACTION")} / ${upper(handoff.asset_class, "ASSET")}`);
  setText(elements.orderTitle, `$${ticker}`);
  const notional = maximumNotional(proposal);
  setText(elements.orderNotional, notional === null ? "NOT PROVIDED" : formatMoney(notional));

  elements.orderDetails.replaceChildren();
  const details = [
    ["PLAN ID", handoff.plan_id],
    ["ROW ID", handoff.row_id],
    ["ACCOUNT ALIAS", safeAccountAlias(handoff.account_alias)],
    ["STRUCTURE", upper(handoff.structure, "NOT PROVIDED")],
    ["QUANTITY", `${asText(handoff.quantity_value, "NOT PROVIDED")} ${upper(handoff.quantity_mode, "")}`.trim()],
    ["ORDER TYPE", upper(handoff.order_type, "NOT PROVIDED")],
    ["LIMIT", formatMoney(handoff.limit_price)],
    ["TIME IN FORCE", upper(handoff.time_in_force, "NOT PROVIDED")],
    ["SESSION", upper(handoff.session, "NOT PROVIDED")],
    ["PLANNED RISK", formatMoney(handoff.planned_dollar_risk)],
    ["INVALIDATION", Number.isFinite(Number(handoff.invalidation_price)) ? formatMoney(handoff.invalidation_price) : asText(handoff.invalidation_price, "NOT PROVIDED")],
    ["EXIT OWNER", upper(handoff.exit_owner, "NOT PROVIDED")],
    ["MAX DRIFT", asText(handoff.maximum_price_drift, "NOT PROVIDED")],
    ["ORDER FINGERPRINT", asText(proposal.order_hash, "MISSING")],
    ["CLIENT SUBMISSION", asText(proposal.client_submission_id, "NOT PROVIDED")],
  ];
  details.forEach(([label, value]) => appendDetail(elements.orderDetails, label, value));

  const validationPassed = proposal.validation?.ok === true && validationRefusals(proposal).length === 0;
  const gates = [
    ["SIMULATION BOUNDARY", appState.gateway?.live_execution === false && gatewayIsSimulation() ? "Live placement is absent and mode is simulation." : "Gateway mode or live-execution state is unsafe.", appState.gateway?.live_execution === false && gatewayIsSimulation()],
    ["GLOBAL ORDER BLOCK", appState.gateway?.kill_switch === false ? "Simulator is deliberately unlocked." : "All order actions are blocked.", appState.gateway?.kill_switch === false],
    ["CONTRACT VALIDATION", validationPassed ? "The normalized handoff passed server validation." : "Contract validation has not passed.", validationPassed],
    ["FRESHNESS", isExpired(proposal) ? "Proposal expired; a new proposal is required." : `Proposal expires ${formatStamp(proposal.expires_at)}.`, !isExpired(proposal)],
    ["IMMUTABLE ORDER", proposal.order_hash ? "A frozen order fingerprint is present." : "Order fingerprint is missing.", Boolean(proposal.order_hash)],
    ["HUMAN BINDING", proposal.confirmation_text ? "Fresh exact confirmation text is available." : "Confirmation text is missing.", Boolean(proposal.confirmation_text)],
  ];

  const refusalGates = validationRefusals(proposal).map((refusal) => [refusal.code, refusal.message, false]);
  replaceChildren(elements.gateList, [...gates, ...refusalGates].map(([label, detail, passed]) => gateItem(label, detail, passed)));

  const eligibility = eligibilityFor(proposal);
  setText(elements.gateVerdict, eligibility.ok ? "ALL GATES PASS" : `${eligibility.reasons.length} BLOCK${eligibility.reasons.length === 1 ? "" : "S"}`);
  elements.gateVerdict.className = `gate-verdict ${eligibility.ok ? "is-ready" : "is-blocked"}`;

  let message = "Every gate passed. Review the exact simulation before typing confirmation.";
  if (!eligibility.ok) message = eligibility.reasons[0];
  if (simulationComplete(proposal)) message = "This proposal already produced a simulation receipt. No broker order was created.";
  setText(elements.reviewMessage, message);
  elements.reviewMessage.classList.toggle("is-blocked", !eligibility.ok);

  elements.reviewButton.disabled = !eligibility.ok || appState.busy;
  elements.rejectButton.disabled = isFinalBlocked(proposal) || simulationComplete(proposal) || appState.busy;
  renderLedger();
}

function eventStamp(event) {
  return event?.at ?? event?.created_at ?? event?.timestamp ?? event?.ts ?? event?.updated_at;
}

function eventName(event) {
  return upper(event?.event_type ?? event?.event ?? event?.kind ?? event?.type ?? event?.action ?? event?.state, "RECORDED EVENT").replaceAll("-", "_");
}

function eventActor(event) {
  return asText(event?.actor ?? event?.source_client ?? event?.source, "SYSTEM");
}

function eventProposalId(event) {
  return asText(event?.proposal_id ?? event?.proposal?.id ?? event?.target_id, "—");
}

function eventDetail(event) {
  const candidates = [event?.message, event?.reason, event?.detail, event?.decision, event?.description, event?.state];
  for (const candidate of candidates) {
    if (["string", "number", "boolean"].includes(typeof candidate)) return asText(candidate);
  }
  const detail = event?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    if (typeof detail.reason === "string") return detail.reason;
    if (Array.isArray(detail.refusals)) {
      const codes = detail.refusals.map((item) => typeof item === "string" ? item : item?.code).filter(Boolean);
      if (codes.length) return `Refused: ${codes.join(", ")}`;
    }
    if (typeof detail.simulated_order_id === "string") {
      return `${detail.simulated_order_id} / NO BROKER ORDER CREATED`;
    }
    if (typeof detail.receipt_file === "string") return "Simulation receipt persisted.";
    if (typeof detail.policy_version === "string") return `Policy ${detail.policy_version}`;
    if (typeof detail.client_submission_id === "string") return `Client submission ${detail.client_submission_id}`;
    if (typeof detail.mode === "string") return `Mode ${detail.mode}`;
  }
  return "Recorded by the gateway.";
}

function timestampNumber(event) {
  return dateValue(eventStamp(event))?.getTime() ?? 0;
}

function renderLedger() {
  const proposal = appState.selectedProposal;
  if (!proposal) {
    elements.simulationBanner.hidden = true;
    elements.ledgerEmpty.hidden = false;
    elements.timeline.hidden = true;
    elements.timeline.replaceChildren();
    return;
  }

  const complete = simulationComplete(proposal);
  elements.simulationBanner.hidden = !complete;
  if (complete) {
    const receipt = proposal.simulation?.receipt_id ?? proposal.simulation?.id ?? proposal.approval?.receipt_id;
    const stamp = proposal.simulation?.simulated_at ?? proposal.simulation?.completed_at ?? proposal.simulation?.created_at ?? proposal.updated_at;
    setText(elements.simulationDetail, `${receipt ? `RECEIPT ${receipt} / ` : ""}${formatStamp(stamp)}`);
  }

  const events = [...appState.selectedAudit].sort((a, b) => timestampNumber(a) - timestampNumber(b));
  elements.ledgerEmpty.hidden = events.length > 0;
  elements.timeline.hidden = events.length === 0;

  const items = events.map((event, index) => {
    const item = createElement("li", "timeline-item");
    const number = createElement("span", "timeline-index", String(index + 1).padStart(2, "0"));
    const copy = createElement("div", "timeline-copy");
    const title = createElement("strong", "", eventName(event).replaceAll("_", " "));
    const detail = createElement("p", "", eventDetail(event));
    const time = createElement("span", "timeline-time", `${formatStamp(eventStamp(event))} / ${eventActor(event)}`);
    copy.append(title, detail, time);
    item.append(number, copy);
    return item;
  });
  replaceChildren(elements.timeline, items);
}

function appendAuditCell(row, label, value) {
  const cell = createElement("span", "");
  const mobileLabel = createElement("b", "audit-cell-label", label);
  const text = createElement("span", "", value);
  cell.append(mobileLabel, text);
  row.appendChild(cell);
}

function renderGlobalAudit() {
  const events = [...appState.audit].sort((a, b) => timestampNumber(b) - timestampNumber(a));
  const rows = events.map((event) => {
    const row = createElement("div", "audit-row");
    row.setAttribute("role", "row");
    appendAuditCell(row, "TIME", formatStamp(eventStamp(event)));
    appendAuditCell(row, "EVENT", eventName(event).replaceAll("_", " "));
    appendAuditCell(row, "ACTOR", eventActor(event));
    appendAuditCell(row, "PROPOSAL", eventProposalId(event));
    appendAuditCell(row, "DETAIL", eventDetail(event));
    return row;
  });
  replaceChildren(elements.globalAuditBody, rows);
  elements.auditEmpty.hidden = rows.length > 0;
  elements.globalAuditBody.hidden = rows.length === 0;
}

function renderAll() {
  renderSystem();
  renderQueue();
  renderReview();
  renderGlobalAudit();
}

async function loadSelectedDetail(id, token) {
  try {
    const [detailPayload, auditPayload] = await Promise.all([
      api(`/api/proposals/${encodeURIComponent(id)}`),
      api(`/api/audit?proposal_id=${encodeURIComponent(id)}&limit=50`),
    ]);
    if (token !== appState.selectionToken) return;
    const detail = proposalFrom(detailPayload);
    if (detail) {
      updateProposalInList(detail);
      appState.selectedProposal = mergeProposal(appState.selectedProposal, detail);
    }
    appState.selectedAudit = auditFrom(auditPayload);
    renderQueue();
    renderReview();
  } catch (error) {
    if (token !== appState.selectionToken) return;
    appState.selectedAudit = [];
    renderLedger();
    showToast(`Proposal detail could not refresh: ${error.message}`, true);
  }
}

async function selectProposal(id, options = {}) {
  const normalizedId = asText(id, "");
  if (!normalizedId) return;
  appState.selectedId = normalizedId;
  appState.selectedProposal = proposalById(normalizedId);
  appState.selectedAudit = appState.audit.filter((event) => eventProposalId(event) === normalizedId);
  appState.selectionToken += 1;
  const token = appState.selectionToken;
  renderQueue();
  renderReview();
  if (options.fetchDetail !== false) await loadSelectedDetail(normalizedId, token);
}

async function loadSession(options = {}) {
  if (!appState.owner.authenticated) return;
  if (!options.silent) {
    appState.loading = true;
    setText(elements.queueStatus, "Loading proposals…");
    renderSystem();
  }

  try {
    const payload = await api("/api/session");
    if (!payload || typeof payload !== "object") throw new Error("The session response was empty.");
    appState.csrf = asText(payload.csrf, "");
    appState.gateway = {
      mode: payload.gateway?.mode ?? "unknown",
      kill_switch: payload.gateway?.kill_switch !== false,
      live_execution: payload.gateway?.live_execution === false ? false : payload.gateway?.live_execution,
      policy_version: payload.gateway?.policy_version ?? "NOT REPORTED",
    };
    appState.proposals = proposalsFrom(payload);
    appState.audit = auditFrom(payload);
    appState.loading = false;

    if (appState.selectedId && proposalById(appState.selectedId)) {
      appState.selectedProposal = mergeProposal(appState.selectedProposal, proposalById(appState.selectedId));
    } else {
      const preferred = appState.proposals.find((proposal) => bucketFor(proposal) === "pending") ?? appState.proposals[0];
      appState.selectedId = preferred ? asText(preferred.id, "") : null;
      appState.selectedProposal = preferred || null;
      appState.selectedAudit = preferred ? appState.audit.filter((event) => eventProposalId(event) === asText(preferred.id, "")) : [];
    }

    renderAll();
    if (appState.selectedId && options.fetchDetail !== false) {
      appState.selectionToken += 1;
      await loadSelectedDetail(appState.selectedId, appState.selectionToken);
    }
  } catch (error) {
    appState.loading = false;
    if (error.status === 401 || error.code === "OWNER_AUTH_REQUIRED") {
      clearOwnerData();
      showOwnerGate({ configured: true, message: "Owner session ended. Enter the approval code again." });
      return;
    }
    appState.gateway = { mode: "unknown", kill_switch: true, live_execution: false, policy_version: "UNAVAILABLE" };
    setText(elements.queueStatus, `Gateway unavailable: ${error.message}`);
    renderSystem();
    renderReview();
    if (!options.silent) showToast(`The Xecutor is locked: ${error.message}`, true);
  }
}

async function refreshProposals(options = {}) {
  if (!appState.owner.authenticated) return;
  try {
    const payload = await api("/api/proposals");
    const incoming = proposalsFrom(payload);
    const previousSelected = appState.selectedProposal;
    appState.proposals = incoming.map((proposal) => {
      if (asText(proposal?.id, "") === asText(previousSelected?.id, "")) {
        return mergeProposal(previousSelected, proposal);
      }
      return proposal;
    });

    if (appState.selectedId && proposalById(appState.selectedId)) {
      appState.selectedProposal = proposalById(appState.selectedId);
    } else {
      const preferred = appState.proposals.find((proposal) => bucketFor(proposal) === "pending") ?? appState.proposals[0];
      appState.selectedId = preferred ? asText(preferred.id, "") : null;
      appState.selectedProposal = preferred || null;
      appState.selectedAudit = preferred ? appState.audit.filter((event) => eventProposalId(event) === asText(preferred.id, "")) : [];
    }

    renderSystem();
    renderQueue();
    renderReview();
  } catch (error) {
    if (error.status === 401 || error.code === "OWNER_AUTH_REQUIRED") {
      clearOwnerData();
      showOwnerGate({ configured: true, message: "Owner session ended. Enter the approval code again." });
      return;
    }
    if (!options.silent) showToast(`Proposal refresh failed: ${error.message}`, true);
  }
}

function setBusy(busy) {
  appState.busy = busy;
  elements.demoButton.disabled = busy;
  elements.refreshAuditButton.disabled = busy;
  renderSystem();
  renderReview();
}

function dialogProposal(dialog) {
  return proposalById(dialog.dataset.proposalId) ?? (asText(appState.selectedProposal?.id, "") === dialog.dataset.proposalId ? appState.selectedProposal : null);
}

function openApprovalDialog() {
  const proposal = appState.selectedProposal;
  const eligibility = eligibilityFor(proposal);
  if (!eligibility.ok) {
    showToast(eligibility.reasons[0], true);
    return;
  }

  const handoff = handoffOf(proposal);
  elements.approvalDialog.dataset.proposalId = asText(proposal.id, "");
  elements.confirmationInput.value = "";
  setText(elements.approvalRequiredText, proposal.confirmation_text);
  elements.approvalSummary.replaceChildren();
  const notional = maximumNotional(proposal);
  [
    ["SOURCE BOT", sourceLabel(proposal.source_client)],
    ["PLAN ID", handoff.plan_id],
    ["ORDER", `${upper(handoff.action, "ACTION")} $${upper(handoff.ticker, "—")}`],
    ["QUANTITY", `${asText(handoff.quantity_value, "—")} ${upper(handoff.quantity_mode, "")}`.trim()],
    ["LIMIT / TIF", `${formatMoney(handoff.limit_price)} / ${upper(handoff.time_in_force, "—")}`],
    ["MAXIMUM NOTIONAL", notional === null ? "NOT PROVIDED" : formatMoney(notional)],
    ["ACCOUNT ALIAS", safeAccountAlias(handoff.account_alias)],
    ["FINGERPRINT", asText(proposal.order_hash, "MISSING")],
  ].forEach(([label, value]) => appendDetail(elements.approvalSummary, label, value));
  updateApprovalMatch();
  elements.approvalDialog.showModal();
  requestAnimationFrame(() => elements.approvalTitle.focus());
}

function updateApprovalMatch() {
  const proposal = dialogProposal(elements.approvalDialog);
  const required = asText(proposal?.confirmation_text, "");
  const matches = Boolean(required) && elements.confirmationInput.value === required;
  const eligible = eligibilityFor(proposal).ok;
  elements.approveButton.disabled = !matches || !eligible || appState.busy;
  elements.confirmationHelp.classList.toggle("is-match", matches && eligible);
  setText(
    elements.confirmationHelp,
    matches && eligible
      ? "Exact match. One activation will create one simulation receipt."
      : "The approval button remains locked until the text matches exactly."
  );
  const notional = maximumNotional(proposal);
  setText(elements.approveButton, `APPROVE ${notional === null ? "" : `${formatMoney(notional)} `}SIMULATION`.replace("  ", " "));
}

function openRejectDialog() {
  const proposal = appState.selectedProposal;
  if (!proposal || isFinalBlocked(proposal) || simulationComplete(proposal)) {
    showToast("This proposal can no longer be rejected from the inbox.", true);
    return;
  }
  elements.rejectDialog.dataset.proposalId = asText(proposal.id, "");
  elements.rejectReason.value = "";
  elements.rejectDialog.showModal();
  requestAnimationFrame(() => elements.rejectTitle.focus());
}

function openUnlockDialog() {
  elements.unlockInput.value = "";
  elements.unlockButton.disabled = true;
  elements.unlockDialog.showModal();
  requestAnimationFrame(() => elements.unlockTitle.focus());
}

async function submitApproval(event) {
  event.preventDefault();
  const proposal = dialogProposal(elements.approvalDialog);
  const confirmation = elements.confirmationInput.value;
  if (!proposal || confirmation !== asText(proposal.confirmation_text, "") || !eligibilityFor(proposal).ok) {
    showToast("Approval refused: the exact confirmation or gate state changed.", true);
    updateApprovalMatch();
    return;
  }

  setBusy(true);
  elements.approveButton.disabled = true;
  try {
    await api(`/api/proposals/${encodeURIComponent(proposal.id)}/approve`, {
      method: "POST",
      body: { confirmation },
    });
    elements.approvalDialog.close();
    elements.confirmationInput.value = "";
    showToast("SIMULATION COMPLETE — NO BROKER ORDER WAS CREATED.");
    await loadSession({ silent: true });
  } catch (error) {
    showToast(`Simulation approval refused: ${error.message}`, true);
  } finally {
    setBusy(false);
    updateApprovalMatch();
  }
}

async function submitReject(event) {
  event.preventDefault();
  const proposal = dialogProposal(elements.rejectDialog);
  if (!proposal || isFinalBlocked(proposal) || simulationComplete(proposal)) {
    showToast("This proposal is already final.", true);
    elements.rejectDialog.close();
    return;
  }

  setBusy(true);
  try {
    await api(`/api/proposals/${encodeURIComponent(proposal.id)}/reject`, {
      method: "POST",
      body: { reason: elements.rejectReason.value.trim() },
    });
    elements.rejectDialog.close();
    showToast("Proposal rejected. It cannot be revived.");
    await loadSession({ silent: true });
  } catch (error) {
    showToast(`Proposal rejection failed: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function submitUnlock(event) {
  event.preventDefault();
  if (elements.unlockInput.value !== "UNLOCK SIMULATOR") return;
  setBusy(true);
  try {
    await api("/api/kill-switch", { method: "POST", body: { enabled: false } });
    elements.unlockDialog.close();
    elements.unlockInput.value = "";
    showToast("Simulator unlocked. Live placement remains disabled.");
    broadcastGatewayChange();
    await loadSession({ silent: true });
  } catch (error) {
    showToast(`Simulator remains blocked: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function blockAll() {
  setBusy(true);
  try {
    await api("/api/kill-switch", { method: "POST", body: { enabled: true } });
    if (elements.approvalDialog.open) elements.approvalDialog.close();
    showToast("All order actions are blocked.");
    broadcastGatewayChange();
    await loadSession({ silent: true });
  } catch (error) {
    showToast(`Could not confirm the server lock: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function handleKillSwitch() {
  if (appState.gateway?.kill_switch !== false) openUnlockDialog();
  else await blockAll();
}

async function loadDemo() {
  setBusy(true);
  try {
    await api("/api/demo", { method: "POST", body: {} });
    showToast("Safe simulation proposals loaded.");
    await loadSession({ silent: true });
  } catch (error) {
    showToast(`Demo proposals could not load: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function refreshAudit() {
  if (!appState.owner.authenticated) return;
  elements.refreshAuditButton.disabled = true;
  try {
    const payload = await api("/api/audit?limit=200");
    appState.audit = auditFrom(payload);
    renderGlobalAudit();
    showToast("Audit trail refreshed.");
  } catch (error) {
    showToast(`Audit refresh failed: ${error.message}`, true);
  } finally {
    elements.refreshAuditButton.disabled = appState.busy;
  }
}

function setView(view) {
  appState.view = view;
  all(".nav-button").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  all(".view").forEach((section) => section.classList.toggle("is-active", section.id === `view-${view}`));
  if (view === "audit") refreshAudit();
  byId("main-content").focus({ preventScroll: true });
}

function setFilter(filter) {
  appState.filter = filter;
  all(".filter-button").forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  renderQueue();
}

function updateCountdowns() {
  const ownerExpiry = dateValue(appState.owner.session_expires_at);
  if (appState.owner.authenticated && ownerExpiry && ownerExpiry.getTime() <= Date.now()) {
    clearOwnerData();
    showOwnerGate({ configured: true, message: "Owner session expired. Enter the approval code again." });
    return;
  }

  all("[data-expires-at]").forEach((node) => {
    node.textContent = timeRemaining(node.dataset.expiresAt);
  });

  let newlyExpired = false;
  appState.proposals.forEach((proposal) => {
    const id = asText(proposal.id, "");
    if (id && isExpired(proposal) && !appState.announcedExpired.has(id)) {
      appState.announcedExpired.add(id);
      newlyExpired = true;
    }
  });
  if (newlyExpired) {
    renderQueue();
    renderReview();
    showToast("A proposal expired. It can no longer be approved.", true);
  }
}

let gatewayChannel = null;
try {
  gatewayChannel = new BroadcastChannel("the-xecutor-gateway");
  gatewayChannel.addEventListener("message", () => {
    if (appState.owner.authenticated) loadSession({ silent: true });
  });
} catch {
  gatewayChannel = null;
}

function broadcastGatewayChange() {
  if (gatewayChannel) gatewayChannel.postMessage({ type: "gateway-state-changed" });
}

function wireEvents() {
  elements.ownerLoginForm.addEventListener("submit", submitOwnerLogin);
  elements.ownerRecheckButton.addEventListener("click", bootstrapOwner);
  elements.ownerLogoutButton.addEventListener("click", logoutOwner);
  all(".nav-button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  all(".filter-button").forEach((button) => button.addEventListener("click", () => setFilter(button.dataset.filter)));
  elements.killButton.addEventListener("click", handleKillSwitch);
  elements.demoButton.addEventListener("click", loadDemo);
  elements.refreshAuditButton.addEventListener("click", refreshAudit);
  elements.reviewButton.addEventListener("click", openApprovalDialog);
  elements.rejectButton.addEventListener("click", openRejectDialog);

  elements.confirmationInput.addEventListener("input", updateApprovalMatch);
  elements.approvalForm.addEventListener("submit", submitApproval);
  elements.cancelApprovalButton.addEventListener("click", () => {
    elements.confirmationInput.value = "";
    elements.approvalDialog.close();
  });

  elements.rejectForm.addEventListener("submit", submitReject);
  elements.cancelRejectButton.addEventListener("click", () => elements.rejectDialog.close());

  elements.unlockInput.addEventListener("input", () => {
    elements.unlockButton.disabled = elements.unlockInput.value !== "UNLOCK SIMULATOR" || appState.busy;
  });
  elements.unlockForm.addEventListener("submit", submitUnlock);
  elements.cancelUnlockButton.addEventListener("click", () => elements.unlockDialog.close());

  [elements.approvalDialog, elements.rejectDialog, elements.unlockDialog].forEach((dialog) => {
    dialog.addEventListener("close", () => {
      if (dialog === elements.approvalDialog) elements.confirmationInput.value = "";
      if (dialog === elements.unlockDialog) elements.unlockInput.value = "";
    });
  });
}

wireEvents();
bootstrapOwner();
setInterval(updateCountdowns, 1000);
setInterval(() => {
  if (!document.hidden && !appState.busy && appState.owner.authenticated) refreshProposals({ silent: true });
}, 8000);
setInterval(() => {
  if (!document.hidden && !appState.busy && appState.owner.authenticated) loadSession({ silent: true, fetchDetail: false });
}, 30000);
