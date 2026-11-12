#!/usr/bin/env node
// pump-watch.mjs - "watch AMZN for the pump" (Adam, 2026-11-04). Registers a name for a 5-minute direction
// check until lunch; scripts/trip-judge.mjs runs the check on its own 5-minute tick (Windows task
// "Bench Trip Judge", weekdays 08:30 CT on) and starts the judge on the first UP or DOWN call.
//
//   node scripts/pump-watch.mjs add AMZN --why "election sweep, buyers gapping up" --by adam|routine|desk [--until 12:00] [--date YYYY-MM-DD]
//   node scripts/pump-watch.mjs list
//   node scripts/pump-watch.mjs remove AMZN
//   node scripts/pump-watch.mjs read AMZN        one read now, printed, nothing saved or sent
//
// Whoever adds a watch also runs the hunters on it the same session (hunt-short.mjs and options-hunter.mjs
// with --symbols), per Adam's order; this script only keeps the watch and reads the tape.
// Registry: db/pump-watch.json. Logic: server/pumpWatch.js. Tests: test/pump-watch.test.mjs.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "../server/config.js";
import { nyDate } from "../server/nyDate.js";
import { readDirection, preMarketRead, atr14, DEFAULT_UNTIL, WATCH_BY } from "../server/pumpWatch.js";

export const REGISTRY = resolve(ROOT, "db/pump-watch.json");
export const loadWatches = (p = REGISTRY) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { watches: [] });
export const saveWatches = (d, p = REGISTRY) => writeFileSync(p, JSON.stringify(d, null, 2) + "\n");

// Load, change one watch, save: never write back a stale copy (review finding 6a). Returns the changed watch.
export function updateWatch(ticker, date, fn, p = REGISTRY) {
  const reg = loadWatches(p);
  let out = null;
  reg.watches = reg.watches.map((x) => (x.ticker === ticker && x.date === date ? (out = fn(x)) : x));
  if (out) saveWatches(reg, p);
  return out;
}

const UA = { headers: { "User-Agent": "Mozilla/5.0" } };

// Today's 5-minute bars (pre-market and regular session) and the 20-day average volume and ATR(14), from the free
// Yahoo feed. The pre-market bars (includePrePost, 2026-11-12: "Watch starts at 8am catches the pre market") feed
// only preMarketRead; readDirection keeps to the regular session by timestamp.
export async function fetchTape(sym, fetchFn = globalThis.fetch) {
  const enc = encodeURIComponent(sym);
  const intraday = await fetchFn(`https://query1.finance.yahoo.com/v8/finance/chart/${enc}?interval=5m&range=1d&includePrePost=true`, UA);
  if (!intraday.ok) throw new Error(`intraday ${intraday.status}`);
  const r = (await intraday.json()).chart.result[0];
  const q = r.indicators.quote[0];
  const bars = (r.timestamp || []).map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] }));
  const reg = r.meta.currentTradingPeriod.regular;
  const preStart = r.meta.currentTradingPeriod.pre?.start ?? reg.start;
  // The day's volume is Yahoo's own day total, which matched Robinhood's to the share. Never the sum of the
  // 5-minute bars, which carry junk rows (B-1362). It counts only if its last regular trade is inside today's session:
  // anything else may be yesterday's total, and a whole day's volume on a morning clock would read as a huge pace.
  const today = Number.isFinite(r.meta.regularMarketTime) && r.meta.regularMarketTime >= reg.start;
  const dayVolume = today ? r.meta.regularMarketVolume ?? null : null;
  let avgVol = null, atr = null;
  try {
    const daily = await fetchFn(`https://query1.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=2mo`, UA);
    if (daily.ok) {
      const d = (await daily.json()).chart.result[0];
      const vols = (d.indicators.quote[0].volume || []).filter((v) => v > 0);
      const past = vols.slice(-21, -1); // the 20 sessions before today
      if (past.length) avgVol = past.reduce((a, b) => a + b, 0) / past.length;
      // ATR from completed sessions only: today's daily bar (stamped at or after today's pre-market start) is still moving.
      const dq = d.indicators.quote[0];
      atr = atr14((d.timestamp || []).map((t, i) => ({ t, h: dq.high[i], l: dq.low[i], c: dq.close[i] })).filter((b) => b.t < preStart));
    }
  } catch {}
  return { bars, prevClose: r.meta.chartPreviousClose ?? r.meta.previousClose, avgVol, atr, dayVolume, preStart, regStart: reg.start, regEnd: reg.end };
}

