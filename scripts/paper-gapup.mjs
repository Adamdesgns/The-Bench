// paper-gapup.mjs — the GAP-UP PAPER TEST (v33): what a "buy the gap-up" entry would have done,
// tracked beside the current no-chase rule, with no money at risk.
//
//   node scripts/paper-gapup.mjs add --sym LITE --signal-row B-406 --signal-date 2026-09-15 \
//        --signal-low 832.11 --zone-high 850.22 --entry 882.94 --atr 45 --target 1000 [--date 2026-09-16]
//   node scripts/paper-gapup.mjs score --bars '{"LITE":{"high":937.88,"low":855.09,"close":919.4}}' [--date D] [--write]
//   node scripts/paper-gapup.mjs report [--json]
//   add --db f.json to any command for an offline test file
//
// WHY THIS EXISTS (2026-09-24)
// ----------------------------
// The entry audit (docs/self-audit-2026-09-24-entries.md) found the no-chase rule missed LITE
// (+11.7%) and IREN (+10.4%): both opened ABOVE their zones the morning after a close signal and
// ran. The void-on-gap-down half was 3 for 3. Eight events is not enough to change a rule on live
// money, so Adam approved a paper test ("Do it"): for the next 10 signals whose first 30-minute bar
// closes above the zone top, record a pretend entry at that bar's close with a stop under the
// signal day's low (or 1 ATR, whichever is wider), and score it. The current rule's result on the
// same signal is "no trade" = 0R. After 10 closed paper trades, the better record becomes the rule.
// The audit's own sample (LITE, IREN, ASPN) is NOT in the test - a rule is never graded on the
// examples that suggested it.
//
// Scoring is conservative on purpose: the entry day's full low counts against the stop (the bar
// before the entry included), and a day that touches both stop and target is scored as the stop.
// An open under the stop exits at the open. Five sessions after entry, anything still open exits
// at that close. Zero-dep. Writes only db/paper-gapup.json.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
export const TARGET_N = 10;
export const MAX_SESSIONS = 5;

export function nyDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// The stop is the WIDER of the signal-day low and 1 ATR under entry (the ATR Floor still applies).
export function stopFor(entry, signalLow, atr) {
  return Math.min(signalLow, entry - atr);
}

// Advance one open paper trade by one daily bar {high, low, close, open?}. Returns the updated trade.
export function step(t, bar, date) {
  if (t.status !== "OPEN" || (t.last_scored && date <= t.last_scored) || date < t.entry_date) return t;
  const out = { ...t, sessions: t.sessions + 1, last_scored: date };
  const close = (exit, why) => Object.assign(out, { status: why, exit, exit_date: date, r: +((exit - t.entry) / (t.entry - t.stop)).toFixed(2) });
  if (typeof bar.open === "number" && bar.open <= t.stop) return close(bar.open, "STOPPED");
  if (bar.low <= t.stop) return close(t.stop, "STOPPED");
  if (t.target && bar.high >= t.target) return close(t.target, "TARGET");
  if (out.sessions >= MAX_SESSIONS) return close(bar.close, "TIME");
  return out;
}

export function summarize(trades) {
  const closed = trades.filter((t) => t.status !== "OPEN");
  const sumR = closed.reduce((a, t) => a + t.r, 0);
  const wins = closed.filter((t) => t.r > 0).length;
  return {
    closed: closed.length, open: trades.length - closed.length,
    wins, win_rate: closed.length ? +(wins / closed.length * 100).toFixed(0) : null,
    avg_r: closed.length ? +(sumR / closed.length).toFixed(2) : null, sum_r: +sumR.toFixed(2),
    decided: closed.length >= TARGET_N,
  };
}

