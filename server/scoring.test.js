// scoring.test.js — the verdict rule. Pure, no network, no fs.
//
// Fixtures are real rows from db/archive.json. B-010 is the important one:
// hodl says "Accumulate" but the call was "No Trade", and the call must win.

import test from "node:test";
import assert from "node:assert/strict";

import { classifyCall, benchmarkFor, pctMove, scoreCall, triggerFiredIn } from "./scoring.js";

// ---- classifyCall ----

test("a No Trade call classifies as a pass even when hodl says Accumulate", () => {
  const row = { hodl: "Accumulate", final_call: "No Trade — trigger: reclaim $950 on volume" };
  assert.equal(classifyCall(row), "pass");
});

test("an Accumulate call classifies as long", () => {
  assert.equal(classifyCall({ hodl: "Accumulate", final_call: "Accumulate — kids' UTMA" }), "long");
});

test("an Entered call classifies as long", () => {
  assert.equal(classifyCall({ hodl: "Accumulate", final_call: "Entered — stop $1,020" }), "long");
});

test("a Hedge call classifies as hedge", () => {
  assert.equal(
    classifyCall({ hodl: "Hold-quality — wait for value", final_call: "Hedge — active, delta overdue" }),
    "hedge"
  );
});

test("Watchlist, Top watchlist, ARMED and Setup Forming all classify as conditional", () => {
  const calls = [
    "Watchlist — trigger: reclaim $540",
    "Top watchlist — >$77 / dies <$52",
    "ARMED — hold mid-$60s + reclaim $70-71",
    "Setup Forming — earnings gate Jul 22"
  ];
  for (const final_call of calls) {
    assert.equal(classifyCall({ hodl: "Hold-quality — wait for value", final_call }), "conditional", final_call);
  }
});

test("an unrecognised call classifies as unknown rather than guessing", () => {
  assert.equal(classifyCall({ hodl: "Trade-only — not a hold", final_call: "Something nobody wrote before" }), "unknown");
  assert.equal(classifyCall({ hodl: "Trade-only — not a hold", final_call: null }), "unknown");
});

// ---- benchmarkFor ----

test("equities benchmark against SPY", () => {
  assert.equal(benchmarkFor("GOOGL"), "SPY");
  assert.equal(benchmarkFor("MU"), "SPY");
});

test("crypto benchmarks against BTC", () => {
  assert.equal(benchmarkFor("DOGE"), "BTC");
  assert.equal(benchmarkFor("ETH"), "BTC");
});

test("BTC itself benchmarks against SPY, not against itself", () => {
  assert.equal(benchmarkFor("BTC"), "SPY");
});

// ---- pctMove ----

test("pctMove returns percent change from entry to exit", () => {
  assert.equal(pctMove(100, 110), 10);
  assert.equal(pctMove(200, 150), -25);
});

test("pctMove returns null when a price is missing or zero", () => {
  assert.equal(pctMove(0, 110), null);
  assert.equal(pctMove(100, null), null);
});

// ---- scoreCall: long ----

test("a long call that beat its benchmark is right", () => {
  const r = scoreCall({ type: "long", assetPct: 8, benchPct: 2 });
  assert.equal(r.verdict, "right");
  assert.equal(r.alpha, 6);
});

test("a long call that lagged its benchmark is wrong", () => {
  assert.equal(scoreCall({ type: "long", assetPct: -4, benchPct: 2 }).verdict, "wrong");
});

test("a long call inside the dead band is flat, not a win", () => {
  assert.equal(scoreCall({ type: "long", assetPct: 2.4, benchPct: 2 }).verdict, "flat");
});

// ---- scoreCall: pass ----

test("a pass on something that underperformed is right", () => {
  const r = scoreCall({ type: "pass", assetPct: -18, benchPct: -4 });
  assert.equal(r.verdict, "right");
  assert.equal(r.alpha, -14);
});

test("a pass on something that outran the benchmark is wrong", () => {
  assert.equal(scoreCall({ type: "pass", assetPct: 6, benchPct: 2 }).verdict, "wrong");
});

