#!/usr/bin/env node
// executor.mjs — THE BENCH EXECUTOR as a local program (bench-executor-v1,
// program surface). Implements the committed prompt's gates in code:
// contract validation → provenance → typed authorization → arm switch →
// tool binding → preflight → review → typed CONFIRM → one placement → verify.
//
//   node executor/executor.mjs validate <handoff.json>     offline contract check
//   node executor/executor.mjs status                      arm switch + token + receipts
//   node executor/executor.mjs login                       OAuth to the agentic endpoint (TTY only)
//   node executor/executor.mjs test-zero --handoff F --live  cancellation-path test (protocol §test zero)
//   node executor/executor.mjs test-one  --handoff F --live  tiny live order (protocol §test one)
//   node executor/executor.mjs test-queued --handoff F --live after-hours queued place+cancel (schema capture; market CLOSED)
//
// WHO PRESSES THE BUTTON: Adam, always. Live modes refuse without a real
// interactive terminal, refuse without the typed AUTHORIZE line for the
// current commit, and refuse without a fresh typed CONFIRM bound to the
// broker's review of this exact order. Any AI can prepare handoffs and run
// validate/status; no AI can reach a placement, because the confirmations
// only come from a keyboard. Scheduled/autonomous invocation is refused by
// the same guard (a scheduler has no TTY). This is §0 and §7 of the prompt,
// in code.
//
// CONTROL FLOW RULE: inside the live flow, never call process.exit —
// process.exit skips finally blocks, and the finally here is load-bearing
// (it burns the arm switch after a placement attempt). Every early exit
// throws Flow(code) instead, so finally ALWAYS runs.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline/promises';

import {
  validateHandoff, HARD_TEST_CEILING_USD, MAX_FUNDED_TEST_BALANCE_USD,
} from '../scripts/executor-validate.mjs';
import { McpClient } from './lib/mcp.mjs';
import { getAccessToken, login as oauthLogin, loadStore } from './lib/oauth.mjs';
import {
  Broker, normalizeState, findNumberByKey, collectAccounts, collectOrders,
  collectPositions, assertParsed, orderIdOf, refIdOf,
  REQUIRED_CAPABILITIES, READ_CAPABILITIES,
} from './lib/broker.mjs';
import { readSwitch, halt } from './lib/arm.mjs';
import { alert } from './lib/ntfy.mjs';
import { Receipt, archiveRaw } from './lib/receipts.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RECEIPTS_DIR = join(ROOT, 'executor-tests', 'receipts');
export const RAW_DIR = join(ROOT, 'executor-tests', 'raw');
const ENDPOINT = process.env.BENCH_EXECUTOR_ENDPOINT ?? 'https://agent.robinhood.com/mcp/trading';

// Provenance-tracked files: a dirty copy of any of these means the running
// bytes are not the committed bytes, and live modes refuse (§ provenance).
const PROVENANCE_PATHS = [
  'executor', 'scripts/executor-validate.mjs', 'test/executor-contract.test.mjs',
  'prompts/bench-executor-v1.md', 'docs/executor-test-protocol.md',
];

// Raw broker order states that mean "still working".
const OPEN_RAW = new Set(['new', 'queued', 'confirmed', 'unconfirmed', 'partially_filled', 'pending', 'open']);

// Typed early exit for the live flow: carries the process exit code through
// catch/finally instead of bypassing them the way process.exit would.
export class Flow extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
// Typed preflight refusal: recorded as PREFLIGHT_REFUSED, exit 1, no order.
export class PreflightError extends Error {}

// ---------- pure helpers (exported for tests) -------------------------------

export function authorizationLine(mode, sha) {
  const word = { 'test-zero': 'TEST-ZERO', 'test-one': 'TEST-ONE', 'test-queued': 'TEST-QUEUED' }[mode];
  if (!word) throw new Error(`unknown test mode: ${mode}`);
  return `AUTHORIZE ${word} ${sha} ceiling $${HARD_TEST_CEILING_USD.toFixed(0)}`;
}

export function confirmLine(planId, reviewRef, notional) {
  return `CONFIRM ${planId} ${reviewRef} $${notional.toFixed(2)}`;
}

// LIMIT orders are whole-share only on this broker (fractional = market-only,
// per the tool schema). notional mode floors to whole shares; shares mode
// must already be a whole number.
export function computeOrderShares(handoff) {
  const limit = handoff.limit_price;
  let shares;
  if (handoff.quantity_mode === 'shares') {
    if (!Number.isInteger(handoff.quantity_value)) {
      throw new PreflightError('REFUSED — LIMIT orders take whole shares only (fractional is market-order-only on this broker)');
    }
    shares = handoff.quantity_value;
  } else {
    shares = Math.floor(handoff.quantity_value / limit);
  }
  if (!(shares >= 1)) {
    throw new PreflightError(`REFUSED — computed share count ${shares} < 1 (notional $${handoff.quantity_value} at limit $${limit})`);
  }
  const notional = shares * limit;
  const ceiling = Math.min(HARD_TEST_CEILING_USD, handoff.executor_absolute_ceiling ?? HARD_TEST_CEILING_USD);
  if (notional > ceiling) {
    throw new PreflightError(`REFUSED — order notional $${notional.toFixed(2)} exceeds effective ceiling $${ceiling.toFixed(2)}`);
  }
  return { shares, notional };
}

