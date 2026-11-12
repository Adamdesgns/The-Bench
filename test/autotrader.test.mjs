// Autotrader tests: every path runs against the simulated broker. No network.
import test from 'node:test';
import assert from 'node:assert/strict';

import { validatePlan, ticket, PLAN_SCHEMA, planRisk, planCode, loadLine } from '../autotrader/lib/plan.mjs';
import { makeCodeSet, useCode, burnCode, codesLeft, normalizeCode } from '../autotrader/lib/codes.mjs';
import { parseCommand, codeCandidates, redact } from '../autotrader/lib/msgs.mjs';
import { DEFAULTS, newState, loadPlan, killPlan, sellPlan, tick, sessionState, dayOver, endOfDay } from '../autotrader/lib/engine.mjs';
import { FakeBroker } from '../autotrader/lib/fake.mjs';
import { normOrder, ocoStatus, alertsOf, orderKind, orderMatches, positionRow, LiveBroker } from '../autotrader/lib/live.mjs';
import { handleCommand, readJson, takeLock } from '../autotrader/autotrader.mjs';
import { exitByProblem } from '../autotrader/lib/session.mjs';
import { mkdtempSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const T0 = Date.parse('2026-11-12T16:00:00Z'); // Thursday 10:00 CT, market open

const plan = (o = {}) => ({
  schema: PLAN_SCHEMA, id: 'B-9001', symbol: 'NVDA', side: 'long',
  entry: { when: 'above', trigger: 166, limit: 167 }, quantity: 6, stop: 156.1, target: 186.6,
  valid_until: '2026-11-12T20:30:00Z', max_loss: 65.4, ...o,
});

function rig({ equity = 2000, buyingPower = equity, cfg = {} } = {}) {
  const notes = [];
  const journal = [];
  let ref = 0;
  const ctx = {
    now: new Date(T0),
    cfg: { ...DEFAULTS, ...cfg },
    calendar: { closed: new Set(['2026-11-26']), early: { '2026-11-27': '13:00' }, end: '2028-12-31' },
    notify: (k, t) => notes.push([k, t]),
    journal: (e, d) => journal.push([e, d]),
    save: () => {},
    newRef: () => `ref-${++ref}`,
  };
  const fb = new FakeBroker({ equity, buyingPower, clock: () => ctx.now.getTime() });
  ctx.broker = fb;
  const st = newState();
  const advance = (sec) => { ctx.now = new Date(ctx.now.getTime() + sec * 1000); };
  const px = (p) => fb.setPrice('NVDA', p);
  const said = (re) => notes.some(([, t]) => re.test(t));
  const kinds = (k) => notes.filter(([x]) => x === k).map(([, t]) => t);
  return { ctx, fb, st, notes, journal, advance, px, said, kinds };
}

const buys = (fb) => [...fb.orders.values()].filter((o) => o.side === 'buy');
const sells = (fb) => [...fb.orders.values()].filter((o) => o.side === 'sell');

// ---- plan rules -------------------------------------------------------------

test('a good plan passes and its risk is shares x (ceiling - stop)', () => {
  const v = validatePlan(plan(), { now: new Date(T0) });
  assert.equal(v.ok, true, v.errs.join('; '));
  assert.equal(v.risk, 65.4);
  assert.equal(planRisk(plan()), 65.4);
  assert.match(ticket(plan()), /BUY 6 NVDA when it trades at or over 166 \(pays at most 167\).*stop 156\.1, target 186\.6.*\$65\.40.*\[B-9001\]/);
});

test('bad plans are refused with a reason', () => {
  const now = new Date(T0);
  const bad = (o, re) => {
    const v = validatePlan(plan(o), { now });
    assert.equal(v.ok, false);
    assert.ok(v.errs.some((e) => re.test(e)), `${re} not in ${v.errs.join(' | ')}`);
  };
  bad({ side: 'short' }, /cash account/);
  bad({ stop: 166.5, max_loss: 3 }, /stop must be under the trigger/);
  bad({ entry: { when: 'above', trigger: 166, limit: 170 }, max_loss: 83.4 }, /chase/);
  bad({ max_loss: 30 }, /does not match/);
  bad({ valid_until: '2026-11-12 14:30' }, /valid_until must be a time/);
  bad({ valid_until: '2026-11-12T15:00:00Z' }, /already past/);
  bad({ valid_until: '2026-11-30T15:00:00Z' }, /more than 7 days/);
  bad({ quantity: 2.5 }, /whole shares/);
  bad({ target: 166.5 }, /target must be over/);
  bad({ id: 'NVDA' }, /book row/);
  bad({ entry: { when: 'below', trigger: 0.9, limit: 0.9 }, stop: 0.5, target: 1.5, quantity: 100, max_loss: 40 }, /under \$1/);
  bad({ stop: 156.105, max_loss: 65.37 }, /more than 2 decimals/);
  bad({ not_before: '2026-11-12T19:00:00Z', exit_by: '2026-11-12T18:00:00Z' }, /exit_by must come after not_before/);
});

test('the ticket code is a fingerprint: any edit to the plan changes it', () => {
  const a = planCode(plan());
  assert.match(a, /^[A-Z2-9]{6}$/);
  assert.equal(planCode(plan()), a, 'the same plan always gives the same code');
  assert.equal(planCode({ ...plan(), symbol: 'NVDA' }), a, 'key order does not matter');
  assert.notEqual(planCode(plan({ quantity: 7, max_loss: 76.3 })), a);
  assert.notEqual(planCode(plan({ stop: 150, max_loss: 102 })), a);
  assert.equal(loadLine(plan()), `LOAD B-9001 ${a}`);
});

// ---- codes and commands -------------------------------------------------------

test('a code works once; a used code is a replay, not a guess', () => {
  const { codes, store } = makeCodeSet(3);
  assert.equal(codesLeft(store), 3);
  assert.equal(useCode(store, codes[0].toUpperCase().replace('-', ' ')), 'ok'); // typed sloppily still works
  assert.equal(useCode(store, codes[0]), 'used');
  assert.equal(useCode(store, 'abcde-fghjk'), 'wrong');
  assert.equal(codesLeft(store), 2);
  assert.equal(normalizeCode(' AbC-de '), 'abcde');
  assert.ok(!JSON.stringify(store).includes(codes[1].replace('-', '')), 'plain codes never stored');
});

test('phone commands parse strictly and a code is never logged', () => {
  assert.deepEqual(parseCommand('load b-1460 abc234 abcde-fghjk'), { cmd: 'LOAD', id: 'B-1460', ticket: 'ABC234', code: 'abcde-fghjk' });
  assert.deepEqual(parseCommand('SELL B-1460 abcdefghjk'), { cmd: 'SELL', id: 'B-1460', code: 'abcdefghjk' });
  assert.deepEqual(parseCommand('KILL ALL'), { cmd: 'KILL', id: 'ALL' });
  assert.deepEqual(parseCommand(' status '), { cmd: 'STATUS' });
  assert.equal(parseCommand('LOAD B-1460 abcde-fghjk'), null, 'LOAD without its ticket is refused');
  assert.equal(parseCommand('LOAD B-1460'), null);
  assert.equal(parseCommand('buy NVDA now'), null);
  assert.equal(redact('LOAD B-1460 ABC234 abcde-fghjk'), 'LOAD B-1460 <redacted>');
  assert.equal(redact('LOAD B-1460 abcde fghjk'), 'LOAD B-1460 <redacted>', 'a code typed with a space does not half-leak');
  assert.equal(redact('hey abcde-fghjk'), '(not a command)');
  assert.ok(codeCandidates('LOAD B-1460 abcde fghjk').includes('abcdefghjk'), 'a code split by a space is still found');
  assert.ok(codeCandidates('x abcde-fghjk').includes('abcdefghjk'));
});

// ---- the main path ---------------------------------------------------------------

test('breakout: waits under the trigger, buys at the ceiling, sets stop+target, reports the stop-out', async () => {
  const r = rig();
  assert.equal((await loadPlan(r.st, plan(), r.ctx)).ok, true);
  assert.ok(r.said(/^LOADED: BUY 6 NVDA/));
  r.px(165);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 0, 'no buy under the trigger');
  r.advance(5); r.px(166.5);
  await tick(r.st, r.ctx);
  const [b] = buys(r.fb);
  assert.equal(b.type, 'limit');
  assert.equal(b.limit, 167);
  assert.equal(b.qty, 6);
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'PROTECTED', 'filled and protected in the same tick');
  const [oco] = [...r.fb.ocos.values()];
  assert.deepEqual([oco.qty, oco.stop, oco.target], [6, 156.1, 186.6]);
  assert.ok(r.kinds('fill').some((t) => /BOUGHT 6 NVDA at 166\.5\. Stop 156\.1 and target 186\.6 are SET/.test(t)));
  r.advance(31); r.px(155.9);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'CLOSED');
  assert.ok(r.kinds('closed').some((t) => /SOLD 6 NVDA at 155\.9: stop hit\. Result -\$63\.60 \(-1\.02R\)/.test(t)));
});

test('target hit is reported as a win', async () => {
  const r = rig();
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.2);
  await tick(r.st, r.ctx);
  r.advance(31); r.px(187);
  await tick(r.st, r.ctx);
  assert.equal(r.st.plans['B-9001'].status, 'CLOSED');
  assert.ok(r.kinds('closed').some((t) => /target hit\. Result \+\$122\.40/.test(t)));
});

test('never chases: a price over the ceiling sends nothing until it comes back', async () => {
  const r = rig();
  await loadPlan(r.st, plan(), r.ctx);
  r.px(168.2);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 0);
  r.advance(5); r.px(166.9);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 1);
});

test('pullback plan buys at or under its level, never under the stop', async () => {
  const r = rig();
  const pb = plan({ entry: { when: 'below', trigger: 151.49, limit: 151.49 }, stop: 142, target: 170, max_loss: 56.94 });
  assert.equal((await loadPlan(r.st, pb, r.ctx)).ok, true);
  r.px(141.5);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 0, 'under the stop: no buy');
  r.advance(5); r.px(152);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 0);
  r.advance(5); r.px(151.3);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 1);
  assert.equal(r.st.plans['B-9001'].status, 'PROTECTED');
});

test('not_before, the late-day cutoff, weekends, holidays and half days block new buys', async () => {
  const r = rig();
  await loadPlan(r.st, plan({ not_before: '2026-11-12T16:10:00Z' }), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 0, 'before not_before');
  r.advance(600); r.px(166.5); // a fresh quote: the old one is 10 minutes stale
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 1, 'after not_before');

  const cal = r.ctx.calendar;
  assert.equal(sessionState(new Date('2026-11-12T20:56:00Z'), cal).entries, false, '15:56 ET: in the last 5 minutes');
  assert.equal(sessionState(new Date('2026-11-12T20:56:00Z'), cal).open, true);
  assert.equal(sessionState(new Date('2026-11-14T16:00:00Z'), cal).open, false, 'Saturday');
  assert.equal(sessionState(new Date('2026-11-26T16:00:00Z'), cal).open, false, 'Thanksgiving');
  assert.equal(sessionState(new Date('2026-11-27T18:30:00Z'), cal).open, false, 'half day, after 13:00 ET');
  assert.equal(sessionState(new Date('2026-11-27T17:00:00Z'), cal).entries, true, 'half day, morning');
  assert.equal(sessionState(new Date('2026-11-12T14:00:00Z'), cal).open, false, 'pre-market');
});

