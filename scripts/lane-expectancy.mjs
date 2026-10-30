// lane-expectancy.mjs — expectancy per lane, in R, with the stop path checked on daily bars.
//
//   node scripts/lane-expectancy.mjs                      book lanes (Yahoo bars) + paper book
//   node scripts/lane-expectancy.mjs --bars-file f.json   offline: {SYM:[{date,open,high,low,close}], ...}
//   node scripts/lane-expectancy.mjs --json
//
// WHY THIS EXISTS (2026-10-29, docs/research/2026-10-29-lane-expectancy-stop-path.md)
// ----------------------------------------------------------------------------------
// Adam asked how to pick winners above 65%. The scorecard reports win rates only, and a win rate says
// nothing about whether a lane makes money. This prints, per lane: win rate, average win, average loss,
// and R per trade, twice: once with the stop honored on its first touch, once at the checkpoint price.
// The gap between the two columns is the cost or the benefit of the stop.
//
// THE RULES
//   - Conditional rows (long side, trigger above the stop): entry = the trigger, on the first session whose
//     high reaches it. Never reached = not a trade, skipped.
//   - Long rows: entry = the review price on the review date.
//   - Stop = the row's invalidation. From the entry session on, an open through the stop exits at the open,
//     a low at or under it exits at the stop. Otherwise the trade is valued at the latest checkpoint price.
//   - 1R = entry - stop. Rows without a numeric stop or checkpoint are counted and skipped, never guessed.
// Read-only. Zero-dep. Tests: test/lane-expectancy.test.mjs.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { yahooBars } from "./hunt-short.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const num = (v) => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? +v : null);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r2 = (x) => (x == null ? null : +x.toFixed(2));

export function latestCheckpoint(row) {
  const cps = row.checkpoints;
  if (!cps || typeof cps !== "object") return null;
  for (const h of ["3m", "1m", "1w"]) if (cps[h] && typeof cps[h].price === "number") return { h, ...cps[h] };
  return null;
}

// One trade's path. Pure. Returns null when the trade never happened (trigger never reached).
export function pathR({ entry, stop, from, to, exitPrice, needsTrigger }, bars) {
  const risk = entry - stop;
  if (!(risk > 0)) return null;
  const win = bars.filter((b) => b.date >= from && b.date <= to);
  let i0 = 0;
  if (needsTrigger) { i0 = win.findIndex((b) => b.high >= entry); if (i0 < 0) return null; }
  for (let i = i0; i < win.length; i++) {
    const b = win[i];
    if (i > i0 && b.open <= stop) return { r: (b.open - entry) / risk, stopped: true, gap: true, sessions: i - i0, raw: (exitPrice - entry) / risk };
    if (b.low <= stop) return { r: -1, stopped: true, gap: false, sessions: i - i0, raw: (exitPrice - entry) / risk };
  }
  return { r: (exitPrice - entry) / risk, stopped: false, gap: false, sessions: null, raw: (exitPrice - entry) / risk };
}

export function summarize(rs, key = "r") {
  const xs = rs.map((x) => x[key]);
  const wins = xs.filter((x) => x > 0), losses = xs.filter((x) => x < 0);
  return { n: xs.length, win_pct: xs.length ? r2((wins.length / xs.length) * 100) : null,
    avg_win: r2(mean(wins)), avg_loss: r2(mean(losses)), exp: r2(mean(xs)) };
}

// The book's long-side trades that can be path-scored.
export function bookTrades(rows) {
  const out = [];
  for (const row of rows) {
    const cp = latestCheckpoint(row), stop = num(row.invalidation);
    if (!cp || stop == null) continue;
    if (row.call_type === "conditional" && num(row.trigger) != null)
      out.push({ lane: "conditional", id: row.id, sym: row.ticker, entry: num(row.trigger), stop, from: row.date, to: cp.asof, exitPrice: cp.price, needsTrigger: true, h: cp.h });
    else if (row.call_type === "long" && num(row.review_price) != null)
      out.push({ lane: "long", id: row.id, sym: row.ticker, entry: num(row.review_price), stop, from: row.date, to: cp.asof, exitPrice: cp.price, needsTrigger: false, h: cp.h });
  }
  return out.filter((t) => t.entry > t.stop);
}

async function main() {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const rows = JSON.parse(readFileSync(resolve(ROOT, "db/archive.json"), "utf8"));
  const paper = JSON.parse(readFileSync(resolve(ROOT, "db/paper-book.json"), "utf8"));
  const trades = bookTrades(rows);
  const given = val("--bars-file") ? JSON.parse(readFileSync(resolve(val("--bars-file")), "utf8")) : null;
  const cache = {}, noBars = new Set();
  const scored = [];
  for (const t of trades) {
    if (!(t.sym in cache)) {
      try { cache[t.sym] = given ? given[t.sym] ?? null : await yahooBars(t.sym, "1y"); } catch { cache[t.sym] = null; }
    }
    if (!Array.isArray(cache[t.sym])) { noBars.add(t.sym); continue; }
    const p = pathR(t, cache[t.sym]);
    if (p) scored.push({ ...t, ...p });
  }
  const lanes = {};
  for (const lane of ["conditional", "long"]) {
    const rs = scored.filter((x) => x.lane === lane);
    lanes[lane] = { stop_honored: summarize(rs, "r"), no_stop: summarize(rs, "raw"),
      stopped: rs.filter((x) => x.stopped).length, recovered_after_stop: rs.filter((x) => x.stopped && x.raw > 0).length,
      median_sessions_to_stop: (() => { const s = rs.filter((x) => x.stopped).map((x) => x.sessions).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; })() };
  }
  const closed = (paper.trades || []).filter((t) => t.status === "CLOSED" && typeof t.r === "number");
  const paperLanes = {};
  for (const lane of [...new Set(closed.map((t) => t.lane))]) paperLanes[lane] = summarize(closed.filter((t) => t.lane === lane));
  paperLanes.all = summarize(closed);

  if (argv.includes("--json")) { console.log(JSON.stringify({ lanes, paper: paperLanes, no_bars: [...noBars] }, null, 2)); return; }
  const fmt = (s) => `n=${String(s.n).padStart(4)}  win ${s.win_pct ?? "-"}%  avg win ${s.avg_win ?? "-"}R  avg loss ${s.avg_loss ?? "-"}R  exp ${s.exp ?? "-"}R/trade`;
  console.log("LANE EXPECTANCY - R per trade. Stop honored = first touch exits; no stop = valued at the checkpoint.");
  for (const [lane, s] of Object.entries(lanes)) {
    console.log(`\n  ${lane}`);
    console.log(`    stop honored  ${fmt(s.stop_honored)}`);
    console.log(`    no stop       ${fmt(s.no_stop)}`);
    console.log(`    stopped ${s.stopped} (median ${s.median_sessions_to_stop ?? "-"} sessions in), ${s.recovered_after_stop} of them later finished in profit`);
  }
  console.log("\n  paper book, closed (stops and targets honored by paper-book.mjs)");
  for (const [lane, s] of Object.entries(paperLanes)) console.log(`    ${lane.padEnd(16)} ${fmt(s)}`);
  if (noBars.size) console.log(`\n  no bars: ${[...noBars].join(", ")}`);
  console.log("\n  A win rate alone never says whether a lane makes money. Read the exp column.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`lane-expectancy: ${e.message}`); process.exit(1); });
