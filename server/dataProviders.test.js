// dataProviders.test.js — the pure mapping half of the data layer.
//
// The fetch itself is network and is not tested here; the shape-handling is,
// because a provider that quietly returns [] is how 21 rows came back
// "not observable" without anything appearing to fail.

import test from "node:test";
import assert from "node:assert/strict";

import {
  mapYahooBars,
  mapYahooSplits,
  yahooSymbol,
  classify,
  getQuote,
  getDailyCloses,
  NOT_OBSERVABLE
} from "./dataProviders.js";
import { AV } from "./config.js";

// 2026-07-02 and 2026-07-06 as UTC midnights.
const OK = {
  chart: {
    result: [
      {
        timestamp: [1782000000, 1782345600],
        indicators: { quote: [{ close: [100.5, 105.25] }] }
      }
    ]
  }
};

test("Yahoo timestamps and closes map to dated bars", () => {
  const bars = mapYahooBars(OK);
  assert.equal(bars.length, 2);
  assert.match(bars[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(bars[0].close, 100.5);
  assert.equal(bars[1].close, 105.25);
});

test("bars with a null close are dropped rather than zero-filled", () => {
  const withGap = {
    chart: {
      result: [
        {
          timestamp: [1782000000, 1782086400, 1782345600],
          indicators: { quote: [{ close: [100.5, null, 105.25] }] }
        }
      ]
    }
  };
  const bars = mapYahooBars(withGap);
  assert.equal(bars.length, 2);
  assert.ok(bars.every((b) => typeof b.close === "number"));
});

test("an error payload maps to no bars rather than throwing", () => {
  assert.deepEqual(mapYahooBars({ chart: { result: null, error: "Not Found" } }), []);
  assert.deepEqual(mapYahooBars({}), []);
  assert.deepEqual(mapYahooBars(null), []);
});

test("a result with no quote block maps to no bars", () => {
  assert.deepEqual(mapYahooBars({ chart: { result: [{ timestamp: [1782000000], indicators: {} }] } }), []);
});

// ---- Yahoo symbols ----
// Checked 2026-10-04 against Robinhood's live quotes: ZEC-USD 1346.52 vs
// 1346.36, HYPE32196-USD 90.93 vs 90.97. Plain HYPE-USD answers 404.

test("crypto maps to its Yahoo pair, with the numbered symbol where Yahoo uses one", () => {
  assert.equal(yahooSymbol("ZEC", classify("ZEC")), "ZEC-USD");
  assert.equal(yahooSymbol("btc", classify("btc")), "BTC-USD");
  assert.equal(yahooSymbol("HYPE", classify("HYPE")), "HYPE32196-USD");
});

test("an equity maps to its own symbol", () => {
  assert.equal(yahooSymbol("googl", classify("googl")), "GOOGL");
});

// ---- split events ----
// The `close` series is split-adjusted, so a price logged before a split sits
// on a different share basis from the series. The events block is how the
// scorer finds out. Fixture: MGN, 1-for-40 on 2026-09-08, 1-for-30 on 2026-09-17.

const WITH_SPLITS = {
  chart: {
    result: [
      {
        timestamp: [1788874200, 1789651800],
        indicators: { quote: [{ close: [3.0, 3.72] }] },
        events: {
          splits: {
            1789651800: { date: 1789651800, numerator: 1, denominator: 30, splitRatio: "1:30" },
            1788874200: { date: 1788874200, numerator: 1, denominator: 40, splitRatio: "1:40" }
          }
        }
      }
    ]
  }
};

test("Yahoo split events map to dated ratios, oldest first", () => {
  assert.deepEqual(mapYahooSplits(WITH_SPLITS), [
    { date: "2026-09-08", numerator: 1, denominator: 40 },
    { date: "2026-09-17", numerator: 1, denominator: 30 }
  ]);
});

test("a payload with no events block maps to no splits", () => {
  assert.deepEqual(mapYahooSplits(OK), []);
  assert.deepEqual(mapYahooSplits(null), []);
});

test("a split event without a usable ratio is dropped rather than guessed", () => {
  const bad = { chart: { result: [{ events: { splits: { 1: { date: 1788874200, numerator: 0, denominator: 30 } } } }] } };
  assert.deepEqual(mapYahooSplits(bad), []);
});

// ---- the dead Stooq fallback (removed 2026-10-04) ----
// Stooq answered 404 on quotes and a bot-wall on history, so both functions
// fell through to "not observable" without saying anything.

test("with no Alpha Vantage key a quote is not observable and says why", { skip: Boolean(AV.key) }, async () => {
  const q = await getQuote("GOOGL");
  assert.equal(q.price, NOT_OBSERVABLE);
  assert.equal(q.source, "none");
  assert.match(q.error, /Alpha Vantage/);
});

test("with no Alpha Vantage key a close series is empty and says why", { skip: Boolean(AV.key) }, async () => {
  const h = await getDailyCloses("GOOGL");
  assert.deepEqual(h.closes, []);
  assert.equal(h.source, "none");
  assert.match(h.error, /Alpha Vantage/);
});