// Spec §6.8 — risk arithmetic must reconcile with the exit story:
//   exit_owner SEPARATE_STOP_ORDER (BUY): risk ≈ shares × (limit − invalidation), within 10%.
//   exit_owner MANUAL (BUY): worst case is the whole position — planned risk
//   must be at least the computed notional (floored shares can put notional
//   below the plan's stated quantity_value; ≥ notional is the honest bound).
// SELL_TO_CLOSE exits an existing long (invalidation N/A) — nothing to reconcile.
export function reconcileRisk(handoff, shares, notional) {
  if (handoff.action !== 'BUY') return { basis: 'SELL_TO_CLOSE — no entry risk to reconcile' };
  if (handoff.exit_owner === 'MANUAL') {
    if (handoff.planned_dollar_risk + 1e-9 < notional) {
      throw new PreflightError(
        `REFUSED — exit_owner MANUAL means worst-case risk is the full notional $${notional.toFixed(2)}, ` +
        `but planned_dollar_risk claims $${handoff.planned_dollar_risk}. Say the real number.`
      );
    }
    return { basis: `MANUAL exit — risk is the full notional $${notional.toFixed(2)}` };
  }
  const expected = shares * (handoff.limit_price - handoff.invalidation_price);
  const tolerance = Math.max(0.10, expected * 0.10);
  if (Math.abs(handoff.planned_dollar_risk - expected) > tolerance) {
    throw new PreflightError(
      `REFUSED — risk arithmetic does not reconcile: ${shares} × (${handoff.limit_price} − ${handoff.invalidation_price}) ` +
      `= $${expected.toFixed(2)} vs planned_dollar_risk $${handoff.planned_dollar_risk} (10% tolerance)`
    );
  }
  return { basis: `stop-based risk $${expected.toFixed(2)} reconciles` };
}

export function parseDriftBound(drift, limitPrice) {
  if (typeof drift === 'number') return drift;
  const s = String(drift).trim();
  if (s.endsWith('%')) return (parseFloat(s) / 100) * limitPrice;
  return parseFloat(s.replace(/^\$/, ''));
}

// Test zero wants an UNMARKETABLE limit — one that cannot fill without a
// violent move. Direction matters: a BUY is unmarketable far BELOW the tape,
// a SELL far ABOVE it. Still never called zero-fill-risk.
export function unmarketableEnough(action, limitPrice, lastTrade) {
  if (!(Number.isFinite(lastTrade) && lastTrade > 0)) return false;
  if (action === 'BUY') return limitPrice <= lastTrade * 0.5;
  return limitPrice >= lastTrade * 1.5;
}

export function regularSessionOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
  // 9:30 ET open; stop starting new tests 15:45 ET so the cancel leg has room.
  return minutes >= 9 * 60 + 30 && minutes <= 15 * 60 + 45;
}

// The after-hours ("queued") test runs ONLY when the market is closed with a
// comfortable buffer before the next open. A regular-hours limit placed now
// queues for the next open instead of filling, so placing-and-cancelling it
// here cannot touch a live session — and even if the run is interrupted
// between place and cancel, the buffer means a human notices before the open.
// Weekend: always safe (next open is Monday). Weekday: only well after the
// close (>= 16:15 ET) or well before the open (< 07:00 ET). The 07:00-16:15 ET
// band is refused, so the run is never near a live session.
export function safeAfterHoursWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return true;
  const minutes = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
  const afterClose = minutes >= 16 * 60 + 15;
  const beforeOpen = minutes < 7 * 60;
  return afterClose || beforeOpen;
}

// Test one is sequenced behind test zero: refuse until a receipt shows a
// CLEAN test-zero run (cancellation verified, nothing filled).
export function hasCompletedTestZero(receiptsDir = RECEIPTS_DIR) {
  if (!existsSync(receiptsDir)) return false;
  for (const f of readdirSync(receiptsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const r = JSON.parse(readFileSync(join(receiptsDir, f), 'utf8'));
      if (r.mode === 'test-zero' && r.state === 'CANCELED' && !(r.final_filled_quantity > 0)) return true;
    } catch { /* unreadable receipts are handled by the dedupe gate */ }
  }
  return false;
}

export function matchesOrderDetails(order, handoff, shares) {
  const sym = String(order.symbol ?? order.ticker ?? '').toUpperCase();
  if (sym && sym !== String(handoff.ticker).toUpperCase()) return false;
  const qty = Number(order.quantity ?? order.qty ?? NaN);
  if (Number.isFinite(qty) && Math.abs(qty - shares) > 1e-9) return false;
  const lim = Number(order.limit_price ?? order.price ?? NaN);
  if (Number.isFinite(lim) && Math.abs(lim - handoff.limit_price) > 0.005) return false;
  return Boolean(sym || Number.isFinite(qty) || Number.isFinite(lim));
}

// Identify OUR order among candidates. Spec §7.5: match by reference id, or
// by exact details — and a details-only match must be UNIQUE and OPEN
// (preflight guaranteed no open orders existed in the ticker before we
// placed, so the one open details-match is ours; a stale terminal twin from
// an earlier day can never be adopted). Anything ambiguous returns null.
export function identifyOrder(candidates, refId, handoff, shares) {
  const byRef = candidates.find((o) => refIdOf(o) === refId);
  if (byRef) return { order: byRef, how: 'ref_id' };
  const detail = candidates.filter((o) =>
    OPEN_RAW.has(String(o.state ?? o.status ?? '').toLowerCase()) &&
    matchesOrderDetails(o, handoff, shares));
  if (detail.length === 1) return { order: detail[0], how: 'unique open details match' };
  return null;
}

// Cumulative filled quantity, if the payload exposes one we recognize.
export function filledQuantityOf(order) {
  const hit = findNumberByKey(order, ['cumulative_quantity', 'filled_quantity', 'executed_quantity', 'quantity_filled']);
  return hit ? hit.value : null;
}

// ---------- interactive + provenance ---------------------------------------

function requireTTY(what) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`REFUSED — ${what} is interactive-only. This program will not run its live path`);
    console.error('from a pipe, a scheduler, or an AI-driven shell: the typed lines below must come');
    console.error('from a human at a keyboard. That is the design, not a limitation.');
    process.exit(1);
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function provenance() {
  const dirty = git(['status', '--porcelain', '--', ...PROVENANCE_PATHS]);
  if (dirty) {
    console.error('REFUSED — provenance: these executor files differ from the committed bytes:');
    console.error(dirty);
    console.error('Commit first. A SHA must describe the bytes actually running.');
    process.exit(1);
  }
  return git(['rev-parse', '--short', 'HEAD']);
}

// ---------- live flow -------------------------------------------------------

