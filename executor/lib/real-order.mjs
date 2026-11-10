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
//
// OPEN RISK, not fixable here: the approval state is a file on this PC. A
// process running as Adam can write an 'active' approval into it, or mint codes,
// and this program will act on it. See docs/executor-test-protocol.md.
import { execFileSync } from 'node:child_process';
import {
  closeSync, existsSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { validateRealHandoff, sanitizePlanId, REAL_ORDER_CEILING_USD } from '../../scripts/executor-validate.mjs';
import {
  computeOrderShares, reconcileRisk, parseDriftBound, identifyOrder,
  matchesOrderDetails, filledQuantityOf, PreflightError, OPEN_RAW,
} from '../executor.mjs';
import { realSessionOpen, nyDate } from './calendar.mjs';
import {
  normalizeState, findNumberByKey, collectAccounts, collectOrders, collectPositions,
  assertParsed, orderIdOf, refIdOf,
} from './broker.mjs';
import { Receipt, archiveRaw } from './receipts.mjs';
import { ticketCode, ticketDigest, conditionMet } from './ticket.mjs';
import { ARM_TOPIC } from './arm.mjs';

export const MODE = 'real-order';
export const QUOTE_MAX_AGE_SEC = 120;
// Most time allowed between reading the quote and sending the order.
export const QUOTE_TO_PLACE_MAX_SEC = 60;
export const TICK_LOCK_STALE_MIN = 10;
// A tick that runs this long is killed by the command, well before another
// tick may treat its lock as stale. The Windows task's own limit is 5 minutes.
export const TICK_HARD_LIMIT_MS = 4 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 20 * 1000;
// The phone channel keeps messages for 12 hours and the watcher reads them all.
// If the last good read is older than this, a HALT may have aged out unread.
export const PHONE_WINDOW_HOURS = 12;
export const PHONE_GAP_LIMIT_SEC = 11 * 3600;
// An approval waits this long before anything can be placed, so the APPROVED
// text reaches the phone first and a HALT can still stop it.
export const MIN_APPROVAL_AGE_SEC = 90;
export const ARM_RE = /^ARM (B-\d+) ([A-Z2-9]{6}) (\d{2}-[A-Z2-9]{8})$/;
const CODE_TOKEN = /(?:^|\s)(\d{2}-[A-Z2-9]{8})(?=\s|$)/;
const AI_SESSION_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_THREAD_ID', 'CODEX_CI'];
const FOLLOWED_STATES = new Set(['PENDING', 'PARTIALLY_FILLED']);

// A trip wire against mistakes, not a wall: software on this PC can clear an
// environment variable. It stops an AI session from running this by accident.
export function insideAiSession(env = process.env) {
  return AI_SESSION_ENV.find((k) => env[k]) ?? null;
}

const WHEN_TEXT = (w) => (w.type === 'NOW' ? 'at the open or now' : `when last is ${w.type === 'LAST_AT_OR_BELOW' ? 'at or below' : 'at or above'} ${w.price}`);
const nowSec = (d) => Math.floor(d.now().getTime() / 1000);

// ---------- the test gate ---------------------------------------------------

// Git checks for the gate, run in `root`. isCommitted: tracked and unmodified.
// isAncestor: a real commit that HEAD descends from.
export function makeGitChecks(root) {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return {
    isCommitted: (path) => {
      try {
        if (!run(['ls-files', '--', path])) return false;
        return !run(['status', '--porcelain', '--', path]);
      } catch { return false; }
    },
    isAncestor: (sha) => {
      if (!/^[0-9a-f]{7,40}$/i.test(String(sha ?? ''))) return false;
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', String(sha), 'HEAD'], { cwd: root, stdio: 'ignore' });
        return true;
      } catch { return false; }
    },
  };
}

