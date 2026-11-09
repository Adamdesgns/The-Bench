// Read-only hypothesis screen, from the AMZN 10/30 miss.
// RULE, fixed before looking at any result:
//   Earnings reaction day. Open gaps down 3%+ from the prior close. The day closes 2%+ above its open
//   and in the upper half of its range. The name trails SPY on both the 20- and 60-session windows.
//   Buy the close. Stop = the lower of just under that day's low and 1.0 ATR below entry.
//   Target = 2R. Stop checked first. Out at the close of session 20.
// Daily bars stand in for the first-30-minute bar; there is no 10-year intraday history.
// The universe is today's names, so every group leans rosy: read the RULE against its controls.
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OHLC = '.cache/earnings-reclaim';
mkdirSync(OHLC, { recursive: true });
const CACHE = '.cache/earnings-runup';
const sleep = (m) => new Promise((r) => setTimeout(r, m));

const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const nyTime = (stamp) => {
  const t = new Date(String(stamp ?? ''));
  if (Number.isNaN(t.getTime())) return null;
  const p = Object.fromEntries(NY.formatToParts(t).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) + Number(p.minute) / 60 };
};
const earningsFilings = (subs) => {
  const r = subs?.filings?.recent;
  if (!r?.form) return [];
  const out = [];
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] !== '8-K') continue;
    if (!String(r.items?.[i] ?? '').split(',').map((s) => s.trim()).includes('2.02')) continue;
    out.push(nyTime(r.acceptanceDateTime?.[i]) ?? { date: r.filingDate[i], hour: 12 });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
};
const reactionIndex = (bars, f) => {
  let i = bars.findIndex((b) => b.d >= f.date);
  if (i < 0) return -1;
  if (bars[i].d === f.date && f.hour >= 16) i += 1;
  return i < bars.length ? i : -1;
};
const load = async (sym) => {
  const file = join(OHLC, `${sym}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.ok) {
        const c = (await r.json()).chart.result[0], q = c.indicators.quote[0];
        const bars = c.timestamp.map((s, i) => ({ d: new Date(s * 1000).toISOString().slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter((x) => x.o > 0 && x.h > 0 && x.l > 0 && x.c > 0);
        writeFileSync(file, JSON.stringify(bars));
        return bars;
      }
    } catch (e) { /* retry */ }
    await sleep(800 * (t + 1));
  }
  return null;
};

const syms = readdirSync(join(CACHE, 'yahoo')).map((n) => n.replace('.json', '')).filter((s) => s !== 'SPY');
const tick = JSON.parse(readFileSync(join(CACHE, 'company_tickers.json'), 'utf8'));
const cikOf = new Map(Object.values(tick).map((t) => [t.ticker.toUpperCase(), String(t.cik_str).padStart(10, '0')]));
const spy = await load('SPY');
const spyIdx = new Map(spy.map((b, i) => [b.d, i]));

const atrAt = (B, i) => { let s = 0, n = 0; for (let k = Math.max(1, i - 13); k <= i; k++) { s += Math.max(B[k].h - B[k].l, Math.abs(B[k].h - B[k - 1].c), Math.abs(B[k].l - B[k - 1].c)); n++; } return s / n; };
const quarterOf = (d) => `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

const eventOf = (sym, B, d0) => {
  if (d0 < 61 || d0 + 20 >= B.length) return null;
  const s0 = spyIdx.get(B[d0].d);
  if (s0 === undefined || s0 < 60) return null;
  const sp20 = spy[s0].c / spy[s0 - 20].c - 1, sp60 = spy[s0].c / spy[s0 - 60].c - 1;
  const rs20 = B[d0].c / B[d0 - 20].c - 1 - sp20, rs60 = B[d0].c / B[d0 - 60].c - 1 - sp60;
  const day = B[d0], gap = day.o / B[d0 - 1].c - 1, up = day.c / day.o - 1;
  const rangePos = day.h > day.l ? (day.c - day.l) / (day.h - day.l) : 0.5;
  const entry = day.c, atr = atrAt(B, d0), stop = Math.min(day.l * 0.999, entry - atr), risk = entry - stop, target = entry + 2 * risk;
  if (!(risk > 0) || gap < -0.45) return null;
  let R = null, how = 'time';
  for (let k = d0 + 1; k <= d0 + 20; k++) {
    const b = B[k];
    if (b.o <= stop) { R = (b.o - entry) / risk; how = 'stop'; break; }
    if (b.l <= stop) { R = -1; how = 'stop'; break; }
    if (b.o >= target) { R = (b.o - entry) / risk; how = 'target'; break; }
    if (b.h >= target) { R = 2; how = 'target'; break; }
  }
  if (R === null) R = (B[d0 + 20].c - entry) / risk;
  const ex = (H) => { const se = spyIdx.get(B[d0 + H].d); return se === undefined ? NaN : B[d0 + H].c / entry - 1 - (spy[se].c / spy[s0].c - 1); };
  const has60 = d0 + 60 < B.length;
  let dd60 = NaN;
  if (has60) { let lo = Infinity; for (let k = d0 + 1; k <= d0 + 60; k++) lo = Math.min(lo, B[k].l); dd60 = lo / entry - 1; }
  return { sym, date: day.d, q: quarterOf(day.d), gap, up, rangePos, rs20, rs60, R, how, ex5: ex(5), ex10: ex(10), ex20: ex(20), ex60: has60 ? ex(60) : NaN, ret60: has60 ? B[d0 + 60].c / entry - 1 : NaN, dd60 };
};

const events = [];
let idx = 0, noBars = 0, loaded = 0;
await Promise.all(Array.from({ length: 5 }, async () => {
  while (idx < syms.length) {
    const sym = syms[idx++];
    const cik = cikOf.get(sym.replace('.', '-')) || cikOf.get(sym);
    if (!cik || !existsSync(join(CACHE, 'edgar', `${cik}.json`))) continue;
    const B = await load(sym);
    if (!B || B.length < 400) { noBars++; continue; }
    loaded++;
    if (loaded % 100 === 0) process.stderr.write(`loaded ${loaded}\n`);
    const fs = earningsFilings(JSON.parse(readFileSync(join(CACHE, 'edgar', `${cik}.json`), 'utf8')));
    let last = -Infinity;
    for (const f of fs) {
      const d0 = reactionIndex(B, f);
      if (d0 < 0 || d0 - last < 40) continue;
      last = d0;
      const e = eventOf(sym, B, d0);
      if (e) events.push(e);
    }
    await sleep(60);
  }
}));
console.log('names loaded', loaded, 'no bars', noBars, 'events', events.length, 'first', events.map((e) => e.date).sort()[0], 'last', events.map((e) => e.date).sort().at(-1));

const summary = (label, list, key, scale = 1) => {
  const xs = list.map((e) => e[key]).filter(Number.isFinite);
  if (!xs.length) return `${label} ${key} n=0`;
  const sorted = xs.slice().sort((a, b) => a - b), mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const g = new Map();
  for (const e of list) if (Number.isFinite(e[key])) (g.get(e.q) || g.set(e.q, []).get(e.q)).push(e[key]);
  const qm = [...g.values()].filter((v) => v.length >= 3).map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  const qmean = qm.reduce((a, b) => a + b, 0) / (qm.length || 1);
  const sd = qm.length > 1 ? Math.sqrt(qm.reduce((a, b) => a + (b - qmean) ** 2, 0) / (qm.length - 1)) : NaN;
  const t = qm.length > 1 ? qmean / (sd / Math.sqrt(qm.length)) : NaN;
  return `${key}: mean ${(mean * scale).toFixed(2)} median ${(sorted[Math.floor(sorted.length / 2)] * scale).toFixed(2)} win% ${((100 * xs.filter((x) => x > 0).length) / xs.length).toFixed(1)} t(q) ${t.toFixed(2)} qtrs ${qm.length}`;
};
const show = (label, list) => {
  const n = list.length;
  console.log(`\n${label}  n=${n}`);
  if (!n) return;
  console.log('  ' + summary(label, list, 'R'));
  console.log('  hit target%', ((100 * list.filter((e) => e.how === 'target').length) / n).toFixed(1), 'stopped%', ((100 * list.filter((e) => e.how === 'stop').length) / n).toFixed(1), 'time%', ((100 * list.filter((e) => e.how === 'time').length) / n).toFixed(1));
  for (const k of ['ex5', 'ex10', 'ex20']) console.log('  ' + summary(label, list, k, 100));
};

const gap3 = (e) => e.gap <= -0.03;
const reclaim = (e) => e.up >= 0.02 && e.rangePos >= 0.5;
const trailing = (e) => e.rs20 < 0 && e.rs60 < 0;
const RULE = events.filter((e) => gap3(e) && reclaim(e) && trailing(e));

show('RULE: gap down 3%+, bought back, trailing SPY on both windows', RULE);
show('CONTROL: same gap and reclaim, NOT trailing on both', events.filter((e) => gap3(e) && reclaim(e) && !trailing(e)));
show('CONTROL: same gap, trailing on both, closed under its open', events.filter((e) => gap3(e) && e.up < 0 && trailing(e)));
show('CONTROL: every gap down 3%+', events.filter(gap3));
show('CONTROL: every earnings reaction day', events);
show('RULE, 2017-2021', RULE.filter((e) => e.date < '2022-01-01'));
show('RULE, 2022 onward', RULE.filter((e) => e.date >= '2022-01-01'));

const uni = JSON.parse(readFileSync('db/prepump/universe-core.json', 'utf8'));
const bandOf = new Map((Array.isArray(uni) ? uni : uni.symbols).map((u) => [u.symbol, u.band]));
for (const b of [...new Set(events.map((e) => bandOf.get(e.sym)))].sort()) {
  show(`SIZE SLICE (chosen after the first look) band ${b}: RULE`, RULE.filter((e) => bandOf.get(e.sym) === b));
  show(`SIZE SLICE band ${b}: every gap down 3%+`, events.filter((e) => gap3(e) && bandOf.get(e.sym) === b));
}
const mega = new Set(['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'AVGO', 'ORCL', 'NFLX', 'AMD', 'CRM', 'ADBE', 'COST', 'WMT', 'JPM', 'V', 'MA']);
const megaRule = RULE.filter((e) => mega.has(e.sym));
show('MEGA CAPS ONLY (list chosen after the first look): RULE', megaRule);
for (const e of megaRule.slice().sort((x, y) => (x.date < y.date ? 1 : -1))) console.log(' ', e.sym, e.date, 'gap', (e.gap * 100).toFixed(1), 'up', (e.up * 100).toFixed(1), 'R', e.R.toFixed(2), e.how, 'ex10', (e.ex10 * 100).toFixed(1));

console.log('\n=== STACK TEST: buy the close, no stop, hold 60 sessions (test added after the first look) ===');
const stack = (label, list) => {
  const n = list.filter((e) => Number.isFinite(e.ret60)).length;
  console.log(`\n${label}  n=${n}`);
  for (const k of ['ret60', 'ex60']) console.log('  ' + summary(label, list, k, 100));
  const dd = list.map((e) => e.dd60).filter(Number.isFinite).sort((a, b) => a - b);
  if (dd.length) console.log('  worst dip inside the hold: median', (dd[Math.floor(dd.length / 2)] * 100).toFixed(1) + '%', 'worst tenth', (dd[Math.floor(dd.length / 10)] * 100).toFixed(1) + '%');
};
for (const b of ['MEGA', 'LARGE']) {
  stack(`${b}: every gap down 3%+ on a print`, events.filter((e) => gap3(e) && bandOf.get(e.sym) === b));
  stack(`${b}: gap down 3%+, bought back the same day`, events.filter((e) => gap3(e) && reclaim(e) && bandOf.get(e.sym) === b));
  stack(`${b}: every earnings reaction day (baseline)`, events.filter((e) => bandOf.get(e.sym) === b));
}

const B = await load('AMZN');
const a = eventOf('AMZN', B.slice(0).concat(Array.from({ length: 25 }, () => B.at(-1))), B.findIndex((x) => x.d === '2026-10-30'));
console.log('\nAMZN 10/30 template: gap', (a.gap * 100).toFixed(2), 'up', (a.up * 100).toFixed(2), 'rangePos', a.rangePos.toFixed(2), 'rs20', (a.rs20 * 100).toFixed(2), 'rs60', (a.rs60 * 100).toFixed(2), 'qualifies', gap3(a) && reclaim(a) && trailing(a));
console.log('Most recent RULE hits:');
for (const e of RULE.slice().sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 12)) console.log(' ', e.sym, e.date, 'gap', (e.gap * 100).toFixed(1), 'up', (e.up * 100).toFixed(1), 'R', e.R.toFixed(2), e.how);
