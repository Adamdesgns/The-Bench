// real-order.mjs — real orders, approved from Adam's phone (bench-executor-v2).
//
// Adam pre-approves ONE specific ticket by sending
//     ARM B-### <ticket code> <one-time code>
// and the program places that ticket, once, when its condition comes true.
// No AI session arms or places anything: a ticket writer only writes a file
// and a text, and this module runs only from `executor.mjs watch|place`.
//
// Every function takes its outside world as arguments so the offline tests can
// run every path with fakes. Nothing retries: a waiting ticket is checked again
// on the next tick, but a ticket that reaches its attempt gets exactly one.
import { closeSync, existsSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { validateRealHandoff, REAL_ORDER_CEILING_USD } from '../../scripts/executor-validate.mjs';
import {
  computeOrderShares, reconcileRisk, parseDriftBound, regularSessionOpen, identifyOrder,
  matchesOrderDetails, filledQuantityOf, PreflightError, OPEN_RAW,
} from '../executor.mjs';
import {
  normalizeState, findNumberByKey, collectAccounts, collectOrders, collectPositions,
  assertParsed, orderIdOf, refIdOf,
} from './broker.mjs';
import { Receipt, archiveRaw } from './receipts.mjs';
import { ticketCode, conditionMet } from './ticket.mjs';
import { ARM_TOPIC } from './arm.mjs';

export const MODE = 'real-order';
export const QUOTE_MAX_AGE_SEC = 120;
export const TICK_LOCK_STALE_MIN = 10;
export const ARM_RE = /^ARM (B-\d+) ([A-Z2-9]{6}) (\d{2}-[A-Z2-9]{8})$/;
const AI_SESSION_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_THREAD_ID', 'CODEX_CI'];
const FOLLOWED_STATES = new Set(['PENDING', 'PARTIALLY_FILLED']);

// A trip wire against mistakes, not a wall: software on this PC can clear an
// environment variable. It stops an AI session from running this by accident.
export function insideAiSession(env = process.env) {
  return AI_SESSION_ENV.find((k) => env[k]) ?? null;
}

const WHEN_TEXT = (w) => (w.type === 'NOW' ? 'at the open or now' : `when last is ${w.type === 'LAST_AT_OR_BELOW' ? 'at or below' : 'at or above'} ${w.price}`);

// ---------- the test gate ---------------------------------------------------

// Real orders stay locked until clean test-zero and test-one receipts exist AND
// are committed, so a file dropped in the folder by hand or by a script does
// not count. `isCommitted(path)` is true for a tracked, unmodified file.
export function testGate(receiptsDir, isCommitted, ceilingUsd = REAL_ORDER_CEILING_USD) {
  if (!(ceilingUsd > 0)) return { ok: false, why: 'no per-order limit set' };
  let zero = false;
  let one = false;
  if (existsSync(receiptsDir)) {
    for (const f of readdirSync(receiptsDir)) {
      if (!f.endsWith('.json')) continue;
      const path = join(receiptsDir, f);
      let r;
      try { r = JSON.parse(readFileSync(path, 'utf8')); } catch { return { ok: false, why: `unreadable receipt ${f}` }; }
      if (r.mode !== 'test-zero' && r.mode !== 'test-one') continue;
      if (!isCommitted(path)) continue;
      if (r.mode === 'test-zero' && r.state === 'CANCELED' && !(r.final_filled_quantity > 0) && r.broker_order_id) zero = true;
      if (r.mode === 'test-one' && r.broker_order_id && ['PENDING', 'PARTIALLY_FILLED', 'FILLED'].includes(r.state)) one = true;
    }
  }
  if (!zero) return { ok: false, why: 'no clean, committed test-zero receipt' };
  if (!one) return { ok: false, why: 'no clean, committed test-one receipt' };
  return { ok: true, why: 'test-zero and test-one receipts are clean and committed' };
}

// ---------- reading the phone's messages ------------------------------------

export async function readArmMessages(fetchImpl = fetch) {
  const res = await fetchImpl(`${ARM_TOPIC}/json?poll=1&since=12h`);
  if (!res.ok) throw new Error(`arm topic read failed: HTTP ${res.status}`);
  const text = await res.text();
  return text.trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l)).filter((m) => m.event === 'message')
    .sort((a, b) => a.time - b.time);
}

