// executor-real-order.test.mjs — offline tests for real-order mode (bench-executor-v2).
// A fake broker and a fake phone: no network, no TTY, no real order is possible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateRealHandoff, validateHandoff, REAL_ORDER_CEILING_USD, HARD_TEST_CEILING_USD } from '../scripts/executor-validate.mjs';
import { buildTicket, writeTicket, ticketText, parseWhen, nextCloseIso } from '../scripts/executor-ticket.mjs';
import { ticketCode, armLine, conditionMet, ticketPath, loadTicket } from '../executor/lib/ticket.mjs';
import { ApprovalStore, WRONG_CODES_BEFORE_LOCK } from '../executor/lib/approvals.mjs';
import { Broker, REQUIRED_CAPABILITIES, REAL_ORDER_CAPABILITIES } from '../executor/lib/broker.mjs';
import {
  attemptTicket, ingestMessages, runTick, followOpenOrders, testGate, takeTickLock, insideAiSession,
  quoteAgeSec, QUOTE_MAX_AGE_SEC, MODE,
} from '../executor/lib/real-order.mjs';
import { computeOrderShares } from '../executor/executor.mjs';
import { Receipt } from '../executor/lib/receipts.mjs';
import { realSessionOpen, dayKind } from '../executor/lib/calendar.mjs';

const CEILING = 200;
const NOW = new Date('2026-11-10T15:00:00Z'); // Tuesday, 10:00 in New York
const NOW_SEC = NOW.getTime() / 1000;
const tmp = () => mkdtempSync(join(tmpdir(), 'bench-real-'));

function ticket(over = {}, args = {}) {
  const h = buildTicket({
    row: 'B-500', ticker: 'TEST', shares: 2, limit: 50, stop: 45, drift: '$2',
    when: 'now', expires: '2026-11-10T21:00:00.000Z', now: new Date(NOW.getTime() - 3600000), ...args,
  });
  return { ...h, ...over };
}

const FRESH = '2026-11-10T14:59:50Z';
const okResponses = () => ({
  accounts: { accounts: [{ account_number: 'X1117724', agentic_allowed: true }] },
  portfolio: { buying_power: '150.00' },
  quotes: { results: [{ symbol: 'TEST', last_trade_price: '50.10', updated_at: FRESH }] },
  positions: { results: [] },
  orders: { results: [] },
  review: { order_checks: [], review_id: 'rev-1' },
  place: { order: { id: 'ord-1', state: 'queued', symbol: 'TEST', quantity: '2', limit_price: '50' } },
});

function world({ responses = {}, tickets = null, book = { 'B-500': { id: 'B-500', ticker: 'TEST' } }, messages = [], gate = { ok: true, why: 'ok' }, commit = () => 'abc1234', codes = 4 } = {}) {
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

function approve(w, h = w.h) {
  assert.equal(w.store.useCode(w.plainCodes[0]), 'ok');
  return w.store.addApproval({ plan_id: h.plan_id, row_id: h.row_id, ticket_code: ticketCode(h), message_id: 'm1', approved_at: NOW_SEC - 60 });
}

const places = (w) => w.calls.filter((c) => c.cap === 'place');
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

test('valid path: a full tick from phone message to order, and the next tick does nothing', async () => {
  const h = ticket();
  const w = world({ tickets: { 'B-500': h } });
  w.d.readMessages = async () => [msg('m1', armLine(h, w.plainCodes[0]))];
  const first = await runTick(w.d);
  assert.equal(first.results[0].status, 'PENDING');
  assert.equal(places(w).length, 1);
  const second = await runTick(w.d);
  assert.deepEqual(second.results, []);
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
    ? { results: [{ last_trade_price: '48.90', updated_at: FRESH }] } : orig(cap, args)))(w.d.broker.call);
  assert.equal((await attemptTicket(h, a, w.d)).status, 'PENDING');
});

test('market closed: waits without calling the broker', async () => {
  const w = world();
  const a = approve(w);
  w.d.now = () => new Date('2026-11-10T20:50:00Z'); // 15:50 New York, past the last new-order time
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'WAITING');
  assert.equal(w.calls.length, 0);
});

