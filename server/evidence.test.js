// evidence.test.js — offline, synthetic bars, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectEvents, independentCount, forwardReturns, summarize, gradeEvidence, barsSpanYears
} from "./evidence.js";

// helper: bars from a close series starting 2026-01-01, one bar per day
function mkBars(closes, start = "2026-01-01") {
  const t0 = new Date(`${start}T00:00:00Z`).getTime();
  return closes.map((close, i) => ({
    date: new Date(t0 + i * 86400000).toISOString().slice(0, 10),
    close
  }));
}

test("move: detects a -5% 2-bar drop, collapses consecutive qualifying days to the first", () => {
  // 100,100,94,89,100,100 — idx2 (-6% vs idx0) and idx3 (-11% vs idx1) qualify; cluster -> [2]
  const bars = mkBars([100, 100, 94, 89, 100, 100]);
  const events = detectEvents(bars, { kind: "move", windowDays: 2, thresholdPct: -5 });
  assert.deepEqual(events, [2]);
});

test("move: positive threshold means rises", () => {
  const bars = mkBars([100, 100, 106, 100, 100, 112]);
  const events = detectEvents(bars, { kind: "move", windowDays: 2, thresholdPct: 5 });
  assert.deepEqual(events, [2, 5]);
});

test("breakout: close above the max of the prior lookback closes, cluster-collapsed", () => {
  // lookback 3: idx4 close 111 > max(101,102,103)=103 -> event; idx5 (112) still above but same run
  const bars = mkBars([100, 101, 102, 103, 111, 112, 100, 100, 100, 120]);
  const events = detectEvents(bars, { kind: "breakout", lookback: 3 });
  assert.deepEqual(events, [4, 9]);
});

test("breakdown: close below the min of prior lookback closes", () => {
  const bars = mkBars([100, 99, 98, 98, 90, 89, 100]);
  const events = detectEvents(bars, { kind: "breakdown", lookback: 3 });
  assert.deepEqual(events, [4]);
});

test("unknown setup kind throws", () => {
  assert.throws(() => detectEvents(mkBars([1, 2]), { kind: "astrology" }), /unknown setup kind/);
});

test("independentCount enforces horizon spacing greedily", () => {
  assert.equal(independentCount([2, 5, 30, 33, 80], 21), 3); // 2, 30, 80
  assert.equal(independentCount([], 21), 0);
});

test("forwardReturns computes pct, excludes pending, matches benchmark by date", () => {
  const bars = mkBars([100, 100, 90, 95, 99, 100, 100]);
  const bench = mkBars([50, 50, 50, 50, 51, 50, 50]); // +2% over idx2->idx4 window
  const { instances, pending } = forwardReturns(bars, [2, 6], 2, bench);
  assert.equal(pending, 1); // idx6 + 2 is past the end
  assert.equal(instances.length, 1);
  const inst = instances[0];
  assert.equal(inst.date, bars[2].date);
  assert.equal(inst.entry, 90);
  assert.equal(inst.exit, 99);
  assert.equal(inst.pct, 10);       // (99-90)/90
  assert.equal(inst.alpha, 8);      // 10 - 2
});

test("forwardReturns without bench leaves alpha null", () => {
  const bars = mkBars([100, 90, 99]);
  const { instances } = forwardReturns(bars, [1], 1);
  assert.equal(instances[0].alpha, null);
});

test("summarize: win rate, median, extremes; alpha null-safe", () => {
  const s = summarize([
    { pct: 10, alpha: null }, { pct: -5, alpha: null }, { pct: 2, alpha: null }
  ]);
  assert.equal(s.n, 3);
  assert.equal(s.win_rate, 66.7);
  assert.equal(s.median_pct, 2);
  assert.equal(s.best_pct, 10);
  assert.equal(s.worst_pct, -5);
  assert.equal(s.avg_alpha, null);
});

test("summarize on an empty sample is all nulls, never NaN", () => {
  const s = summarize([]);
  assert.equal(s.n, 0);
  assert.equal(s.win_rate, null);
  assert.equal(s.median_pct, null);
});

test("grade ladder: F on nothing, D tiny, C thin, B decent, A strong", () => {
  assert.equal(gradeEvidence({ events: 0, independent: 0, spanYears: 5, source: "yahoo" }).grade, "F");
  assert.equal(gradeEvidence({ events: 3, independent: 3, spanYears: 5, source: "yahoo" }).grade, "D");
  assert.equal(gradeEvidence({ events: 20, independent: 10, spanYears: 5, source: "yahoo" }).grade, "C");
  assert.equal(gradeEvidence({ events: 20, independent: 16, spanYears: 1.5, source: "yahoo" }).grade, "C");
  assert.equal(gradeEvidence({ events: 40, independent: 20, spanYears: 5, source: "yahoo" }).grade, "B");
  assert.equal(gradeEvidence({ events: 60, independent: 35, spanYears: 6, source: "yahoo" }).grade, "A");
  assert.equal(gradeEvidence({ events: 5, independent: 5, spanYears: 5, source: "none" }).grade, "F");
});

test("barsSpanYears", () => {
  const bars = [{ date: "2021-08-30", close: 1 }, { date: "2026-08-29", close: 1 }];
  assert.equal(barsSpanYears(bars), 5);
  assert.equal(barsSpanYears([]), 0);
});
