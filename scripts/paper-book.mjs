// paper-book.mjs — THE PAPER ACCOUNT: every ticket the desk writes, bought on paper whether or not
// the real account can fund it, and scored every day like real money.
//
//   node scripts/paper-book.mjs init --balance 3575.98 [--date 2026-10-14]
//   node scripts/paper-book.mjs add --sym MU --row B-876 --entry 938.50 --shares 6 --stop 884 \
//        --t1 1029 --t2 1054.17 --exit-by 2026-10-20 [--side long|short] [--lane entry-check] \
//        [--date D] [--stop-after-t1 X] [--readiness N] [--grade B-] [--note "..."]
//   node scripts/paper-book.mjs score --bars '{"MU":{"open":..,"high":..,"low":..,"close":..}}' [--date D] [--write]
//   node scripts/paper-book.mjs close --id PB-001 --price P [--date D] [--why MANUAL]
//   node scripts/paper-book.mjs report [--json]
//   add --db f.json to any command for an offline test file
//
// WHY THIS EXISTS (Adam, 2026-10-14)
// ----------------------------------
// "Make our call whether we can buy them or not. We're all in on GOOGL rn anyway." Then: "This is
// the best way to improve calls. Make them, adjust based on data and results."
// The 9:00 entry check kept writing BUY tickets the account could not fund (NVDA B-745 on 10/06,
// MU B-876 on 10/14), and an unfunded ticket left nothing behind but a hit/miss note. The book could
// say whether a call was right; it could not say what the calls make in dollars. This account takes
// every ticket at the exact size printed on it (shares from the 10% band, same entry, same stop),
// so the desk's record is measured in money, by lane, and the rules can be changed on results.
//
// THE RULES (same as real money, scored conservatively):
//   - The stop-loss rests from the minute of entry. A day that touches both the stop and a target
//     scores as the stop. A day that OPENS through the stop exits at the open (a gap is not the stop
//     price). On the entry day the open is ignored (the buy came after it) but the low still counts.
//   - The first target sells half, rounded up (one share = all of it). No second target = the first
//     target sells everything. --stop-after-t1 raises the stop from the next day.
//   - Every trade has an exit date; on that date whatever is left sells at the close. No exit date,
//     no trade: a paper position that can never end can never be scored.
//   - No cash check. A ticket the real account cannot fund is still bought here. That is the point.
// Zero-dep. Writes only db/paper-book.json. Tests: test/paper-book.test.mjs.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const r2 = (x) => +x.toFixed(2);

export function nyDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const dirOf = (t) => (t.side === "short" ? -1 : 1);
const riskOf = (t) => Math.abs(t.entry - t.stop) * t.shares;

function sell(out, shares, price, why, date) {
  out.legs = [...out.legs, { date, shares, price, why }];
  out.realized = r2(out.realized + dirOf(out) * (price - out.entry) * shares);
  out.shares_open -= shares;
}

function finish(out, why, date) {
  return Object.assign(out, { status: "CLOSED", exit_reason: why, exit_date: date, r: r2(out.realized / riskOf(out)) });
}

// Advance one OPEN paper trade by one daily bar {open, high, low, close}. Returns the updated trade.
export function step(t, bar, date) {
  if (t.status !== "OPEN" || (t.last_scored && date <= t.last_scored) || date < t.entry_date) return t;
  const out = { ...t, last_scored: date, last_close: bar.close };
  const d = dirOf(t);
  const firstDay = date === t.entry_date;
  const stop = t.t1_done && t.stop_after_t1 != null ? t.stop_after_t1 : t.stop;
  const through = (price, level) => (d > 0 ? price <= level : price >= level); // adverse side of a level
  const reached = (level) => (d > 0 ? bar.high >= level : bar.low <= level);  // favourable side

  if (!firstDay && typeof bar.open === "number" && through(bar.open, stop)) {
    sell(out, out.shares_open, bar.open, "STOP-GAP", date);
    return finish(out, "STOPPED", date);
  }
  if (through(d > 0 ? bar.low : bar.high, stop)) {
    sell(out, out.shares_open, stop, "STOP", date);
    return finish(out, "STOPPED", date);
  }
  if (t.t1 != null && !out.t1_done && reached(t.t1)) {
    const n = t.t2 == null ? out.shares_open : Math.min(out.shares_open, Math.ceil(t.shares / 2));
    sell(out, n, t.t1, "T1", date);
    out.t1_done = true;
  }
  if (t.t2 != null && out.shares_open > 0 && reached(t.t2)) sell(out, out.shares_open, t.t2, "T2", date);
  if (out.shares_open === 0) return finish(out, "TARGET", date);
  if (t.exit_by && date >= t.exit_by) {
    sell(out, out.shares_open, bar.close, "EXIT-BY", date);
    return finish(out, "EXIT-BY", date);
  }
  return out;
}

