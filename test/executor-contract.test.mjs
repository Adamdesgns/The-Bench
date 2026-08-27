// executor-contract.test.mjs — offline refusal matrix for bench-executor-v1 (npm test)
// Every case maps to docs/executor-test-protocol.md §Offline test matrix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateHandoff, normalizeBrokerState, placementDecisionAfter,
  AUTOMATIC_RETRY_ALLOWED, HARD_TEST_CEILING_USD, RECEIPT_STATES, sanitizePlanId,
} from '../scripts/executor-validate.mjs';

const FIXTURES = new URL('../executor-tests/redacted-fixtures/', import.meta.url);
const loadFixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'));

function control(overrides = {}) {
  const created = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return {
    schema_version: 'bench-execution-handoff-v1',
    plan_id: `B-138:${created}`,
    row_id: 'B-138',
    framework_version: 'v26',
    executor_version: 'bench-executor-v1',
    created_at: created,
    expires_at: expires,
    account_alias: 'AGENTIC-7724',
    asset_class: 'equity',
    ticker: 'TEST',
    action: 'BUY',
    lane: 'base_swing',
    structure: 'long_shares',
    quantity_mode: 'notional',
    quantity_value: 4.5,
    order_type: 'LIMIT',
    limit_price: 22.1,
    time_in_force: 'DAY',
    session: 'REGULAR_HOURS_ONLY',
    invalidation_price: 21.1,
    planned_dollar_risk: 1.0,
    executor_absolute_ceiling: 5.0,
    maximum_price_drift: '$0.25',
    exit_owner: 'MANUAL',
    concentrated: false,
    leveraged_product: false,
    conviction_bet: false,
    ...overrides,
  };
}

const codes = (res) => res.refusals.map((r) => r.code);
const refusesWith = (h, code, opts) => {
  const res = validateHandoff(h, opts);
  assert.equal(res.ok, false, `expected refusal, got pass`);
  assert.ok(codes(res).includes(code), `expected ${code}, got: ${codes(res).join(', ') || '(none)'}`);
};

test('0. valid control passes every contract gate', () => {
  const res = validateHandoff(control());
  assert.deepEqual(res.refusals, []);
  assert.equal(res.ok, true);
});

test('0b. SELL_TO_CLOSE with invalidation N/A passes the contract layer', () => {
  const res = validateHandoff(control({ action: 'SELL_TO_CLOSE', invalidation_price: 'N/A' }));
  assert.equal(res.ok, true, codes(res).join(', '));
});

test('1. missing required field refuses — never inferred', () => {
  const h = control(); delete h.ticker;
  refusesWith(h, 'R01_MISSING_FIELD');
});

test('2. Pending Archive ID refuses', () => {
  refusesWith(control({ row_id: 'Pending Archive ID' }), 'R02_PENDING_ROW_ID');
});

test('3. duplicate plan_id in the durable registry refuses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-receipts-'));
  const h = control();
  writeFileSync(join(dir, `${sanitizePlanId(h.plan_id)}.json`), JSON.stringify({ plan_id: h.plan_id, state: 'FILLED' }));
  refusesWith(h, 'R03_DUPLICATE_PLAN_ID', { receiptsDir: dir });
  const fresh = validateHandoff(control({ plan_id: `B-139:${h.created_at}`, row_id: 'B-139' }), { receiptsDir: dir });
  assert.equal(fresh.ok, true, 'a new plan_id must not be blocked');
});

test('3b. an unreadable receipt fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-receipts-'));
  writeFileSync(join(dir, 'corrupt.json'), '{not json');
  refusesWith(control(), 'R03_DUPLICATE_PLAN_ID', { receiptsDir: dir });
});

test('4. stale expires_at refuses; future created_at refuses', () => {
  refusesWith(control({ expires_at: new Date(Date.now() - 60_000).toISOString() }), 'R04_STALE_PLAN');
  refusesWith(control({ created_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() }), 'R04_STALE_PLAN');
  refusesWith(control({ expires_at: 'whenever' }), 'R04_STALE_PLAN');
});

test('5. risk above ceiling refuses; risk above notional refuses', () => {
  refusesWith(control({ planned_dollar_risk: 6.0 }), 'R05_RISK_ABOVE_CEILING');
  refusesWith(control({ planned_dollar_risk: 4.9 }), 'R05_RISK_ABOVE_CEILING'); // > $4.50 notional
});

test('6. notional above the hardcoded ceiling refuses; a plan cannot raise the ceiling', () => {
  refusesWith(control({ quantity_value: 9.0 }), 'R06_NOTIONAL_ABOVE_HARD_CEILING');
  refusesWith(control({ executor_absolute_ceiling: 150.0 }), 'R06_NOTIONAL_ABOVE_HARD_CEILING');
  refusesWith(control({ quantity_mode: 'shares', quantity_value: 2, limit_price: 3.0, invalidation_price: 2.5 }), 'R06_NOTIONAL_ABOVE_HARD_CEILING');
  assert.equal(HARD_TEST_CEILING_USD, 5.0);
});

