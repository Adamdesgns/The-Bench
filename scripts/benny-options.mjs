// benny-options.mjs — BENNY'S OPTIONS LANE: defined-risk paper options in Benny's $10,000 book, priced at real fills.
//
//   node scripts/benny-options.mjs hunt-add --ranked db/hunts/options/<date>.ranked.json --quotes '<json>' --earnings '<json>' [--date D]
//        quotes = {"SYM":{"expiry":"2026-10-30","long":{"strike":170,"ask":4.10},"short":{"strike":165,"bid":2.36}}}
//        earnings = {"SYM":"2026-11-04" | "none"}   (a name with no entry is skipped: earnings not checked)
//        every READY row in top + rest -> lane options-hunter. The short strike may be narrower than the hunter's
//        (same expiry, same long strike, short strike between them) so a spread fits the cap; EV must stay positive.
//   node scripts/benny-options.mjs add --sym X --row B-### --structure call|put|call-spread|put-spread --expiry D \
//        --long-strike K --long-ask A [--short-strike K --short-bid B] --target T --exit-by D --earnings D|none \
//        [--p-dir 55 --p-reach 40] [--date D] [--note "..."]                          -> lane options-desk
//   node scripts/benny-options.mjs need [--json]        the contracts to quote tonight for open options trades
//   node scripts/benny-options.mjs score --quotes '{"PB-005":{"close":171.2,"long":{"bid":3.1,"ask":3.4},"short":{"bid":1.9,"ask":2.2}}}' \
//        [--spy 765.10] [--date D] [--write]             scores open options trades; writes the day's history row with SPY
//   node scripts/benny-options.mjs spy-start --close 763.30 --date 2026-10-16       one-time S&P baseline for VS S&P
//   every command: [--db db/benny-book.json] [--config db/benny-config.json]
//
// WHY (Adam, 2026-10-16): "options my boy"; Benny's book should beat the S&P at about 15% a year. Options magnify an
// edge and never create one (10/16: all three hunter spreads were negative EV, B-941..943), so:
//   - PAPER ONLY. Robinhood is the data source; no order tool is ever called. Adam's level-2 limit does not bind paper.
//   - FILLS: buy at the ask, sell at the bid. Value tonight = long bid - short ask, floored at 0, capped at the width.
//     The mid flatters narrow spreads about 2x (UNH 400/402.5 on 10/16: 1.275 at mid, 2.60 at the fill).
//   - SIZE: contracts = floor(equity x options_risk_pct% / (debit x 100)); open debits <= options_max_open_pct% of
//     equity; no new entries when equity is options_pause_drawdown_pct% under its peak. Research:
//     docs/research/2026-10-16-options-risk-sizing.md (2% / 6% / 15%). These are Adam's settings, never a routine's.
//   - NO ENTRY when earnings fall on or before expiry, when earnings were not checked, on a Friday, or when the ticker
//     already has an open options trade. The hunter lane only enters at positive EV at the fill.
//   - EXITS each night: on/after expiry = intrinsic at the close (EXPIRED); the close at/through the target = sell at
//     the bid (TARGET); the decide-by date = sell at the bid (EXIT-BY). No stock stop: the debit is the stop.
// Options never go in Adam's db/paper-book.json. Spec: docs/superpowers/specs/2026-10-16-benny-options-lane-design.md.
// Zero-dep. Tests: test/benny-options.test.mjs.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { summarize, nyDate } from "./paper-book.mjs";
import { addWeekdays } from "./predict.mjs";

const r2 = (x) => +x.toFixed(2);
export const DECIDE_SESSIONS = 5;
const STRUCTURES = { call: ["call", false], put: ["put", false], "call-spread": ["call", true], "put-spread": ["put", true] };

export const entryDebit = (q) => r2(q.long.ask - (q.short ? q.short.bid : 0));

