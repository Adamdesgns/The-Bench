import test from 'node:test';
import assert from 'node:assert/strict';

import { planStackTickets, nextLevel, planText } from '../scripts/stack-ticket.mjs';
import { buildTicket } from '../scripts/executor-ticket.mjs';
import { validateRealHandoff } from '../scripts/executor-validate.mjs';

const lv = (...ps) => ps.map((price) => ({ price, kind: 'pivot low', date: '2025-01-01' }));
const db = {
  schema: 1,
  names: {
    NVDA: { sym: 'NVDA', row: 'B-1388', levels: lv(151.49, 142.03, 132.92) },
    GOOGL: { sym: 'GOOGL', row: 'B-1396', levels: lv(275.19, 244.15, 196.6) },
    SPCX: { sym: 'SPCX', row: 'B-1397', levels: lv(130.39, 107.01) },
    NOROW: { sym: 'NOROW', row: null, levels: lv(10) },
  },
};
const byName = (plan) => Object.fromEntries(plan.lines.map((l) => [l.sym, l]));

test('nextLevel takes the highest level under the price, and the one below it', () => {
  assert.deepEqual(nextLevel(db.names.NVDA, 169.3), { level: 151.49, lower: 142.03 });
  assert.deepEqual(nextLevel(db.names.NVDA, 145), { level: 142.03, lower: 132.92 });
  assert.equal(nextLevel(db.names.SPCX, 100), null);
});

test('today: every name is far from its level, so nothing is ticketed', () => {
  const plan = planStackTickets({ db, names: ['NVDA', 'GOOGL', 'SPCX'], prices: { NVDA: 169.3, GOOGL: 288, SPCX: 141.8 }, cash: 200 });
  const m = byName(plan);
  assert.equal(m.NVDA.status, 'FAR');
  assert.equal(m.SPCX.status, 'FAR');
  assert.equal(m.GOOGL.status, 'NO_FIT'); // 4.45% away, but one share is over the $200 limit
  assert.equal(plan.cashLeft, 200);
});

test('a near name that fits gets one whole share at the level, conditional, with a 1% drift', () => {
  const plan = planStackTickets({ db, names: ['SPCX'], prices: { SPCX: 134 }, cash: 200 });
  const s = byName(plan).SPCX;
  assert.equal(s.status, 'TICKET');
  assert.equal(s.shares, 1);
  assert.equal(s.limit, 130.39);
  assert.equal(s.when, 'below:130.39');
  assert.equal(s.stop, 107.01);
  assert.equal(s.drift, '$1.30');
  assert.equal(plan.cashLeft, 69.61);
});

test('cash goes to the nearest name first; the next one is refused for cash, not skipped silently', () => {
  const plan = planStackTickets({ db, names: ['NVDA', 'SPCX'], prices: { NVDA: 155, SPCX: 132 }, cash: 200 });
  const m = byName(plan);
  assert.equal(plan.lines[0].sym, 'SPCX'); // 1.22% away vs NVDA 2.26%
  assert.equal(m.SPCX.status, 'TICKET');
  assert.equal(m.NVDA.status, 'NO_CASH');
  assert.match(m.NVDA.note, /69\.61 cash left/);
});

test('no lower level falls back to a 15% thesis-check line under the level', () => {
  const one = { names: { X: { sym: 'X', row: 'B-1', levels: lv(50) } } };
  const x = byName(planStackTickets({ db: one, names: ['X'], prices: { X: 51 }, cash: 200 })).X;
  assert.equal(x.status, 'TICKET');
  assert.equal(x.stop, 42.5);
});

test('missing data refuses by name instead of guessing', () => {
  const m = byName(planStackTickets({ db, names: ['NOROW', 'ZZZ', 'NVDA'], prices: {}, cash: 200 }));
  assert.equal(m.NOROW.status, 'NO_ROW');
  assert.equal(m.ZZZ.status, 'NOT_ON_LANE');
  assert.equal(m.NVDA.status, 'NO_PRICE');
});

test('price under every stored level is NO_LEVEL, never a buy at a level above the market', () => {
  const s = byName(planStackTickets({ db, names: ['SPCX'], prices: { SPCX: 100 }, cash: 200 })).SPCX;
  assert.equal(s.status, 'NO_LEVEL');
});

test('a planned ticket passes the real-order contract the executor enforces', () => {
  const plan = planStackTickets({ db, names: ['SPCX'], prices: { SPCX: 134 }, cash: 200 });
  const s = byName(plan).SPCX;
  const now = new Date('2026-11-10T15:00:00Z'); // Tuesday, mid-session
  const h = buildTicket({ row: s.row, ticker: s.sym, shares: s.shares, limit: s.limit, stop: s.stop, drift: s.drift, when: s.when, now });
  const check = validateRealHandoff(h, { now });
  // No receipts dir offline, so the test-order gate is not consulted: the ticket's own terms must pass clean.
  assert.deepEqual(check.refusals, []);
});

test('planText prints one line per name and the cash left', () => {
  const t = planText(planStackTickets({ db, names: ['SPCX', 'NVDA'], prices: { SPCX: 134, NVDA: 169.3 }, cash: 200 }));
  assert.match(t, /SPCX\s+TICKET\s+buy 1 at 130\.39/);
  assert.match(t, /NVDA\s+FAR/);
  assert.match(t, /cash left after tickets: \$69\.61/);
});
