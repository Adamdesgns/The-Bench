// crowd.test.mjs — the crowd log: how hot the FOMO is, why people say they are buying, and what happened next. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  whyBuckets, dominantWhy, fomoScore, fomoLabel, parseStocktwits, apeRow, trendingRank, volumePace, sampleQuotes,
  appendCapture, alreadyCaptured, fillOutcomes, buildCrowdReport, nightlySymbols, recordLines,
} from "../scripts/crowd.mjs";

const hits = (body) => Object.entries(whyBuckets([body]).counts).filter(([, n]) => n).map(([k]) => k);

test("people talking about the print are a catalyst reason", () => assert.deepEqual(hits("earnings tonight, this report matters"), ["catalyst"]));
test("the chart talk is momentum", () => assert.deepEqual(hits("breakout above resistance"), ["momentum"]));
test("squeeze talk is its own reason", () => assert.deepEqual(hits("short squeeze, shorts are trapped"), ["squeeze"]));
test("fear of missing it is FOMO language", () => assert.deepEqual(hits("dont miss this, last chance"), ["fomo"]));
test("the rocket emoji counts as FOMO language, the word rocket does not", () => {
  assert.deepEqual(hits("🚀🚀"), ["fomo"]);
  assert.deepEqual(hits("the rocket deal"), []);
});
test("the business is a fundamental reason", () => assert.deepEqual(hits("the Verizon contract and spectrum"), ["fundamental"]));
test("an analyst move is its own reason", () => assert.deepEqual(hits("price target raised, upgrade"), ["analyst"]));
test("buying weakness is dip buying", () => assert.deepEqual(hits("bought the dip, oversold"), ["dip"]));
test("option contracts are options talk, not a business contract", () => {
  assert.deepEqual(hits("bought 10 contracts of the 40 calls"), ["options"]);
});
test("an earnings call is not an option", () => assert.deepEqual(hits("earnings call tonight"), ["catalyst"]));
test("a message can give two reasons", () => assert.deepEqual(hits("earnings tonight, loading up"), ["catalyst", "fomo"]));
test("small talk gives no reason", () => assert.deepEqual(hits("nice weather today"), []));
test("a link is not a reason", () => assert.deepEqual(hits("look https://x.co/news/earnings/abc"), []));
test("a handle is not a reason", () => assert.deepEqual(hits("hey @moon_news"), []));
for (const body of ["Q2 call went well", "tough call", "margin call again", "labor strike", "I put the whole plan down"]) {
  test(`"${body}" is not options talk`, () => assert.deepEqual(hits(body), []));
}
test("a strike-and-letter order is options talk", () => assert.deepEqual(hits("1 contract of the 40c"), ["options"]));
test("contracts the company won are the business", () => assert.deepEqual(hits("won two new government contracts"), ["fundamental"]));
test("taking profits is not the business making them", () => {
  assert.deepEqual(hits("taking profits here"), []);
  assert.deepEqual(hits("real profits this year"), ["fundamental"]);
});
for (const body of ["all in all it was fine", "all in cash now", "the moon landing"]) {
  test(`"${body}" is not FOMO talk`, () => assert.deepEqual(hits(body), []));
}
test("the next-NVDA line counts with a cashtag", () => assert.deepEqual(hits("this is the next $NVDA"), ["fomo"]));
test("the bottom line is not a bottom", () => assert.deepEqual(hits("the bottom line is nice"), []));
test("dips and dipping are dip buying", () => {
  assert.deepEqual(hits("buying dips"), ["dip"]);
  assert.deepEqual(hits("it is dipping"), ["dip"]);
});

test("shares are out of all the messages", () => {
  const r = whyBuckets(["earnings tonight", "earnings soon", "hello", "yolo"]);
  assert.equal(r.n, 4);
  assert.equal(r.shares.catalyst, 50);
  assert.equal(r.shares.fomo, 25);
});

test("the main reason ignores FOMO language, which is how they feel and not why", () => {
  assert.equal(dominantWhy({ catalyst: 3, fomo: 5, momentum: 1 }), "catalyst");
  assert.equal(dominantWhy({ catalyst: 0, fomo: 5 }), null);
});

test("a tie has no main reason", () => assert.equal(dominantWhy({ catalyst: 2, dip: 2 }, 30), null));
test("a handful of messages has no main reason", () => assert.equal(dominantWhy({ catalyst: 3 }, 4), null));