export function exitValue(q, width) {
  if (typeof q?.long?.bid !== "number") return null;
  if (width != null && typeof q?.short?.ask !== "number") return null;
  const v = q.long.bid - (width != null ? q.short.ask : 0);
  return r2(Math.max(0, width != null ? Math.min(width, v) : v));
}

export function intrinsic(structure, longK, shortK, close) {
  const [type, spread] = STRUCTURES[structure];
  const leg = (k) => Math.max(0, type === "call" ? close - k : k - close);
  return r2(spread ? Math.min(Math.abs(longK - shortK), leg(longK) - leg(shortK)) : leg(longK));
}

export const evAtFill = ({ debit, width, pDir, pReach }) => r2(pReach * (width - debit) * 100 - (1 - pDir) * debit * 100);

const isFriday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay() === 5;
const openOptions = (book) => book.trades.filter((t) => t.kind === "option" && t.status === "OPEN");
export const optionsOpenRisk = (book) => r2(openOptions(book).reduce((a, t) => a + t.cost, 0));
const strikes = (t) => (t.short_strike == null ? `${t.long_strike}` : `${t.long_strike}/${t.short_strike}`);

// Check one paper options entry and build it. Returns { trade } or { refused: why }.
export function openOption(book, cfg, f) {
  const sym = String(f.sym).toUpperCase();
  if (!STRUCTURES[f.structure]) return { refused: `structure must be call, put, call-spread or put-spread (got ${f.structure})` };
  const [type, spread] = STRUCTURES[f.structure];
  if (isFriday(f.date)) return { refused: `${f.date} is a Friday; no Friday-close entries` };
  if (f.earnings == null || f.earnings === "") return { refused: "the earnings date was not checked (pass a date or none)" };
  if (f.earnings !== "none" && f.earnings <= f.expiry) return { refused: `earnings ${f.earnings} fall on or before the ${f.expiry} expiry` };
  if (spread && !(type === "call" ? f.shortStrike > f.longStrike : f.shortStrike < f.longStrike))
    return { refused: `the short strike ${f.shortStrike} is on the wrong side of the long ${f.longStrike} for a ${f.structure}` };
  const width = spread ? r2(Math.abs(f.longStrike - f.shortStrike)) : null;
  if (!(f.debit > 0)) return { refused: `the debit ${f.debit} must be above 0` };
  if (spread && f.debit >= width) return { refused: `at the fill it costs ${f.debit} on a ${width} width: it costs as much as it can ever pay` };
  const hasOdds = typeof f.pDir === "number" && typeof f.pReach === "number";
  if (f.requireEv && !hasOdds) return { refused: "no hunter odds (p_dir, p_reach) to test EV at the fill" };
  // A spread pays its width at the target; a single option pays its intrinsic value at the target.
  const payoff = spread ? width : f.target != null ? intrinsic(f.structure, f.longStrike, null, f.target) : null;
  if (hasOdds && payoff == null) return { refused: "a single option needs a --target to price EV at the fill" };
  const ev = hasOdds ? evAtFill({ debit: f.debit, width: payoff, pDir: f.pDir, pReach: f.pReach }) : null;
  if (hasOdds && ev <= 0) return { refused: `EV at the fill is ${ev} per contract (p_dir ${r2(f.pDir * 100)}%, p_reach ${r2(f.pReach * 100)}%, debit ${f.debit})` };
  const held = openOptions(book).find((t) => t.sym === sym);
  if (held) return { refused: `${sym} already has an open options trade (${held.id})` };
  const equity = summarize(book).equity;
  const peak = Math.max(book.account?.start_balance ?? 0, ...(book.history || []).map((h) => h.equity));
  if (equity <= peak * (1 - cfg.options_pause_drawdown_pct / 100))
    return { refused: `drawdown pause: equity ${equity} is ${cfg.options_pause_drawdown_pct}%+ under the ${peak} peak; new options entries wait for Adam` };
  const per = r2(f.debit * 100), cap = r2((equity * cfg.options_risk_pct) / 100);
  let contracts = Math.floor(cap / per);
  if (contracts < 1) return { refused: `one contract costs ${per} over the ${cfg.options_risk_pct}% cap ${cap} (equity ${equity})` };
  const room = r2((equity * cfg.options_max_open_pct) / 100 - optionsOpenRisk(book));
  contracts = Math.min(contracts, Math.floor(room / per));
  if (contracts < 1) return { refused: `the ${cfg.options_max_open_pct}% open-risk cap is full (${optionsOpenRisk(book)} open, ${room} room, one contract ${per})` };
  if (f.exitBy < f.date) return { refused: `the exit date ${f.exitBy} is before the entry date ${f.date}` };
  return { trade: {
    id: `PB-${String(book.trades.length + 1).padStart(3, "0")}`, kind: "option", sym, side: type === "call" ? "long" : "short",
    lane: f.lane, source_row: f.row, structure: f.structure, expiry: f.expiry, long_strike: f.longStrike, short_strike: spread ? f.shortStrike : null,
    width, contracts, entry_date: f.date, entry_debit: f.debit, cost: r2(per * contracts), target: f.target ?? null,
    exit_by: f.exitBy > f.expiry ? f.expiry : f.exitBy, earnings: f.earnings, p_dir: hasOdds ? f.pDir : null, p_reach: hasOdds ? f.pReach : null,
    ev_at_fill: ev, note: f.note ?? null,
    status: "OPEN", last_scored: null, last_value: null, last_close: null, realized: 0, r: null,
  } };
}

