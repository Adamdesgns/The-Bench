// executor-real-order.test.mjs — offline tests for real-order mode (bench-executor-v2).
// A fake broker and a fake phone: no network, no TTY, no real order is possible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateRealHandoff, validateHandoff, REAL_ORDER_CEILING_USD, HARD_TEST_CEILING_USD, REAL_MAX_DRIFT_PCT } from '../scripts/executor-validate.mjs';
import { buildTicket, writeTicket, ticketText, parseWhen, nextCloseIso } from '../scripts/executor-ticket.mjs';
import { ticketCode, ticketDigest, armLine, conditionMet, ticketPath, loadTicket } from '../executor/lib/ticket.mjs';
import { ApprovalStore, StateChangedError, WRONG_CODES_BEFORE_LOCK } from '../executor/lib/approvals.mjs';
import { Broker, REQUIRED_CAPABILITIES, REAL_ORDER_CAPABILITIES } from '../executor/lib/broker.mjs';
import {
  attemptTicket, ingestMessages, runTick, followOpenOrders, testGate, takeTickLock, releaseTickLock, insideAiSession,
  quoteAgeSec, makeGitChecks, QUOTE_MAX_AGE_SEC, QUOTE_TO_PLACE_MAX_SEC, MODE, MIN_APPROVAL_AGE_SEC, PHONE_GAP_LIMIT_SEC, TICK_HARD_LIMIT_MS, TICK_LOCK_STALE_MIN,
} from '../executor/lib/real-order.mjs';
import { computeOrderShares } from '../executor/executor.mjs';
import { Receipt } from '../executor/lib/receipts.mjs';
import { realSessionOpen, dayKind, firstSession } from '../executor/lib/calendar.mjs';

const CEILING = 200;
const NOW = new Date('2026-11-10T15:00:00Z'); // Tuesday, 10:00 in New York
const NOW_SEC = NOW.getTime() / 1000;
const tmp = () => mkdtempSync(join(tmpdir(), 'bench-real-'));

function ticket(over = {}, args = {}) {
  const h = buildTicket({
    row: 'B-500', ticker: 'TEST', shares: 2, limit: 50, stop: 45, drift: '$1',
    when: 'now', expires: '2026-11-10T21:00:00.000Z', now: new Date(NOW.getTime() - 3600000), ...args,
  });
  return { ...h, ...over };
}

const FRESH = '2026-11-10T14:59:50Z';
// The two test orders as Robinhood would show them: test zero cancelled with
// nothing filled, test one filled. Answered whatever else a test overrides.
const TEST_ORDERS = {
  tz1: { results: [{ id: 'tz1', state: 'cancelled', cumulative_quantity: '0' }] },
  to1: { results: [{ id: 'to1', state: 'filled', cumulative_quantity: '1' }] },
};
const PROOF = { zero: { order_id: 'tz1' }, one: { order_id: 'to1' } };
const okResponses = () => ({
  accounts: { accounts: [{ account_number: 'X1117724', agentic_allowed: true }] },
  portfolio: { buying_power: '150.00' },
  quotes: { results: [{ symbol: 'TEST', last_trade_price: '50.10', venue_last_trade_time: FRESH }] },
  positions: { results: [] },
  orders: { results: [] },
  review: { order_checks: [], review_id: 'rev-1' },
  place: { order: { id: 'ord-1', state: 'queued', symbol: 'TEST', quantity: '2', limit_price: '50' } },
});

function world({ responses = {}, tickets = null, book = { 'B-500': { id: 'B-500', ticker: 'TEST' } }, messages = [], gate = { ok: true, why: 'ok', proof: PROOF }, commit = () => 'abc1234', codes = 4, testOrders = TEST_ORDERS } = {}) {
  const root = tmp();
  const stateDir = join(root, 'state');
  const receiptsDir = join(root, 'receipts');
  const rawDir = join(root, 'raw');
  const store = new ApprovalStore(stateDir);
  const plainCodes = store.newCodes(codes);
  const alerts = [];
  const calls = [];
  const res = { ...okResponses(), ...responses };
  const h = ticket();
  const ticketMap = tickets ?? { 'B-500': h };
  const broker = {
    call: async (cap, args) => {
      calls.push({ cap, args });
      if (cap === 'orders' && args?.order_id && testOrders[args.order_id]) {
        const t = testOrders[args.order_id];
        if (t instanceof Error) throw t;
        return t;
      }
      const r = res[cap];
      if (r instanceof Error) throw r;
      return typeof r === 'function' ? r(args) : r;
    },
  };
  const d = {
    store, openStore: () => store, stateDir, receiptsDir, rawDir, ceilingUsd: CEILING,
    now: () => NOW,
    alert: async (l) => { alerts.push(l); return true; },
    log: () => {},
    loadTicket: (row) => ticketMap[row] ?? null,
    bookRow: (row) => book[row] ?? null,
    gate: () => gate,
    commit,
    readMessages: async () => messages,
    hasOpenOrders: () => false,
    connect: async () => {},
    broker,
  };
  return { d, store, alerts, calls, h, plainCodes, receiptsDir };
}

// An approval as ingest makes it, accepted two minutes ago, with the phone read
// a minute ago.
function approve(w, h = w.h, { code = w.plainCodes[0], ingestedAt = NOW_SEC - 120 } = {}) {
  assert.equal(w.store.useCode(code), 'ok');
  w.store.flag('last_ingest_at', NOW_SEC - 60);
  return w.store.addApproval({
    plan_id: h.plan_id, row_id: h.row_id, ticket_code: ticketCode(h), ticket_digest: ticketDigest(h),
    message_id: 'm1', approved_at: NOW_SEC - 180, ingested_at: ingestedAt,
  });
}

const places = (w) => w.calls.filter((c) => c.cap === 'place');
const at = (ms) => () => new Date(ms);
const receiptOf = (w) => JSON.parse(readFileSync(join(w.receiptsDir, readdirSync(w.receiptsDir)[0]), 'utf8'));
const statusOf = (w, h = w.h) => w.store.approvalFor(h.plan_id).status;
const msg = (id, message, time = NOW_SEC - 60) => ({ id, event: 'message', time, message });

// ---- the one valid path ----------------------------------------------------

test('valid path: an approved ticket is placed exactly once, with the exact order', async () => {
  const w = world();
  const a = approve(w);
  const out = await attemptTicket(w.h, a, w.d);
  assert.equal(out.status, 'PENDING');
  assert.equal(places(w).length, 1);
  const { ref_id: refId, ...args } = places(w)[0].args;
  assert.ok(refId);
  assert.deepEqual(args, {
    account_number: 'X1117724', symbol: 'TEST', side: 'buy', type: 'limit', quantity: '2',
    limit_price: '50', time_in_force: 'gfd', market_hours: 'regular_hours',
  });
  const r = receiptOf(w);
  assert.equal(r.mode, MODE);
  assert.equal(r.state, 'PENDING');
  assert.equal(r.broker_order_id, 'ord-1');
  assert.deepEqual(r.transitions.map((t) => t.state), ['RECEIVED', 'REVIEWED', 'CONFIRMED', 'PLACEMENT_ATTEMPTED', 'PENDING']);
  assert.equal(statusOf(w), 'placed');
  assert.ok(!JSON.stringify(r).includes('X1117724'), 'no full account number in the receipt');
  assert.ok(w.calls.findIndex((c) => c.cap === 'review') < w.calls.findIndex((c) => c.cap === 'place'), 'review before place');
});

test('valid path: phone message, a wait for HALT, one order, and the next tick does nothing', async () => {
  const h = ticket();
  const w = world({ tickets: { 'B-500': h } });
  w.d.readMessages = async () => [msg('m1', armLine(h, w.plainCodes[0]))];
  const first = await runTick(w.d);
  assert.equal(first.results[0].status, 'WAITING', 'not in the tick that approved it');
  assert.equal(first.results[0].detail, 'just approved');
  assert.equal(places(w).length, 0);
  w.d.now = at(NOW.getTime() + 95000);
  const second = await runTick(w.d);
  assert.equal(second.results[0].status, 'PENDING');
  assert.equal(places(w).length, 1);
  const third = await runTick(w.d);
  assert.deepEqual(third.results, []);
  assert.equal(places(w).length, 1, 'one approval, one placement');
  assert.ok(!w.alerts.join('\n').includes(w.plainCodes[0]), 'a code is never echoed to the phone');
  assert.ok(!JSON.stringify(receiptOf(w)).includes(w.plainCodes[0]), 'a code is never in a receipt');
});

// ---- waiting: nothing spent, nothing placed ---------------------------------

