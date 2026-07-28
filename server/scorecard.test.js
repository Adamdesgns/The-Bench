// scorecard.test.js — orchestration: which rows get scored, what gets written.
// Bars are injected, so this runs with no network and no fs.

import test from "node:test";
import assert from "node:assert/strict";

import { scoreRows } from "./scorecard.js";

// GOOGL runs +10% while SPY runs +2% over the first week of July.
const BARS = {
  GOOGL: [
    { date: "2026-07-02", close: 100 },
    { date: "2026-07-09", close: 110 }
  ],
  SPY: [
    { date: "2026-07-02", close: 500 },
    { date: "2026-07-09", close: 510 }
  ]
};

const fetchBars = async (ticker) => ({ bars: BARS[ticker] ?? [], source: BARS[ticker] ? "stooq" : "none" });

function longRow(extra = {}) {
  return {
    id: "B-100",
    ticker: "GOOGL",
    date: "2026-07-02",
    review_price: 100,
    hodl: "Accumulate",
    final_call: "Accumulate — test row",
    outcome: null,
    ...extra
  };
}

test("a due checkpoint is scored and written onto the row", async () => {
  const rows = [longRow()];
  const { rows: out } = await scoreRows(rows, { today: "2026-07-09", fetchBars });

  const cp = out[0].checkpoints["1w"];
  assert.equal(cp.verdict, "right");
  assert.equal(cp.asset_pct, 10);
  assert.equal(cp.bench, "SPY");
  assert.equal(cp.bench_pct, 2);
  assert.equal(cp.alpha, 8);
  assert.equal(cp.source, "stooq");
});

test("an existing checkpoint is never recomputed — scoring is append-only", async () => {
  const rows = [longRow({ checkpoints: { "1w": { verdict: "wrong", alpha: -99, note: "written earlier" } } })];
  const { rows: out } = await scoreRows(rows, { today: "2026-07-09", fetchBars });

  assert.equal(out[0].checkpoints["1w"].alpha, -99);
  assert.equal(out[0].checkpoints["1w"].note, "written earlier");
});

test("a row with no elapsed horizon is left untouched", async () => {
  const rows = [longRow()];
  const { rows: out, scored } = await scoreRows(rows, { today: "2026-07-03", fetchBars });

  assert.equal(out[0].checkpoints, undefined);
  assert.deepEqual(scored, []);
});

test("an unobservable price scores not_scorable rather than being estimated", async () => {
  const rows = [longRow({ ticker: "NOSUCH", review_price: 100 })];
  const { rows: out } = await scoreRows(rows, { today: "2026-07-09", fetchBars });

  assert.equal(out[0].checkpoints["1w"].verdict, "not_scorable");
  assert.equal(out[0].checkpoints["1w"].source, "none");
});

test("the closing horizon fills the archive's own outcome fields", async () => {
  const rows = [longRow()];
  const { rows: out } = await scoreRows(rows, { today: "2026-09-30", fetchBars });

  assert.equal(out[0].outcome, "Win");
  assert.equal(out[0].outcome_price, 110);
  assert.equal(out[0].pct_move, 10);
  assert.ok(out[0].grade_verdict);
});

test("the scorer never writes a lesson — that field stays Adam's", async () => {
  const rows = [longRow()];
  const { rows: out } = await scoreRows(rows, { today: "2026-09-30", fetchBars });

  assert.equal(out[0].lesson ?? null, null);
});

test("scored results carry what the post generator needs", async () => {
  const { scored } = await scoreRows([longRow()], { today: "2026-07-09", fetchBars });

  assert.equal(scored.length, 1);
  const s = scored[0];
  assert.equal(s.ticker, "GOOGL");
  assert.equal(s.type, "long");
  assert.equal(s.horizon, "1w");
  assert.equal(s.verdict, "right");
  assert.equal(s.bench, "SPY");
});

test("a hedge row is recorded as not_scorable and excluded from results", async () => {
  const rows = [longRow({ final_call: "Hedge — active, delta overdue", hodl: "Hold-quality — wait for value" })];
  const { rows: out, scored } = await scoreRows(rows, { today: "2026-07-09", fetchBars });

  assert.equal(out[0].checkpoints["1w"].verdict, "not_scorable");
  assert.equal(scored.filter((s) => s.verdict !== "not_scorable").length, 0);
});
