#!/usr/bin/env node
// earnings-runup.mjs — when does a stock start pricing in its earnings?
//
//   node scripts/earnings-runup.mjs                         full universe (db/prepump/universe-core.json)
//   node scripts/earnings-runup.mjs --symbols MU,NVDA       just these
//   node scripts/earnings-runup.mjs --limit 50              first N of the universe (smoke test)
//   node scripts/earnings-runup.mjs --out docs/research/x.json   write the full result
//   node scripts/earnings-runup.mjs --cache <dir>           where raw downloads live (default .cache/earnings-runup)
//
// WHY THIS EXISTS (2026-10-11)
// ----------------------------
// MRNA ran 158 -> 225 into a dated data event the board already carried, and the
// desk had no rule for HOW FAR AHEAD a plan has to exist. Adam: "How much time do
// we need to make plans? a month 2 months. Look into earnings plays with data and
// see when they most commonly start getting priced in." This is that data.
//
// METHOD (event study, all free primary sources)
//   - Event dates: SEC 8-K filings carrying Item 2.02 (Results of Operations).
//     acceptanceDateTime gives the time (EDGAR stamps it in US Eastern despite the
//     trailing Z). At or after 16:00 ET the reaction day is the NEXT session; before
//     16:00 it is the filing day. Events within 40 sessions after a kept event are
//     dropped (pre-announcements, amendments), so each quarter counts once.
//   - Prices: Yahoo daily OHLCV, split- and dividend-adjusted closes.
//   - Abnormal return: stock return minus (alpha + beta x SPY return), the market
//     model estimated on sessions -250..-70 before the event, so neither a
//     high-beta name in an up tape nor a stock that simply always wins (the
//     universe is today's list, so survivors dominate) reads as "run-up".
//   - Significance is clustered by calendar quarter (earnings seasons put hundreds
//     of names on the same weeks, so events are NOT independent). t = mean of the
//     quarter means / their standard error.
//
// A base rate is a count of the past, never a buy signal (v28 QUANT EVIDENCE).
// Zero-dep. Read-only on the book. Writes only the cache and --out.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TheBench-research/1.0 (contact: steamercook@yahoo.com)";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

const PRE = 60, POST = 10, EST_FROM = 250, EST_TO = 70, SPACING = 40;

// ---------- downloads (cached) ----------
async function cached(file, fetcher) {
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const data = await fetcher();
  writeFileSync(file, JSON.stringify(data));
  return data;
}

async function getJson(url, ua) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": ua } });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    await sleep(1500 * (attempt + 1));
  }
  return null;
}

// ---------- pure parts (exported for tests) ----------

// EDGAR submissions JSON -> [{date, hour}] for 8-K Item 2.02, oldest first.
export function earningsFilings(subs) {
  const r = subs?.filings?.recent;
  if (!r?.form) return [];
  const out = [];
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] !== "8-K") continue;
    if (!String(r.items?.[i] ?? "").split(",").map((s) => s.trim()).includes("2.02")) continue;
    const t = String(r.acceptanceDateTime?.[i] ?? "");
    const hour = t.length >= 16 ? Number(t.slice(11, 13)) + Number(t.slice(14, 16)) / 60 : 12;
    out.push({ date: r.filingDate[i], hour });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Yahoo chart JSON -> [{date, close, volume}] using adjusted closes.
export function yahooBars(json) {
  const res = json?.chart?.result?.[0];
  const ts = res?.timestamp, q = res?.indicators?.quote?.[0];
  const adj = res?.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(ts) || !q) return [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const c = adj?.[i] ?? q.close?.[i];
    if (typeof c !== "number" || !(c > 0)) continue;
    bars.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c, volume: q.volume?.[i] ?? null });
  }
  return bars;
}

// Index of the first session that can react to a filing.
export function reactionIndex(bars, filing) {
  let i = bars.findIndex((b) => b.date >= filing.date);
  if (i < 0) return -1;
  if (bars[i].date === filing.date && filing.hour >= 16) i += 1;
  return i < bars.length ? i : -1;
}

