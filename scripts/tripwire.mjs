// tripwire.mjs — the cheap half of the alerting system.
//
//   node scripts/tripwire.mjs              check every committed level, ping on a new trip
//   node scripts/tripwire.mjs --dry        check and report, send no push, write no state
//   node scripts/tripwire.mjs --list       just show the levels being watched, no network
//   node scripts/tripwire.mjs --json       machine-readable
//   node scripts/tripwire.mjs --reset      clear the fired-state file
//
// EXIT CODE: 0 = nothing new tripped · 1 = something tripped · 2 = fetch failure.
//
// WHAT THIS IS, IN ONE LINE: a smoke detector, not a fire inspector.
//
// It does exactly one thing — compare a price to a number — and it is deliberately
// too stupid to do anything else. It cannot analyse, cannot grade, cannot decide,
// and MUST NEVER be read as a trade signal. When it fires, the ONLY correct next
// step is a full v25 run against LIVE ROBINHOOD DATA, because the number that
// woke you came from a free public feed that is sometimes delayed and occasionally
// wrong. This is allowed to be wrong. That is why it is never allowed to decide.
//
// WHY IT EXISTS
// -------------
// bench-fastmover-watch does this same comparison properly — against Robinhood,
// inside the framework — but it costs a full Claude session, so it runs three
// times a day: 8:50a, 12:50p, 2:50p CT. A level can trip and reverse between two
// of those and nobody ever knows. That is not hypothetical: on 2026-08-19 GDS was
// stopped at 32.60 at 8:50am, printed a session low of 32.385 at 9:15, and closed
// 33.34 — the entire round trip happened between two scheduled checks.
//
// This script costs nothing to run, so it can run every few minutes all day. It
// wakes the expensive thing only when a level is actually touched.
//
// THE DAY-RANGE TRICK, which is the whole reason this works:
// it compares against the session's LOW and HIGH, not the current price. So a
// level touched at 9:15 and recovered by 9:30 is still caught at 9:35. A spot-only
// poller would miss exactly the moves that matter most.
//
// LIMITS, stated plainly:
//   - Free feed (Yahoo). Delayed up to ~15 min, and occasionally prints a bad tick.
//   - Regular session only. Overnight and pre-market moves are NOT covered.
//   - It CANNOT start a Claude session by itself. It pushes to the phone and writes
//     db/tripwire-state.json; bench-fastmover-watch reads that file on its next run,
//     so a trip is never lost even if the push is missed.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../server/config.js";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const STATE = resolve(ROOT, "db/tripwire-state.json");
const NTFY = "https://ntfy.sh/bench-adam-7x3";
const today = new Date().toISOString().slice(0, 10);

if (has("--reset")) { writeFileSync(STATE, JSON.stringify({ fired: [] }, null, 2)); console.log("state cleared"); process.exit(0); }

// ---- 1. derive every level we have actually committed to ---------------------
const wl = JSON.parse(readFileSync(resolve(ROOT, "db/watchlist.json"), "utf8"));
const arch = JSON.parse(readFileSync(resolve(ROOT, "db/archive.json"), "utf8"));
const rows = Array.isArray(arch) ? arch : (arch.rows || arch.archive);

const levels = [];
const add = (l) => { if (l.price > 0) levels.push(l); };

// THREE GATES, and the second one is the important one.
//
// Gate A — latest live row per ticker. Superseded plans (MU 920 -> 915 -> 881) must
// not all sit armed at once; that is how a dead level fires a false alert.
//
// Gate B — THE BOOK KILLS PLANS IN PROSE, NOT IN A FIELD. B-132 declared EWY "DEAD",
// B-141 "RETIRED" the MUU trigger, B-147 closed GDS — and not one of those rows
// carries a machine-readable flag saying so. A first run of this script watched
// HPQ's closed stop, EWY's dead trigger and MUU's retired one. So the watchlist
// STATUS is used as the kill switch, because that field is maintained. If a ticker
// reads CLOSED / PASS / AVOID there, its levels are dropped no matter what the book
// says. (The real fix is a superseded_by field on the row; until that exists, this
// is the honest workaround and it is deliberately conservative.)
//
// Gate C — v25: "stale levels are dead levels." A conditional nobody has re-run in
// MAX_AGE days is not a live plan, it is a fossil. Default 14 days.
const MAX_AGE = Number(val("--max-age") ?? 14);
const killed = new Set(wl.filter((w) => ["CLOSED", "PASS", "AVOID"].includes(w.status)).map((w) => w.sym));
const ageDays = (d) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);