// Turns new phone messages into approvals, oldest first, so a copy of a code
// posted after Adam's own message finds that code already used. Each message
// is handled once. The message text is never logged or echoed: it can hold a code.
export async function ingestMessages(messages, d) {
  for (const m of messages) {
    if (d.store.hasSeen(m.id)) continue;
    d.store.markSeen(m.id);
    const text = String(m.message ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

    if (text === 'HALT' || text.startsWith('HALT ')) {
      for (const a of d.store.haltBefore(m.time)) await d.alert(`REAL ${a.row_id} STOPPED by HALT. It will not be placed.`);
      continue;
    }
    if (!text.startsWith('ARM ')) continue;

    const row = text.split(' ')[1] ?? '?';
    const refuse = (why) => d.alert(`REAL ${row} ARM REFUSED: ${why}`);
    if (d.store.locked) { await refuse('real orders are locked after wrong codes. Unlock at the terminal.'); continue; }
    const parsed = text.match(ARM_RE);
    if (!parsed) { await refuse('the line needs the ticket code and a one-time code.'); continue; }
    const [, rowId, code, oneTime] = parsed;

    const gate = d.gate();
    if (!gate.ok) { await refuse(`real orders are not unlocked (${gate.why}).`); continue; }

    let handoff;
    try { handoff = d.loadTicket(rowId); } catch { await refuse('its ticket file is unreadable.'); continue; }
    if (!handoff) { await refuse('no ticket for that row.'); continue; }
    if (handoff.row_id !== rowId || ticketCode(handoff) !== code) { await refuse('the ticket code does not match this order.'); continue; }
    if (d.store.approvalFor(handoff.plan_id)) { await refuse('that ticket was already approved once.'); continue; }
    if (m.time * 1000 < Date.parse(handoff.created_at)) { await refuse('the ARM is older than the ticket.'); continue; }
    const contract = validateRealHandoff(handoff, { now: d.now(), receiptsDir: d.receiptsDir, ceilingUsd: d.ceilingUsd });
    if (!contract.ok) { await refuse(`ticket fails its contract (${contract.refusals.map((r) => r.code).join(', ')}).`); continue; }

    const used = d.store.useCode(oneTime);
    if (used !== 'ok') {
      await refuse(`that one-time code is ${used}.${d.store.locked ? ' REAL ORDERS ARE NOW LOCKED. Unlock at the terminal.' : ''}`);
      continue;
    }
    d.store.addApproval({
      plan_id: handoff.plan_id, row_id: rowId, ticket_code: code, message_id: m.id, approved_at: m.time,
    });
    await d.alert(`REAL ${rowId} APPROVED: buy ${handoff.quantity_value} ${handoff.ticker}, limit $${handoff.limit_price}, ${WHEN_TEXT(handoff.place_when)}. ${d.store.codesLeft()} codes left. HALT stops it.`);
  }
}

// ---------- one attempt -----------------------------------------------------

function quoteTimeMs(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k.toLowerCase()) && typeof v === 'string') {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
  }
  for (const v of Object.values(obj)) {
    const t = quoteTimeMs(v, keys, depth + 1);
    if (t !== null) return t;
  }
  return null;
}

// The quote's age in seconds, or null when no time can be read from it.
export function quoteAgeSec(quotes, nowMs) {
  const t = quoteTimeMs(quotes, ['updated_at', 'venue_last_trade_time', 'last_trade_time', 'as_of']);
  return t === null ? null : (nowMs - t) / 1000;
}

const lastPriceOf = (quotes) => findNumberByKey(quotes, ['last_trade_price']) ?? findNumberByKey(quotes, ['last_price', 'price', 'mark']);

function findDeep(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const hit = findDeep(v, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const hasContent = (v) => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v).length > 0 : Boolean(v));

const orderArgs = (accountNumber, h, shares) => ({
  account_number: accountNumber,
  symbol: h.ticker,
  side: 'buy',
  type: 'limit',
  quantity: String(shares),
  limit_price: String(h.limit_price),
  time_in_force: 'gfd',
  market_hours: 'regular_hours',
});