test('a stale quote is not a trigger', async () => {
  const r = rig();
  await loadPlan(r.st, plan(), r.ctx);
  r.fb.setPrice('NVDA', 166.5, T0 - 10 * 60 * 1000);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 0);
});

test('the plan expires at valid_until with nothing bought', async () => {
  const r = rig();
  await loadPlan(r.st, plan({ valid_until: '2026-11-12T16:01:00Z' }), r.ctx);
  r.px(160);
  r.advance(61);
  await tick(r.st, r.ctx);
  assert.equal(r.st.plans['B-9001'].status, 'EXPIRED');
  assert.ok(r.said(/EXPIRED B-9001 NVDA/));
});

// ---- the buy not filling ---------------------------------------------------------

test('an unfilled buy is cancelled after 30s and retried; three misses end the plan', async () => {
  const r = rig();
  r.fb.autoFillBuys = false;
  await loadPlan(r.st, plan(), r.ctx);
  for (let i = 0; i < 3; i += 1) {
    r.px(166.5);
    await tick(r.st, r.ctx); // buy goes out
    r.advance(31);
    await tick(r.st, r.ctx); // cancel requested
    r.advance(5);
    await tick(r.st, r.ctx); // sees CANCELED
    r.advance(5);
  }
  // A buy order existed, so it reads the account twice for shares before it ends (no new buy meanwhile).
  assert.equal(r.st.plans['B-9001'].status, 'WATCHING');
  assert.ok(r.st.plans['B-9001'].pendingEnd);
  await tick(r.st, r.ctx); // first read of 0
  r.advance(r.ctx.cfg.reconcileSec + 1);
  await tick(r.st, r.ctx); // second read of 0: it ends
  assert.equal(buys(r.fb).length, 3);
  assert.equal(r.st.plans['B-9001'].status, 'MISSED');
  assert.ok(r.said(/MISSED B-9001 NVDA: it ran past the 167 ceiling 3 times/));
});

test('a partial fill: the rest is cancelled and only the filled shares get the stop', async () => {
  const r = rig();
  r.fb.autoFillBuys = false;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  const [b] = buys(r.fb);
  r.fb.fill(b.id, 2, 166.4);
  r.advance(21);
  await tick(r.st, r.ctx); // partial for 20s: cancel the rest
  r.advance(5);
  await tick(r.st, r.ctx); // CANCELED with 2 filled: protect 2
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'PROTECTED');
  assert.equal([...r.fb.ocos.values()][0].qty, 2);
  assert.ok(r.said(/BOUGHT 2 NVDA at 166\.4/));
});

test('a dropped reply after the buy went out: it finds the order, never sends a second one', async () => {
  const r = rig();
  r.fb.fail.lostReply = 1;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx); // the send throws, the same tick looks it up and adopts it
  assert.equal(r.st.plans['B-9001'].status, 'PROTECTED');
  r.advance(20);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 1, 'exactly one buy');
});

test('a buy whose send failed is never sent again: it holds, alarms, and ends only after the close on two clean reads', async () => {
  const r = rig();
  r.fb.fail.place = 1;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  for (let i = 0; i < 4; i += 1) { await tick(r.st, r.ctx); r.advance(16); r.px(166.5); }
  const p = r.st.plans['B-9001'];
  const sends = r.fb.calls.filter(([c, o]) => c === 'placeOrder' && o.side === 'buy');
  assert.equal(sends.length, 1, 'one send per attempt, never a resend');
  assert.equal(p.status, 'ENTERING', 'a buy that might exist is never ended');
  assert.ok(r.kinds('alarm').some((t) => /could not be confirmed at Robinhood.*will NOT send another/.test(t)));
  r.ctx.now = new Date('2026-11-12T21:05:00Z'); // after the close: a day order is dead
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'ENTERING', 'one clean read after the close is not enough');
  r.advance(16);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'EXPIRED');
  assert.equal(r.fb.calls.filter(([c, o]) => c === 'placeOrder' && o.side === 'buy').length, 1);
});

// ---- the stop ------------------------------------------------------------------------

test('stop+target refused twice: a plain stop is set and the message says the target is not', async () => {
  const r = rig();
  r.fb.fail.oco = 2;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx); // fills, first OCO try fails
  r.advance(5);
  await tick(r.st, r.ctx); // second OCO try fails, plain stop goes in
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'PROTECTED');
  assert.equal(p.prot.kind, 'stop');
  const stop = sells(r.fb).find((o) => o.type === 'stop_market');
  assert.deepEqual([stop.qty, stop.stop, stop.tif], [6, 156.1, 'gtc']);
  assert.ok(r.kinds('fill').some((t) => /Stop 156\.1 is SET at Robinhood\. The target is NOT set/.test(t)));
});

test('no stop can be set: it alarms with the exact stop to place, retries, and never sells on its own', async () => {
  const r = rig();
  r.fb.fail.oco = 99;
  r.fb.fail.stop = 99;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  for (let i = 0; i < 6; i += 1) { await tick(r.st, r.ctx); r.advance(5); }
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'UNPROTECTED');
  assert.ok(r.kinds('alarm').some((t) => /THE STOP IS NOT SET\. Set it now in the app: SELL 6 NVDA STOP 156\.1/.test(t)));
  assert.equal(sells(r.fb).filter((o) => o.type === 'market').length, 0, 'no panic sell');
  r.advance(60);
  r.fb.fail.oco = 0;
  await tick(r.st, r.ctx); // a fresh round after the alarm window
  assert.equal(p.status, 'PROTECTED');
});

test('price already through the stop when the buy fills: it sells, as the plan says', async () => {
  const r = rig();
  r.fb.autoFillBuys = false;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  r.fb.fill(buys(r.fb)[0].id, 6, 166.5);
  r.advance(5); r.px(155);
  await tick(r.st, r.ctx);
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'CLOSED');
  assert.equal(r.fb.ocos.size, 0);
  assert.ok(r.kinds('closed').some((t) => /SOLD 6 NVDA at 155: the price was already at or under the stop/.test(t)));
});

test('the stop cancelled in the app while shares are held: the trader puts it back', async () => {
  const r = rig();
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  const [first] = [...r.fb.ocos.values()];
  await r.fb.cancelOco(first.id);
  r.advance(31);
  await tick(r.st, r.ctx);
  assert.ok(r.kinds('alarm').some((t) => /cancelled outside the trader/.test(t)));
  assert.equal(r.st.plans['B-9001'].status, 'PROTECTED');
  assert.equal(r.fb.ocos.size, 2);
});

// ---- selling -------------------------------------------------------------------------

test('exit_by: cancels the stop+target, then sells at market', async () => {
  const r = rig();
  await loadPlan(r.st, plan({ exit_by: '2026-11-12T16:01:00Z' }), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  r.advance(61); r.px(170);
  await tick(r.st, r.ctx);
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'CLOSED');
  assert.equal([...r.fb.ocos.values()][0].state, 'CANCELED');
  assert.ok(r.kinds('closed').some((t) => /SOLD 6 NVDA at 170: the sell-by time came\. Result \+\$21\.00/.test(t)));
});

test('KILL stops a watching plan; on a held position it never sells', async () => {
  const r = rig();
  await loadPlan(r.st, plan(), r.ctx);
  killPlan(r.st, 'B-9001', r.ctx);
  assert.equal(r.st.plans['B-9001'].status, 'KILLED');

  const r2 = rig();
  await loadPlan(r2.st, plan(), r2.ctx);
  r2.px(166.5);
  await tick(r2.st, r2.ctx);
  killPlan(r2.st, 'ALL', r2.ctx);
  assert.equal(r2.st.plans['B-9001'].status, 'PROTECTED');
  assert.ok(r2.said(/stay protected by the stop at 156\.1/));
  sellPlan(r2.st, 'B-9001', r2.ctx);
  r2.advance(5); r2.px(168);
  await tick(r2.st, r2.ctx);
  assert.equal(r2.st.plans['B-9001'].status, 'CLOSED');
  assert.ok(r2.said(/SOLD 6 NVDA at 168: you sent SELL/));
});

// ---- loading limits ---------------------------------------------------------------

test('loading refuses: risk over the band, not enough cash, a second plan on the symbol, too many plans', async () => {
  const small = rig({ equity: 500, buyingPower: 2000 });
  assert.equal((await loadPlan(small.st, plan(), small.ctx)).ok, false);
  assert.ok(small.said(/max loss \$65\.4 is over 10% of the account \(\$50\)/));

  const broke = rig({ equity: 2000, buyingPower: 900 });
  assert.equal((await loadPlan(broke.st, plan(), broke.ctx)).ok, false);
  assert.ok(broke.said(/needs \$1002 and the agent account has \$900/));

  const r = rig({ equity: 10000 });
  assert.equal((await loadPlan(r.st, plan(), r.ctx)).ok, true);
  assert.equal((await loadPlan(r.st, plan({ id: 'B-9002' }), r.ctx)).ok, false);
  assert.ok(r.said(/another plan on NVDA is live/));
  for (const [id, sym] of [['B-9003', 'AMD'], ['B-9004', 'AVGO']]) assert.equal((await loadPlan(r.st, plan({ id, symbol: sym }), r.ctx)).ok, true);
  assert.equal((await loadPlan(r.st, plan({ id: 'B-9005', symbol: 'MU' }), r.ctx)).ok, false);
  assert.ok(r.said(/3 plans are already live/));
});

/** The settings "on disk" for handleCommand: read fresh each time, like the daemon. */
function disk(n = 8) {
  const { codes, store } = makeCodeSet(n);
  const box = { cfg: { codes: store, failures: 0, locked: false } };
  const io = {
    readPlan: (id) => (id === 'B-9001' ? plan() : null),
    loadCfg: () => structuredClone(box.cfg),
    saveCfg: (c) => { box.cfg = structuredClone(c); },
  };
  return { codes, box, io };
}

test('phone LOAD: a good code + the right ticket loads; a used code, wrong codes and a lock all refuse', async () => {
  const r = rig();
  const { codes, box, io } = disk();
  const line = loadLine(plan());
  await handleCommand(`${line} ${codes[0]}`, r.st, r.ctx, io);
  assert.equal(r.st.plans['B-9001'].status, 'WATCHING');
  killPlan(r.st, 'B-9001', r.ctx);
  await handleCommand(`${line} ${codes[0]}`, r.st, r.ctx, io);
  assert.ok(r.said(/already used/));
  assert.equal(r.st.plans['B-9001'].status, 'KILLED', 'a replayed code does not reload');
  for (let i = 0; i < 3; i += 1) await handleCommand(`${line} zzzzz-zzzzz`, r.st, r.ctx, io);
  assert.equal(box.cfg.locked, true);
  await handleCommand(`${line} ${codes[1]}`, r.st, r.ctx, io);
  assert.equal(r.st.plans['B-9001'].status, 'KILLED', 'locked: even a good code does nothing');
  assert.equal(useCode(structuredClone(box.cfg.codes), codes[1]), 'used', 'and that code, seen on the topic, is dead');
  box.cfg = { ...box.cfg, locked: false, failures: 0 }; // `unlock` at the PC, while the trader runs
  await handleCommand(`LOAD B-7777 ABC234 ${codes[2]}`, r.st, r.ctx, io);
  assert.ok(r.said(/no plan file/), 'the unlock took effect without a restart');
  assert.ok(!r.journal.some(([, d]) => JSON.stringify(d ?? {}).includes(codes[0])), 'no code in the journal');
});