test('7. both quantity modes refuses', () => {
  refusesWith(control({ shares: 1 }), 'R07_BOTH_QUANTITY_MODES');
  refusesWith(control({ quantity_mode: 'both' }), 'R07_BOTH_QUANTITY_MODES');
});

test('8. neither quantity mode (or nonpositive value) refuses', () => {
  const h = control(); delete h.quantity_mode;
  refusesWith(h, 'R08_NO_QUANTITY_MODE');
  refusesWith(control({ quantity_value: -1 }), 'R08_NO_QUANTITY_MODE');
});

test('9. `side` supplied refuses, even alongside a valid action', () => {
  refusesWith(control({ side: 'long' }), 'R09_SIDE_FIELD_PRESENT');
});

test('10. any action other than BUY | SELL_TO_CLOSE refuses', () => {
  refusesWith(control({ action: 'SELL_TO_OPEN' }), 'R10_ACTION_NOT_ALLOWED');
  refusesWith(control({ action: 'long' }), 'R10_ACTION_NOT_ALLOWED');
});

test('11. non-equity asset class refuses', () => {
  refusesWith(control({ asset_class: 'crypto' }), 'R11_ASSET_NOT_EQUITY');
  refusesWith(control({ asset_class: 'option' }), 'R11_ASSET_NOT_EQUITY');
});

test('12. forbidden structure or flag refuses', () => {
  refusesWith(control({ structure: 'call_option' }), 'R12_FORBIDDEN_STRUCTURE_OR_FLAG');
  refusesWith(control({ leveraged_product: true }), 'R12_FORBIDDEN_STRUCTURE_OR_FLAG');
  refusesWith(control({ concentrated: true }), 'R12_FORBIDDEN_STRUCTURE_OR_FLAG');
  refusesWith(control({ conviction_bet: true }), 'R12_FORBIDDEN_STRUCTURE_OR_FLAG');
  refusesWith(control({ lane: 'leverage' }), 'R17_LANE_NOT_ALLOWED');
});

test('13. market order, GTC, or extended hours refuses', () => {
  refusesWith(control({ order_type: 'MARKET' }), 'R13_ORDER_INSTRUCTION_NOT_ALLOWED');
  refusesWith(control({ time_in_force: 'GTC' }), 'R13_ORDER_INSTRUCTION_NOT_ALLOWED');
  refusesWith(control({ session: 'EXTENDED' }), 'R13_ORDER_INSTRUCTION_NOT_ALLOWED');
});

test('14. missing or invalid exit_owner refuses', () => {
  const h = control(); delete h.exit_owner;
  refusesWith(h, 'R01_MISSING_FIELD');
  refusesWith(control({ exit_owner: 'the stop level' }), 'R14_MISSING_EXIT_OWNER');
});

test('15. unknown broker response normalizes to UNKNOWN_REQUIRES_RECONCILIATION, never success', () => {
  const fx = loadFixture('unknown-broker-state.json');
  assert.equal(normalizeBrokerState(fx), 'UNKNOWN_REQUIRES_RECONCILIATION');
  assert.notEqual(normalizeBrokerState({ state: 'processing_venue_ack_2' }), 'FILLED');
  assert.equal(normalizeBrokerState(null), 'UNKNOWN_REQUIRES_RECONCILIATION');
});

test('16. ambiguous placement timeout: no retry path exists', () => {
  const fx = loadFixture('placement-timeout.json');
  const state = normalizeBrokerState(fx);
  assert.equal(state, 'UNKNOWN_REQUIRES_RECONCILIATION');
  assert.equal(placementDecisionAfter(state), 'RECONCILE_THEN_REQUIRE_NEW_HUMAN_DECISION');
  assert.equal(AUTOMATIC_RETRY_ALLOWED, false);
  for (const s of [...RECEIPT_STATES, 'garbage', undefined]) {
    assert.notEqual(placementDecisionAfter(s), 'RETRY', `state ${s} must never permit retry`);
  }
});

test('extra: full account number anywhere in the handoff refuses', () => {
  refusesWith(control({ account_alias: '123456789' }), 'R16_ACCOUNT_ALIAS_INVALID');
  refusesWith(control({ notes_field: 'acct 987654321012' }), 'R16_ACCOUNT_ALIAS_INVALID');
});

test('extra: BUY invalidation must sit below the limit', () => {
  refusesWith(control({ invalidation_price: 22.1 }), 'R19_INVALIDATION_INVALID');
  refusesWith(control({ invalidation_price: 'N/A' }), 'R19_INVALIDATION_INVALID');
});

test('extra: wrong schema or executor version refuses', () => {
  refusesWith(control({ schema_version: 'v2' }), 'R15_SCHEMA_VERSION_UNKNOWN');
  refusesWith(control({ executor_version: 'bench-executor-v2' }), 'R20_VERSION_MISMATCH');
});