test("a pass that missed a large run is flagged as an expensive pass", () => {
  const r = scoreCall({ type: "pass", assetPct: 15, benchPct: 2 });
  assert.equal(r.verdict, "wrong");
  assert.match(r.note, /expensive pass/);
});

test("a pass that missed only a small move is wrong but not flagged expensive", () => {
  const r = scoreCall({ type: "pass", assetPct: 4, benchPct: 1 });
  assert.equal(r.verdict, "wrong");
  assert.doesNotMatch(r.note ?? "", /expensive pass/);
});

// ---- scoreCall: conditional ----

test("a conditional whose trigger fired and then ran is right", () => {
  assert.equal(scoreCall({ type: "conditional", assetPct: 9, benchPct: 2, triggerFired: true }).verdict, "right");
});

test("a conditional that correctly never triggered is right", () => {
  assert.equal(scoreCall({ type: "conditional", assetPct: -3, benchPct: 2, triggerFired: false }).verdict, "right");
});

test("a conditional that never triggered while the asset ran is wrong", () => {
  assert.equal(scoreCall({ type: "conditional", assetPct: 14, benchPct: 2, triggerFired: false }).verdict, "wrong");
});

test("a conditional that triggered and then lagged is wrong", () => {
  assert.equal(scoreCall({ type: "conditional", assetPct: -6, benchPct: 2, triggerFired: true }).verdict, "wrong");
});

test("a conditional with unknown trigger state is not scorable, never guessed", () => {
  const r = scoreCall({ type: "conditional", assetPct: 9, benchPct: 2, triggerFired: null });
  assert.equal(r.verdict, "not_scorable");
});

// ---- scoreCall: hedge and unknown ----

test("a hedge is never scored — no position data exists to score it against", () => {
  const r = scoreCall({ type: "hedge", assetPct: 9, benchPct: 2 });
  assert.equal(r.verdict, "not_scorable");
  assert.match(r.note, /hedge/);
});

test("an unknown call type is not scorable", () => {
  assert.equal(scoreCall({ type: "unknown", assetPct: 9, benchPct: 2 }).verdict, "not_scorable");
});

test("a call with an unobservable price is not scorable rather than estimated", () => {
  assert.equal(scoreCall({ type: "long", assetPct: null, benchPct: 2 }).verdict, "not_scorable");
  assert.equal(scoreCall({ type: "long", assetPct: 5, benchPct: null }).verdict, "not_scorable");
});

// ---- triggerFiredIn ----
// Did the level actually get taken out between the review and the checkpoint?

const window = [
  { date: "2026-07-01", close: 70 },
  { date: "2026-07-05", close: 78 },
  { date: "2026-07-10", close: 74 }
];

test("an above-trigger fires when a close in the window reaches the level", () => {
  assert.equal(triggerFiredIn(window, "2026-07-01", "2026-07-10", { direction: "above", level: 77 }), true);
});

test("an above-trigger does not fire when no close reaches the level", () => {
  assert.equal(triggerFiredIn(window, "2026-07-01", "2026-07-10", { direction: "above", level: 90 }), false);
});

test("a below-trigger fires when a close drops to the level", () => {
  assert.equal(triggerFiredIn(window, "2026-07-01", "2026-07-10", { direction: "below", level: 71 }), true);
});

test("bars outside the window are ignored", () => {
  assert.equal(triggerFiredIn(window, "2026-07-06", "2026-07-10", { direction: "above", level: 77 }), false);
});

test("an absent or malformed trigger yields null, never a guessed boolean", () => {
  assert.equal(triggerFiredIn(window, "2026-07-01", "2026-07-10", null), null);
  assert.equal(triggerFiredIn(window, "2026-07-01", "2026-07-10", { direction: "above" }), null);
  assert.equal(triggerFiredIn([], "2026-07-01", "2026-07-10", { direction: "above", level: 77 }), null);
});