test('condition not met: waits, spends nothing, writes no receipt; fires when met', async () => {
  const h = ticket({ place_when: { type: 'LAST_AT_OR_BELOW', price: 49 } });
  const w = world({ tickets: { 'B-500': h } });
  w.h = h;
  const a = approve(w, h);
  assert.equal((await attemptTicket(h, a, w.d)).status, 'WAITING');
  assert.equal(places(w).length, 0);
  assert.ok(!existsSync(w.receiptsDir));
  assert.equal(statusOf(w, h), 'active');
  w.d.broker.call = (orig => async (cap, args) => (cap === 'quotes'
    ? { results: [{ last_trade_price: '49.00', venue_last_trade_time: FRESH }] } : orig(cap, args)))(w.d.broker.call);
  assert.equal((await attemptTicket(h, a, w.d)).status, 'PENDING');
});

test('market closed: waits without calling the broker', async () => {
  const w = world();
  const a = approve(w);
  w.d.now = () => new Date('2026-11-10T20:50:00Z'); // 15:50 New York, past the last new-order time
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'WAITING');
  assert.equal(w.calls.length, 0);
});

// A quote the condition cannot be judged on means "look again next tick":
// nothing is spent, no receipt is written.
const stale = '2026-11-10T14:50:00Z';
const unusableQuotes = [
  ['an old last trade', { results: [{ last_trade_price: '50.10', venue_last_trade_time: stale }] }],
  ['no last-trade time', { results: [{ last_trade_price: '50.10' }] }],
  ['only a general update time', { results: [{ last_trade_price: '50.10', updated_at: FRESH }] }],
  ['a last trade from the future', { results: [{ last_trade_price: '50.10', venue_last_trade_time: '2026-11-10T15:05:00Z' }] }],
];
for (const [name, quotes] of unusableQuotes) {
  test(`quote not usable (${name}): waits, spends nothing, then fires on a fresh one`, async () => {
    const w = world({ responses: { quotes } });
    const a = approve(w);
    assert.equal((await attemptTicket(w.h, a, w.d)).status, 'WAITING');
    assert.equal(places(w).length, 0);
    assert.ok(!existsSync(w.receiptsDir));
    assert.equal(statusOf(w), 'active');
    w.d.broker.call = (orig => async (cap, args) => (cap === 'quotes' ? okResponses().quotes : orig(cap, args)))(w.d.broker.call);
    assert.equal((await attemptTicket(w.h, w.store.approvalFor(w.h.plan_id), w.d)).status, 'PENDING');
  });
}

test('an old quote never fires a condition: a stale price under the trigger waits', async () => {
  const h = ticket({ place_when: { type: 'LAST_AT_OR_BELOW', price: 49 } });
  const w = world({ tickets: { 'B-500': h }, responses: { quotes: { results: [{ last_trade_price: '48.00', venue_last_trade_time: stale }] } } });
  w.h = h;
  const a = approve(w, h);
  assert.equal((await attemptTicket(h, a, w.d)).detail, 'quote not usable');
  assert.equal(places(w).length, 0);
});

test('just approved: waits at least MIN_APPROVAL_AGE_SEC so a HALT can land', async () => {
  const w = world();
  const a = approve(w, w.h, { ingestedAt: NOW_SEC - 30 });
  const out = await attemptTicket(w.h, a, w.d);
  assert.equal(out.status, 'WAITING');
  assert.equal(out.detail, 'just approved');
  assert.equal(w.calls.length, 0);
  assert.ok(MIN_APPROVAL_AGE_SEC >= 60, 'at least one full watcher tick');
  w.d.now = at(NOW.getTime() + (MIN_APPROVAL_AGE_SEC - 30) * 1000);
  assert.equal((await attemptTicket(w.h, w.store.approvalFor(w.h.plan_id), w.d)).status, 'PENDING');
});

test('an approval record this program did not make (no digest or time) is voided', async () => {
  for (const drop of ['ticket_digest', 'ingested_at']) {
    const w = world();
    const a = approve(w);
    w.store.note(w.h.plan_id, drop, undefined);
    assert.equal((await attemptTicket(w.h, w.store.approvalFor(w.h.plan_id), w.d)).status, 'void', drop);
    assert.equal(places(w).length, 0);
    assert.ok(a);
  }
});

test('a ticket swapped after approval is caught by the full digest even when the short code matches', async () => {
  const w = world();
  const a = approve(w);
  // A forged ticket ground to the same six letters still has a different digest.
  const swapped = { ...w.h, invalidation_price: 1 };
  w.store.note(w.h.plan_id, 'ticket_code', ticketCode(swapped));
  assert.equal((await attemptTicket(swapped, w.store.approvalFor(w.h.plan_id), w.d)).status, 'void');
  assert.equal(places(w).length, 0);
  assert.ok(a);
});

test('unreadable quote while waiting: warns once, stays waiting, never places', async () => {
  const w = world({ responses: { quotes: new Error('timeout') } });
  const a = approve(w);
  await attemptTicket(w.h, a, w.d);
  await attemptTicket(w.h, w.store.approvalFor(w.h.plan_id), w.d);
  assert.equal(statusOf(w), 'active');
  assert.equal(places(w).length, 0);
  assert.equal(w.alerts.filter((l) => l.includes('cannot use the quote')).length, 1);
});

// ---- refusals before the attempt --------------------------------------------

test('expired ticket: expires, tells Adam, nothing placed', async () => {
  const w = world();
  const a = approve(w);
  w.d.now = () => new Date('2026-11-10T21:00:01Z');
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'expired');
  assert.equal(places(w).length, 0);
  assert.equal(w.calls.length, 0);
});

const preAttempt = [
  ['ticket edited after approval', (w) => ({ h: { ...w.h, limit_price: 55 } }), 'void'],
  ['row not in the book', (w) => { w.d.bookRow = () => null; return {}; }, 'refused'],
  ['row is a different ticker', (w) => { w.d.bookRow = () => ({ id: 'B-500', ticker: 'OTHER' }); return {}; }, 'refused'],
  ['test gate closed', (w) => { w.d.gate = () => ({ ok: false, why: 'no clean, committed test-one receipt' }); return {}; }, 'refused'],
  ['per-order limit is zero', (w) => { w.d.ceilingUsd = 0; return {}; }, 'refused'],
  ['over the per-order limit', (w) => { w.d.ceilingUsd = 50; return {}; }, 'refused'],
];
for (const [name, setup, status] of preAttempt) {
  test(`refuses before any broker call: ${name}`, async () => {
    const w = world();
    const a = approve(w);
    const { h = w.h } = setup(w) ?? {};
    assert.equal((await attemptTicket(h, a, w.d)).status, status);
    assert.equal(w.calls.length, 0);
    assert.equal(statusOf(w), status);
    assert.ok(w.alerts.some((l) => l.includes('Nothing was placed')));
  });
}

test('duplicate plan_id: an existing receipt refuses', async () => {
  const w = world();
  const a = approve(w);
  mkdirSync(w.receiptsDir, { recursive: true });
  writeFileSync(join(w.receiptsDir, 'x.json'), JSON.stringify({ plan_id: w.h.plan_id, state: 'PENDING' }));
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'refused');
  assert.equal(places(w).length, 0);
});

test('executor version not pinned or changed: the ticket waits, unspent, and is told once', async () => {
  let pinned = false;
  const w = world({ commit: () => { if (!pinned) throw new Error('the executor files changed since the pinned abc1234'); return 'abc1234'; } });
  const a = approve(w);
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'WAITING');
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'WAITING');
  assert.equal(statusOf(w), 'active', 'the approval is not spent');
  assert.equal(w.alerts.filter((l) => l.includes('HELD') && l.includes('pinned')).length, 1);
  assert.equal(places(w).length, 0);
  assert.ok(!existsSync(w.receiptsDir));
  assert.ok(!w.calls.some((c) => c.cap === 'quotes'), 'nothing is read from the broker first');
  pinned = true; // Adam pins at his terminal
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'PENDING');
  assert.equal(places(w).length, 1);
});

// ---- preflight refusals: one attempt, spent, receipt written ----------------

// The account and the test orders are checked at Robinhood before the attempt
// is spent: a mismatch ends the ticket, with no receipt and no order.
const testOrderRefusals = [
  ['account does not match', { responses: { accounts: { accounts: [{ account_number: 'X1110000', agentic_allowed: true }] } } }],
  ['two agent-tradable accounts', { responses: { accounts: { accounts: [{ account_number: 'X1117724', agentic_allowed: true }, { account_number: 'Y7724', agentic_allowed: true }] } } }],
  ['test-zero order not at Robinhood (a forged receipt)', { testOrders: { ...TEST_ORDERS, tz1: { results: [] } } }],
  ['test-one order not at Robinhood (a forged receipt)', { testOrders: { ...TEST_ORDERS, to1: { results: [{ id: 'other', state: 'filled' }] } } }],
  ['test-zero order filled', { testOrders: { ...TEST_ORDERS, tz1: { results: [{ id: 'tz1', state: 'cancelled', cumulative_quantity: '1' }] } } }],
  ['test-one order never filled', { testOrders: { ...TEST_ORDERS, to1: { results: [{ id: 'to1', state: 'cancelled', cumulative_quantity: '0' }] } } }],
];
for (const [name, opts] of testOrderRefusals) {
  test(`checked at Robinhood before the attempt: ${name}`, async () => {
    const w = world(opts);
    const a = approve(w);
    assert.equal((await attemptTicket(w.h, a, w.d)).status, 'refused');
    assert.equal(places(w).length, 0);
    assert.ok(!existsSync(w.receiptsDir), 'no receipt: the attempt never started');
    assert.equal(statusOf(w), 'refused');
  });
}

