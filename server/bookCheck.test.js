// bookCheck.test.js — the per-CALL gap rule.
//
// v1 of this checker asked "does this ticker have a row?" and that gave false
// confidence, which is worse than no checker. AMD was discussed and passed on
// 2026-08-04 and never logged; by the next morning the pre-market routine had
// written an AMD row for 08-05, so the ticker read as covered while the actual
// decision was missing. A ticker with one row passed the check even though
// three separate calls had been made on it.
//
// The fix: match a mention to a row NEAR THAT DATE, not anywhere in the book.

import { test } from "node:test";
import assert from "node:assert/strict";

import { cashtags, findGaps } from "./bookCheck.js";

const rows = (...pairs) => pairs.map(([ticker, date]) => ({ ticker, date }));
const mention = (ticker, date, where = "post") => ({ ticker, date, where });

// ── extraction ─────────────────────────────────────────────────────────────

test("cashtags pulls $TICKER and ignores bare words", () => {
  const got = cashtags("AMD beat but $AMD fell. THE market. $MU held.");
  assert.deepEqual([...got].sort(), ["AMD", "MU"]);
});

test("benchmarks are context, not calls", () => {
  assert.deepEqual([...cashtags("$SPY $QQQ $VIX $BTC $NVDA")], ["NVDA"]);
});

test("placeholders are ignored — $X is nearly always '$X was transferred'", () => {
  assert.deepEqual([...cashtags("$X was transferred, $XX.XX")], []);
});

// ── the per-call rule ──────────────────────────────────────────────────────

test("a mention with a same-day row is covered", () => {
  const gaps = findGaps([mention("AMD", "2026-08-04")], rows(["AMD", "2026-08-04"]));
  assert.deepEqual(gaps, []);
});

test("a mention with a row only on ANOTHER date is a gap — the v1 bug", () => {
  const gaps = findGaps([mention("AMD", "2026-08-04")], rows(["AMD", "2026-08-12"]));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].ticker, "AMD");
  assert.equal(gaps[0].nearest, "2026-08-12");
});

test("a row logged the next morning still counts — calls are often written up late", () => {
  const gaps = findGaps([mention("AMD", "2026-08-04")], rows(["AMD", "2026-08-05"]));
  assert.deepEqual(gaps, []);
});

test("a row two days later does NOT count — that is drift, not a write-up", () => {
  const gaps = findGaps([mention("AMD", "2026-08-04")], rows(["AMD", "2026-08-06"]));
  assert.equal(gaps.length, 1);
});

test("a ticker with no row at all is a gap and says so", () => {
  const gaps = findGaps([mention("BRKR", "2026-08-04")], rows(["AMD", "2026-08-04"]));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].nearest, null);
});

test("several mentions of one ticker on different days are judged separately", () => {
  const gaps = findGaps(
    [mention("AMD", "2026-08-04"), mention("AMD", "2026-08-20")],
    rows(["AMD", "2026-08-04"])
  );
  assert.equal(gaps.length, 1, "the covered day drops out, the uncovered one stays");
  assert.equal(gaps[0].date, "2026-08-20");
});

test("the same ticker mentioned twice on one day collapses to a single gap", () => {
  const gaps = findGaps(
    [mention("AMD", "2026-08-04", "post"), mention("AMD", "2026-08-04", "vault")],
    []
  );
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].where.length, 2, "but both sources are kept");
});

test("the window is configurable", () => {
  assert.equal(findGaps([mention("AMD", "2026-08-04")], rows(["AMD", "2026-08-06"]), 2).length, 0);
});

test("no mentions means no gaps", () => {
  assert.deepEqual(findGaps([], rows(["AMD", "2026-08-04"])), []);
});