// Real orders stay locked until clean test-zero and test-one receipts exist,
// are committed, and were written by a commit HEAD descends from. This is the
// file half of the gate. The other half, verifyTestOrders, asks the broker
// whether those orders really happened, because a script can write and commit
// a file that looks like a receipt.
export function testGate(receiptsDir, checks, ceilingUsd = REAL_ORDER_CEILING_USD) {
  if (!(ceilingUsd > 0)) return { ok: false, why: 'no per-order limit set' };
  const isCommitted = checks?.isCommitted ?? (() => false);
  const isAncestor = checks?.isAncestor ?? (() => false);
  let zero = null;
  let one = null;
  if (existsSync(receiptsDir)) {
    for (const f of readdirSync(receiptsDir)) {
      if (!f.endsWith('.json')) continue;
      const path = join(receiptsDir, f);
      let r;
      try { r = JSON.parse(readFileSync(path, 'utf8')); } catch { return { ok: false, why: `unreadable receipt ${f}` }; }
      if (r.mode !== 'test-zero' && r.mode !== 'test-one') continue;
      if (!isCommitted(path) || !isAncestor(r.executor_commit)) continue;
      if (r.mode === 'test-zero' && r.state === 'CANCELED' && !(r.final_filled_quantity > 0) && r.broker_order_id) zero ??= { order_id: r.broker_order_id, file: f, symbol: r.ticker ?? null };
      if (r.mode === 'test-one' && r.broker_order_id && ['PENDING', 'PARTIALLY_FILLED', 'FILLED'].includes(r.state)) one ??= { order_id: r.broker_order_id, file: f, symbol: r.ticker ?? null };
    }
  }
  if (!zero) return { ok: false, why: 'no clean, committed test-zero receipt' };
  if (!one) return { ok: false, why: 'no clean, committed test-one receipt' };
  return { ok: true, why: 'test-zero and test-one receipts are clean and committed', proof: { zero, one } };
}

// The broker half of the gate: both test orders must be in the agent-tradable
// account's own order history. Test zero must have been cancelled with nothing
// filled; test one must show a fill. Throws PreflightError on a mismatch; any
// other error means the history could not be read.
export async function verifyTestOrders(d, accountNumber, proof) {
  const read = async (label, orderId, symbol) => {
    const payload = await d.broker.call('orders', { account_number: accountNumber, order_id: orderId });
    assertParsed(payload, 'orders');
    const order = collectOrders(payload).find((o) => String(orderIdOf(o)) === String(orderId));
    if (!order) throw new PreflightError(`refused: the ${label} receipt's order is not in this account's order history at Robinhood`);
    // Tie the broker's order to the receipt: same stock, when both say which.
    const sym = typeof order.symbol === 'string' ? order.symbol.toUpperCase() : null;
    if (sym && symbol && sym !== String(symbol).toUpperCase()) {
      throw new PreflightError(`refused: Robinhood's ${label} order is for ${sym}, but its receipt says ${symbol}`);
    }
    return order;
  };
  if (!proof?.zero?.order_id || !proof?.one?.order_id) throw new PreflightError('refused: the test gate named no test orders');
  const zero = await read('test-zero', proof.zero.order_id, proof.zero.symbol);
  if (normalizeState(zero) !== 'CANCELED' || (filledQuantityOf(zero) ?? 0) > 0) {
    throw new PreflightError('refused: Robinhood does not show the test-zero order as cancelled with nothing filled');
  }
  const one = await read('test-one', proof.one.order_id, proof.one.symbol);
  const s = normalizeState(one);
  if (!(s === 'FILLED' || s === 'PARTIALLY_FILLED' || (filledQuantityOf(one) ?? 0) > 0)) {
    throw new PreflightError('refused: Robinhood does not show the test-one order as filled');
  }
}

// ---------- reading the phone's messages ------------------------------------

export async function readArmMessages(fetchImpl = fetch) {
  const res = await fetchImpl(`${ARM_TOPIC}/json?poll=1&since=${PHONE_WINDOW_HOURS}h`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`arm topic read failed: HTTP ${res.status}`);
  const text = await res.text();
  return text.trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l)).filter((m) => m.event === 'message')
    .sort((a, b) => a.time - b.time);
}

