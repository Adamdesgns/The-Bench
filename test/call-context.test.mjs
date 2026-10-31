// call-context.test.mjs — no look-ahead, verdict picking, parsing and the report. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";

import { outcomeOf, asOfIndex, featuresAt, relStrength, fngBefore, parseRss, earningsDistance, buildReport, vixBand,
  instrument, fngSeries, yahooBars, needsRetry, mergeContext } from "../scripts/call-context.mjs";

const day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10);
const series = (closes) => closes.map((c, i) => ({ date: day(i), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 + i }));

test("as-of index is the last bar strictly BEFORE the call date: the call day never leaks in", () => {
  const b = series([10, 11, 12, 13]);
  assert.equal(asOfIndex(b, day(2)), 1);
  assert.equal(asOfIndex(b, day(0)), -1);
  assert.equal(asOfIndex(b, "2030-01-01"), 3);
  const f = featuresAt(b, asOfIndex(b, day(3)));
  assert.equal(f.asof, day(2));
  assert.equal(f.close, 12);                               // not 13, the call-day close
});

test("features: returns, moving-average distance and relative strength", () => {
  const b = series(Array.from({ length: 260 }, (_, i) => 100 + i));
  const f = featuresAt(b, 259);
  assert.equal(f.ret_1d, +((359 / 358 - 1) * 100).toFixed(2));
  assert.equal(f.ret_20d, +((359 / 339 - 1) * 100).toFixed(2));
  assert.ok(f.vs_sma50 > 0 && f.vs_sma200 > f.vs_sma50);
  assert.ok(f.from_52w_high <= 0);
  const rs = relStrength({ ret_5d: 5, ret_20d: 10, ret_60d: 3 }, { ret_5d: 1, ret_20d: 4, ret_60d: 5 });
  assert.deepEqual(rs, { rs_5: 4, rs_20: 6, rs_60: -2 });
});

test("outcome: the most advanced right/wrong/flat checkpoint wins; not_scorable is skipped", () => {
  const row = { checkpoints: {
    "1w": { verdict: "right", alpha: 2, asset_pct: 3 },
    "1m": { verdict: "not_scorable" }
  } };
  const o = outcomeOf(row);
  assert.equal(o.result, "right");
  assert.equal(o.horizon, "1w");
  assert.equal(o.checkpoints["1m"].verdict, "not_scorable");
  assert.equal(outcomeOf({ checkpoints: { "1w": { verdict: "wrong" }, "1m": { verdict: "flat" } } }).result, "flat");
  assert.equal(outcomeOf({}).result, null);                // open calls stay unscored, never guessed
});

test("Fear & Greed is read from the day before the call", () => {
  const s = [{ date: "2026-10-28", score: 30, rating: "fear" }, { date: "2026-10-29", score: 26.2, rating: "fear" }, { date: "2026-10-30", score: 20, rating: "extreme fear" }];
  assert.deepEqual(fngBefore(s, "2026-10-30"), { score: 26.2, rating: "fear", asof: "2026-10-29" });
  assert.equal(fngBefore(s, "2026-10-01"), null);
  assert.equal(vixBand(17.2), "normal (15-20)");
});

test("RSS parsing keeps title, source and the New York publish date", () => {
  const xml = `<rss><channel><item><title><![CDATA[REGN beats &amp; raises - Yahoo Finance]]></title><pubDate>Fri, 30 Oct 2026 02:30:00 GMT</pubDate><source url="x">Yahoo Finance</source></item></channel></rss>`;
  const [h] = parseRss(xml);
  assert.equal(h.title, "REGN beats & raises - Yahoo Finance");
  assert.equal(h.source, "Yahoo Finance");
  assert.equal(h.published, "2026-10-29");                 // 02:30Z is 10:30pm the evening before in New York
});

test("earnings distance counts both ways from the call day: the day before is 1 since, the call day is 0 to go", () => {
  const b = series([1, 2, 3, 4, 5, 6, 7, 8]);
  const e = earningsDistance(b, [day(1), day(5)], day(4));
  assert.equal(e.last_earnings, day(1));
  assert.equal(e.sessions_since_earnings, 3);              // reaction day 1, call day 4
  assert.equal(e.next_earnings, day(5));
  assert.equal(e.sessions_to_earnings, 1);                 // the session after the call
  assert.equal(earningsDistance(b, [day(4)], day(4)).sessions_to_earnings, 0);
  assert.equal(earningsDistance(b, [day(3)], day(4)).sessions_since_earnings, 1);
});

test("instruments: bare coin tickers are coins, VIX is the index, stocks pass through", () => {
  assert.deepEqual(instrument("BTC"), { sym: "BTC-USD", kind: "crypto", news: "bitcoin", coin: "BTC" });
  assert.equal(instrument("HYPE").sym, "HYPE32196-USD");
  assert.equal(instrument("TRX").sym, "TRX-USD");          // Tron, not TRX Gold
  assert.equal(instrument("btc-usd").sym, "BTC-USD");
  assert.equal(instrument("VIX").sym, "^VIX");
  assert.deepEqual(instrument("REGN"), { sym: "REGN", kind: "stock", news: "REGN stock" });
});

