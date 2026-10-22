// paper-quant.mjs — THE QUANT-EXIT TWIN LANE: every paper trade gets a twin with the same entry, the same
// shares and the same starting stop. Only the exit differs. The twin has no fixed target: every close it
// re-runs the hunter's own measurements on that ticker and stays in while the trend that got it in is still
// there, behind a trailing stop that only ever tightens.
//
//   node scripts/paper-quant.mjs sync [--earnings '{"ASTS":"2026-11-09"}'] [--write]
//        a twin for every share trade in db/paper-book.json that has none yet (options are skipped)
//   node scripts/paper-quant.mjs score [--date D] [--write] [--bars-file f.json]
//        replays every OPEN twin from its entry through the last settled bar (Yahoo, or the file offline:
//        {SYM:[{date,open,high,low,close,volume}], SPY:[...]})
//   node scripts/paper-quant.mjs report [--json] [--brief]
//        each twin beside its paper trade (fixed R vs quant R), and the lane totals on closed pairs
//   add --paper f.json / --db f.json to any command for offline test files
//
// WHY THIS EXISTS (Adam, 2026-10-21)
// ----------------------------------
// "I don't think any trader on the planet would look at a short and see all signs point to it being a
// falling knife and say, maybe I should sell that. Add another lane. Re-run this is a quant system not an
// is my guess right system." The paper book exits at a target picked on day one and never asks again
// whether the setup is still working. This lane asks every close, with numbers, and the two records are
// compared side by side on the same entries. At 10 closed pairs the weekly read puts them in front of Adam.
//
// THE RULES (decided before any result was seen, scored like real money):
//   - Same entry date, price, shares and starting stop as the paper trade. Risk (1R) is measured off that
//     starting stop, so R is comparable between the two lanes.
//   - Stop first, every session: an open through the stop exits at the open; a touch exits at the stop.
//     On the entry day only the touch counts (the paper book's rule, so both lanes face the same day).
//   - THE SHAPE, re-run every close with hunt-short.mjs's own math (20-day and 50-day averages, 20-session
//     relative strength vs SPY):  short holds while close < 20-day AND close < 50-day AND it trails SPY;
//     long holds while close > 20-day AND close > 50-day AND it leads SPY. Once the shape has held, the
//     first close where it does not is the exit, at that close. A trade that never had the shape cannot
//     lose it; only the stop and the hard exit apply to it.
//   - THE TRAILING STOP, after every close: short = the higher of (close + 1.0 ATR) and the 2-session high,
//     long = the lower of (close - 1.0 ATR) and the 2-session low - the same stop the hunter puts on a
//     new entry. It only moves in the trade's favour and is never inside 1.0 ATR of the close.
//   - THE HARD EXIT (risk, not a guess): the later of the paper trade's own exit date and 20 sessions from
//     entry, cut to the session before earnings. A dated-catalyst trade keeps its exit date (out before the
//     event). No known earnings date: never longer than the paper trade, flagged EARNINGS UNKNOWN.
//   - Bars come from Yahoo (free); the paper book is scored on Robinhood bars. A cent of difference on a
//     touch is possible and is noted, not hidden.
// Zero-dep. Writes only db/paper-quant.json. Never touches db/paper-book.json. Tests: test/paper-quant.test.mjs.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sma, atr14, rsVs, yahooBars } from "./hunt-short.mjs";
import { addWeekdays } from "./predict.mjs";
import { nyDate } from "./paper-book.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const r2 = (x) => +x.toFixed(2);
const MIN_SESSIONS = 20;

const dirOf = (t) => (t.side === "short" ? -1 : 1);
const prevWeekday = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
};

// The hunter's measurements on the bars through one close. `holds` = the trend that got the trade in is still there.
export function shapeOf(bars, spy, side) {
  const closes = bars.map((b) => b.close), close = closes.at(-1);
  const sma20 = sma(closes, 20), sma50 = sma(closes, 50), rs20 = rsVs(bars, spy, 20);
  if (sma20 == null || sma50 == null || rs20 == null) return { close, holds: null, why: "not enough bars" };
  const legs = side === "short"
    ? [[close < sma20, `closed over the 20-day ${r2(sma20)}`], [close < sma50, `closed over the 50-day ${r2(sma50)}`], [rs20 < 0, `stopped trailing SPY (rs20 ${r2(rs20)})`]]
    : [[close > sma20, `closed under the 20-day ${r2(sma20)}`], [close > sma50, `closed under the 50-day ${r2(sma50)}`], [rs20 > 0, `stopped leading SPY (rs20 ${r2(rs20)})`]];
  const failed = legs.filter(([ok]) => !ok).map(([, why]) => why);
  return { close, sma20: r2(sma20), sma50: r2(sma50), rs20: r2(rs20), holds: failed.length === 0, why: failed.join("; ") };
}

