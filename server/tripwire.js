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
//
// Gate A - latest live row per ticker. Superseded plans (MU 920 -> 915 -> 881) must
// not all sit armed at once; that is how a dead level fires a false alert.
//
// Gate B - THE BOOK KILLS PLANS IN PROSE, NOT IN A FIELD. B-132 declared EWY "DEAD",
// B-141 "RETIRED" the MUU trigger, B-147 closed GDS - and not one of those rows
// carries a machine-readable flag saying so. So the watchlist STATUS is the kill
// switch, because that field is maintained. If a ticker reads CLOSED / PASS / AVOID
// there, its levels are dropped no matter what the book says.
//
// Gate C - v25: "stale levels are dead levels." A conditional nobody has re-run in
// maxAge days is not a live plan, it is a fossil. Default 14 days.
export function deriveLevels({ rows, watchlist, targets = [], today = nyDate(), maxAge = 14, all = false }) {
  const levels = [];
  const add = (l) => { if (l.price > 0) levels.push(l); };
  const killed = new Set(watchlist.filter((w) => KILL_STATUSES.includes(w.status)).map((w) => w.sym));
  const ageDays = (d) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);

  const latest = new Map();
  const dropped = [];
  for (const r of rows) {
    if (r.outcome) { latest.delete(r.ticker); continue; }   // closed: stop watching
    if (r.call_type === "conditional" || r.call_type === "long") latest.set(r.ticker, r);
  }
  for (const [ticker, r] of [...latest]) {
    if (killed.has(ticker)) { latest.delete(ticker); dropped.push(`${ticker} (watchlist says ${watchlist.find((w) => w.sym === ticker).status})`); continue; }
    if (!all && r.date && ageDays(r.date) > maxAge) { latest.delete(ticker); dropped.push(`${ticker} (${r.id}, ${ageDays(r.date)}d old)`); }
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
  for (const w of watchlist) {
    if (KILL_STATUSES.includes(w.status)) continue;
    if (w.buy_zone) add({ ticker: w.sym, kind: "BUY ZONE", price: Number(w.buy_zone), dir: "below", src: "watchlist" });
    if (w.floor) add({ ticker: w.sym, kind: "FLOOR", price: Number(w.floor), dir: "below", src: "watchlist" });
  }
  // Targets on positions already held (2026-09-28, B-594). Not age-gated: a target leaves
  // when the position closes (position-target.mjs remove) or the watchlist kills the name.
  for (const t of targets) {
    if (killed.has(t.sym)) continue;
    add({ ticker: t.sym, kind: "TARGET", price: Number(t.target), dir: "above", src: t.row });
  }
  // De-dupe identical ticker+kind+price
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