export function summarize(book) {
  const trades = book.trades || [];
  const start = book.account?.start_balance ?? 0;
  const closed = trades.filter((t) => t.status !== "OPEN");
  const open = trades.filter((t) => t.status === "OPEN");
  const realized = r2(trades.reduce((a, t) => a + (t.realized || 0), 0));
  const unrealized = r2(open.reduce((a, t) => a + (t.last_close == null ? 0 : dirOf(t) * (t.last_close - t.entry) * t.shares_open), 0));
  const wins = closed.filter((t) => t.realized > 0).length;
  const sumR = r2(closed.reduce((a, t) => a + t.r, 0));
  const by_lane = {};
  for (const t of trades) {
    const l = (by_lane[t.lane || "unlabelled"] ||= { closed: 0, open: 0, wins: 0, sum_r: 0, realized: 0 });
    if (t.status === "OPEN") l.open++; else { l.closed++; if (t.realized > 0) l.wins++; l.sum_r = r2(l.sum_r + t.r); }
    l.realized = r2(l.realized + (t.realized || 0));
  }
  return {
    start_balance: start, realized, unrealized, equity: r2(start + realized + unrealized),
    return_pct: start ? r2((realized + unrealized) / start * 100) : null,
    closed: closed.length, open: open.length, wins, losses: closed.length - wins,
    win_rate: closed.length ? Math.round(wins / closed.length * 100) : null,
    avg_r: closed.length ? r2(sumR / closed.length) : null, sum_r: sumR, by_lane,
  };
}

