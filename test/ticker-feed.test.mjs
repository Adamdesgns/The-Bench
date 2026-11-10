// ticker-feed.test.mjs - the desktop ticker's pick and quote parsing. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSymbols, parseChart, yahooSymbol, isTicker, isCrypto, feedStamp, GAUGES, DEFAULT_MAX } from "../scripts/ticker-feed.mjs";

const TODAY = "2026-11-09";

test("gauges come first, then pins, pump, stack, hot names hottest first", () => {
  const got = pickSymbols({
    watchlist: [
      { sym: "AAA", status: "WATCH" },
      { sym: "QQQQ", status: "QUEUE" },
      { sym: "HHH", status: "HIGH-ALERT" },
      { sym: "ARM", status: "ARMED" },
    ],
    pump: { watches: [{ ticker: "PPP", date: TODAY, ended: false }] },
    stack: { names: { STK: { sym: "STK" } } },
    pins: { pin: ["PIN"] },
  }, TODAY);
  assert.deepEqual(got.map((x) => `${x.sym}:${x.tag}`), [
    ...GAUGES.map((s) => `${s}:gauge`), "PIN:pin", "PPP:pump", "STK:stack", "HHH:hot", "ARM:hot", "QQQQ:hot",
  ]);
});

test("plain WATCH names and notes that are not tickers stay off", () => {
  const got = pickSymbols({ watchlist: [{ sym: "AAA", status: "WATCH" }, { sym: "52WK-SCREEN", status: "ARMED" }] }, TODAY);
  assert.deepEqual(got.map((x) => x.sym), GAUGES);
});

test("ended and past pump watches drop, upcoming ones show once", () => {
  const got = pickSymbols({ pump: { watches: [
    { ticker: "OLD", date: "2026-11-04", ended: false },
    { ticker: "DONE", date: TODAY, ended: true },
    { ticker: "NVDA", date: "2026-11-10", ended: false },
    { ticker: "NVDA", date: "2026-11-11", ended: false },
  ] } }, TODAY);
  assert.deepEqual(got.filter((x) => x.tag === "pump").map((x) => x.sym), ["NVDA"]);
});

test("hide removes a name anywhere, max caps the list, a killed stack name drops", () => {
  const got = pickSymbols({
    watchlist: [{ sym: "AONE", status: "ARMED" }, { sym: "BONE", status: "ARMED" }],
    stack: { names: { DEAD: { kill: "2026-11-01" } } },
    pins: { hide: ["SMH", "AONE"], max: 3 },
  }, TODAY);
  assert.deepEqual(got.map((x) => x.sym), ["SPY", "QQQ", "BONE"]);
  assert.equal(pickSymbols({}, TODAY).length <= DEFAULT_MAX, true);
});

test("coins map to Yahoo's -USD names, stocks stay as they are", () => {
  assert.equal(yahooSymbol("SOL"), "SOL-USD");
  assert.equal(yahooSymbol("HYPE"), "HYPE32196-USD");
  assert.equal(yahooSymbol("BTC-USD"), "BTC-USD");
  assert.equal(yahooSymbol("NVDA"), "NVDA");
  assert.equal(isTicker("BRK.B"), true);
  assert.equal(isTicker("52WK-SCREEN"), false);
});

const chart = (meta, ts = [], close = []) => ({ chart: { result: [{ meta, timestamp: ts, indicators: { quote: [{ close }] } }] } });
// 2026-11-09 16:00 ET = 21:00 UTC.
const CLOSE_T = Date.UTC(2026, 10, 9, 21, 0) / 1000;

test("regular price and day change, with the after-hours trade after the last regular one", () => {
  const q = parseChart(chart(
    { regularMarketPrice: 100, chartPreviousClose: 80, regularMarketTime: CLOSE_T },
    [CLOSE_T - 300, CLOSE_T + 1800, CLOSE_T + 3600],
    [99, 101, 102],
  ));
  assert.equal(q.price, 100);
  assert.equal(q.pct, 25);
  assert.equal(q.ext.session, "AH");
  assert.equal(q.ext.price, 102);
  assert.ok(Math.abs(q.ext.pct - 2) < 1e-9);
});

test("Yahoo's own change percent wins over the computed one; no bars past the close means no ext", () => {
  const q = parseChart(chart({ regularMarketPrice: 50, chartPreviousClose: 40, regularMarketChangePercent: -1.5, regularMarketTime: CLOSE_T }, [CLOSE_T], [50]));
  assert.equal(q.pct, -1.5);
  assert.equal(q.ext, null);
});

test("a pre-market trade is labelled PRE; crypto never gets an ext", () => {
  const pre = CLOSE_T + 15.5 * 3600; // 07:30 ET the next morning
  const q = parseChart(chart({ regularMarketPrice: 10, chartPreviousClose: 10, regularMarketTime: CLOSE_T }, [pre], [11]));
  assert.equal(q.ext.session, "PRE");
  const c = parseChart(chart({ regularMarketPrice: 10, chartPreviousClose: 10, regularMarketTime: CLOSE_T, instrumentType: "CRYPTOCURRENCY" }, [pre], [11]));
  assert.equal(c.ext, null);
});

test("a chart with no price throws instead of showing a zero", () => {
  assert.throws(() => parseChart(chart({ chartPreviousClose: 10 })), /no price/);
  assert.throws(() => parseChart({}), /no chart/);
});

test("a share class maps to Yahoo's dash form, and only coins count as crypto", () => {
  assert.equal(yahooSymbol("BRK.B"), "BRK-B");
  assert.equal(isCrypto("SOL"), true);
  assert.equal(isCrypto("BTC-USD"), true);
  assert.equal(isCrypto("HYPE"), true);
  assert.equal(isCrypto("NVDA"), false);
});

test("a run where every fetch failed keeps the old time stamp, so old prices never look fresh", () => {
  const OLD = "2026-11-09T20:00:00.000Z", NOW = "2026-11-10T14:31:00.000Z";
  assert.equal(feedStamp([{ stale: true }, { stale: true }], OLD, NOW), OLD);
  assert.equal(feedStamp([{ stale: true }, { stale: false }], OLD, NOW), NOW);
  assert.equal(feedStamp([{ stale: true }], undefined, NOW), NOW);   // nothing older to keep
});