test('unreadable quote while waiting: warns once, stays waiting, never places', async () => {
  const w = world({ responses: { quotes: new Error('timeout') } });
  const a = approve(w);
  await attemptTicket(w.h, a, w.d);
  await attemptTicket(w.h, w.store.approvalFor(w.h.plan_id), w.d);
  assert.equal(statusOf(w), 'active');
  assert.equal(places(w).length, 0);
  assert.equal(w.alerts.filter((l) => l.includes('cannot read a quote')).length, 1);
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

test('executor files differ from the commit: refused, approval spent, nothing placed', async () => {
  const w = world({ commit: () => { throw new Error('the executor files differ from the committed bytes'); } });
  const a = approve(w);
  assert.equal((await attemptTicket(w.h, a, w.d)).status, 'refused');
  assert.equal(places(w).length, 0);
  assert.ok(!existsSync(w.receiptsDir));
});

// ---- preflight refusals: one attempt, spent, receipt written ----------------

const stale = '2026-11-10T14:50:00Z';
const preflightRefusals = [
  ['account does not match', { accounts: { accounts: [{ account_number: 'X1110000', agentic_allowed: true }] } }],
  ['two agent-tradable accounts', { accounts: { accounts: [{ account_number: 'X1117724', agentic_allowed: true }, { account_number: 'Y7724', agentic_allowed: true }] } }],
  ['buying power too low', { portfolio: { buying_power: '99.99' } }],
  ['buying power missing', { portfolio: { nothing: 1 } }],
  ['stale quote', { quotes: { results: [{ last_trade_price: '50.10', updated_at: stale }] } }],
  ['quote with no time', { quotes: { results: [{ last_trade_price: '50.10' }] } }],
  ['quote from the future', { quotes: { results: [{ last_trade_price: '50.10', updated_at: '2026-11-10T15:05:00Z' }] } }],
  ['price drifted', { quotes: { results: [{ last_trade_price: '52.50', updated_at: FRESH }] } }],
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
    if (cap === 'orders' && ++n > 1) { w.calls.push({ cap, args }); throw new Error('down'); }
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
  w.store.addApproval({ plan_id: h2.plan_id, row_id: 'B-501', ticket_code: ticketCode(h2), message_id: 'm2', approved_at: NOW_SEC - 60 });
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
  const yes = () => true;
  const write = (name, body) => writeFileSync(join(dir, name), JSON.stringify(body));
  assert.equal(testGate(dir, yes, CEILING).ok, false);
  write('a.json', { mode: 'test-zero', state: 'CANCELED', final_filled_quantity: 0, broker_order_id: 'o1' });
  assert.match(testGate(dir, yes, CEILING).why, /test-one/);
  write('b.json', { mode: 'test-one', state: 'REJECTED', broker_order_id: 'o2' });
  assert.equal(testGate(dir, yes, CEILING).ok, false);
  write('c.json', { mode: 'test-one', state: 'FILLED', broker_order_id: 'o3' });
  assert.equal(testGate(dir, yes, CEILING).ok, true);
  assert.equal(testGate(dir, () => false, CEILING).ok, false, 'uncommitted receipts do not count');
  assert.equal(testGate(dir, yes, 0).ok, false, 'no limit set stays locked');
});

test('gate: a test-zero that filled or has no order id does not count', () => {
  const yes = () => true;
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
  assert.match(testGate(dir, () => true, CEILING).why, /unreadable/);
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
  const day = new Date('2026-11-26T15:00:00Z');
  const h = ticket({}, { now: new Date(day.getTime() - 3600000), expires: '2026-11-26T21:00:00.000Z' });
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
const writerArgs = { row: 'B-500', shares: 2, limit: 50, stop: 45, drift: '$2', expires: '2026-11-10T21:00:00.000Z' };

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
  assert.equal(quoteAgeSec({ a: [{ updated_at: FRESH }] }, NOW.getTime()), 10);
  assert.equal(quoteAgeSec({ a: 1 }, NOW.getTime()), null);
  assert.ok(QUOTE_MAX_AGE_SEC > 0);
});
