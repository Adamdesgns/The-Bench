// executor-app.test.mjs — offline tests for the executor PROGRAM layer.
// Everything here runs with fakes: no network, no TTY, no broker. The live
// path is covered by the authorized tests in docs/executor-test-protocol.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseRpcBody } from '../executor/lib/mcp.mjs';
import { stateOf } from '../executor/lib/arm.mjs';
import {
  Broker, normalizeState, unwrapToolResult, findNumberByKey,
  collectAccounts, collectOrders, collectPositions, assertParsed,
  REQUIRED_CAPABILITIES,
} from '../executor/lib/broker.mjs';
import { Receipt } from '../executor/lib/receipts.mjs';
import {
  authorizationLine, confirmLine, computeOrderShares, reconcileRisk,
  parseDriftBound, unmarketableEnough, hasCompletedTestZero,
  matchesOrderDetails, identifyOrder, filledQuantityOf, PreflightError,
} from '../executor/executor.mjs';
import { validateHandoff } from '../scripts/executor-validate.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'bench-exec-app-'));

function handoff(overrides = {}) {
  const created = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  return {
    schema_version: 'bench-execution-handoff-v1',
    plan_id: `B-138:${created}`,
    row_id: 'B-138',
    framework_version: 'v26',
    executor_version: 'bench-executor-v1',
    created_at: created,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    account_alias: 'AGENTIC-7724',
    asset_class: 'equity',
    ticker: 'TEST',
    action: 'BUY',
    lane: 'base_swing',
    structure: 'long_shares',
    quantity_mode: 'notional',
    quantity_value: 4.5,
    order_type: 'LIMIT',
    limit_price: 2.0,
    time_in_force: 'DAY',
    session: 'REGULAR_HOURS_ONLY',
    invalidation_price: 1.5,
    planned_dollar_risk: 4.0,
    executor_absolute_ceiling: 5.0,
    maximum_price_drift: '$100',
    exit_owner: 'MANUAL',
    concentrated: false,
    leveraged_product: false,
    conviction_bet: false,
    ...overrides,
  };
}

// ---- arm switch ------------------------------------------------------------

test('arm: no message / non-ARM message / expired window all read OFF', () => {
  const now = Date.now();
  assert.equal(stateOf(null, now).state, 'OFF');
  assert.equal(stateOf({ message: 'HALT', time: now / 1000 }, now).state, 'OFF');
  const fiveHoursAgo = now / 1000 - 5 * 3600;
  assert.equal(stateOf({ message: 'ARM B-200 window 4h', time: fiveHoursAgo }, now).state, 'OFF');
});

test('arm: fresh ARM reads ARMED with the row', () => {
  const now = Date.now();
  const s = stateOf({ message: 'ARM B-200 window 4h - one placement only', time: now / 1000 - 60 }, now);
  assert.equal(s.state, 'ARMED');
  assert.equal(s.row, 'B-200');
});

// ---- MCP body parsing ------------------------------------------------------

test('mcp: parses plain JSON and SSE bodies, rejects mismatched ids', () => {
  const rpc = { jsonrpc: '2.0', id: 7, result: { ok: true } };
  assert.deepEqual(parseRpcBody(JSON.stringify(rpc), 7).result, { ok: true });
  assert.equal(parseRpcBody(JSON.stringify(rpc), 8), null);
  const sse = `event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"tools":[]}}\n\n`;
  assert.deepEqual(parseRpcBody(sse, 3).result, { tools: [] });
  assert.equal(parseRpcBody('', 1), null);
});

// ---- broker layer ----------------------------------------------------------

test('broker: binding refuses when any required tool is missing', () => {
  const broker = new Broker({});
  const allButPlace = Object.values(REQUIRED_CAPABILITIES).filter((n) => n !== 'place_equity_order');
  assert.throws(
    () => broker.bind(allButPlace.map((name) => ({ name }))),
    /missing capabilities: place/
  );
});

test('broker: unbound capability is denied by default; extra server tools are unreachable', async () => {
  const calls = [];
  const fakeMcp = { callTool: async (name) => { calls.push(name); return { content: [{ type: 'text', text: '{}' }] }; } };
  const broker = new Broker(fakeMcp);
  broker.bind([
    ...Object.values(REQUIRED_CAPABILITIES).map((name) => ({ name })),
    { name: 'place_option_order' }, // present on the server, never in the binding
  ]);
  await broker.call('quotes', { symbols: ['TEST'] });
  assert.deepEqual(calls, ['get_equity_quotes']);
  await assert.rejects(broker.call('options', {}), /denied by default/);
});

test('broker: isError tool results throw, never read as success', () => {
  assert.throws(
    () => unwrapToolResult({ isError: true, content: [{ type: 'text', text: 'account not agentic' }] }, 'place_equity_order'),
    /tool error/
  );
  assert.deepEqual(unwrapToolResult({ content: [{ type: 'text', text: '{"a":1}' }] }, 'x'), { a: 1 });
  assert.deepEqual(unwrapToolResult({ content: [{ type: 'text', text: 'not json' }] }, 'x'), { _unparsed: 'not json' });
});

