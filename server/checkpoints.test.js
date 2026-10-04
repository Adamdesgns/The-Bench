// checkpoints.test.js — which horizons are due for a row on a given date.
// Pure date arithmetic, no network, no fs.

import test from "node:test";
import assert from "node:assert/strict";

import {
  HORIZON_DAYS,
  checkpointDate,
  dueCheckpoints,
  settledCheckpoints,
  isBookClosed,
  closeOnOrBefore,
  reviewDay
} from "./checkpoints.js";

test("the three horizons are 7, 30 and 90 calendar days", () => {
  assert.deepEqual(HORIZON_DAYS, { "1w": 7, "1m": 30, "3m": 90 });
});

test("checkpointDate adds calendar days to the review date", () => {
  const row = { date: "2026-06-30" };
  assert.equal(checkpointDate(row, "1w"), "2026-07-07");
  assert.equal(checkpointDate(row, "1m"), "2026-07-30");
  assert.equal(checkpointDate(row, "3m"), "2026-09-28");
});

test("only the horizons that have actually elapsed are due", () => {
  const row = { date: "2026-06-30" };
  assert.deepEqual(dueCheckpoints(row, "2026-07-28"), ["1w"]);
  assert.deepEqual(dueCheckpoints(row, "2026-07-30"), ["1w", "1m"]);
  assert.deepEqual(dueCheckpoints(row, "2026-09-28"), ["1w", "1m", "3m"]);
});

test("a checkpoint is due on the day it lands, not the day after", () => {
  assert.deepEqual(dueCheckpoints({ date: "2026-06-30" }, "2026-07-07"), ["1w"]);
});

test("a row reviewed today has no checkpoints due", () => {
  assert.deepEqual(dueCheckpoints({ date: "2026-07-28" }, "2026-07-28"), []);
});

test("checkpoints already recorded are not due again — scoring is append-only", () => {
  const row = {
    date: "2026-06-30",
    checkpoints: { "1w": { verdict: "right" } }
  };
  assert.deepEqual(dueCheckpoints(row, "2026-07-30"), ["1m"]);
});

test("a checkpoint recorded as not_scorable is due again — a placeholder must not freeze the row", () => {
  const row = {
    date: "2026-06-30",
    checkpoints: { "1w": { verdict: "not_scorable", note: "trigger level not recorded" } }
  };
  assert.deepEqual(dueCheckpoints(row, "2026-07-28"), ["1w"]);
});

test("a real verdict is never due again, even when a later run could reach it", () => {
  const row = { date: "2026-06-30", checkpoints: { "1w": { verdict: "wrong", alpha: -3 } } };
  assert.deepEqual(dueCheckpoints(row, "2026-07-28"), []);
});

test("a row with every checkpoint settled has nothing due", () => {
  const row = {
    date: "2026-06-30",
    checkpoints: {
      "1w": { verdict: "right" },
      "1m": { verdict: "wrong" },
      "3m": { verdict: "flat" }
    }
  };
  assert.deepEqual(dueCheckpoints(row, "2026-12-01"), []);
});

test("a row is closed once it carries an outcome", () => {
  assert.equal(isBookClosed({ outcome: "Loss" }), true);
  assert.equal(isBookClosed({ outcome: null }), false);
});

test("a closed row has no checkpoints due even if horizons have elapsed", () => {
  const row = { date: "2026-06-30", outcome: "Loss" };
  assert.deepEqual(dueCheckpoints(row, "2026-12-01"), []);
});

// ---- closeOnOrBefore ----
// A checkpoint can land on a weekend or a holiday. Both the asset and its
// benchmark resolve to the nearest PRIOR close so the two sides stay aligned.

const bars = [
  { date: "2026-07-02", close: 100 },
  { date: "2026-07-03", close: 101 },
  { date: "2026-07-06", close: 105 } // Jul 4-5 is a weekend
];

test("closeOnOrBefore returns the exact bar when the date is a trading day", () => {
  assert.deepEqual(closeOnOrBefore(bars, "2026-07-03"), { date: "2026-07-03", close: 101 });
});

test("closeOnOrBefore falls back to the nearest prior close on a weekend", () => {
  assert.deepEqual(closeOnOrBefore(bars, "2026-07-05"), { date: "2026-07-03", close: 101 });
});

test("closeOnOrBefore returns null when the date precedes all known bars", () => {
  assert.equal(closeOnOrBefore(bars, "2026-06-01"), null);
});

test("closeOnOrBefore returns null on an empty series rather than inventing a price", () => {
  assert.equal(closeOnOrBefore([], "2026-07-03"), null);
});

// ---- settledCheckpoints ----

test("settled checkpoints are the ones carrying a real verdict", () => {
  const row = {
    date: "2026-06-30",
    checkpoints: { "1w": { verdict: "wrong" }, "1m": { verdict: "not_scorable" }, "3m": { verdict: "flat" } }
  };
  assert.deepEqual(settledCheckpoints(row), ["1w", "3m"]);
  assert.deepEqual(settledCheckpoints({ date: "2026-06-30" }), []);
});

// ---- reviewDay ----
// 42 rows carry a review_time dated before row.date (logged the evening before,
// or over a weekend). The logged price belongs to that earlier session, so the
// benchmark leg and the split test both have to start there.

test("a row with no review_time was reviewed on its own date", () => {
  assert.equal(reviewDay({ date: "2026-09-10" }), "2026-09-10");
  assert.equal(reviewDay({ date: "2026-09-10", review_time: "" }), "2026-09-10");
});

test("a time-only review_time falls back to the row date", () => {
  assert.equal(reviewDay({ date: "2026-09-10", review_time: "13:32 CT" }), "2026-09-10");
});

test("an ISO stamp with an offset resolves to its New York calendar day", () => {
  assert.equal(reviewDay({ date: "2026-09-23", review_time: "2026-09-22T20:50:00-05:00" }), "2026-09-22");
  assert.equal(reviewDay({ date: "2026-08-09", review_time: "2026-08-07T19:59:59Z" }), "2026-08-07");
});

test("a UTC stamp past midnight still belongs to the New York evening before", () => {
  assert.equal(reviewDay({ date: "2026-09-24", review_time: "2026-09-24T01:30:00Z" }), "2026-09-23");
});

test("a written date leads the free-text forms the desk uses", () => {
  assert.equal(reviewDay({ date: "2026-09-10", review_time: "2026-09-09 21:52 CT after the close (official close 196.20)" }), "2026-09-09");
  assert.equal(reviewDay({ date: "2026-07-16", review_time: "Jul 15 close" }), "2026-07-15");
  assert.equal(reviewDay({ date: "2026-09-10", review_time: "2026-09-10 11:59 CT midday" }), "2026-09-10");
});

test("a review date after the row date, or more than a week before it, is not trusted", () => {
  assert.equal(reviewDay({ date: "2026-09-10", review_time: "2026-09-12 09:00 CT" }), "2026-09-10");
  assert.equal(reviewDay({ date: "2026-09-10", review_time: "2026-08-01 close" }), "2026-09-10");
});
