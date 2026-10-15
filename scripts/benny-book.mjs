// benny-book.mjs — BENNY'S PAPER ACCOUNT: the public $10,000 book that mirrors Adam's paper book.
//
//   node scripts/benny-book.mjs open --risk-pct 1.5 [--date D]   ADAM ONLY, in a chat, in his own words.
//   node scripts/benny-book.mjs mirror [--date D]                 routines, right after they add to Adam's book
//   node scripts/benny-book.mjs status
//   Scoring: node scripts/paper-book.mjs score --bars '<json>' --date D --write --db db/benny-book.json
//
// Adam, 2026-10-15: "We are not decided exactly the trading %s we will start with a 10k bag but we're
// still deciding." So risk_pct in db/benny-config.json starts null, and while it is null this book
// sizes and takes nothing: mirror returns today's plans so #paper-trades can post them unsized.
// `open` writes risk_pct and opens the book at start_balance on the same day (the same account object
// `paper-book.mjs init` writes). No routine and no Benny answer may run `open` or change risk_pct.
// mirror: every trade in db/paper-book.json that entered on or after Benny's open date and that Benny
// has not seen is added with the same entry, stop, targets, exit date, side and lane, sized
// floor(equity x risk_pct% / |entry - stop|). Under one share = skipped and recorded. A trade Adam's
// book already scored is skipped too: Benny's copy would miss those days. Skips are never retried.
// Same scoring rules as Adam's book, because it IS paper-book.mjs with --db db/benny-book.json.
// Spec: docs/superpowers/specs/2026-10-15-benny-discord-bot-design.md. Zero-dep. Tests: test/benny-book.test.mjs.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openTrade, summarize, nyDate } from "./paper-book.mjs";

const r2 = (x) => +x.toFixed(2);

export const sizeShares = (equity, riskPct, entry, stop) => Math.floor((equity * riskPct) / 100 / Math.abs(entry - stop));

export function mirror(adam, benny, cfg, date) {
  if (cfg.risk_pct == null) return { waiting: adam.trades.filter((t) => t.entry_date === date), added: [], skipped: [] };
  if (!benny.account) return { waiting: [], added: [], skipped: [], refused: "risk_pct is set but Benny's book was never opened (run open)" };
  benny.skipped ||= [];
  const seen = new Set([...benny.trades.map((t) => t.mirror_of), ...benny.skipped.map((s) => s.mirror_of)]);
  const equity = summarize(benny).equity;
  const added = [], skipped = [];
  const skip = (t, why) => { const s = { mirror_of: t.id, sym: t.sym, date, why }; benny.skipped.push(s); skipped.push(s); };
  for (const t of adam.trades) {
    if (seen.has(t.id) || t.entry_date < benny.account.start_date) continue;
    if (t.last_scored != null) { skip(t, `already scored in the source book on ${t.last_scored}; a copy now would miss those days`); continue; }
    const shares = sizeShares(equity, cfg.risk_pct, t.entry, t.stop);
    if (shares < 1) { skip(t, `under one share: ${cfg.risk_pct}% of ${equity} is ${r2((equity * cfg.risk_pct) / 100)} of risk against a ${r2(Math.abs(t.entry - t.stop))} stop`); continue; }
    const o = openTrade(benny, {
      sym: t.sym, row: t.source_row, side: t.side, lane: t.lane, entryDate: t.entry_date, entry: t.entry, shares, stop: t.stop,
      t1: t.t1, t2: t.t2, stopAfterT1: t.stop_after_t1, exitBy: t.exit_by, readiness: t.readiness, grade: t.grade, note: `mirror of ${t.id}`,
    });
    if (o.refused) { skip(t, o.refused); continue; }
    const trade = { ...o.trade, mirror_of: t.id };
    benny.trades.push(trade);
    added.push(trade);
  }
  return { waiting: [], added, skipped };
}

const load = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const save = (p, d) => writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
const refuse = (m) => { console.log(`REFUSED - ${m}`); process.exit(1); };

function main() {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const ROOT = resolve(val("--root") || resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const CFG = join(ROOT, "db/benny-config.json"), BOOK = join(ROOT, "db/benny-book.json"), ADAM = join(ROOT, "db/paper-book.json");
  const cfg = load(CFG, null);
  if (!cfg) refuse("db/benny-config.json is missing");
  const date = val("--date") || nyDate();

  if (argv[0] === "open") {
    if (cfg.risk_pct != null) refuse(`risk_pct is already ${cfg.risk_pct}; changing it is a new decision for Adam, not a re-run`);
    const pct = Number(val("--risk-pct"));
    if (!(pct > 0 && pct <= 10)) refuse("--risk-pct must be above 0 and at most 10 (percent of Benny's equity risked per trade)");
    if (load(BOOK, {}).account) refuse("db/benny-book.json is already open");
    save(CFG, { ...cfg, risk_pct: pct, opened: date });
    save(BOOK, { account: { start_date: date, start_balance: cfg.start_balance }, trades: [], history: [], skipped: [] });
    console.log(`BENNY BOOK OPENED ${date} with ${cfg.start_balance}, risking ${pct}% of equity per trade. Paper only.`);
    return;
  }

  if (argv[0] === "mirror") {
    const benny = load(BOOK, { account: null, trades: [], history: [], skipped: [] });
    const r = mirror(load(ADAM, { trades: [] }), benny, cfg, date);
    if (r.refused) refuse(r.refused);
    if (cfg.risk_pct == null) {
      console.log(`BENNY BOOK WAITING - risk_pct is not set. ${r.waiting.length} plan(s) from ${date} post with "sizing starts when the risk setting is chosen":`);
      r.waiting.forEach((t) => console.log(`  PLAN     ${t.side.toUpperCase()} ${t.sym} entry ${t.entry}, stop ${t.stop}, targets ${t.t1 ?? "none"}/${t.t2 ?? "none"}, out by ${t.exit_by} [${t.source_row}, ${t.lane}]`));
      return;
    }
    if (r.added.length || r.skipped.length) save(BOOK, benny);
    console.log(`BENNY BOOK MIRROR ${date}: ${r.added.length} added, ${r.skipped.length} skipped. Paper only.`);
    r.added.forEach((t) => console.log(`  ADDED    ${t.id} ${t.side.toUpperCase()} ${t.shares} ${t.sym} at ${t.entry}, stop ${t.stop}, targets ${t.t1 ?? "none"}/${t.t2 ?? "none"}, out by ${t.exit_by} [${t.source_row}, ${t.lane}]`));
    r.skipped.forEach((s) => console.log(`  SKIPPED  ${s.sym} (${s.mirror_of}) - ${s.why}`));
    return;
  }

  if (argv[0] === "status") {
    const benny = load(BOOK, null);
    if (cfg.risk_pct == null || !benny?.account) { console.log("BENNY BOOK WAITING - risk_pct is not set; nothing is sized or taken."); return; }
    const s = summarize(benny);
    console.log(`BENNY BOOK OPEN since ${benny.account.start_date}: equity ${s.equity} (start ${s.start_balance}), risk ${cfg.risk_pct}% per trade, ${s.open} open, ${s.closed} closed`);
    return;
  }

  console.log("usage: benny-book.mjs open|mirror|status  (see header)");
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