test("a number that is not a number counts as a failed input", () => {
  const r = fomoScore({ moveAtr: NaN, pace: 2, trendingRank: 1, onTrendingList: true, mentions: 30, mentions24h: 15, bullShare: 75, tagged: 20, fomoShare: 15, n: 30 });
  assert.equal(r.inputs.price, null);
  assert.equal(r.used, 5);
  assert.equal(fomoLabel(NaN), null);
});

test("the printed read can leave the quotes out", () => {
  const rec = { sym: "A", price: 1, pct_today: 1, spy_pct_today: 1, volume_pace: 1, fomo: { score: 1, label: "Quiet", inputs: { price: 1 } }, why: { n: 1, shares: {} }, stocktwits: null, ape: null, samples: ["a quote"], sources: {} };
  assert.ok(recordLines(rec).some((l) => l.includes("a quote")));
  assert.ok(!recordLines(rec, { samples: false }).some((l) => l.includes("a quote")));
});

test("the FOMO score is the mean of its inputs and every input is shown", () => {
  const r = fomoScore({ moveAtr: 1, pace: 2, trendingRank: 1, onTrendingList: true, mentions: 30, mentions24h: 15, bullShare: 75, tagged: 20, fomoShare: 15, n: 30 });
  assert.deepEqual(r.inputs, { price: 50, volume: 50, trending: 100, mentions: 50, bulls: 50, fomo_talk: 50 });
  assert.equal(r.score, 58);
  assert.equal(r.label, "Hot");
});

test("inputs top out at 100 and a falling stock scores zero on price", () => {
  const r = fomoScore({ moveAtr: -3, pace: 9, trendingRank: null, onTrendingList: false, mentions: 90, mentions24h: 10, bullShare: 100, tagged: 20, fomoShare: 80, n: 30 });
  assert.deepEqual(r.inputs, { price: 0, volume: 100, trending: 0, mentions: 100, bulls: 100, fomo_talk: 100 });
});

test("a source that failed is left out, never counted as zero", () => {
  const r = fomoScore({ moveAtr: 2, pace: 3, trendingRank: 1, onTrendingList: true, mentions: null, mentions24h: null, bullShare: null, tagged: 0, fomoShare: null, n: 0 });
  assert.equal(r.inputs.mentions, null);
  assert.equal(r.inputs.bulls, null);
  assert.equal(r.score, 100);
  assert.equal(r.used, 3);
});

test("with fewer than three inputs there is no score", () => {
  const r = fomoScore({ moveAtr: 1, pace: 2, trendingRank: null, onTrendingList: null, mentions: null, mentions24h: null, bullShare: null, tagged: 0, fomoShare: null, n: 0 });
  assert.equal(r.score, null);
  assert.equal(r.label, null);
});

test("a handful of tagged messages is too few to read", () => {
  const r = fomoScore({ moveAtr: 1, pace: 2, trendingRank: 1, onTrendingList: true, mentions: 30, mentions24h: 15, bullShare: 100, tagged: 4, fomoShare: 100, n: 4 });
  assert.equal(r.inputs.bulls, null);
  assert.equal(r.inputs.fomo_talk, null);
});

test("a name that was silent yesterday and is talked about today is at full mention heat", () => {
  const r = fomoScore({ moveAtr: 1, pace: 2, trendingRank: 1, onTrendingList: true, mentions: 12, mentions24h: 0, bullShare: 75, tagged: 20, fomoShare: 15, n: 30 });
  assert.equal(r.inputs.mentions, 100);
});

test("the labels run quiet, warming, hot, euphoric", () => {
  assert.deepEqual([24, 25, 50, 75].map(fomoLabel), ["Quiet", "Warming", "Hot", "Euphoric"]);
});