function load(p) { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { trades: [] }; }
function save(p, d) { writeFileSync(p, JSON.stringify(d, null, 2) + "\n"); }

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const num = (f) => (val(f) === undefined ? undefined : Number(val(f)));
  const DB = resolve(val("--db") || resolve(ROOT, "db/paper-gapup.json"));
  const data = load(DB);

  if (cmd === "add") {
    const need = ["--sym", "--signal-row", "--signal-date", "--signal-low", "--zone-high", "--entry", "--atr"];
    const miss = need.filter((f) => val(f) === undefined);
    if (miss.length) { console.log(`REFUSED - missing ${miss.join(", ")}`); process.exit(1); }
    const entry = num("--entry"), zoneHigh = num("--zone-high");
    if (!(entry > zoneHigh)) { console.log(`REFUSED - entry ${entry} is not above the zone top ${zoneHigh}; this test only records gap-up cases`); process.exit(1); }
    const sym = val("--sym").toUpperCase(), row = val("--signal-row");
    if (data.trades.some((t) => t.sym === sym && t.signal_row === row)) { console.log(`REFUSED - ${sym} ${row} is already in the test`); process.exit(1); }
    const stop = +stopFor(entry, num("--signal-low"), num("--atr")).toFixed(4);
    const t = {
      id: `PG-${String(data.trades.length + 1).padStart(3, "0")}`, sym, signal_row: row, signal_date: val("--signal-date"),
      entry_date: val("--date") || nyDate(), entry, stop, target: num("--target") ?? null, atr: num("--atr"),
      signal_low: num("--signal-low"), zone_high: zoneHigh, status: "OPEN", sessions: 0, last_scored: null,
      current_rule: "NO TRADE (0R)",
    };
    data.trades.push(t); save(DB, data);
    console.log(`PAPER ${t.id} ${sym}: entry ${entry} (above zone top ${zoneHigh}), stop ${stop}, target ${t.target ?? "none"}, risk ${(entry - stop).toFixed(2)}/sh. No money at risk.`);
    return;
  }

  if (cmd === "score") {
    const raw = val("--bars") ?? (val("--bars-file") ? readFileSync(resolve(val("--bars-file")), "utf8") : null);
    if (!raw) { console.log("REFUSED - pass --bars '{\"SYM\":{\"high\":..,\"low\":..,\"close\":..}}' (today's daily bars)"); process.exit(1); }
    const bars = Object.fromEntries(Object.entries(JSON.parse(raw)).map(([k, v]) => [k.toUpperCase(), v]));
    const date = val("--date") || nyDate();
    const lines = [];
    data.trades = data.trades.map((t) => {
      if (t.status !== "OPEN") return t;
      const b = bars[t.sym];
      if (!b) { lines.push(`  NO BAR   ${t.id} ${t.sym} - pass today's high/low/close`); return t; }
      const n = step(t, b, date);
      lines.push(n.status === "OPEN"
        ? `  OPEN     ${n.id} ${n.sym} session ${n.sessions}/${MAX_SESSIONS}, close ${b.close} (${(((b.close - n.entry) / (n.entry - n.stop))).toFixed(2)}R)`
        : `  ${n.status.padEnd(8)} ${n.id} ${n.sym} exit ${n.exit} = ${n.r}R  (current rule on the same signal: 0R)`);
      return n;
    });
    if (has("--write")) save(DB, data);
    const s = summarize(data.trades);
    console.log(`PAPER GAP-UP SCORE ${date}${has("--write") ? " (written)" : ""}: ${s.closed} closed / ${s.open} open`);
    lines.forEach((l) => console.log(l));
    return;
  }

  if (cmd === "report") {
    const s = summarize(data.trades);
    if (has("--json")) { console.log(JSON.stringify({ ...s, trades: data.trades }, null, 2)); return; }
    console.log(`PAPER GAP-UP TEST: ${s.closed}/${TARGET_N} closed, ${s.open} open`);
    for (const t of data.trades) console.log(`  ${t.id} ${t.sym.padEnd(5)} ${t.status.padEnd(7)} entry ${t.entry} stop ${t.stop}${t.status === "OPEN" ? "" : ` exit ${t.exit} ${t.r}R`}  [${t.signal_row}]`);
    if (s.closed) console.log(`  gap-up entry: ${s.wins}/${s.closed} winners, avg ${s.avg_r}R, total ${s.sum_r}R  |  current rule: 0R`);
    console.log(s.decided
      ? `  DECIDED: ${s.avg_r > 0 ? "the gap-up entry beat the no-chase rule - bring it to Adam as the new rule" : "the gap-up entry did not beat 0R - the no-chase rule stays"}`
      : `  Not decided until ${TARGET_N} are closed. No rule changes before then.`);
    return;
  }

  console.log("usage: paper-gapup.mjs add|score|report  (see header)");
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
