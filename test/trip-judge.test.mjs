// trip-judge.test.mjs - the filters that decide when a headless Claude run is worth waking. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshBuyCrosses, pickToJudge, recordJudged, lockIsLive, judgePrompt, BLOCKED_TOOLS, LOCK_STALE_MS, stillLive, newCapAlerts, recordCapAlerts } from "../server/tripJudge.js";

const trip = (o) => ({ ticker: "AMZN", kind: "TRIGGER", price: 254.6, dir: "above", src: "B-1", key: "AMZN|TRIGGER|254.6|above", touched: 255, last: 255, ...o });

test("only buy-side kinds wake the judge", () => {
  const out = freshBuyCrosses([trip({}), trip({ kind: "STOP", dir: "below", price: 241, key: "s" }), trip({ kind: "TARGET", key: "t" })], { AMZN: { prev: 250 } });
  assert.deepEqual(out.map((t) => t.kind), ["TRIGGER"]);
});

test("a BUY ZONE below counts when the prior close was above it", () => {
  const z = trip({ kind: "BUY ZONE", dir: "below", price: 231, key: "z", touched: 230 });
  assert.equal(freshBuyCrosses([z], { AMZN: { prev: 240 } }).length, 1);
});

test("a level the stock already lived beyond at the prior close is not fresh", () => {
  const q = trip({ ticker: "QQQ", dir: "below", price: 712.2, key: "q", touched: 693 });
  assert.equal(freshBuyCrosses([q], { QQQ: { prev: 690.49 } }).length, 0);
  assert.equal(freshBuyCrosses([trip({})], { AMZN: { prev: 256 } }).length, 0);
});

test("no prior close, no judge", () => {
  assert.equal(freshBuyCrosses([trip({})], { AMZN: {} }).length, 0);
});

test("one judge per tick, one per ticker per day, none past the cap", () => {
  const today = "2026-11-02";
  const state = { judged: [{ date: today, ticker: "AMZN", key: "a" }, { date: "2026-11-01", ticker: "MU", key: "m" }] };
  const crosses = [trip({ key: "a2", kind: "BUY ZONE" }), trip({ ticker: "MU", key: "m" }), trip({ ticker: "MU", key: "m2" }), trip({ ticker: "VRT", key: "v" })];
  const { pick, skipped } = pickToJudge(crosses, state, today, 4);
  assert.deepEqual(pick.map((t) => t.key), ["m"]);            // AMZN already judged today; MU once; one per tick
  assert.deepEqual(skipped, []);
  const full = { judged: ["A", "B", "C", "D"].map((t) => ({ date: today, ticker: t, key: t })) };
  const capped = pickToJudge(crosses, full, today, 4);
  assert.deepEqual(capped.pick, []);
  assert.deepEqual(capped.skipped.map((t) => t.ticker), ["AMZN", "MU", "VRT"]);
});

test("the cap alert goes out once per ticker per day", () => {
  const today = "2026-11-02";
  const skipped = [trip({ ticker: "MU" }), trip({ ticker: "VRT" })];
  const s1 = recordCapAlerts({}, newCapAlerts(skipped, {}, today), today);
  assert.deepEqual(newCapAlerts(skipped, s1, today), []);
  assert.equal(newCapAlerts(skipped, s1, "2026-11-03").length, 2);
});

test("a level is live only while its row is the ticker's latest, the name is not killed, and it is not a short", () => {
  const rows = [
    { id: "B-1", ticker: "BABA", final_call: "CONDITIONAL SHORT, not a ticket." },
    { id: "B-2", ticker: "AMZN", final_call: "Conditional long, zone 226-231" },
    { id: "B-3", ticker: "MU", final_call: "Conditional breakout" },
    { id: "B-4", ticker: "AMZN", final_call: "PASS - no trade" },
  ];
  assert.equal(stillLive({ ticker: "BABA", src: "B-1" }, rows), false);   // short
  assert.equal(stillLive({ ticker: "AMZN", src: "B-2" }, rows), false);   // a later pass supersedes it
  assert.equal(stillLive({ ticker: "MU", src: "B-3" }, rows), true);
  assert.equal(stillLive({ ticker: "MU", src: "B-3" }, rows, [{ sym: "MU", status: "NO-TRADE" }]), false);
  assert.equal(stillLive({ ticker: "ORCL", src: "watchlist" }, rows, [{ sym: "ORCL", status: "RETIRED" }]), false);
  assert.equal(stillLive({ ticker: "ORCL", src: "watchlist" }, rows, [{ sym: "ORCL", status: "WATCH" }]), true);
  assert.equal(stillLive({ ticker: "X", src: "B-404" }, rows), false);    // unknown row
});

test("recordJudged keeps today only and appends", () => {
  const s = recordJudged({ judged: [{ date: "2026-11-01", key: "old" }] }, trip({}), "2026-11-02", "started", new Date("2026-11-02T15:00:00Z"));
  assert.equal(s.judged.length, 1);
  assert.equal(s.judged[0].result, "started");
});

test("a lock goes stale after 30 minutes", () => {
  const now = new Date("2026-11-02T15:00:00Z");
  assert.equal(lockIsLive({ at: new Date(now - 5 * 60000).toISOString() }, now), true);
  assert.equal(lockIsLive({ at: new Date(now - LOCK_STALE_MS - 1000).toISOString() }, now), false);
  assert.equal(lockIsLive(null, now), false);
});

test("every order, review and cancel tool is blocked on both Robinhood server names", () => {
  for (const t of ["place_equity_order", "place_option_order", "cancel_equity_order", "review_equity_order", "place_crypto_order", "exercise_option"]) {
    assert.ok(BLOCKED_TOOLS.includes(`mcp__robinhood-trading__${t}`), t);
  }
  assert.ok(!BLOCKED_TOOLS.some((t) => t.endsWith("get_equity_quotes")));
});

test("the prompt names the level, the source row and the prompt file", () => {
  const p = judgePrompt(trip({ prev: 250 }), "2026-11-02");
  assert.match(p, /prompts\/trip-judge-v1\.md/);
  assert.match(p, /AMZN TRIGGER >= 254\.6 from B-1/);
  assert.match(p, /prior close 250/);
});
