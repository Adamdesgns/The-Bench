// bull-watch.mjs — which sectors are the bull markets, and which one just rotated in.
//
//   node scripts/bull-watch.mjs                       read-only report, live Yahoo daily bars
//   node scripts/bull-watch.mjs --write               also persist state + log transitions (db/bull-watch.json)
//   node scripts/bull-watch.mjs --closes '{"SMH":607.46,"XLE":61.78}' --date 2026-09-22 --write
//        official closes (from the Robinhood MCP) appended when Yahoo has not posted that session yet
//   node scripts/bull-watch.mjs --symbols SMH,XLE --json
//   node scripts/bull-watch.mjs --bars-file f.json    offline: {SYM:[{date,close,high?}]} (>= 274 bars each)
//   add --db f.json for an offline state file
//
// WHY THIS EXISTS (2026-09-23, Adam: "Bull market watch needs to be setup so we catch a bull
// market forming")
// ----------------------------------------------------------------------------------------------
// The desk judged names one at a time and missed the theme: the 27 names Adam brought in September
// averaged +6.4%, the same as the chip index, and the desk captured none of it. v32 made the AI
// trend a measured switch (SMH vs its 200-day, 3% either side). This generalizes it to every
// sector ETF and adds the thing that actually tested well: RELATIVE LEADERSHIP, so a sector rotating into the lead
// (power, energy, biotech, anything) is flagged when it arrives.
//
// WHAT IT WATCHES - TWO THINGS, BOTH TESTED (docs/research/2026-09-23-bull-market-trading.md):
//   1. LEADERSHIP RANK - sector ETFs ranked by 12-1 momentum (the 12-month return, skipping the
//      most recent month; industry momentum, Moskowitz & Grinblatt). Top 3 = LEADER, 4-6 = CONTENDER.
//      A sector ENTERING the top 3 is the rotation alert - a new sector bull market. Tested 10 years,
//      19 sector ETFs, top 3 held monthly: 23.3%/yr vs SPY 12.9%, beat SPY 57% of months, worst drop
//      -16% vs -23% (one of 8 variants tried; it is also the textbook definition, not a tuned one).
//   2. THE 200-DAY SWITCH - BULL when close > 200-day x 1.03, stays BULL until close < 200-day x 0.97
//      (v32's SMH switch, per sector). This is CONTEXT, not a signal: tested alone across 21 ETFs it
//      did not beat SPY afterward (493 events, fwd-60 beat SPY 47% vs a 48% baseline).
//   REJECTED, with the numbers, so nobody rebuilds it: a 'FORMING' flag on 3-of-5 early signs (above
//   the 50/200-day, rising 50-day, RS turning up, near the high) fired 581 times in 10 years and the
//   flagged sectors UNDERPERFORMED SPY over the next 60 sessions (-0.89 avg, 43% beat). 5-of-5, held-10-day,
//   golden-cross and RS-turn versions were no better. Single 'bull market forming' events do not work
//   on sectors; relative LEADERSHIP does.
// Zero-dep.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");

export const DEFAULT_SYMBOLS = [
  "SMH", "IGV", "XLK", "XLE", "XLU", "GRID", "XLI", "XLF", "KRE", "XLV", "XBI",
  "XLY", "XLP", "XLB", "XLRE", "ITA", "URA", "GDX", "IWM", "QQQ", "IBIT",
];
export const LABELS = {
  SMH: "chips", IGV: "software", XLK: "tech", XLE: "energy", XLU: "utilities", GRID: "grid/power equipment",
  XLI: "industrials", XLF: "financials", KRE: "regional banks", XLV: "health care", XBI: "biotech",
  XLY: "consumer discretionary", XLP: "consumer staples", XLB: "materials", XLRE: "real estate",
  ITA: "defense", URA: "uranium", GDX: "gold miners", IWM: "small caps", QQQ: "Nasdaq 100", IBIT: "bitcoin",
};

const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
const smaAt = (c, i, n) => (i + 1 >= n && i >= 0 ? mean(c.slice(i - n + 1, i + 1)) : null);

// 12-1 momentum at bar i: return from i-252 to i-21 (the last month is skipped - it tends to reverse).
export function mom121(c, i) {
  return i >= 252 ? (c[i - 21] / c[i - 252] - 1) * 100 : null;
}

// What the watch needs from one ETF, measured on its last completed bar.
export function measure(bars) {
  const c = bars.map((b) => b.close);
  const i = c.length - 1;
  if (i < 273) return null;
  const s200 = smaAt(c, i, 200), s50 = smaAt(c, i, 50);
  const hi52 = Math.max(...bars.slice(-252).map((b) => b.high ?? b.close));
  return {
    date: bars[i].date, close: c[i], s200, s50,
    pct200: (c[i] / s200 - 1) * 100, pct50: (c[i] / s50 - 1) * 100, offHigh: (c[i] / hi52 - 1) * 100,
    m121: mom121(c, i), m121MonthAgo: mom121(c, i - 21),
    m1: (c[i] / c[i - 21] - 1) * 100, m12: (c[i] / c[i - 252] - 1) * 100,
  };
}

// The 200-day switch, with memory: +3% to switch on, -3% to switch off.
export function nextSwitch(prev, m) {
  if (!m) return prev ?? "OFF";
  if (prev === "BULL") return m.close < m.s200 * 0.97 ? "OFF" : "BULL";
  return m.close > m.s200 * 1.03 ? "BULL" : "OFF";
}

export const tierOf = (rank) => (rank <= 3 ? "LEADER" : rank <= 6 ? "CONTENDER" : "-");

