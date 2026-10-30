#!/usr/bin/env node
// up-in-down-tape.mjs — a stock jumps 10%+ on a day the market falls. Short it, buy it, or neither?
//
//   node scripts/up-in-down-tape.mjs                        the cached universe (offline, no downloads)
//   node scripts/up-in-down-tape.mjs --jump 10 --spy -1     thresholds in percent (defaults shown)
//   node scripts/up-in-down-tape.mjs --out docs/research/x.json
//
// WHY THIS EXISTS (2026-10-30)
// ----------------------------
// REGN rose 11.9% on its Q3 beat while SPY fell 1.4% and QQQ 2.9%. The desk logged a long
// (B-1188); Adam passed (B-1190): "Up 12% in a crash and you think it's going up more?" and
// then asked whether a short is historically the right call on that shape. This counts it.
//
// METHOD
//   - Prices: the Yahoo adjusted daily closes already cached by earnings-runup.mjs
//     (.cache/earnings-runup/yahoo, ~10 years, today's db/prepump universe). Nothing is downloaded.
//   - Event: a close-to-close gain of at least --jump on a session where SPY closed down at
//     least --spy. One event per name per 10 sessions (the first one), so a wild week counts once.
//   - Forward return: from the event close to the close N sessions later (1, 5, 10, 20).
//     A short at the event close makes exactly minus that, before borrow costs.
//   - Excess: stock return minus beta x SPY return over the same days, beta from sessions
//     -250..-21. No alpha term on purpose: the universe is today's list (survivors), so the
//     raw and excess numbers lean UP, which is against the short. Said in the output.
//   - Earnings: the event is an earnings reaction when an 8-K Item 2.02 reacts that session
//     (reactionIndex from earnings-runup.mjs).
//   - Significance clustered by event DATE: one market day can put 40 names in the sample
//     (March 2020), so t = mean of the per-date means / their standard error.
//   - Comparison sets: the same jump on a day SPY closed up, and every jump day.
//
// A base rate is a count of the past, never a buy or sell signal (v28 QUANT EVIDENCE).
// Zero-dep. Read-only. Writes only --out.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { earningsFilings, reactionIndex } from "./earnings-runup.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HORIZONS = [1, 5, 10, 20], SPACING = 10, BETA_FROM = 250, BETA_TO = 21;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
}

// ---------- pure parts (exported for tests) ----------

function beta(bars, spyByDate, d0) {
  const xs = [], ys = [];
  for (let i = Math.max(1, d0 - BETA_FROM); i <= d0 - BETA_TO; i++) {
    const a = spyByDate.get(bars[i].date), b = spyByDate.get(bars[i - 1].date);
    if (!a || !b) continue;
    xs.push(a / b - 1); ys.push(bars[i].close / bars[i - 1].close - 1);
  }
  const n = xs.length; if (n < 60) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let cov = 0, vx = 0;
  for (let i = 0; i < n; i++) { cov += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; }
  return vx > 0 ? cov / vx : null;
}

// Every jump day for one name: {d0, date, jump, spy, beta, fwd: {N: {raw, excess}}}.
// `keep(spyMove)` picks the market condition; spacing drops repeats inside 10 sessions.
export function findEvents(bars, spyByDate, { jump, keep }) {
  const out = [];
  let last = -Infinity;
  for (let d0 = BETA_FROM + 1; d0 < bars.length; d0++) {
    const r = bars[d0].close / bars[d0 - 1].close - 1;
    if (r < jump) continue;
    const a = spyByDate.get(bars[d0].date), b = spyByDate.get(bars[d0 - 1].date);
    if (!a || !b) continue;
    const m = a / b - 1;
    if (!keep(m)) continue;
    if (d0 - last < SPACING) continue;
    last = d0;
    const bt = beta(bars, spyByDate, d0);
    if (bt === null) continue;
    const fwd = {};
    for (const N of HORIZONS) {
      const j = d0 + N;
      if (j >= bars.length) continue;
      const s1 = spyByDate.get(bars[j].date), s0 = spyByDate.get(bars[d0].date);
      if (!s1 || !s0) continue;
      const raw = bars[j].close / bars[d0].close - 1;
      fwd[N] = { raw, excess: raw - bt * (s1 / s0 - 1) };
    }
    out.push({ d0, date: bars[d0].date, jump: r, spy: m, beta: bt, fwd });
  }
  return out;
}