test('phone LOAD with a ticket that does not match the plan file loads nothing', async () => {
  const r = rig();
  const { codes, io } = disk();
  io.readPlan = () => plan({ quantity: 60, max_loss: 654 }); // the file changed after the ticket went out
  await handleCommand(`${loadLine(plan())} ${codes[0]}`, r.st, r.ctx, io);
  assert.equal(r.st.plans['B-9001'], undefined);
  assert.ok(r.said(/not the one on your ticket/));
});

test('codes seen on the topic die even when nothing acts on them', async () => {
  const r = rig();
  const { codes, box, io } = disk();
  await handleCommand(`hello ${codes[0]}`, r.st, r.ctx, io);
  await handleCommand(`LOAD B-9001 ${codes[1].replace('-', ' ')}`, r.st, r.ctx, io); // malformed: no ticket, code split
  assert.equal(codesLeft(box.cfg.codes), codes.length - 2);
  assert.equal(box.cfg.failures, 0, 'burning is not a wrong guess');
  assert.ok(r.said(/now dead/));
  const { codes: c2, store } = makeCodeSet(2);
  assert.equal(burnCode(store, c2[0]), true);
  assert.equal(burnCode(store, c2[0]), false, 'already burned');
  assert.equal(burnCode(store, 'zzzzz-zzzzz'), false);
});

// ---- Robinhood response parsing (shapes captured 2026-11-12) ---------------------------

test('order records parse as Robinhood writes them', () => {
  const stop = { id: 'a', symbol: 'GOOGL', side: 'sell', type: 'market', trigger: 'stop', state: 'filled', quantity: '4.000000', cumulative_quantity: '4.000000', stop_price: '326.000000', average_price: '325.980000', created_at: '2026-10-01T18:01:42Z' };
  const n = normOrder(stop);
  assert.deepEqual([n.kind, n.state, n.filledQty, n.avgPrice, n.qty], ['stop_market', 'FILLED', 4, 325.98, 4]);
  assert.equal(orderKind({ type: 'limit', trigger: 'immediate' }), 'limit');
  assert.equal(normOrder({ id: 'b', state: 'confirmed', cumulative_quantity: '0' }).state, 'PENDING');
  assert.equal(normOrder({ id: 'c', state: 'voided' }).state, 'UNKNOWN');

  const tp = { id: 't', symbol: 'NVDA', side: 'sell', type: 'limit', trigger: 'immediate', state: 'confirmed', quantity: '6' };
  const sl = { id: 's', symbol: 'NVDA', side: 'sell', type: 'market', trigger: 'stop', stop_price: '156.10', state: 'queued', quantity: '6' };
  assert.equal(ocoStatus({ id: 'g' }, [tp, sl]).state, 'LIVE');
  assert.equal(ocoStatus({ id: 'g' }, [{ ...tp, state: 'cancelled' }, { ...sl, state: 'filled', cumulative_quantity: '6', average_price: '156.02' }]).state, 'STOP_FILLED');
  assert.equal(ocoStatus({ id: 'g' }, [{ ...tp, state: 'filled', cumulative_quantity: '6', average_price: '186.6' }, { ...sl, state: 'cancelled' }]).state, 'TARGET_FILLED');
  assert.equal(ocoStatus({ id: 'g' }, [{ ...tp, state: 'cancelled' }, { ...sl, state: 'cancelled' }]).state, 'CANCELED');
  assert.equal(ocoStatus(null, []).state, 'UNKNOWN');

  assert.deepEqual(alertsOf({ data: { order_checks: [] } }), []);
  assert.deepEqual(alertsOf({ data: { order_checks: [{ message: 'Insufficient buying power' }] } }), ['Insufficient buying power']);
  assert.deepEqual(alertsOf({ _unparsed: 'x' }), ['the review answer could not be read']);
});

// ---- the review of 2026-11-12: each probe that broke the first version -----------------

const bought = async (r, o = {}) => { // a plan loaded, bought at 166.5 and protected
  await loadPlan(r.st, plan(o), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  return r.st.plans['B-9001'];
};

test('review #1: a buy that landed but cannot be confirmed is never ended and never bought twice', async () => {
  const r = rig();
  r.fb.autoFillBuys = false;
  r.fb.fail.lostReply = 1; // the order is made, the answer is lost
  r.fb.fail.hideOrders = 999; // and the order list lags
  r.fb.dupRefThrows = true; // and a resend with the same key gets an error
  await loadPlan(r.st, plan(), r.ctx);
  for (let i = 0; i < 5; i += 1) { r.px(166.5); await tick(r.st, r.ctx); r.advance(16); }
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'ENTERING');
  assert.equal(buys(r.fb).length, 1, 'one real buy at the broker');
  assert.ok(r.kinds('alarm').some((t) => /will NOT send another buy/.test(t)));
  assert.equal((await loadPlan(r.st, plan({ id: 'B-9002' }), r.ctx)).ok, false, 'no second plan on the ticker');
  r.fb.fill(buys(r.fb)[0].id, 6, 166.4); // the hidden order fills
  r.advance(5); r.px(166.6);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'PROTECTED', 'shares found in the account: protected');
  assert.equal([...r.fb.ocos.values()][0].qty, 6);
  assert.equal(buys(r.fb).length, 1);
});

test('review #1: the trader will not start a ticker the account is already in', async () => {
  const r = rig();
  r.fb.pos.NVDA = 1;
  assert.equal((await loadPlan(r.st, plan(), r.ctx)).ok, false);
  assert.ok(r.said(/already holds 1 NVDA/));
  const r2 = rig();
  await loadPlan(r2.st, plan(), r2.ctx);
  r2.fb.orders.set('x', { id: 'x', symbol: 'NVDA', side: 'buy', type: 'limit', qty: 1, limit: 150, state: 'PENDING', filledQty: 0, createdAt: new Date(T0).toISOString() });
  r2.px(166.5);
  await tick(r2.st, r2.ctx);
  assert.equal(r2.st.plans['B-9001'].status, 'REJECTED', 'an open order appeared after loading: no buy');
  assert.equal(buys(r2.fb).length, 1, 'only the stray order');
  const r3 = rig();
  await loadPlan(r3.st, plan(), r3.ctx);
  r3.fb.fail.positions = 1;
  r3.px(166.5);
  await tick(r3.st, r3.ctx);
  assert.equal(buys(r3.fb).length, 0, 'shares unreadable: no buy');
});

test('review #2: KILL after a failed send stops any resend; it ends KILLED after the close', async () => {
  const r = rig();
  r.fb.fail.place = 1;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  killPlan(r.st, 'B-9001', r.ctx);
  for (let i = 0; i < 3; i += 1) { r.advance(16); r.px(166.5); await tick(r.st, r.ctx); }
  assert.equal(buys(r.fb).length, 0, 'no resend after KILL');
  assert.equal(r.st.plans['B-9001'].status, 'ENTERING');
  assert.ok(r.said(/never confirmed, so the trader cannot cancel it by its id/), 'KILL says what it can and cannot do');
  r.ctx.now = new Date('2026-11-12T21:05:00Z');
  await tick(r.st, r.ctx);
  r.advance(16);
  await tick(r.st, r.ctx);
  assert.equal(r.st.plans['B-9001'].status, 'KILLED');
});

test('review #2: restarting the next day after expiry never sends the old buy', async () => {
  const r = rig();
  r.fb.fail.place = 1;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx); // the send failed; the program then stops
  r.ctx.now = new Date('2026-11-13T15:00:00Z'); // next morning, the plan expired, price far under the trigger
  r.px(158);
  await tick(r.st, r.ctx);
  r.advance(16);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 0);
  assert.equal(r.st.plans['B-9001'].status, 'EXPIRED');
});

test('review #3: a stop cancelled in the app is never taken as live; one new stop is set, no loop', async () => {
  const r = rig();
  r.fb.fail.oco = 999; // only plain stops work
  const p = await bought(r);
  r.advance(5);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'PROTECTED');
  const first = p.prot.id;
  await r.fb.cancelOrder(first); // Adam cancels it in the app
  for (let i = 0; i < 20; i += 1) { r.advance(5); r.px(166.6); await tick(r.st, r.ctx); }
  assert.equal(p.status, 'PROTECTED');
  assert.notEqual(p.prot.id, first);
  const liveStops = sells(r.fb).filter((o) => o.type === 'stop_market' && ['PENDING', 'PARTIALLY_FILLED'].includes(o.state));
  assert.equal(liveStops.length, 1, 'exactly one stop resting');
  assert.equal(r.kinds('alarm').filter((t) => /cancelled outside the trader/.test(t)).length, 1, 'no loop');
});

test('review #3: order lookups check ticker, time, state and dead ids on our side', () => {
  const since = '2026-11-12T16:00:00Z';
  const n = (o) => ({ id: 'a', symbol: 'NVDA', side: 'sell', kind: 'stop_market', qty: 6, state: 'PENDING', createdAt: '2026-11-12T16:00:03Z', ...o });
  const q = { symbol: 'NVDA', side: 'sell', type: 'stop_market', qty: 6, sinceIso: since, openOnly: true, excludeIds: ['dead'] };
  assert.equal(orderMatches(n(), q), true);
  assert.equal(orderMatches(n({ symbol: 'AMD' }), q), false, 'another ticker');
  assert.equal(orderMatches(n({ state: 'CANCELED' }), q), false, 'cancelled is not a stop');
  assert.equal(orderMatches(n({ createdAt: '2026-11-12T15:00:00Z' }), q), false, 'older than this round');
  assert.equal(orderMatches(n({ id: 'dead' }), q), false, 'a known-dead id');
  assert.equal(orderMatches(n({ createdAt: null }), q), false, 'no time, no match');
});

test('review #4: unreadable shares are never read as zero', async () => {
  const lb = new LiveBroker({ accountNumber: '1', mcp: { callTool: async () => ({ content: [{ type: 'text', text: 'Service unavailable' }] }) } });
  lb.binding = { positions: 'get_equity_positions' };
  await assert.rejects(lb.positions(), /not parseable/);
  lb.mcp = { callTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ data: { note: 'hi' } }) }] }) };
  await assert.rejects(lb.positions(), /not recognized/);
  lb.mcp = { callTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ data: { positions: [] } }) }] }) };
  assert.deepEqual(await lb.positions(), {});

  const r = rig();
  const p = await bought(r);
  r.fb.fail.positions = 999;
  await r.fb.cancelOco(p.prot.id); // the stop+target cancelled outside, shares unreadable
  r.advance(31);
  await tick(r.st, r.ctx);
  assert.notEqual(p.status, 'CLOSED');
  assert.equal(p.status, 'PROTECTED', 'assumed still held, protected again');
  assert.ok(r.said(/shares not readable, assumed/));
});

