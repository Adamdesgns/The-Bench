// prepump-outcomes.mjs — forward outcomes for collected snapshot rows. Labels, computed LATE.
//
//   node scripts/prepump-outcomes.mjs plan  --asof 2026-10-10
//   node scripts/prepump-outcomes.mjs build --asof 2026-10-10 [--dry-run]
//
// EXIT CODES: 0 ok · 1 nothing due · 2 REFUSED (bad input, missing raw bars)
//
// WHY THIS IS A SEPARATE JOB (2026-09-05)
// ---------------------------------------
// The collector deliberately computes NO labels. Outcomes live here so the label
// definition can change without recollecting a single day — and it will change,
// because nobody knows yet what "a pump" is worth measuring as. Collection is
// expensive and unrepeatable; labelling is cheap and infinitely repeatable.
//
// WHAT IT REFUSES TO DO:
//  - It never edits a snapshot row. Outcomes are their own append-only files.
//  - It only measures windows that are FULLY COMPLETE. A 10-session window needs
//    10 settled sessions after the entry, or the row stays pending. A partial
//    window silently biases every statistic toward whatever just happened.
//  - It never re-queries a symbol sealed GONE. Delisted tickers get recycled — FB
//    now resolves to a buffer ETF, not Meta — so a fresh lookup on a dead symbol
//    starts collecting a different company under the same name.
//
// HORIZONS: the brief asks for 1/3/5/10. Hunter's Lab uses 1/3/7/14/30. The bars
// are pulled either way, so this computes the SUPERSET and leaves the longer ones
// null until enough sessions exist. Costs nothing; avoids a recollection if the
// horizon definition ever moves.
//
// THE BENCHMARK: every figure is also computed for SPY over the IDENTICAL session
// dates, not SPY's own bar positions. Without it a market-wide up week reads as
// 460 successful predictions.
//
// ENTRY-CLOSE RECONCILIATION: the snapshot's same-day close was provisional when
// written (there is no endpoint that returns day D's settled close on day D). Here
// the settled close for that date is fetched and BOTH are recorded, with the delta.
// Disagreement is data — split restatement, revision, provider drift. Silently
// picking one is how a dataset becomes fiction.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCalendar, isTradingDay, sessionsSince, shiftSessions, todayET, lastSessionOnOrBefore } from "./prepump-session.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PREPUMP = resolve(ROOT, "db/prepump");
const OUT = join(PREPUMP, "outcomes");
const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

export const SCHEMA = "bench-prepump-outcome-v1";
export const HORIZONS = [1, 3, 5, 7, 10, 14, 30];
export const REQUIRED_HORIZON = 10; // the brief's bar for "old enough to score"
const BENCH = "SPY";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const refuse = (m) => { console.error(`REFUSED — ${m}`); process.exit(2); };
const rawDir = (asof) => join(PREPUMP, "raw-outcomes", asof);
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const pct = (a, b) => (a === null || b === null || !b ? null : +(((a - b) / b) * 100).toFixed(4));

/** Snapshot dates already collected. */
export function snapshotDates() {
  if (!existsSync(PREPUMP)) return [];
  return readdirSync(PREPUMP).filter((f) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).map((f) => f.slice(0, 10)).sort();
}

/** Symbol-dates that already have an outcome, so we never double-score. */
export function scoredKeys() {
  const seen = new Set();
  if (!existsSync(OUT)) return seen;
  for (const f of readdirSync(OUT).filter((f) => f.endsWith(".ndjson"))) {
    for (const line of readFileSync(join(OUT, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); seen.add(`${r.symbol}|${r.entry_date}`); } catch { /* a corrupt line must not silently drop scoring */ }
    }
  }
  return seen;
}

/** One row per symbol-date from the snapshot files, deduped to the LAST row written for that pair. */
export function loadSnapshots(dates) {
  const by = new Map();
  for (const d of dates) {
    const p = join(PREPUMP, `${d}.ndjson`);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (!r.symbol || !r.date) continue;
      if (r.status === "not_found" || r.status === "no_data") continue;
      by.set(`${r.symbol}|${r.date}`, r); // later row wins; both remain on disk
    }
  }
  return by;
}