test('broker: assertParsed refuses _unparsed payloads at conflict gates', () => {
  assert.throws(() => assertParsed({ _unparsed: 'some html' }, 'positions'), /fail closed/);
  assert.deepEqual(assertParsed({ results: [] }, 'positions'), { results: [] });
});

test('broker: schema-overlay states map to PENDING; voided stays fail-closed', () => {
  assert.equal(normalizeState({ state: 'new' }), 'PENDING');
  assert.equal(normalizeState({ state: 'confirmed' }), 'PENDING');
  assert.equal(normalizeState({ state: 'unconfirmed' }), 'PENDING');
  assert.equal(normalizeState({ state: 'filled' }), 'FILLED');
  assert.equal(normalizeState({ state: 'cancelled' }), 'CANCELED');
  assert.equal(normalizeState({ state: 'voided' }), 'UNKNOWN_REQUIRES_RECONCILIATION');
  assert.equal(normalizeState({ state: 'anything_else' }), 'UNKNOWN_REQUIRES_RECONCILIATION');
});

test('broker: deep finders locate accounts, orders, positions, and numbers', () => {
  const payload = {
    accounts: [
      { account_number: '00000000', agentic_allowed: false },
      { account_number: 'X1117724', agentic_allowed: true },
    ],
    portfolio: { totals: { buying_power: '8.42' } },
    orders: [{ id: 'abc-123', state: 'queued', ref_id: 'r-1' }],
    positions: [{ symbol: 'test', quantity: '2' }],
  };
  const agentic = collectAccounts(payload).filter((a) => a.agentic_allowed === true);
  assert.equal(agentic.length, 1);
  assert.equal(findNumberByKey(payload, ['buying_power']).value, 8.42);
  assert.equal(collectOrders(payload)[0].id, 'abc-123');
  assert.deepEqual(collectPositions(payload), [{ symbol: 'TEST', quantity: 2 }]);
});

// ---- receipts --------------------------------------------------------------

test('receipts: transitions persist durably and a duplicate plan_id refuses', () => {
  const dir = tmp();
  const h = handoff();
  const r = new Receipt(dir, h, { mode: 'test-zero', commit: 'deadbee' });
  r.transition('REVIEWED', 'x');
  r.addRaw('some-raw-file.json');
  const onDisk = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8'));
  assert.equal(onDisk.state, 'REVIEWED');
  assert.equal(onDisk.transitions.length, 2); // RECEIVED + REVIEWED
  assert.deepEqual(onDisk.raw_archive, ['some-raw-file.json']);
  assert.throws(() => new Receipt(dir, h, { mode: 'test-zero', commit: 'deadbee' }), /refused/);
  // …and the contract validator sees the same receipt as a duplicate:
  const res = validateHandoff(h, { receiptsDir: dir });
  assert.ok(res.refusals.some((x) => x.code === 'R03_DUPLICATE_PLAN_ID'));
});

test('receipts: never contain a full account number field', () => {
  const dir = tmp();
  const r = new Receipt(dir, handoff(), { mode: 'test-zero', commit: 'deadbee' });
  const text = JSON.stringify(r.data);
  assert.ok(!/\d{9,}/.test(text), 'no long digit runs in receipts');
  assert.equal(r.data.account_alias, 'AGENTIC-7724');
});

// ---- order math + guards ---------------------------------------------------

test('order math: notional floors to whole shares; sub-1-share refuses; ceiling holds', () => {
  assert.deepEqual(computeOrderShares(handoff()), { shares: 2, notional: 4.0 });
  assert.throws(() => computeOrderShares(handoff({ limit_price: 6.0, invalidation_price: 5.0 })), PreflightError);
  assert.throws(
    () => computeOrderShares(handoff({ quantity_mode: 'shares', quantity_value: 1.5 })),
    /whole shares/
  );
  assert.throws(
    () => computeOrderShares(handoff({ quantity_mode: 'shares', quantity_value: 3, limit_price: 2.0 })),
    /exceeds effective ceiling/
  );
});