test('review #5: a stop that cannot be read alarms after 3 checks, even with quiet ticks between', async () => {
  const r = rig();
  const p = await bought(r);
  r.fb.fail.readOco = 999;
  for (let i = 0; i < 24; i += 1) { r.advance(5); r.px(166.6); await tick(r.st, r.ctx); }
  assert.equal(p.status, 'PROTECTED');
  assert.ok(r.kinds('alarm').some((t) => /cannot read the stop order's status/.test(t)));
});

test('review #6: a sell that partly fills then cancels sells the rest; the result counts both', async () => {
  const r = rig();
  const p = await bought(r);
  r.fb.holdSells = true;
  sellPlan(r.st, 'B-9001', r.ctx);
  r.advance(5); r.px(170);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'EXITING');
  const [first] = sells(r.fb).filter((o) => o.type === 'market');
  assert.equal(first.qty, 6);
  r.fb.fill(first.id, 4, 170);
  first.state = 'CANCELED';
  r.fb.holdSells = false;
  r.advance(5);
  await tick(r.st, r.ctx);
  r.advance(5);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'CLOSED');
  assert.deepEqual(sells(r.fb).filter((o) => o.type === 'market').map((o) => o.qty), [6, 2]);
  assert.ok(r.kinds('closed').some((t) => /SOLD 6 NVDA at 170: you sent SELL\. Result \+\$21\.00/.test(t)));
});

test('review #11: after a failed exit, a new SELL tries again', async () => {
  const r = rig();
  const p = await bought(r);
  r.fb.fail.sell = 3;
  sellPlan(r.st, 'B-9001', r.ctx);
  for (let i = 0; i < 6; i += 1) { r.advance(16); r.px(168); await tick(r.st, r.ctx); }
  assert.equal(p.status, 'PROTECTED', 'the sell failed 3 times: the stop is back');
  assert.ok(r.kinds('alarm').some((t) => /the sell did not go through/.test(t)));
  sellPlan(r.st, 'B-9001', r.ctx);
  r.advance(5); r.px(168);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'CLOSED');
});

test('review #12 + #13: no buy at or after the sell-by time; a quote with no time is not a trigger', async () => {
  const r = rig();
  await loadPlan(r.st, plan({ exit_by: '2026-11-12T16:01:00Z' }), r.ctx);
  r.advance(61); r.px(166.5);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 0);
  assert.equal(r.st.plans['B-9001'].status, 'EXPIRED');
  const r2 = rig();
  await loadPlan(r2.st, plan(), r2.ctx);
  r2.fb.px.NVDA = { last: 166.5, at: null };
  await tick(r2.st, r2.ctx);
  assert.equal(buys(r2.fb).length, 0);
});

test('review #14 + #15: the daily stop alarms on bare shares; KILL on bare shares says the stop is being set', async () => {
  const r = rig();
  r.fb.fail.oco = 999;
  r.fb.fail.stop = 999;
  const p = await bought(r);
  assert.equal(p.status, 'UNPROTECTED');
  killPlan(r.st, 'B-9001', r.ctx);
  assert.ok(r.said(/trader is setting the stop at 156\.1 now/));
  assert.ok(!r.said(/stay protected by the stop/));
  endOfDay(r.st, r.ctx);
  assert.ok(r.kinds('alarm').some((t) => /stopped for the day and the 6 shares have NO STOP/.test(t)));
  assert.equal(dayOver('2026-11-12T16:00:00Z', new Date('2026-11-12T20:59:00Z'), r.ctx.calendar), false);
  assert.equal(dayOver('2026-11-12T16:00:00Z', new Date('2026-11-12T21:00:00Z'), r.ctx.calendar), true);
  assert.equal(dayOver('2026-11-27T15:00:00Z', new Date('2026-11-27T18:00:00Z'), r.ctx.calendar), true, 'half day closes at 13:00 ET');
});

test('review #16: placed ids are trusted only after reading them back', async () => {
  const reply = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
  const lb = new LiveBroker({
    accountNumber: '1',
    mcp: {
      callTool: async (name) => {
        if (name === 'place_equity_order') return reply({ data: { id: 'req-123' } }); // a request id, not an order id
        if (name === 'get_equity_orders') return reply({ data: { orders: [] } });
        throw new Error(name);
      },
    },
  });
  lb.binding = { place: 'place_equity_order', orders: 'get_equity_orders' };
  const r = await lb.placeOrder({ symbol: 'NVDA', side: 'buy', type: 'limit', qty: 6, limit: 167, refId: 'k' });
  assert.equal(r.orderId, null, 'not found when read back: the engine looks it up instead');
  assert.deepEqual(alertsOf({ data: { warnings: [{ message: 'Pattern day trader' }] } }), ['Pattern day trader']);
});

// ---- the second review of 2026-11-12: one test per probe ---------------------------------

const marketSells = (fb) => sells(fb).filter((o) => o.type === 'market');

test('review2 #1: a SELL that reads 0 shares once after cancelling the stop reads again, then sells', async () => {
  const r = rig();
  const p = await bought(r);
  sellPlan(r.st, 'B-9001', r.ctx);
  r.fb.fail.emptyPositions = 1; // one lagging read right after the stop is cancelled
  r.advance(5); r.px(168);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'EXITING', 'one read of 0 is not the end');
  assert.ok(!r.said(/no shares left/));
  r.advance(5); r.px(168);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'CLOSED');
  assert.ok(r.kinds('closed').some((t) => /SOLD 6 NVDA at 168/.test(t)));
  assert.equal(r.fb.pos.NVDA, 0);
});

test('review2 #1 + #2: shares really gone (sold in the app): the stop is tried, then it ends with an ALARM, never a quiet SOLD', async () => {
  const r = rig();
  const p = await bought(r);
  sellPlan(r.st, 'B-9001', r.ctx);
  r.fb.pos.NVDA = 0; // Adam sold them in the app
  r.fb.fail.oco = 99; r.fb.fail.stop = 99; // so Robinhood refuses any stop
  for (let i = 0; i < 8 && p.status !== 'CLOSED'; i += 1) { r.advance(16); r.px(168); await tick(r.st, r.ctx); }
  assert.equal(p.status, 'CLOSED');
  assert.ok(r.said(/the sell did not go through/), 'it put the stop back first');
  assert.ok(r.kinds('alarm').some((t) => /did NOT sell them/.test(t)), 'the end is an alarm');
  assert.equal(r.kinds('closed').length, 0, 'never a SOLD message for shares it did not sell');
});

test('review2 #2: stop refused + one empty positions read: it alarms and keeps trying, never CLOSED', async () => {
  const r = rig();
  r.fb.fail.oco = 2;
  r.fb.fail.stop = 1;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx); // filled; first stop+target try refused
  r.fb.fail.emptyPositions = 1;
  r.advance(5); r.px(166.5);
  await tick(r.st, r.ctx); // second try refused, plain stop refused, positions read {} once
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'UNPROTECTED');
  assert.ok(r.kinds('alarm').some((t) => /stop could not be set/.test(t)), 'an alarm went out');
  r.advance(5); r.px(166.5);
  await tick(r.st, r.ctx); // the plain stop goes in
  assert.equal(p.status, 'PROTECTED');
  assert.equal(r.fb.pos.NVDA, 6);
});

test('review2 #3: a positions row with no ticker is unreadable, never 0 shares; every page is read', async () => {
  assert.throws(() => positionRow({ instrument_id: 'abc', instrument: 'https://x/instruments/abc/', quantity: '6.0' }), /no readable ticker/);
  assert.deepEqual(positionRow({ symbol: 'nvda', quantity: '6.00000000' }), { symbol: 'NVDA', qty: 6 });
  const reply = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
  const seen = [];
  const lb = new LiveBroker({
    accountNumber: '1',
    mcp: {
      callTool: async (name, args) => {
        seen.push(args.cursor ?? null);
        if (!args.cursor) return reply({ data: { positions: [{ symbol: 'AMD', quantity: '2' }], next: 'page2' } });
        return reply({ data: { positions: [{ symbol: 'NVDA', quantity: '6' }], next: null } });
      },
    },
  });
  lb.binding = { positions: 'get_equity_positions' };
  assert.deepEqual(await lb.positions(), { AMD: 2, NVDA: 6 });
  assert.deepEqual(seen, [null, 'page2'], 'the second page was asked for with its cursor');
  lb.mcp = { callTool: async () => reply({ data: { positions: [{ instrument_id: 'abc', quantity: '6' }] } }) };
  await assert.rejects(lb.positions(), /no readable ticker/);
});

test('review2 #4: a lost buy reply with a lagging list never sends a second buy, even if Robinhood does not refuse a repeated key', async () => {
  const r = rig();
  r.fb.dedupeRefs = false; // the worst case: a repeated key would make a second order
  r.fb.autoFillBuys = false;
  r.fb.fail.lostReply = 1;
  r.fb.fail.hideOrders = 6;
  await loadPlan(r.st, plan(), r.ctx);
  for (let i = 0; i < 5; i += 1) { r.px(166.5); await tick(r.st, r.ctx); r.advance(16); }
  assert.equal(buys(r.fb).length, 1, 'exactly one buy');
  r.fb.fail.hideOrders = 0;
  r.fb.fill(buys(r.fb)[0].id, 6, 166.4);
  r.px(166.6);
  await tick(r.st, r.ctx);
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'PROTECTED');
  assert.equal(buys(r.fb).length, 1);
  assert.deepEqual([...r.fb.ocos.values()].map((g) => g.qty), [6]);
});

test('review2 #4: more shares in the account than the stop covers: it alarms', async () => {
  const r = rig();
  const p = await bought(r);
  r.fb.pos.NVDA = 12;
  r.advance(31); r.px(166.6);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'PROTECTED');
  assert.ok(r.kinds('alarm').some((t) => /holds 12 NVDA but the trader's stop covers only 6\. The other 6 have NO STOP/.test(t)));
});

test('review2 #5: a lost reply on a partly filled buy: the open buy is found and the rest cancelled', async () => {
  const r = rig();
  r.fb.autoFillBuys = false;
  r.fb.fail.lostReply = 1;
  r.fb.fail.hideOrders = 1; // only the first lookup misses
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  const buy = buys(r.fb)[0];
  r.fb.fill(buy.id, 2, 166.5);
  for (let i = 0; i < 4; i += 1) { r.advance(11); r.px(166.6); await tick(r.st, r.ctx); }
  assert.equal(buy.state, 'CANCELED', 'the rest of the buy was cancelled');
  assert.deepEqual([...r.fb.ocos.values()].map((g) => g.qty), [2]);
  assert.equal(r.st.plans['B-9001'].status, 'PROTECTED');
});

test('review2 #5: a partial fill found only in the shares is said at once, and a late fill alarms', async () => {
  const r = rig();
  r.fb.autoFillBuys = false;
  r.fb.fail.lostReply = 1;
  r.fb.fail.hideOrders = 3; // the order stays hidden from every lookup
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx); // unconfirmed alarm can go out here
  const buy = buys(r.fb)[0];
  r.fb.fill(buy.id, 2, 166.5);
  r.advance(5); r.px(166.6);
  await tick(r.st, r.ctx);
  assert.ok(r.kinds('alarm').some((t) => /found 2 shares.*the plan was 6/.test(t)), 'not swallowed by another alarm');
  r.fb.fail.hideOrders = 0;
  r.fb.fill(buy.id, 4, 166.5);
  r.advance(31); r.px(166.6);
  await tick(r.st, r.ctx);
  assert.ok(r.kinds('alarm').some((t) => /The other 4 have NO STOP/.test(t)));
});