function close(out, value, why, date) {
  const realized = r2((value - out.entry_debit) * 100 * out.contracts);
  return Object.assign(out, { status: "CLOSED", exit_reason: why, exit_date: date, exit_value: value, last_value: value, realized, r: r2(realized / out.cost) });
}

// Advance one OPEN options trade by tonight's quotes {close, long:{bid,ask}, short?:{bid,ask}}. Returns the trade.
export function stepOption(t, q, date) {
  if (t.status !== "OPEN" || (t.last_scored && date <= t.last_scored) || date < t.entry_date || typeof q?.close !== "number") return t;
  if (date >= t.expiry) return close({ ...t, last_scored: date, last_close: q.close }, intrinsic(t.structure, t.long_strike, t.short_strike, q.close), "EXPIRED", date);
  const value = exitValue(q, t.width);
  if (value == null) return t;
  const out = { ...t, last_scored: date, last_close: q.close, last_value: value };
  if (date === t.entry_date) return out;
  const hit = t.target != null && (t.side === "long" ? q.close >= t.target : q.close <= t.target);
  if (hit) return close(out, value, "TARGET", date);
  if (date >= t.exit_by) return close(out, value, "EXIT-BY", date);
  return out;
}

const describe = (t) => `${t.id} ${t.sym} ${t.structure} ${strikes(t)} ${t.expiry} x${t.contracts} at ${t.entry_debit} (cost ${t.cost}${t.ev_at_fill != null ? `, EV ${t.ev_at_fill}/contract` : ""}), target ${t.target ?? "none"}, out by ${t.exit_by} [${t.source_row}, ${t.lane}]. Paper only.`;
const load = (p, fb) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fb);
const save = (p, d) => writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
const refuse = (m) => { console.log(`REFUSED - ${m}`); process.exit(1); };