// Turns new phone messages into approvals, oldest first. Each message is
// handled once. A code is spent the moment it shows up in ANY message, before
// anything else is checked: once posted on the open channel it is public, so a
// refused ARM must never leave a working code behind for someone else to use.
// The message text is never logged or echoed: it can hold a code.
export async function ingestMessages(messages, d) {
  for (const m of messages) {
    if (d.store.hasSeen(m.id)) continue;
    d.store.markSeen(m.id);
    const text = String(m.message ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

    if (text === 'HALT' || text.startsWith('HALT ')) {
      for (const a of d.store.haltBefore(m.time)) await d.alert(`REAL ${a.row_id} STOPPED by HALT. It will not be placed unless you send a new ARM for it with your next code.`);
      continue;
    }
    const token = text.match(CODE_TOKEN)?.[1] ?? null;
    if (!text.startsWith('ARM ') && !token) continue;

    const second = text.split(' ')[1] ?? '';
    const row = /^B-\d+$/.test(second) ? second : '?';
    const wasLocked = d.store.locked;
    const used = token ? d.store.useCode(token, { count: !wasLocked }) : 'none';
    const spent = used === 'ok' ? ' That code is now spent; use your next one.' : '';
    const refuse = (why) => d.alert(`REAL ${row} ARM REFUSED: ${why}${spent}`);

    if (wasLocked) { await refuse('real orders are locked after wrong codes. Unlock at the terminal.'); continue; }
    const parsed = text.match(ARM_RE);
    if (!parsed || parsed[3] !== token) { await refuse('the line must be ARM, the row, the ticket code and one one-time code.'); continue; }
    const [, rowId, code] = parsed;
    if (used !== 'ok') {
      await refuse(`that one-time code is ${used}.${d.store.locked ? ' REAL ORDERS ARE NOW LOCKED. Unlock at the terminal.' : ''}`);
      continue;
    }

    const gate = d.gate();
    if (!gate.ok) { await refuse(`real orders are not unlocked (${gate.why}).`); continue; }
    try { d.commit(); } catch (err) { await refuse(`${String(err.message).slice(0, 160)}.`); continue; }

    let handoff;
    try { handoff = d.loadTicket(rowId); } catch { await refuse('its ticket file is unreadable.'); continue; }
    if (!handoff) { await refuse('no ticket for that row.'); continue; }
    if (handoff.row_id !== rowId || ticketCode(handoff) !== code) { await refuse('the ticket code does not match this order.'); continue; }
    if (!d.store.canReapprove(handoff.plan_id)) { await refuse('that ticket was already approved and tried once.'); continue; }
    if (m.time * 1000 < Date.parse(handoff.created_at)) { await refuse('the ARM is older than the ticket.'); continue; }
    const contract = validateRealHandoff(handoff, { now: d.now(), receiptsDir: d.receiptsDir, ceilingUsd: d.ceilingUsd });
    if (!contract.ok) { await refuse(`ticket fails its contract (${contract.refusals.map((r) => r.code).join(', ')}).`); continue; }

    d.store.addApproval({
      plan_id: handoff.plan_id, row_id: rowId, ticket_code: code, ticket_digest: ticketDigest(handoff),
      message_id: m.id, approved_at: m.time, ingested_at: nowSec(d),
    });
    await d.alert(`REAL ${rowId} APPROVED: buy ${handoff.quantity_value} ${handoff.ticker}, limit $${handoff.limit_price}, ${WHEN_TEXT(handoff.place_when)}, not before ${MIN_APPROVAL_AGE_SEC} seconds from now. ${d.store.codesLeft()} codes left. HALT stops it.`);
  }
}

// ---------- one attempt -----------------------------------------------------

function findTimeByKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === key && typeof v === 'string') {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
  }
  for (const v of Object.values(obj)) {
    const t = findTimeByKey(v, key, depth + 1);
    if (t !== null) return t;
  }
  return null;
}