test('test orders unreadable at Robinhood: waits and warns once, never places', async () => {
  const w = world({ testOrders: { ...TEST_ORDERS, tz1: new Error('timeout') } });
  const a = approve(w);
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'WAITING');
  await attemptTicket(w.h, w.store.approvalFor(w.h.plan_id), w.d);
  assert.equal(statusOf(w), 'active');
  assert.equal(places(w).length, 0);
  assert.equal(w.alerts.filter((l) => l.includes('cannot check the test orders')).length, 1);
});

const preflightRefusals = [
  ['buying power too low', { portfolio: { buying_power: '99.99' } }],
  ['buying power missing', { portfolio: { nothing: 1 } }],
  ['price drifted', { quotes: { results: [{ last_trade_price: '52.50', venue_last_trade_time: FRESH }] } }],
  ['existing position', { positions: { results: [{ symbol: 'TEST', quantity: '1' }] } }],
  ['unparseable positions', { positions: { _unparsed: '<html>' } }],
  ['open order already there', { orders: { results: [{ id: 'z', state: 'queued', symbol: 'TEST' }] } }],
  ['broker error on orders', { orders: new Error('timeout') }],
  ['review alert', { review: { order_checks: [{ code: 'halted' }] } }],
  ['review with no order checks', { review: { review_id: 'rev-1' } }],
  ['review with other alerts', { review: { order_checks: [], alerts: ['pdt'] } }],
  ['unparseable review', { review: { _unparsed: 'x' } }],
  ['review call fails', { review: new Error('timeout') }],
];
for (const [name, responses] of preflightRefusals) {
  test(`preflight refuses: ${name}`, async () => {
    const w = world({ responses });
    const a = approve(w);
    assert.equal((await attemptTicket(w.h, a, w.d)).status, 'refused');
    assert.equal(places(w).length, 0);
    assert.equal(receiptOf(w).state, 'PREFLIGHT_REFUSED');
    assert.equal(statusOf(w), 'refused');
    // One attempt: the next tick cannot try again.
    assert.equal(w.store.byStatus('active').length, 0);
  });
}

// ---- after placing: never retry ---------------------------------------------

test('place times out: UNKNOWN, one place call only, no retry', async () => {
  const w = world({ responses: { place: new Error('socket hang up') } });
  const a = approve(w);
  const out = await attemptTicket(w.h, a, w.d);
  assert.equal(out.status, 'UNKNOWN');
  assert.equal(places(w).length, 1);
  assert.equal(receiptOf(w).state, 'UNKNOWN_REQUIRES_RECONCILIATION');
  assert.equal(w.store.byStatus('active').length, 0);
  assert.ok(w.alerts.some((l) => l.includes('CHECK THE ROBINHOOD APP')));
});

test('place times out and reconciling also fails: still UNKNOWN, no retry', async () => {
  const w = world({ responses: { place: new Error('timeout') } });
  const a = approve(w);
  const orig = w.d.broker.call;
  let n = 0;
  w.d.broker.call = async (cap, args) => {
    if (cap === 'orders' && !args?.order_id && ++n > 1) { w.calls.push({ cap, args }); throw new Error('down'); }
    return orig(cap, args);
  };
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'UNKNOWN');
  assert.equal(places(w).length, 1);
});

test('unrecognised place response: UNKNOWN, tells Adam to check the app', async () => {
  const w = world({ responses: { place: { weird: true } } });
  const a = approve(w);
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'UNKNOWN');
  assert.equal(places(w).length, 1);
});

test('broker state it does not know reads UNKNOWN, never success', async () => {
  const w = world({ responses: { place: { order: { id: 'o', state: 'voided', symbol: 'TEST', quantity: '2', limit_price: '50' } } } });
  const a = approve(w);
  // voided is not an open state, so it is identified only as the sole order returned.
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'UNKNOWN_REQUIRES_RECONCILIATION');
});

test('Robinhood approval setting on: reported as waiting on his tap, not as an order', async () => {
  const w = world({ responses: {
    review: { order_checks: [], customer_approval_required: true },
    place: { approval_id: 'ap-1', message: 'sent to customer' },
  } });
  const a = approve(w);
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'AWAITING_TAP');
  assert.equal(receiptOf(w).state, 'AWAITING_CUSTOMER_APPROVAL');
  assert.equal(receiptOf(w).approval_id, 'ap-1');
  assert.ok(w.alerts.some((l) => l.includes('WAITING ON YOUR TAP')));
});

test('filled later: the watcher reads it and texts Adam; a read only', async () => {
  const w = world();
  const a = approve(w);
  await attemptTicket(w.h, a, w.d);
  w.d.now = () => new Date(); // the receipt's times are the wall clock; same trading day
  const orig = w.d.broker.call;
  w.d.broker.call = async (cap, args) => (cap === 'orders'
    ? { results: [{ id: 'ord-1', state: 'filled', cumulative_quantity: '2' }] } : orig(cap, args));
  assert.deepEqual(await followOpenOrders(w.d), ['B-500']);
  const r = receiptOf(w);
  assert.equal(r.state, 'FILLED');
  assert.equal(r.final_filled_quantity, 2);
  assert.ok(w.alerts.some((l) => l.includes('FILLED') && l.includes('The exit is yours')));
  assert.equal(places(w).length, 1);
  assert.deepEqual(await followOpenOrders(w.d), [], 'a finished order is not read again');
});

// ---- phone messages ---------------------------------------------------------

const ingest = (w, ...msgs) => ingestMessages(msgs, w.d);

test('ARM with the right ticket and code becomes one approval; the code is burned', async () => {
  const w = world();
  await ingest(w, msg('m1', armLine(w.h, w.plainCodes[0])));
  assert.equal(statusOf(w), 'active');
  assert.equal(w.store.codesLeft(), 3);
});

test('lower case and extra spaces from a phone still read', async () => {
  const w = world();
  await ingest(w, msg('m1', `  arm  b-500  ${ticketCode(w.h).toLowerCase()} ${w.plainCodes[0].toLowerCase()} `));
  assert.equal(statusOf(w), 'active');
});

// A code that appeared on the open channel is spent even when the ARM is refused.
const armRefusals = [
  ['old switch format, no codes', () => 'ARM B-500 window 4h - one placement only', 4],
  ['bare ARM', () => 'ARM B-500', 4],
  ['no one-time code', (w) => `ARM B-500 ${ticketCode(w.h)}`, 4],
  ['no ticket code', (w) => `ARM B-500 ${w.plainCodes[0]}`, 3],
  ['wrong ticket code', (w) => `ARM B-500 ZZZZZZ ${w.plainCodes[0]}`, 3],
  ['row with no ticket', (w) => `ARM B-999 ${ticketCode(w.h)} ${w.plainCodes[0]}`, 3],
  ['two codes', (w) => `ARM B-500 ${ticketCode(w.h)} ${w.plainCodes[0]} ${w.plainCodes[1]}`, 3],
];
for (const [name, line, left] of armRefusals) {
  test(`ARM refused: ${name}`, async () => {
    const w = world();
    await ingest(w, msg('m1', line(w)));
    assert.equal(w.store.approvalFor(w.h.plan_id), null);
    assert.equal(w.store.codesLeft(), left);
    assert.ok(w.alerts.some((l) => l.includes('ARM REFUSED')));
    assert.ok(!w.alerts.join('\n').includes(w.plainCodes[0].slice(3)), 'the code is never echoed');
  });
}

test('a refused ARM leaves no working code behind for anyone reading the channel', async () => {
  const w = world();
  await ingest(w, msg('typo', `ARM B-500 ZZZZZZ ${w.plainCodes[0]}`, NOW_SEC - 90));
  assert.ok(w.alerts[0].includes('now spent'));
  await ingest(w, msg('copy', armLine(w.h, w.plainCodes[0]), NOW_SEC - 60));
  assert.equal(w.store.approvalFor(w.h.plan_id), null);
  assert.ok(w.alerts.some((l) => l.includes('one-time code is used')));
});

test('a code sent on its own, or with the row forgotten, is spent and never echoed', async () => {
  const w = world();
  await ingest(w, msg('a', w.plainCodes[0]), msg('b', `ARM ${w.plainCodes[1]}`));
  assert.equal(w.store.codesLeft(), 2);
  assert.ok(w.alerts.every((l) => l.startsWith('REAL ? ARM REFUSED')));
  assert.ok(!w.alerts.join('\n').includes(w.plainCodes[0].slice(3)));
  assert.ok(!w.alerts.join('\n').includes(w.plainCodes[1].slice(3)));
});