// Build the twin of one paper trade. `earnings` = the next report date (YYYY-MM-DD) or null if unknown.
export function makeTwin(pb, { earnings = null } = {}) {
  const span = addWeekdays(pb.entry_date, MIN_SESSIONS);
  let hard = pb.exit_by > span ? pb.exit_by : span, why = pb.exit_by > span ? "the paper trade's exit date" : `${MIN_SESSIONS} sessions`;
  if (pb.lane === "dated-catalyst") { hard = pb.exit_by; why = "the dated-catalyst event (out before it)"; }
  if (earnings && earnings > pb.entry_date) {
    const pre = prevWeekday(earnings);
    if (pre < hard) { hard = pre; why = `the session before earnings ${earnings}`; }
  } else if (!earnings && pb.lane !== "dated-catalyst") {
    hard = pb.exit_by; why = "EARNINGS UNKNOWN - capped at the paper trade's exit date";
  }
  return {
    id: pb.id.replace(/^PB-/, "PQ-"), of: pb.id, sym: pb.sym, side: pb.side, lane: "quant-exit", source_lane: pb.lane, source_row: pb.source_row,
    entry_date: pb.entry_date, entry: pb.entry, shares: pb.shares, stop0: pb.stop, earnings: earnings || null, hard_exit: hard, hard_exit_why: why,
    status: "OPEN",
  };
}

// Replay one twin from its entry through the last bar given. Pure: the same bars always give the same twin.
// `bars` and `spy` are full histories (at least 50 sessions before the entry for the averages).
export function replay(twin, bars, spy, { through = null } = {}) {
  const d = dirOf(twin);
  const t = { ...twin, status: "OPEN", stop: twin.stop0, best_close: twin.entry, shape_seen: false, shape: null,
    exit_date: null, exit_price: null, exit_reason: null, exit_why: null, realized: 0, r: null, giveback_r: null, last_scored: null, last_close: null };
  const risk = Math.abs(twin.entry - twin.stop0);
  const through_ = (price, level) => (d > 0 ? price <= level : price >= level);
  const close = (price, date, reason, why) => {
    Object.assign(t, { status: "CLOSED", exit_date: date, exit_price: r2(price), exit_reason: reason, exit_why: why,
      realized: r2(d * (price - t.entry) * t.shares), r: r2(d * (price - t.entry) / risk),
      giveback_r: r2(Math.max(0, d * (t.best_close - price)) / risk) });
    return t;
  };
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.date < twin.entry_date) continue;
    if (through && b.date > through) break;
    t.last_scored = b.date; t.last_close = r2(b.close);
    const firstDay = b.date === twin.entry_date;
    if (!firstDay && through_(b.open, t.stop)) return close(b.open, b.date, "STOP-GAP", `opened through the stop ${t.stop}`);
    if (through_(d > 0 ? b.low : b.high, t.stop)) return close(t.stop, b.date, "STOP", `touched the trailing stop ${t.stop}`);
    const hist = bars.slice(0, i + 1), spyHist = spy.filter((x) => x.date <= b.date);
    const s = shapeOf(hist, spyHist, twin.side);
    t.shape = s;
    if (s.holds) t.shape_seen = true;
    if (d * (b.close - t.best_close) > 0) t.best_close = r2(b.close);
    if (t.shape_seen && s.holds === false) return close(b.close, b.date, "SHAPE-BROKE", s.why);
    if (b.date >= twin.hard_exit) return close(b.close, b.date, "HARD-EXIT", twin.hard_exit_why);
    const atr = atr14(hist);
    if (atr != null && i >= 1) {
      const p = bars[i - 1];
      const cand = d > 0 ? Math.min(b.close - atr, b.low, p.low) : Math.max(b.close + atr, b.high, p.high);
      if (d * (cand - t.stop) > 0) t.stop = r2(cand);
    }
  }
  return t;
}

