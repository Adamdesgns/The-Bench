// challenge.test.js — the account-challenge ledger rules.
//
// The ledger is the spine of a public challenge, so the rules that protect it
// are the ones worth testing: append-only, arithmetic that must reconcile
// against the broker, and no silently-invented numbers.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TARGET,
  pctChange,
  computeProgress,
  validateSnapshot,
  appendSnapshot,
} from "./challenge.js";

const START = {
  date: "2026-08-04",
  total_value: 545.81,
  equity_value: 377.09,
  cash: 168.72,
  options_value: 0,
  source: "robinhood-mcp",
};

const ledgerOf = (...rows) => rows;

test("the target is $10,000", () => {
  assert.equal(TARGET, 10000);
});

test("pctChange handles a gain, a loss and no move", () => {
  assert.equal(pctChange(100, 110), 10);
  assert.equal(pctChange(100, 90), -10);
  assert.equal(pctChange(100, 100), 0);
});

test("pctChange returns null rather than Infinity when the base is zero", () => {
  assert.equal(pctChange(0, 50), null);
});

test("progress reports the multiple still needed, not just a percentage", () => {
  const p = computeProgress(START, START);
  assert.equal(p.pctFromStart, 0);
  // 10000 / 545.81 = 18.32x
  assert.equal(p.multipleToTarget, 18.32);
  assert.equal(p.pctOfTarget, 5.5);
});

test("progress after a gain moves all three numbers", () => {
  const later = { ...START, date: "2026-08-11", total_value: 600 };
  const p = computeProgress(later, START);
  assert.equal(p.pctFromStart, 9.93);
  assert.equal(p.multipleToTarget, 16.67);
  assert.equal(p.pctOfTarget, 6);
});

test("a drawdown is reported as a drawdown, never clamped to zero", () => {
  const down = { ...START, date: "2026-08-11", total_value: 400 };
  const p = computeProgress(down, START);
  assert.equal(p.pctFromStart, -26.71);
  assert.ok(p.multipleToTarget > 18.32, "further from target after a loss");
});

test("a clean snapshot validates", () => {
  assert.deepEqual(validateSnapshot(START, ledgerOf()), []);
});

test("the parts must reconcile to the total", () => {
  const bad = { ...START, cash: 200 };
  const problems = validateSnapshot(bad, ledgerOf());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not reconcile/);
});

test("a two-cent rounding difference is tolerated", () => {
  const rounded = { ...START, cash: 168.7 };
  assert.deepEqual(validateSnapshot(rounded, ledgerOf()), []);
});

test("a date already in the ledger is refused — append-only", () => {
  const problems = validateSnapshot(START, ledgerOf(START));
  assert.match(problems.join(" "), /already recorded/);
});

test("a date earlier than the last row is refused", () => {
  const earlier = { ...START, date: "2026-08-01" };
  const problems = validateSnapshot(earlier, ledgerOf(START));
  assert.match(problems.join(" "), /earlier than/);
});

test("a snapshot with no source is refused — the balance must come from the broker", () => {
  const { source, ...noSource } = START;
  const problems = validateSnapshot(noSource, ledgerOf());
  assert.match(problems.join(" "), /source/);
});

test("a missing or non-numeric total is refused, never coerced", () => {
  assert.match(validateSnapshot({ ...START, total_value: null }, []).join(" "), /total_value/);
  assert.match(validateSnapshot({ ...START, total_value: "545.81" }, []).join(" "), /total_value/);
});

test("appendSnapshot returns a new array and leaves the original alone", () => {
  const ledger = ledgerOf(START);
  const next = { ...START, date: "2026-08-11", total_value: 600, cash: 222.91 };
  const out = appendSnapshot(ledger, next);
  assert.equal(ledger.length, 1, "original untouched");
  assert.equal(out.length, 2);
  assert.equal(out[1].date, "2026-08-11");
});

test("appendSnapshot throws on an invalid row rather than writing it", () => {
  assert.throws(() => appendSnapshot(ledgerOf(START), START), /already recorded/);
});

test("appendSnapshot stamps progress onto the stored row", () => {
  const next = { ...START, date: "2026-08-11", total_value: 600, cash: 222.91 };
  const out = appendSnapshot(ledgerOf(START), next);
  assert.equal(out[1].pct_from_start, 9.93);
  assert.equal(out[1].multiple_to_target, 16.67);
});