test('ARM older than the ticket refuses: an old approval cannot cover a new order', async () => {
  const w = world();
  await ingest(w, msg('m1', armLine(w.h, w.plainCodes[0]), Date.parse(w.h.created_at) / 1000 - 10));
  assert.equal(w.store.approvalFor(w.h.plan_id), null);
  assert.equal(w.store.codesLeft(), 3);
});

test('ARM on an expired ticket refuses', async () => {
  const w = world();
  w.d.now = () => new Date('2026-11-10T21:00:01Z');
  await ingest(w, msg('m1', armLine(w.h, w.plainCodes[0])));
  assert.equal(w.store.approvalFor(w.h.plan_id), null);
});

test('real orders locked by the test gate: ARM refused, code spent', async () => {
  const w = world({ gate: { ok: false, why: 'no clean, committed test-zero receipt' } });
  await ingest(w, msg('m1', armLine(w.h, w.plainCodes[0])));
  assert.equal(w.store.approvalFor(w.h.plan_id), null);
  assert.equal(w.store.codesLeft(), 3);
  assert.ok(w.alerts[0].includes('not unlocked'));
});

test('a used code cannot approve anything: a copy posted after Adam\'s own message fails', async () => {
  const h2 = ticket({ row_id: 'B-501', plan_id: 'B-501:x' });
  const w = world({ tickets: { 'B-500': ticket(), 'B-501': h2 }, book: { 'B-500': { id: 'B-500', ticker: 'TEST' }, 'B-501': { id: 'B-501', ticker: 'TEST' } } });
  const h1 = w.d.loadTicket('B-500');
  await ingest(w, msg('m1', armLine(h1, w.plainCodes[0]), NOW_SEC - 60), msg('m2', armLine(h2, w.plainCodes[0]), NOW_SEC - 30));
  assert.equal(w.store.approvalFor(h1.plan_id).status, 'active');
  assert.equal(w.store.approvalFor(h2.plan_id), null);
  assert.ok(w.alerts.some((l) => l.includes('one-time code is used')));
});

test('a message is handled once: replays do nothing', async () => {
  const w = world();
  const m = msg('m1', armLine(w.h, 'XX-WRONGCOD'.replace('XX', '01')));
  await ingest(w, m);
  await ingest(w, m);
  assert.equal(w.store.state.wrong_codes, 1);
});

test('the same ticket cannot be approved twice', async () => {
  const w = world();
  await ingest(w, msg('m1', armLine(w.h, w.plainCodes[0])), msg('m2', armLine(w.h, w.plainCodes[1])));
  assert.equal(w.store.byStatus('active').length, 1);
  assert.equal(w.store.codesLeft(), 2, 'the second code was posted, so it is spent too');
});

test('wrong codes lock real orders; a right code then fails until unlocked at the terminal', async () => {
  const w = world();
  const bad = armLine(w.h, '01-AAAAAAAA');
  for (let i = 0; i < WRONG_CODES_BEFORE_LOCK; i++) await ingest(w, msg(`bad${i}`, bad));
  assert.equal(w.store.locked, true);
  assert.ok(w.alerts.some((l) => l.includes('NOW LOCKED')));
  await ingest(w, msg('good', armLine(w.h, w.plainCodes[1])));
  assert.equal(w.store.approvalFor(w.h.plan_id), null);
  assert.equal(w.store.codesLeft(), 3, 'a good code posted while locked is spent, not left exposed');
  w.store.unlock();
  await ingest(w, msg('good2', armLine(w.h, w.plainCodes[2])));
  assert.equal(statusOf(w), 'active');
});

test('the wrong-code lock also holds tickets approved before it', async () => {
  const w = world();
  const a = approve(w);
  w.store.flag('locked', true);
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'WAITING');
  assert.equal((await attemptTicket(w.h, w.store.approvalFor(w.h.plan_id), w.d)).status, 'WAITING');
  assert.equal(w.calls.length, 0);
  assert.equal(statusOf(w), 'active');
  assert.equal(w.alerts.filter((l) => l.includes('HELD')).length, 1);
});

test('alerts never carry a wrong code either', async () => {
  const w = world();
  await ingest(w, msg('m1', armLine(w.h, '01-QQQQQQQQ')));
  assert.ok(!w.alerts.join('\n').includes('QQQQQQQQ'));
});

test('HALT stops every approval made before it, and leaves later ones alone', async () => {
  const w = world();
  const h2 = ticket({ row_id: 'B-501', plan_id: 'B-501:x' });
  w.d.loadTicket = (r) => ({ 'B-500': w.h, 'B-501': h2 }[r]);
  await ingest(w, msg('m1', armLine(w.h, w.plainCodes[0]), NOW_SEC - 100), msg('h', 'HALT', NOW_SEC - 90), msg('m2', armLine(h2, w.plainCodes[1]), NOW_SEC - 80));
  assert.equal(statusOf(w), 'halted');
  assert.equal(w.store.approvalFor(h2.plan_id).status, 'active');
});

test('HALT in the same tick stops the order before anything is placed', async () => {
  const w = world();
  w.d.readMessages = async () => [msg('m1', armLine(w.h, w.plainCodes[0]), NOW_SEC - 100), msg('h', 'halt', NOW_SEC - 50)];
  const out = await runTick(w.d);
  assert.deepEqual(out.results, []);
  assert.equal(places(w).length, 0);
});

// ---- the tick --------------------------------------------------------------

test('phone unreadable: nothing is placed this tick, even with a live approval', async () => {
  const w = world();
  approve(w);
  w.d.readMessages = async () => { throw new Error('HTTP 500'); };
  const out = await runTick(w.d);
  assert.equal(out.skipped, 'phone messages unreadable');
  assert.equal(w.calls.length, 0);
  assert.equal(statusOf(w), 'active');
});

test('a ticket missing or replaced after approval voids it', async () => {
  const w = world();
  approve(w);
  w.d.loadTicket = () => null;
  const out = await runTick(w.d);
  assert.equal(out.results[0].status, 'void');
  assert.equal(places(w).length, 0);
});

test('broker unreachable: Adam is told once, nothing placed, and expiry still fires', async () => {
  const w = world();
  approve(w);
  w.d.connect = async () => { throw new Error('token expired'); };
  assert.equal((await runTick(w.d)).skipped, 'broker unreachable');
  await runTick(w.d);
  assert.equal(w.alerts.filter((l) => l.includes('cannot reach Robinhood')).length, 1);
  assert.equal(statusOf(w), 'active');
  w.d.now = () => new Date('2026-11-10T21:00:01Z');
  const out = await runTick(w.d);
  assert.equal(out.results[0].status, 'expired');
  assert.equal(places(w).length, 0);
});

test('place --handoff works only its own ticket', async () => {
  const h2 = ticket({ row_id: 'B-501', plan_id: 'B-501:x' });
  const w = world({ tickets: { 'B-500': ticket(), 'B-501': h2 } });
  const h1 = w.d.loadTicket('B-500');
  approve(w, h1);
  assert.equal(w.store.useCode(w.plainCodes[1]), 'ok');
  w.store.addApproval({ plan_id: h2.plan_id, row_id: 'B-501', ticket_code: ticketCode(h2), ticket_digest: ticketDigest(h2), message_id: 'm2', approved_at: NOW_SEC - 60, ingested_at: NOW_SEC - 120 });
  const out = await runTick(w.d, { onlyPlan: h1.plan_id });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].row, 'B-500');
  assert.equal(w.store.approvalFor(h2.plan_id).status, 'active');
});

test('the tick reads the state fresh under its lock: another process\'s HALT is seen', async () => {
  const w = world();
  approve(w);
  const stale = w.store; // what this process loaded earlier
  new ApprovalStore(w.d.stateDir).haltBefore(NOW_SEC); // another process halts it
  w.d.openStore = () => new ApprovalStore(w.d.stateDir);
  const out = await runTick(w.d);
  assert.deepEqual(out.results, []);
  assert.equal(places(w).length, 0);
  assert.equal(stale.approvalFor(w.h.plan_id).status, 'active', 'the old copy was not used');
});

test('a receipt claimed by one process cannot be claimed by another', () => {
  const dir = tmp();
  const h = ticket();
  new Receipt(dir, h, { mode: MODE, commit: 'a', exclusive: true });
  assert.throws(() => new Receipt(dir, h, { mode: MODE, commit: 'a', exclusive: true }));
});

test('a rejected order tells Adam to check the app', async () => {
  const w = world({ responses: { place: { order: { id: 'o9', state: 'rejected', symbol: 'TEST', quantity: '2', limit_price: '50' } } } });
  const a = approve(w);
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'REJECTED');
  assert.ok(w.alerts.some((l) => l.includes('REJECTED') && l.includes('CHECK THE ROBINHOOD APP')));
});