test("Fear & Greed points are dated in UTC, so Friday's reading is Friday's", () => {
  const s = fngSeries({ fear_and_greed_historical: { data: [{ x: Date.UTC(2026, 9, 30), y: 26.2, rating: "fear" }, { x: Date.UTC(2026, 9, 29), y: 30.7, rating: "fear" }] } });
  assert.deepEqual(s.map((p) => p.date), ["2026-10-30", "2026-10-29"]);
  assert.equal(fngBefore(s, "2026-10-30").score, 30.7);    // a call on 10/30 sees the 10/29 reading
});

test("Yahoo bars: US listings dated in New York, crypto in UTC, and a null evening close taken from meta", () => {
  const t0 = Date.UTC(2026, 9, 29, 13, 30) / 1000, t1 = Date.UTC(2026, 9, 30, 13, 30) / 1000;
  const us = yahooBars({ chart: { result: [{ meta: { exchangeTimezoneName: "America/New_York", regularMarketPrice: 928.61, regularMarketTime: t1 + 23400, regularMarketDayHigh: 935, regularMarketDayLow: 869 },
    timestamp: [t0, t1], indicators: { quote: [{ open: [826, 869], high: [828, 935], low: [811, 869], close: [818.77, null], volume: [1, 2] }] } }] } });
  assert.deepEqual(us.map((b) => [b.date, b.close]), [["2026-10-29", 818.77], ["2026-10-30", 928.61]]);
  const c0 = Date.UTC(2026, 9, 30, 0, 0) / 1000;            // a coin's 10/30 UTC bar starts 8pm New York 10/29
  const btc = yahooBars({ chart: { result: [{ meta: { exchangeTimezoneName: "UTC" }, timestamp: [c0], indicators: { quote: [{ open: [1], high: [1], low: [1], close: [1], volume: [1] }] } }] } });
  assert.equal(btc[0].date, "2026-10-30");
});

test("retry and merge: failed parts are retried; a live social snapshot is never overwritten", () => {
  assert.equal(needsRetry(undefined), true);
  assert.equal(needsRetry({ context: { data_ok: { market: true, fng: true, edgar: "ok", bars: true } } }), false);
  assert.equal(needsRetry({ context: { data_ok: { market: false } } }), true);
  assert.equal(needsRetry({ context: { news: { error: "google news 429" }, data_ok: {} } }), true);
  assert.equal(needsRetry({ context: { data_ok: { edgar: "no-cik" } } }), false);   // not a filer: nothing to fix
  assert.equal(needsRetry({ retries: 5, context: { data_ok: { bars: false } } }), false);
  const prev = { mode: "live", social: { stocktwits: { watchers: 10 } }, social_lag_days: 0, news: { count: 3 } };
  const next = { mode: "backfill", social: null, news: null, data_ok: {} };
  const m = mergeContext(prev, next);
  assert.equal(m.social.stocktwits.watchers, 10);
  assert.equal(m.mode, "live");
  assert.equal(m.news.count, 3);                           // --no-news keeps the earlier news
  assert.equal(mergeContext(prev, { ...next, social: { stocktwits: { watchers: 99 } } }).social.stocktwits.watchers, 10);
});

test("report: compares right vs wrong inside each call type and splits a field into thirds", () => {
  const recs = [];
  for (let i = 0; i < 30; i++) recs.push({ call_type: "long", date: day(i), ticker: "T" + i, outcome: { result: i < 10 ? "right" : "wrong" }, context: { market: { vix: i < 10 ? 12 + i * 0.1 : 25 + i } } });
  for (let i = 0; i < 5; i++) recs.push({ call_type: "pass", date: day(i), outcome: { result: "right" }, context: { market: { vix: 40 } } });
  recs.push({ call_type: "long", date: day(1), outcome: { result: null }, context: { market: { vix: 99 } } });   // unscored: left out
  const [long, pass] = buildReport(recs, { min: 8 });
  assert.equal(long.call_type, "long");
  assert.equal(long.n, 30);
  const vix = long.fields.find((f) => f.label === "VIX");
  assert.ok(vix.right_median < vix.wrong_median);
  assert.equal(vix.thirds[0].win, 100);                    // the calm third were the winners
  assert.equal(vix.thirds[2].win, 0);
  assert.equal(pass.fields.length, 0);                     // 5 passes: below the minimum, no field reported
  assert.equal(buildReport(recs, { type: "LONG" })[0].call_type, "long");
});

test("report: thirds split by rank survive ties, and a third from one or two dates is hidden", () => {
  const recs = [];
  for (let i = 0; i < 30; i++) recs.push({ call_type: "long", date: i < 20 ? day(0) : day(i), ticker: "T" + i, outcome: { result: i % 2 ? "right" : "wrong" }, context: { market: { vix: i < 20 ? 18 : 20 + i } } });
  const vix = buildReport(recs, { min: 8 })[0].fields.find((f) => f.label === "VIX");
  assert.deepEqual(vix.thirds.map((t) => t.n), [10, 10, 10]);   // twenty ties still give three equal thirds
  assert.equal(vix.thirds[0].dates, 1);
  assert.equal(vix.thirds[0].win, null);                    // one date is one market day, not ten samples
  assert.equal(vix.thirds[2].win, 50);
  const same = recs.map((r) => ({ ...r, date: day(Number(r.ticker.slice(1))), ticker: "UBER" }));   // one name re-logged 30 times
  assert.equal(buildReport(same, { min: 8 })[0].fields.find((f) => f.label === "VIX").thirds[2].win, null);
});
