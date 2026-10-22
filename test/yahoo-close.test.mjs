// yahoo-close.test.mjs — the shared "null close on the newest daily bar" fix. Pure, no network.
//
// Origin: 2026-10-14 19:10 CT. Yahoo's chart API returned today's daily bar with close = null
// (open/high/low/volume present) while meta.regularMarketPrice already held the settled price.
// regime.mjs skipped the null bar and stamped "as of 2026-10-13", naming CPI (10/15) instead of
// PPI as the next-session macro event.
import { test } from "node:test";
import assert from "node:assert/strict";

import { settledCloses, CLOSE_GRACE_SEC } from "../server/yahooClose.js";

// 2026-10-14 (EDT = UTC-4). Regular session 09:30-16:00 ET = 13:30Z-20:00Z.
const BAR_TS = Date.parse("2026-10-14T13:30:00Z") / 1000;
const PREV_TS = Date.parse("2026-10-13T13:30:00Z") / 1000;
const SESSION_START = BAR_TS;
const SESSION_END = Date.parse("2026-10-14T20:00:00Z") / 1000;
const at = (iso) => new Date(iso);

function chart({ closes = [778.01, null], price = 769.6, rmt = SESSION_END, period = { start: SESSION_START, end: SESSION_END }, tz = "America/New_York", stamps } = {}) {
  const ts = stamps ?? (closes.length === 2 ? [PREV_TS, BAR_TS] : closes.map((_, i) => PREV_TS + i * 86400));
  const meta = { exchangeTimezoneName: tz };
  meta.regularMarketPrice = price;
  meta.regularMarketTime = rmt;
  if (period) meta.currentTradingPeriod = { regular: period };
  return { meta, timestamp: ts, indicators: { quote: [{ close: closes }] } };
}

test("after the close: a null newest close is filled from regularMarketPrice", () => {
  const out = settledCloses(chart(), { now: at("2026-10-15T00:10:00Z") }); // 19:10 CT
  assert.equal(out.filled, true);
  assert.deepEqual(out.closes, [778.01, 769.6]);
});

test("mid-session: a null newest close is NOT filled (the price is not a close yet)", () => {
  const out = settledCloses(chart({ rmt: Date.parse("2026-10-14T16:00:00Z") / 1000 }), { now: at("2026-10-14T16:00:30Z") });
  assert.equal(out.filled, false);
  assert.deepEqual(out.closes, [778.01, null]);
});

test("inside the grace window after the bell: not filled yet; right after it: filled", () => {
  const justAfter = new Date((SESSION_END + CLOSE_GRACE_SEC - 1) * 1000);
  const settled = new Date((SESSION_END + CLOSE_GRACE_SEC) * 1000);
  assert.equal(settledCloses(chart(), { now: justAfter }).filled, false);
  assert.equal(settledCloses(chart(), { now: settled }).filled, true);
});

test("price stamped on an earlier date than the bar: not filled", () => {
  const stale = Date.parse("2026-10-13T20:00:00Z") / 1000;
  const out = settledCloses(chart({ rmt: stale }), { now: at("2026-10-15T00:10:00Z") });
  assert.equal(out.filled, false);
  assert.equal(out.closes.at(-1), null);
});

test("a null in the middle of the series is never filled", () => {
  const out = settledCloses(
    chart({ closes: [1, null, 3], stamps: [PREV_TS - 86400, PREV_TS, BAR_TS] }),
    { now: at("2026-10-15T00:10:00Z") },
  );
  assert.equal(out.filled, false);
  assert.deepEqual(out.closes, [1, null, 3]);
});

test("a real newest close is left exactly as Yahoo sent it", () => {
  const out = settledCloses(chart({ closes: [778.01, 770.25], price: 769.6 }), { now: at("2026-10-15T00:10:00Z") });
  assert.equal(out.filled, false);
  assert.deepEqual(out.closes, [778.01, 770.25]);
});

test("missing or unusable price/meta: not filled, never throws", () => {
  const now = at("2026-10-15T00:10:00Z");
  for (const opts of [{ price: null }, { price: 0 }, { price: -4 }, { price: NaN }, { price: "769.6" }, { rmt: null }, { rmt: NaN }]) {
    assert.equal(settledCloses(chart(opts), { now }).filled, false, String(Object.entries(opts)));
  }
  const noPrice = chart();
  delete noPrice.meta.regularMarketPrice;
  assert.equal(settledCloses(noPrice, { now }).filled, false);
  const noTime = chart();
  delete noTime.meta.regularMarketTime;
  assert.equal(settledCloses(noTime, { now }).filled, false);
  assert.deepEqual(settledCloses(undefined, { now }), { closes: [], filled: false });
  assert.deepEqual(settledCloses({}, { now }), { closes: [], filled: false });
  assert.deepEqual(settledCloses({ timestamp: [BAR_TS], indicators: { quote: [{ close: [null] }] } }, { now }), { closes: [null], filled: false });
});

test("no trading-period block: only a bar from an earlier day can be filled", () => {
  const sameDay = settledCloses(chart({ period: null }), { now: at("2026-10-15T00:10:00Z") }); // still 10/14 in New York
  assert.equal(sameDay.filled, false);
  const nextDay = settledCloses(chart({ period: null }), { now: at("2026-10-15T12:00:00Z") }); // 08:00 ET on 10/15
  assert.equal(nextDay.filled, true);
});

test("trading period already rolled to the next session: the bar's day is over, fill it", () => {
  const nextStart = Date.parse("2026-10-15T13:30:00Z") / 1000;
  const nextEnd = Date.parse("2026-10-15T20:00:00Z") / 1000;
  const out = settledCloses(chart({ period: { start: nextStart, end: nextEnd } }), { now: at("2026-10-15T09:00:00Z") });
  assert.equal(out.filled, true);
});

test("index in a non-New-York zone (VIX, Chicago, closes 15:15 CT)", () => {
  const start = Date.parse("2026-10-14T12:30:00Z") / 1000; // 07:30 CT
  const end = Date.parse("2026-10-14T20:15:00Z") / 1000; // 15:15 CT
  const vix = chart({ closes: [15.27, null], price: 16.87, rmt: end + 1, tz: "America/Chicago", period: { start, end } });
  assert.equal(settledCloses(vix, { now: at("2026-10-14T20:20:00Z") }).filled, false); // 5 min after the 15:15 CT bell: inside the grace window
  assert.equal(settledCloses(vix, { now: at("2026-10-15T00:10:00Z") }).filled, true);
});

test("24/7 market: a null newest bar before the day's end is not filled", () => {
  const dayStart = Date.parse("2026-10-15T00:00:00Z") / 1000;
  const dayEnd = Date.parse("2026-10-15T23:59:00Z") / 1000;
  const btc = chart({ closes: [83095.1, null], stamps: [dayStart - 86400, dayStart], price: 81644.96, rmt: Date.parse("2026-10-15T00:33:25Z") / 1000, tz: "UTC", period: { start: dayStart, end: dayEnd } });
  assert.equal(settledCloses(btc, { now: at("2026-10-15T00:34:00Z") }).filled, false);
});

test("the input payload is never mutated", () => {
  const r = chart();
  const before = JSON.stringify(r);
  settledCloses(r, { now: at("2026-10-15T00:10:00Z") });
  assert.equal(JSON.stringify(r), before);
});