// Market model on the estimation window: r = alpha + beta * m. alpha soaks up a
// name's ordinary drift, so a stock that beats SPY every week (today's winners are
// the universe, so there are many) does not read as an earnings run-up.
function marketModel(xs, ys) {
  const n = xs.length; if (n < 60) return { alpha: 0, beta: 1 };
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0;
  for (let i = 0; i < n; i++) { cov += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; }
  const beta = vx > 0 ? cov / vx : 1;
  return { alpha: my - beta * mx, beta };
}

// One event -> abnormal returns ar[k] for k = -PRE..POST, volume ratios, or null.
export function eventWindow(bars, spyByDate, d0) {
  if (d0 - EST_FROM - 1 < 0 || d0 + POST >= bars.length) return null;
  const ret = (i) => bars[i].close / bars[i - 1].close - 1;
  const mret = (i) => {
    const a = spyByDate.get(bars[i].date), b = spyByDate.get(bars[i - 1].date);
    return a && b ? a / b - 1 : null;
  };
  const xs = [], ys = [];
  for (let i = d0 - EST_FROM; i <= d0 - EST_TO; i++) {
    const m = mret(i); if (m === null) continue;
    xs.push(m); ys.push(ret(i));
  }
  const { alpha, beta: b } = marketModel(xs, ys);
  const vols = [];
  for (let i = d0 - 120; i <= d0 - 61; i++) if (bars[i].volume > 0) vols.push(bars[i].volume);
  vols.sort((a, c) => a - c);
  const vbase = vols.length > 20 ? vols[Math.floor(vols.length / 2)] : null;
  const ar = {}, arb = {}, vr = {}, raw = {};
  for (let k = -PRE; k <= POST; k++) {
    const i = d0 + k, m = mret(i);
    if (m === null) return null;
    raw[k] = ret(i);
    arb[k] = raw[k] - b * m;
    ar[k] = arb[k] - alpha;
    vr[k] = vbase && bars[i].volume > 0 ? bars[i].volume / vbase : null;
  }
  return { alpha, beta: b, ar, arb, raw, vr };
}

const sum = (ar, a, b) => { let s = 0; for (let k = a; k <= b; k++) s += ar[k]; return s; };

// Pooled mean, median, win rate and a quarter-clustered t for one per-event stat.
export function clustered(values) {
  const v = values.filter((x) => x && Number.isFinite(x.x));
  if (!v.length) return null;
  const xs = v.map((e) => e.x).sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const groups = new Map();
  for (const e of v) { const g = groups.get(e.q) || []; g.push(e.x); groups.set(e.q, g); }
  const qm = [...groups.values()].filter((g) => g.length >= 5).map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const C = qm.length, qmean = C ? qm.reduce((a, b) => a + b, 0) / C : NaN;
  const sd = C > 1 ? Math.sqrt(qm.reduce((a, b) => a + (b - qmean) ** 2, 0) / (C - 1)) : NaN;
  return {
    n: xs.length, quarters: C,
    mean: +(mean * 100).toFixed(3), median: +(xs[Math.floor(xs.length / 2)] * 100).toFixed(3),
    win: +(xs.filter((x) => x > 0).length / xs.length * 100).toFixed(1),
    t: C > 1 ? +(qmean / (sd / Math.sqrt(C))).toFixed(2) : null,
    qPos: C ? +(qm.filter((m) => m > 0).length / C * 100).toFixed(0) : null
  };
}