function main() {
  const argv = process.argv.slice(2), cmd = argv[0];
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const num = (f) => (val(f) === undefined ? undefined : Number(val(f)));
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const DB = resolve(val("--db") || resolve(ROOT, "db/benny-book.json"));
  if (basename(DB) === "paper-book.json") refuse("options live in Benny's book, never in Adam's paper book (db/paper-book.json)");
  const cfg = load(resolve(val("--config") || resolve(ROOT, "db/benny-config.json")), null);
  if (!cfg) refuse("db/benny-config.json is missing");
  const book = load(DB, null);
  if (!book?.account) refuse("Benny's book is not open");
  book.skipped ||= []; book.history ||= [];
  const date = val("--date") || nyDate();
  const needCfg = () => { for (const k of ["options_risk_pct", "options_max_open_pct", "options_pause_drawdown_pct"]) if (!(cfg[k] > 0)) refuse(`${k} is not set in db/benny-config.json (Adam's setting)`); };
  const skip = (sym, lane, why) => book.skipped.push({ kind: "option", sym, date, lane, why });

  if (cmd === "spy-start") {
    if (book.account.spy_start) refuse(`the SPY baseline is already ${book.account.spy_start.close} on ${book.account.spy_start.date}`);
    if (!(num("--close") > 0)) refuse("pass --close (SPY's close on Benny's open day)");
    book.account.spy_start = { date: val("--date") || book.account.start_date, close: num("--close") };
    save(DB, book);
    console.log(`SPY BASELINE ${book.account.spy_start.close} on ${book.account.spy_start.date}`);
    return;
  }

  if (cmd === "hunt-add") {
    needCfg();
    if (!val("--ranked")) refuse("pass --ranked db/hunts/options/<date>.ranked.json");
    const rk = JSON.parse(readFileSync(resolve(val("--ranked")), "utf8"));
    const up = (f) => Object.fromEntries(Object.entries(JSON.parse(val(f) || "{}")).map(([k, v]) => [k.toUpperCase(), v]));
    const quotes = up("--quotes"), earnings = up("--earnings");
    const rows = [...(rk.top || []), ...(rk.rest || [])].filter((x) => x.list === "READY");
    const lines = [];
    for (const x of rows) {
      const sym = x.sym.toUpperCase(), q = quotes[sym], out = (why) => { skip(sym, "options-hunter", why); lines.push(`  SKIPPED  ${sym} - ${why}`); };
      if (!q?.long || !q?.short) { out("no bid/ask quotes passed for both legs"); continue; }
      if (q.expiry !== x.expiry) { out(`quote expiry ${q.expiry} is not the hunter's ${x.expiry}`); continue; }
      if (q.long.strike !== x.long_strike) { out(`long strike ${q.long.strike} is not the hunter's ${x.long_strike}`); continue; }
      const lo = Math.min(x.long_strike, x.short_strike), hi = Math.max(x.long_strike, x.short_strike);
      if (!(q.short.strike >= lo && q.short.strike <= hi) || q.short.strike === x.long_strike) { out(`short strike ${q.short.strike} is outside the hunter's ${x.long_strike}/${x.short_strike} spread`); continue; }
      const o = openOption(book, cfg, {
        sym, row: rk.candidates_receipt ? `hunt:${rk.candidates_receipt}` : `hunt:${rk.asof}`, lane: "options-hunter",
        structure: x.side === "long" ? "call-spread" : "put-spread", expiry: x.expiry, longStrike: q.long.strike, shortStrike: q.short.strike,
        debit: entryDebit(q), target: x.target, exitBy: addWeekdays(date, DECIDE_SESSIONS), earnings: earnings[sym], date,
        pDir: x.p_dir / 100, pReach: x.p_reach / 100, requireEv: true,
        note: `auto: hunter READY ${x.side}, grade ${x.grade ?? "-"} n=${x.n ?? "-"}; hunter spread ${x.long_strike}/${x.short_strike} at mark cost ${x.cost ?? "-"}`,
      });
      if (o.refused) { out(o.refused); continue; }
      book.trades.push(o.trade);
      lines.push(`  ADDED    ${describe(o.trade)}`);
    }
    save(DB, book);
    console.log(`BENNY OPTIONS HUNT-ADD ${date}: ${lines.filter((l) => l.startsWith("  ADDED")).length} added from ${rows.length} READY spread(s). Paper only.`);
    lines.forEach((l) => console.log(l));
    return;
  }

  if (cmd === "add") {
    needCfg();
    const miss = ["--sym", "--row", "--structure", "--expiry", "--long-strike", "--long-ask", "--exit-by", "--earnings"].filter((f) => val(f) === undefined);
    if (miss.length) refuse(`missing ${miss.join(", ")}`);
    const spread = STRUCTURES[val("--structure")]?.[1];
    if (spread && (num("--short-strike") === undefined || num("--short-bid") === undefined)) refuse("a spread needs --short-strike and --short-bid");
    const q = { long: { ask: num("--long-ask") }, short: spread ? { bid: num("--short-bid") } : undefined };
    const o = openOption(book, cfg, {
      sym: val("--sym"), row: val("--row"), lane: "options-desk", structure: val("--structure"), expiry: val("--expiry"),
      longStrike: num("--long-strike"), shortStrike: num("--short-strike") ?? null, debit: entryDebit(q), target: num("--target") ?? null,
      exitBy: val("--exit-by"), earnings: val("--earnings"), date, note: val("--note"),
      pDir: num("--p-dir") === undefined ? undefined : num("--p-dir") / 100, pReach: num("--p-reach") === undefined ? undefined : num("--p-reach") / 100,
    });
    if (o.refused) { skip(String(val("--sym")).toUpperCase(), "options-desk", o.refused); save(DB, book); refuse(o.refused); }
    book.trades.push(o.trade); save(DB, book);
    console.log(`  ADDED    ${describe(o.trade)}`);
    return;
  }

  if (cmd === "need") {
    const need = openOptions(book).map((t) => ({ id: t.id, sym: t.sym, expiry: t.expiry, type: STRUCTURES[t.structure][0], long_strike: t.long_strike, short_strike: t.short_strike }));
    if (has("--json")) { console.log(JSON.stringify(need)); return; }
    console.log(`BENNY OPTIONS: ${need.length} open trade(s) to quote (bid and ask on every leg, plus the stock's close)`);
    need.forEach((n) => console.log(`  ${n.id} ${n.sym} ${n.expiry} ${n.type} ${n.long_strike}${n.short_strike == null ? "" : ` / ${n.short_strike}`}`));
    return;
  }

  if (cmd === "score") {
    const quotes = JSON.parse(val("--quotes") || "{}");
    const lines = [];
    book.trades = book.trades.map((t) => {
      if (t.kind !== "option" || t.status !== "OPEN") return t;
      const n = stepOption(t, quotes[t.id], date);
      if (n === t) { lines.push(`  NO QUOTE ${t.id} ${t.sym} - pass the stock's close and bid/ask on every leg`); return t; }
      lines.push(n.status === "OPEN"
        ? `  OPEN     ${n.id} ${n.sym} value ${n.last_value} vs ${n.entry_debit} paid, open profit ${r2((n.last_value - n.entry_debit) * 100 * n.contracts)}`
        : `  ${n.exit_reason.padEnd(8)} ${n.id} ${n.sym} at ${n.exit_value}: ${n.realized} = ${n.r}R`);
      return n;
    });
    const s = summarize(book);
    const prior = book.history.find((h) => h.date === date);
    const spy = num("--spy") ?? prior?.spy;
    if (has("--write")) {
      if (date >= book.account.start_date)
        book.history = [...book.history.filter((h) => h.date !== date), { date, equity: s.equity, realized: s.realized, unrealized: s.unrealized, open: s.open, ...(spy ? { spy } : {}) }];
      save(DB, book);
    }
    console.log(`BENNY OPTIONS ${date}${has("--write") ? " (written)" : ""}: book equity ${s.equity}, options open risk ${optionsOpenRisk(book)}${spy ? `, SPY ${spy}` : ""}`);
    lines.forEach((l) => console.log(l));
    return;
  }

  console.log("usage: benny-options.mjs hunt-add|add|need|score|spy-start  (see header)");
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
