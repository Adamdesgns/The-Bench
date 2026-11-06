// What did the US open do after (A) a KOSPI crash day and (B) a big QQQ down day?
// Zero-dep, Yahoo daily bars, range=max. Read-only research.
import fs from "node:fs";
const UA = { "User-Agent": "Mozilla/5.0" };
const CACHE = process.argv[2] || ".";
async function bars(sym) {
  const f = `${CACHE}/${sym.replace(/\W/g, "_")}.json`;
  let j;
  if (fs.existsSync(f)) j = JSON.parse(fs.readFileSync(f, "utf8"));
  else {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d`, { headers: UA });
    j = await r.json(); fs.writeFileSync(f, JSON.stringify(j));
  }
  const res = j.chart.result[0], q = res.indicators.quote[0], off = res.meta.gmtoffset || 0;
  const out = [];
  res.timestamp.forEach((t, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].some((v) => v == null || !(v > 0))) return;
    out.push({ d: new Date((t + off) * 1000).toISOString().slice(0, 10), o, h, l, c });
  });
  return out;
}
const pct = (a, b) => (a / b - 1) * 100;
const med = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const f1 = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
function summarize(label, rows, key) {
  const v = rows.map((r) => r[key]).filter((x) => Number.isFinite(x));
  const up = v.filter((x) => x > 0).length;
  console.log(`  ${label.padEnd(26)} n=${String(v.length).padStart(3)}  median ${f1(med(v)).padStart(7)}%  mean ${f1(avg(v)).padStart(7)}%  up ${up}/${v.length} (${Math.round((100 * up) / v.length)}%)  worst ${f1(Math.min(...v))}  best ${f1(Math.max(...v))}`);
}
// US session measures for the session at index i (gap vs prior close, open->close, close->close, 5-day)
function usSession(arr, i) {
  const p = arr[i - 1], s = arr[i], s5 = arr[i + 4];
  return {
    date: s.d,
    gap: pct(s.o, p.c),
    o2c: pct(s.c, s.o),
    c2c: pct(s.c, p.c),
    lowFromOpen: pct(s.l, s.o),
    highFromOpen: pct(s.h, s.o),
    fill: s.o < p.c ? s.h >= p.c : s.l <= p.c, // did the gap fill intraday
    d5: s5 ? pct(s5.c, p.c) : NaN,
  };
}
const syms = ["^KS11", "SPY", "QQQ", "SMH", "EWY"];
const B = {};
for (const s of syms) B[s] = await bars(s);
const idx = {}; for (const s of syms) idx[s] = new Map(B[s].map((b, i) => [b.d, i]));
const firstUSOnOrAfter = (sym, d) => { const a = B[sym]; for (let i = 2; i < a.length; i++) if (a[i].d >= d) return a[i - 1].d < d ? i : -1; return -1; };

for (const s of syms) console.log(`${s}: ${B[s][0].d} .. ${B[s].at(-1).d} (${B[s].length} bars)`);

// ---------- A. KOSPI crash days ----------
function studyKospi(name, test) {
  const k = B["^KS11"], ev = [];
  for (let i = 1; i < k.length; i++) {
    const p = k[i - 1], b = k[i];
    if (!test(b, p)) continue;
    const row = { kd: b.d, kLow: pct(b.l, p.c), kClose: pct(b.c, p.c) };
    for (const u of ["SPY", "QQQ", "SMH", "EWY"]) {
      const j = firstUSOnOrAfter(u, b.d);
      if (j < 1) continue;
      const m = usSession(B[u], j);
      // what the US did the session BEFORE (what Korea was reacting to)
      m.prior = pct(B[u][j - 1].c, B[u][j - 2]?.c ?? NaN);
      row[u] = m;
    }
    ev.push(row);
  }
  console.log(`\n=== A. ${name}: ${ev.length} days ===`);
  for (const e of ev) {
    const s = e.SPY, q = e.QQQ;
    console.log(`${e.kd}  KOSPI low ${f1(e.kLow)}% close ${f1(e.kClose)}% | US prior day QQQ ${q ? f1(q.prior) : "  n/a"}% | SPY ${s ? s.date : "-"} gap ${s ? f1(s.gap) : "-"} o->c ${s ? f1(s.o2c) : "-"} day ${s ? f1(s.c2c) : "-"} 5d ${s && Number.isFinite(s.d5) ? f1(s.d5) : "-"} | QQQ gap ${q ? f1(q.gap) : "-"} o->c ${q ? f1(q.o2c) : "-"} day ${q ? f1(q.c2c) : "-"} fill ${q ? (q.fill ? "Y" : "N") : "-"}`);
  }
  for (const u of ["SPY", "QQQ", "SMH"]) {
    const rows = ev.map((e) => e[u]).filter(Boolean);
    console.log(` ${u}:`);
    summarize("gap at open", rows, "gap");
    summarize("open -> close", rows, "o2c");
    summarize("whole day (close/close)", rows, "c2c");
    summarize("5 sessions", rows, "d5");
    console.log(`  gap filled intraday: ${rows.filter((r) => r.fill).length}/${rows.length}`);
  }
  return ev;
}
studyKospi("KOSPI traded 8%+ under prior close (breaker-size)", (b, p) => pct(b.l, p.c) <= -8);
studyKospi("KOSPI closed 5%+ down", (b, p) => pct(b.c, p.c) <= -5);

// ---------- B. Big QQQ down days -> next US open ----------
function studyUS(sym, thr, minDate = "0000") {
  const a = B[sym], rows = [];
  for (let i = 2; i < a.length - 1; i++) {
    if (a[i].d < minDate) continue;
    const c = pct(a[i].c, a[i - 1].c);
    if (c > thr) continue;
    const m = usSession(a, i + 1); m.trig = a[i].d; m.drop = c; rows.push(m);
  }
  console.log(`\n=== B. Session after ${sym} closed ${thr}% or worse${minDate > "0" ? " since " + minDate : ""}: ${rows.length} ===`);
  summarize("gap at open", rows, "gap");
  summarize("open -> close", rows, "o2c");
  summarize("whole day (close/close)", rows, "c2c");
  summarize("5 sessions", rows, "d5");
  console.log(`  gap filled intraday: ${rows.filter((r) => r.fill).length}/${rows.length}`);
  console.log(`  gap UP: ${rows.filter((r) => r.gap > 0).length}  gap DOWN: ${rows.filter((r) => r.gap < 0).length}`);
  const gd = rows.filter((r) => r.gap < 0), gu = rows.filter((r) => r.gap > 0);
  if (gu.length) summarize("  if gapped UP: o->c", gu, "o2c");
  if (gd.length) summarize("  if gapped DOWN: o->c", gd, "o2c");
  return rows;
}
const q6 = studyUS("QQQ", -6);
for (const r of q6) console.log(`  ${r.trig} QQQ ${f1(r.drop)}% -> ${r.date} gap ${f1(r.gap)} o->c ${f1(r.o2c)} day ${f1(r.c2c)} 5d ${Number.isFinite(r.d5) ? f1(r.d5) : "-"}`);
studyUS("QQQ", -5);
studyUS("QQQ", -5, "2010-01-01");
const s10 = studyUS("SMH", -10);
for (const r of s10) console.log(`  ${r.trig} SMH ${f1(r.drop)}% -> ${r.date} gap ${f1(r.gap)} o->c ${f1(r.o2c)} day ${f1(r.c2c)} 5d ${Number.isFinite(r.d5) ? f1(r.d5) : "-"}`);
// baseline: every QQQ session
{
  const a = B.QQQ, rows = []; for (let i = 1; i < a.length - 5; i++) rows.push(usSession(a, i));
  console.log(`\n=== Baseline: every QQQ session ===`);
  summarize("gap at open", rows, "gap"); summarize("open -> close", rows, "o2c"); summarize("whole day", rows, "c2c");
}