test('crash mid-attempt: never retried, Adam is told', async () => {
  const w = world();
  approve(w);
  w.store.setStatus(w.h.plan_id, 'attempting');
  await runTick(w.d);
  assert.equal(statusOf(w), 'interrupted');
  assert.equal(places(w).length, 0);
  assert.ok(w.alerts.some((l) => l.includes('INTERRUPTED')));
});

test('two ticks cannot run at once; a leftover lock clears and says so', () => {
  const dir = tmp();
  const nowMs = Date.now();
  const first = takeTickLock(dir, nowMs);
  assert.equal(first.held, true);
  assert.equal(takeTickLock(dir, nowMs).held, false);
  const old = new Date(nowMs - 3600000);
  utimesSync(first.path, old, old);
  const again = takeTickLock(dir, nowMs);
  assert.equal(again.held, true);
  assert.equal(again.stale, true);
});

test('a state file that cannot be read stops everything', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'real-order-state.json'), '{ not json');
  assert.throws(() => new ApprovalStore(dir));
});

// ---- the test gate ----------------------------------------------------------

test('gate: real orders stay locked until clean, committed test-zero and test-one receipts', () => {
  const dir = tmp();
  const yes = { isCommitted: () => true, isAncestor: () => true };
  const write = (name, body) => writeFileSync(join(dir, name), JSON.stringify(body));
  assert.equal(testGate(dir, yes, CEILING).ok, false);
  write('a.json', { mode: 'test-zero', state: 'CANCELED', final_filled_quantity: 0, broker_order_id: 'o1' });
  assert.match(testGate(dir, yes, CEILING).why, /test-one/);
  write('b.json', { mode: 'test-one', state: 'REJECTED', broker_order_id: 'o2' });
  assert.equal(testGate(dir, yes, CEILING).ok, false);
  write('c.json', { mode: 'test-one', state: 'FILLED', broker_order_id: 'o3' });
  assert.equal(testGate(dir, yes, CEILING).ok, true);
  assert.equal(testGate(dir, { isCommitted: () => false, isAncestor: () => true }, CEILING).ok, false, 'uncommitted receipts do not count');
  assert.equal(testGate(dir, { isCommitted: () => true, isAncestor: () => false }, CEILING).ok, false, 'receipts from a commit HEAD does not descend from do not count');
  assert.equal(testGate(dir, yes, 0).ok, false, 'no limit set stays locked');
});

test('gate: a test-zero that filled or has no order id does not count', () => {
  const yes = { isCommitted: () => true, isAncestor: () => true };
  const check = (zero) => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.json'), JSON.stringify(zero));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ mode: 'test-one', state: 'FILLED', broker_order_id: 'o' }));
    return testGate(dir, yes, CEILING).ok;
  };
  assert.equal(check({ mode: 'test-zero', state: 'CANCELED', final_filled_quantity: 1, broker_order_id: 'o' }), false);
  assert.equal(check({ mode: 'test-zero', state: 'CANCELED' }), false);
});

test('gate: an unreadable receipt keeps it locked', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'a.json'), 'nope');
  assert.match(testGate(dir, { isCommitted: () => true, isAncestor: () => true }, CEILING).why, /unreadable/);
});

// ---- the v2 contract --------------------------------------------------------

const opts = { now: NOW, ceilingUsd: CEILING };
const codes = (r) => r.refusals.map((x) => x.code);

test('v2 contract: a good ticket passes', () => {
  assert.deepEqual(validateRealHandoff(ticket(), opts).refusals, []);
});

test('v2 contract: a zero limit refuses with its own code, R24', () => {
  assert.ok(codes(validateRealHandoff(ticket(), { now: NOW, ceilingUsd: 0 })).includes('R24_REAL_ORDERS_LOCKED'));
});

test('v2 contract: the constant in code is the ceiling when nothing overrides it', () => {
  const shares = Math.floor(REAL_ORDER_CEILING_USD / 50) + 1;
  const h = ticket({ executor_absolute_ceiling: REAL_ORDER_CEILING_USD + 50 }, { shares });
  assert.ok(codes(validateRealHandoff(h, { now: NOW })).includes('R06_NOTIONAL_ABOVE_HARD_CEILING'));
  assert.equal(validateRealHandoff(h, { now: NOW }).ok, false);
});

const contractRefusals = [
  ['a v1 ticket', { schema_version: 'bench-execution-handoff-v1' }, 'R15_SCHEMA_VERSION_UNKNOWN'],
  ['the v1 executor', { executor_version: 'bench-executor-v1' }, 'R20_VERSION_MISMATCH'],
  ['an old framework', { framework_version: 'v35' }, 'R20_VERSION_MISMATCH'],
  ['a sell', { action: 'SELL_TO_CLOSE', invalidation_price: 'N/A' }, 'R21_REAL_BUY_ONLY'],
  ['notional mode', { quantity_mode: 'notional', quantity_value: 100 }, 'R22_REAL_WHOLE_SHARES'],
  ['fractional shares', { quantity_value: 1.5, planned_dollar_risk: 75, executor_absolute_ceiling: 75 }, 'R22_REAL_WHOLE_SHARES'],
  ['a stop-order exit', { exit_owner: 'SEPARATE_STOP_ORDER' }, 'R14_MISSING_EXIT_OWNER'],
  ['no condition', { place_when: undefined }, 'R23_PLACE_WHEN_INVALID'],
  ['an unknown condition', { place_when: { type: 'SOMETIME' } }, 'R23_PLACE_WHEN_INVALID'],
  ['a condition with no price', { place_when: { type: 'LAST_AT_OR_ABOVE' } }, 'R23_PLACE_WHEN_INVALID'],
  ['a market order', { order_type: 'MARKET' }, 'R13_ORDER_INSTRUCTION_NOT_ALLOWED'],
  ['GTC', { time_in_force: 'GTC' }, 'R13_ORDER_INSTRUCTION_NOT_ALLOWED'],
  ['extended hours', { session: 'EXTENDED' }, 'R13_ORDER_INSTRUCTION_NOT_ALLOWED'],
  ['a pending row', { row_id: 'Pending Archive ID' }, 'R02_PENDING_ROW_ID'],
  ['a long account number', { account_alias: '123456789012' }, 'R16_ACCOUNT_ALIAS_INVALID'],
  ['a leveraged product', { leveraged_product: true }, 'R12_FORBIDDEN_STRUCTURE_OR_FLAG'],
  ['a ticket ceiling above the limit', { executor_absolute_ceiling: CEILING + 1 }, 'R06_NOTIONAL_ABOVE_HARD_CEILING'],
  ['already expired', { expires_at: '2026-11-10T14:00:00.000Z' }, 'R04_STALE_PLAN'],
  ['living past 4 pm New York', { expires_at: '2026-11-10T21:30:00.000Z' }, 'R04_STALE_PLAN'],
  ['living more than 30 hours', { created_at: '2026-11-09T14:00:00.000Z' }, 'R04_STALE_PLAN'],
  ['a missing field', { limit_price: undefined }, 'R01_MISSING_FIELD'],
];
for (const [name, over, code] of contractRefusals) {
  test(`v2 contract refuses ${name}`, () => {
    const r = validateRealHandoff(ticket(over), opts);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes(code), `expected ${code}, got ${codes(r).join(', ')}`);
  });
}

test('v2 contract: v1 rules and the $5 test ceiling are unchanged', () => {
  assert.equal(HARD_TEST_CEILING_USD, 5);
  const r = validateHandoff(ticket(), { now: NOW });
  assert.ok(codes(r).includes('R15_SCHEMA_VERSION_UNKNOWN'));
  assert.throws(() => computeOrderShares(ticket()), /exceeds effective ceiling/);
  assert.deepEqual(computeOrderShares(ticket(), CEILING), { shares: 2, notional: 100 });
});

// ---- ticket code + writer ---------------------------------------------------

test('ticket code: any change to the order changes the code', () => {
  const base = ticketCode(ticket());
  assert.match(base, /^[A-Z2-9]{6}$/);
  for (const over of [{ quantity_value: 3 }, { limit_price: 50.5 }, { ticker: 'X' }, { row_id: 'B-1' }, { expires_at: 'x' }, { place_when: { type: 'LAST_AT_OR_ABOVE', price: 51 } }, { maximum_price_drift: '$9' }]) {
    assert.notEqual(ticketCode(ticket(over)), base, JSON.stringify(over));
  }
});

test('conditions: at-or-below, at-or-above, now, and unreadable', () => {
  assert.equal(conditionMet({ type: 'NOW' }, NaN), true);
  assert.equal(conditionMet({ type: 'LAST_AT_OR_BELOW', price: 50 }, 50), true);
  assert.equal(conditionMet({ type: 'LAST_AT_OR_BELOW', price: 50 }, 50.01), false);
  assert.equal(conditionMet({ type: 'LAST_AT_OR_ABOVE', price: 50 }, 49.99), false);
  assert.equal(conditionMet({ type: 'LAST_AT_OR_ABOVE', price: 50 }, NaN), false);
  assert.equal(conditionMet({ type: 'BOGUS' }, 50), false);
});