function load(p) { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { account: null, trades: [], history: [] }; }
function save(p, d) { writeFileSync(p, JSON.stringify(d, null, 2) + "\n"); }
const money = (x) => `${x < 0 ? "-" : "+"}${Math.abs(x).toFixed(2)}`;
const refuse = (msg) => { console.log(`REFUSED - ${msg}`); process.exit(1); };

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const num = (f) => (val(f) === undefined ? undefined : Number(val(f)));
  const DB = resolve(val("--db") || resolve(ROOT, "db/paper-book.json"));
  const book = load(DB);
  book.history ||= [];

  if (cmd === "init") {
    if (book.account) refuse(`the paper book already opened on ${book.account.start_date} with ${book.account.start_balance}`);
    if (!(num("--balance") > 0)) refuse("pass --balance (the starting paper balance)");
    book.account = { start_date: val("--date") || nyDate(), start_balance: num("--balance") };
    save(DB, book);
    console.log(`PAPER BOOK OPENED ${book.account.start_date} with ${book.account.start_balance}. No money at risk.`);
    return;
  }

  if (cmd === "add") {
    if (!book.account) refuse("no paper book yet - run init --balance N first");
    const need = ["--sym", "--row", "--entry", "--shares", "--stop", "--exit-by"];
    const miss = need.filter((f) => val(f) === undefined);
    if (miss.length) refuse(`missing ${miss.join(", ")} (a paper trade with no exit date can never be scored)`);
    const side = val("--side") || "long", d = side === "short" ? -1 : 1;
    const entry = num("--entry"), stop = num("--stop"), shares = num("--shares");
    const t1 = num("--t1") ?? null, t2 = num("--t2") ?? null;
    if (!Number.isInteger(shares) || shares <= 0) refuse(`--shares must be a whole number above 0 (got ${val("--shares")})`);
    if (!(d * (entry - stop) > 0)) refuse(`the stop ${stop} is on the wrong side of the ${side} entry ${entry}`);
    for (const x of [t1, t2]) if (x != null && !(d * (x - entry) > 0)) refuse(`the target ${x} is on the wrong side of the ${side} entry ${entry}`);
    const sym = val("--sym").toUpperCase(), row = val("--row");
    const entryDate = val("--date") || nyDate();
    if (val("--exit-by") < entryDate) refuse(`the exit date ${val("--exit-by")} is before the entry date ${entryDate}`);
    // One open paper position per name and side: a plan that re-fires under a new row must not double the position.
    const held = book.trades.find((t) => t.status === "OPEN" && t.sym === sym && t.side === side);
    if (held) refuse(`${sym} ${side} is already open in the paper book as ${held.id} (${held.source_row}); a re-fire does not add to it`);
    const t = {
      id: `PB-${String(book.trades.length + 1).padStart(3, "0")}`, sym, side, lane: val("--lane") || "entry-check", source_row: row,
      entry_date: entryDate, entry, shares, stop, t1, t2, stop_after_t1: num("--stop-after-t1") ?? null, exit_by: val("--exit-by"),
      readiness: num("--readiness") ?? null, grade: val("--grade") ?? null, note: val("--note") ?? null,
      status: "OPEN", shares_open: shares, t1_done: false, legs: [], realized: 0, r: null, last_scored: null, last_close: null,
    };
    book.trades.push(t); save(DB, book);
    console.log(`PAPER ${t.id} ${side.toUpperCase()} ${shares} ${sym} at ${entry}, stop ${stop} (risk ${riskOf(t).toFixed(2)}), targets ${t1 ?? "none"}/${t2 ?? "none"}, out by the ${t.exit_by} close [${row}, ${t.lane}]. No money at risk.`);
    return;
  }

  if (cmd === "score") {
    const raw = val("--bars") ?? (val("--bars-file") ? readFileSync(resolve(val("--bars-file")), "utf8") : null);
    if (!raw) refuse("pass --bars '{\"SYM\":{\"open\":..,\"high\":..,\"low\":..,\"close\":..}}' (today's daily bars)");
    const bars = Object.fromEntries(Object.entries(JSON.parse(raw)).map(([k, v]) => [k.toUpperCase(), v]));
    const date = val("--date") || nyDate();
    const lines = [];
    book.trades = book.trades.map((t) => {
      if (t.status !== "OPEN") return t;
      const b = bars[t.sym];
      if (!b) { lines.push(`  NO BAR   ${t.id} ${t.sym} - pass today's open/high/low/close`); return t; }
      const n = step(t, b, date);
      const newLegs = n.legs.slice(t.legs.length).map((l) => `${l.why} ${l.shares} at ${l.price}`).join(", ");
      lines.push(n.status === "OPEN"
        ? `  OPEN     ${n.id} ${n.sym} ${n.shares_open} sh, close ${b.close}, open profit ${money(dirOf(n) * (b.close - n.entry) * n.shares_open)}${newLegs ? ` (${newLegs})` : ""}`
        : `  ${n.exit_reason.padEnd(8)} ${n.id} ${n.sym} ${newLegs}: ${money(n.realized)} = ${n.r}R`);
      return n;
    });
    const s = summarize(book);
    const prior = book.history.filter((h) => h.date < date).at(-1);
    const today = r2(s.equity - (prior ? prior.equity : s.start_balance));
    if (has("--write")) {
      // A trade carried in from before the book opened still gets scored, but the balance history starts on the open date.
      if (!book.account || date >= book.account.start_date)
        book.history = [...book.history.filter((h) => h.date !== date), { date, equity: s.equity, realized: s.realized, unrealized: s.unrealized, open: s.open }];
      save(DB, book);
    }
    console.log(`PAPER BOOK ${date}${has("--write") ? " (written)" : ""}: equity ${s.equity} (start ${s.start_balance}, ${money(s.realized + s.unrealized)}), today ${money(today)}, ${s.open} open, ${s.closed} closed`);
    lines.forEach((l) => console.log(l));
    return;
  }

  if (cmd === "close") {
    const t = book.trades.find((x) => x.id === val("--id"));
    if (!t) refuse(`no paper trade ${val("--id")}`);
    if (t.status !== "OPEN") refuse(`${t.id} is already closed`);
    if (!(num("--price") > 0)) refuse("pass --price");
    const date = val("--date") || nyDate();
    const out = { ...t, last_scored: date, last_close: num("--price") };
    sell(out, out.shares_open, num("--price"), val("--why") || "MANUAL", date);
    finish(out, val("--why") || "MANUAL", date);
    book.trades = book.trades.map((x) => (x.id === t.id ? out : x));
    save(DB, book);
    console.log(`CLOSED ${out.id} ${out.sym} at ${num("--price")}: ${money(out.realized)} = ${out.r}R`);
    return;
  }

  if (cmd === "report") {
    const s = summarize(book);
    if (has("--json")) { console.log(JSON.stringify({ ...s, account: book.account, trades: book.trades, history: book.history }, null, 2)); return; }
    if (!book.account) { console.log("PAPER BOOK: not opened yet (run init --balance N)"); return; }
    console.log(`PAPER BOOK since ${book.account.start_date}: equity ${s.equity} (start ${s.start_balance}, ${money(s.realized + s.unrealized)}, ${s.return_pct}%)`);
    console.log(`  ${s.closed} closed (${s.wins} won, ${s.losses} lost${s.closed ? `, avg ${s.avg_r}R, total ${s.sum_r}R` : ""}), ${s.open} open; realized ${money(s.realized)}, open profit ${money(s.unrealized)}`);
    for (const t of book.trades.filter((x) => x.status === "OPEN"))
      console.log(`  OPEN ${t.id} ${t.sym.padEnd(5)} ${t.shares_open}/${t.shares} sh at ${t.entry}, stop ${t.t1_done && t.stop_after_t1 != null ? t.stop_after_t1 : t.stop}, last ${t.last_close ?? "unscored"}, out by ${t.exit_by} [${t.source_row}, ${t.lane}]`);
    for (const [lane, l] of Object.entries(s.by_lane))
      console.log(`  LANE ${lane}: ${l.closed} closed (${l.wins} won, total ${l.sum_r}R), ${l.open} open, realized ${money(l.realized)}`);
    return;
  }

  console.log("usage: paper-book.mjs init|add|score|close|report  (see header)");
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
