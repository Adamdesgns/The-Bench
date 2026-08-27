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
  contributedAt,
  scopeChanged,
  attribution,
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

// ── deposits ────────────────────────────────────────────────────────────────
// Adam can move money in. The rule is not "don't" -- it is that deposited
// dollars can never be counted as earned ones. contributed tracks what was put
// in; trading_pnl is the only number that says whether the trading worked.

test("with no deposits, contributed is just the starting balance", () => {
  assert.equal(contributedAt(ledgerOf(START), START), 545.81);
});

test("a deposit raises contributed and does NOT count as profit", () => {
  const ledger = ledgerOf(START);
  const funded = { ...START, date: "2026-08-11", total_value: 745.81, cash: 368.72, deposit: 200, deposit_source: "savings" };
  const out = appendSnapshot(ledger, funded);
  assert.equal(out[1].contributed, 745.81);
  assert.equal(out[1].trading_pnl, 0, "moving $200 in earned nothing");
  assert.equal(out[1].pct_return_on_contributed, 0);
});

test("profit is measured against contributed, not against the start", () => {
  const ledger = ledgerOf(START);
  const funded = { ...START, date: "2026-08-11", total_value: 800, cash: 422.91, deposit: 200, deposit_source: "savings" };
  const out = appendSnapshot(ledger, funded);
  assert.equal(out[1].contributed, 745.81);
  assert.equal(out[1].trading_pnl, 54.19);
  // the naive headline would read +46.6% from start; the honest one is +7.3%
  assert.equal(out[1].pct_from_start, 46.57);
  assert.equal(out[1].pct_return_on_contributed, 7.27);
});

test("a withdrawal is a negative deposit and lowers contributed", () => {
  const ledger = ledgerOf(START);
  const out = appendSnapshot(ledger, {
    ...START, date: "2026-08-11", total_value: 445.81, cash: 68.72, deposit: -100, deposit_source: "bills",
  });
  assert.equal(out[1].contributed, 445.81);
  assert.equal(out[1].trading_pnl, 0, "taking $100 out is not a loss");
});

test("deposits accumulate across rows", () => {
  let ledger = ledgerOf(START);
  ledger = appendSnapshot(ledger, { ...START, date: "2026-08-11", total_value: 745.81, cash: 368.72, deposit: 200, deposit_source: "savings" });
  ledger = appendSnapshot(ledger, { ...START, date: "2026-08-18", total_value: 1045.81, cash: 668.72, deposit: 300, deposit_source: "job" });
  assert.equal(ledger[2].contributed, 1045.81);
  assert.equal(ledger[2].trading_pnl, 0);
});

test("a non-numeric deposit is refused rather than silently ignored", () => {
  const problems = validateSnapshot({ ...START, date: "2026-08-11", deposit: "200" }, ledgerOf(START));
  assert.match(problems.join(" "), /deposit/);
});

// ── multi-account scope ─────────────────────────────────────────────────────
// Using options may mean trading the margin account too. The ledger records
// WHICH accounts a row covers, so a change of scope is visible in the record
// rather than being an unexplained jump in the balance.

test("accounts default to the challenge account when not given", () => {
  const out = appendSnapshot(ledgerOf(), START);
  assert.deepEqual(out[0].accounts, ["769507724"]);
});

test("a row can cover more than one account", () => {
  const out = appendSnapshot(ledgerOf(), { ...START, accounts: ["769507724", "929016137"] });
  assert.deepEqual(out[0].accounts, ["769507724", "929016137"]);
});

test("an empty accounts list is refused — every row must say what it covers", () => {
  const problems = validateSnapshot({ ...START, accounts: [] }, ledgerOf());
  assert.match(problems.join(" "), /accounts/);
});

test("a change in account scope is flagged, because it moves the balance", () => {
  const ledger = appendSnapshot(ledgerOf(), START);
  const widened = {
    ...START, date: "2026-08-11", total_value: 2000, equity_value: 1831.28,
    accounts: ["769507724", "929016137"],
  };
  assert.ok(
    scopeChanged(ledger, widened),
    "widening from one account to two has to be visible"
  );
});

// ── Funding sources and the finish-line breakdown ────────────────────────────
//
// Added 2026-08-16, after a public post asserted a $200 withdrawal that was
// never observed — it was reconstructed from balances. The broker reports
// balances and trades and never reports WHY money moved, so the reason has to
// be recorded at the time or it is gone. These tests are that guarantee.

