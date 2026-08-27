// executor-validate.mjs — Bench Executor v1 contract validation (zero-dep, Node >=18)
// Validates a bench-execution-handoff-v1 object. Collects EVERY refusal, fail-closed.
// CLI: node scripts/executor-validate.mjs <handoff.json> [--receipts executor-tests/receipts]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const HARD_TEST_CEILING_USD = 5.0;          // per-order notional, v1. Change only by reviewed commit.
export const MAX_FUNDED_TEST_BALANCE_USD = 10.0;   // operator checklist assumption; buying-power check still runs live.
export const ALLOWED_ACTIONS = ['BUY', 'SELL_TO_CLOSE'];
export const ALLOWED_LANES = ['base_swing', 'accumulation'];
export const ALLOWED_EXIT_OWNERS = ['MANUAL', 'SEPARATE_STOP_ORDER'];
export const SCHEMA_VERSION = 'bench-execution-handoff-v1';
export const EXECUTOR_VERSION = 'bench-executor-v1';
export const FRAMEWORK_VERSION = 'v26';
export const AUTOMATIC_RETRY_ALLOWED = false;      // there is no automatic retry path in v1.

export const RECEIPT_STATES = [
  'RECEIVED', 'PREFLIGHT_REFUSED', 'REVIEWED', 'CONFIRMED', 'PLACEMENT_ATTEMPTED',
  'PENDING', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCEL_REQUESTED', 'CANCELED',
  'UNKNOWN_REQUIRES_RECONCILIATION',
];

const REQUIRED_FIELDS = [
  'schema_version', 'plan_id', 'row_id', 'framework_version', 'executor_version',
  'created_at', 'expires_at', 'account_alias', 'asset_class', 'ticker', 'action',
  'lane', 'structure', 'quantity_mode', 'quantity_value', 'order_type', 'limit_price',
  'time_in_force', 'session', 'invalidation_price', 'planned_dollar_risk',
  'executor_absolute_ceiling', 'maximum_price_drift', 'exit_owner',
  'concentrated', 'leveraged_product', 'conviction_bet',
];

// Alias keys that would smuggle a second quantity mode in beside the canonical pair.
const QUANTITY_ALIAS_KEYS = ['notional', 'shares', 'dollar_amount', 'share_count', 'qty', 'quantity_shares', 'quantity_notional'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPos = (v) => isNum(v) && v > 0;

export function sanitizePlanId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '-');
}

export function checkDuplicate(planId, receiptsDir) {
  if (!receiptsDir || !existsSync(receiptsDir)) return { duplicate: false, reason: null };
  const sanitized = sanitizePlanId(planId);
  for (const f of readdirSync(receiptsDir)) {
    if (!f.endsWith('.json')) continue;
    if (f.startsWith(sanitized)) return { duplicate: true, reason: `receipt file ${f}` };
    try {
      const r = JSON.parse(readFileSync(join(receiptsDir, f), 'utf8'));
      if (r && r.plan_id === planId) return { duplicate: true, reason: `receipt ${f} carries this plan_id` };
    } catch {
      // Fail closed: an unreadable receipt blocks placement until a human resolves it.
      return { duplicate: true, reason: `unreadable receipt ${f} — resolve before any placement` };
    }
  }
  return { duplicate: false, reason: null };
}

export function computedNotional(h) {
  if (h.quantity_mode === 'notional') return isPos(h.quantity_value) ? h.quantity_value : NaN;
  if (h.quantity_mode === 'shares') return isPos(h.quantity_value) && isPos(h.limit_price) ? h.quantity_value * h.limit_price : NaN;
  return NaN;
}

const DRIFT_RE = /^\$?\d+(\.\d+)?\s*%?$/;