export async function readNow(sym, fetchFn, now = Date.now()) {
  const tape = await fetchTape(sym, fetchFn);
  // On a holiday, or a stale feed, Yahoo's "current" session is an old one: its pre-market would print as today's
  // and its full session would read as past 09:00. No read at all then (review 2026-11-12, finding 6).
  const session = nyDate(new Date(tape.regStart * 1000));
  if (session !== nyDate(new Date(now))) return { read: "FORMING", why: `the feed's session is ${session}, not today`, last: null, prev: null, pre: null };
  return { ...readDirection({ ...tape, now }), pre: preMarketRead(tape) };
}

async function main(argv = process.argv.slice(2)) {
  const [cmd, symArg] = argv;
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const reg = loadWatches();
  const sym = symArg ? symArg.toUpperCase() : null;
  if (cmd === "add") {
    if (!sym) throw new Error("add needs a ticker");
    const date = val("--date") || nyDate();
    const until = val("--until") || DEFAULT_UNTIL;
    if (!/^\d{2}:\d{2}$/.test(until)) throw new Error("--until is HH:MM, Central time");
    const why = val("--why") || "";
    // Who asked for it decides the v36 exception (server/pumpWatch.js overrideEligible). "adam" only when Adam named
    // the ticker himself; the 5:40a routine passes "routine"; anything else is "desk" and gets plain v33.
    const by = (val("--by") || "desk").toLowerCase();
    if (!WATCH_BY.includes(by)) throw new Error(`--by is one of ${WATCH_BY.join(" | ")}`);
    reg.watches = reg.watches.filter((w) => !(w.ticker === sym && w.date === date));
    reg.watches.push({ ticker: sym, date, until, why, added_by: by, added_at: new Date().toISOString(), calls: [], ended: false });
    saveWatches(reg);
    console.log(`PUMP WATCH ${sym} ${date} until ${until} CT, added by ${by}${why ? ` - ${why}` : ""}. The 5-minute tick reads it from 08:00 CT: a pre-market card before the open, FLUSH / FADE from 08:35, the opening-range read from 09:00.`);
    console.log(`Now run the hunters on it: node scripts/hunt-short.mjs --symbols ${sym} --write  and  node scripts/options-hunter.mjs --hunt --symbols ${sym} --account <N> --write`);
    return 0;
  }
  if (cmd === "remove") {
    const n = reg.watches.length;
    reg.watches = reg.watches.filter((w) => !(w.ticker === sym && w.date === (val("--date") || nyDate())));
    saveWatches(reg);
    console.log(n === reg.watches.length ? `no watch on ${sym} today` : `removed ${sym}`);
    return 0;
  }
  if (cmd === "read") {
    if (!sym) throw new Error("read needs a ticker");
    console.log(JSON.stringify(await readNow(sym), null, 2));
    return 0;
  }
  if (cmd === "list" || !cmd) {
    const today = nyDate();
    const todays = reg.watches.filter((w) => w.date >= today);
    if (!todays.length) console.log("no pump watches today or later");
    for (const w of todays) console.log(`${w.date} ${w.ticker} until ${w.until} CT${w.ended ? " (ended)" : ""} - calls: ${(w.calls || []).map((c) => `${c.read}@${c.at_ct}`).join(", ") || "none"} - ${w.why}`);
    return 0;
  }
  throw new Error(`unknown command ${cmd} (add | list | remove | read)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => process.exit(c ?? 0)).catch((e) => { console.error(e.message); process.exit(1); });
}