test('review2 #6: a cancelled buy that reads 0 filled while the account holds shares: the shares get the stop', async () => {
  const r = rig();
  r.fb.autoFillBuys = false;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  killPlan(r.st, 'B-9001', r.ctx);
  const buy = buys(r.fb)[0];
  buy.state = 'CANCELED'; buy.filledQty = 0; r.fb.pos.NVDA = 2; // the order record is wrong
  r.advance(5); r.px(166.6);
  await tick(r.st, r.ctx);
  const p = r.st.plans['B-9001'];
  assert.notEqual(p.status, 'KILLED');
  assert.equal(p.status, 'PROTECTED');
  assert.ok(r.kinds('alarm').some((t) => /reads CANCELED with nothing filled, but the account holds 2/.test(t)));
});

test('review2 #8: a damaged or locked state file is an error, never an empty state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'autotrader-'));
  assert.equal(readJson(join(dir, 'missing.json'), 'fallback'), 'fallback');
  const bad = join(dir, 'state.json');
  writeFileSync(bad, '{"plans": {');
  assert.throws(() => readJson(bad, null), /damaged/);
});

test('review2 #9: a sell-by time after the bell, on a holiday or too close to the close is refused; one missed while closed alarms', async () => {
  const cal = { closed: new Set(['2026-11-26']), early: { '2026-11-27': '13:00' }, end: '2028-12-31' };
  const now = new Date(T0);
  const ok = (x) => validatePlan(plan({ exit_by: x }), { now, calendar: cal });
  assert.equal(ok('2026-11-12T20:50:00Z').ok, true, '15:50 ET is fine');
  assert.equal(ok('2026-11-12T20:55:00Z').ok, false, '15:55 ET is inside the last 10 minutes');
  assert.equal(ok('2026-11-12T21:10:00Z').ok, false, '16:10 ET is after the bell');
  assert.match(exitByProblem(Date.parse('2026-11-14T16:00:00Z'), cal), /not a trading day/);
  assert.match(exitByProblem(Date.parse('2026-11-27T17:55:00Z'), cal), /12:50/, 'half day closes at 13:00 ET');
  const r = rig();
  const p = await bought(r, { exit_by: '2026-11-12T20:50:00Z' });
  r.ctx.now = new Date('2026-11-12T21:01:00Z'); // the trader was off at the sell-by time
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'PROTECTED', 'the stop stays');
  assert.ok(r.kinds('alarm').some((t) => /should sell \(the sell-by time came\) but the market is closed/.test(t)));
});

test('review2 #10: a stop+target that landed with its answer lost is cancelled before the sell', async () => {
  const r = rig();
  const place = r.fb.placeOco.bind(r.fb);
  r.fb.placeOco = async (leg) => { await place(leg); return { ocoId: null }; }; // made, but no id comes back
  const find = r.fb.findOco.bind(r.fb);
  let lag = 1;
  r.fb.findOco = async (q) => (lag-- > 0 ? null : find(q)); // and the list lags once
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx); // filled, stop+target sent, no id
  r.advance(5); r.px(150); // through the stop before it is confirmed
  await tick(r.st, r.ctx);
  r.advance(5); r.px(150);
  await tick(r.st, r.ctx);
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'CLOSED');
  assert.equal(r.fb.calls.filter(([c]) => c === 'cancelOco').length, 1, 'the hidden stop+target was cancelled first');
  assert.equal(marketSells(r.fb).length, 1);
  assert.equal([...r.fb.ocos.values()].filter((g) => g.state === 'LIVE').length, 0);
});

test('review2 #13: a good code that meets a settings change at the PC still dies, and nothing acts', async () => {
  const r = rig();
  const { codes, box, io } = disk();
  let clash = 1;
  const save = io.saveCfg;
  io.saveCfg = (c) => { if (clash-- > 0) throw new Error('the trader settings changed at the PC'); save(c); };
  await handleCommand(`${loadLine(plan())} ${codes[0]}`, r.st, r.ctx, io);
  assert.equal(r.st.plans['B-9001'], undefined, 'nothing loaded');
  assert.equal(useCode(structuredClone(box.cfg.codes), codes[0]), 'used', 'the code is dead');
  assert.ok(r.said(/settings changed at the PC/));
});

test('review2 #14: a sell that went out before a crash is found by its key, not sent twice', async () => {
  const r = rig();
  r.fb.holdSells = true; // the market sell rests unfilled
  const p = await bought(r);
  sellPlan(r.st, 'B-9001', r.ctx);
  r.advance(5); r.px(168);
  await tick(r.st, r.ctx);
  assert.equal(marketSells(r.fb).length, 1);
  p.exit.orderId = null; p.exit.sentAt = null; // as if the program died during the call
  r.advance(5); r.px(168);
  await tick(r.st, r.ctx);
  assert.equal(marketSells(r.fb).length, 1, 'found, not resent');
  assert.ok(p.exit.orderId);
});

// ---- the third review of 2026-11-12: one test per probe ----------------------------------

const liveState = (o) => ['PENDING', 'PARTIALLY_FILLED'].includes(o.state);

/** A broker list that lags for NEW orders only: the ids in `hidden` are missing from findOrder (and openOrders). */
function lagNewOrders(fb, hidden, { openToo }) {
  const wrap = (name) => {
    const orig = fb[name].bind(fb);
    fb[name] = async (...a) => {
      const saved = [];
      for (const id of hidden) if (fb.orders.has(id)) { saved.push([id, fb.orders.get(id)]); fb.orders.delete(id); }
      try { return await orig(...a); } finally { for (const [id, o] of saved) fb.orders.set(id, o); }
    };
  };
  wrap('findOrder');
  if (openToo) wrap('openOrders');
}

/** Orders made by the first `n` sends join `hidden`. */
function hideFirstSends(fb, hidden, n = 1) {
  const orig = fb.placeOrder.bind(fb);
  let sends = 0;
  fb.placeOrder = async (o) => {
    const before = new Set(fb.orders.keys());
    sends += 1;
    const hide = sends <= n;
    try { return await orig(o); } finally { if (hide) for (const id of fb.orders.keys()) if (!before.has(id)) hidden.add(id); }
  };
}

/** Attempt 1: the buy rests unfilled, is cancelled after 30 s, and the plan goes back to watching. */
async function firstAttemptMissed(r) {
  r.fb.autoFillBuys = false;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  r.advance(31);
  await tick(r.st, r.ctx);
  r.advance(5);
  await tick(r.st, r.ctx);
  assert.equal(r.st.plans['B-9001'].status, 'WATCHING');
  assert.equal(r.st.plans['B-9001'].attempts, 1);
}

test('review3 A: a lost buy reply on attempt 2 is never matched to attempt 1 (a cancelled buy)', async () => {
  const r = rig();
  await firstAttemptMissed(r);
  const hidden = new Set();
  lagNewOrders(r.fb, hidden, { openToo: false });
  hideFirstSends(r.fb, hidden);
  r.fb.fail.lostReply = 1;
  r.advance(5); r.px(166.5);
  await tick(r.st, r.ctx); // attempt 2 goes out, its answer is lost, the lists lag
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'ENTERING');
  assert.notEqual(p.entry.orderId, 'ord-1', 'never the first attempt cancelled buy');
  r.advance(5); r.px(166.5);
  await tick(r.st, r.ctx); // the open orders show buy 2: it is this plan's
  assert.equal(p.status, 'ENTERING', 'not REJECTED while its own buy is live');
  const live = buys(r.fb).filter(liveState);
  assert.equal(live.length, 1);
  r.fb.fill(live[0].id, 6, 166.4);
  r.advance(31); r.px(166.6);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'PROTECTED');
  assert.deepEqual([...r.fb.ocos.values()].map((g) => g.qty), [6]);
  assert.equal(buys(r.fb).length, 2);
});

test('review3 B: the same with the open orders lagging too: no third buy, the shares get the stop', async () => {
  const r = rig();
  r.fb.dedupeRefs = false; // never lean on Robinhood refusing a repeated key
  await firstAttemptMissed(r);
  const hidden = new Set();
  lagNewOrders(r.fb, hidden, { openToo: true });
  hideFirstSends(r.fb, hidden);
  r.fb.fail.lostReply = 1;
  for (let i = 0; i < 6; i += 1) { r.advance(5); r.px(166.5); await tick(r.st, r.ctx); }
  assert.equal(buys(r.fb).length, 2, 'attempt 2 was sent once and never again');
  assert.ok(r.kinds('alarm').some((t) => /could not be confirmed/.test(t)));
  const [b2] = buys(r.fb).filter(liveState);
  r.fb.fill(b2.id, 6, 166.4);
  r.advance(5); r.px(166.6);
  await tick(r.st, r.ctx);
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'PROTECTED');
  assert.deepEqual([...r.fb.ocos.values()].map((g) => g.qty), [6]);
  assert.equal(buys(r.fb).length, 2);
});

test('review3 C: an old read of 0 from before a sell never makes one new read of 0 count as gone', async () => {
  const r = rig();
  r.fb.fail.oco = 999; r.fb.fail.stop = 999;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  const p = r.st.plans['B-9001'];
  r.fb.fail.emptyPositions = 1;
  r.advance(5); r.px(166.5);
  await tick(r.st, r.ctx); // one lagging read of 0
  r.fb.fail.sell = 999;
  r.advance(5); r.px(155);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'EXITING');
  for (let i = 0; i < 40 && p.status === 'EXITING'; i += 1) {
    if (p.exit?.retries >= 3) r.px(160);
    r.advance(5);
    await tick(r.st, r.ctx);
  }
  assert.equal(p.status, 'UNPROTECTED', 'the sell failed: the stop is being set again');
  r.fb.fail.emptyPositions = 1; // ONE lagging read, the 6 shares are really there
  r.advance(5); r.px(160);
  await tick(r.st, r.ctx);
  assert.equal(r.fb.pos.NVDA, 6);
  assert.notEqual(p.status, 'CLOSED');
  assert.ok(!r.kinds('alarm').some((t) => /did NOT sell them/.test(t)));
});

test('review3 D: a stop+target lookup that fails never blocks setting the stop', async () => {
  const r = rig();
  r.fb.fail.oco = 1;
  r.fb.findOco = async () => { throw new Error('advanced orders unreadable'); };
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx); // filled; the first stop+target send refused
  r.advance(5); r.px(166.5);
  await tick(r.st, r.ctx); // the lookup throws; the second send goes in anyway
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'PROTECTED');
  assert.equal(r.fb.ocos.size, 1);
  assert.ok(r.journal.some(([e]) => e === 'prot_lookup_error'));
});

