# Market Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Override for this repo (Adam, cost rule 2026-09-27):** every agent costs about 78K tokens before it starts. Do these tasks in ONE session, in order. If a review is wanted, one reviewer after Task 8 is enough. Do not make a worktree: the watcher reads the live book, so build in `C:\Users\steam\Projects\apps\the-bench` itself on branch `v29-hunter-handoff`.

**Goal:** A watcher that runs on this PC during the regular session, checks the book's committed buy and sell levels every 3 minutes, and when one is hit sends an urgent phone card that keeps coming back until Adam sends a photo (to a private ntfy topic, or into the Claude chat).

**Architecture:** The level logic inside `scripts/tripwire.mjs` moves into `server/tripwire.js` as pure functions; the tripwire CLI keeps its exact behavior as a thin wrapper. A new `server/marketWatch.js` holds the alarm state machine (open or join, nag schedule, image-only acks, cards). A new `scripts/market-watch.mjs` is the CLI and the daemon loop, with every network call going through an injectable `fetch` so the tests run offline.

**Tech Stack:** Node >= 20 ESM, zero dependencies, `node:test` + `node:assert/strict`, ntfy.sh over plain `fetch`, Yahoo chart JSON (same feed the tripwire uses).

**Spec:** `docs/superpowers/specs/2026-10-07-market-watch-design.md`.

## Global Constraints

- Zero new dependencies. `package.json` is not touched.
- Phone topic is `https://ntfy.sh/bench-adam-7x3`; every card is `Priority: urgent` (Adam, 2026-09-11).
- Only buy and sell level hits nag. Level selection is exactly today's tripwire logic (TRIGGER, STOP, FLOOR, BUY ZONE, TARGET; latest row per ticker; watchlist kill statuses CLOSED / PASS / AVOID; 14-day staleness). Do not change it.
- A photo clears an alarm. Text on the ack topic never does. `--ack` on this PC is the only non-photo path.
- The x-poster `HALT` file is NOT read (it is permanently present). Only the local config's `halt: true` stops the watcher.
- Session window 08:25 to 15:05 America/Chicago, weekdays. No sends outside it.
- Nag schedule in minutes after the alarm opened: 0, 2, 5, 10, then every 15.
- `db/market-watch.local.json` and `db/market-watch-state.json` are gitignored. The ack topic name never enters git, a read file, or a chat message.
- Commit after every task. Commit messages contain no apostrophes (this PC rejects them in heredocs). Run tests with `node --test test/<file>.test.mjs`, never `node --test <directory>` (that can start the app server).
- The selfie is an acknowledgment, never permission. Nothing here places, previews or arms an order.

## File Structure

| File | Responsibility |
|---|---|
| `server/tripwire.js` (new) | `deriveLevels`, `fetchQuotes`, `checkLevels`, `recordFired`, `levelKey`, `KILL_STATUSES`. Pure except `fetchQuotes`, which takes a `fetch` function. |
| `scripts/tripwire.mjs` (rewrite) | Thin CLI over `server/tripwire.js`. Same flags, output, state file and exit codes as today. |
| `server/marketWatch.js` (new) | Alarm state machine and cards: `sideOf`, `ct`, `inWindow`, `nextNagOffset`, `nagDue`, `openAlarms`, `openOrJoin`, `isImage`, `applyAcks`, `ackAll`, `buildCard`, `unansweredCard`, `downCard`, `sendCard`, `readAckTopic`, `newAckTopic`. No file or clock access except through arguments. |
| `scripts/market-watch.mjs` (new) | CLI + daemon: `--init`, `--link`, `--halt`, `--resume`, `--status`, `--ack`, `--reset`, `--test-card`, `--carry`, `--once`, `--dry`, `--loop`, `--dir`. Exports `tick`, `carryOver`, `makeFakeFetch` for tests. |
| `test/tripwire.test.mjs` (new) | Characterization tests for the level logic, written BEFORE the split. |
| `test/market-watch.test.mjs` (new) | Offline tests for the state machine, cards, CLI and loop pieces. |
| `.gitignore` (modify) | Two new entries. |
| `docs/handoffs/2026-10-07-market-watch-task.ps1` (new, Task 9) | Readable script that registers the Windows scheduled task. Adam reads it, then it is run at his word. |
| `CLAUDE.md` (modify, Task 9) | One bullet under the setup list describing the watcher. |

---

### Task 1: Characterize the tripwire, then move its logic into `server/tripwire.js`

**Files:**
- Create: `server/tripwire.js`
- Create: `test/tripwire.test.mjs`
- Modify: `scripts/tripwire.mjs` (whole file)

**Interfaces:**
- Produces: `deriveLevels({ rows, watchlist, targets = [], today, maxAge = 14, all = false }) -> { watching: Level[], dropped: string[] }` where `Level = { ticker, kind, price, dir: "above"|"below", src }`.
- Produces: `fetchQuotes(tickers: string[], fetchFn = globalThis.fetch) -> Promise<{ quotes: Record<ticker, {last, low, high, prev}>, failed: string[] }>`.
- Produces: `checkLevels(watching, quotes, state, today) -> Tripped[]` where `Tripped = Level & { key, touched, last }`.
- Produces: `recordFired(state, tripped, today, now = new Date()) -> state` (keeps only today's fired entries plus the new ones).
- Produces: `levelKey(level) -> "TICKER|KIND|PRICE|DIR"`, `KILL_STATUSES = ["CLOSED","PASS","AVOID"]`.

- [ ] **Step 1: Write the failing characterization tests**

Create `test/tripwire.test.mjs`:

```js
// tripwire.test.mjs - the level logic behind the tripwire and the market watch. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveLevels, checkLevels, recordFired, fetchQuotes, levelKey } from "../server/tripwire.js";

const TODAY = "2026-10-07";
const rows = [
  { id: "B-001", ticker: "VST", date: "2026-10-05", call_type: "conditional", review_price: 147.98, trigger: 143.02, invalidation: null },
  { id: "B-002", ticker: "GOOGL", date: "2026-10-01", call_type: "long", review_price: 336.25, trigger: null, invalidation: 326 },
  { id: "B-003", ticker: "MU", date: "2026-09-01", call_type: "conditional", review_price: 900, trigger: 920, invalidation: 881 },   // 36 days old
  { id: "B-004", ticker: "EWY", date: "2026-10-06", call_type: "conditional", review_price: 100, trigger: 95, invalidation: 90 },    // killed on the watchlist
  { id: "B-005", ticker: "HPQ", date: "2026-10-06", call_type: "long", review_price: 30, invalidation: 28, outcome: "Loss" },        // closed row
  { id: "B-006", ticker: "VST", date: "2026-10-06", call_type: "conditional", review_price: 146.47, trigger: 143.02, invalidation: null }, // supersedes B-001, same level
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/tripwire.test.mjs`
Expected: FAIL, `Cannot find module '../server/tripwire.js'`.

- [ ] **Step 3: Create `server/tripwire.js`**

The bodies below are the current `scripts/tripwire.mjs` logic, moved without behavior change.

```js
// tripwire.js - the level logic shared by scripts/tripwire.mjs (one check, one ping)
// and scripts/market-watch.mjs (all-day watcher that nags until a selfie).
//
// Pure functions except fetchQuotes, which takes the fetch function as an argument so
// tests run offline. Moved out of scripts/tripwire.mjs on 2026-10-07 without changing
// what is watched or how a hit is decided. See that file's header for the history.

import { nyDate } from "./nyDate.js";

export const KILL_STATUSES = ["CLOSED", "PASS", "AVOID"];
export const levelKey = (l) => `${l.ticker}|${l.kind}|${l.price}|${l.dir}`;

// THREE GATES, and the second one is the important one.
// Gate A - latest live row per ticker (superseded plans must not all sit armed).
// Gate B - the book kills plans in prose, so the watchlist STATUS is the kill switch.
// Gate C - stale levels are dead levels: a plan nobody re-ran in maxAge days is a fossil.
export function deriveLevels({ rows, watchlist, targets = [], today = nyDate(), maxAge = 14, all = false }) {
  const levels = [];
  const add = (l) => { if (l.price > 0) levels.push(l); };
  const killed = new Set(watchlist.filter((w) => KILL_STATUSES.includes(w.status)).map((w) => w.sym));
  const ageDays = (d) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);

  const latest = new Map();
  const dropped = [];
  for (const r of rows) {
    if (r.outcome) { latest.delete(r.ticker); continue; }
    if (r.call_type === "conditional" || r.call_type === "long") latest.set(r.ticker, r);
  }
  for (const [ticker, r] of [...latest]) {
    if (killed.has(ticker)) { latest.delete(ticker); dropped.push(`${ticker} (watchlist says ${watchlist.find((w) => w.sym === ticker).status})`); continue; }
    if (!all && r.date && ageDays(r.date) > maxAge) { latest.delete(ticker); dropped.push(`${ticker} (${r.id}, ${ageDays(r.date)}d old)`); }
  }
  for (const [ticker, r] of latest) {
    if (r.call_type === "conditional" && r.trigger) {
      const dir = r.review_price && r.trigger < r.review_price ? "below" : "above";
      add({ ticker, kind: "TRIGGER", price: Number(r.trigger), dir, src: r.id });
    }
    if (r.invalidation) {
      add({ ticker, kind: r.call_type === "long" ? "STOP" : "FLOOR", price: Number(r.invalidation), dir: "below", src: r.id });
    }
  }
  for (const w of watchlist) {
    if (KILL_STATUSES.includes(w.status)) continue;
    if (w.buy_zone) add({ ticker: w.sym, kind: "BUY ZONE", price: Number(w.buy_zone), dir: "below", src: "watchlist" });
    if (w.floor) add({ ticker: w.sym, kind: "FLOOR", price: Number(w.floor), dir: "below", src: "watchlist" });
  }
  for (const t of targets) {
    if (killed.has(t.sym)) continue;
    add({ ticker: t.sym, kind: "TARGET", price: Number(t.target), dir: "above", src: t.row });
  }
  const seen = new Set();
  const watching = levels.filter((l) => { const k = `${l.ticker}|${l.kind}|${l.price}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { watching, dropped };
}