test("the Stocktwits stream is reduced to counts and bodies, with no usernames kept", () => {
  const json = { symbol: { watchlist_count: 72488 }, messages: [
    { id: 1, body: "a", created_at: "2026-11-09T16:00:00Z", user: { username: "someone" }, entities: { sentiment: { basic: "Bullish" } } },
    { id: 2, body: "b", created_at: "2026-11-09T16:30:00Z", user: { username: "other" }, entities: { sentiment: { basic: "Bearish" } } },
    { id: 3, body: "c", created_at: "2026-11-09T17:00:00Z", user: { username: "third" }, entities: { sentiment: null } },
  ] };
  const r = parseStocktwits(json);
  assert.deepEqual({ w: r.watchers, n: r.n, bull: r.bull, bear: r.bear, tagged: r.tagged, mph: r.msgs_per_hour, share: r.bull_share }, { w: 72488, n: 3, bull: 1, bear: 1, tagged: 2, mph: 3, share: 50 });
  assert.deepEqual(r.bodies, ["a", "b", "c"]);
  assert.doesNotMatch(JSON.stringify(r), /someone/);
});

test("one account posting five times is one voice, however loud", () => {
  const spam = Array.from({ length: 5 }, (_, i) => ({ id: i, body: `LOTTO ${i} yolo`, created_at: `2026-11-09T16:0${i}:00Z`, user: { id: 7 }, entities: { sentiment: { basic: "Bullish" } } }));
  const other = { id: 9, body: "fair value here", created_at: "2026-11-09T16:09:00Z", user: { id: 8 }, entities: { sentiment: { basic: "Bearish" } } };
  const r = parseStocktwits({ messages: [...spam, other] });
  assert.equal(r.n, 6);
  assert.equal(r.authors, 2);
  assert.equal(r.tagged, 2);
  assert.equal(r.bull_share, 50);
  assert.equal(r.bodies.length, 2);
});

test("Stocktwits' web escapes are undone so that don't miss still reads as don't miss", () => {
  const r = parseStocktwits({ messages: [{ id: 1, body: "don&#39;t miss &amp; hold", created_at: "2026-11-09T16:00:00Z" }] });
  assert.deepEqual(r.bodies, ["don't miss & hold"]);
  assert.equal(whyBuckets(r.bodies).counts.fomo, 1);
});

test("the sample quotes drop other people's handles", () => {
  assert.deepEqual(sampleQuotes(["LFG @Tommojg to the moon"]), ["LFG to the moon"]);
});

test("the ApeWisdom row is found by ticker and its strings become numbers", () => {
  const list = [{ ticker: "OTHER", rank: 1, mentions: "5" }, { ticker: "ASTS", rank: 10, mentions: "45", mentions_24h_ago: "18", upvotes: "159", rank_24h_ago: "31" }];
  assert.deepEqual(apeRow(list, "ASTS"), { rank: 10, mentions: 45, mentions_24h_ago: 18, upvotes: 159, rank_24h_ago: 31 });
  assert.equal(apeRow(list, "NOPE"), null);
});

test("the trending rank is the position on the list, or null off it", () => {
  const json = { symbols: [{ symbol: "AAA" }, { symbol: "ASTS" }] };
  assert.equal(trendingRank(json, "ASTS"), 2);
  assert.equal(trendingRank(json, "ZZZ"), null);
});

test("volume pace compares today with the share of a normal day that has passed", () => {
  assert.equal(volumePace({ today: 1000, avg: 2000, elapsed: 0.25 }), 2);
  assert.equal(volumePace({ today: 1000, avg: 0, elapsed: 0.25 }), null);
  assert.equal(volumePace({ today: 1000, avg: 2000, elapsed: 0 }), null);
});

test("the sample quotes put a reason first, drop links and stay short", () => {
  const q = sampleQuotes(["hello there", "yolo https://x.co/abc all in", "earnings tonight " + "x".repeat(200)], { max: 2, len: 40 });
  assert.equal(q.length, 2);
  assert.equal(q[0], "yolo all in");
  assert.ok(q[1].length <= 40);
  assert.ok(q[1].startsWith("earnings tonight"));
});

test("captures get the next id and the log only grows", () => {
  const db = { captures: [] };
  appendCapture(db, { sym: "A", date: "2026-11-09" });
  appendCapture(db, { sym: "B", date: "2026-11-09" });
  assert.deepEqual(db.captures.map((c) => c.id), ["CR-001", "CR-002"]);
});

test("the nightly run does not capture a name twice on one date", () => {
  const db = { captures: [{ sym: "A", date: "2026-11-09", source: "nightly" }, { sym: "B", date: "2026-11-09", source: "interactive" }] };
  assert.equal(alreadyCaptured(db, "A", "2026-11-09", "nightly"), true);
  assert.equal(alreadyCaptured(db, "B", "2026-11-09", "nightly"), false);
});