async function connectBroker() {
  const mcp = new McpClient(ENDPOINT, { getToken: getAccessToken });
  await mcp.initialize({ name: 'bench-executor', version: 'v1-program' });
  const tools = await mcp.listTools();
  const broker = new Broker(mcp);
  const binding = broker.bind(tools);
  return { broker, binding };
}

async function resolveAccount(broker, handoff, receipt) {
  const payload = await broker.call('accounts', {});
  receipt.addRaw(archiveRaw(RAW_DIR, handoff.plan_id, 'accounts', payload));
  assertParsed(payload, 'accounts');
  const candidates = collectAccounts(payload).filter((a) => a.agentic_allowed === true);
  if (candidates.length !== 1) {
    throw new PreflightError(`account resolution refused — expected exactly one agentic_allowed account, found ${candidates.length}`);
  }
  const number = String(candidates[0].account_number ?? '');
  const last4 = handoff.account_alias.slice(-4);
  if (!number.endsWith(last4)) {
    throw new PreflightError(`account resolution refused — agentic account does not match alias ${handoff.account_alias}`);
  }
  return number; // used at runtime only; never written to receipts or logs
}

async function preflight(broker, handoff, accountNumber, shares, notional, mode, receipt) {
  // Buying power — via portfolio; fail closed if the schema hides it.
  let portfolio;
  try {
    portfolio = await broker.call('portfolio', { account_number: accountNumber });
  } catch {
    portfolio = await broker.call('portfolio', {});
  }
  receipt.addRaw(archiveRaw(RAW_DIR, handoff.plan_id, 'portfolio', portfolio));
  const bp = findNumberByKey(portfolio, ['buying_power', 'available_buying_power', 'cash_available_for_investing', 'cash_available']);
  if (!bp) throw new PreflightError('preflight refused — could not find buying power in the portfolio response (schema uncaptured; fail closed)');
  if (bp.value > MAX_FUNDED_TEST_BALANCE_USD) {
    throw new PreflightError(`preflight refused — buying power $${bp.value.toFixed(2)} exceeds the $${MAX_FUNDED_TEST_BALANCE_USD.toFixed(2)} ring-fence. The operator checklist requires a nearly-empty test account.`);
  }
  if (handoff.action === 'BUY' && bp.value < notional) {
    throw new PreflightError(`preflight refused — buying power $${bp.value.toFixed(2)} < order notional $${notional.toFixed(2)}`);
  }

  // Market session — mode-dependent. Live tests (test-zero/test-one) need the
  // session OPEN. The after-hours queued test needs the OPPOSITE: the market
  // CLOSED with a buffer, so a regular-hours limit queues instead of filling.
  if (mode === 'test-queued') {
    if (regularSessionOpen() || !safeAfterHoursWindow()) {
      throw new PreflightError('preflight refused — the queued test needs the market CLOSED with a buffer (weekend, or before 07:00 / after 16:15 ET). It is not that now.');
    }
  } else if (!regularSessionOpen()) {
    throw new PreflightError('preflight refused — outside regular session (9:30–15:45 ET window for tests)');
  }

  // Live quote, drift, and (test zero) unmarketability.
  const quotes = await broker.call('quotes', { symbols: [handoff.ticker] });
  receipt.addRaw(archiveRaw(RAW_DIR, handoff.plan_id, 'quotes', quotes));
  assertParsed(quotes, 'quotes');
  const last = findNumberByKey(quotes, ['last_trade_price']) ?? findNumberByKey(quotes, ['last_price', 'price', 'mark']);
  if (!last) throw new PreflightError('preflight refused — no recognizable last-trade price in the quote response (fail closed)');
  const drift = parseDriftBound(handoff.maximum_price_drift, handoff.limit_price);
  if (!(Number.isFinite(drift) && drift > 0)) throw new PreflightError('preflight refused — unparseable maximum_price_drift');
  if (Math.abs(last.value - handoff.limit_price) > drift) {
    throw new PreflightError(`preflight refused — live ${last.value} vs limit ${handoff.limit_price} exceeds drift bound $${drift.toFixed(2)}`);
  }
  if ((mode === 'test-zero' || mode === 'test-queued') && !unmarketableEnough(handoff.action, handoff.limit_price, last.value)) {
    throw new PreflightError(
      `preflight refused — this test needs an unmarketable limit (BUY ≤ 50% / SELL ≥ 150% of last trade ${last.value}); got ${handoff.limit_price}. ` +
      'For the queued test this is the belt-and-suspenders: even if the cancel failed and the order reached the open, it would sit far from fillable.'
    );
  }

  // Position conflicts — structured, fail closed on unrecognized payloads.
  let positionsPayload;
  try {
    positionsPayload = await broker.call('positions', { account_number: accountNumber });
  } catch {
    positionsPayload = await broker.call('positions', {});
  }
  receipt.addRaw(archiveRaw(RAW_DIR, handoff.plan_id, 'positions', positionsPayload));
  assertParsed(positionsPayload, 'positions');
  const held = collectPositions(positionsPayload)
    .filter((p) => p.symbol === String(handoff.ticker).toUpperCase())
    .reduce((sum, p) => sum + p.quantity, 0);
  if (handoff.action === 'BUY' && held > 0) {
    throw new PreflightError(`preflight refused — existing position of ${held} ${handoff.ticker} (v1 test phase requires none)`);
  }
  if (handoff.action === 'SELL_TO_CLOSE' && held < shares) {
    throw new PreflightError(`preflight refused — SELL_TO_CLOSE ${shares} needs an existing long ≥ that (holding ${held}); partial-close of an unheld size refuses`);
  }

  // Open-order conflicts.
  const orders = await broker.call('orders', { account_number: accountNumber, symbol: handoff.ticker });
  receipt.addRaw(archiveRaw(RAW_DIR, handoff.plan_id, 'orders-preflight', orders));
  assertParsed(orders, 'orders');
  const open = collectOrders(orders).filter((o) => OPEN_RAW.has(String(o.state ?? o.status ?? '').toLowerCase()));
  if (open.length) {
    throw new PreflightError(`preflight refused — ${open.length} open order(s) already exist in ${handoff.ticker}`);
  }
  return { lastTrade: last.value };
}