test('calendar: holidays and weekends are closed, early closes end at 12:45, unknown years are closed', () => {
  assert.equal(realSessionOpen(new Date('2026-11-26T15:00:00Z')), false); // Thanksgiving
  assert.equal(realSessionOpen(new Date('2026-11-27T16:00:00Z')), true);  // half day, 11:00
  assert.equal(realSessionOpen(new Date('2026-11-27T17:50:00Z')), false); // half day, 12:50
  assert.equal(realSessionOpen(new Date('2026-11-10T20:45:00Z')), true);  // 15:45
  assert.equal(realSessionOpen(new Date('2026-11-10T14:29:00Z')), false); // 09:29
  assert.equal(realSessionOpen(new Date('2026-11-14T15:00:00Z')), false); // Saturday
  assert.equal(dayKind(new Date('2028-01-04T15:00:00Z')), 'unknown');
  assert.equal(realSessionOpen(new Date('2028-01-04T15:00:00Z')), false);
});

test('a ticket on a holiday waits instead of firing', async () => {
  const day = new Date('2026-11-26T15:00:00Z'); // Thanksgiving; the ticket's first session is the half day after
  const h = ticket({}, { now: new Date(day.getTime() - 7200000), expires: '2026-11-27T18:00:00.000Z' });
  const w = world({ tickets: { 'B-500': h } });
  w.h = h;
  w.d.now = () => day;
  const a = approve(w, h);
  assert.equal((await attemptTicket(h, a, w.d)).status, 'WAITING');
  assert.equal(w.calls.length, 0);
});

test('v2 contract refuses leveraged and inverse funds', () => {
  const r = validateRealHandoff(ticket({ ticker: 'TQQQ' }), opts);
  assert.ok(codes(r).includes('R12_FORBIDDEN_STRUCTURE_OR_FLAG'));
  assert.ok(codes(validateRealHandoff(ticket({ ticker: 'muu' }), opts)).includes('R12_FORBIDDEN_STRUCTURE_OR_FLAG'));
});

test('writer: parses conditions and finds the next close on the New York clock', () => {
  assert.equal(nextCloseIso(new Date('2026-11-25T22:00:00Z')), '2026-11-27T18:00:00.000Z');          // skips Thanksgiving, half day
  assert.deepEqual(parseWhen('below:180.5'), { type: 'LAST_AT_OR_BELOW', price: 180.5 });
  assert.throws(() => parseWhen('soon'));
  assert.equal(nextCloseIso(new Date('2026-11-10T15:00:00Z')), '2026-11-10T21:00:00.000Z');          // Tue winter
  assert.equal(nextCloseIso(new Date('2026-11-10T21:30:00Z')), '2026-11-11T21:00:00.000Z');          // after the close
  assert.equal(nextCloseIso(new Date('2026-11-14T15:00:00Z')), '2026-11-16T21:00:00.000Z');          // Sat -> Mon
  assert.equal(nextCloseIso(new Date('2026-08-27T15:00:00Z')), '2026-08-27T20:00:00.000Z');          // summer
});

const book = [{ id: 'B-500', ticker: 'TEST' }];
const writerArgs = { row: 'B-500', shares: 2, limit: 50, stop: 45, drift: '$1', expires: '2026-11-10T21:00:00.000Z' };

test('writer: writes the file and a text with the exact ARM line; the ticket passes its contract', () => {
  const dir = tmp();
  const out = writeTicket(writerArgs, { book, dir, ceilingUsd: CEILING, now: NOW });
  const saved = loadTicket('B-500', dir);
  assert.equal(out.path, ticketPath('B-500', dir));
  assert.equal(saved.ticker, 'TEST');
  assert.deepEqual(validateRealHandoff(saved, opts).refusals, []);
  assert.ok(out.text.includes(`ARM B-500 ${ticketCode(saved)} <your next code>`));
  assert.ok(out.text.includes('will NOT place it or sell'));
  assert.ok(ticketText(saved).includes('Buy 2 TEST'));
});

test('writer refuses: not in the book, over the limit, or a live ticket already there', () => {
  const dir = tmp();
  assert.throws(() => writeTicket({ ...writerArgs, row: 'B-999' }, { book, dir, ceilingUsd: CEILING, now: NOW }), /not in the book/);
  assert.throws(() => writeTicket({ ...writerArgs, shares: 5 }, { book, dir, ceilingUsd: CEILING, now: NOW }), /ticket refused/);
  const overConstant = Math.floor(REAL_ORDER_CEILING_USD / writerArgs.limit) + 1;
  assert.throws(() => writeTicket({ ...writerArgs, shares: overConstant }, { book, dir, now: NOW }), /ticket refused/, 'the constant in code applies by default');
  writeTicket(writerArgs, { book, dir, ceilingUsd: CEILING, now: NOW });
  assert.throws(() => writeTicket(writerArgs, { book, dir, ceilingUsd: CEILING, now: NOW }), /live ticket/);
});

// ---- structure: who can reach what ------------------------------------------

test('binding: real-order mode can place but cannot cancel or reach anything else', async () => {
  const called = [];
  const mcp = { callTool: async (n) => { called.push(n); return { content: [{ type: 'text', text: '{}' }] }; } };
  const b = new Broker(mcp);
  b.bind([...Object.values(REQUIRED_CAPABILITIES).map((name) => ({ name })), { name: 'place_option_order' }], { capabilities: REAL_ORDER_CAPABILITIES });
  await b.call('place', {});
  await assert.rejects(b.call('cancel', {}), /denied by default/);
  await assert.rejects(b.call('options', {}), /denied by default/);
  assert.deepEqual(called, ['place_equity_order']);
});

