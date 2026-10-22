// tripwire.test.mjs - the level logic behind the tripwire and the market watch. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveLevels, checkLevels, recordFired, fetchQuotes, levelKey } from "../server/tripwire.js";

const TODAY = "2026-10-07";
const rows = [
  { id: "B-001", ticker: "VST", date: "2026-10-05", call_type: "conditional", review_price: 140.5, trigger: 143.02, invalidation: null },
  { id: "B-002", ticker: "GOOGL", date: "2026-10-01", call_type: "long", review_price: 336.25, trigger: null, invalidation: 326 },
  { id: "B-003", ticker: "MU", date: "2026-09-01", call_type: "conditional", review_price: 900, trigger: 920, invalidation: 881 },   // 36 days old
  { id: "B-004", ticker: "EWY", date: "2026-10-06", call_type: "conditional", review_price: 100, trigger: 95, invalidation: 90 },    // killed on the watchlist
  { id: "B-005", ticker: "HPQ", date: "2026-10-06", call_type: "long", review_price: 30, invalidation: 28, outcome: "Loss" },        // closed row
  { id: "B-006", ticker: "VST", date: "2026-10-06", call_type: "conditional", review_price: 141.2, trigger: 143.02, invalidation: null }, // supersedes B-001, same level
];
const watchlist = [
  { sym: "EWY", status: "CLOSED" },
  { sym: "AIP", status: "WATCH", buy_zone: 21.39, floor: 17.4 },
];
const targets = [{ sym: "GOOGL", target: 364.13, row: "B-002" }, { sym: "EWY", target: 120, row: "B-004" }];

test("deriveLevels: latest row per ticker, killed and stale names dropped, zones and targets added, duplicates removed", () => {
  const { watching, dropped } = deriveLevels({ rows, watchlist, targets, today: TODAY });
  const keys = watching.map(levelKey).sort();
  assert.deepEqual(keys, [
    "AIP|BUY ZONE|21.39|below",
    "AIP|FLOOR|17.4|below",
    "GOOGL|STOP|326|below",
    "GOOGL|TARGET|364.13|above",
    "VST|TRIGGER|143.02|above",
  ]);
  assert.equal(watching.find((l) => l.ticker === "VST").src, "B-006", "the newest row owns the level");
  assert.match(dropped.join(" "), /MU \(B-003, 36d old\)/);
  assert.match(dropped.join(" "), /EWY \(watchlist says CLOSED\)/);
});

test("deriveLevels: a trigger under the review price is a pullback entry (dir below); --all keeps stale rows", () => {
  const { watching } = deriveLevels({ rows, watchlist, targets: [], today: TODAY, all: true });
  const mu = watching.filter((l) => l.ticker === "MU");
  assert.deepEqual(mu.map((l) => `${l.kind} ${l.dir}`).sort(), ["FLOOR below", "TRIGGER above"]);
  const pull = deriveLevels({ rows: [{ id: "B-9", ticker: "AMZN", date: TODAY, call_type: "conditional", review_price: 252, trigger: 240 }], watchlist: [], today: TODAY });
  assert.equal(pull.watching[0].dir, "below");
});

test("checkLevels: compares against the session RANGE, fires once per level per day", () => {
  const { watching } = deriveLevels({ rows, watchlist, targets, today: TODAY });
  const quotes = {
    VST: { last: 142.5, low: 141.0, high: 143.4, prev: 140.02 },     // touched 143.02 then came back: still a hit
    GOOGL: { last: 340, low: 338, high: 345, prev: 343.5 },           // nothing
    AIP: { last: 21.2, low: 21.1, high: 21.9, prev: 21.6 },           // buy zone 21.39 hit, floor 17.4 not
  };
  const tripped = checkLevels(watching, quotes, { fired: [] }, TODAY);
  assert.deepEqual(tripped.map(levelKey).sort(), ["AIP|BUY ZONE|21.39|below", "VST|TRIGGER|143.02|above"]);
  assert.equal(tripped.find((t) => t.ticker === "VST").touched, 143.4);
  const state = recordFired({ fired: [{ date: "2026-10-06", key: "old" }] }, tripped, TODAY, new Date("2026-10-07T14:14:00Z"));
  assert.equal(state.fired.length, 2, "yesterday's entries are dropped, today's are kept");
  assert.deepEqual(checkLevels(watching, quotes, state, TODAY), [], "already fired today: silent");
});

test("checkLevels: a missing quote or a missing range is skipped, never a hit", () => {
  const watching = [{ ticker: "X", kind: "STOP", price: 10, dir: "below", src: "B-1" }];
  assert.deepEqual(checkLevels(watching, {}, { fired: [] }, TODAY), []);
  assert.deepEqual(checkLevels(watching, { X: { last: 9, low: null, high: null } }, { fired: [] }, TODAY), []);
});

test("fetchQuotes: reads the Yahoo meta block and reports failures per ticker", async () => {
  const fake = async (url) => {
    if (url.includes("/VST?")) return { ok: true, json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 142.5, regularMarketDayLow: 141, regularMarketDayHigh: 143.4, previousClose: 140.02 } }] } }) };
    return { ok: false, status: 404 };
  };
  const { quotes, failed } = await fetchQuotes(["VST", "NOPE"], fake);
  assert.deepEqual(quotes, { VST: { last: 142.5, low: 141, high: 143.4, prev: 140.02 } });
  assert.deepEqual(failed, ["NOPE (404)"]);
});