const day = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const series = (closes) => closes.map((c, i) => ({ d: day(i), c }));

test("outcomes are measured against SPY from the capture price, in sessions", () => {
  const db = { captures: [{ id: "CR-001", sym: "ZZZ", date: day(0), price: 100, spy_price: 500 }] };
  fillOutcomes(db, { ZZZ: series([100, 110, 120]), SPY: series([500, 505, 510]) });
  assert.deepEqual(db.captures[0].outcomes["1"], { date: day(1), close: 110, pct: 10, spy_pct: 1, vs_spy: 9 });
  assert.equal(db.captures[0].outcomes["5"], undefined);
});

test("an outcome already filled is never rewritten", () => {
  const kept = { date: day(1), close: 1, pct: 1, spy_pct: 1, vs_spy: 0 };
  const db = { captures: [{ id: "CR-001", sym: "ZZZ", date: day(0), price: 100, spy_price: 500, outcomes: { 1: kept } }] };
  fillOutcomes(db, { ZZZ: series([100, 110]), SPY: series([500, 505]) });
  assert.deepEqual(db.captures[0].outcomes["1"], kept);
});

test("a capture with no bars yet is left alone", () => {
  const db = { captures: [{ id: "CR-001", sym: "ZZZ", date: day(0), price: 100, spy_price: 500 }] };
  fillOutcomes(db, { SPY: series([500, 505]) });
  assert.equal(db.captures[0].outcomes, undefined);
});

test("a weekend capture counts from the session its price belongs to", () => {
  const db = { captures: [{ id: "CR-001", sym: "ZZZ", date: day(2), session: day(1), price: 110, spy_price: 505 }] };
  fillOutcomes(db, { ZZZ: series([100, 110, 121]), SPY: series([500, 505, 510]) });
  assert.equal(db.captures[0].outcomes["1"].date, day(2));
  assert.equal(db.captures[0].outcomes["1"].pct, 10);
});

test("a capture older than the bars on hand is left alone", () => {
  const db = { captures: [{ id: "CR-001", sym: "ZZZ", date: "2020-01-01", session: "2020-01-01", price: 100, spy_price: 500 }] };
  fillOutcomes(db, { ZZZ: series([100, 110]), SPY: series([500, 505]) });
  assert.equal(db.captures[0].outcomes, undefined);
});

test("a split after the capture does not read as a crash", () => {
  const db = { captures: [{ id: "CR-001", sym: "ZZZ", date: day(0), session: day(0), price: 100, spy_price: 500 }] };
  fillOutcomes(db, { ZZZ: series([10, 11]), SPY: series([500, 500]) }, { ZZZ: [{ d: day(1), factor: 10 }] });
  assert.equal(db.captures[0].outcomes["1"].pct, 10);
});

const cap = (i, score, pct, why = "catalyst", date = day(i)) => ({ sym: `S${i}`, date, price: 100, fomo: { score }, why: { main: why }, outcomes: { 5: { pct, vs_spy: pct - 1 } } });

test("a failed capture does not hide a good one of the same name that day", () => {
  const caps = [{ ...cap(0, 10, 2), sym: "SAME", price: null }, { ...cap(0, 10, 2), sym: "SAME" }];
  assert.equal(buildCrowdReport(caps, { min: 1 }).horizons["5"].thirds.reduce((p, g) => p + g.n, 0), 1);
});

test("the report compares the coolest, middle and hottest thirds", () => {
  const caps = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((s, i) => cap(i, s, s >= 70 ? -5 : 2));
  const r = buildCrowdReport(caps, { min: 3 }).horizons["5"].thirds;
  assert.deepEqual(r.map((g) => g.name), ["coolest", "middle", "hottest"]);
  assert.deepEqual(r.map((g) => g.n), [3, 3, 3]);
  assert.equal(r[2].median_pct, -5);
  assert.equal(r[2].pct_up, 0);
  assert.equal(r[0].median_vs_spy, 1);
  assert.equal(r[0].hidden, false);
});