export function validateHandoff(h, { now = new Date(), receiptsDir = null, clockSkewMs = 5 * 60 * 1000 } = {}) {
  const refusals = [];
  const add = (code, message) => refusals.push({ code, message });

  if (!h || typeof h !== 'object' || Array.isArray(h)) {
    return { ok: false, refusals: [{ code: 'R01_MISSING_FIELD', message: 'handoff is not an object' }] };
  }

  // R09 first: the forbidden field is a refusal even if everything else is present.
  if ('side' in h) add('R09_SIDE_FIELD_PRESENT', '`side` is forbidden — use action: BUY | SELL_TO_CLOSE');

  for (const k of REQUIRED_FIELDS) {
    if (!(k in h) || h[k] === null || h[k] === undefined || h[k] === '') {
      add('R01_MISSING_FIELD', `missing required field: ${k} (never inferred)`);
    }
  }

  if (h.schema_version !== undefined && h.schema_version !== SCHEMA_VERSION) {
    add('R15_SCHEMA_VERSION_UNKNOWN', `schema_version must be ${SCHEMA_VERSION}`);
  }
  if ((h.executor_version !== undefined && h.executor_version !== EXECUTOR_VERSION) ||
      (h.framework_version !== undefined && h.framework_version !== FRAMEWORK_VERSION)) {
    add('R20_VERSION_MISMATCH', `executor_version must be ${EXECUTOR_VERSION} and framework_version ${FRAMEWORK_VERSION}`);
  }

  // row_id — a real archived row, never Pending.
  if (h.row_id !== undefined) {
    if (/pending/i.test(String(h.row_id)) || !/^B-\d+$/.test(String(h.row_id))) {
      add('R02_PENDING_ROW_ID', 'row_id must be a real archived row (B-###); "Pending Archive ID" refuses');
    }
  }

  // Staleness — unparseable dates fail closed.
  const created = Date.parse(h.created_at);
  const expires = Date.parse(h.expires_at);
  if (h.created_at !== undefined && Number.isNaN(created)) add('R04_STALE_PLAN', 'created_at is not parseable ISO-8601');
  if (h.expires_at !== undefined && Number.isNaN(expires)) add('R04_STALE_PLAN', 'expires_at is not parseable ISO-8601');
  if (!Number.isNaN(expires) && expires <= now.getTime()) add('R04_STALE_PLAN', 'plan expired');
  if (!Number.isNaN(created) && created > now.getTime() + clockSkewMs) add('R04_STALE_PLAN', 'created_at is in the future');

  // Account alias — alias only, and no long digit run anywhere in the handoff.
  if (h.account_alias !== undefined && !/^AGENTIC-\d{4}$/.test(String(h.account_alias))) {
    add('R16_ACCOUNT_ALIAS_INVALID', 'account_alias must be AGENTIC-<last4>; never a full account number');
  }
  if (/\d{9,}/.test(JSON.stringify(h))) {
    add('R16_ACCOUNT_ALIAS_INVALID', 'a 9+ digit run appears in the handoff — possible full account number; refuse');
  }

  if (h.asset_class !== undefined && h.asset_class !== 'equity') add('R11_ASSET_NOT_EQUITY', 'v1 is equity-only');
  if (h.action !== undefined && !ALLOWED_ACTIONS.includes(h.action)) {
    add('R10_ACTION_NOT_ALLOWED', `action must be one of ${ALLOWED_ACTIONS.join(' | ')}`);
  }
  if (h.lane !== undefined && !ALLOWED_LANES.includes(h.lane)) {
    add('R17_LANE_NOT_ALLOWED', `lane must be one of ${ALLOWED_LANES.join(' | ')} in v1`);
  }
  if (h.structure !== undefined && h.structure !== 'long_shares') {
    add('R12_FORBIDDEN_STRUCTURE_OR_FLAG', 'structure must be long_shares in v1');
  }
  for (const flag of ['concentrated', 'leveraged_product', 'conviction_bet']) {
    if (h[flag] !== undefined && h[flag] !== false) {
      add('R12_FORBIDDEN_STRUCTURE_OR_FLAG', `${flag} must be false in v1`);
    }
  }

  // Quantity — exactly one mode, canonical fields only.
  const aliasPresent = QUANTITY_ALIAS_KEYS.filter((k) => k in h);
  if (aliasPresent.length > 0) {
    add('R07_BOTH_QUANTITY_MODES', `only quantity_mode + quantity_value are accepted (found: ${aliasPresent.join(', ')})`);
  }
  if (h.quantity_mode !== undefined && !['notional', 'shares'].includes(h.quantity_mode)) {
    add('R07_BOTH_QUANTITY_MODES', 'quantity_mode must be exactly one of notional | shares');
  }
  if (h.quantity_mode === undefined || !isPos(h.quantity_value)) {
    add('R08_NO_QUANTITY_MODE', 'exactly one quantity mode with a positive quantity_value is required');
  }

  // Order instruction — LIMIT / DAY / regular hours only.
  if (h.order_type !== undefined && h.order_type !== 'LIMIT') add('R13_ORDER_INSTRUCTION_NOT_ALLOWED', 'order_type must be LIMIT ("market now" is not a v1 instruction)');
  if (h.time_in_force !== undefined && h.time_in_force !== 'DAY') add('R13_ORDER_INSTRUCTION_NOT_ALLOWED', 'time_in_force must be DAY');
  if (h.session !== undefined && h.session !== 'REGULAR_HOURS_ONLY') add('R13_ORDER_INSTRUCTION_NOT_ALLOWED', 'session must be REGULAR_HOURS_ONLY');
  if (h.limit_price !== undefined && !isPos(h.limit_price)) add('R13_ORDER_INSTRUCTION_NOT_ALLOWED', 'limit_price must be a positive number');

  if (h.exit_owner !== undefined && !ALLOWED_EXIT_OWNERS.includes(h.exit_owner)) {
    add('R14_MISSING_EXIT_OWNER', 'exit_owner must be MANUAL or SEPARATE_STOP_ORDER — an invalidation level is not protection');
  }

  if (h.maximum_price_drift !== undefined && !(isPos(h.maximum_price_drift) || (typeof h.maximum_price_drift === 'string' && DRIFT_RE.test(h.maximum_price_drift.trim())))) {
    add('R18_DRIFT_UNBOUNDED', 'maximum_price_drift must be an explicit dollar or percent bound');
  }

  // Invalidation — action-specific branches.
  if (h.action === 'BUY') {
    if (!isPos(h.invalidation_price) || !(isPos(h.limit_price) && h.invalidation_price < h.limit_price)) {
      add('R19_INVALIDATION_INVALID', 'BUY requires a positive invalidation_price below limit_price');
    }
  } else if (h.action === 'SELL_TO_CLOSE') {
    if (h.invalidation_price !== 'N/A') {
      add('R19_INVALIDATION_INVALID', 'SELL_TO_CLOSE takes invalidation_price: N/A (exit of an existing long)');
    }
  }

  // Ceilings + risk arithmetic. The plan cannot raise the executor's hardcoded limit.
  if (h.executor_absolute_ceiling !== undefined) {
    if (!isPos(h.executor_absolute_ceiling) || h.executor_absolute_ceiling > HARD_TEST_CEILING_USD) {
      add('R06_NOTIONAL_ABOVE_HARD_CEILING', `executor_absolute_ceiling must be ≤ hardcoded $${HARD_TEST_CEILING_USD.toFixed(2)}`);
    }
  }
  const ceiling = Math.min(HARD_TEST_CEILING_USD, isPos(h.executor_absolute_ceiling) ? h.executor_absolute_ceiling : HARD_TEST_CEILING_USD);
  const notional = computedNotional(h);
  if (isNum(notional)) {
    if (notional > ceiling) add('R06_NOTIONAL_ABOVE_HARD_CEILING', `computed notional $${notional.toFixed(2)} exceeds effective ceiling $${ceiling.toFixed(2)}`);
    if (isNum(h.planned_dollar_risk) && h.planned_dollar_risk > notional) {
      add('R05_RISK_ABOVE_CEILING', 'planned_dollar_risk exceeds computed notional — arithmetic does not reconcile');
    }
  }
  if (h.planned_dollar_risk !== undefined && (!isNum(h.planned_dollar_risk) || h.planned_dollar_risk < 0 || h.planned_dollar_risk > ceiling)) {
    add('R05_RISK_ABOVE_CEILING', `planned_dollar_risk must be a nonnegative number ≤ effective ceiling $${ceiling.toFixed(2)}`);
  }

  // Durable dedupe — session memory is not an idempotency store.
  if (h.plan_id !== undefined && receiptsDir) {
    const dup = checkDuplicate(h.plan_id, receiptsDir);
    if (dup.duplicate) add('R03_DUPLICATE_PLAN_ID', `plan_id already has a receipt (${dup.reason})`);
  }

  return { ok: refusals.length === 0, refusals };
}