// Pooled mean / median / share down, and a t clustered by event date (every date counts,
// even one with a single name, because the shape is rare and a date is the shock).
export function summarize(rows) {
  const v = rows.filter((e) => Number.isFinite(e.x));
  if (v.length < 2) return { n: v.length };
  const xs = v.map((e) => e.x).sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  // Means of the cluster means and their t. By date, and by month: down days bunch together
  // and 10-20 session windows overlap, so the month t is the honest one at those horizons.
  const byKey = (key) => {
    const g = new Map();
    for (const e of v) { const k = key(e.date); (g.get(k) || g.set(k, []).get(k)).push(e.x); }
    const dm = [...g.values()].map((a) => a.reduce((s, x) => s + x, 0) / a.length);
    const C = dm.length, cm = dm.reduce((a, b) => a + b, 0) / C;
    const sd = C > 1 ? Math.sqrt(dm.reduce((a, b) => a + (b - cm) ** 2, 0) / (C - 1)) : NaN;
    return { C, cm, t: C > 2 ? +(cm / (sd / Math.sqrt(C))).toFixed(2) : null };
  };
  const d = byKey((x) => x), m = byKey((x) => x.slice(0, 7));
  const pct = (x) => +(x * 100).toFixed(2);
  return {
    n: xs.length, dates: d.C,
    mean: pct(mean), median: pct(xs[Math.floor(xs.length / 2)]),
    down: +(xs.filter((x) => x < 0).length / xs.length * 100).toFixed(1),
    dayMean: pct(d.cm), t: d.t, tMonth: m.t
  };
}