// The age in seconds of the LAST TRADE in a quote, or null when the quote does
// not carry a last-trade time. A general "updated_at" can move without a trade,
// so it does not count.
export const QUOTE_TIME_KEYS = ['venue_last_trade_time', 'last_trade_time'];
export function quoteAgeSec(quotes, nowMs) {
  for (const key of QUOTE_TIME_KEYS) {
    const t = findTimeByKey(quotes, key);
    if (t !== null) return (nowMs - t) / 1000;
  }
  return null;
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
async function preflight(d, h, shares, notional, quotes, receipt, quoteAtMs) {
  const nowMs = quoteAtMs;
  const raw = (label, p) => receipt.addRaw(archiveRaw(d.rawDir, h.plan_id, label, p));
  const accountNumber = await resolveAccount(d, h.account_alias, receipt, h.plan_id);

  const portfolio = await d.broker.call('portfolio', { account_number: accountNumber });
  raw('portfolio', portfolio);
  assertParsed(portfolio, 'portfolio');
  const bp = findNumberByKey(portfolio, ['buying_power', 'available_buying_power', 'cash_available_for_investing', 'cash_available']);
  if (!bp) throw new PreflightError('refused: buying power not found in the broker response');
  if (bp.value < notional) throw new PreflightError(`refused: buying power $${bp.value.toFixed(2)} is under the order's $${notional.toFixed(2)}`);

  // The attempt only starts on a fresh quote; this repeats the check on the
  // same quote, at the moment it was read, so the receipt carries it and the
  // account calls in between cannot age it into a refusal.
  raw('quotes', quotes);
  const age = quoteAgeSec(quotes, nowMs);
  if (age === null) throw new PreflightError('refused: the quote has no last-trade time');
  if (age > QUOTE_MAX_AGE_SEC || age < -60) throw new PreflightError(`refused: the last trade is ${Math.round(age)} seconds old`);
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
  const warnOnce = async (key, line) => {
    if (approval[key]) return;
    d.store.note(h.plan_id, key, true);
    await d.alert(line);
  };

  if (Date.parse(h.expires_at) <= now.getTime()) return end('expired', `${tag} EXPIRED: the condition never came true. Nothing was placed.`);
  if (!approval.ticket_digest || !Number.isFinite(approval.ingested_at)) {
    return end('void', `${tag} REFUSED: the approval record is incomplete, so it was not made by this program. Nothing was placed.`);
  }
  if (ticketDigest(h) !== approval.ticket_digest || ticketCode(h) !== approval.ticket_code) {
    return end('void', `${tag} REFUSED: the ticket changed after you approved it. Nothing was placed.`);
  }
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

  // Wrong codes lock even tickets approved before the lock: they wait, unspent,
  // until Adam unlocks at the terminal or the ticket expires.
  if (d.store.locked) {
    await warnOnce('lock_warned', `${tag} HELD: real orders are locked after wrong codes. It will not place until you unlock at the terminal.`);
    return { status: 'WAITING', detail: 'locked' };
  }
  // The APPROVED text goes out first, and HALT has time to land.
  if (nowSec(d) - approval.ingested_at < MIN_APPROVAL_AGE_SEC) return { status: 'WAITING', detail: 'just approved' };

  // Until the ticket fires, a quote that is unreadable or old just means "look
  // again next tick". The condition is judged only on a fresh last trade.
  if (!realSessionOpen(now)) return { status: 'WAITING', detail: 'market closed' };

  // An executor version Adam has not pinned waits rather than spending the
  // approval: he can pin and the ticket still has its chance.
  try { d.commit(); } catch (err) {
    await warnOnce('pin_warned', `${tag} HELD: ${String(err.message).slice(0, 160)}. Still watching; nothing placed.`);
    return { status: 'WAITING', detail: 'executor version not pinned' };
  }

  // The broker half of the test gate: the test orders must really exist. Done
  // before the quote is read, so the quote is as fresh as possible when it is
  // judged. Checked once per approval (and again if the gate names other test
  // orders), not every minute a ticket waits.
  const proofKey = `${gate.proof?.zero?.order_id}|${gate.proof?.one?.order_id}`;
  if (d.store.approvalFor(h.plan_id)?.proof_verified !== proofKey) {
    try {
      const accountNumber = await resolveAccount(d, h.account_alias, null, h.plan_id);
      await verifyTestOrders(d, accountNumber, gate.proof);
    } catch (err) {
      if (err instanceof PreflightError) return end('refused', `${tag} ${String(err.message).slice(0, 200)}. Nothing was placed.`);
      await warnOnce('proof_warned', `${tag} cannot check the test orders at Robinhood yet (${String(err.message).slice(0, 120)}). Still watching; nothing placed.`);
      return { status: 'WAITING', detail: 'test orders unreadable' };
    }
    d.store.note(h.plan_id, 'proof_verified', proofKey);
  }

  let quotes = null;
  let quoteTrouble = null;
  let quoteAtMs = null; // when the quote was read: its age is judged here and again in preflight
  try {
    quotes = await d.broker.call('quotes', { symbols: [h.ticker] });
    assertParsed(quotes, 'quotes');
    quoteAtMs = d.now().getTime();
    const age = quoteAgeSec(quotes, quoteAtMs);
    if (!lastPriceOf(quotes)) quoteTrouble = 'no last price';
    else if (age === null) quoteTrouble = 'no last-trade time';
    else if (age > QUOTE_MAX_AGE_SEC || age < -60) quoteTrouble = `the last trade is ${Math.round(age)} seconds old`;
  } catch (err) {
    quoteTrouble = err.message;
  }
  if (quoteTrouble) {
    await warnOnce('quote_warned', `${tag} cannot use the quote yet (${quoteTrouble.slice(0, 120)}). Still watching; nothing placed.`);
    return { status: 'WAITING', detail: 'quote not usable' };
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
    receipt = new Receipt(d.receiptsDir, h, { mode: MODE, commit, exclusive: true });
  } catch (err) {
    return end('refused', `${tag} REFUSED: ${String(err.message).slice(0, 160)}. Nothing was placed.`);
  }
  receipt.set('arm', { message_id: approval.message_id, ticket_code: approval.ticket_code, approved_at: approval.approved_at });
  await d.alert(`${tag} STARTING: buy ${shares} ${h.ticker}, limit $${h.limit_price}, about $${notional.toFixed(2)}. ${risk.basis}.`);

  let placed = false;
  try {
    const accountNumber = await preflight(d, h, shares, notional, quotes, receipt, quoteAtMs);

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

    // The limit price caps what is paid, but the order still goes in only while
    // the quote it was judged on is recent: a slow broker is a refusal.
    const quoteToPlaceSec = (d.now().getTime() - quoteAtMs) / 1000;
    if (quoteToPlaceSec > QUOTE_TO_PLACE_MAX_SEC) {
      throw new PreflightError(`refused: ${Math.round(quoteToPlaceSec)} seconds passed between the quote and the order`);
    }

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
    const next = state === 'FILLED' ? 'The exit is yours.'
      : FOLLOWED_STATES.has(state) ? 'I will text when it fills or dies.'
        : 'CHECK THE ROBINHOOD APP.';
    await d.alert(`${tag} ${state}: buy ${shares} ${h.ticker} at limit $${h.limit_price}. ${next}`);
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

const placedDateOf = (r) => {
  const t = (r.transitions ?? []).find((x) => x.state === 'PLACEMENT_ATTEMPTED')?.at;
  return t ? nyDate(new Date(t)) : null;
};

// A DAY limit can fill hours after it goes in. Each tick reads every real order
// still working and texts Adam when its state changes. Reads only. An order it
// cannot read is reported once; after its trading day it is no longer followed.
export async function followOpenOrders(d) {
  if (!existsSync(d.receiptsDir)) return [];
  const changed = [];
  for (const f of readdirSync(d.receiptsDir)) {
    if (!f.endsWith('.json')) continue;
    const path = join(d.receiptsDir, f);
    let r;
    try { r = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
    if (r.mode !== MODE || !FOLLOWED_STATES.has(r.state) || !r.broker_order_id || r.follow_stopped) continue;
    const save = () => writeFileSync(path, JSON.stringify(r, null, 2));
    const placedOn = placedDateOf(r);
    if (!placedOn || nyDate(d.now()) > placedOn) {
      r.follow_stopped = true;
      save();
      await d.alert(`REAL ${r.row_id}: its trading day is over and the last state I saw was ${r.state}. I have stopped following it. CHECK THE ROBINHOOD APP.`);
      continue;
    }
    const cannotRead = async (why) => {
      d.log(`follow ${r.row_id}: ${why}`);
      if (r.follow_warned) return;
      r.follow_warned = true;
      save();
      await d.alert(`REAL ${r.row_id}: cannot read the order's state (${why.slice(0, 100)}). CHECK THE ROBINHOOD APP.`);
    };
    try {
      const accountNumber = await resolveAccount(d, r.account_alias, null, r.plan_id);
      const payload = await d.broker.call('orders', { account_number: accountNumber, order_id: r.broker_order_id });
      const order = collectOrders(payload).find((o) => String(orderIdOf(o)) === String(r.broker_order_id));
      if (!order) { await cannotRead('the order is missing from the broker reply'); continue; }
      const state = normalizeState(order);
      if (state === 'UNKNOWN_REQUIRES_RECONCILIATION') { await cannotRead(`unrecognised state "${String(order.state ?? order.status).slice(0, 30)}"`); continue; }
      if (state === r.state) continue;
      const filled = filledQuantityOf(order);
      if (filled !== null) r.final_filled_quantity = filled;
      r.state = state;
      r.transitions.push({ state, at: d.now().toISOString(), detail: 'seen by the watcher' });
      save();
      changed.push(r.row_id);
      await d.alert(`REAL ${r.row_id} ${state}: ${r.ticker}${filled !== null ? `, ${filled} shares filled` : ''}.${state === 'FILLED' || state === 'PARTIALLY_FILLED' ? ' The exit is yours.' : ''}`);
    } catch (err) {
      d.log(`follow ${r.row_id}: ${err.message}`);
    }
  }
  return changed;
}

// ---------- one tick --------------------------------------------------------

// Two ticks must never work at once. The lock file holds a random token so a
// tick only ever releases its own lock. A leftover lock from a crash is taken
// over after TICK_LOCK_STALE_MIN; the command kills a tick at
// TICK_HARD_LIMIT_MS, long before that, and the state file's rev check stops a
// tick that somehow outlived its lock from writing anything.
export function takeTickLock(dir, nowMs) {
  const path = join(dir, 'tick.lock');
  const token = randomUUID();
  const take = () => {
    const fd = openSync(path, 'wx');
    try { writeSync(fd, token); } finally { closeSync(fd); }
    return { held: true, path, token, stale: false };
  };
  try {
    return take();
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let mtime;
    let staleToken;
    try { mtime = statSync(path).mtimeMs; staleToken = readFileSync(path, 'utf8'); } catch { return { held: false, path, stale: false }; }
    if (nowMs - mtime < TICK_LOCK_STALE_MIN * 60000) return { held: false, path, stale: false };
    // Move the stale lock aside, then confirm the file moved was the stale one
    // (same token), so two processes never both end up holding a lock.
    const aside = `${path}.stale-${token}`;
    try { renameSync(path, aside); } catch { return { held: false, path, stale: false }; }
    // If another process cleared the stale lock and took a fresh one between our
    // look and our move, we just moved ITS lock: put it back and stand down.
    let moved = null;
    try { moved = readFileSync(aside, 'utf8'); } catch { /* treated as not ours */ }
    if (moved !== staleToken) {
      try { renameSync(aside, path); } catch { /* nothing more we can safely do */ }
      return { held: false, path, stale: false };
    }
    try { unlinkSync(aside); } catch { /* removing the moved file is housekeeping */ }
    try { return { ...take(), stale: true }; } catch { return { held: false, path, stale: false }; }
  }
}

// Releases the lock only if it still holds this tick's token.
export function releaseTickLock(lock) {
  try {
    if (readFileSync(lock.path, 'utf8') !== lock.token) return false;
    unlinkSync(lock.path);
    return true;
  } catch { return false; }
}

function receiptForPlan(receiptsDir, planId) {
  const path = join(receiptsDir, `${sanitizePlanId(planId)}.json`);
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// Reads the phone, then works every approved ticket. If the phone's messages
// cannot be read this tick, nothing is placed: a HALT could be sitting there.
// The lock lives in the shared state folder, so a watcher tick, a hand-run
// `place` and `codes` from any checkout all queue behind one another, and the
// state is read fresh only once the lock is held. `onlyPlan` limits the tick
// to one ticket (the `place` command).
export async function runTick(d, { onlyPlan = null } = {}) {
  // File times are wall clock, so the lock is judged on the wall clock too.
  const lock = takeTickLock(d.stateDir, Date.now());
  if (!lock.held) return { skipped: 'another tick is running' };
  try {
    d.store = d.openStore();
    if (lock.stale) await d.alert('REAL ORDERS: cleared a stale watcher lock. Check the Robinhood app if an order was in progress.');
    let messages;
    try {
      messages = await d.readMessages();
    } catch (err) {
      d.log(`phone messages unreadable, nothing placed: ${err.message}`);
      return { skipped: 'phone messages unreadable' };
    }

    // The phone channel only reaches back PHONE_WINDOW_HOURS. If the last good
    // read is older than that (the PC slept, the task stopped), a HALT may have
    // aged out unread, so every approval made before the gap is cancelled.
    const lastRead = d.store.state.last_ingest_at;
    const waiting = d.store.byStatus('active');
    if (waiting.length && !(Number.isFinite(lastRead) && nowSec(d) - lastRead <= PHONE_GAP_LIMIT_SEC)) {
      for (const a of waiting) d.store.setStatus(a.plan_id, 'void', 'phone messages may have been missed');
      await d.alert(`REAL ORDERS: the phone channel was not read for over ${PHONE_GAP_LIMIT_SEC / 3600} hours, so a HALT could have been missed. ${waiting.map((a) => a.row_id).join(', ')} cancelled; nothing was placed. Send a new ARM with your next code to approve again.`);
    }
    await ingestMessages(messages, d);
    d.store.flag('last_ingest_at', nowSec(d));

    for (const a of d.store.byStatus('attempting')) {
      d.store.setStatus(a.plan_id, 'interrupted', 'a previous tick stopped mid-attempt');
      await d.alert(`REAL ${a.row_id} INTERRUPTED mid-attempt. It will not be retried. CHECK THE ROBINHOOD APP.`);
    }
    // A tick that died after calling place leaves the receipt at
    // PLACEMENT_ATTEMPTED with no outcome. Say so once; never place again.
    for (const a of d.store.byStatus('placed')) {
      const r = receiptForPlan(d.receiptsDir, a.plan_id);
      if (r && r.state !== 'PLACEMENT_ATTEMPTED') continue;
      d.store.setStatus(a.plan_id, 'placed_unknown', 'the tick stopped after calling place');
      await d.alert(`REAL ${a.row_id} UNKNOWN: the program stopped right after sending the order. It will not be sent again. CHECK THE ROBINHOOD APP.`);
    }

    // Tickets that are gone or past their time are settled without the broker,
    // so a broker outage can never hide an expiry.
    const results = [];
    const ready = [];
    for (const a of d.store.byStatus('active')) {
      if (onlyPlan && a.plan_id !== onlyPlan) continue;
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
      } else if (Date.parse(h.expires_at) <= d.now().getTime()) {
        d.store.setStatus(a.plan_id, 'expired', 'expired before it fired');
        await d.alert(`REAL ${a.row_id} EXPIRED: the condition never came true. Nothing was placed.`);
        results.push({ row: a.row_id, status: 'expired' });
      } else {
        ready.push({ a, h });
      }
    }

    if (!ready.length && !d.hasOpenOrders()) return { results };
    try {
      await d.connect();
      if (d.store.state.broker_warned) d.store.flag('broker_warned', false);
    } catch (err) {
      d.log(`broker unreachable: ${err.message}`);
      if (!d.store.state.broker_warned) {
        d.store.flag('broker_warned', true);
        await d.alert(`REAL ORDERS: cannot reach Robinhood (${String(err.message).slice(0, 120)}). Approved tickets are waiting; working orders are not being followed.`);
      }
      return { results, skipped: 'broker unreachable' };
    }
    if (!onlyPlan) await followOpenOrders(d);
    for (const { a, h } of ready) {
      const r = await attemptTicket(h, a, d);
      results.push({ row: a.row_id, ...r });
    }
    return { results };
  } finally {
    if (!releaseTickLock(lock)) {
      d.log('the tick lock was no longer this tick\'s; left it alone');
      await d.alert('REAL ORDERS: a watcher tick outlived its lock. Nothing more was written by it. CHECK THE ROBINHOOD APP if an order was in progress.');
    }
  }
}

// True when a placed real order is still being followed.
export function hasOpenRealOrders(receiptsDir) {
  if (!existsSync(receiptsDir)) return false;
  return readdirSync(receiptsDir).some((f) => {
    if (!f.endsWith('.json')) return false;
    try {
      const r = JSON.parse(readFileSync(join(receiptsDir, f), 'utf8'));
      return r.mode === MODE && FOLLOWED_STATES.has(r.state) && !r.follow_stopped;
    } catch { return false; }
  });
}