test('review3 E: price under the stop and every sell rejected: one sell a minute, no alarm every tick', async () => {
  const r = rig();
  r.fb.fail.oco = 999; r.fb.fail.stop = 999;
  r.fb.holdSells = true;
  const orig = r.fb.placeOrder.bind(r.fb);
  r.fb.placeOrder = async (o) => {
    const res = await orig(o);
    if (o.side === 'sell' && o.type === 'market') r.fb.orders.get(res.orderId).state = 'REJECTED';
    return res;
  };
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  r.advance(5); r.px(166.5);
  await tick(r.st, r.ctx);
  const before = r.kinds('alarm').length;
  for (let i = 0; i < 12; i += 1) { r.advance(5); r.px(155); await tick(r.st, r.ctx); }
  assert.ok(r.kinds('alarm').length - before <= 3, `${r.kinds('alarm').length - before} alarms in a minute`);
  assert.equal(marketSells(r.fb).length, 1);
});

test('review3 F: a sell found after a crash does not alarm "not filled after a minute" at once', async () => {
  const r = rig();
  r.fb.holdSells = true;
  const p = await bought(r);
  sellPlan(r.st, 'B-9001', r.ctx);
  r.advance(5); r.px(168);
  await tick(r.st, r.ctx);
  p.exit.orderId = null; p.exit.sentAt = null; // died during the call
  const before = r.kinds('alarm').length;
  r.advance(5); r.px(168);
  await tick(r.st, r.ctx);
  assert.ok(!r.kinds('alarm').slice(before).some((t) => /has not filled after a minute/.test(t)));
});

test('review3 G: a sell lost after an earlier cancelled sell is never matched to the cancelled one', async () => {
  const r = rig();
  const p = await bought(r);
  r.fb.holdSells = true;
  sellPlan(r.st, 'B-9001', r.ctx);
  r.advance(5); r.px(168);
  await tick(r.st, r.ctx); // sell 1 rests
  const [s1] = marketSells(r.fb);
  s1.state = 'CANCELED'; // Robinhood cancels it, nothing filled
  const hidden = new Set();
  lagNewOrders(r.fb, hidden, { openToo: false });
  hideFirstSends(r.fb, hidden);
  r.fb.fail.lostReply = 1;
  const seen = [];
  for (let i = 0; i < 6; i += 1) { r.advance(5); r.px(168); await tick(r.st, r.ctx); seen.push(p.exit?.orderId); }
  assert.ok(!seen.includes(s1.id), 'the cancelled sell is never taken for the new one');
  assert.equal(marketSells(r.fb).filter(liveState).length, 1);
});

test('review3: a stop+target leg listed among plain orders is never taken for a plain stop', async () => {
  const r = rig();
  r.fb.fail.oco = 1;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx); // filled; the first stop+target send refused
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'UNPROTECTED');
  // A stop leg shows in the plain order list, as a stop+target order's leg can.
  r.fb.orders.set('leg-1', { id: 'leg-1', symbol: 'NVDA', side: 'sell', type: 'stop_market', qty: 6, stop: 156.1, state: 'PENDING', filledQty: 0, avgPrice: null, createdAt: r.ctx.now.toISOString() });
  r.advance(5); r.px(166.5);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'PROTECTED');
  assert.equal(p.prot.kind, 'oco');
  assert.notEqual(p.prot.id, 'leg-1');
});

test('review3: a state file that cannot be saved stops every buy, and every plan is still visited', async () => {
  const r = rig();
  await loadPlan(r.st, plan(), r.ctx);
  await loadPlan(r.st, plan({ id: 'B-9002', symbol: 'AMD' }), r.ctx);
  r.px(166.5);
  r.fb.setPrice('AMD', 166.5);
  r.ctx.save = () => { throw new Error('disk full'); };
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 0, 'no buy goes out unless its record is on disk first');
  assert.deepEqual(r.journal.filter(([e]) => e === 'save_error').map(([, d]) => d.id).sort(), ['B-9001', 'B-9002']);
  assert.ok(r.kinds('alarm').some((t) => /cannot save its state file \(disk full\)/.test(t)));
  assert.equal(r.st.plans['B-9001'].status, 'WATCHING', 'a buy that could not be written down is not half-started');
});

// ---- the fourth review of 2026-11-12: one test per probe ---------------------------------

test('review4 #1: a sale at the sell-by time that fails once is tried again within a minute, before the close', async () => {
  const r = rig();
  const p = await bought(r, { exit_by: '2026-11-12T20:40:00Z' });
  assert.equal(p.status, 'PROTECTED');
  let first = true;
  const orig = r.fb.placeOrder.bind(r.fb);
  r.fb.placeOrder = async (o) => {
    const res = await orig(o);
    if (o.side === 'sell' && o.type === 'market' && first) { first = false; r.fb.orders.get(res.orderId).state = 'REJECTED'; }
    return res;
  };
  r.fb.holdSells = true;
  r.ctx.now = new Date(Date.parse('2026-11-12T20:40:00Z'));
  r.px(170);
  await tick(r.st, r.ctx); // sell-by: cancel, sell, REJECTED, the stop goes back on
  assert.equal(p.status, 'PROTECTED');
  assert.ok(r.kinds('alarm').some((t) => /tries the sale again every minute/.test(t)));
  r.fb.holdSells = false;
  while (p.status !== 'CLOSED' && r.ctx.now.getTime() < Date.parse('2026-11-12T21:00:00Z')) { r.advance(5); r.px(170); await tick(r.st, r.ctx); }
  assert.equal(p.status, 'CLOSED');
  assert.ok(r.ctx.now.getTime() <= Date.parse('2026-11-12T20:42:00Z'), `sold at ${r.ctx.now.toISOString()}`);
  assert.equal(r.fb.pos.NVDA, 0);
  assert.equal(marketSells(r.fb).length, 2);
});

test('review4 #2: a state save that keeps failing after the fill never blocks the stop or the stop-out', async () => {
  const r = rig();
  await loadPlan(r.st, plan(), r.ctx);
  let broken = false;
  r.ctx.save = () => { if (broken) throw new Error('EPERM: rename state.json'); };
  const orig = r.fb.placeOrder.bind(r.fb);
  r.fb.placeOrder = async (o) => { const res = await orig(o); if (o.side === 'buy') broken = true; return res; };
  r.px(166.5);
  await tick(r.st, r.ctx);
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'PROTECTED', 'the stop went on although the disk refused');
  assert.equal(r.fb.ocos.size, 1);
  assert.ok(r.kinds('alarm').some((t) => /cannot save its state file/.test(t)));
  r.advance(31); r.px(150);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'CLOSED');
  assert.equal(r.fb.pos.NVDA, 0);
});

test('review4 #3: a stop signal during the last checks before a buy: no buy goes out', async () => {
  const r = rig();
  await loadPlan(r.st, plan(), r.ctx);
  r.fb.autoFillBuys = false;
  r.px(166.5);
  let halting = false;
  r.ctx.halted = () => halting;
  const origReview = r.fb.review.bind(r.fb);
  r.fb.review = async (o) => { halting = true; return origReview(o); }; // Ctrl+C lands while this call is out
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 0);
  assert.equal(r.st.plans['B-9001'].status, 'WATCHING');
});

test('review4 #4: a second SELL after a rejected one never reads the old sell as its own', async () => {
  const r = rig();
  r.fb.dedupeRefs = false;
  const p = await bought(r);
  r.fb.holdSells = true;
  const orig = r.fb.placeOrder.bind(r.fb);
  const hidden = new Set();
  let n = 0;
  r.fb.placeOrder = async (o) => {
    if (!(o.side === 'sell' && o.type === 'market')) return orig(o);
    n += 1;
    if (n === 1) { const res = await orig(o); r.fb.orders.get(res.orderId).state = 'REJECTED'; return res; }
    if (n === 2) {
      const before = new Set(r.fb.orders.keys());
      r.fb.fail.lostReply = 1;
      try { return await orig(o); } finally { for (const id of r.fb.orders.keys()) if (!before.has(id)) hidden.add(id); }
    }
    return orig(o);
  };
  lagNewOrders(r.fb, hidden, { openToo: false });
  sellPlan(r.st, 'B-9001', r.ctx);
  r.advance(5); r.px(168);
  await tick(r.st, r.ctx); // sell 1 rejected, the stop goes back on
  assert.equal(p.status, 'PROTECTED');
  const [s1] = marketSells(r.fb);
  sellPlan(r.st, 'B-9001', r.ctx);
  r.advance(5); r.px(168);
  await tick(r.st, r.ctx); // sell 2 goes out, its answer is lost, the lookups lag
  const reads = [];
  const origGet = r.fb.getOrder.bind(r.fb);
  r.fb.getOrder = async (id) => { reads.push(id); return origGet(id); };
  for (let i = 0; i < 4; i += 1) { r.advance(5); r.px(168); await tick(r.st, r.ctx); }
  assert.ok(!reads.includes(s1.id), 'the old rejected sell is never read as this exit');
  assert.equal(marketSells(r.fb).length, 2, 'sell 2 found in the open orders, no third sell');
  assert.equal(r.journal.filter(([e]) => e === 'reprotect').length, 1);
  r.fb.holdSells = false;
  r.advance(5); r.px(168);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'CLOSED');
  assert.equal(r.fb.pos.NVDA, 0);
});

test('review4 #4b: after three cancelled sells, a new SELL whose answer is lost never sends a second live sell', async () => {
  const r = rig();
  r.fb.dedupeRefs = false;
  const p = await bought(r);
  r.fb.holdSells = true;
  const orig = r.fb.placeOrder.bind(r.fb);
  const hidden = new Set();
  let n = 0;
  r.fb.placeOrder = async (o) => {
    if (!(o.side === 'sell' && o.type === 'market')) return orig(o);
    n += 1;
    if (n <= 3) { const res = await orig(o); r.fb.orders.get(res.orderId).state = 'CANCELED'; return res; }
    if (n === 4) {
      const before = new Set(r.fb.orders.keys());
      r.fb.fail.lostReply = 1;
      try { return await orig(o); } finally { for (const id of r.fb.orders.keys()) if (!before.has(id)) hidden.add(id); }
    }
    return orig(o);
  };
  lagNewOrders(r.fb, hidden, { openToo: false });
  sellPlan(r.st, 'B-9001', r.ctx);
  for (let i = 0; i < 6 && !r.journal.some(([e]) => e === 'reprotect'); i += 1) { r.advance(5); r.px(168); await tick(r.st, r.ctx); }
  assert.equal(p.status, 'PROTECTED');
  sellPlan(r.st, 'B-9001', r.ctx);
  for (let i = 0; i < 4; i += 1) { r.advance(5); r.px(168); await tick(r.st, r.ctx); }
  assert.equal(marketSells(r.fb).filter(liveState).length, 1);
});

test('review4 #5: shares that show up while WATCHING after a buy attempt are found and get the stop', async () => {
  const r = rig();
  r.fb.autoFillBuys = false;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  r.advance(31); await tick(r.st, r.ctx);
  r.advance(5); await tick(r.st, r.ctx);
  const p = r.st.plans['B-9001'];
  assert.equal(p.status, 'WATCHING');
  r.fb.pos.NVDA = 6; // the late fill shows in the account; the price stays over the ceiling
  for (let i = 0; i < 8; i += 1) { r.advance(5); r.px(168); await tick(r.st, r.ctx); }
  assert.equal(p.status, 'PROTECTED');
  assert.deepEqual([...r.fb.ocos.values()].map((g) => g.qty), [6]);
  assert.ok(r.kinds('alarm').some((t) => /showed up after an earlier buy attempt/.test(t)));
});