test("a group from too few dates is hidden, however many rows it has", () => {
  const caps = [10, 20, 30, 40, 50, 60].map((s, i) => cap(i, s, 1, "catalyst", day(0)));
  const r = buildCrowdReport(caps, { min: 3 }).horizons["5"].thirds;
  assert.ok(r.every((g) => g.hidden));
  assert.ok(r.every((g) => g.median_pct === null));
});

test("two captures of one name on one date count once, the earliest", () => {
  const caps = [cap(0, 10, 2), { ...cap(0, 90, 50), time: "later" }, cap(1, 20, 2), cap(2, 30, 2)].map((c, i) => ({ ...c, sym: i < 2 ? "SAME" : c.sym }));
  const r = buildCrowdReport(caps, { min: 1 }).horizons["5"].thirds;
  assert.equal(r.reduce((p, g) => p + g.n, 0), 3);
  assert.ok(r.every((g) => g.median_pct === 2), "the later capture of the same name must not be counted");
});

test("the report also splits by the main reason people gave", () => {
  const caps = [cap(0, 10, 4, "dip"), cap(1, 20, 6, "dip"), cap(2, 30, 8, "dip"), cap(3, 40, -3, "squeeze"), cap(4, 50, -3, "squeeze"), cap(5, 60, -3, "squeeze")];
  const why = buildCrowdReport(caps, { min: 3 }).horizons["5"].why;
  assert.equal(why.find((g) => g.name === "dip").median_pct, 6);
  assert.equal(why.find((g) => g.name === "squeeze").median_pct, -3);
});

test("the nightly list is stack names, then pump watches, then the day's book rows, once each and capped", () => {
  const list = nightlySymbols({
    stack: { names: { ASTS: {}, AMZN: {} } },
    pump: { watches: [{ ticker: "AMZN", date: "2026-11-09" }, { ticker: "GOOGL", date: "2026-11-09" }, { ticker: "OLD", date: "2026-11-01" }] },
    book: [{ ticker: "CASH", date: "2026-11-09" }, { ticker: "BOOK", date: "2026-11-09" }, { ticker: "TRX", date: "2026-11-09" }, { ticker: "ZEC", date: "2026-11-09" }, { ticker: "NVDA", date: "2026-11-09" }, { ticker: "MARKET", date: "2026-11-09" }, { ticker: "SPY", date: "2026-11-09" }, { ticker: "BTC-USD", date: "2026-11-09" }, { ticker: "PAST", date: "2026-11-02" }],
    date: "2026-11-09", cap: 4,
  });
  assert.deepEqual(list, ["ASTS", "AMZN", "GOOGL", "NVDA"]);
});