// Only bars whose session is over: a bar dated today before 16:10 ET is still moving.
function settledOnly(bars, now = new Date()) {
  const today = nyDate(now);
  const et = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const [h, m] = et.split(":").map(Number);
  return h * 60 + m >= 16 * 60 + 10 ? bars : bars.filter((b) => b.date < today);
}

function earningsFromBoard(sym, after) {
  try {
    const raw = JSON.parse(readFileSync(resolve(ROOT, "db/catalysts.json"), "utf8"));
    const cats = Array.isArray(raw) ? raw : raw.catalysts ?? [];
    return cats.filter((c) => c.type === "earnings" && c.ticker === sym && c.date > after).map((c) => c.date).sort()[0] ?? null;
  } catch { return null; }
}

const load = (p, empty) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : empty);
const save = (p, d) => writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
const money = (x) => `${x < 0 ? "-" : "+"}${Math.abs(x).toFixed(2)}`;
const rStr = (x) => (x == null ? "-" : `${x >= 0 ? "+" : ""}${x}R`);
const fixedR = (pb) => (pb.status !== "OPEN" ? pb.r
  : pb.last_close == null ? null : r2(((pb.realized || 0) + dirOf(pb) * (pb.last_close - pb.entry) * pb.shares_open) / (Math.abs(pb.entry - pb.stop) * pb.shares)));
const openR = (q) => (q.status !== "OPEN" ? q.r : q.last_close == null ? null : r2(dirOf(q) * (q.last_close - q.entry) / Math.abs(q.entry - q.stop0)));