test("a deposit without a source is refused — the reason cannot be recovered later", () => {
  const problems = validateSnapshot(
    { ...START, date: "2026-08-11", total_value: 1045.81, equity_value: 877.09, deposit: 500 },
    ledgerOf(START)
  );
  assert.match(problems.join(" "), /deposit_source/);
});

test("a withdrawal needs a source too — money out is as unexplained as money in", () => {
  const problems = validateSnapshot(
    { ...START, date: "2026-08-11", total_value: 345.81, equity_value: 177.09, deposit: -200 },
    ledgerOf(START)
  );
  assert.match(problems.join(" "), /deposit_source/);
});

test("a zero deposit needs no source — there is nothing to label", () => {
  const problems = validateSnapshot({ ...START, date: "2026-08-11", deposit: 0 }, ledgerOf(START));
  assert.deepEqual(problems, []);
});

test("a blank or whitespace source does not satisfy the requirement", () => {
  for (const bad of ["", "   ", null, 7]) {
    const problems = validateSnapshot(
      { ...START, date: "2026-08-11", total_value: 1045.81, equity_value: 877.09,
        deposit: 500, deposit_source: bad },
      ledgerOf(START)
    );
    assert.match(problems.join(" "), /deposit_source/, `${JSON.stringify(bad)} should be refused`);
  }
});

test("appendSnapshot stores a trimmed source, and null when there is none", () => {
  const opened = appendSnapshot(ledgerOf(), START);
  assert.equal(opened[0].deposit_source, null);

  const withDeposit = appendSnapshot(opened, {
    ...START, date: "2026-08-11", total_value: 1045.81, equity_value: 877.09,
    deposit: 500, deposit_source: "  savings  ",
  });
  assert.equal(withDeposit[1].deposit_source, "savings");
});

test("attribution splits the balance into where it came from, and it sums", () => {
  let ledger = appendSnapshot(ledgerOf(), START);
  ledger = appendSnapshot(ledger, {
    ...START, date: "2026-08-11", total_value: 1045.81, equity_value: 877.09,
    deposit: 500, deposit_source: "savings",
  });
  ledger = appendSnapshot(ledger, {
    ...START, date: "2026-08-18", total_value: 1400, equity_value: 1231.28,
    deposit: 200, deposit_source: "job",
  });

  const report = attribution(ledger);
  assert.ok(report.reconciles, "the buckets must sum to the account value");
  assert.equal(report.contributed, 1245.81);
  // 1400 in the account against 1245.81 put in = 154.19 earned.
  assert.equal(report.trading_pnl, 154.19);
  assert.deepEqual(report.sources, [
    { source: "opening balance", amount: 545.81 },
    { source: "savings", amount: 500 },
    { source: "job", amount: 200 },
  ]);
});

test("attribution folds the same source into one bucket regardless of case", () => {
  let ledger = appendSnapshot(ledgerOf(), START);
  ledger = appendSnapshot(ledger, {
    ...START, date: "2026-08-11", total_value: 645.81, equity_value: 477.09,
    deposit: 100, deposit_source: "savings",
  });
  ledger = appendSnapshot(ledger, {
    ...START, date: "2026-08-18", total_value: 745.81, equity_value: 577.09,
    deposit: 100, deposit_source: "Savings ",
  });

  const report = attribution(ledger);
  const savings = report.sources.filter((s) => s.source.toLowerCase() === "savings");
  assert.equal(savings.length, 1, "two spellings must not become two buckets");
  assert.equal(savings[0].amount, 200);
});

test("attribution nets a withdrawal against its source rather than hiding it", () => {
  let ledger = appendSnapshot(ledgerOf(), START);
  ledger = appendSnapshot(ledger, {
    ...START, date: "2026-08-11", total_value: 345.81, equity_value: 177.09,
    deposit: -200, deposit_source: "bills",
  });

  const report = attribution(ledger);
  assert.deepEqual(report.sources.find((s) => s.source === "bills"), {
    source: "bills", amount: -200,
  });
  assert.ok(report.reconciles);
  assert.equal(report.trading_pnl, 0, "moving money out is not a trading loss");
});

test("the opening row can name where its own capital came from", () => {
  const ledger = appendSnapshot(ledgerOf(), { ...START, deposit_source: "savings" });
  assert.equal(attribution(ledger).sources[0].source, "savings");
});

test("attribution reports an empty ledger as nothing rather than zero", () => {
  assert.equal(attribution([]), null);
  assert.equal(attribution(), null);
});