async function resolveAccount(d, alias, receipt, planId) {
  const payload = await d.broker.call('accounts', {});
  if (receipt) receipt.addRaw(archiveRaw(d.rawDir, planId, 'accounts', payload));
  assertParsed(payload, 'accounts');
  const candidates = collectAccounts(payload).filter((a) => a.agentic_allowed === true);
  if (candidates.length !== 1) throw new PreflightError(`account refused: expected one agent-tradable account, found ${candidates.length}`);
  const number = String(candidates[0].account_number ?? '');
  if (!number.endsWith(alias.slice(-4))) throw new PreflightError('account refused: the agent-tradable account does not match the ticket');
  return number; // runtime only; never written to a receipt, a log or a message
}

// Every check that can stop the order, in the contract's order. Throws PreflightError.
async function preflight(d, h, shares, notional, quotes, receipt) {
  const nowMs = d.now().getTime();
  const raw = (label, p) => receipt.addRaw(archiveRaw(d.rawDir, h.plan_id, label, p));
  const accountNumber = await resolveAccount(d, h.account_alias, receipt, h.plan_id);

  const portfolio = await d.broker.call('portfolio', { account_number: accountNumber });
  raw('portfolio', portfolio);
  assertParsed(portfolio, 'portfolio');
  const bp = findNumberByKey(portfolio, ['buying_power', 'available_buying_power', 'cash_available_for_investing', 'cash_available']);
  if (!bp) throw new PreflightError('refused: buying power not found in the broker response');
  if (bp.value < notional) throw new PreflightError(`refused: buying power $${bp.value.toFixed(2)} is under the order's $${notional.toFixed(2)}`);

  raw('quotes', quotes);
  const age = quoteAgeSec(quotes, nowMs);
  if (age === null) throw new PreflightError('refused: the quote has no readable time');
  if (age > QUOTE_MAX_AGE_SEC || age < -60) throw new PreflightError(`refused: the quote is ${Math.round(age)} seconds old`);
  const last = lastPriceOf(quotes);
  if (!last) throw new PreflightError('refused: no last-trade price in the quote');
  const drift = parseDriftBound(h.maximum_price_drift, h.limit_price);
  if (!(Number.isFinite(drift) && drift > 0)) throw new PreflightError('refused: unreadable maximum_price_drift');
  if (Math.abs(last.value - h.limit_price) > drift) {
    throw new PreflightError(`refused: last ${last.value} is more than $${drift.toFixed(2)} from the limit ${h.limit_price}`);
  }

  const positions = await d.broker.call('positions', { account_number: accountNumber });
  raw('positions', positions);
  assertParsed(positions, 'positions');
  const held = collectPositions(positions).filter((p) => p.symbol === String(h.ticker).toUpperCase()).reduce((s, p) => s + p.quantity, 0);
  if (held > 0) throw new PreflightError(`refused: already holding ${held} ${h.ticker}`);

  const orders = await d.broker.call('orders', { account_number: accountNumber, symbol: h.ticker });
  raw('orders-preflight', orders);
  assertParsed(orders, 'orders');
  const open = collectOrders(orders).filter((o) => OPEN_RAW.has(String(o.state ?? o.status ?? '').toLowerCase()));
  if (open.length) throw new PreflightError(`refused: ${open.length} open order(s) already in ${h.ticker}`);

  return accountNumber;
}