export function duePairs(asof, cal) {
  const snaps = loadSnapshots(snapshotDates());
  const done = scoredKeys();
  const due = [];
  for (const [key, r] of snaps) {
    if (done.has(key)) continue;
    let age;
    try { age = sessionsSince(r.date, asof, cal); } catch { continue; }
    if (age < REQUIRED_HORIZON) continue;
    due.push({ symbol: r.symbol, entry_date: r.date, snapshot: r, age });
  }
  due.sort((a, b) => (a.entry_date === b.entry_date ? a.symbol.localeCompare(b.symbol) : a.entry_date.localeCompare(b.entry_date)));
  return due;
}

function cmdPlan() {
  const asof = val("--asof") ?? todayET();
  if (!DATE_RE.test(asof)) refuse(`--asof must be YYYY-MM-DD, got "${asof}"`);
  const cal = loadCalendar();
  const anchor = isTradingDay(asof, cal) ? asof : lastSessionOnOrBefore(asof, cal);
  const due = duePairs(anchor, cal);
  if (!due.length) { console.log(`nothing due as of ${asof} (anchor session ${anchor})`); process.exit(1); }

  const symbols = [...new Set(due.map((d) => d.symbol))].sort();
  const earliest = due[0].entry_date;
  // One history pull per symbol covers every pending date for that symbol.
  const from = shiftSessions(earliest, -2, cal);
  const dir = rawDir(anchor);
  mkdirSync(dir, { recursive: true });
  const plan = {
    schema: "bench-prepump-outcome-plan-v1",
    asof, anchor_session: anchor, planned_at: new Date().toISOString(),
    pairs_due: due.length,
    symbols_needed: symbols.length,
    benchmark: BENCH,
    bars_from: from, bars_to: anchor,
    note: "Pull interval=day bars covering bars_from..bars_to for every symbol below PLUS SPY. Pass adjustment_type EXPLICITLY and record it in the envelope.",
    batches: chunk([...symbols.filter((s) => s !== BENCH), BENCH], 10),
    entry_dates: [...new Set(due.map((d) => d.entry_date))].sort(),
  };
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  console.log(`outcomes due as of ${asof} (anchor ${anchor}): ${due.length} symbol-dates across ${symbols.length} symbols`);
  console.log(`  entry dates: ${plan.entry_dates.join(", ")}`);
  console.log(`  bars needed: ${from} .. ${anchor} · ${plan.batches.length} calls of <=10 (SPY included)`);
  console.log(`  -> ${join(dir, "plan.json")}`);
}

export function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