// Poll ONE order by id. Strict: a payload that doesn't contain OUR order id
// reads as UNKNOWN — never "the first order we happened to see".
async function pollOrder(broker, accountNumber, orderId, receipt, planId) {
  const payload = await broker.call('orders', { account_number: accountNumber, order_id: orderId });
  receipt.addRaw(archiveRaw(RAW_DIR, planId, 'order-status', payload));
  const order = collectOrders(payload).find((o) => String(orderIdOf(o)) === String(orderId)) ?? null;
  return { order, state: order ? normalizeState(order) : 'UNKNOWN_REQUIRES_RECONCILIATION' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runLiveTest(mode, handoffPath, liveFlag) {
  requireTTY(mode);
  if (!liveFlag) {
    console.error(`REFUSED — ${mode} places a real order. Re-run with --live to mean it.`);
    process.exit(1);
  }
  const sha = provenance();
  const handoff = JSON.parse(readFileSync(resolve(handoffPath), 'utf8'));

  // 1. Contract validation (includes durable receipt dedupe). No receipt yet,
  // no broker yet — pure refusals exit directly here.
  const contract = validateHandoff(handoff, { receiptsDir: RECEIPTS_DIR });
  if (!contract.ok) {
    console.error(`REFUSED — ${contract.refusals.length} contract violation(s):`);
    for (const r of contract.refusals) console.error(`  ${r.code}: ${r.message}`);
    process.exit(1);
  }
  if (mode === 'test-one' && !hasCompletedTestZero()) {
    console.error('REFUSED — test one is sequenced behind test zero: no receipt shows a clean (CANCELED, nothing filled) test-zero run.');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (prompt) => (await rl.question(prompt)).trim();
  let receipt = null;
  let placed = false;
  let exitCode = 0;
  try {
    const { shares, notional } = computeOrderShares(handoff);
    const risk = reconcileRisk(handoff, shares, notional); // §6.8

    // 2. Typed authorization bound to the running commit.
    console.log(`\nbench-executor ${mode} — running commit ${sha}`);
    console.log(`Plan ${handoff.plan_id}: ${handoff.action} ${shares} ${handoff.ticker} LIMIT $${handoff.limit_price} DAY regular hours — max notional $${notional.toFixed(2)}`);
    console.log(`Risk basis: ${risk.basis}`);
    const expectedAuth = authorizationLine(mode, sha);
    const typedAuth = await ask(`\nType the authorization exactly (protocol §Authorizations):\n  ${expectedAuth}\n> `);
    if (typedAuth !== expectedAuth) {
      throw new Flow(1, 'authorization line does not match — nothing was called');
    }

    // 3. Arm switch, per row.
    const arm = await readSwitch();
    if (arm.state !== 'ARMED' || arm.row !== handoff.row_id) {
      console.error(`\nArm it first: node scripts/executor-arm.mjs --row ${handoff.row_id} --hours 1`);
      throw new Flow(1, `arm switch is ${arm.state}${arm.row ? ` for ${arm.row}` : ''} (${arm.why})`);
    }

    receipt = new Receipt(RECEIPTS_DIR, handoff, { mode, commit: sha });
    await alert(`${mode.toUpperCase()} START ${handoff.plan_id} — ${handoff.action} ${shares} ${handoff.ticker} @ $${handoff.limit_price}`);

    // 4. Connect + bind + resolve account + preflight.
    const { broker, binding } = await connectBroker();
    receipt.set('tool_binding', binding);
    const accountNumber = await resolveAccount(broker, handoff, receipt);
    await preflight(broker, handoff, accountNumber, shares, notional, mode, receipt);

    // 5. Review, display verbatim, typed CONFIRM bound to the review.
    const review = await broker.call('review', {
      account_number: accountNumber,
      symbol: handoff.ticker,
      side: handoff.action === 'BUY' ? 'buy' : 'sell',
      type: 'limit',
      quantity: String(shares),
      limit_price: String(handoff.limit_price),
      time_in_force: 'gfd',
      market_hours: 'regular_hours',
    });
    receipt.addRaw(archiveRaw(RAW_DIR, handoff.plan_id, 'review', review));
    const reviewRef = String(review?.review_id ?? review?.ref ?? review?.id ?? 'NONE');
    receipt.set('review_ref', reviewRef);
    receipt.transition('REVIEWED', `broker review complete (ref ${reviewRef})`);

    console.log('\n──────── REVIEW — read every line ────────');
    console.log(`  account: ${handoff.account_alias}`);
    console.log(`  ticker: ${handoff.ticker}`);
    console.log(`  action: ${handoff.action}`);
    console.log(`  quantity: ${shares} shares (${handoff.quantity_mode} mode, value ${handoff.quantity_value})`);
    console.log(`  limit: $${handoff.limit_price}  ·  DAY  ·  regular hours`);
    console.log(`  max notional: $${notional.toFixed(2)}`);
    console.log(`  planned risk: $${handoff.planned_dollar_risk} (${risk.basis})`);
    console.log(`  exit owner: ${handoff.exit_owner}`);
    console.log(`  review ref: ${reviewRef}`);
    if (review?.alerts) console.log(`  broker alerts: ${JSON.stringify(review.alerts).slice(0, 400)}`);
    console.log('──────────────────────────────────────────');

    const expectedConfirm = confirmLine(handoff.plan_id, reviewRef, notional);
    const typedConfirm = await ask(`\nTo place, type exactly:\n  ${expectedConfirm}\nAnything else refuses.\n> `);
    if (typedConfirm !== expectedConfirm) {
      receipt.transition('PREFLIGHT_REFUSED', 'confirmation line did not match — refused at the last gate');
      await alert(`${mode.toUpperCase()} REFUSED at confirm — ${handoff.plan_id}`);
      throw new Flow(1, 'confirmation line did not match');
    }
    receipt.transition('CONFIRMED', 'typed confirmation matched');

    // 6. ONE placement. ref_id persisted BEFORE the call; never regenerated.
    const refId = randomUUID();
    receipt.set('ref_id', refId);
    receipt.transition('PLACEMENT_ATTEMPTED', `calling ${binding.place} exactly once (ref_id ${refId})`);
    placed = true;
    let placeResult;
    try {
      placeResult = await broker.call('place', {
        account_number: accountNumber,
        symbol: handoff.ticker,
        side: handoff.action === 'BUY' ? 'buy' : 'sell',
        type: 'limit',
        quantity: String(shares),
        limit_price: String(handoff.limit_price),
        time_in_force: 'gfd',
        market_hours: 'regular_hours',
        ref_id: refId,
      });
    } catch (err) {
      // §7.5 — never retry. Reconcile by reading order history.
      receipt.transition('UNKNOWN_REQUIRES_RECONCILIATION', `placement call failed ambiguously: ${err.message}`);
      await alert(`${mode.toUpperCase()} UNKNOWN — placement ambiguous for ${handoff.plan_id}. RECONCILING, no retry.`);
      const listing = await broker.call('orders', { account_number: accountNumber, symbol: handoff.ticker });
      receipt.addRaw(archiveRaw(RAW_DIR, handoff.plan_id, 'reconcile', listing));
      const mine = collectOrders(listing).find((o) => refIdOf(o) === refId);
      if (!mine) {
        console.error('\nRECONCILIATION: no order carries our ref_id. If the Robinhood app also shows nothing,');
        console.error('the order did not place. A new attempt requires a NEW plan_id and a new arm.');
        throw new Flow(2, 'placement ambiguous; no order found under our ref_id');
      }
      receipt.set('broker_order_id', orderIdOf(mine));
      receipt.transition(normalizeState(mine), 'order found during reconciliation');
      console.error(`\nRECONCILIATION: order ${orderIdOf(mine)} exists in state ${normalizeState(mine)}. Manage it via the kill sequence.`);
      throw new Flow(2, 'placement ambiguous; order recovered by ref_id — reconcile before anything else');
    }
    receipt.addRaw(archiveRaw(RAW_DIR, handoff.plan_id, 'place', placeResult));

    // Resolve OUR order: ref_id, or a UNIQUE open details-match (see identifyOrder).
    let hit = identifyOrder(collectOrders(placeResult), refId, handoff, shares)
      ?? (() => {
        const c = collectOrders(placeResult);
        return c.length === 1 && matchesOrderDetails(c[0], handoff, shares) ? { order: c[0], how: 'sole order in place response' } : null;
      })();
    if (!hit) {
      const listing = await broker.call('orders', { account_number: accountNumber, symbol: handoff.ticker });
      receipt.addRaw(archiveRaw(RAW_DIR, handoff.plan_id, 'orders-after-place', listing));
      hit = identifyOrder(collectOrders(listing), refId, handoff, shares);
    }
    if (!hit || !orderIdOf(hit.order)) {
      receipt.transition('UNKNOWN_REQUIRES_RECONCILIATION', 'placement returned but no order could be UNAMBIGUOUSLY identified');
      await alert(`${mode.toUpperCase()} UNKNOWN — placed but unidentifiable: ${handoff.plan_id}. Check the app NOW.`);
      console.error('\nAn order was placed but cannot be unambiguously identified. Kill sequence:');
      console.error('open the app, find it, cancel it by hand, and archive what you see.');
      throw new Flow(2, 'placed but unidentifiable');
    }
    const orderId = orderIdOf(hit.order);
    receipt.set('broker_order_id', orderId);
    let state = normalizeState(hit.order);
    receipt.transition(state, `order ${orderId} after placement (identified by ${hit.how})`);
    await alert(`${mode.toUpperCase()} PLACED ${handoff.plan_id} — order ${orderId} state ${state}`);

    // 7. Poll until the order state is readable.
    for (let i = 0; i < 12 && state === 'UNKNOWN_REQUIRES_RECONCILIATION'; i++) {
      await sleep(5000);
      const polled = await pollOrder(broker, accountNumber, orderId, receipt, handoff.plan_id);
      if (polled.order) state = polled.state;
      receipt.transition(state, `poll ${i + 1}`);
    }
    if (state === 'REJECTED') {
      await alert(`${mode.toUpperCase()} REJECTED — ${handoff.plan_id}.${mode === 'test-zero' ? ' Record as a rejection-path observation, NOT a cancellation-path pass.' : ''}`);
      console.log('\nBroker REJECTED the order. For test zero the protocol is explicit: record a');
      console.log('rejection-path observation and do NOT claim the cancellation path was tested.');
      throw new Flow(1, 'broker rejected the order');
    }
    if (state === 'FILLED') {
      receipt.set('final_filled_quantity', filledQuantityOf(hit.order) ?? shares);
      await alert(`${mode.toUpperCase()} FILLED — ${handoff.plan_id}. ${handoff.exit_owner === 'MANUAL' ? 'POSITION IS MANUALLY MANAGED — your close/hold decision.' : 'Verify the protective order NOW.'}`);
      if (mode === 'test-zero') {
        console.log('\nThe unmarketable limit FILLED COMPLETELY (the risk the protocol names). The position');
        console.log('is yours to manage manually. This run is a fill-path observation, not a cancellation pass.');
        throw new Flow(2, 'test-zero order filled before cancel');
      }
      if (mode === 'test-queued') {
        console.log('\nUNEXPECTED: an after-hours order FILLED — it did NOT queue as this test assumes.');
        console.log('That is a broker-behavior surprise worth recording. The position is yours to manage manually.');
        throw new Flow(2, 'test-queued order filled (did not queue) — unexpected, manage manually');
      }
    }
    if (state === 'PARTIALLY_FILLED') {
      await alert(`${mode.toUpperCase()} PARTIALLY_FILLED — ${handoff.plan_id}. Remainder still working${mode === 'test-zero' ? '; proceeding to cancel it' : ''}.`);
      // Do NOT exit: for test zero the remainder is a live order — the cancel
      // leg below is now the kill sequence, not just the test.
    }

    if (mode === 'test-zero' || mode === 'test-queued') {
      const TAG = mode.toUpperCase();
      const stateWord = mode === 'test-queued' ? 'queued for the next open, not fillable now' : 'working';
      // 8. Cancel THROUGH the program, verify CANCELED — a request is not a cancellation.
      console.log(`\nOrder ${orderId} status: ${state} (${stateWord}). Verify it in the Robinhood app now.`);
      await ask('Press Enter to cancel it through the executor… ');
      const cancelResult = await broker.call('cancel', { account_number: accountNumber, order_id: orderId });
      receipt.addRaw(archiveRaw(RAW_DIR, handoff.plan_id, 'cancel', cancelResult));
      receipt.transition('CANCEL_REQUESTED', `cancel requested for ${orderId}`);
      await alert(`${TAG} CANCEL_REQUESTED — ${handoff.plan_id}`);
      let final = 'UNKNOWN_REQUIRES_RECONCILIATION';
      let finalOrder = null;
      for (let i = 0; i < 24; i++) {
        await sleep(5000);
        const polled = await pollOrder(broker, accountNumber, orderId, receipt, handoff.plan_id);
        if (polled.order) { final = polled.state; finalOrder = polled.order; }
        if (final === 'CANCELED' || final === 'FILLED' || final === 'REJECTED') break;
      }
      const filledQty = finalOrder ? filledQuantityOf(finalOrder) : null;
      if (filledQty !== null) receipt.set('final_filled_quantity', filledQty);
      receipt.transition(final, `final state after cancel verification${filledQty !== null ? ` (filled ${filledQty})` : ''}`);
      if (final !== 'CANCELED') {
        const extra = mode === 'test-queued'
          ? ' A queued after-hours order left uncancelled becomes LIVE at the next open — check the app and kill it by hand NOW.'
          : '';
        await alert(`${TAG} ALARM — cancel NOT verified for ${handoff.plan_id}; final state ${final}.${extra} Verify in the app NOW.`);
        console.error(`\nCancel NOT verified (final state ${final}). Kill sequence: check the app, cancel manually if needed.`);
        if (mode === 'test-queued') {
          console.error('This was an after-hours QUEUED order — if it is not cancelled it goes live at the next open. Do NOT leave it.');
        } else {
          console.error('If it filled, the position is your decision.');
        }
        throw new Flow(2, `cancel not verified — final state ${final}`);
      }
      if (filledQty > 0) {
        await alert(`${TAG} CANCELED WITH PARTIAL FILL ${filledQty} — position in ${handoff.ticker} is yours to manage.`);
        console.log(`\nCancellation verified — but ${filledQty} share(s) filled first. The filled shares are a live position`);
        console.log('and a separate manual decision. The cancellation PATH worked; the run is NOT a clean pass.');
        throw new Flow(2, 'canceled with partial fill');
      }
      await alert(`${TAG} CANCELED — verified clean. ${handoff.plan_id} complete. Commit the receipt.`);
      if (mode === 'test-queued') {
        console.log('\nQUEUED TEST COMPLETE — an after-hours order was placed (queued for the open), then cancelled and');
        console.log('verified CANCELED before it could ever go live. Nothing filled. Real broker response schemas are');
        console.log('captured in executor-tests/raw/ — the point of this run. NOTE: this proves the cancel path on a');
        console.log('QUEUED order, not a live working one, so it does NOT unlock test-one (that still needs a market-hours test-zero).');
      } else {
        console.log('\nTEST ZERO COMPLETE — placement verified, cancellation verified, nothing filled.');
      }
      console.log(`Receipt: ${receipt.path}`);
      console.log(`Commit it now: git add executor-tests/receipts && git commit -m "executor: ${mode} receipt"`);
    } else {
      await alert(`TEST-ONE ${state} — ${handoff.plan_id}, order ${orderId}. Exit owner: ${handoff.exit_owner}.`);
      console.log(`\nTEST ONE: order ${orderId} state ${state}. DAY limit — unfilled orders die at the close.`);
      console.log(`Receipt: ${receipt.path} — commit it, then replay this plan_id to verify the duplicate refusal.`);
    }
  } catch (err) {
    if (err instanceof Flow) {
      exitCode = err.code;
      console.error(`\n${err.code === 0 ? '' : 'STOPPED: '}${err.message}`);
    } else if (err instanceof PreflightError && !placed) {
      exitCode = 1;
      if (receipt) receipt.transition('PREFLIGHT_REFUSED', err.message);
      await alert(`${mode.toUpperCase()} PREFLIGHT_REFUSED — ${err.message.slice(0, 180)}`);
      console.error(`\n${err.message}`);
      console.error('No placement call was made.');
    } else if (!placed) {
      exitCode = 1;
      if (receipt) receipt.transition('PREFLIGHT_REFUSED', `failed before placement: ${err.message}`);
      await alert(`${mode.toUpperCase()} ERROR before placement — ${err.message.slice(0, 180)}`);
      console.error(`\nERROR: ${err.message}\nNo placement call was made.`);
    } else {
      exitCode = 2;
      if (receipt) receipt.transition('UNKNOWN_REQUIRES_RECONCILIATION', `unhandled after placement: ${err.message}`);
      await alert(`${mode.toUpperCase()} ERROR after placement — ${err.message.slice(0, 180)}. RECONCILE NOW.`);
      console.error(`\nERROR: ${err.message}`);
      console.error('A placement WAS attempted — run the kill sequence and reconcile before anything else.');
    }
  } finally {
    if (placed) {
      // One arm = one placement attempt: burn the switch no matter the outcome.
      // Every early exit above throws (never process.exit), so this always runs.
      try {
        await halt(`after ${mode} placement attempt`);
      } catch (err) {
        console.error(`HALT publish failed (${err.message}) — disarm manually: node scripts/executor-arm.mjs --off`);
      }
    }
    rl.close();
  }
  process.exit(exitCode);
}

// ---------- read-only preflight probe ---------------------------------------
// Runs every check the live flow would run, EXCEPT the three order-shaped
// calls (review/place/cancel), which are structurally unreachable: the probe
// binds READ_CAPABILITIES only, so broker.call('place') is denied by default.
// No receipt is created (the plan_id stays unburned for the real run), no arm
// or authorization is needed, and raw responses are archived so real captures
// start replacing the synthetic fixtures (blocker #5). Unlike the live flow,
// the probe does NOT stop at the first failure — it reports every gate.

async function runProbe(handoffPath) {
  const sha = git(['rev-parse', '--short', 'HEAD']);
  const handoff = JSON.parse(readFileSync(resolve(handoffPath), 'utf8'));
  const results = [];
  const pass = (name, detail) => { results.push({ name, ok: true }); console.log(`  PASS ${name}: ${detail}`); };
  const fail = (name, detail) => { results.push({ name, ok: false }); console.log(`  FAIL ${name}: ${detail}`); };
  const note = (name, detail) => { console.log(`  INFO ${name}: ${detail}`); };

  console.log(`\nPREFLIGHT PROBE — read-only. review/place/cancel are NOT in the binding. Commit ${sha}.`);

  // Contract + order math (offline).
  let shares = 0;
  let notional = 0;
  const contract = validateHandoff(handoff, { receiptsDir: RECEIPTS_DIR });
  if (!contract.ok) {
    fail('contract', contract.refusals.map((r) => `${r.code}`).join(', '));
  } else {
    try {
      ({ shares, notional } = computeOrderShares(handoff));
      const risk = reconcileRisk(handoff, shares, notional);
      pass('contract', `valid — ${shares} shares ≈ $${notional.toFixed(2)} notional; ${risk.basis}`);
    } catch (err) {
      fail('contract', err.message);
    }
  }

  // Connect, list tools, bind read-only, check the full surface is present.
  let broker = null;
  try {
    const mcp = new McpClient(ENDPOINT, { getToken: getAccessToken });
    await mcp.initialize({ name: 'bench-executor', version: 'v1-program-probe' });
    const tools = await mcp.listTools();
    broker = new Broker(mcp);
    broker.bind(tools, { readOnly: true });
    pass('connect', `server reachable, ${tools.length} tools listed, bound read-only (${READ_CAPABILITIES.length} capabilities)`);
    const names = new Set(tools.map((t) => t.name));
    const absent = Object.values(REQUIRED_CAPABILITIES).filter((n) => !names.has(n));
    if (absent.length) fail('tool-surface', `missing on server: ${absent.join(', ')} — the live run would refuse at binding`);
    else pass('tool-surface', 'all required tool names present (order tools observed, NOT bound in probe)');
  } catch (err) {
    fail('connect', err.message);
  }

  // Account resolution.
  let accountNumber = null;
  if (broker) {
    try {
      const payload = await broker.call('accounts', {});
      archiveRaw(RAW_DIR, handoff.plan_id, 'probe-accounts', payload);
      assertParsed(payload, 'accounts');
      const candidates = collectAccounts(payload).filter((a) => a.agentic_allowed === true);
      if (candidates.length !== 1) throw new Error(`expected exactly one agentic_allowed account, found ${candidates.length}`);
      const number = String(candidates[0].account_number ?? '');
      if (!number.endsWith(handoff.account_alias.slice(-4))) throw new Error(`agentic account does not match alias ${handoff.account_alias}`);
      accountNumber = number;
      pass('account', `resolved ${handoff.account_alias}, agentic_allowed=true`);
    } catch (err) {
      fail('account', err.message);
    }
  }

  if (broker && accountNumber) {
    // Buying power via portfolio.
    try {
      let portfolio;
      try {
        portfolio = await broker.call('portfolio', { account_number: accountNumber });
      } catch {
        portfolio = await broker.call('portfolio', {});
      }
      archiveRaw(RAW_DIR, handoff.plan_id, 'probe-portfolio', portfolio);
      const bp = findNumberByKey(portfolio, ['buying_power', 'available_buying_power', 'cash_available_for_investing', 'cash_available']);
      if (!bp) throw new Error('no recognizable buying-power field — the live run would fail closed here');
      const ring = bp.value <= MAX_FUNDED_TEST_BALANCE_USD;
      const covers = bp.value >= notional;
      const detail = `$${bp.value.toFixed(2)} (field "${bp.path}") — ring-fence ≤$${MAX_FUNDED_TEST_BALANCE_USD.toFixed(0)}: ${ring ? 'OK' : 'EXCEEDED — empty the account per the operator checklist'}; covers $${notional.toFixed(2)}: ${covers ? 'OK' : 'NO'}`;
      (ring && covers ? pass : fail)('buying-power', detail);
    } catch (err) {
      fail('buying-power', err.message);
    }

    // Quote, drift, unmarketability.
    try {
      const quotes = await broker.call('quotes', { symbols: [handoff.ticker] });
      archiveRaw(RAW_DIR, handoff.plan_id, 'probe-quotes', quotes);
      assertParsed(quotes, 'quotes');
      const last = findNumberByKey(quotes, ['last_trade_price']) ?? findNumberByKey(quotes, ['last_price', 'price', 'mark']);
      if (!last) throw new Error('no recognizable last-trade price — the live run would fail closed here');
      const drift = parseDriftBound(handoff.maximum_price_drift, handoff.limit_price);
      const driftOk = Number.isFinite(drift) && drift > 0 && Math.abs(last.value - handoff.limit_price) <= drift;
      (driftOk ? pass : fail)('quote-drift', `${handoff.ticker} last ${last.value} (field "${last.path}") vs limit ${handoff.limit_price}, bound $${Number.isFinite(drift) ? drift.toFixed(2) : '?'}`);
      const unmkt = unmarketableEnough(handoff.action, handoff.limit_price, last.value);
      (unmkt ? pass : fail)('unmarketable', unmkt
        ? `limit ${handoff.limit_price} is far from last ${last.value} — test-zero OK`
        : `limit ${handoff.limit_price} vs last ${last.value} is TOO MARKETABLE for test zero (BUY needs ≤ 50%, SELL ≥ 150%)`);
    } catch (err) {
      fail('quote', err.message);
    }

    // Position conflicts.
    try {
      let positions;
      try {
        positions = await broker.call('positions', { account_number: accountNumber });
      } catch {
        positions = await broker.call('positions', {});
      }
      archiveRaw(RAW_DIR, handoff.plan_id, 'probe-positions', positions);
      assertParsed(positions, 'positions');
      const held = collectPositions(positions)
        .filter((p) => p.symbol === String(handoff.ticker).toUpperCase())
        .reduce((sum, p) => sum + p.quantity, 0);
      const conflictFree = handoff.action === 'BUY' ? held === 0 : held >= shares;
      (conflictFree ? pass : fail)('positions', `${held} ${handoff.ticker} held (${handoff.action} ${handoff.action === 'BUY' ? 'requires none' : `requires ≥ ${shares}`})`);
    } catch (err) {
      fail('positions', err.message);
    }

    // Open-order conflicts.
    try {
      const orders = await broker.call('orders', { account_number: accountNumber, symbol: handoff.ticker });
      archiveRaw(RAW_DIR, handoff.plan_id, 'probe-orders', orders);
      assertParsed(orders, 'orders');
      const open = collectOrders(orders).filter((o) => OPEN_RAW.has(String(o.state ?? o.status ?? '').toLowerCase()));
      (open.length === 0 ? pass : fail)('open-orders', `${open.length} open order(s) in ${handoff.ticker}`);
    } catch (err) {
      fail('open-orders', err.message);
    }
  }

  note('market-session', regularSessionOpen()
    ? 'OPEN — test-zero/test-one allowed now; the queued test is NOT (it needs the market closed)'
    : (safeAfterHoursWindow()
        ? 'CLOSED with a safe buffer — the queued after-hours test is allowed now; test-zero/test-one are not'
        : 'CLOSED but near a session edge — neither the live tests nor the queued test will run; wait for the open or a clean after-hours buffer'));
  const arm = await readSwitch().catch((e) => ({ state: 'UNREADABLE', row: null, why: e.message }));
  note('arm-switch', `${arm.state}${arm.row ? ` for ${arm.row}` : ''} — ${arm.why}`);

  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    console.log(`\nPROBE: ${failures.length} gate(s) FAILED — fix before arming anything. Raw captures in executor-tests/raw/.`);
    process.exit(1);
  }
  console.log('\nPROBE: every live-checkable gate PASSES. Raw captures in executor-tests/raw/.');
  process.exit(0);
}

// ---------- commands --------------------------------------------------------

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (f) => rest.includes(f);
  const val = (f) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };

  if (cmd === 'validate') {
    const file = rest.find((a) => !a.startsWith('--'));
    if (!file) { console.error('usage: executor validate <handoff.json>'); process.exit(2); }
    const h = JSON.parse(readFileSync(resolve(file), 'utf8'));
    const res = validateHandoff(h, { receiptsDir: RECEIPTS_DIR });
    if (res.ok) {
      try {
        const { shares, notional } = computeOrderShares(h);
        const risk = reconcileRisk(h, shares, notional);
        console.log(`VALID — contract passes. Order would be ${shares} shares ≈ $${notional.toFixed(2)} notional. ${risk.basis}. Live preflight still applies.`);
      } catch (err) {
        console.log(`Contract passes but the order math refuses: ${err.message}`);
        process.exit(1);
      }
      process.exit(0);
    }
    console.log(`REFUSED — ${res.refusals.length} violation(s):`);
    for (const r of res.refusals) console.log(`  ${r.code}: ${r.message}`);
    process.exit(1);
  }

  if (cmd === 'status') {
    const arm = await readSwitch().catch((e) => ({ state: 'UNREADABLE', row: null, why: e.message }));
    console.log(`arm switch: ${arm.state}${arm.row ? ` for ${arm.row}` : ''} — ${arm.why}`);
    console.log(`token: ${process.env.BENCH_EXECUTOR_TOKEN ? 'env override' : loadStore()?.tokens?.access_token ? 'on file' : 'NONE — run login'}`);
    const receipts = existsSync(RECEIPTS_DIR) ? readdirSync(RECEIPTS_DIR).filter((f) => f.endsWith('.json')) : [];
    console.log(`receipts: ${receipts.length} on disk; test zero ${hasCompletedTestZero() ? 'COMPLETE (clean)' : 'not yet clean'}`);
    process.exit(0);
  }

  if (cmd === 'login') {
    requireTTY('login');
    await oauthLogin(ENDPOINT);
    console.log('Login complete — token stored in ~/.bench-executor/oauth.json');
    process.exit(0);
  }

  if (cmd === 'preflight') {
    const handoffPath = rest.find((a) => !a.startsWith('--')) ?? val('--handoff');
    if (!handoffPath) { console.error('usage: executor preflight <handoff.json>'); process.exit(2); }
    await runProbe(handoffPath);
    return;
  }

  if (cmd === 'test-zero' || cmd === 'test-one' || cmd === 'test-queued') {
    const handoffPath = val('--handoff');
    if (!handoffPath) { console.error(`usage: executor ${cmd} --handoff <file.json> --live`); process.exit(2); }
    await runLiveTest(cmd, handoffPath, flag('--live'));
    return;
  }

  console.error(`usage: node executor/executor.mjs <validate|preflight|status|login|test-zero|test-one> …
  validate <handoff.json>            offline contract + order-math + risk check
  preflight <handoff.json>           READ-ONLY live probe: connect, bind, account, buying power,
                                     quote, conflicts — order tools not even bound. No arm needed.
  status                             arm switch, token, receipts
  login                              OAuth to ${ENDPOINT} (TTY only)
  test-zero --handoff F --live       cancellation-path test, market OPEN (protocol §test zero)
  test-queued --handoff F --live     after-hours queued place+cancel, market CLOSED — near-zero fill risk,
                                     captures real broker schemas; does NOT unlock test-one (protocol §test queued)
  test-one  --handoff F --live       tiny live order (protocol §test one; sequenced behind a clean test zero)`);
  process.exit(2);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => { console.error(`fatal: ${err.message}`); process.exit(2); });
}