export function compare(quant, paper) {
  const byId = Object.fromEntries((paper.trades || []).map((t) => [t.id, t]));
  const pairs = (quant.twins || []).map((q) => ({ q, pb: byId[q.of] }));
  const both = pairs.filter(({ q, pb }) => pb && q.status !== "OPEN" && pb.status !== "OPEN");
  const sum = (xs) => r2(xs.reduce((a, x) => a + x, 0));
  return {
    pairs, closed_pairs: both.length,
    fixed: { sum_r: sum(both.map((x) => x.pb.r)), wins: both.filter((x) => x.pb.realized > 0).length, usd: sum(both.map((x) => x.pb.realized)) },
    quant: { sum_r: sum(both.map((x) => x.q.r)), wins: both.filter((x) => x.q.realized > 0).length, usd: sum(both.map((x) => x.q.realized)),
      avg_giveback_r: both.length ? r2(both.reduce((a, x) => a + (x.q.giveback_r || 0), 0) / both.length) : null },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const PAPER = resolve(val("--paper") || resolve(ROOT, "db/paper-book.json"));
  const DB = resolve(val("--db") || resolve(ROOT, "db/paper-quant.json"));
  const paper = load(PAPER, { trades: [] });
  const quant = load(DB, { lane: "quant-exit", twins: [] });

  if (cmd === "sync") {
    let given = {};
    try { given = Object.fromEntries(Object.entries(JSON.parse(val("--earnings") || "{}")).map(([k, v]) => [k.toUpperCase(), v])); }
    catch { console.log('REFUSED - --earnings must be JSON like \'{"ASTS":"2026-11-09"}\''); process.exit(1); }
    const have = new Set(quant.twins.map((q) => q.of));
    const lines = [];
    for (const pb of paper.trades || []) {
      if (pb.kind === "option" || have.has(pb.id)) continue;
      const earnings = given[pb.sym] ?? earningsFromBoard(pb.sym, pb.entry_date);
      const q = makeTwin(pb, { earnings });
      quant.twins.push(q);
      lines.push(`  ADDED    ${q.id} twin of ${pb.id} ${q.side.toUpperCase()} ${q.shares} ${q.sym} at ${q.entry}, start stop ${q.stop0}, hard exit ${q.hard_exit} (${q.hard_exit_why})${given[pb.sym] ? "" : earnings ? " [earnings from the board, verify]" : ""}`);
    }
    if (lines.length && has("--write")) save(DB, quant);
    console.log(`PAPER QUANT SYNC: ${lines.length} added${lines.length && !has("--write") ? " (dry run - add --write)" : ""}. No money at risk.`);
    lines.forEach((l) => console.log(l));
    return;
  }

  if (cmd === "score") {
    const open = quant.twins.filter((q) => q.status === "OPEN");
    let series = {};
    if (val("--bars-file")) series = JSON.parse(readFileSync(resolve(val("--bars-file")), "utf8"));
    else {
      series.SPY = settledOnly(await yahooBars("SPY", "1y"));
      for (const s of new Set(open.map((q) => q.sym))) {
        try { series[s] = settledOnly(await yahooBars(s, "1y")); } catch (e) { series[s] = { error: e.message }; }
      }
    }
    const through = val("--date") || null;
    const lines = [];
    quant.twins = quant.twins.map((q) => {
      if (q.status !== "OPEN") return q;
      const bars = series[q.sym];
      if (!Array.isArray(bars)) { lines.push(`  NO BARS  ${q.id} ${q.sym} - ${bars?.error ?? "missing"}`); return q; }
      const n = replay(q, bars, series.SPY, { through });
      const pb = (paper.trades || []).find((t) => t.id === q.of);
      const vs = pb ? ` | fixed ${pb.id} ${rStr(fixedR(pb))}${pb.status === "OPEN" ? " open" : ` ${pb.exit_reason}`}` : "";
      lines.push(n.status === "OPEN"
        ? `  OPEN     ${n.id} ${n.sym} ${n.side} close ${n.last_close} (${rStr(openR(n))}), trail stop ${n.stop}, shape ${n.shape?.holds ? "HOLDS" : n.shape_seen ? "?" : "never held"}, hard exit ${n.hard_exit}${vs}`
        : `  ${n.exit_reason.padEnd(11)} ${n.id} ${n.sym} ${n.exit_date} at ${n.exit_price}: ${money(n.realized)} = ${rStr(n.r)} (${n.exit_why}; gave back ${n.giveback_r}R from the best close ${n.best_close})${vs}`);
      return n;
    });
    if (has("--write")) save(DB, quant);
    console.log(`PAPER QUANT ${through || "through the last settled bar"}${has("--write") ? " (written)" : ""}: ${quant.twins.filter((q) => q.status === "OPEN").length} open, ${quant.twins.filter((q) => q.status !== "OPEN").length} closed`);
    lines.forEach((l) => console.log(l));
    return;
  }

  if (cmd === "report") {
    const c = compare(quant, paper);
    if (has("--json")) { console.log(JSON.stringify({ ...c, twins: quant.twins }, null, 2)); return; }
    const open = c.pairs.filter(({ q }) => q.status === "OPEN");
    console.log(`QUANT-EXIT TWINS: ${open.length} open, ${c.pairs.length - open.length} closed. Same entries as the paper book; only the exit differs.`);
    if (!has("--brief")) for (const { q, pb } of c.pairs) {
      const f = pb ? `fixed ${pb.id} ${rStr(fixedR(pb))} ${pb.status === "OPEN" ? "open" : pb.exit_reason}` : `fixed ${q.of} missing`;
      const z = q.status === "OPEN" ? `quant ${rStr(openR(q))} open, trail stop ${q.stop ?? q.stop0}, out by ${q.hard_exit}` : `quant ${rStr(q.r)} ${q.exit_reason} ${q.exit_date} (${q.exit_why})`;
      console.log(`  ${q.id} ${q.sym.padEnd(5)} ${q.side.padEnd(5)} | ${f} | ${z}`);
    } else for (const { q } of open) console.log(`  ${q.sym} ${q.side} twin: ${rStr(openR(q))}, trail stop ${q.stop ?? q.stop0}, shape ${q.shape?.holds ? "holds" : q.shape_seen ? "broke" : "never held"}, out by ${q.hard_exit}`);
    console.log(`  CLOSED PAIRS ${c.closed_pairs}: fixed ${rStr(c.fixed.sum_r)} (${c.fixed.wins} won, ${money(c.fixed.usd)}) vs quant ${rStr(c.quant.sum_r)} (${c.quant.wins} won, ${money(c.quant.usd)})${c.quant.avg_giveback_r != null ? `, quant gave back ${c.quant.avg_giveback_r}R a trade on average` : ""}${c.closed_pairs >= 10 && c.closed_pairs % 10 === 0 ? ` - REVIEW DUE (${c.closed_pairs} closed pairs: Adam picks the exit rule)` : ""}`);
    return;
  }

  console.log("usage: paper-quant.mjs sync|score|report  (see header)");
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`paper-quant: ${e.message}`); process.exit(1); });