/** symbol -> {date -> bar}, interpolated dropped. */
export function indexBars(dir) {
  const by = {};
  const meta = {};
  if (!existsSync(dir)) return { by, meta };
  for (const f of readdirSync(dir).filter((f) => f.startsWith("hist-") && f.endsWith(".json"))) {
    let env; try { env = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    const d = env?.response?.data ?? env?.response ?? env?.data ?? {};
    const basis = env.adjustment_type ?? "UNDECLARED";
    for (const r of d.results ?? []) {
      if (!r?.symbol) continue;
      const m = (by[r.symbol] ||= {});
      for (const b of r.bars ?? []) {
        if ("interpolated" in b && b.interpolated) continue;
        m[String(b.begins_at).slice(0, 10)] = { o: num(b.open_price), h: num(b.high_price), l: num(b.low_price), c: num(b.close_price), v: num(b.volume) };
      }
      meta[r.symbol] = { adjustment_basis: basis, adjustment_attestation: "REQUEST_PARAMETER_ATTESTATION_ONLY", observed_at: env.observed_at ?? null };
    }
  }
  return { by, meta };
}

/** Forward session dates after entry, from the calendar — not from bar positions. */
export function forwardDates(entry, n, cal) {
  const out = [];
  let d = entry;
  for (let i = 0; i < n; i++) { d = shiftSessions(d, 1, cal); out.push(d); }
  return out;
}

/**
 * Per-horizon forward stats, UP AND DOWN.
 *
 * The downside half is not symmetry-for-its-own-sake. The prior Phase 0 study
 * (research/vibe-trading-runs/prepump/RESULTS.md, 2026-09-05, 8.4M bars, sealed
 * test window) found every rule tested is a VOLATILITY detector, not a direction
 * one — the three-way rule lifted crashes 49x against 20x for pumps, i.e. it
 * pointed at falling knives twice as often as at pumps. What replicated out of
 * sample was MAGNITUDE ("something is about to happen"), never direction.
 *
 * A dataset that records only max gain cannot see that, and would make the same
 * detector look good twice. Recording both is the only way the direction question
 * stays answerable.
 */
export function computeOutcome(entryClose, dates, bars) {
  const res = {};
  let maxHigh = null, minLow = null, missing = 0;
  const closes = [];
  for (const d of dates) {
    const b = bars[d];
    if (!b) { missing++; closes.push(null); continue; }
    closes.push(b.c);
    if (b.h !== null && (maxHigh === null || b.h > maxHigh)) maxHigh = b.h;
    if (b.l !== null && (minLow === null || b.l < minLow)) minLow = b.l;
  }
  for (const h of HORIZONS) {
    if (dates.length < h) { res[h] = null; continue; }
    const w = closes.slice(0, h);
    if (w.some((c) => c === null)) { res[h] = null; continue; }
    res[h] = {
      max_close_gain_pct: pct(Math.max(...w), entryClose),
      worst_close_pct: pct(Math.min(...w), entryClose), // worst CLOSE vs entry; positive if it never dipped below entry
      close_at_h_pct: pct(w[h - 1], entryClose),
      close_at_h: w[h - 1],
    };
  }
  return {
    horizons: res,
    max_intraday_high: maxHigh,
    max_intraday_high_gain_pct: maxHigh === null ? null : pct(maxHigh, entryClose),
    min_intraday_low: minLow,
    min_intraday_low_pct: minLow === null ? null : pct(minLow, entryClose),
    missing_sessions: missing,
  };
}

function cmdBuild() {
  const asof = val("--asof") ?? todayET();
  if (!DATE_RE.test(asof)) refuse(`--asof must be YYYY-MM-DD, got "${asof}"`);
  const cal = loadCalendar();
  const anchor = isTradingDay(asof, cal) ? asof : lastSessionOnOrBefore(asof, cal);
  const dir = rawDir(anchor);
  if (!existsSync(join(dir, "plan.json"))) refuse(`no plan at ${join(dir, "plan.json")} — run \`plan\` first`);
  const { by, meta } = indexBars(dir);
  if (!Object.keys(by).length) refuse(`no hist-*.json bars in ${dir}. Without settled bars there is nothing to score, and an empty outcome file would read as "no moves happened".`);
  const spy = by[BENCH];
  if (!spy) refuse(`no ${BENCH} bars in the raw drop. The benchmark is not optional — without it a market-wide rally reads as a wall of correct predictions.`);

  const due = duePairs(anchor, cal);
  const rows = [];
  const skipped = [];
  const maxH = Math.max(...HORIZONS);

  for (const d of due) {
    const bars = by[d.symbol];
    if (!bars) { skipped.push({ ...keyOf(d), reason: "no bars returned for this symbol" }); continue; }
    const entryBar = bars[d.entry_date];
    const settledEntryClose = entryBar?.c ?? null;
    // Prefer the SETTLED close for the entry; fall back to what the snapshot saw.
    const snapProvisional = d.snapshot.q_last_trade_price ?? null;
    const entryClose = settledEntryClose ?? snapProvisional;
    if (entryClose === null) { skipped.push({ ...keyOf(d), reason: "no settled entry close and no provisional close on the snapshot row" }); continue; }

    const dates = forwardDates(d.entry_date, Math.min(maxH, d.age), cal);
    const have = dates.filter((x) => bars[x]).length;
    if (dates.length < REQUIRED_HORIZON || have < REQUIRED_HORIZON) {
      skipped.push({ ...keyOf(d), reason: `only ${have} of the required ${REQUIRED_HORIZON} forward sessions are present in the bars` });
      continue;
    }
    const sym = computeOutcome(entryClose, dates, bars);
    const spyEntry = spy[d.entry_date]?.c ?? null;
    const bench = spyEntry !== null ? computeOutcome(spyEntry, dates, spy) : null;

    const row = {
      schema: SCHEMA,
      symbol: d.symbol,
      entry_date: d.entry_date,
      scored_at: new Date().toISOString(),
      asof_session: anchor,
      universe_version: d.snapshot.universe_version ?? null,
      source: d.snapshot.source ?? null,
      core_band: d.snapshot.core_band ?? null,
      adjustment_basis: meta[d.symbol]?.adjustment_basis ?? null,
      adjustment_attestation: meta[d.symbol]?.adjustment_attestation ?? null,

      entry_close: entryClose,
      entry_close_source: settledEntryClose !== null ? "settled daily bar" : "snapshot provisional last trade",
      entry_close_provisional_at_snapshot: snapProvisional,
      entry_close_delta: settledEntryClose !== null && snapProvisional !== null ? +(settledEntryClose - snapProvisional).toFixed(6) : null,

      forward_sessions: dates,
      missing_sessions: sym.missing_sessions,

      max_close_gain_1d: sym.horizons[1]?.max_close_gain_pct ?? null,
      max_close_gain_3d: sym.horizons[3]?.max_close_gain_pct ?? null,
      max_close_gain_5d: sym.horizons[5]?.max_close_gain_pct ?? null,
      max_close_gain_10d: sym.horizons[10]?.max_close_gain_pct ?? null,
      max_close_gain_7d: sym.horizons[7]?.max_close_gain_pct ?? null,
      max_close_gain_14d: sym.horizons[14]?.max_close_gain_pct ?? null,
      max_close_gain_30d: sym.horizons[30]?.max_close_gain_pct ?? null,
      max_intraday_high_10d: sym.max_intraday_high,
      max_intraday_high_gain_10d_pct: sym.max_intraday_high_gain_pct,
      close_10d: sym.horizons[10]?.close_at_h ?? null,
      close_10d_pct: sym.horizons[10]?.close_at_h_pct ?? null,

      // DOWNSIDE — see computeOutcome. The prior study found the naive pre-pump
      // rule is a crash detector (49x crash lift vs 20x pump lift). Without these
      // columns the dataset cannot tell a pump from a knife.
      worst_close_pct_1d: sym.horizons[1]?.worst_close_pct ?? null,
      worst_close_pct_3d: sym.horizons[3]?.worst_close_pct ?? null,
      worst_close_pct_5d: sym.horizons[5]?.worst_close_pct ?? null,
      worst_close_pct_10d: sym.horizons[10]?.worst_close_pct ?? null,
      min_intraday_low_10d: sym.min_intraday_low,
      min_intraday_low_10d_pct: sym.min_intraday_low_pct,
      spy_worst_close_pct_10d: bench?.horizons[10]?.worst_close_pct ?? null,

      spy_entry_close: spyEntry,
      spy_max_close_gain_1d: bench?.horizons[1]?.max_close_gain_pct ?? null,
      spy_max_close_gain_3d: bench?.horizons[3]?.max_close_gain_pct ?? null,
      spy_max_close_gain_5d: bench?.horizons[5]?.max_close_gain_pct ?? null,
      spy_max_close_gain_10d: bench?.horizons[10]?.max_close_gain_pct ?? null,
      spy_close_10d_pct: bench?.horizons[10]?.close_at_h_pct ?? null,
    };
    rows.push(row);
  }

  const outPath = join(OUT, `${anchor}.ndjson`);
  const manifest = {
    schema: "bench-prepump-outcome-manifest-v1",
    asof, anchor_session: anchor, built_at: new Date().toISOString(),
    due: due.length, scored: rows.length, skipped: skipped.length,
    horizons: HORIZONS, required_horizon: REQUIRED_HORIZON, benchmark: BENCH,
    skipped_detail: skipped.slice(0, 200),
  };

  if (has("--dry-run")) { console.log(JSON.stringify({ ...manifest, sample: rows[0] ?? null }, null, 2)); return; }
  if (!rows.length) { console.log(`nothing scoreable as of ${asof} (${due.length} due, all skipped)`); process.exit(1); }

  mkdirSync(OUT, { recursive: true });
  mkdirSync(join(PREPUMP, "runs"), { recursive: true });
  appendFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(PREPUMP, "runs", `outcomes-${anchor}.json`), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`scored ${rows.length} symbol-dates -> ${outPath}`);
  console.log(`  due ${due.length} · skipped ${skipped.length}`);
  if (skipped.length) console.log(`  ! ${skipped.length} skipped — see manifest. Skipped is NOT zero-outcome; it means not measurable yet.`);
  console.log(`  manifest -> ${join(PREPUMP, "runs", `outcomes-${anchor}.json`)}`);
}

const keyOf = (d) => ({ symbol: d.symbol, entry_date: d.entry_date });

function main() {
  if (cmd === "plan") return cmdPlan();
  if (cmd === "build") return cmdBuild();
  refuse(`unknown command "${cmd ?? ""}". Use: plan | build`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