test('review4 #5b: a WATCHING plan with an earlier attempt never ends EXPIRED on a shares read that failed', async () => {
  const r = rig();
  r.fb.autoFillBuys = false;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  r.advance(31); await tick(r.st, r.ctx);
  r.advance(5); await tick(r.st, r.ctx);
  const p = r.st.plans['B-9001'];
  r.ctx.now = new Date(Date.parse('2026-11-12T20:30:00Z')); // the window closes
  r.fb.fail.positions = 1;
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'WATCHING', 'not ended on a read that failed');
  r.advance(5);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'EXPIRED');
});

test('review4 #6: shares from a late fill the stop never covered are named when the plan closes', async () => {
  const r = rig();
  r.fb.autoFillBuys = false;
  r.fb.fail.lostReply = 1;
  r.fb.fail.hideOrders = 3;
  await loadPlan(r.st, plan(), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx);
  const [buy] = buys(r.fb);
  r.fb.fill(buy.id, 2, 166.5);
  r.advance(5); r.px(166.6);
  await tick(r.st, r.ctx); // adopts 2
  r.fb.fail.hideOrders = 0;
  r.fb.fill(buy.id, 4, 166.5); // the rest fills late
  r.advance(31); r.px(166.6);
  await tick(r.st, r.ctx); // the extra-shares alarm
  const p = r.st.plans['B-9001'];
  r.advance(31); r.px(150);
  await tick(r.st, r.ctx); // the stop sells the 2 it covers
  assert.equal(p.status, 'CLOSED');
  assert.equal(r.fb.pos.NVDA, 4);
  assert.ok(r.kinds('alarm').some((t) => /4 more NVDA that the trader's stop never covered.*SELL 4 NVDA STOP 156\.1/.test(t)));
});

test('review4 #7: after a refused plain stop, a stop+target leg is still never taken for a plain stop', async () => {
  const r = rig();
  r.fb.fail.oco = 2; r.fb.fail.stop = 2;
  const p = await bought(r); // stop+target 1 refused
  for (let i = 0; i < 2; i += 1) { r.advance(5); r.px(166.5); await tick(r.st, r.ctx); } // stop+target 2, plain stops 1 and 2 refused
  assert.equal(p.status, 'UNPROTECTED');
  const origPlaceOco = r.fb.placeOco.bind(r.fb);
  let lost = true;
  r.fb.placeOco = async (leg) => { const res = await origPlaceOco(leg); if (lost) { lost = false; throw new Error('connection dropped'); } return res; };
  r.advance(61); r.px(166.5);
  await tick(r.st, r.ctx); // a fresh round: the stop+target lands, its answer is lost
  const [g] = [...r.fb.ocos.values()];
  r.fb.orders.set('leg-1', { id: 'leg-1', symbol: 'NVDA', side: 'sell', type: 'stop_market', qty: 6, stop: 156.1, state: 'PENDING', filledQty: 0, avgPrice: null, createdAt: r.ctx.now.toISOString() });
  const origFindOco = r.fb.findOco.bind(r.fb);
  let lag = 1;
  r.fb.findOco = async (q) => (lag-- > 0 ? null : origFindOco(q));
  r.advance(5); r.px(166.5);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'PROTECTED');
  assert.equal(p.prot.kind, 'oco');
  assert.equal(p.prot.id, g.id);
  g.state = 'TARGET_FILLED'; g.filledQty = 6; g.avgPrice = 186.6; r.fb.pos.NVDA = 0;
  r.fb.orders.get('leg-1').state = 'CANCELED';
  r.advance(31); r.px(186.6);
  await tick(r.st, r.ctx);
  assert.equal(p.status, 'CLOSED');
  assert.ok(r.kinds('closed').some((t) => /SOLD 6 NVDA at 186\.6: target hit/.test(t)));
});

// ---- the fifth review of 2026-11-12: one test per finding -------------------------------

/** Shares covered by a LIVE stop+target or a live plain stop. */
const coveredQty = (fb) => [...fb.ocos.values()].filter((g) => g.state === 'LIVE').reduce((s, g) => s + g.qty, 0)
  + sells(fb).filter((o) => o.type === 'stop_market' && liveState(o)).reduce((s, o) => s + o.qty, 0);

/** n ticks, `sec` apart, at one price. */
async function ticks(r, n, price = 168, sec = 5) {
  for (let i = 0; i < n; i += 1) { r.advance(sec); r.px(price); await tick(r.st, r.ctx); }
}

test('review5 #1: KILL after a buy attempt checks the account first; late shares get their stop, not "nothing bought"', async () => {
  const r = rig();
  await firstAttemptMissed(r);
  const p = r.st.plans['B-9001'];
  r.fb.pos.NVDA = 6; // the cancelled buy filled after all
  killPlan(r.st, 'B-9001', r.ctx);
  assert.ok(r.said(/checks the account for shares from the earlier buy attempt/));
  await ticks(r, 12, 166.5);
  assert.equal(p.status, 'PROTECTED');
  assert.equal(coveredQty(r.fb), 6);
  assert.equal(buys(r.fb).length, 1, 'no new buy after KILL');
  assert.ok(!r.said(/nothing bought/));
});

test('review5 #1b: KILL after a buy attempt with no shares ends KILLED after two empty reads, with no buy between', async () => {
  const r = rig();
  await firstAttemptMissed(r);
  const p = r.st.plans['B-9001'];
  killPlan(r.st, 'B-9001', r.ctx);
  await ticks(r, 1, 166.5); // first read of 0
  assert.equal(p.status, 'WATCHING');
  await ticks(r, 3, 166.5, 6); // 18 s later: the second read
  assert.equal(p.status, 'KILLED');
  assert.equal(buys(r.fb).length, 1);
  assert.ok(r.said(/KILLED B-9001 NVDA: stopped watching, nothing bought/));
});

test('review5 #1c: SELL after a buy attempt sells late shares instead of ending "nothing bought"', async () => {
  const r = rig();
  await firstAttemptMissed(r);
  const p = r.st.plans['B-9001'];
  r.fb.pos.NVDA = 6;
  sellPlan(r.st, 'B-9001', r.ctx);
  await ticks(r, 12);
  assert.equal(r.fb.pos.NVDA, 0);
  assert.equal(p.status, 'CLOSED');
  assert.equal(marketSells(r.fb).length, 1);
});

test('review5 #2: the last attempt (MISSED) with a shares read that lags once still finds the shares', async () => {
  const r = rig();
  await firstAttemptMissed(r);
  for (let k = 2; k <= 3; k += 1) {
    await ticks(r, 1, 166.5); // attempt k goes out and rests
    r.advance(31);
    await tick(r.st, r.ctx); // cancel -> CANCELED
    if (k === 3) { r.fb.pos.NVDA = 6; r.fb.fail.emptyPositions = 1; } // filled after all; one read lags
    r.advance(5);
    await tick(r.st, r.ctx);
  }
  const p = r.st.plans['B-9001'];
  await ticks(r, 12);
  assert.equal(p.status, 'PROTECTED');
  assert.equal(coveredQty(r.fb), 6);
  assert.ok(!r.said(/MISSED B-9001/));
});

test('review5 #2b: an attempt cancelled at valid_until with a lagging shares read still finds the shares', async () => {
  const r = rig();
  r.fb.autoFillBuys = false;
  await loadPlan(r.st, plan({ valid_until: '2026-11-12T16:00:20Z' }), r.ctx);
  r.px(166.5);
  await tick(r.st, r.ctx); // the buy goes out
  r.advance(20);
  await tick(r.st, r.ctx); // the window closes: cancel
  r.fb.pos.NVDA = 6;
  r.fb.fail.emptyPositions = 1;
  r.advance(5);
  await tick(r.st, r.ctx);
  const p = r.st.plans['B-9001'];
  await ticks(r, 12);
  assert.equal(p.status, 'PROTECTED');
  assert.equal(coveredQty(r.fb), 6);
  assert.ok(!r.said(/EXPIRED B-9001/));
});

/** A plan bought and protected, then the stop+target cancelled in the app and a market sell of `qty` left resting there. */
async function appSellResting(r, qty) {
  const p = await bought(r);
  assert.equal(p.status, 'PROTECTED');
  r.fb.holdSells = true; // a trading halt: market sells rest
  const [g] = [...r.fb.ocos.values()];
  g.state = 'CANCELED';
  r.fb.orders.set('app-1', { id: 'app-1', symbol: 'NVDA', side: 'sell', type: 'market', qty, state: 'PENDING', filledQty: 0, avgPrice: null, createdAt: r.ctx.now.toISOString() });
  sellPlan(r.st, 'B-9001', r.ctx);
  await ticks(r, 2); // the exit starts; the open-orders check takes app-1
  assert.equal(p.exit?.orderId, 'app-1');
  return p;
}

test('review5 #3: a smaller sell taken from the open orders fills, and the trader sells the rest', async () => {
  const r = rig();
  const p = await appSellResting(r, 2);
  r.fb.holdSells = false; // the halt lifts: the 2 fill
  await ticks(r, 6);
  assert.equal(p.status, 'CLOSED');
  assert.equal(r.fb.pos.NVDA, 0);
  const mine = marketSells(r.fb).filter((o) => o.id !== 'app-1');
  assert.deepEqual(mine.map((o) => o.qty), [4]);
});

test('review5 #3b: a sell taken from the open orders starts its own one-minute clock', async () => {
  const r = rig();
  await appSellResting(r, 6);
  assert.ok(!r.kinds('alarm').some((t) => /has not filled after a minute/.test(t)), 'no "after a minute" alarm seconds in');
  await ticks(r, 13); // 65 s still resting
  assert.ok(r.kinds('alarm').some((t) => /has not filled after a minute/.test(t)));
});

test('review5 #4: a save that fails as the buy is about to go out spends no attempt; the buy goes once the disk works', async () => {
  const r = rig();
  await loadPlan(r.st, plan(), r.ctx);
  let n = 0;
  r.ctx.save = () => { n += 1; if (n % 2 === 0) throw new Error('EPERM: rename state.json'); }; // 1st save of a tick lands, 2nd fails
  const p = r.st.plans['B-9001'];
  for (let i = 0; i < 20; i += 1) { n = 0; r.advance(5); r.px(166.5); await tick(r.st, r.ctx); }
  assert.equal(p.status, 'WATCHING');
  assert.equal(p.attempts, 0);
  assert.equal(buys(r.fb).length, 0);
  r.ctx.save = () => {};
  await ticks(r, 1, 166.5);
  assert.equal(buys(r.fb).length, 1);
  assert.equal(p.status, 'PROTECTED');
});

test('review5 #5: LOAD whose save fails is still LOADED (not "not handled"), and buys once the disk works', async () => {
  const r = rig();
  const { codes, io } = disk();
  let broken = true;
  r.ctx.save = () => { if (broken) throw new Error('EPERM: rename state.json'); };
  await handleCommand(`${loadLine(plan())} ${codes[0]}`, r.st, r.ctx, io); // must not throw
  assert.equal(r.st.plans['B-9001'].status, 'WATCHING');
  assert.ok(r.journal.some(([e, d]) => e === 'save_error' && d.soft));
  r.px(166.5);
  await tick(r.st, r.ctx);
  assert.equal(buys(r.fb).length, 0, 'no buy while its record cannot be saved (rule 4)');
  broken = false;
  await ticks(r, 1, 166.5);
  assert.equal(buys(r.fb).length, 1);
});

/** A SELL at 15:59:52 ET whose stop cancel is accepted but has not landed by the bell. */
async function cancelInFlightAtBell(r) {
  const p = await bought(r);
  const realCancel = r.fb.cancelOco.bind(r.fb);
  r.fb.cancelOco = async (id) => { r.fb.calls.push(['cancelOco', id]); }; // accepted, not done yet
  r.ctx.now = new Date(Date.parse('2026-11-12T20:59:52Z'));
  sellPlan(r.st, 'B-9001', r.ctx);
  await ticks(r, 1, 170); // 15:59:57: the exit starts and the cancel goes out
  assert.equal(p.status, 'EXITING');
  assert.equal(p.exit.step, 'cancel');
  return { p, g: [...r.fb.ocos.values()][0], realCancel };
}

test('review5 #6a: the stop cancel lands just as the bell rings: the stop goes back on for the night, the sale goes at the open', async () => {
  const r = rig();
  const { p, g, realCancel } = await cancelInFlightAtBell(r);
  g.state = 'CANCELED'; // the cancel lands
  await ticks(r, 3, 170); // 16:00:02 on
  assert.equal(p.status, 'PROTECTED');
  assert.equal(coveredQty(r.fb), 6);
  assert.equal(marketSells(r.fb).length, 0, 'no market sell after the bell');
  assert.ok(r.kinds('alarm').some((t) => /the market closed before the sale was done.*setting the stop again for the night.*The sale \(you sent SELL\) goes out at the next open/.test(t)));
  assert.ok(!r.kinds('alarm').some((t) => /but the market is closed/.test(t)), 'one message, not two');
  // The next open: the SELL goes through without a new SELL.
  r.fb.cancelOco = realCancel;
  r.ctx.now = new Date(Date.parse('2026-11-13T14:30:00Z')); // Fri 09:30 ET
  await ticks(r, 3, 171);
  assert.equal(p.status, 'CLOSED');
  assert.equal(r.fb.pos.NVDA, 0);
});

test('review5 #6a-2: the stop cancel has not landed at the bell: the stop is still on; if it lands later a new stop goes on', async () => {
  const r = rig();
  const { p, g } = await cancelInFlightAtBell(r);
  await ticks(r, 1, 170); // 16:00:02, the stop still reads live
  assert.equal(p.status, 'PROTECTED');
  assert.equal(p.prot.id, g.id);
  assert.ok(r.kinds('alarm').some((t) => /the market closed before the sale was done.*the stop is still on/.test(t)));
  g.state = 'CANCELED'; // the old cancel lands after the bell
  await ticks(r, 10, 170);
  assert.equal(p.status, 'PROTECTED');
  assert.notEqual(p.prot.id, g.id);
  assert.equal(coveredQty(r.fb), 6);
  assert.equal(marketSells(r.fb).length, 0);
});

test('review5 #6b: a sell resting at the bell is read: rejected, the stop goes back on; it is never sent twice', async () => {
  const r = rig();
  const p = await bought(r);
  r.fb.holdSells = true;
  r.ctx.now = new Date(Date.parse('2026-11-12T20:59:45Z'));
  sellPlan(r.st, 'B-9001', r.ctx);
  await ticks(r, 3, 170); // cancel the stop, send the sell (it rests)
  assert.equal(marketSells(r.fb).length, 1);
  const [s] = marketSells(r.fb);
  await ticks(r, 2, 170); // 16:00:00 on: still resting, the trader waits
  assert.equal(p.status, 'EXITING');
  s.state = 'REJECTED';
  await ticks(r, 4, 170);
  assert.equal(p.status, 'PROTECTED');
  assert.equal(coveredQty(r.fb), 6);
  assert.equal(marketSells(r.fb).length, 1, 'never a second sell after the bell');
  assert.ok(r.kinds('alarm').some((t) => /Robinhood rejected the sell.*Send SELL B-9001/.test(t)), 'a rejected sell needs a new SELL');
});

test('review5 #6c: a sell that fills part then is cancelled at the bell: the rest gets the stop', async () => {
  const r = rig();
  const p = await bought(r);
  r.fb.holdSells = true;
  r.ctx.now = new Date(Date.parse('2026-11-12T20:59:45Z'));
  sellPlan(r.st, 'B-9001', r.ctx);
  await ticks(r, 3, 170);
  const [s] = marketSells(r.fb);
  r.fb.fill(s.id, 2, 170);
  await ticks(r, 2, 170);
  s.state = 'CANCELED';
  await ticks(r, 4, 170);
  assert.equal(p.status, 'PROTECTED');
  assert.equal(r.fb.pos.NVDA, 4);
  assert.equal(coveredQty(r.fb), 4);
  // The rest sells at the next open.
  r.fb.holdSells = false;
  r.ctx.now = new Date(Date.parse('2026-11-13T14:30:00Z'));
  await ticks(r, 3, 171);
  assert.equal(p.status, 'CLOSED');
  assert.equal(r.fb.pos.NVDA, 0);
  assert.equal(marketSells(r.fb).length, 2);
});

test('review5 #6d: a sell-by sale that keeps failing is retried until 15:55 ET, never after; the stop is on at the bell', async () => {
  const r = rig();
  const p = await bought(r, { exit_by: '2026-11-12T20:50:00Z' }); // 15:50 ET, the latest a plan allows
  r.fb.fail.sell = 999; // every market sell is refused
  r.ctx.now = new Date(Date.parse('2026-11-12T20:49:55Z'));
  const starts = [];
  for (let i = 0; i < 150; i += 1) { // to 16:02:25 ET
    const n = r.journal.length;
    await ticks(r, 1, 170);
    if (r.journal.slice(n).some(([e]) => e === 'exit_start')) starts.push(r.ctx.now.toISOString());
  }
  assert.ok(starts.length >= 2, `it tried again (${starts.length} starts)`);
  assert.ok(starts.every((t) => t < '2026-11-12T20:55:00Z'), `an exit started at ${starts.at(-1)}`);
  assert.equal(marketSells(r.fb).length, 0);
  assert.equal(p.status, 'PROTECTED');
  assert.equal(coveredQty(r.fb), 6);
});

// The trader reads no quotes with the market closed, so no price exit can start; this guards that
// end to end (if quotes are ever read after hours, the exit/bell loop would show up here).
test('review5 #6e: shares with no stop after the bell and the price under the stop: the stop goes on, no sale loop', async () => {
  const r = rig();
  const p = await bought(r);
  r.ctx.now = new Date(Date.parse('2026-11-12T21:00:05Z')); // 16:00:05 ET
  r.fb.fail.oco = 999; // so the stop is a plain one (the simulator fills a stop+target under the stop at once)
  [...r.fb.ocos.values()][0].state = 'CANCELED'; // the stop was cancelled in the app
  r.fb.setPrice('NVDA', 150); // after hours, under the stop
  r.fb.match = () => {}; // and nothing fills after hours
  await ticks(r, 8, 150, 5);
  assert.equal(marketSells(r.fb).length, 0);
  assert.equal(p.status, 'PROTECTED');
  assert.equal(coveredQty(r.fb), 6);
  assert.ok(!r.journal.some(([e]) => e === 'exit_start'), 'no sale started with the market closed');
});

test('review5 #7: a plain stop whose read-back fails is found again by its id, not placed twice', async () => {
  const r = rig();
  r.fb.fail.oco = 999; // the stop+target is refused: a plain stop protects
  r.fb.dupRefThrows = true;
  // The order list does not show keys: a key lookup finds nothing.
  const origFind = r.fb.findOrder.bind(r.fb);
  r.fb.findOrder = async (q) => origFind({ ...q, refId: undefined, refIds: q.refIds ? ['(not listed)'] : undefined });
  // The read-back right after the stop is placed fails once.
  const origPlace = r.fb.placeOrder.bind(r.fb);
  const origGet = r.fb.getOrder.bind(r.fb);
  let blip = false;
  let blips = 1;
  r.fb.placeOrder = async (o) => {
    const res = await origPlace(o);
    if (o.type === 'stop_market' && blips > 0) { blips -= 1; blip = true; }
    return res;
  };
  r.fb.getOrder = async (id) => { if (blip) { blip = false; throw new Error('orders read timed out'); } return origGet(id); };
  const p = await bought(r);
  await ticks(r, 20, 166.5);
  const stops = sells(r.fb).filter((o) => o.type === 'stop_market');
  assert.equal(stops.length, 1, 'one plain stop, never a second');
  assert.equal(p.status, 'PROTECTED');
  assert.equal(p.prot.id, stops[0].id);
  // One "not set" alarm for the tick it truly could not confirm it, then "SET" once it is found.
  assert.ok(r.kinds('alarm').filter((t) => /THE STOP IS NOT SET/.test(t)).length <= 1);
  assert.ok(r.said(/Stop 156\.1 is SET at Robinhood/));
});

test('review5 extra: shares that cannot be read during a sale alarm NO STOP, and after 3 tries it sells what it bought', async () => {
  const r = rig();
  const p = await bought(r);
  r.fb.fail.positions = 99;
  sellPlan(r.st, 'B-9001', r.ctx);
  await ticks(r, 2); // start + cancel the stop + read 1 fails; read 2 fails
  assert.ok(r.kinds('alarm').some((t) => /cannot be read.*6 NVDA have NO STOP until the sale goes through/.test(t)));
  assert.equal(marketSells(r.fb).length, 0);
  await ticks(r, 1); // read 3 fails: it sells what it bought
  assert.equal(marketSells(r.fb).length, 1);
  assert.equal(marketSells(r.fb)[0].qty, 6);
  assert.equal(p.status, 'CLOSED');
});

test('review5 #8: a lock file that cannot be read (held by antivirus) stops a second trader; a half-written old one is cleared', () => {
  const dir = mkdtempSync(join(tmpdir(), 'autotrader-lock-'));
  const lock = join(dir, 'run.lock');
  writeFileSync(lock, JSON.stringify({ pid: 4242, at: '2026-11-12T15:00:00Z' }));
  const old = new Date(Date.now() - 3600_000);
  utimesSync(lock, old, old);
  let fails = 1;
  const heldRead = (p, f) => { if (fails-- > 0) throw new Error(`could not read ${p} (EBUSY)`); return readJson(p, f); };
  const opts = { lock, alive: (pid) => pid === 4242, pid: 9999, onExit: () => {} };
  assert.throws(() => takeLock({ ...opts, read: heldRead }), /EBUSY/);
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, 4242, 'the running trader keeps its lock');
  // A half-written lock: brand new is refused, an hour old is cleared and taken.
  writeFileSync(lock, '{"pid":');
  assert.throws(() => takeLock(opts), /brand new/);
  utimesSync(lock, old, old);
  takeLock(opts);
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, 9999);
});