test('risk arithmetic (§6.8): MANUAL demands risk ≥ notional; stop-based must reconcile within 10%', () => {
  // MANUAL: planned 4.0 ≥ notional 4.0 passes; understating refuses.
  assert.ok(reconcileRisk(handoff(), 2, 4.0).basis.includes('MANUAL'));
  assert.throws(() => reconcileRisk(handoff({ planned_dollar_risk: 1.0 }), 2, 4.0), /full notional/);
  // Stop-based: 2 × (2.00 − 1.50) = $1.00 reconciles; a wild claim refuses.
  const stopBased = handoff({ exit_owner: 'SEPARATE_STOP_ORDER', planned_dollar_risk: 1.0 });
  assert.ok(reconcileRisk(stopBased, 2, 4.0).basis.includes('reconciles'));
  assert.throws(
    () => reconcileRisk(handoff({ exit_owner: 'SEPARATE_STOP_ORDER', planned_dollar_risk: 3.0 }), 2, 4.0),
    /does not reconcile/
  );
  // SELL_TO_CLOSE: nothing to reconcile.
  assert.ok(reconcileRisk(handoff({ action: 'SELL_TO_CLOSE' }), 2, 4.0).basis.includes('SELL_TO_CLOSE'));
});

test('guards: drift bounds parse; unmarketable check is direction-aware', () => {
  assert.equal(parseDriftBound('$0.25', 20), 0.25);
  assert.equal(parseDriftBound('5%', 20), 1);
  assert.equal(parseDriftBound(0.5, 20), 0.5);
  assert.ok(unmarketableEnough('BUY', 2.0, 30.0));
  assert.ok(!unmarketableEnough('BUY', 20.0, 30.0));
  // A SELL at half the tape is maximally MARKETABLE — must refuse.
  assert.ok(!unmarketableEnough('SELL_TO_CLOSE', 2.0, 30.0));
  assert.ok(unmarketableEnough('SELL_TO_CLOSE', 50.0, 30.0));
  assert.ok(!unmarketableEnough('BUY', 2.0, NaN));
});

test('typed lines: authorization and confirm strings are exact and unambiguous', () => {
  assert.equal(authorizationLine('test-zero', 'ac134bd'), 'AUTHORIZE TEST-ZERO ac134bd ceiling $5');
  assert.equal(authorizationLine('test-one', 'ac134bd'), 'AUTHORIZE TEST-ONE ac134bd ceiling $5');
  assert.equal(confirmLine('B-138:t', 'rev-9', 4), 'CONFIRM B-138:t rev-9 $4.00');
});

test('sequencing: test one stays locked until a CLEAN test-zero receipt exists', () => {
  const dir = tmp();
  assert.equal(hasCompletedTestZero(dir), false);
  writeFileSync(join(dir, 'a.json'), JSON.stringify({ mode: 'test-zero', state: 'REJECTED' }));
  assert.equal(hasCompletedTestZero(dir), false);
  // Canceled but with a partial fill: cancellation path worked, run is NOT clean.
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ mode: 'test-zero', state: 'CANCELED', final_filled_quantity: 1 }));
  assert.equal(hasCompletedTestZero(dir), false);
  writeFileSync(join(dir, 'c.json'), JSON.stringify({ mode: 'test-zero', state: 'CANCELED', final_filled_quantity: 0 }));
  assert.equal(hasCompletedTestZero(dir), true);
});

// ---- order identification --------------------------------------------------

test('order matching: symbol/quantity/limit must agree; empty objects never match', () => {
  const h = handoff();
  assert.ok(matchesOrderDetails({ symbol: 'TEST', quantity: '2', limit_price: '2.00' }, h, 2));
  assert.ok(!matchesOrderDetails({ symbol: 'OTHER', quantity: '2' }, h, 2));
  assert.ok(!matchesOrderDetails({ symbol: 'TEST', quantity: '5' }, h, 2));
  assert.ok(!matchesOrderDetails({}, h, 2));
});

test('identifyOrder: ref_id wins; details-only match must be UNIQUE and OPEN', () => {
  const h = handoff();
  const live = { id: 'live-1', state: 'queued', symbol: 'TEST', quantity: '2', limit_price: '2.00' };
  const staleTwin = { id: 'old-1', state: 'cancelled', symbol: 'TEST', quantity: '2', limit_price: '2.00' };
  const withRef = { ...live, ref_id: 'my-ref' };

  // ref_id match is authoritative even among twins.
  assert.equal(identifyOrder([staleTwin, withRef], 'my-ref', h, 2).order.id, 'live-1');
  // No ref_id anywhere: a stale TERMINAL twin is never adopted…
  assert.equal(identifyOrder([staleTwin, live], 'my-ref', h, 2).order.id, 'live-1');
  // …and two OPEN twins are ambiguous → null (reconcile, don't guess).
  const secondOpen = { ...live, id: 'live-2' };
  assert.equal(identifyOrder([live, secondOpen], 'my-ref', h, 2), null);
  // Nothing matching at all → null.
  assert.equal(identifyOrder([staleTwin], 'my-ref', h, 2), null);
});

test('filled quantity: recognized keys are read, absent keys return null', () => {
  assert.equal(filledQuantityOf({ cumulative_quantity: '1' }), 1);
  assert.equal(filledQuantityOf({ nested: { filled_quantity: 2 } }), 2);
  assert.equal(filledQuantityOf({ state: 'cancelled' }), null);
});