// One tick's work on one approved ticket. Returns { status, detail } where
// status is WAITING, or the approval's final status.
export async function attemptTicket(h, approval, d) {
  const now = d.now();
  const tag = `REAL ${h.row_id}`;
  const end = async (status, line) => {
    d.store.setStatus(h.plan_id, status, line);
    await d.alert(line);
    return { status, detail: line };
  };

  if (Date.parse(h.expires_at) <= now.getTime()) return end('expired', `${tag} EXPIRED: the condition never came true. Nothing was placed.`);
  if (ticketCode(h) !== approval.ticket_code) return end('void', `${tag} REFUSED: the ticket changed after you approved it. Nothing was placed.`);
  const contract = validateRealHandoff(h, { now, receiptsDir: d.receiptsDir, ceilingUsd: d.ceilingUsd });
  if (!contract.ok) return end('refused', `${tag} REFUSED: ${contract.refusals.map((r) => r.code).join(', ')}. Nothing was placed.`);
  const bookRow = d.bookRow(h.row_id);
  if (!bookRow || String(bookRow.ticker).toUpperCase() !== String(h.ticker).toUpperCase()) {
    return end('refused', `${tag} REFUSED: that row is not in the book for ${h.ticker}. Nothing was placed.`);
  }
  const gate = d.gate();
  if (!gate.ok) return end('refused', `${tag} REFUSED: ${gate.why}. Nothing was placed.`);

  let shares; let notional; let risk;
  try {
    ({ shares, notional } = computeOrderShares(h, d.ceilingUsd));
    risk = reconcileRisk(h, shares, notional);
  } catch (err) {
    if (!(err instanceof PreflightError)) throw err;
    return end('refused', `${tag} ${err.message}. Nothing was placed.`);
  }

  // Until the ticket fires, an unreadable quote just means "look again next tick".
  if (!regularSessionOpen(now)) return { status: 'WAITING', detail: 'market closed' };
  let quotes = null;
  let quoteTrouble = null;
  try {
    quotes = await d.broker.call('quotes', { symbols: [h.ticker] });
    assertParsed(quotes, 'quotes');
    if (!lastPriceOf(quotes)) quoteTrouble = 'no last price';
  } catch (err) {
    quoteTrouble = err.message;
  }
  if (quoteTrouble) {
    if (!approval.quote_warned) {
      d.store.note(h.plan_id, 'quote_warned', true);
      await d.alert(`${tag} cannot read a quote yet (${quoteTrouble.slice(0, 120)}). Still watching; nothing placed.`);
    }
    return { status: 'WAITING', detail: 'quote unreadable' };
  }
  if (!conditionMet(h.place_when, lastPriceOf(quotes).value)) return { status: 'WAITING', detail: 'condition not met' };

  // From here on the ticket gets its one attempt. The approval is spent first.
  d.store.setStatus(h.plan_id, 'attempting');
  let commit;
  try {
    commit = d.commit();
  } catch (err) {
    return end('refused', `${tag} REFUSED: ${String(err.message).slice(0, 160)}. Nothing was placed.`);
  }

  let receipt;
  try {
    receipt = new Receipt(d.receiptsDir, h, { mode: MODE, commit });
  } catch (err) {
    return end('refused', `${tag} REFUSED: ${String(err.message).slice(0, 160)}. Nothing was placed.`);
  }
  receipt.set('arm', { message_id: approval.message_id, ticket_code: approval.ticket_code, approved_at: approval.approved_at });
  await d.alert(`${tag} STARTING: buy ${shares} ${h.ticker}, limit $${h.limit_price}, about $${notional.toFixed(2)}. ${risk.basis}.`);

  let placed = false;
  try {
    const accountNumber = await preflight(d, h, shares, notional, quotes, receipt);

    const review = await d.broker.call('review', orderArgs(accountNumber, h, shares));
    receipt.addRaw(archiveRaw(d.rawDir, h.plan_id, 'review', review));
    assertParsed(review, 'review');
    const checks = findDeep(review, 'order_checks');
    if (checks === undefined) throw new PreflightError('refused: the review did not report its order checks');
    if (hasContent(checks)) throw new PreflightError(`refused: broker alert on the review: ${JSON.stringify(checks).slice(0, 200)}`);
    if (hasContent(findDeep(review, 'alerts'))) throw new PreflightError(`refused: broker alert on the review: ${JSON.stringify(findDeep(review, 'alerts')).slice(0, 200)}`);
    const reviewRef = String(review?.review_id ?? review?.ref ?? review?.id ?? 'NONE');
    receipt.set('review_ref', reviewRef);
    receipt.transition('REVIEWED', `broker review complete (ref ${reviewRef})`);
    receipt.transition('CONFIRMED', `approved from the phone, message ${approval.message_id}`);
    const needsTap = findDeep(review, 'customer_approval_required') === true;

    const refId = randomUUID();
    receipt.set('ref_id', refId);
    receipt.transition('PLACEMENT_ATTEMPTED', `calling place exactly once (ref_id ${refId})`);
    placed = true;
    d.store.setStatus(h.plan_id, 'placed', 'placement attempted');

    let result;
    try {
      result = await d.broker.call('place', { ...orderArgs(accountNumber, h, shares), ref_id: refId });
    } catch (err) {
      receipt.transition('UNKNOWN_REQUIRES_RECONCILIATION', `placement call failed ambiguously: ${err.message}`);
      await d.alert(`${tag} UNKNOWN: the place call failed unclearly. No retry. CHECK THE ROBINHOOD APP.`);
      const listing = await d.broker.call('orders', { account_number: accountNumber, symbol: h.ticker });
      receipt.addRaw(archiveRaw(d.rawDir, h.plan_id, 'reconcile', listing));
      const mine = collectOrders(listing).find((o) => refIdOf(o) === refId);
      if (mine) {
        receipt.set('broker_order_id', orderIdOf(mine));
        receipt.transition(normalizeState(mine), 'order found during reconciliation');
      }
      return { status: 'UNKNOWN', detail: 'placement ambiguous' };
    }
    receipt.addRaw(archiveRaw(d.rawDir, h.plan_id, 'place', result));

    const inResult = collectOrders(result);
    let hit = identifyOrder(inResult, refId, h, shares)
      ?? (inResult.length === 1 && matchesOrderDetails(inResult[0], h, shares) ? { order: inResult[0], how: 'sole order in place response' } : null);
    if (!hit && needsTap) {
      receipt.set('approval_id', findDeep(result, 'approval_id') ?? null);
      receipt.transition('AWAITING_CUSTOMER_APPROVAL', 'Robinhood is holding this for a tap in the app');
      await d.alert(`${tag} WAITING ON YOUR TAP: Robinhood's approval setting is on, so this needs approving in the Robinhood app.`);
      return { status: 'AWAITING_TAP', detail: 'Robinhood approval setting is on' };
    }
    if (!hit) {
      const listing = await d.broker.call('orders', { account_number: accountNumber, symbol: h.ticker });
      receipt.addRaw(archiveRaw(d.rawDir, h.plan_id, 'orders-after-place', listing));
      hit = identifyOrder(collectOrders(listing), refId, h, shares);
    }
    if (!hit || !orderIdOf(hit.order)) {
      receipt.transition('UNKNOWN_REQUIRES_RECONCILIATION', 'placement returned but no order could be identified');
      await d.alert(`${tag} UNKNOWN: placed, but the order could not be identified. CHECK THE ROBINHOOD APP.`);
      return { status: 'UNKNOWN', detail: 'placed but unidentifiable' };
    }
    const orderId = orderIdOf(hit.order);
    receipt.set('broker_order_id', orderId);
    const state = normalizeState(hit.order);
    if (state === 'FILLED') receipt.set('final_filled_quantity', filledQuantityOf(hit.order) ?? shares);
    receipt.transition(state, `order ${orderId} after placement (identified by ${hit.how})`);
    await d.alert(`${tag} ${state}: buy ${shares} ${h.ticker} at limit $${h.limit_price}. ${state === 'FILLED' ? 'The exit is yours.' : 'Filled or not, I will text the result.'}`);
    return { status: state, detail: `order ${orderId}` };
  } catch (err) {
    if (!placed) {
      receipt.transition('PREFLIGHT_REFUSED', err.message);
      return end('refused', `${tag} ${String(err.message).slice(0, 200)}. Nothing was placed.`);
    }
    receipt.transition('UNKNOWN_REQUIRES_RECONCILIATION', `error after placement: ${err.message}`);
    await d.alert(`${tag} UNKNOWN: error after placing. CHECK THE ROBINHOOD APP.`);
    return { status: 'UNKNOWN', detail: 'error after placement' };
  }
}