// Rank measurements by 12-1 momentum (highest first) -> [{sym, rank, tier, rankMonthAgo}].
export function rankAll(ms) {
  const ok = Object.entries(ms).filter(([, m]) => m && m.m121 != null);
  const now = [...ok].sort((a, b) => b[1].m121 - a[1].m121).map(([s]) => s);
  const ago = [...ok].filter(([, m]) => m.m121MonthAgo != null).sort((a, b) => b[1].m121MonthAgo - a[1].m121MonthAgo).map(([s]) => s);
  return now.map((s, k) => ({ sym: s, rank: k + 1, tier: tierOf(k + 1), rankMonthAgo: ago.indexOf(s) + 1 || null }));
}

function nyDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function yahooBars(sym) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`yahoo ${sym}: ${r.status}`);
  const res = (await r.json()).chart.result[0], q = res.indicators.quote[0];
  // Yahoo posts the newest session with close=null for hours after the bell; a null bar is DROPPED,
  // never guessed - the caller supplies the official close with --closes when it matters.
  // During the session the newest bar is a live PARTIAL day - also dropped until 16:30 ET.
  const today = nyDate();
  const hhmm = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(":", ""));
  const afterClose = hhmm >= 1630;
  return res.timestamp.map((t, k) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: q.close[k], high: q.high[k] }))
    .filter((b) => b.close != null && (b.date < today || afterClose));
}

// Append (or replace) an official close for `date`; drop anything after it (a live partial bar).
export function withClose(bars, date, close) {
  const kept = bars.filter((b) => b.date < date);
  return [...kept, { date, close, high: close }];
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const DB = resolve(val("--db") || resolve(ROOT, "db/bull-watch.json"));
  const syms = (val("--symbols") ? val("--symbols").split(",") : DEFAULT_SYMBOLS).map((s) => s.trim().toUpperCase());
  const closes = val("--closes") ? JSON.parse(val("--closes")) : {};
  const date = val("--date") || nyDate();

  let series = {};
  if (val("--bars-file")) series = JSON.parse(readFileSync(resolve(val("--bars-file")), "utf8"));
  else await Promise.all(syms.map(async (s) => { try { series[s] = await yahooBars(s); } catch (e) { series[s] = { error: e.message }; } }));
  for (const [s, c] of Object.entries(closes)) { const k = s.toUpperCase(); if (Array.isArray(series[k])) series[k] = withClose(series[k], date, Number(c)); }

  const ms = {};
  for (const s of syms) ms[s] = Array.isArray(series[s]) ? measure(series[s]) : null;
  // Rank sector/theme ETFs only, not the broad benchmarks.
  const ranked = rankAll(Object.fromEntries(Object.entries(ms).filter(([s]) => !["QQQ", "IBIT", "SPY"].includes(s))));
  const byRank = Object.fromEntries(ranked.map((r) => [r.sym, r]));

  const db = existsSync(DB) ? JSON.parse(readFileSync(DB, "utf8")) : { states: {}, log: [] };
  const rows = [], transitions = [];
  for (const s of syms) {
    const m = ms[s];
    if (!m) { rows.push({ sym: s, error: series[s]?.error || "not enough history" }); continue; }
    const prev = db.states[s] || {};
    const sw = nextSwitch(prev.switch, m);
    const r = byRank[s] || { rank: null, tier: "-" };
    rows.push({ sym: s, label: LABELS[s] || "", switch: sw, ...r, ...m });
    if (prev.tier && prev.tier !== r.tier && (prev.tier === "LEADER" || r.tier === "LEADER")) transitions.push({ date: m.date, sym: s, kind: "leadership", from: prev.tier, to: r.tier, rank: r.rank });
    if (prev.switch && prev.switch !== sw) transitions.push({ date: m.date, sym: s, kind: "200-day switch", from: prev.switch, to: sw, pct200: m.pct200 });
    db.states[s] = { switch: sw, tier: r.tier, rank: r.rank, asof: m.date };
  }
  if (has("--write")) { db.log = [...(db.log || []), ...transitions]; db.asof = date; writeFileSync(DB, JSON.stringify(db, null, 2) + "\n"); }
  if (has("--json")) { console.log(JSON.stringify({ date, rows, transitions }, null, 2)); return; }

  rows.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const f = (x, d = 1) => (x == null ? "  n/a" : (x >= 0 ? "+" : "") + x.toFixed(d));
  console.log(`BULL WATCH ${date}${has("--write") ? " (written)" : ""} - sector leadership by 12-1 momentum (12 months, skipping the last month)`);
  for (const r of rows) {
    if (r.error) { console.log(`  ${r.sym.padEnd(5)} ERROR ${r.error}`); continue; }
    const mv = r.rank && r.rankMonthAgo ? (r.rankMonthAgo > r.rank ? `up from #${r.rankMonthAgo}` : r.rankMonthAgo < r.rank ? `down from #${r.rankMonthAgo}` : "unchanged") : "";
    console.log(`  ${r.rank ? ("#" + r.rank).padStart(3) : "  -"} ${r.tier.padEnd(9)} ${r.sym.padEnd(5)} ${r.label.padEnd(22)} 12-1 ${f(r.m121).padStart(6)}%  12m ${f(r.m12).padStart(6)}%  1m ${f(r.m1).padStart(5)}%  | 200-day ${f(r.pct200)}% [${r.switch}]  off-high ${f(r.offHigh)}%  ${mv}  (${r.date})`);
  }
  if (transitions.length) console.log("TRANSITIONS: " + transitions.map((t) => `${t.sym} ${t.kind} ${t.from}->${t.to}`).join(", "));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