const latest = new Map();
const dropped = [];
for (const r of rows) {
  if (r.outcome) { latest.delete(r.ticker); continue; }   // closed: stop watching
  if (r.call_type === "conditional" || r.call_type === "long") latest.set(r.ticker, r);
}
for (const [ticker, r] of [...latest]) {
  if (killed.has(ticker)) { latest.delete(ticker); dropped.push(`${ticker} (watchlist says ${wl.find((w) => w.sym === ticker).status})`); continue; }
  if (!has("--all") && r.date && ageDays(r.date) > MAX_AGE) { latest.delete(ticker); dropped.push(`${ticker} (${r.id}, ${ageDays(r.date)}d old)`); }
}

for (const [ticker, r] of latest) {
  if (r.call_type === "conditional" && r.trigger) {
    // Direction from the plan itself: a trigger BELOW the review price is a
    // pullback/accumulation entry; ABOVE it is a breakout.
    const dir = r.review_price && r.trigger < r.review_price ? "below" : "above";
    add({ ticker, kind: "TRIGGER", price: Number(r.trigger), dir, src: r.id });
  }
  if (r.invalidation) {
    add({ ticker, kind: r.call_type === "long" ? "STOP" : "FLOOR", price: Number(r.invalidation), dir: "below", src: r.id });
  }
}

// Watchlist zones and floors, for names carrying a declared accumulation zone.
for (const w of wl) {
  if (["CLOSED", "PASS", "AVOID"].includes(w.status)) continue;
  if (w.buy_zone) add({ ticker: w.sym, kind: "BUY ZONE", price: Number(w.buy_zone), dir: "below", src: "watchlist" });
  if (w.floor) add({ ticker: w.sym, kind: "FLOOR", price: Number(w.floor), dir: "below", src: "watchlist" });
}

// De-dupe identical ticker+kind+price
const seen = new Set();
const watching = levels.filter((l) => { const k = `${l.ticker}|${l.kind}|${l.price}`; if (seen.has(k)) return false; seen.add(k); return true; });

if (has("--list")) {
  console.log(`\nWATCHING ${watching.length} level(s) — no network called\n`);
  if (dropped.length) console.log(`  DROPPED as dead or stale (${dropped.length}): ${dropped.join(", ")}\n`);
  for (const l of watching) console.log(`  ${l.ticker.padEnd(6)} ${l.kind.padEnd(9)} ${l.dir === "below" ? "<=" : ">="} ${String(l.price).padStart(9)}   (${l.src})`);
  console.log("");
  process.exit(0);
}

// ---- 2. one cheap fetch per ticker -------------------------------------------
const tickers = [...new Set(watching.map((l) => l.ticker))];
const quotes = {};
const failed = [];

for (const t of tickers) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1m&range=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const m = (await res.json()).chart.result[0].meta;
    quotes[t] = { last: m.regularMarketPrice, low: m.regularMarketDayLow, high: m.regularMarketDayHigh, prev: m.previousClose };
  } catch (e) { failed.push(`${t} (${e.message})`); }
}

if (!Object.keys(quotes).length) {
  console.error(`\nAll quote fetches failed: ${failed.join(", ")}`);
  console.error("This is a FETCH FAILURE, not 'nothing tripped'. Do not read silence as safety.\n");
  process.exit(2);
}

// ---- 3. compare against the session RANGE, not just spot ---------------------
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { fired: [] };
const alreadyFired = new Set((state.fired || []).filter((f) => f.date === today).map((f) => f.key));

const tripped = [];
for (const l of watching) {
  const q = quotes[l.ticker];
  if (!q) continue;
  const extreme = l.dir === "below" ? q.low : q.high;
  if (extreme == null) continue;
  const hit = l.dir === "below" ? extreme <= l.price : extreme >= l.price;
  if (!hit) continue;
  const key = `${l.ticker}|${l.kind}|${l.price}|${l.dir}`;
  if (alreadyFired.has(key)) continue;
  tripped.push({ ...l, key, touched: extreme, last: q.last });
}

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

  state.fired = [...(state.fired || []).filter((f) => f.date === today), ...tripped.map((t) => ({ date: today, key: t.key, ticker: t.ticker, kind: t.kind, price: t.price, touched: t.touched, at: new Date().toISOString() }))];
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n", "utf8");
  console.log(`recorded to db/tripwire-state.json — bench-fastmover-watch reads this on its next run, so the trip is not lost if the push is missed.`);
}

console.log("");
process.exit(1);