const quarterOf = (d) => `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

// ---------- run ----------
async function main() {
  const cache = resolve(ROOT, arg("cache", ".cache/earnings-runup"));
  mkdirSync(join(cache, "edgar"), { recursive: true });
  mkdirSync(join(cache, "yahoo"), { recursive: true });

  const uniFile = JSON.parse(readFileSync(join(ROOT, "db/prepump/universe-core.json"), "utf8"));
  const uni = Array.isArray(uniFile) ? uniFile : uniFile.symbols;
  const meta = new Map(uni.map((u) => [u.symbol, u]));
  let symbols = arg("symbols") ? arg("symbols").split(",").map((s) => s.trim().toUpperCase()) : uni.map((u) => u.symbol);
  if (arg("limit")) symbols = symbols.slice(0, Number(arg("limit")));

  const tick = await cached(join(cache, "company_tickers.json"), () => getJson("https://www.sec.gov/files/company_tickers.json", UA));
  const cikOf = new Map(Object.values(tick).map((t) => [t.ticker.toUpperCase(), String(t.cik_str).padStart(10, "0")]));

  const yahoo = async (sym) => cached(join(cache, "yahoo", `${sym}.json`), async () => {
    await sleep(250);
    const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1d&events=div%2Csplit`, BROWSER_UA);
    return yahooBars(j);
  });

  const spy = await yahoo("SPY");
  const spyByDate = new Map(spy.map((b) => [b.date, b.close]));

  const events = [];
  const skipped = { noCik: [], noFilings: [], noBars: [] };
  let done = 0;
  for (const sym of symbols) {
    done++;
    if (done % 50 === 0) process.stderr.write(`  ${done}/${symbols.length}\n`);
    const cik = cikOf.get(sym.replace(".", "-")) || cikOf.get(sym);
    if (!cik) { skipped.noCik.push(sym); continue; }
    const subs = await cached(join(cache, "edgar", `${cik}.json`), async () => { await sleep(150); return getJson(`https://data.sec.gov/submissions/CIK${cik}.json`, UA); });
    const filings = earningsFilings(subs);
    if (!filings.length) { skipped.noFilings.push(sym); continue; }
    const bars = await yahoo(sym);
    if (bars.length < 400) { skipped.noBars.push(sym); continue; }
    let lastKept = -Infinity;
    for (const f of filings) {
      const d0 = reactionIndex(bars, f);
      if (d0 < 0 || d0 - lastKept < SPACING) continue;
      lastKept = d0;
      const w = eventWindow(bars, spyByDate, d0);
      if (!w) continue;
      const m = meta.get(sym) || {};
      events.push({ sym, date: bars[d0].date, q: quarterOf(bars[d0].date), band: m.band || "?", sector: m.sector || "?", ...w });
    }
  }

  // 1. The day-by-day profile: mean abnormal return, cumulative from -60, volume, attention.
  const profile = [];
  let cum = 0;
  for (let k = -PRE; k <= POST; k++) {
    const s = clustered(events.map((e) => ({ x: e.ar[k], q: e.q })));
    cum += s.mean;
    const vols = events.map((e) => e.vr[k]).filter((v) => v > 0).sort((a, b) => a - b);
    const absAr = events.reduce((a, e) => a + Math.abs(e.ar[k]), 0) / events.length * 100;
    profile.push({ k, meanAR: s.mean, t: s.t, cumAR: +cum.toFixed(3), medVolRatio: +vols[Math.floor(vols.length / 2)].toFixed(3), meanAbsAR: +absAr.toFixed(3) });
  }

  // 2. The trade: buy the close of day -N-1, sell the close of day -1 (out before the print),
  //    vs. buy the same day and hold through to the close of day +1.
  const entries = [60, 40, 30, 20, 15, 10, 5, 3];
  const runIntoPrint = entries.map((N) => ({ N, ...clustered(events.map((e) => ({ x: sum(e.ar, -N, -1), q: e.q }))) }));
  const runIntoPrintRaw = entries.map((N) => ({ N, ...clustered(events.map((e) => ({ x: e.raw ? Object.keys(e.raw).filter((k) => k >= -N && k <= -1).reduce((p, k) => p * (1 + e.raw[k]), 1) - 1 : NaN, q: e.q }))) }));
  const runIntoPrintBetaOnly = entries.map((N) => ({ N, ...clustered(events.map((e) => ({ x: sum(e.arb, -N, -1), q: e.q }))) }));
  const holdThrough = entries.map((N) => ({ N, ...clustered(events.map((e) => ({ x: sum(e.ar, -N, 1), q: e.q }))) }));
  const reaction = clustered(events.map((e) => ({ x: e.ar[0], q: e.q })));
  const absReaction = clustered(events.map((e) => ({ x: Math.abs(e.ar[0]), q: e.q })));

  // 3. Sell the news: does a big run-up into the print predict the reaction?
  const withRun = events.map((e) => ({ e, run: sum(e.ar, -20, -1) })).sort((a, b) => a.run - b.run);
  const quint = [0, 1, 2, 3, 4].map((qi) => {
    const slice = withRun.slice(Math.floor(qi * withRun.length / 5), Math.floor((qi + 1) * withRun.length / 5));
    return {
      quintile: qi + 1,
      runUpRange: `${(slice[0].run * 100).toFixed(1)}% to ${(slice[slice.length - 1].run * 100).toFixed(1)}%`,
      day0: clustered(slice.map(({ e }) => ({ x: e.ar[0], q: e.q }))),
      next5: clustered(slice.map(({ e }) => ({ x: sum(e.ar, 0, 5), q: e.q })))
    };
  });

  // 4. Stability: the 20-session run-into-print by size band, by sector and by year.
  const by = (keyFn) => {
    const g = new Map();
    for (const e of events) { const k = keyFn(e); (g.get(k) || g.set(k, []).get(k)).push(e); }
    return [...g.entries()].sort().map(([k, es]) => ({
      key: k,
      run20: clustered(es.map((e) => ({ x: sum(e.ar, -20, -1), q: e.q }))),
      run10: clustered(es.map((e) => ({ x: sum(e.ar, -10, -1), q: e.q }))),
      absDay0: clustered(es.map((e) => ({ x: Math.abs(e.ar[0]), q: e.q })))
    }));
  };

  const result = {
    asof: new Date().toISOString().slice(0, 10),
    method: "SEC 8-K Item 2.02 dates; Yahoo adjusted daily closes; abnormal return = r - (alpha + beta*SPY), market model on -250..-70; t clustered by calendar quarter",
    coverage: { symbolsAsked: symbols.length, events: events.length, symbolsUsed: new Set(events.map((e) => e.sym)).size, firstEvent: events.map((e) => e.date).sort()[0], lastEvent: events.map((e) => e.date).sort().at(-1), skipped: Object.fromEntries(Object.entries(skipped).map(([k, v]) => [k, v.length])), skippedSymbols: skipped },
    reaction, absReaction, runIntoPrint, runIntoPrintBetaOnly, runIntoPrintRaw, holdThrough, sellTheNews: quint,
    byBand: by((e) => e.band), bySector: by((e) => e.sector), byYear: by((e) => e.date.slice(0, 4)),
    profile
  };

  if (arg("out")) writeFileSync(resolve(ROOT, arg("out")), JSON.stringify(result, null, 2));
  const c = result.coverage;
  console.log(`EARNINGS RUN-UP STUDY  ${c.events} events, ${c.symbolsUsed} names, ${c.firstEvent}..${c.lastEvent}  (skipped: ${JSON.stringify(c.skipped)})`);
  console.log(`reaction day: mean AR ${reaction.mean}%  |AR| ${absReaction.mean}%`);
  console.log("\nBUY day -N, SELL close day -1 (abnormal %)      N   mean  median  win%  t   qtrs+%");
  for (const r of runIntoPrint) console.log(`  ${String(r.N).padStart(3)}  ${String(r.mean).padStart(7)} ${String(r.median).padStart(7)} ${String(r.win).padStart(5)} ${String(r.t).padStart(5)} ${String(r.qPos).padStart(5)}`);
  console.log("\nHOLD THROUGH to close +1:");
  for (const r of holdThrough) console.log(`  ${String(r.N).padStart(3)}  ${String(r.mean).padStart(7)} ${String(r.median).padStart(7)} ${String(r.win).padStart(5)} ${String(r.t).padStart(5)}`);
  console.log("\nSELL THE NEWS (quintile of 20-day run-up -> day-0 AR, days 0..5 AR):");
  for (const q of quint) console.log(`  Q${q.quintile} ${q.runUpRange.padEnd(20)} day0 ${q.day0.mean}% (t ${q.day0.t})   0..5 ${q.next5.mean}% (t ${q.next5.t})`);
  console.log("\nPROFILE  k  meanAR  t   cumAR  volRatio |AR|");
  for (const p of profile) if (p.k % 5 === 0 || p.k > -6) console.log(`  ${String(p.k).padStart(4)} ${String(p.meanAR).padStart(7)} ${String(p.t).padStart(5)} ${String(p.cumAR).padStart(7)} ${String(p.medVolRatio).padStart(6)} ${String(p.meanAbsAR).padStart(6)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