// ---------- following an order after it is placed ---------------------------

// A DAY limit can fill hours after it goes in. Each tick reads every real order
// still working and texts Adam when its state changes. Reads only.
export async function followOpenOrders(d) {
  if (!existsSync(d.receiptsDir)) return [];
  const changed = [];
  for (const f of readdirSync(d.receiptsDir)) {
    if (!f.endsWith('.json')) continue;
    const path = join(d.receiptsDir, f);
    let r;
    try { r = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
    if (r.mode !== MODE || !FOLLOWED_STATES.has(r.state) || !r.broker_order_id) continue;
    try {
      const accountNumber = await resolveAccount(d, r.account_alias, null, r.plan_id);
      const payload = await d.broker.call('orders', { account_number: accountNumber, order_id: r.broker_order_id });
      const order = collectOrders(payload).find((o) => String(orderIdOf(o)) === String(r.broker_order_id));
      if (!order) continue;
      const state = normalizeState(order);
      if (state === r.state || state === 'UNKNOWN_REQUIRES_RECONCILIATION') continue;
      const filled = filledQuantityOf(order);
      if (filled !== null) r.final_filled_quantity = filled;
      r.state = state;
      r.transitions.push({ state, at: d.now().toISOString(), detail: 'seen by the watcher' });
      writeFileSync(path, JSON.stringify(r, null, 2));
      changed.push(r.row_id);
      await d.alert(`REAL ${r.row_id} ${state}: ${r.ticker}${filled !== null ? `, ${filled} shares filled` : ''}.${state === 'FILLED' || state === 'PARTIALLY_FILLED' ? ' The exit is yours.' : ''}`);
    } catch (err) {
      d.log(`follow ${r.row_id}: ${err.message}`);
    }
  }
  return changed;
}

// ---------- one tick --------------------------------------------------------

// Two ticks must never work at once. A leftover lock from a crash is cleared
// after a while: a ticket that was mid-attempt is already marked spent.
export function takeTickLock(dir, nowMs) {
  const path = join(dir, 'tick.lock');
  const take = () => { closeSync(openSync(path, 'wx')); return { held: true, path, stale: false }; };
  try {
    return take();
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    if (nowMs - statSync(path).mtimeMs < TICK_LOCK_STALE_MIN * 60000) return { held: false, path, stale: false };
    unlinkSync(path);
    return { ...take(), stale: true };
  }
}

// Reads the phone, then works every approved ticket. If the phone's messages
// cannot be read this tick, nothing is placed: a HALT could be sitting there.
export async function runTick(d) {
  const lock = takeTickLock(d.stateDir, d.now().getTime());
  if (!lock.held) return { skipped: 'another tick is running' };
  try {
    if (lock.stale) await d.alert('REAL ORDERS: cleared a stale watcher lock. Check the Robinhood app if an order was in progress.');
    let messages;
    try {
      messages = await d.readMessages();
    } catch (err) {
      d.log(`phone messages unreadable, nothing placed: ${err.message}`);
      return { skipped: 'phone messages unreadable' };
    }
    await ingestMessages(messages, d);

    for (const a of d.store.byStatus('attempting')) {
      d.store.setStatus(a.plan_id, 'interrupted', 'a previous tick stopped mid-attempt');
      await d.alert(`REAL ${a.row_id} INTERRUPTED mid-attempt. It will not be retried. CHECK THE ROBINHOOD APP.`);
    }

    const active = d.store.byStatus('active');
    const results = [];
    if (active.length || d.hasOpenOrders()) await d.connect();
    await followOpenOrders(d);
    for (const a of active) {
      let h;
      try {
        h = d.loadTicket(a.row_id);
      } catch {
        h = null;
      }
      if (!h || h.plan_id !== a.plan_id) {
        d.store.setStatus(a.plan_id, 'void', 'ticket missing or replaced');
        await d.alert(`REAL ${a.row_id} REFUSED: the ticket is missing or was replaced. Nothing was placed.`);
        results.push({ row: a.row_id, status: 'void' });
        continue;
      }
      const r = await attemptTicket(h, a, d);
      results.push({ row: a.row_id, ...r });
    }
    return { results };
  } finally {
    unlinkSync(lock.path);
  }
}

// True when a placed real order is still working.
export function hasOpenRealOrders(receiptsDir) {
  if (!existsSync(receiptsDir)) return false;
  return readdirSync(receiptsDir).some((f) => {
    if (!f.endsWith('.json')) return false;
    try {
      const r = JSON.parse(readFileSync(join(receiptsDir, f), 'utf8'));
      return r.mode === MODE && FOLLOWED_STATES.has(r.state);
    } catch { return false; }
  });
}