test('the trip wire sees AI sessions by exact name and ignores ordinary settings', () => {
  assert.equal(insideAiSession({ CLAUDECODE: '1' }), 'CLAUDECODE');
  assert.equal(insideAiSession({ CODEX_THREAD_ID: 'x' }), 'CODEX_THREAD_ID');
  assert.equal(insideAiSession({ CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', CODEX_HOME: 'x', PATH: 'y' }), null);
});

test('source: the ticket writer cannot arm, and no command can raise the ceiling', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const writer = read('../scripts/executor-ticket.mjs');
  assert.ok(!writer.includes('bench-exec-arm'), 'writer never names the arm topic');
  assert.ok(!writer.includes('arm.mjs'), 'writer never imports the arm switch');
  const exec = read('../executor/executor.mjs');
  assert.ok(exec.includes('ceilingUsd: REAL_ORDER_CEILING_USD,'), 'the program takes the ceiling from the constant');
  assert.ok(!/process\.env\.[A-Z_]*CEILING/.test(exec), 'no environment variable sets it');
  assert.ok(!/val\('--ceiling/.test(exec), 'no flag sets it');
});

test('quote age: reads a time or says it cannot', () => {
  assert.equal(quoteAgeSec({ a: [{ venue_last_trade_time: FRESH }] }, NOW.getTime()), 10);
  assert.equal(quoteAgeSec({ a: 1 }, NOW.getTime()), null);
  assert.equal(quoteAgeSec({ a: [{ updated_at: FRESH }] }, NOW.getTime()), null, 'a general update time is not a trade');
  assert.equal(quoteAgeSec({ a: [{ updated_at: '2026-11-10T14:59:59Z', last_trade_time: stale }] }, NOW.getTime()), 600, 'the trade time wins');
  assert.ok(QUOTE_MAX_AGE_SEC > 0);
});

// ---- review fixes 2026-11-09: what the threat model leans on -----------------

test('phone gap: a HALT that aged out unread cannot be missed; approvals before the gap are cancelled', async () => {
  const w = world();
  approve(w);
  w.store.flag('last_ingest_at', NOW_SEC - PHONE_GAP_LIMIT_SEC - 60); // the PC slept
  const out = await runTick(w.d);
  assert.equal(statusOf(w), 'void');
  assert.equal(places(w).length, 0);
  assert.deepEqual(out.results, []);
  assert.ok(w.alerts.some((l) => l.includes('could have been missed') && l.includes('B-500')));
  assert.equal(w.store.state.last_ingest_at, NOW_SEC, 'the read that just worked is recorded');
});

test('phone gap: approvals with no record of any read are cancelled too', async () => {
  const w = world();
  approve(w);
  w.store.flag('last_ingest_at', undefined);
  await runTick(w.d);
  assert.equal(statusOf(w), 'void');
  assert.equal(places(w).length, 0);
});

test('phone gap: an ARM read after the gap still counts', async () => {
  const w = world();
  w.store.flag('last_ingest_at', NOW_SEC - PHONE_GAP_LIMIT_SEC - 60);
  w.d.readMessages = async () => [msg('m1', armLine(w.h, w.plainCodes[0]))];
  await runTick(w.d);
  assert.equal(statusOf(w), 'active', 'nothing was approved before the gap, so nothing is cancelled');
});

test('two ticks at once on one state folder: exactly one order', async () => {
  const w = world();
  approve(w);
  w.d.openStore = () => new ApprovalStore(w.d.stateDir);
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = w.d.connect;
  w.d.connect = async () => { await gate; return slow(); };
  const first = runTick(w.d);
  const second = await runTick({ ...w.d });
  assert.equal(second.skipped, 'another tick is running');
  release();
  await first;
  assert.equal(places(w).length, 1);
});

test('a hung tick that wakes after another tick ran cannot write its old state back', () => {
  const w = world();
  approve(w);
  const hung = new ApprovalStore(w.d.stateDir); // read before it hung
  const other = new ApprovalStore(w.d.stateDir);
  other.haltBefore(NOW_SEC); // another tick halts it meanwhile
  assert.throws(() => hung.setStatus(w.h.plan_id, 'attempting'), StateChangedError);
  assert.equal(new ApprovalStore(w.d.stateDir).approvalFor(w.h.plan_id).status, 'halted', 'the HALT stands');
  assert.throws(() => hung.flag('locked', false), StateChangedError, 'and it cannot lift a lock either');
});

test('lock: a tick releases only its own lock; a stale one is taken over once', () => {
  const dir = tmp();
  const nowMs = Date.now();
  const first = takeTickLock(dir, nowMs);
  assert.equal(first.held, true);
  const old = new Date(nowMs - (TICK_LOCK_STALE_MIN + 1) * 60000);
  utimesSync(first.path, old, old);
  const second = takeTickLock(dir, nowMs);
  assert.equal(second.held, true);
  assert.equal(second.stale, true);
  assert.equal(takeTickLock(dir, nowMs).held, false, 'a third cannot take it while the second holds it');
  assert.equal(releaseTickLock(first), false, 'the hung first tick cannot delete the lock the second holds');
  assert.ok(existsSync(second.path));
  assert.equal(releaseTickLock(second), true);
  assert.ok(!existsSync(second.path));
  assert.ok(TICK_HARD_LIMIT_MS < TICK_LOCK_STALE_MIN * 60000, 'a tick is killed long before its lock counts as stale');
});

test('crash right after the place call: told once, never sent again', async () => {
  const w = world();
  approve(w);
  // What a process killed mid-call leaves behind: approval spent, receipt at PLACEMENT_ATTEMPTED.
  w.store.setStatus(w.h.plan_id, 'placed', 'placement attempted');
  const r = new Receipt(w.receiptsDir, w.h, { mode: MODE, commit: 'abc1234', exclusive: true });
  r.transition('PLACEMENT_ATTEMPTED', 'calling place exactly once');
  await runTick(w.d);
  assert.equal(statusOf(w), 'placed_unknown');
  const told = () => w.alerts.filter((l) => l.includes('stopped right after sending')).length;
  assert.equal(told(), 1);
  await runTick(w.d);
  assert.equal(told(), 1, 'once');
  assert.equal(places(w).length, 0);
});

test('a finished placement is not mistaken for a crash', async () => {
  const w = world();
  const a = approve(w);
  await attemptTicket(w.h, a, w.d);
  await runTick(w.d);
  assert.equal(statusOf(w), 'placed');
  assert.ok(!w.alerts.some((l) => l.includes('stopped right after sending')));
});

test('follower: an order it cannot read is reported once; after its day it stops', async () => {
  const w = world();
  const a = approve(w);
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'PENDING');
  // Receipts are stamped with the wall clock; put the placement on the test's day.
  const path = join(w.receiptsDir, readdirSync(w.receiptsDir)[0]);
  const rec = JSON.parse(readFileSync(path, 'utf8'));
  for (const t of rec.transitions) t.at = NOW.toISOString();
  writeFileSync(path, JSON.stringify(rec));
  const orig = w.d.broker.call;
  w.d.broker.call = async (cap, args) => (cap === 'orders' ? { results: [{ id: 'ord-1', state: 'zzz_new_state' }] } : orig(cap, args));
  await followOpenOrders(w.d);
  await followOpenOrders(w.d);
  assert.equal(w.alerts.filter((l) => l.includes('cannot read the order')).length, 1);
  w.d.now = () => new Date(NOW.getTime() + 2 * 86400000);
  await followOpenOrders(w.d);
  assert.ok(w.alerts.some((l) => l.includes('stopped following')));
  assert.equal(receiptOf(w).follow_stopped, true);
  const n = w.alerts.length;
  await followOpenOrders(w.d);
  assert.equal(w.alerts.length, n, 'a stopped order is not read again');
});

const EXE = fileURLToPath(new URL('../executor/executor.mjs', import.meta.url));
const AI_VARS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_THREAD_ID', 'CODEX_CI'];

test('codes --new, codes --unlock and pin with no keyboard refuse and write nothing (throwaway home folder)', () => {
  const home = tmp();
  const env = { ...process.env, USERPROFILE: home, HOME: home };
  for (const k of Object.keys(env)) if (AI_VARS.includes(k) || /^(CLAUDE|CODEX)/.test(k)) delete env[k];
  for (const args of [['codes', '--new'], ['codes', '--unlock'], ['pin']]) {
    const r = spawnSync(process.execPath, [EXE, ...args], { env, input: '', encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 1, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /interactive-only/);
  }
  assert.ok(!existsSync(join(home, '.bench-executor', 'real-order-state.json')), 'no codes were made');
  assert.ok(!existsSync(join(home, '.bench-executor', 'pinned-commit.json')), 'nothing was pinned');
});

test('codes --new inside an AI session refuses before anything else', () => {
  const home = tmp();
  const r = spawnSync(process.execPath, [EXE, 'codes', '--new'], { env: { ...process.env, USERPROFILE: home, HOME: home, CLAUDECODE: '1' }, input: '', encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /AI session/);
});

test('gate with a real git repo: forged receipts count only when committed from an ancestor, and Robinhood still has to confirm them', async () => {
  const repo = tmp();
  const g = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  g('init', '-q');
  g('commit', '-q', '--allow-empty', '-m', 'base');
  const base = g('rev-parse', '--short', 'HEAD');
  const dir = join(repo, 'receipts');
  mkdirSync(dir);
  const write = (name, body) => writeFileSync(join(dir, name), JSON.stringify(body));
  write('z.json', { mode: 'test-zero', state: 'CANCELED', final_filled_quantity: 0, broker_order_id: 'fake-z', executor_commit: base });
  write('o.json', { mode: 'test-one', state: 'FILLED', broker_order_id: 'fake-o', executor_commit: base });
  const checks = makeGitChecks(repo);
  assert.equal(testGate(dir, checks, CEILING).ok, false, 'not committed yet');
  g('add', '.');
  g('commit', '-q', '-m', 'forged receipts');
  const gate = testGate(dir, checks, CEILING);
  assert.equal(gate.ok, true, `a committed forgery passes the file half of the gate: ${gate.why}`);
  const w = world({ gate, testOrders: {} });
  const a = approve(w);
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'refused', 'and Robinhood does not have the orders');
  assert.equal(places(w).length, 0);
  write('z.json', { mode: 'test-zero', state: 'CANCELED', final_filled_quantity: 0, broker_order_id: 'fake-z', executor_commit: 'deadbee' });
  g('commit', '-q', '-am', 'made-up commit');
  assert.equal(testGate(dir, checks, CEILING).ok, false, 'a receipt naming a commit HEAD does not descend from does not count');
  assert.equal(checks.isAncestor('not-a-sha'), false);
});

test('v2 contract: drift is capped at REAL_MAX_DRIFT_PCT of the limit', () => {
  assert.equal(REAL_MAX_DRIFT_PCT, 2);
  assert.deepEqual(validateRealHandoff(ticket({ maximum_price_drift: '$1' }), opts).refusals, []);
  assert.deepEqual(validateRealHandoff(ticket({ maximum_price_drift: '2%' }), opts).refusals, []);
  for (const wide of ['$1.01', '3%', '$1000']) {
    assert.ok(codes(validateRealHandoff(ticket({ maximum_price_drift: wide }), opts)).includes('R18_DRIFT_UNBOUNDED'), wide);
  }
});

test('v2 contract: a ticket lives inside its first trading session, by date and by that day close', () => {
  // Written Monday night: the first session is Tuesday.
  const mon = new Date('2026-11-10T01:00:00Z');
  const good = ticket({}, { now: mon, expires: '2026-11-10T21:00:00.000Z' });
  assert.deepEqual(validateRealHandoff(good, { now: mon, ceilingUsd: CEILING }).refusals, []);
  // Written Tuesday morning, expiring Wednesday morning: under a day, but a second session.
  const tue = new Date('2026-11-10T14:00:00Z');
  const twoDays = ticket({}, { now: tue, expires: '2026-11-11T13:00:00.000Z' });
  assert.ok(codes(validateRealHandoff(twoDays, { now: tue, ceilingUsd: CEILING })).includes('R04_STALE_PLAN'));
  // The day after Thanksgiving closes at 13:00 New York.
  const fri = new Date('2026-11-27T14:00:00Z');
  const pastHalfDay = ticket({}, { now: fri, expires: '2026-11-27T19:00:00.000Z' });
  assert.ok(codes(validateRealHandoff(pastHalfDay, { now: fri, ceilingUsd: CEILING })).includes('R04_STALE_PLAN'));
  assert.deepEqual(firstSession(new Date('2026-11-25T22:00:00Z')), { date: '2026-11-27', close: 13 * 60 });
});

test('ticket text shows the drift bound and the wait after approval', () => {
  const text = ticketText(ticket());
  assert.ok(text.includes('more than $1 away from the limit'), text);
  assert.ok(text.includes('about 2 minutes after you approve'), text);
});

test('digest: the same ticket always gives the same digest, any change gives another', () => {
  const h = ticket();
  assert.equal(ticketDigest(h), ticketDigest(JSON.parse(JSON.stringify(h))));
  assert.equal(ticketDigest(h), ticketDigest(Object.fromEntries(Object.entries(h).reverse())), 'key order does not matter');
  for (const over of [{ invalidation_price: 44 }, { lane: 'x' }, { concentrated: true }]) assert.notEqual(ticketDigest(ticket(over)), ticketDigest(h));
  assert.match(ticketDigest(h), /^[0-9a-f]{64}$/);
});

test('source: the watcher runs a pinned commit, by full paths, and its scripts are under provenance', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const exec = read('../executor/executor.mjs');
  assert.ok(/pin\.files_digest !== executorFingerprint\(\)/.test(exec), 'refuses when the executor files are not the pinned version');
  assert.ok(/ls-tree', '-r', 'HEAD', '--', \.\.\.PROVENANCE_PATHS/.test(exec), 'the pin covers the executor files, not every book commit');
  for (const p of ['scripts/executor-watcher-hidden.vbs', 'scripts/register-executor-watcher.ps1', 'scripts/executor-ticket.mjs']) {
    assert.ok(exec.includes(`'${p}'`), `${p} is under provenance`);
  }
  assert.ok(/process\.exit\(3\)[\s\S]{0,60}TICK_HARD_LIMIT_MS\)\.unref\(\)/.test(exec), 'every live tick has a hard limit');
  const vbs = read('../scripts/executor-watcher-hidden.vbs');
  assert.ok(vbs.includes('WScript.Arguments(0)') && vbs.includes('System32\\cmd.exe') && vbs.includes('NoDefaultCurrentDirectoryInExePath'));
  assert.ok(!/cmd \/c node/.test(vbs), 'never a bare node');
  const ps = read('../scripts/register-executor-watcher.ps1');
  assert.ok(ps.includes('Get-Command node') && ps.includes('`"$node`"'));
  const codesBlock = exec.slice(exec.indexOf("if (cmd === 'codes')"), exec.indexOf("if (cmd === 'pin')"));
  assert.ok(codesBlock.includes('codesLeft() > 0') && codesBlock.includes('useCode('), 'new codes need an old one once codes exist');
  assert.ok((codesBlock.match(/await phone\(/g) ?? []).length >= 3, 'a refusal, new codes and an unlock all reach the phone');
});

// ---- second review of the fixes, 2026-11-09 -----------------------------------

test('a void or halted approval can be approved again with a fresh code', async () => {
  for (const cancel of [
    (w) => w.store.setStatus(w.h.plan_id, 'void', 'phone messages may have been missed'),
    (w) => w.store.haltBefore(NOW_SEC),
  ]) {
    const w = world();
    approve(w);
    cancel(w);
    await ingest(w, msg('m2', armLine(w.h, w.plainCodes[1])));
    assert.equal(statusOf(w), 'active');
    assert.ok(w.alerts.some((l) => l.includes('APPROVED')));
    assert.equal(w.store.state.replaced.length, 1, 'the cancelled record is kept');
    assert.equal(w.store.approvalFor(w.h.plan_id).ingested_at, NOW_SEC, 'the new approval waits its own 90 seconds');
  }
});

test('an approval that reached an attempt can never be approved again', async () => {
  for (const status of ['attempting', 'placed', 'placed_unknown', 'refused', 'interrupted', 'expired']) {
    const w = world();
    approve(w);
    w.store.setStatus(w.h.plan_id, status);
    await ingest(w, msg('m2', armLine(w.h, w.plainCodes[1])));
    assert.equal(statusOf(w), status, status);
    assert.ok(w.alerts.some((l) => l.includes('already approved and tried once')), status);
    assert.throws(() => w.store.addApproval({ plan_id: w.h.plan_id, row_id: 'B-500' }), /already approved/);
  }
});

test('the account and test-order calls cannot age the quote into a refusal', async () => {
  const w = world({ responses: { quotes: { results: [{ symbol: 'TEST', last_trade_price: '50.10', venue_last_trade_time: '2026-11-10T14:58:55Z' }] } } });
  const a = approve(w);
  // The clock moves 10 seconds on every broker call and every pin check (git can
  // be slow). Five steps come before the quote is read (pin, accounts, two test
  // orders, the quote), so it is 115 s old when read. The pin is checked again
  // between the read and preflight, so a preflight that read the clock again
  // would see 125 s and refuse a ticket that was judged on a fresh quote.
  let t = NOW.getTime();
  w.d.now = () => new Date(t);
  const call = w.d.broker.call;
  w.d.broker.call = async (cap, args) => { t += 10000; return call(cap, args); };
  const commit = w.d.commit;
  w.d.commit = () => { t += 10000; return commit(); };
  const r = await attemptTicket(w.h, a, w.d);
  assert.equal(r.status, 'PENDING');
  assert.equal(places(w).length, 1);
  const order = w.calls.map((c) => c.cap);
  assert.ok(order.indexOf('quotes') > order.findIndex((c, i) => c === 'orders' && w.calls[i].args?.order_id), 'test orders are checked before the quote');
});

test('a test order for a different stock than its receipt refuses', async () => {
  const proof = { zero: { order_id: 'tz1', symbol: 'TEST' }, one: { order_id: 'to1', symbol: 'TEST' } };
  const orders = { ...TEST_ORDERS, to1: { results: [{ id: 'to1', symbol: 'OTHER', state: 'filled', cumulative_quantity: '1' }] } };
  const w = world({ gate: { ok: true, why: 'ok', proof }, testOrders: orders });
  const a = approve(w);
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'refused');
  assert.ok(w.alerts.some((l) => l.includes('is for OTHER')));
  assert.equal(places(w).length, 0);
  // The same stock, or a reply with no symbol, passes.
  const ok = world({ gate: { ok: true, why: 'ok', proof }, testOrders: { ...TEST_ORDERS, to1: { results: [{ id: 'to1', symbol: 'test', state: 'filled', cumulative_quantity: '1' }] } } });
  assert.equal((await attemptTicket(ok.h, approve(ok), ok.d)).status, 'PENDING');
});

test('codes: a refused code releases the lock before it exits', () => {
  const exec = readFileSync(new URL('../executor/executor.mjs', import.meta.url), 'utf8');
  const block = exec.slice(exec.indexOf("if (cmd === 'codes')"), exec.indexOf("if (cmd === 'pin')"));
  const tryBlock = block.slice(block.indexOf('try {'), block.indexOf('} finally {'));
  assert.ok(!tryBlock.includes('process.exit'), 'nothing exits while the lock is held');
  assert.ok(block.indexOf('releaseTickLock(lock)') < block.indexOf('if (refusedAs)'));
});

test('the test orders are checked at Robinhood once per approval, not every minute a ticket waits', async () => {
  const w = world({ tickets: { 'B-500': ticket({ place_when: { type: 'LAST_AT_OR_BELOW', price: 49 } }) } });
  w.h = w.d.loadTicket('B-500');
  const a = approve(w);
  for (let i = 0; i < 5; i += 1) assert.equal((await attemptTicket(w.h, a, w.d)).status, 'WAITING');
  const lookups = w.calls.filter((c) => c.cap === 'orders' && c.args?.order_id);
  assert.equal(lookups.length, 2, 'test zero and test one, read once');
  assert.equal(w.calls.filter((c) => c.cap === 'quotes').length, 5, 'the quote is still read every tick');
});

test('too long between the quote and the order: refused before place', async () => {
  const w = world();
  const a = approve(w);
  let t = NOW.getTime();
  w.d.now = () => new Date(t);
  const call = w.d.broker.call;
  w.d.broker.call = async (cap, args) => { if (cap === 'review') t += (QUOTE_TO_PLACE_MAX_SEC + 5) * 1000; return call(cap, args); };
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'refused');
  assert.equal(places(w).length, 0);
  assert.ok(w.alerts.some((l) => l.includes('passed between the quote and the order')));
});