// ---- broker-response normalization (fail-closed) ---------------------------
// Built ONLY from observed, redacted fixtures. Anything unrecognized is
// UNKNOWN_REQUIRES_RECONCILIATION — never success, never a retry.
const KNOWN_STATES = {
  pending: 'PENDING', queued: 'PENDING', open: 'PENDING',
  partially_filled: 'PARTIALLY_FILLED', partial: 'PARTIALLY_FILLED',
  filled: 'FILLED', executed: 'FILLED',
  rejected: 'REJECTED', failed: 'REJECTED',
  cancel_requested: 'CANCEL_REQUESTED', pending_cancel: 'CANCEL_REQUESTED',
  canceled: 'CANCELED', cancelled: 'CANCELED',
};

export function normalizeBrokerState(payload) {
  if (!payload || typeof payload !== 'object') return 'UNKNOWN_REQUIRES_RECONCILIATION';
  if (payload._transport === 'timeout' || payload.timeout === true) return 'UNKNOWN_REQUIRES_RECONCILIATION';
  const raw = String(payload.state ?? payload.status ?? '').toLowerCase().trim();
  return KNOWN_STATES[raw] ?? 'UNKNOWN_REQUIRES_RECONCILIATION';
}

// After any placement outcome: what is the executor allowed to do next?
// NEVER 'RETRY'. There is no automatic retry path in v1.
export function placementDecisionAfter(state) {
  if (state === 'UNKNOWN_REQUIRES_RECONCILIATION') return 'RECONCILE_THEN_REQUIRE_NEW_HUMAN_DECISION';
  if (state === 'PENDING' || state === 'PLACEMENT_ATTEMPTED' || state === 'CANCEL_REQUESTED') return 'MONITOR_STATUS_ONLY';
  if (RECEIPT_STATES.includes(state)) return 'REPORT_AND_ARCHIVE';
  return 'RECONCILE_THEN_REQUIRE_NEW_HUMAN_DECISION';
}

// ---- CLI -------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/executor-validate.mjs <handoff.json> [--receipts DIR]'); process.exit(2); }
  const rIdx = process.argv.indexOf('--receipts');
  const receiptsDir = rIdx > -1 ? process.argv[rIdx + 1] : null;
  const h = JSON.parse(readFileSync(file, 'utf8'));
  const { ok, refusals } = validateHandoff(h, { receiptsDir });
  if (ok) { console.log('VALID — every contract gate passed. (Contract only: live preflight still applies.)'); process.exit(0); }
  console.log(`REFUSED — ${refusals.length} violation(s):`);
  for (const r of refusals) console.log(`  ${r.code}: ${r.message}`);
  process.exit(1);
}