// ---------- run ----------
function main() {
  const jump = Number(arg("jump", "10")) / 100, spyCut = Number(arg("spy", "-1")) / 100;
  const cache = resolve(ROOT, ".cache/earnings-runup");
  if (!existsSync(join(cache, "yahoo", "SPY.json"))) { console.error("no cache: run scripts/earnings-runup.mjs once first"); process.exit(2); }
  const spy = JSON.parse(readFileSync(join(cache, "yahoo", "SPY.json"), "utf8"));
  const spyByDate = new Map(spy.map((b) => [b.date, b.close]));
  const tick = JSON.parse(readFileSync(join(cache, "company_tickers.json"), "utf8"));
  const cikOf = new Map(Object.values(tick).map((t) => [t.ticker.toUpperCase(), String(t.cik_str).padStart(10, "0")]));

  const sets = {
    downTape: { label: `jump >= ${jump * 100}% while SPY <= ${spyCut * 100}%`, keep: (m) => m <= spyCut, events: [] },
    upTape: { label: `jump >= ${jump * 100}% while SPY >= 0%`, keep: (m) => m >= 0, events: [] },
    any: { label: `jump >= ${jump * 100}%, any market`, keep: () => true, events: [] }
  };
  const syms = readdirSync(join(cache, "yahoo")).map((f) => f.replace(/\.json$/, "")).filter((s) => s !== "SPY");
  for (const sym of syms) {
    const bars = JSON.parse(readFileSync(join(cache, "yahoo", `${sym}.json`), "utf8"));
    if (bars.length < 400) continue;
    const cik = cikOf.get(sym.replace(".", "-")) || cikOf.get(sym);
    const ef = cik && existsSync(join(cache, "edgar", `${cik}.json`)) ? JSON.parse(readFileSync(join(cache, "edgar", `${cik}.json`), "utf8")) : null;
    const reacts = new Set(earningsFilings(ef).map((f) => reactionIndex(bars, f)).filter((i) => i >= 0));
    for (const s of Object.values(sets))
      for (const e of findEvents(bars, spyByDate, { jump, keep: s.keep }))
        s.events.push({ sym, ...e, earnings: reacts.has(e.d0), hasFilings: !!ef });
  }

  const table = (events) => Object.fromEntries(HORIZONS.map((N) => [N, {
    raw: summarize(events.map((e) => ({ x: e.fwd[N]?.raw, date: e.date }))),
    excess: summarize(events.map((e) => ({ x: e.fwd[N]?.excess, date: e.date })))
  }]));
  const dt = sets.downTape.events;
  const result = {
    asof: new Date().toISOString().slice(0, 10),
    params: { jumpPct: jump * 100, spyPct: spyCut * 100, spacing: SPACING, horizons: HORIZONS },
    coverage: { names: syms.length, first: spy[BETA_FROM + 1]?.date, last: spy.at(-1).date },
    downTape: table(dt),
    downTapeEarnings: table(dt.filter((e) => e.earnings)),
    downTapeNoEarnings: table(dt.filter((e) => !e.earnings && e.hasFilings)),
    downTapeEx2020: table(dt.filter((e) => !e.date.startsWith("2020"))),
    upTape: table(sets.upTape.events),
    any: table(sets.any.events),
    byYear: Object.fromEntries([...new Set(dt.map((e) => e.date.slice(0, 4)))].sort().map((y) => [y, summarize(dt.filter((e) => e.date.startsWith(y)).map((e) => ({ x: e.fwd[10]?.raw, date: e.date })))])),
    events: dt.map((e) => ({ sym: e.sym, date: e.date, jump: +(e.jump * 100).toFixed(1), spy: +(e.spy * 100).toFixed(2), earnings: e.earnings, fwd10: e.fwd[10] ? +(e.fwd[10].raw * 100).toFixed(2) : null, fwd20: e.fwd[20] ? +(e.fwd[20].raw * 100).toFixed(2) : null }))
  };
  if (arg("out")) writeFileSync(resolve(ROOT, arg("out")), JSON.stringify(result, null, 2));

  const show = (name, tb) => {
    console.log(`\n${name}`);
    console.log("   N    n dates | RAW  mean  median %down  day-mean  t-day t-month | EXCESS mean median %down day-mean t-day t-month");
    const p = (v, w) => String(v ?? "").padStart(w);
    for (const N of HORIZONS) {
      const r = tb[N].raw, x = tb[N].excess;
      console.log(`  ${p(N, 2)} ${p(r.n, 4)} ${p(r.dates, 5)} | ${p(r.mean, 8)} ${p(r.median, 7)} ${p(r.down, 5)} ${p(r.dayMean, 9)} ${p(r.t, 6)} ${p(r.tMonth, 7)} | ${p(x.mean, 11)} ${p(x.median, 6)} ${p(x.down, 5)} ${p(x.dayMean, 8)} ${p(x.t, 5)} ${p(x.tMonth, 7)}`);
    }
  };
  console.log(`UP IN A DOWN TAPE  ${syms.length} names, ${result.coverage.first}..${result.coverage.last}. Forward % from the event close; a short makes minus "raw".`);
  console.log("Survivors only (today's list): every number leans UP, against the short.");
  show(`A. ${sets.downTape.label}`, result.downTape);
  show("A1. ...and it was an earnings reaction", result.downTapeEarnings);
  show("A2. ...and it was not an earnings reaction", result.downTapeNoEarnings);
  show("A3. ...excluding 2020", result.downTapeEx2020);
  show(`B. ${sets.upTape.label}`, result.upTape);
  show(`C. ${sets.any.label}`, result.any);
  console.log("\nA by year, 10-session raw:");
  for (const [y, s] of Object.entries(result.byYear)) console.log(`  ${y}  n ${String(s.n).padStart(3)}  mean ${String(s.mean ?? "").padStart(7)}  % down ${s.down ?? ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