export async function fetchQuotes(tickers, fetchFn = globalThis.fetch) {
  const quotes = {};
  const failed = [];
  for (const t of tickers) {
    try {
      const res = await fetchFn(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1m&range=1d`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const m = (await res.json()).chart.result[0].meta;
      quotes[t] = { last: m.regularMarketPrice, low: m.regularMarketDayLow, high: m.regularMarketDayHigh, prev: m.previousClose };
    } catch (e) { failed.push(`${t} (${e.message})`); }
  }
  return { quotes, failed };
}

// THE DAY-RANGE TRICK: compare against the session LOW and HIGH, not the current
// price, so a level touched at 9:15 and recovered by 9:30 is still caught at 9:35.
export function checkLevels(watching, quotes, state, today) {
  const alreadyFired = new Set((state.fired || []).filter((f) => f.date === today).map((f) => f.key));
  const tripped = [];
  for (const l of watching) {
    const q = quotes[l.ticker];
    if (!q) continue;
    const extreme = l.dir === "below" ? q.low : q.high;
    if (extreme == null) continue;
    const hit = l.dir === "below" ? extreme <= l.price : extreme >= l.price;
    if (!hit) continue;
    const key = levelKey(l);
    if (alreadyFired.has(key)) continue;
    tripped.push({ ...l, key, touched: extreme, last: q.last });
  }
  return tripped;
}

export function recordFired(state, tripped, today, now = new Date()) {
  return {
    ...state,
    fired: [
      ...(state.fired || []).filter((f) => f.date === today),
      ...tripped.map((t) => ({ date: today, key: t.key, ticker: t.ticker, kind: t.kind, price: t.price, touched: t.touched, at: now.toISOString() })),
    ],
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/tripwire.test.mjs`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Rewrite `scripts/tripwire.mjs` as a thin CLI**

Keep lines 1-42 of the current file (the header comment) exactly as they are. Replace everything from the first `import` to the end with:

```js
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../server/config.js";
import { nyDate } from "../server/nyDate.js";
import { loadTargets } from "./position-target.mjs";
import { deriveLevels, fetchQuotes, checkLevels, recordFired } from "../server/tripwire.js";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const STATE = resolve(ROOT, "db/tripwire-state.json");
const NTFY = "https://ntfy.sh/bench-adam-7x3";
const today = nyDate();

if (has("--reset")) { writeFileSync(STATE, JSON.stringify({ fired: [] }, null, 2)); console.log("state cleared"); process.exit(0); }

// ---- 1. derive every level we have actually committed to ---------------------
const wl = JSON.parse(readFileSync(resolve(ROOT, "db/watchlist.json"), "utf8"));
const arch = JSON.parse(readFileSync(resolve(ROOT, "db/archive.json"), "utf8"));
const rows = Array.isArray(arch) ? arch : (arch.rows || arch.archive);
const targets = loadTargets(val("--targets") ? resolve(val("--targets")) : undefined);
const { watching, dropped } = deriveLevels({ rows, watchlist: wl, targets, today, maxAge: Number(val("--max-age") ?? 14), all: has("--all") });

if (has("--list")) {
  console.log(`\nWATCHING ${watching.length} level(s) — no network called\n`);
  if (dropped.length) console.log(`  DROPPED as dead or stale (${dropped.length}): ${dropped.join(", ")}\n`);
  for (const l of watching) console.log(`  ${l.ticker.padEnd(6)} ${l.kind.padEnd(9)} ${l.dir === "below" ? "<=" : ">="} ${String(l.price).padStart(9)}   (${l.src})`);
  console.log("");
  process.exit(0);
}

// ---- 2. one cheap fetch per ticker -------------------------------------------
const tickers = [...new Set(watching.map((l) => l.ticker))];
const { quotes, failed } = await fetchQuotes(tickers);

if (!Object.keys(quotes).length) {
  console.error(`\nAll quote fetches failed: ${failed.join(", ")}`);
  console.error("This is a FETCH FAILURE, not 'nothing tripped'. Do not read silence as safety.\n");
  process.exit(2);
}

// ---- 3. compare against the session RANGE, not just spot ---------------------
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { fired: [] };
const tripped = checkLevels(watching, quotes, state, today);

// ---- 4. report ----------------------------------------------------------------
if (has("--json")) {
  console.log(JSON.stringify({ today, watching: watching.length, tripped, failed }, null, 2));
  process.exit(tripped.length ? 1 : 0);
}

if (dropped.length) console.log(`  (${dropped.length} dead/stale plan(s) not watched: ${dropped.join(", ")})`);
console.log(`\nTRIPWIRE — ${watching.length} level(s) on ${tickers.length} ticker(s)${failed.length ? ` · ${failed.length} fetch failure(s)` : ""}`);
if (failed.length) console.log(`  could not fetch: ${failed.join(", ")}`);

if (!tripped.length) {
  console.log("Nothing new tripped.\n");
  process.exit(0);
}

console.log(`\n*** ${tripped.length} LEVEL(S) TOUCHED ***\n`);
for (const t of tripped) {
  console.log(`  ${t.ticker} ${t.kind} ${t.dir === "below" ? "<=" : ">="} ${t.price} — session ${t.dir === "below" ? "low" : "high"} ${t.touched}, last ${t.last}  (${t.src})`);
}
console.log(`\nTHIS IS NOT A SIGNAL. Free-feed price, possibly delayed. Run a full v25 check against live Robinhood data before any decision.\n`);

// ---- 5. push + remember, so it fires once per level per day -------------------
if (!has("--dry")) {
  const msg = tripped.map((t) => `${t.ticker} ${t.kind} ${t.dir === "below" ? "<=" : ">="} ${t.price} (touched ${t.touched})`).join(" | ");
  try {
    await fetch(NTFY, {
      method: "POST",
      headers: { Title: "THE BENCH - level touched", Priority: "urgent" },
      body: `${msg} -- unverified free feed, run v25 on live data before acting`,
    });
    console.log("phone pinged.");
  } catch (e) { console.log(`push failed (${e.message}) — state still recorded.`); }

  writeFileSync(STATE, JSON.stringify(recordFired(state, tripped, today), null, 2) + "\n", "utf8");
  console.log(`recorded to db/tripwire-state.json — bench-fastmover-watch reads this on its next run, so the trip is not lost if the push is missed.`);
}

console.log("");
process.exit(1);
```

- [ ] **Step 6: Prove the CLI still behaves**

Run: `node scripts/tripwire.mjs --list`
Expected: the same `WATCHING N level(s)` listing as before the change (compare with `git stash`-free memory: run `git show HEAD:scripts/tripwire.mjs > /tmp/old-tripwire.mjs` is NOT possible on this PC without the import paths breaking, so instead count: the number of levels printed must equal the count from `node scripts/tripwire.mjs --json --dry 2>/dev/null | head -3` field `watching`).

Run: `node scripts/tripwire.mjs --dry`
Expected: `TRIPWIRE — N level(s) on M ticker(s)` and either `Nothing new tripped.` (exit 0) or a `LEVEL(S) TOUCHED` block (exit 1). No `phone pinged.` line, because `--dry`.

Run: `node --test test/tripwire.test.mjs`
Expected: `# pass 5`.

- [ ] **Step 7: Commit**

```bash
git add server/tripwire.js test/tripwire.test.mjs scripts/tripwire.mjs
git commit -m "tripwire: move the level logic into server/tripwire.js, CLI unchanged, 5 characterization tests" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The alarm state machine (`server/marketWatch.js`)

**Files:**
- Create: `server/marketWatch.js`
- Create: `test/market-watch.test.mjs`

**Interfaces:**
- Consumes: `Tripped` objects from Task 1 (`{ ticker, kind, price, dir, src, key, touched, last }`).
- Produces (all exported): `NAG_MINUTES = [0,2,5,10]`, `NAG_EVERY = 15`, `WINDOW = { open: "08:25", close: "15:05" }`, `SELFIE_LINE`, `sideOf(kind) -> "BUY"|"SELL"|"LEVEL"`, `ct(date) -> { date: "YYYY-MM-DD", hhmm: "HH:MM", weekday: "Mon".."Sun" }` in America/Chicago, `inWindow(date) -> boolean`, `nextNagOffset(sentCount) -> minutes`, `nagDue(alarm, now) -> boolean`, `openAlarms(state) -> Alarm[]`, `openOrJoin(state, tripped, now) -> { state, alarm, added }`, `isImage(msg) -> boolean`, `applyAcks(state, messages, from = "phone") -> { state, acked: id[] }`, `ackAll(state, { from, note, now }) -> { state, acked }`, `buildCard(alarm, link, now) -> { title, body, headers }`, `unansweredCard(alarms, link) -> card`, `downCard() -> card`.
- `Alarm = { id: "YYYY-MM-DD-HHMM", opened: ISO, levels: [{ ticker, kind, side, price, dir, touched, src, key, at }], sent: ISO[], acked: null | { at, from, receipt }, carried?: "YYYY-MM-DD" }`.
- `state = { alarms: Alarm[] }`.

- [ ] **Step 1: Write the failing tests**

Create `test/market-watch.test.mjs`:

```js
// market-watch.test.mjs - the nag that stops at a selfie. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sideOf, ct, inWindow, nextNagOffset, nagDue, openAlarms, openOrJoin,
  isImage, applyAcks, ackAll, buildCard, unansweredCard, downCard, SELFIE_LINE,
} from "../server/marketWatch.js";

const T0 = new Date("2026-10-07T14:14:00Z"); // 09:14 CT, a Wednesday
const min = (n) => new Date(T0.getTime() + n * 60000);
const vst = { ticker: "VST", kind: "TRIGGER", price: 143.02, dir: "above", src: "B-717", key: "VST|TRIGGER|143.02|above", touched: 143.4, last: 142.5 };
const googl = { ticker: "GOOGL", kind: "STOP", price: 326, dir: "below", src: "B-663", key: "GOOGL|STOP|326|below", touched: 325.9, last: 327 };

test("sideOf: triggers and zones are BUY, stops, floors and targets are SELL", () => {
  assert.equal(sideOf("TRIGGER"), "BUY");
  assert.equal(sideOf("BUY ZONE"), "BUY");
  for (const k of ["STOP", "FLOOR", "TARGET"]) assert.equal(sideOf(k), "SELL");
  assert.equal(sideOf("WHATEVER"), "LEVEL");
});

test("ct and inWindow: Central time, weekdays, 08:25 to 15:05", () => {
  assert.deepEqual(ct(T0), { date: "2026-10-07", hhmm: "09:14", weekday: "Wed" });
  assert.equal(inWindow(T0), true);
  assert.equal(inWindow(new Date("2026-10-07T13:24:00Z")), false, "08:24 CT is before the open");
  assert.equal(inWindow(new Date("2026-10-07T13:25:00Z")), true, "08:25 CT is in");
  assert.equal(inWindow(new Date("2026-10-07T20:05:00Z")), false, "15:05 CT is out");
  assert.equal(inWindow(new Date("2026-10-10T15:00:00Z")), false, "Saturday");
});

test("the nag schedule: 0, 2, 5, 10, then every 15 minutes", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(nextNagOffset), [0, 2, 5, 10, 25, 40, 55]);
  const alarm = { opened: T0.toISOString(), sent: [], acked: null };
  assert.equal(nagDue(alarm, T0), true, "first send is immediate");
  alarm.sent.push(T0.toISOString());
  assert.equal(nagDue(alarm, min(1)), false);
  assert.equal(nagDue(alarm, min(2)), true);
  alarm.sent.push(min(2).toISOString(), min(5).toISOString(), min(10).toISOString());
  assert.equal(nagDue(alarm, min(24)), false);
  assert.equal(nagDue(alarm, min(25)), true);
  assert.equal(nagDue({ ...alarm, acked: { at: min(11).toISOString(), from: "phone", receipt: "x" } }, min(30)), false, "acked alarms never nag");
});

test("openOrJoin: one alarm per burst; a later level joins the open alarm; duplicates are ignored", () => {
  let r = openOrJoin({ alarms: [] }, [vst], T0);
  assert.equal(r.state.alarms.length, 1);
  assert.equal(r.alarm.id, "2026-10-07-0914");
  assert.deepEqual(r.added.map((l) => l.key), [vst.key]);
  assert.equal(r.alarm.levels[0].side, "BUY");
  r = openOrJoin(r.state, [vst, googl], min(3));
  assert.equal(r.state.alarms.length, 1, "joined, not opened");
  assert.deepEqual(r.added.map((l) => l.key), [googl.key]);
  assert.equal(r.state.alarms[0].levels.length, 2);
  assert.deepEqual(openOrJoin(r.state, [], min(4)).added, []);
  const acked = ackAll(r.state, { from: "pc", now: min(5) }).state;
  const again = openOrJoin(acked, [vst], min(6));
  assert.equal(again.state.alarms.length, 2, "after an ack a new hit opens a new alarm");
});

test("applyAcks: only an image attachment posted after the alarm opened clears it; text never does", () => {
  const { state } = openOrJoin({ alarms: [] }, [vst], T0);
  const text = { event: "message", time: Math.floor(min(1).getTime() / 1000), message: "ok saw it" };
  const oldPhoto = { event: "message", time: Math.floor(min(-10).getTime() / 1000), attachment: { type: "image/jpeg", url: "https://ntfy.sh/file/old.jpg" } };
  const photo = { event: "message", time: Math.floor(min(4).getTime() / 1000), attachment: { type: "image/jpeg", url: "https://ntfy.sh/file/abc.jpg" } };
  const pdf = { event: "message", time: Math.floor(min(4).getTime() / 1000), attachment: { type: "application/pdf", url: "https://ntfy.sh/file/x.pdf" } };
  assert.equal(isImage(photo), true);
  assert.equal(isImage(text), false);
  assert.equal(isImage(pdf), false);
  assert.deepEqual(applyAcks(state, [text, oldPhoto, pdf]).acked, []);
  const r = applyAcks(state, [text, oldPhoto, photo]);
  assert.deepEqual(r.acked, ["2026-10-07-0914"]);
  assert.deepEqual(r.state.alarms[0].acked, { at: min(4).toISOString(), from: "phone", receipt: "https://ntfy.sh/file/abc.jpg" });
  assert.deepEqual(openAlarms(r.state), []);
});

test("ackAll records who cleared it", () => {
  const { state } = openOrJoin({ alarms: [] }, [vst, googl], T0);
  const r = ackAll(state, { from: "chat", note: "selfie arrived in chat", now: min(7) });
  assert.deepEqual(r.acked, ["2026-10-07-0914"]);
  assert.equal(r.state.alarms[0].acked.from, "chat");
  assert.equal(r.state.alarms[0].acked.receipt, "selfie arrived in chat");
});

test("buildCard: title names the side, body lists levels, nag count, and the selfie line; Click carries the chat link", () => {
  const { state, alarm } = openOrJoin({ alarms: [] }, [vst], T0);
  const c = buildCard(alarm, "claude://claude.ai/epitaxy/local_x", T0);
  assert.equal(c.title, "THE BENCH - BUY level hit: VST 143.02");
  assert.equal(c.headers.Priority, "urgent");
  assert.equal(c.headers.Click, "claude://claude.ai/epitaxy/local_x");
  assert.match(c.body, /VST TRIGGER >= 143.02, touched 143.4 \(B-717\)/);
  assert.match(c.body, /nag 1 of many - opened 09:14 CT/);
  assert.ok(c.body.endsWith(SELFIE_LINE));
  const mixed = openOrJoin(state, [googl], min(1)).alarm;
  assert.equal(buildCard(mixed, null, min(1)).title, "THE BENCH - BUY + SELL levels hit");
  assert.equal("Click" in buildCard(mixed, null, min(1)).headers, false);
});

test("unansweredCard and downCard", () => {
  const { state } = openOrJoin({ alarms: [] }, [googl], new Date("2026-10-06T19:50:00Z"));
  const u = unansweredCard(openAlarms(state), "claude://x");
  assert.equal(u.title, "THE BENCH - UNANSWERED from 2026-10-06");
  assert.match(u.body, /GOOGL STOP <= 326/);
  assert.ok(u.body.endsWith(SELFIE_LINE));
  const d = downCard();
  assert.equal(d.title, "THE BENCH - MARKET WATCH DOWN");
  assert.equal(d.headers.Priority, "urgent");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/market-watch.test.mjs`
Expected: FAIL, `Cannot find module '../server/marketWatch.js'`.

- [ ] **Step 3: Create `server/marketWatch.js`**

```js
// marketWatch.js - the alarm state machine behind scripts/market-watch.mjs.
//
// An ALARM opens when a committed buy or sell level is hit (see server/tripwire.js for
// what a level is). It is nagged to the phone on a fixed schedule until a PHOTO lands on
// the private ack topic, or the PC acks it by hand. Text never clears it. The photo
// means "I saw it" and nothing else; nothing here knows how to place an order.
//
// Everything in this file is pure: the clock, the files and the network are passed in.
// Spec: docs/superpowers/specs/2026-10-07-market-watch-design.md

import { randomBytes } from "node:crypto";

export const NAG_MINUTES = [0, 2, 5, 10];
export const NAG_EVERY = 15;
export const WINDOW = { open: "08:25", close: "15:05" }; // America/Chicago
export const BUY_KINDS = new Set(["TRIGGER", "BUY ZONE"]);
export const SELL_KINDS = new Set(["STOP", "FLOOR", "TARGET"]);
export const SELFIE_LINE = "Send a selfie to stop this. It means you saw it, nothing else. Every order is yours.";

export function sideOf(kind) {
  if (BUY_KINDS.has(kind)) return "BUY";
  if (SELL_KINDS.has(kind)) return "SELL";
  return "LEVEL";
}

export function ct(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour12: false, weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t).value;
  const hh = g("hour") === "24" ? "00" : g("hour");
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hhmm: `${hh}:${g("minute")}`, weekday: g("weekday") };
}

export function inWindow(date = new Date()) {
  const { hhmm, weekday } = ct(date);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return hhmm >= WINDOW.open && hhmm < WINDOW.close;
}

export function nextNagOffset(sentCount) {
  if (sentCount < NAG_MINUTES.length) return NAG_MINUTES[sentCount];
  return NAG_MINUTES[NAG_MINUTES.length - 1] + NAG_EVERY * (sentCount - NAG_MINUTES.length + 1);
}

export function nagDue(alarm, now = new Date()) {
  if (alarm.acked) return false;
  const minutes = (now.getTime() - Date.parse(alarm.opened)) / 60000;
  return minutes >= nextNagOffset(alarm.sent.length);
}

export function openAlarms(state) { return state.alarms.filter((a) => !a.acked); }

const cloneAlarms = (state) => state.alarms.map((a) => ({ ...a, levels: [...a.levels], sent: [...a.sent] }));

export function openOrJoin(state, tripped, now = new Date()) {
  if (!tripped.length) return { state, alarm: null, added: [] };
  const alarms = cloneAlarms(state);
  let alarm = alarms.find((a) => !a.acked);
  if (!alarm) {
    const { date, hhmm } = ct(now);
    alarm = { id: `${date}-${hhmm.replace(":", "")}`, opened: now.toISOString(), levels: [], sent: [], acked: null };
    alarms.push(alarm);
  }
  const have = new Set(alarm.levels.map((l) => l.key));
  const added = [];
  for (const t of tripped) {
    if (have.has(t.key)) continue;
    const lvl = { ticker: t.ticker, kind: t.kind, side: sideOf(t.kind), price: t.price, dir: t.dir, touched: t.touched, src: t.src, key: t.key, at: now.toISOString() };
    alarm.levels.push(lvl);
    added.push(lvl);
    have.add(t.key);
  }
  return { state: { ...state, alarms }, alarm, added };
}

export function isImage(msg) {
  return Boolean(msg && msg.event === "message" && msg.attachment && String(msg.attachment.type || "").startsWith("image/"));
}

// ntfy message time is unix seconds. An image counts only if it arrived after the alarm opened.
export function applyAcks(state, messages, from = "phone") {
  const images = messages.filter(isImage);
  const acked = [];
  const alarms = state.alarms.map((a) => {
    if (a.acked) return a;
    const hit = images.find((m) => m.time * 1000 >= Date.parse(a.opened));
    if (!hit) return a;
    acked.push(a.id);
    return { ...a, acked: { at: new Date(hit.time * 1000).toISOString(), from, receipt: hit.attachment.url } };
  });
  return { state: { ...state, alarms }, acked };
}

export function ackAll(state, { from = "pc", note = "", now = new Date() } = {}) {
  const acked = [];
  const alarms = state.alarms.map((a) => {
    if (a.acked) return a;
    acked.push(a.id);
    return { ...a, acked: { at: now.toISOString(), from, receipt: note || `acked from ${from}` } };
  });
  return { state: { ...state, alarms }, acked };
}

export function fmtLevel(l) {
  return `${l.ticker} ${l.kind} ${l.dir === "below" ? "<=" : ">="} ${l.price}, touched ${l.touched} (${l.src})`;
}

const headersFor = (title, link) => {
  const h = { Title: title, Priority: "urgent", Tags: "rotating_light" };
  if (link) h.Click = link;
  return h;
};

export function buildCard(alarm, link, now = new Date()) {
  const sides = [...new Set(alarm.levels.map((l) => l.side))];
  const head = sides.length > 1 ? "BUY + SELL levels hit" : `${sides[0]} level hit: ${alarm.levels[0].ticker} ${alarm.levels[0].price}`;
  const title = `THE BENCH - ${head}`;
  const body = [
    ...alarm.levels.map(fmtLevel),
    `nag ${alarm.sent.length + 1} of many - opened ${ct(new Date(alarm.opened)).hhmm} CT`,
    SELFIE_LINE,
  ].join("\n");
  return { title, body, headers: headersFor(title, link) };
}

export function unansweredCard(alarms, link) {
  const dates = [...new Set(alarms.map((a) => a.id.slice(0, 10)))].join(", ");
  const title = `THE BENCH - UNANSWERED from ${dates}`;
  const body = [...alarms.flatMap((a) => a.levels.map(fmtLevel)), SELFIE_LINE].join("\n");
  return { title, body, headers: headersFor(title, link) };
}

export function downCard() {
  const title = "THE BENCH - MARKET WATCH DOWN";
  return {
    title,
    body: "Three ticks in a row failed. The watcher is still running and will keep trying, but levels may be going unchecked. This card does not repeat.",
    headers: { Title: title, Priority: "urgent" },
  };
}

export async function sendCard(fetchFn, topicUrl, card) {
  const res = await fetchFn(topicUrl, { method: "POST", headers: card.headers, body: card.body });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
}

// since= takes unix seconds. Poll mode returns and closes; one JSON object per line.
export async function readAckTopic(fetchFn, topic, sinceIso) {
  const since = Math.floor(Date.parse(sinceIso) / 1000);
  const res = await fetchFn(`https://ntfy.sh/${topic}/json?poll=1&since=${since}`);
  if (!res.ok) throw new Error(`ack topic ${res.status}`);
  return (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function newAckTopic() {
  return `bench-ack-${randomBytes(9).toString("hex").slice(0, 12)}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/market-watch.test.mjs`
Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server/marketWatch.js test/market-watch.test.mjs
git commit -m "market-watch: alarm state machine, nag schedule, image-only acks, cards (8 tests)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The CLI skeleton: `--init`, `--link`, `--halt`, `--resume`, `--status`, `--test-card`, gitignore

This task exists so the two verifications in Task 4 can run before the daemon is built.

**Files:**
- Create: `scripts/market-watch.mjs`
- Modify: `.gitignore`
- Modify: `test/market-watch.test.mjs` (append)

**Interfaces:**
- Produces: the config file `<dir>/market-watch.local.json` = `{ ack_topic, chat_link, halt }`.
- Produces: `--dir <path>` (default `db/`, also env `MARKET_WATCH_DIR`) used by every mode for config, state, `tripwire-state.json`, `archive.json`, `watchlist.json`, `position-targets.json`.
- Produces: helpers used by Task 5 and 6: `paths(dir)`, `readJson(path, fallback)`, `writeJson(path, value)`, `loadConfig(dir)`.

- [ ] **Step 1: Write the failing CLI tests**

Append to `test/market-watch.test.mjs`:

```js
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/market-watch.mjs");
const run = (dir, args, env = {}) => execFileSync(process.execPath, [CLI, "--dir", dir, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "mw-"));
  writeFileSync(join(dir, "archive.json"), "[]");
  writeFileSync(join(dir, "watchlist.json"), "[]");
  return dir;
};

test("CLI --init writes a local config with a random ack topic and refuses to overwrite it", () => {
  const dir = fresh();
  const out = run(dir, ["--init"]);
  assert.match(out, /created/);
  const cfg = JSON.parse(readFileSync(join(dir, "market-watch.local.json"), "utf8"));
  assert.match(cfg.ack_topic, /^bench-ack-[0-9a-f]{12}$/);
  assert.equal(cfg.chat_link, "");
  assert.equal(cfg.halt, false);
  assert.throws(() => run(dir, ["--init"]), /already exists/);
  assert.equal(out.includes(cfg.ack_topic), true, "--init prints the topic once so Adam can subscribe to it");
});

test("CLI --link, --halt, --resume and --status edit and show the config", () => {
  const dir = fresh();
  run(dir, ["--init"]);
  run(dir, ["--link", "claude://claude.ai/epitaxy/local_abc"]);
  run(dir, ["--halt"]);
  let cfg = JSON.parse(readFileSync(join(dir, "market-watch.local.json"), "utf8"));
  assert.equal(cfg.chat_link, "claude://claude.ai/epitaxy/local_abc");
  assert.equal(cfg.halt, true);
  let status = run(dir, ["--status"]);
  assert.match(status, /HALTED/);
  assert.equal(status.includes(cfg.ack_topic), false, "--status never prints the topic name");
  run(dir, ["--resume"]);
  cfg = JSON.parse(readFileSync(join(dir, "market-watch.local.json"), "utf8"));
  assert.equal(cfg.halt, false);
  status = run(dir, ["--status"]);
  assert.match(status, /running state: ok/);
  assert.match(status, /open alarms: 0/);
});

test("CLI refuses to run a mode that needs config before --init", () => {
  const dir = fresh();
  assert.throws(() => run(dir, ["--status"]), /run --init first/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/market-watch.test.mjs`
Expected: the 8 earlier tests pass; the 3 new ones FAIL with `Cannot find module` for the CLI.

- [ ] **Step 3: Create `scripts/market-watch.mjs`**

```js
#!/usr/bin/env node
// market-watch.mjs - the level-hit nag that stops at a selfie.
//
//   node scripts/market-watch.mjs --init                 create the local config (prints the ack topic ONCE)
//   node scripts/market-watch.mjs --link <url>           set the chat link the card opens
//   node scripts/market-watch.mjs --halt | --resume      stop / restart nagging without killing the loop
//   node scripts/market-watch.mjs --status               open alarms, schedule position, config state (no network)
//   node scripts/market-watch.mjs --test-card            send one card to the phone to test Click and the ack path
//   node scripts/market-watch.mjs --ack [--from chat|pc] [--note "..."]   clear every open alarm from this PC
//   node scripts/market-watch.mjs --once [--dry]         one tick
//   node scripts/market-watch.mjs --carry                send the UNANSWERED card for alarms left open on an earlier day
//   node scripts/market-watch.mjs --loop                 the daemon: weekdays 08:25-15:05 CT, a tick every 3 minutes
//   node scripts/market-watch.mjs --reset                clear the alarm state
//   --dir <path>  where config, state and the book live (default db/; env MARKET_WATCH_DIR). Tests use a temp dir.
//
// WHAT IT IS: the tripwire (scripts/tripwire.mjs) that does not stop. Same levels, same
// free feed, same day-range trick. When a buy or sell level is hit it opens an ALARM and
// sends an urgent card to the phone, then again at 2, 5, 10 minutes and every 15 after,
// until a PHOTO lands on a private ack topic or --ack is run here. Text never clears it.
// The photo means Adam saw it, nothing more: nothing in this file knows how to trade.
//
// The ack topic name lives only in db/market-watch.local.json (gitignored). It is
// printed exactly once, by --init, so Adam can subscribe his phone. --status hides it.
//
// Spec: docs/superpowers/specs/2026-10-07-market-watch-design.md

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "../server/config.js";
import { nyDate } from "../server/nyDate.js";
import { loadTargets } from "./position-target.mjs";
import { deriveLevels, fetchQuotes, checkLevels, recordFired } from "../server/tripwire.js";
import * as MW from "../server/marketWatch.js";

export const NTFY = "https://ntfy.sh/bench-adam-7x3";
export const TICK_MS = 3 * 60 * 1000;

export const paths = (dir) => ({
  dir,
  config: resolve(dir, "market-watch.local.json"),
  state: resolve(dir, "market-watch-state.json"),
  tripState: resolve(dir, "tripwire-state.json"),
  archive: resolve(dir, "archive.json"),
  watchlist: resolve(dir, "watchlist.json"),
  targets: resolve(dir, "position-targets.json"),
});
export const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
export const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n", "utf8");
export function loadConfig(dir) {
  const cfg = readJson(paths(dir).config, null);
  if (!cfg) throw new Error("no local config - run --init first");
  return cfg;
}
const log = (...a) => console.log(new Date().toISOString(), ...a);

function init(dir) {
  const P = paths(dir);
  if (existsSync(P.config)) throw new Error(`${P.config} already exists - refusing to overwrite the ack topic`);
  const cfg = { ack_topic: MW.newAckTopic(), chat_link: "", halt: false };
  writeJson(P.config, cfg);
  console.log(`created ${P.config}`);
  console.log(`ack topic (subscribe the ntfy app to this, it is printed only now): ${cfg.ack_topic}`);
}

function setConfig(dir, patch) {
  const P = paths(dir);
  const cfg = loadConfig(dir);
  writeJson(P.config, { ...cfg, ...patch });
  console.log(`config updated: ${Object.keys(patch).join(", ")}`);
}

function status(dir) {
  const P = paths(dir);
  const cfg = loadConfig(dir);
  const state = readJson(P.state, { alarms: [] });
  const open = MW.openAlarms(state);
  console.log(`MARKET WATCH - ${cfg.halt ? "HALTED (config halt: true)" : "running state: ok"}`);
  console.log(`chat link: ${cfg.chat_link || "(not set - use --link)"}`);
  console.log(`ack topic: set (hidden)`);
  console.log(`open alarms: ${open.length}`);
  for (const a of open) {
    console.log(`  ${a.id}  sent ${a.sent.length}x  next in ${Math.max(0, MW.nextNagOffset(a.sent.length) - (Date.now() - Date.parse(a.opened)) / 60000).toFixed(1)} min`);
    for (const l of a.levels) console.log(`    ${l.side} ${MW.fmtLevel(l)}`);
  }
  const acked = state.alarms.filter((a) => a.acked).slice(-3);
  if (acked.length) console.log(`last acked: ${acked.map((a) => `${a.id} by ${a.acked.from} at ${a.acked.at}`).join("; ")}`);
}

async function testCard(dir, fetchFn = globalThis.fetch) {
  const cfg = loadConfig(dir);
  const alarm = { id: "test", opened: new Date().toISOString(), sent: [], acked: null, levels: [{ ticker: "TEST", kind: "TRIGGER", side: "BUY", price: 1, dir: "above", touched: 1, src: "test-card", key: "TEST|TRIGGER|1|above" }] };
  const card = MW.buildCard(alarm, cfg.chat_link);
  card.headers.Title = "THE BENCH - MARKET WATCH TEST CARD";
  await MW.sendCard(fetchFn, NTFY, card);
  console.log("test card sent. Tap it on the phone (it should open the chat), then send a photo to the ack topic.");
  console.log("Then run: node scripts/market-watch.mjs --once --dry  and read the acks line.");
}

export async function main(argv = process.argv.slice(2)) {
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = resolve(val("--dir") ?? process.env.MARKET_WATCH_DIR ?? resolve(ROOT, "db"));

  if (has("--init")) return init(dir);
  if (has("--link")) return setConfig(dir, { chat_link: val("--link") });
  if (has("--halt")) return setConfig(dir, { halt: true });
  if (has("--resume")) return setConfig(dir, { halt: false });
  if (has("--status")) return status(dir);
  if (has("--test-card")) return testCard(dir);
  if (has("--reset")) { writeJson(paths(dir).state, { alarms: [] }); return console.log("alarm state cleared"); }
  throw new Error("no mode given - see the header of scripts/market-watch.mjs");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
```

- [ ] **Step 4: Add the gitignore entries**

Append to `.gitignore`:

```
# Market watch (added 2026-10-07): the ack topic name and the alarm history stay on this PC.
db/market-watch.local.json
db/market-watch-state.json
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/market-watch.test.mjs`
Expected: `# pass 11`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/market-watch.mjs test/market-watch.test.mjs .gitignore
git commit -m "market-watch: CLI skeleton (init, link, halt, resume, status, test-card, reset) and gitignore" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Verify the two assumptions with Adam (phone photo, chat link)

No code is written in this task unless a verification fails. Everything here is done from the live checkout with Adam at his phone. **Do not go past this task until both checks have a recorded answer.**

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-market-watch-design.md` (the "Verify before building" section gets the results)

- [ ] **Step 1: Create the real config**

Run: `node scripts/market-watch.mjs --init`
Expected: `created ...db\market-watch.local.json` and one line with the ack topic. Tell Adam, in plain words: open the ntfy app, subscribe to that topic (read it to him from the terminal; do not paste it into the chat if the chat is remote-controlled from a phone that may show it on a lock screen - say it is in the terminal and he can read it there, or type it for him into the app via the phone only if he asks). Do not write the topic anywhere else.

- [ ] **Step 2: Set the chat link**

Get this session's link with the `mcp__ccd_session_mgmt__get_session` tool (`session_id: "self"`), field `link`. Then:

Run: `node scripts/market-watch.mjs --link <that link>`
Expected: `config updated: chat_link`.

- [ ] **Step 3: Send the test card and check Click**

Run: `node scripts/market-watch.mjs --test-card`
Ask Adam to tap the card on his phone. Record the answer:
- Opens this chat: PASS. Keep the link.
- Does nothing or opens a browser error: try the web form. Run `--link https://claude.ai/code` once (the session list; one more tap for Adam) and send another test card. Record which worked.

- [ ] **Step 4: Check the photo path**

Ask Adam to open the ack topic in the ntfy app and send a photo to it (on Android: the publish box has an attachment button; take or pick a photo and send). Then:

Run: `node -e "import('./server/marketWatch.js').then(async (m) => { const cfg = JSON.parse(require('fs').readFileSync('db/market-watch.local.json','utf8')); const msgs = await m.readAckTopic(fetch, cfg.ack_topic, new Date(Date.now() - 3600e3).toISOString()); console.log(msgs.map((x) => ({ event: x.event, type: x.attachment && x.attachment.type, time: x.time }))); })"`
Expected: one entry with `type: 'image/jpeg'` (or another `image/...`). That is PASS.

If the ntfy app on his phone cannot attach a photo (iPhone), record FAIL and tell Adam: the ack then works only through the chat path (photo sent into this chat, Claude runs `--ack --from chat`). The spec's ack-topic section is amended to say so, and Tasks 5 and 6 are still built as written (the topic poll simply never sees an image).

- [ ] **Step 5: Record the results in the spec**

Under "Verify before building past Task 1" in the spec, add a line per check: date, PASS or FAIL, and what was used (which link form; which phone OS).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-07-market-watch-design.md
git commit -m "market-watch: verification results for the phone photo path and the chat link" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: One tick: `--once`, `--dry`, `--ack`, and the fake feed for tests

**Files:**
- Modify: `scripts/market-watch.mjs`
- Modify: `test/market-watch.test.mjs` (append)

**Interfaces:**
- Consumes: Task 1 (`deriveLevels`, `fetchQuotes`, `checkLevels`, `recordFired`), Task 2 (state machine), Task 3 (`paths`, `readJson`, `writeJson`, `loadConfig`, `NTFY`).
- Produces: `tick({ dir, dry = false, now = new Date(), fetchFn = globalThis.fetch }) -> Promise<{ halted?: true, watching, tripped, added, acked, sent, failed }>`.
- Produces: `makeFakeFetch(file, dir)`: when env `MARKET_WATCH_FAKE_FEED=<json file>` is set, every network call is answered from that file and every card sent is appended to `<dir>/sent.json`. File shape: `{ "quotes": { "VST": { "regularMarketPrice": 142.5, "regularMarketDayLow": 141, "regularMarketDayHigh": 143.4, "previousClose": 140.02 } }, "ack": [ <ntfy json messages> ], "ntfy_ok": true }`.
- Produces: `--ack [--from chat|pc] [--note text]` mode.

- [ ] **Step 1: Write the failing tests**

Append to `test/market-watch.test.mjs`:

```js
const seed = (dir, { quotes = {}, ack = [], ntfy_ok = true } = {}) => {
  writeFileSync(join(dir, "archive.json"), JSON.stringify([
    { id: "B-717", ticker: "VST", date: "2026-10-07", call_type: "conditional", review_price: 147.98, trigger: 143.02 },
    { id: "B-663", ticker: "GOOGL", date: "2026-10-07", call_type: "long", review_price: 336.25, invalidation: 326 },
  ]));
  writeFileSync(join(dir, "watchlist.json"), "[]");
  const feed = join(dir, "feed.json");
  writeFileSync(feed, JSON.stringify({ quotes, ack, ntfy_ok }));
  return feed;
};
const yahoo = (last, low, high) => ({ regularMarketPrice: last, regularMarketDayLow: low, regularMarketDayHigh: high, previousClose: last });
const sentCards = (dir) => (existsSync(join(dir, "sent.json")) ? JSON.parse(readFileSync(join(dir, "sent.json"), "utf8")) : []);
const stateOf = (dir) => JSON.parse(readFileSync(join(dir, "market-watch-state.json"), "utf8"));

test("tick: a hit opens an alarm, sends the first card, records the tripwire state; a second tick inside 2 minutes sends nothing", () => {
  const dir = fresh();
  run(dir, ["--init"]);
  run(dir, ["--link", "claude://x"]);
  const feed = seed(dir, { quotes: { VST: yahoo(142.5, 141, 143.4), GOOGL: yahoo(340, 338, 345) } });
  const env = { MARKET_WATCH_FAKE_FEED: feed };
  let out = run(dir, ["--once", "--now", "2026-10-07T14:14:00Z"], env);
  assert.match(out, /tripped 1/);
  assert.match(out, /sent 1/);
  let cards = sentCards(dir);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].headers.Title, "THE BENCH - BUY level hit: VST 143.02");
  assert.equal(cards[0].headers.Click, "claude://x");
  assert.equal(stateOf(dir).alarms[0].sent.length, 1);
  const trip = JSON.parse(readFileSync(join(dir, "tripwire-state.json"), "utf8"));
  assert.equal(trip.fired[0].key, "VST|TRIGGER|143.02|above");
  out = run(dir, ["--once", "--now", "2026-10-07T14:15:00Z"], env);
  assert.match(out, /tripped 0/);
  assert.match(out, /sent 0/);
  assert.equal(sentCards(dir).length, 1);
  out = run(dir, ["--once", "--now", "2026-10-07T14:16:30Z"], env);
  assert.match(out, /sent 1/);
  assert.equal(sentCards(dir).length, 2);
  assert.match(sentCards(dir)[1].body, /nag 2 of many/);
});

test("tick: a photo on the ack topic clears the alarm and no more cards go out; text does not", () => {
  const dir = fresh();
  run(dir, ["--init"]);
  const feed = seed(dir, { quotes: { VST: yahoo(142.5, 141, 143.4), GOOGL: yahoo(340, 338, 345) } });
  const env = { MARKET_WATCH_FAKE_FEED: feed };
  run(dir, ["--once", "--now", "2026-10-07T14:14:00Z"], env);
  const f = JSON.parse(readFileSync(feed, "utf8"));
  f.ack = [{ event: "message", time: Math.floor(Date.parse("2026-10-07T14:15:00Z") / 1000), message: "saw it" }];
  writeFileSync(feed, JSON.stringify(f));
  let out = run(dir, ["--once", "--now", "2026-10-07T14:17:00Z"], env);
  assert.match(out, /acked 0/);
  assert.match(out, /sent 1/);
  f.ack.push({ event: "message", time: Math.floor(Date.parse("2026-10-07T14:18:00Z") / 1000), attachment: { type: "image/jpeg", url: "https://ntfy.sh/file/selfie.jpg" } });
  writeFileSync(feed, JSON.stringify(f));
  out = run(dir, ["--once", "--now", "2026-10-07T14:19:30Z"], env);
  assert.match(out, /acked 1/);
  assert.match(out, /sent 0/);
  assert.equal(stateOf(dir).alarms[0].acked.receipt, "https://ntfy.sh/file/selfie.jpg");
  assert.equal(stateOf(dir).alarms[0].acked.from, "phone");
  out = run(dir, ["--once", "--now", "2026-10-07T14:40:00Z"], env);
  assert.match(out, /sent 0/);
});

test("tick --dry sends nothing and writes nothing", () => {
  const dir = fresh();
  run(dir, ["--init"]);
  const feed = seed(dir, { quotes: { VST: yahoo(142.5, 141, 143.4), GOOGL: yahoo(340, 338, 345) } });
  const out = run(dir, ["--once", "--dry", "--now", "2026-10-07T14:14:00Z"], { MARKET_WATCH_FAKE_FEED: feed });
  assert.match(out, /tripped 1/);
  assert.match(out, /DRY/);
  assert.equal(existsSync(join(dir, "sent.json")), false);
  assert.equal(existsSync(join(dir, "market-watch-state.json")), false);
});

test("tick: halted config checks nothing; a feed failure for one ticker skips it; all failures throw", () => {
  const dir = fresh();
  run(dir, ["--init"]);
  const feed = seed(dir, { quotes: { GOOGL: yahoo(340, 338, 345) } });   // VST missing = 404
  const env = { MARKET_WATCH_FAKE_FEED: feed };
  let out = run(dir, ["--once", "--now", "2026-10-07T14:14:00Z"], env);
  assert.match(out, /failed 1/);
  assert.match(out, /tripped 0/);
  run(dir, ["--halt"]);
  out = run(dir, ["--once", "--now", "2026-10-07T14:14:00Z"], env);
  assert.match(out, /halted/);
  run(dir, ["--resume"]);
  writeFileSync(feed, JSON.stringify({ quotes: {}, ack: [] }));
  assert.throws(() => run(dir, ["--once", "--now", "2026-10-07T14:14:00Z"], env), /all quote fetches failed/);
});

test("--ack clears every open alarm from the PC and records the source", () => {
  const dir = fresh();
  run(dir, ["--init"]);
  const feed = seed(dir, { quotes: { VST: yahoo(142.5, 141, 143.4), GOOGL: yahoo(325, 325.5, 340) } });
  const env = { MARKET_WATCH_FAKE_FEED: feed };
  run(dir, ["--once", "--now", "2026-10-07T14:14:00Z"], env);
  assert.equal(stateOf(dir).alarms[0].levels.length, 2, "VST trigger and GOOGL stop in one alarm");
  const out = run(dir, ["--ack", "--from", "chat", "--note", "selfie arrived in chat"]);
  assert.match(out, /acked 1 alarm/);
  const a = stateOf(dir).alarms[0].acked;
  assert.equal(a.from, "chat");
  assert.equal(a.receipt, "selfie arrived in chat");
  assert.match(run(dir, ["--status"]), /open alarms: 0/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/market-watch.test.mjs`
Expected: the 5 new tests FAIL (`no mode given` for `--once`, `--ack`).

- [ ] **Step 3: Add the fake feed, `tick` and `--ack` to `scripts/market-watch.mjs`**

Insert after the `log` helper and before `function init`:

```js
// Test seam. When MARKET_WATCH_FAKE_FEED names a JSON file, every network call is answered
// from it: Yahoo quotes from .quotes, the ack topic from .ack, and each card POSTed to the
// phone is appended to <dir>/sent.json instead of being sent. Never set in production.
export function makeFakeFetch(file, dir) {
  const read = () => JSON.parse(readFileSync(file, "utf8"));
  return async (url, opts = {}) => {
    const f = read();
    if (url.startsWith(NTFY) && opts.method === "POST") {
      if (f.ntfy_ok === false) return { ok: false, status: 500 };
      const sentPath = resolve(dir, "sent.json");
      writeJson(sentPath, [...readJson(sentPath, []), { headers: opts.headers, body: opts.body }]);
      return { ok: true };
    }
    if (url.includes("ntfy.sh/") && url.includes("/json?poll=1")) {
      return { ok: true, text: async () => (f.ack || []).map((m) => JSON.stringify(m)).join("\n") };
    }
    const m = url.match(/\/chart\/([^?]+)\?/);
    const meta = m && f.quotes && f.quotes[decodeURIComponent(m[1])];
    if (!meta) return { ok: false, status: 404 };
    return { ok: true, json: async () => ({ chart: { result: [{ meta }] } }) };
  };
}

export function pickFetch(dir) {
  return process.env.MARKET_WATCH_FAKE_FEED ? makeFakeFetch(process.env.MARKET_WATCH_FAKE_FEED, dir) : globalThis.fetch;
}

export async function tick({ dir, dry = false, now = new Date(), fetchFn = pickFetch(dir) }) {
  const P = paths(dir);
  const cfg = loadConfig(dir);
  if (cfg.halt) { log("halted by config - nothing checked"); return { halted: true }; }
  const today = nyDate(now);
  let state = readJson(P.state, { alarms: [] });
  const trip = readJson(P.tripState, { fired: [] });

  // 1. levels and quotes, exactly as the tripwire does it
  const arch = readJson(P.archive, []);
  const rows = Array.isArray(arch) ? arch : (arch.rows || arch.archive || []);
  const watchlist = readJson(P.watchlist, []);
  const { watching } = deriveLevels({ rows, watchlist, targets: loadTargets(P.targets), today });
  const tickers = [...new Set(watching.map((l) => l.ticker))];
  const { quotes, failed } = await fetchQuotes(tickers, fetchFn);
  if (tickers.length && !Object.keys(quotes).length) throw new Error(`all quote fetches failed: ${failed.join(", ")}`);
  const tripped = checkLevels(watching, quotes, trip, today);

  // 2. open or join an alarm
  const opened = MW.openOrJoin(state, tripped, now);
  state = opened.state;

  // 3. acks first, so a photo that already landed stops the next card
  let acked = [];
  const open = MW.openAlarms(state);
  if (open.length) {
    const since = open.map((a) => a.opened).sort()[0];
    try {
      const msgs = await MW.readAckTopic(fetchFn, cfg.ack_topic, since);
      const r = MW.applyAcks(state, msgs, "phone");
      state = r.state; acked = r.acked;
    } catch (e) { log(`ack topic read failed: ${e.message} - alarms unchanged`); }
  }

  // 4. sends that are due
  const sent = [];
  for (const a of MW.openAlarms(state)) {
    if (!MW.nagDue(a, now)) continue;
    const card = MW.buildCard(a, cfg.chat_link, now);
    if (dry) { sent.push(card.title); continue; }
    try { await MW.sendCard(fetchFn, NTFY, card); a.sent.push(now.toISOString()); sent.push(card.title); }
    catch (e) { log(`send failed: ${e.message} - will retry next tick`); }
  }

  // 5. write
  if (!dry) {
    if (tripped.length) writeJson(P.tripState, recordFired(trip, tripped, today, now));
    writeJson(P.state, state);
  }
  log(`${dry ? "DRY " : ""}watching ${watching.length} · tripped ${tripped.length} · added ${opened.added.length} · acked ${acked.length} · sent ${sent.length} · failed ${failed.length}`);
  return { watching: watching.length, tripped, added: opened.added, acked, sent, failed };
}

function ack(dir, from, note) {
  const P = paths(dir);
  loadConfig(dir);
  const r = MW.ackAll(readJson(P.state, { alarms: [] }), { from, note });
  writeJson(P.state, r.state);
  console.log(`acked ${r.acked.length} alarm(s) from ${from}${note ? `: ${note}` : ""}`);
}
```

In `main`, add before the final `throw`:

```js
  if (has("--ack")) return ack(dir, val("--from") ?? "pc", val("--note") ?? "");
  if (has("--once")) return tick({ dir, dry: has("--dry"), now: val("--now") ? new Date(val("--now")) : new Date() });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/market-watch.test.mjs`
Expected: `# pass 16`, `# fail 0`.

- [ ] **Step 5: One real dry tick against the live book**

Run: `node scripts/market-watch.mjs --once --dry`
Expected: a line like `DRY watching N · tripped K · added K · acked 0 · sent K · failed F` with real counts, no card on the phone, no state file written (`--status` still shows `open alarms: 0`). If `tripped` is more than 0 that is a real level hit on today's range and belongs in the next framework session; say so to Adam.

- [ ] **Step 6: Commit**

```bash
git add scripts/market-watch.mjs test/market-watch.test.mjs
git commit -m "market-watch: one tick (levels, alarms, acks, due sends), --ack, fake feed seam (5 tests)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The loop: session window, carry-over card, down card

**Files:**
- Modify: `scripts/market-watch.mjs`
- Modify: `test/market-watch.test.mjs` (append)

**Interfaces:**
- Consumes: `tick`, `paths`, `readJson`, `writeJson`, `loadConfig`, `pickFetch` (Task 5); `MW.ct`, `MW.WINDOW`, `MW.openAlarms`, `MW.unansweredCard`, `MW.downCard`, `MW.sendCard` (Task 2).
- Produces: `carryOver({ dir, now, fetchFn }) -> Promise<{ carried: id[] }>`; `loop({ dir, sleep, clock, maxTicks })` where `sleep(ms)` and `clock() -> Date` are injectable; `--carry` and `--loop` modes.

- [ ] **Step 1: Write the failing tests**

Append to `test/market-watch.test.mjs`:

```js
import { carryOver, loop } from "../scripts/market-watch.mjs";

test("carryOver: an alarm left open yesterday gets one UNANSWERED card today, and only one", async () => {
  const dir = fresh();
  run(dir, ["--init"]);
  run(dir, ["--link", "claude://x"]);
  const feed = seed(dir, { quotes: { GOOGL: yahoo(325, 325.5, 340), VST: yahoo(140, 139, 141) } });
  const env = { MARKET_WATCH_FAKE_FEED: feed };
  run(dir, ["--once", "--now", "2026-10-06T19:50:00Z"], env);   // 14:50 CT Tuesday: GOOGL stop hit
  assert.equal(sentCards(dir).length, 1);
  process.env.MARKET_WATCH_FAKE_FEED = feed;
  let r = await carryOver({ dir, now: new Date("2026-10-07T13:25:00Z") });
  assert.deepEqual(r.carried, ["2026-10-06-1450"]);
  const cards = sentCards(dir);
  assert.equal(cards.length, 2);
  assert.equal(cards[1].headers.Title, "THE BENCH - UNANSWERED from 2026-10-06");
  assert.equal(cards[1].headers.Click, "claude://x");
  r = await carryOver({ dir, now: new Date("2026-10-07T13:28:00Z") });
  assert.deepEqual(r.carried, [], "already carried today");
  assert.equal(sentCards(dir).length, 2);
  delete process.env.MARKET_WATCH_FAKE_FEED;
});

test("loop: sleeps before 08:25, ticks inside the window, exits at 15:05, sends the DOWN card after three failed ticks", async () => {
  const dir = fresh();
  run(dir, ["--init"]);
  const feed = seed(dir, { quotes: {} });   // every quote 404s -> every tick throws
  process.env.MARKET_WATCH_FAKE_FEED = feed;
  const times = [
    "2026-10-07T13:20:00Z", // 08:20 CT: before the window, sleep 60s
    "2026-10-07T13:25:00Z", // 08:25: tick 1 (fails)
    "2026-10-07T13:28:00Z", // tick 2 (fails)
    "2026-10-07T13:31:00Z", // tick 3 (fails) -> DOWN card
    "2026-10-07T13:34:00Z", // tick 4 (fails) -> no second DOWN card
    "2026-10-07T20:05:00Z", // 15:05: exit
  ];
  let i = 0;
  const sleeps = [];
  const r = await loop({ dir, clock: () => new Date(times[Math.min(i++, times.length - 1)]), sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(r.reason, "window closed");
  assert.equal(r.ticks, 4);
  assert.equal(sleeps[0], 60000, "a one-minute sleep before the open");
  assert.equal(sleeps[1], 180000, "three minutes between ticks");
  const cards = sentCards(dir);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].headers.Title, "THE BENCH - MARKET WATCH DOWN");
  delete process.env.MARKET_WATCH_FAKE_FEED;
});

test("loop: exits at once on a weekend", async () => {
  const dir = fresh();
  run(dir, ["--init"]);
  const r = await loop({ dir, clock: () => new Date("2026-10-10T15:00:00Z"), sleep: async () => {} });
  assert.equal(r.reason, "window closed");
  assert.equal(r.ticks, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/market-watch.test.mjs`
Expected: the 3 new tests FAIL (`carryOver`/`loop` are not exported).

- [ ] **Step 3: Add `carryOver` and `loop` to `scripts/market-watch.mjs`**

Insert after `function ack(...)`:

```js
// Alarms left open at yesterday's close come back as ONE card before the first tick of the
// day, then follow the normal schedule. `carried` on the alarm stops it being sent twice.
export async function carryOver({ dir, now = new Date(), fetchFn = pickFetch(dir) }) {
  const P = paths(dir);
  const cfg = loadConfig(dir);
  if (cfg.halt) return { carried: [] };
  const state = readJson(P.state, { alarms: [] });
  const { date } = MW.ct(now);
  const old = MW.openAlarms(state).filter((a) => a.id.slice(0, 10) < date && a.carried !== date);
  if (!old.length) return { carried: [] };
  await MW.sendCard(fetchFn, NTFY, MW.unansweredCard(old, cfg.chat_link));
  for (const a of old) a.carried = date;
  writeJson(P.state, state);
  log(`carried ${old.length} unanswered alarm(s) from ${[...new Set(old.map((a) => a.id.slice(0, 10)))].join(", ")}`);
  return { carried: old.map((a) => a.id) };
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loop({ dir, clock = () => new Date(), sleep = realSleep } = {}) {
  let ticks = 0, failures = 0, downSent = false, carried = false;
  for (;;) {
    const now = clock();
    const { hhmm, weekday } = MW.ct(now);
    if (weekday === "Sat" || weekday === "Sun" || hhmm >= MW.WINDOW.close) {
      log(`outside the session window (${weekday} ${hhmm} CT) - exiting`);
      return { reason: "window closed", ticks };
    }
    if (hhmm < MW.WINDOW.open) { await sleep(60_000); continue; }
    if (!carried) {
      carried = true;
      try { await carryOver({ dir, now }); } catch (e) { log(`carry-over failed: ${e.message}`); }
    }
    try {
      await tick({ dir, now });
      failures = 0;
    } catch (e) {
      failures++;
      log(`tick failed (${failures} in a row): ${e.message}`);
      if (failures >= 3 && !downSent) {
        try { await MW.sendCard(pickFetch(dir), NTFY, MW.downCard()); downSent = true; } catch (e2) { log(`down card failed: ${e2.message}`); }
      }
    }
    ticks++;
    await sleep(TICK_MS);
  }
}
```

In `main`, add before the final `throw`:

```js
  if (has("--carry")) return carryOver({ dir });
  if (has("--loop")) return loop({ dir });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/market-watch.test.mjs`
Expected: `# pass 19`, `# fail 0`.

Run: `node --test test/tripwire.test.mjs`
Expected: `# pass 5`.

- [ ] **Step 5: Commit**

```bash
git add scripts/market-watch.mjs test/market-watch.test.mjs
git commit -m "market-watch: the loop (session window, carry-over card, down card after three failures) (3 tests)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Run it for real once, inside a session

**Files:** none changed unless something is wrong.

- [ ] **Step 1: Status and a live dry tick**

Run: `node scripts/market-watch.mjs --status`
Expected: `running state: ok`, the chat link from Task 4, `open alarms: 0`.

Run: `node scripts/market-watch.mjs --once --dry`
Expected: a DRY summary line with real counts.

- [ ] **Step 2: A real tick during the session**

Only between 08:25 and 15:05 CT on a weekday, with Adam told it is happening:

Run: `node scripts/market-watch.mjs --once`
Expected: if `tripped 0`, nothing is sent and the state file is written with `alarms: []`. If a level is really hit, a real card goes to the phone and the alarm is open; Adam sends the selfie (ack topic or chat); the next `--once` prints `acked 1`. Whatever happens is also a real level hit on the book and gets its framework run.

- [ ] **Step 3: Record it**

Add a `**[Claude]**` line to the day's worklog (`Projects\docs\handoffs\worklog\YYYY-MM-DD.md`) with CLAIMED / TOUCHED / PRODUCED / LEFT, naming the first real tick and its result.

---

### Task 8: Scheduled task script and the repo note

**Files:**
- Create: `docs/handoffs/2026-10-07-market-watch-task.ps1`
- Modify: `CLAUDE.md` (one bullet in "The setup we actually use", after the `tripwire`/insider-check bullets)

- [ ] **Step 1: Write the registration script**

Create `docs/handoffs/2026-10-07-market-watch-task.ps1`:

```powershell
# Registers "Bench Market Watch": weekdays 08:25 Central, runs the watcher loop from the
# live checkout. It exits by itself at 15:05. Read before running. Run from an elevated
# or normal PowerShell; it only touches the current user's tasks.
#
#   powershell -ExecutionPolicy Bypass -File C:\Users\steam\Projects\apps\the-bench\docs\handoffs\2026-10-07-market-watch-task.ps1
#
# To remove:  schtasks /Delete /TN "Bench Market Watch" /F

$repo = "C:\Users\steam\Projects\apps\the-bench"
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\market-watch.mjs --loop" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 08:25
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 8) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Bench Market Watch" -Action $action -Trigger $trigger -Settings $settings -Description "The Bench: level-hit nag that stops at a selfie. Exits at 15:05 CT." -Force
Write-Host "Registered. Next run:" (Get-ScheduledTask -TaskName "Bench Market Watch" | Get-ScheduledTaskInfo).NextRunTime
```

- [ ] **Step 2: Register it, at Adam's word**

Tell Adam the script is written and what it does (one sentence), and ask for the go. On his yes:

Run: `powershell -ExecutionPolicy Bypass -File docs/handoffs/2026-10-07-market-watch-task.ps1`
Expected: `Registered. Next run: <next weekday 08:25>`.

Then: `schtasks /Query /TN "Bench Market Watch" /FO LIST`
Expected: `Status: Ready`.

- [ ] **Step 3: Add the CLAUDE.md bullet**

Insert after the `**Insider checks:**` bullet in `CLAUDE.md`:

```markdown
- **Market watch (2026-10-07, Adam: "doesn't stop notifying you until you send a selfie"):** `node scripts/market-watch.mjs --loop` runs weekdays 08:25-15:05 CT as the Windows task `Bench Market Watch`. Same levels as the tripwire (`server/tripwire.js`), checked every 3 minutes; a buy or sell level hit opens an alarm and sends an urgent card (tap opens the chat), again at 2, 5, 10 minutes and every 15 after, until a PHOTO lands on the private ack topic or `--ack --from chat` is run after a selfie arrives in the chat. Text never clears it. The photo is an acknowledgment, never permission. `--status` shows open alarms; `--halt` / `--resume` pause it; the ack topic name lives only in `db/market-watch.local.json` and is never written anywhere else. Unanswered alarms come back as one UNANSWERED card the next morning. Spec: `docs/superpowers/specs/2026-10-07-market-watch-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/handoffs/2026-10-07-market-watch-task.ps1 CLAUDE.md
git commit -m "market-watch: scheduled task script and the CLAUDE.md note" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: Session end**

Vault: add `**[Claude]**` bullets to `Daily/YYYY-MM-DD.md`, update `The Bench.md` hub `status` / `next`, add a Dev Log line. Worklog line with the commits. Push is Adam's call; say the branch is ahead and leave it.

---

## Self-review against the spec

- Component 1 (modes): `--loop --once --status --ack --init --link --dry --reset` are Tasks 3, 5, 6; `--halt/--resume/--carry/--test-card` added for the halt flag, the carry-over and the verification. Covered.
- Component 2 (tripwire split): Task 1. Covered.
- Component 3 (card): Task 2 `buildCard`; schedule in `nextNagOffset`/`nagDue`; sends stop at 15:05 because `loop` exits and `tick` is never called outside it. Covered.
- Component 4 (ack topic): Task 2 `readAckTopic`/`applyAcks`/`isImage`; Task 3 `--init` prints the topic once; `--status` hides it. Covered.
- Component 5 (chat path): Task 5 `--ack --from chat`. Covered.
- Component 6 (files): Task 3 paths and gitignore. Covered.
- Component 7 (close of day, next morning): Task 6 `carryOver` and the window exit. Covered.
- Component 8 (launch): Task 8. Covered.
- Component 9 (errors): Task 5 per-ticker skip and all-failed throw, ack read failure leaves alarms, send failure not recorded; Task 6 three failures send one DOWN card. Covered.
- Component 10 (tests): 5 + 19 tests across Tasks 1-6. Covered.
- Verify-first section: Task 4, before any daemon code. Covered.
- Type check: `tick` returns `{ watching, tripped, added, acked, sent, failed }` and the tests read the log line, not the return; `carryOver` returns `{ carried }`; `loop` returns `{ reason, ticks }`; `Alarm.carried` is a date string. Consistent across Tasks 2, 5, 6.
- Known soft spot: the `--now` flag is read in `main` for `--once` only; `--loop` always uses the real clock (tests inject `clock`). Stated here so nobody looks for a `--now` on the loop.