// The command line, on a throwaway log and frozen source data.
test("capture writes one record with the note, the score and the reasons", () => {
  const dir = mkdtempSync(join(tmpdir(), "crowd-"));
  const db = join(dir, "log.json"), sources = join(dir, "src.json");
  const daily = [...Array.from({ length: 30 }, (_, i) => ({ d: day(i), o: 30, h: 31, l: 29, c: 30, v: 1000 })), { d: "2026-11-09", o: 30, h: 90, l: 20, c: 36, v: 999999 }]; // the capture day itself must not count
  const messages = Array.from({ length: 20 }, (_, i) => ({ id: i, body: i % 2 ? "earnings tonight" : "yolo", created_at: new Date(Date.UTC(2026, 10, 9, 16, i)).toISOString(), entities: { sentiment: { basic: "Bullish" } } }));
  writeFileSync(sources, JSON.stringify({
    ASTS: { price: 36, prev_close: 30, today_volume: 2000, elapsed: 0.5, daily, stocktwits: { symbol: { watchlist_count: 5 }, messages }, rss: "<rss><item><title>ASTS jumps</title></item></rss>" },
    SPY: { price: 505, prev_close: 500 },
    trending: { symbols: [{ symbol: "ASTS" }] },
    ape: [{ ticker: "ASTS", rank: 3, mentions: "30", mentions_24h_ago: "10", upvotes: "9", rank_24h_ago: "8" }],
    now: { date: "2026-11-09" },
  }));
  const r = spawnSync(process.execPath, ["scripts/crowd.mjs", "capture", "--symbols", "ASTS", "--note", "Adam's screenshot of an X post", "--write", "--db", db, "--sources-file", sources], { encoding: "utf8", env: { ...process.env, BENCH_NO_PUSH: "1" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /CR-001/);
  const rec = JSON.parse(readFileSync(db, "utf8")).captures[0];
  assert.equal(rec.sym, "ASTS");
  assert.equal(rec.note, "Adam's screenshot of an X post");
  assert.equal(rec.price, 36);
  assert.equal(rec.pct_today, 20);
  assert.equal(rec.spy_pct_today, 1);
  assert.equal(rec.volume_pace, 4); // 2,000 traded by mid-session against a 1,000 average
  assert.equal(rec.atr, 2);
  assert.equal(rec.session, "2026-11-09");
  assert.equal(rec.fomo.inputs.trending, 100);
  assert.equal(rec.why.main, "catalyst");
  assert.equal(rec.news.headlines[0].title, "ASTS jumps");
  assert.equal(rec.sources.stocktwits, "ok");
});

const run2 = (src, ...args) => {
  const dir = mkdtempSync(join(tmpdir(), "crowd-"));
  const db = join(dir, "log.json"), sources = join(dir, "src.json");
  writeFileSync(sources, JSON.stringify(src));
  const r = spawnSync(process.execPath, ["scripts/crowd.mjs", "capture", ...args, "--write", "--db", db, "--sources-file", sources], { encoding: "utf8" });
  return { r, captures: () => JSON.parse(readFileSync(db, "utf8")).captures };
};
const okName = { price: 36, prev_close: 30, today_volume: 2000, elapsed: 0.5, daily: [], stocktwits: null, rss: "" };

test("an empty ApeWisdom list is a failed source, not zero mentions", () => {
  const { captures } = run2({ ASTS: okName, SPY: { price: 505, prev_close: 500 }, trending: { symbols: [{ symbol: "X" }] }, ape: [], now: { date: "2026-11-09" } }, "--symbols", "ASTS");
  assert.equal(captures()[0].fomo.inputs.mentions, null);
  assert.notEqual(captures()[0].sources.ape, "ok");
});

test("an empty trending list is a failed source, not off the list", () => {
  const { captures } = run2({ ASTS: okName, SPY: { price: 505, prev_close: 500 }, trending: { symbols: [] }, ape: [{ ticker: "X", mentions: "1" }], now: { date: "2026-11-09" } }, "--symbols", "ASTS");
  assert.equal(captures()[0].fomo.inputs.trending, null);
  assert.notEqual(captures()[0].sources.trending, "ok");
});

test("a broken news feed loses the headlines and keeps the record", () => {
  const rss = "<rss><item><title>x</title><pubDate>garbage</pubDate></item></rss>";
  const { r, captures } = run2({ ASTS: { ...okName, rss }, SPY: { price: 505, prev_close: 500 }, trending: null, ape: null, now: { date: "2026-11-09" } }, "--symbols", "ASTS");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(captures()[0].news.count, 0);
  assert.notEqual(captures()[0].sources.news, "ok");
});

test("one name that fails does not lose the names around it", () => {
  const { r, captures } = run2({ ASTS: okName, SPY: { price: 505, prev_close: 500 }, trending: null, ape: null, now: { date: "2026-11-09" } }, "--symbols", "BAD,ASTS");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BAD/);
  assert.deepEqual(captures().map((c) => c.sym), ["ASTS"]);
});

test("a missing previous close leaves the day's change blank", () => {
  const { captures } = run2({ ASTS: { ...okName, prev_close: null }, SPY: { price: 505, prev_close: 500 }, trending: null, ape: null, now: { date: "2026-11-09" } }, "--symbols", "ASTS");
  assert.equal(captures()[0].pct_today, null);
});

test("a dry run prints the read and writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "crowd-"));
  const db = join(dir, "log.json"), sources = join(dir, "src.json");
  writeFileSync(sources, JSON.stringify({ ZZZ: { price: 10, prev_close: 10, today_volume: 1, elapsed: 1, daily: [], stocktwits: null, rss: "" }, SPY: { price: 500, prev_close: 500 }, trending: null, ape: null, now: { date: "2026-11-09" } }));
  const r = spawnSync(process.execPath, ["scripts/crowd.mjs", "capture", "--symbols", "ZZZ", "--db", db, "--sources-file", sources], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ZZZ/);
  assert.throws(() => readFileSync(db, "utf8"));
});
