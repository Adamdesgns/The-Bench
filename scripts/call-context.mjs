#!/usr/bin/env node
// call-context.mjs — what the world looked like when each call was made, winners AND losers.
//
//   node scripts/call-context.mjs backfill [--limit N] [--ids B-1,B-2] [--no-news] [--write]
//   node scripts/call-context.mjs capture [--date YYYY-MM-DD] [--write]   rows from the last 5 days live (with social), plus any row missing or failed
//   node scripts/call-context.mjs backfill --rebuild --write                re-record every row (keeps any live social snapshot)
//   node scripts/call-context.mjs outcomes [--write]                       refresh verdicts from the book
//   node scripts/call-context.mjs report [--type long|pass|conditional|...] [--min 8]
//   node scripts/call-context.mjs show B-1188
//
// WHY THIS EXISTS (2026-10-30)
// ----------------------------
// Adam: "we need a file of your calls that were right and more than the standard ledger.
// Market, sentiment, social media, news, etc ... let's record them and find some patterns later",
// then "then we need losers recorded too". The book (db/archive.json) records the call and its
// score. This file records the CONDITIONS around it, for every scored call, right, wrong and
// flat, under the same fields, so a pattern among winners can be checked against the losers.
//
// WHAT IS RECORDED (db/call-context.json, one record per book row, keyed by row id)
//   market     SPY/QQQ/IWM/SMH returns and trend, VIX level, VIX vs VIX3M (term structure)
//   sentiment  CNN Fear & Greed (score and rating), VIX band
//   ticker     1/5/20-session returns, vs 50/200-day, distance to 52-week high, ATR %, volume
//              ratio, 20/60-session relative strength vs SPY
//   calendar   weekday, sessions since the last earnings reaction, sessions to the next one
//              (backfill knows it in hindsight; flagged), 8-K items filed in the 5 days before
//   news       Google News headlines for the ticker, the 3 days before the call through the call day
//   social     Stocktwits watchers and the bull/bear tags on the last 30 messages, ApeWisdom
//              (Reddit) rank and mentions. LIVE ONLY: neither source has history, so a backfilled
//              row says social: null with that reason instead of a guess.
//   outcome    the book's own verdict, the most advanced right/wrong/flat checkpoint (the
//              scorecard's recommended headline), refreshed every run; every checkpoint kept.
//
// NO LOOK-AHEAD: every price, VIX and Fear & Greed field is AS OF THE PRIOR SESSION'S CLOSE
// (the last bar dated before the call date). The call day's own move is kept apart under
// same_day and is marked as possibly after the call. News includes the call day, flagged.
//
// A pattern found here is a hypothesis for a forward test, never a rule by itself (v28).
// Read-only on the book. Writes only db/call-context.json (with --write) and .cache/call-context.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { earningsFilings, nyTime } from "./earnings-runup.mjs";
import { isShadow } from "../server/scorecardStats.js";
import { nyDate } from "../server/nyDate.js";

const ROOT = process.env.BENCH_ROOT ? resolve(process.env.BENCH_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(ROOT, "db/call-context.json");
// v2 (2026-10-30): v1 cached failures and dated Fear & Greed and coin bars a day early; never read it.
const CACHE = join(ROOT, ".cache/call-context-v2");
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SEC_UA = "TheBench-research/1.0 (contact: steamercook@yahoo.com)";
const NOT_INSTRUMENTS = new Set(["BOOK", "CASH", "PORTFOLIO", "MARKET", ""]);
const HORIZON_ORDER = ["3m", "1m", "1w"];
const REAL = new Set(["right", "wrong", "flat"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bare coin tickers in the book (B-011..B-018, B-481..B-500) are coins, not the US listings with the
// same letters: Yahoo BTC and ETH are Grayscale funds, TRX is TRX Gold. VIX in the book is the index.
const COINS = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "bnb", XRP: "xrp", DOGE: "dogecoin", TRX: "tron", ADA: "cardano", AVAX: "avalanche", LINK: "chainlink", HYPE: "hyperliquid", XLM: "stellar", ZEC: "zcash" };
// Yahoo symbols that are not <COIN>-USD (checked 2026-10-30: HYPE-USD does not exist, HYPE32196-USD is Hyperliquid).
const YAHOO_COIN = { HYPE: "HYPE32196-USD" };
export function instrument(ticker) {
  const t = String(ticker ?? "").toUpperCase().trim();
  const coin = t.endsWith("-USD") ? t.slice(0, -4) : COINS[t] ? t : null;
  if (coin) return { sym: YAHOO_COIN[coin] ?? `${coin}-USD`, kind: "crypto", news: COINS[coin] ?? coin.toLowerCase(), coin };
  if (t === "VIX") return { sym: "^VIX", kind: "index", news: "VIX volatility index" };
  return { sym: t, kind: "stock", news: `${t} stock` };
}
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const pct = (a, b) => (a > 0 && b > 0 ? r2((a / b - 1) * 100) : null);

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

// ---------- pure parts (exported for tests) ----------

// The book's verdict for a row: the most advanced right/wrong/flat checkpoint, as the scorecard counts it.
export function outcomeOf(row) {
  const cp = row?.checkpoints ?? {};
  const h = HORIZON_ORDER.find((k) => cp[k] && REAL.has(cp[k].verdict));
  const all = Object.fromEntries(Object.entries(cp).filter(([, c]) => c).map(([k, c]) => [k, { verdict: c.verdict ?? null, asset_pct: c.asset_pct ?? null, bench_pct: c.bench_pct ?? null, alpha: c.alpha ?? null, note: c.note ?? null }]));
  return { result: h ? cp[h].verdict : null, horizon: h ?? null, alpha: h ? cp[h].alpha ?? null : null, asset_pct: h ? cp[h].asset_pct ?? null : null, note: h ? cp[h].note ?? null : null, checkpoints: all };
}

// Index of the last bar dated strictly before `date` (the prior session's close), or -1.
export function asOfIndex(bars, date) {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].date < date) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

const sma = (bars, i, n) => { if (i - n + 1 < 0) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += bars[k].close; return s / n; };
const ret = (bars, i, n) => (i - n >= 0 ? pct(bars[i].close, bars[i - n].close) : null);

// Price features at bar i (all known at that close).
export function featuresAt(bars, i) {
  if (i < 0) return null;
  const c = bars[i].close, s50 = sma(bars, i, 50), s200 = sma(bars, i, 200);
  let hi = -Infinity; for (let k = Math.max(0, i - 251); k <= i; k++) hi = Math.max(hi, bars[k].high ?? bars[k].close);
  let tr = 0, nTr = 0;
  for (let k = Math.max(1, i - 13); k <= i; k++) {
    const b = bars[k], p = bars[k - 1].close;
    if (b.high == null || b.low == null) continue;
    tr += Math.max(b.high - b.low, Math.abs(b.high - p), Math.abs(b.low - p)); nTr++;
  }
  const vols = []; for (let k = Math.max(0, i - 20); k < i; k++) if (bars[k].volume > 0) vols.push(bars[k].volume);
  const vavg = vols.length >= 10 ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
  return {
    asof: bars[i].date, close: r2(c),
    ret_1d: ret(bars, i, 1), ret_5d: ret(bars, i, 5), ret_20d: ret(bars, i, 20), ret_60d: ret(bars, i, 60),
    vs_sma50: s50 ? pct(c, s50) : null, vs_sma200: s200 ? pct(c, s200) : null,
    from_52w_high: Number.isFinite(hi) ? pct(c, hi) : null,
    atr_pct: nTr >= 10 ? r2(tr / nTr / c * 100) : null,
    vol_ratio: vavg && bars[i].volume > 0 ? r2(bars[i].volume / vavg) : null
  };
}

// Relative strength: the ticker's return minus SPY's over n sessions, both as of the same date.
export function relStrength(tf, sf) {
  if (!tf || !sf) return { rs_20: null, rs_60: null };
  const d = (a, b) => (a == null || b == null ? null : r2(a - b));
  return { rs_5: d(tf.ret_5d, sf.ret_5d), rs_20: d(tf.ret_20d, sf.ret_20d), rs_60: d(tf.ret_60d, sf.ret_60d) };
}

export const vixBand = (v) => (v == null ? null : v < 15 ? "calm (<15)" : v < 20 ? "normal (15-20)" : v < 30 ? "elevated (20-30)" : "stressed (30+)");

// Fear & Greed on the last day strictly before `date`.
export function fngBefore(series, date) {
  let best = null;
  for (const p of series) if (p.date < date && (!best || p.date > best.date)) best = p;
  return best ? { score: r2(best.score), rating: best.rating, asof: best.date } : null;
}

// Google News RSS -> [{title, source, published}].
export function parseRss(xml) {
  const out = [];
  const dec = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const t = m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const src = m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? null;
    const pd = m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? null;
    const when = pd ? nyTime(new Date(pd).toISOString()) : null;
    out.push({ title: dec(t), source: src ? dec(src) : null, published: when?.date ?? null });
  }
  return out;
}

// Earnings in sessions, both counted from the CALL DAY (index i+1, one after the as-of bar):
// a reaction the session before the call is 1 since; a reaction on the call day itself is 0 to go.
export function earningsDistance(bars, reactDates, date) {
  const i = asOfIndex(bars, date);
  const idx = (d) => { const k = bars.findIndex((b) => b.date >= d); return k < 0 ? null : k; };
  const past = reactDates.filter((d) => d < date).sort().at(-1) ?? null;
  const next = reactDates.filter((d) => d >= date).sort()[0] ?? null;
  const pi = past ? idx(past) : null, ni = next ? idx(next) : null;
  return {
    last_earnings: past, sessions_since_earnings: pi != null && i >= 0 ? i + 1 - pi : null,
    next_earnings: next, sessions_to_earnings: ni != null && i >= 0 ? ni - (i + 1) : null
  };
}

const MEDIAN = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

// The fields the report compares, as [label, getter].
export const REPORT_FIELDS = [
  ["SPY 5d %", (c) => c.market?.spy?.ret_5d], ["SPY vs 50d %", (c) => c.market?.spy?.vs_sma50],
  ["QQQ 5d %", (c) => c.market?.qqq?.ret_5d], ["SMH vs 200d %", (c) => c.market?.smh?.vs_sma200],
  ["VIX", (c) => c.market?.vix], ["VIX/VIX3M", (c) => c.market?.vix_term],
  ["Fear & Greed", (c) => c.sentiment?.fear_greed?.score],
  ["ticker 5d %", (c) => c.ticker?.ret_5d], ["ticker 20d %", (c) => c.ticker?.ret_20d],
  ["ticker vs 50d %", (c) => c.ticker?.vs_sma50], ["ticker vs 200d %", (c) => c.ticker?.vs_sma200],
  ["from 52w high %", (c) => c.ticker?.from_52w_high], ["ATR %", (c) => c.ticker?.atr_pct],
  ["volume ratio", (c) => c.ticker?.vol_ratio], ["RS 20 vs SPY", (c) => c.ticker?.rs_20], ["RS 60 vs SPY", (c) => c.ticker?.rs_60],
  ["call-day move %", (c) => c.same_day?.ticker_ret], ["sessions since earnings", (c) => c.calendar?.sessions_since_earnings],
  ["sessions to earnings", (c) => c.calendar?.sessions_to_earnings], ["headlines (3d)", (c) => c.news?.count]
];

// Per call type: right vs wrong medians for each field, then the win rate in each third of the field.
// Thirds split by RANK, not by value cut, so ties cannot empty a third. Market fields are shared by every
// call made the same day, and the book re-logs one name many times (UBER 14 rows in the week of 9/14, 8 of them longs), so each third
// counts its distinct dates and tickers and is hidden below 3 of either. Rows are not independent bets.
export function buildReport(records, { type = null, min = 8 } = {}) {
  type = type ? String(type).toLowerCase() : null;
  const scored = records.filter((r) => r.outcome?.result && r.context && (!type || r.call_type === type));
  const byType = new Map();
  for (const r of scored) (byType.get(r.call_type ?? "(none)") || byType.set(r.call_type ?? "(none)", []).get(r.call_type ?? "(none)")).push(r);
  const out = [];
  for (const [t, rs] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const right = rs.filter((r) => r.outcome.result === "right"), wrong = rs.filter((r) => r.outcome.result === "wrong");
    const fields = [];
    for (const [label, get] of REPORT_FIELDS) {
      const vals = rs.map((r) => ({ v: get(r.context), res: r.outcome.result, date: r.date, ticker: r.ticker })).filter((x) => Number.isFinite(x.v));
      if (vals.length < min) continue;
      vals.sort((a, b) => a.v - b.v || String(a.date).localeCompare(String(b.date)));
      const k1 = Math.floor(vals.length / 3), k2 = Math.floor(2 * vals.length / 3);
      const third = (g) => {
        const dates = new Set(g.map((x) => x.date)).size, tickers = new Set(g.map((x) => x.ticker)).size;
        return { n: g.length, dates, tickers, lo: r2(g[0]?.v), hi: r2(g.at(-1)?.v), win: g.length >= min && dates >= 3 && tickers >= 3 ? r2(g.filter((x) => x.res === "right").length / g.length * 100) : null };
      };
      fields.push({
        label, n: vals.length,
        right_median: r2(MEDIAN(right.map((r) => get(r.context)))), wrong_median: r2(MEDIAN(wrong.map((r) => get(r.context)))),
        thirds: [third(vals.slice(0, k1)), third(vals.slice(k1, k2)), third(vals.slice(k2))]
      });
    }
    out.push({ call_type: t, n: rs.length, right: right.length, wrong: wrong.length, flat: rs.length - right.length - wrong.length, fields });
  }
  return out;
}

// ---------- fetchers (cached) ----------

async function getText(url, headers = {}) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, ...headers } });
      if (res.ok) return { ok: true, text: await res.text() };
      if (res.status === 404) return { ok: false, status: 404 };
      if (res.status === 429 || res.status === 503) { await sleep(5000 * (a + 1)); continue; }
      return { ok: false, status: res.status };
    } catch (e) { await sleep(1500 * (a + 1)); if (a === 2) return { ok: false, status: String(e.message || e) }; }
  }
  return { ok: false, status: "retries exhausted" };
}

function cacheFile(kind, key) { mkdirSync(join(CACHE, kind), { recursive: true }); return join(CACHE, kind, `${key.replace(/[^A-Za-z0-9._-]/g, "_")}.json`); }
const freshToday = (f) => existsSync(f) && nyDate(statSync(f).mtime) === nyDate();

const yahooSym = (t) => t.replace(/\./g, "-");
async function bars(sym) {
  const f = cacheFile("yahoo", sym);
  if (freshToday(f)) return JSON.parse(readFileSync(f, "utf8"));
  await sleep(250);
  const r = await getText(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym(sym))}?range=2y&interval=1d`);
  const out = r.ok ? yahooBars(JSON.parse(r.text)) : [];
  if (out.length) writeFileSync(f, JSON.stringify(out));      // a failure is never cached: the next run retries
  return out;
}

// Yahoo chart JSON -> [{date, open, high, low, close, volume}].
// Bars are dated in the exchange's own zone: New York for US listings, UTC for crypto (a UTC-dated coin
// bar closes at 8pm New York, so dating it by New York time would put the call day's close on the day before).
export function yahooBars(json) {
  const res = json?.chart?.result?.[0];
  const ts = res?.timestamp ?? [], q = res?.indicators?.quote?.[0] ?? {}, m = res?.meta;
  const dateOf = m?.exchangeTimezoneName === "UTC" ? (s) => new Date(s * 1000).toISOString().slice(0, 10) : (s) => nyTime(new Date(s * 1000).toISOString()).date;
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (!(q.close?.[i] > 0)) continue;
    out.push({ date: dateOf(ts[i]), open: q.open?.[i] ?? null, high: q.high?.[i] ?? null, low: q.low?.[i] ?? null, close: q.close[i], volume: q.volume?.[i] ?? null });
  }
  // The evening after a session Yahoo leaves that day's close null in the array and carries it in
  // meta (seen 2026-10-30). The nightly capture runs then, so take the day from meta when its date matches.
  const last = ts.length - 1;
  if (last >= 0 && !(q.close?.[last] > 0) && m?.regularMarketPrice > 0 && m?.regularMarketTime) {
    const d = dateOf(m.regularMarketTime);
    if (d === dateOf(ts[last]) && d > (out.at(-1)?.date ?? ""))
      out.push({ date: d, open: q.open?.[last] ?? null, high: m.regularMarketDayHigh ?? null, low: m.regularMarketDayLow ?? null, close: m.regularMarketPrice, volume: m.regularMarketVolume ?? null });
  }
  return out;
}

// CNN Fear & Greed points are stamped 00:00 UTC of the day they describe. Read the date in UTC: in New
// York time each point lands the evening before, which put the call day's own reading on the prior day
// (review 2026-10-30: the points fell Sunday-Thursday, and "10-29" equalled the live 10-30 value).
export function fngSeries(json) {
  return (json?.fear_and_greed_historical?.data ?? []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    .map((p) => ({ date: new Date(p.x).toISOString().slice(0, 10), score: p.y, rating: p.rating ?? null }));
}

async function fearGreed() {
  const f = cacheFile("sentiment", "fear-greed");
  if (freshToday(f)) return JSON.parse(readFileSync(f, "utf8"));
  const r = await getText("https://production.dataviz.cnn.io/index/fearandgreed/graphdata/2026-01-01", { Referer: "https://www.cnn.com/", Origin: "https://www.cnn.com", Accept: "application/json" });
  const series = r.ok ? fngSeries(JSON.parse(r.text)) : [];
  if (series.length) writeFileSync(f, JSON.stringify(series));
  return series;
}

let cikMap = null;
async function cikOf(sym) {
  if (!cikMap) {
    const f = existsSync(join(ROOT, ".cache/earnings-runup/company_tickers.json")) ? join(ROOT, ".cache/earnings-runup/company_tickers.json") : cacheFile("edgar", "company_tickers");
    if (!existsSync(f)) { const r = await getText("https://www.sec.gov/files/company_tickers.json", { "User-Agent": SEC_UA }); if (r.ok) writeFileSync(f, r.text); }
    const tick = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
    cikMap = new Map(Object.values(tick).map((t) => [t.ticker.toUpperCase(), String(t.cik_str).padStart(10, "0")]));
  }
  return cikMap.get(sym.replace(".", "-")) || cikMap.get(sym) || null;
}

// -> { subs, status }: "ok", "no-cik" (not an SEC filer: nothing to retry) or "failed" (retried next run).
async function edgar(sym) {
  const cik = await cikOf(sym);
  if (!cik) return { subs: null, status: "no-cik" };
  const f = cacheFile("edgar", cik);
  if (freshToday(f)) return { subs: JSON.parse(readFileSync(f, "utf8")), status: "ok" };
  await sleep(150);
  const r = await getText(`https://data.sec.gov/submissions/CIK${cik}.json`, { "User-Agent": SEC_UA });
  if (!r.ok) return { subs: null, status: "failed" };
  writeFileSync(f, r.text);
  return { subs: JSON.parse(r.text), status: "ok" };
}

// 8-K filings (any item) from five calendar days before the call through the call day, New York time.
// null when there is no filing history to read, so "none filed" is never confused with "not looked at".
function recent8k(subs, date) {
  const r = subs?.filings?.recent; if (!r?.form) return null;
  const from = new Date(Date.parse(date + "T12:00:00Z") - 5 * 864e5).toISOString().slice(0, 10);
  const out = [];
  for (let i = 0; i < r.form.length; i++) {
    if (!String(r.form[i]).startsWith("8-K")) continue;
    const t = nyTime(r.acceptanceDateTime?.[i]) ?? { date: r.filingDate[i], hour: null };
    if (t.date >= from && t.date <= date) out.push({ date: t.date, hour: t.hour != null ? r2(t.hour) : null, items: String(r.items?.[i] ?? ""), same_day: t.date === date });
  }
  return out;
}

const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
let newsBlocked = false;
async function news(sym, query, date, id) {
  const f = cacheFile("news", `${id}-${sym}`);
  if (existsSync(f)) { const c = JSON.parse(readFileSync(f, "utf8")); if (!c.error && (c.query ?? `${sym} stock`) === query) return { ...c, query }; }
  if (newsBlocked) return { error: "rate-limited earlier this run; retried next backfill" };
  const q = query;
  await sleep(1500);
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} after:${addDays(date, -3)} before:${addDays(date, 1)}`)}&hl=en-US&gl=US&ceid=US:en`;
  const r = await getText(url);
  let out;
  if (!r.ok) { if (r.status === 429 || r.status === 503 || r.status === "retries exhausted") newsBlocked = true; out = { error: `google news ${r.status}` }; }
  else {
    const items = parseRss(r.text).filter((x) => !x.published || (x.published >= addDays(date, -3) && x.published <= date));
    out = { source: "google-news-rss", query, window: `${addDays(date, -3)}..${date}`, count: items.length, same_day_included: true, headlines: items.slice(0, 8) };
    writeFileSync(f, JSON.stringify(out));
  }
  return out;
}

async function social(sym) {
  const st = await getText(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(sym)}.json`);
  let stocktwits = null;
  if (st.ok) {
    try {
      const j = JSON.parse(st.text), msgs = j.messages ?? [];
      const tags = msgs.map((m) => m.entities?.sentiment?.basic).filter(Boolean);
      const times = msgs.map((m) => Date.parse(m.created_at)).filter(Number.isFinite).sort((a, b) => a - b);
      const hours = times.length > 1 ? (times.at(-1) - times[0]) / 36e5 : null;
      stocktwits = { watchers: j.symbol?.watchlist_count ?? null, messages: msgs.length, bullish: tags.filter((t) => t === "Bullish").length, bearish: tags.filter((t) => t === "Bearish").length, msgs_per_hour: hours ? r2(msgs.length / hours) : null };
    } catch { stocktwits = null; }
  }
  return { stocktwits, apewisdom: (await apeWisdom()).get(sym) ?? { rank: null, note: "not in the top Reddit list" } };
}

let apeCache = null;
async function apeWisdom() {
  if (apeCache) return apeCache;
  apeCache = new Map();
  for (let p = 1; p <= 10; p++) {
    const r = await getText(`https://apewisdom.io/api/v1.0/filter/all-stocks/page/${p}`);
    if (!r.ok) break;
    const j = JSON.parse(r.text);
    for (const x of j.results ?? []) apeCache.set(String(x.ticker).toUpperCase(), { rank: x.rank, mentions: x.mentions, mentions_24h_ago: x.mentions_24h_ago, upvotes: x.upvotes, rank_24h_ago: x.rank_24h_ago });
    if (p >= (j.pages ?? 1)) break;
    await sleep(400);
  }
  return apeCache;
}

// ---------- assembly ----------

async function marketAt(date, M) {
  const at = (b) => featuresAt(b, asOfIndex(b, date));
  const spy = at(M.spy), vix = at(M.vix), vix3m = at(M.vix3m);
  const pick = (f) => f && { ret_1d: f.ret_1d, ret_5d: f.ret_5d, ret_20d: f.ret_20d, vs_sma50: f.vs_sma50, vs_sma200: f.vs_sma200 };
  return {
    asof: spy?.asof ?? null,
    spy: pick(spy), qqq: pick(at(M.qqq)), iwm: pick(at(M.iwm)), smh: pick(at(M.smh)),
    vix: vix?.close ?? null, vix_5d: vix?.ret_5d ?? null,
    vix_term: vix?.close && vix3m?.close ? r2(vix.close / vix3m.close) : null
  };
}

async function contextFor(row, M, { live, withNews }) {
  const inst = instrument(row.ticker), sym = inst.sym, date = row.date;
  const b = await bars(sym);
  const i = asOfIndex(b, date);
  const tf = featuresAt(b, i);
  // SPY for relative strength is taken on the ticker's own as-of date, never a later one (a halted,
  // stale or weekend-trading name would otherwise be compared against a different day's SPY).
  const sf = tf ? featuresAt(M.spy, asOfIndex(M.spy, addDays(tf.asof, 1))) : null;
  const market = await marketAt(date, M);
  const dayBar = b.find((x) => x.date === date), spyDay = M.spy.find((x) => x.date === date);
  const spyPrevBar = M.spy[asOfIndex(M.spy, date)];
  const prevClose = i >= 0 ? b[i].close : null, spyPrev = spyPrevBar?.close ?? null;
  const ed = inst.kind === "stock" ? await edgar(sym) : { subs: null, status: "n/a" };
  const subs = ed.subs;
  const reacts = earningsFilings(subs).map((f) => {
    const k = b.findIndex((x) => x.date >= f.date);
    if (k < 0) return null;
    return b[k].date === f.date && f.hour >= 16 ? b[k + 1]?.date ?? null : b[k].date;
  }).filter(Boolean);
  const cal = earningsDistance(b, reacts, date);
  const fng = fngBefore(M.fng, date);
  const newsCtx = withNews ? await news(sym, inst.news, date, row.id) : null;
  const marketOk = ["spy", "qqq", "iwm", "smh"].every((k) => market[k]) && market.vix != null && market.vix_term != null;
  const ctx = {
    captured_at: new Date().toISOString(), mode: live ? "live" : "backfill",
    instrument: inst.sym === String(row.ticker).toUpperCase() ? undefined : { book: row.ticker, priced_as: inst.sym, kind: inst.kind },
    data_ok: {
      bars: !!tf, asof: tf?.asof ?? null, stale: tf && market.asof ? tf.asof < market.asof : null,
      market: marketOk, fng: !!fng, edgar: ed.status, news: withNews ? !newsCtx?.error : null
    },
    market,
    sentiment: { fear_greed: fng, vix_band: vixBand(market.vix) },
    ticker: tf ? { ...tf, ...relStrength(tf, sf) } : null,
    same_day: {
      note: "the call day's own bar; for an intraday call part of it came AFTER the call",
      ticker_ret: dayBar && prevClose ? pct(dayBar.close, prevClose) : null,
      ticker_open_gap: dayBar?.open && prevClose ? pct(dayBar.open, prevClose) : null,
      spy_ret: spyDay && spyPrev ? pct(spyDay.close, spyPrev) : null
    },
    calendar: {
      weekday: new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      ...cal, next_earnings_known_in_hindsight: !live,
      eight_k: recent8k(subs, date)
    },
    news: newsCtx,
    social: live ? await social(inst.kind === "crypto" ? `${inst.coin}.X` : sym) : null,
    social_lag_days: live ? Math.round((Date.parse(nyDate() + "T12:00:00Z") - Date.parse(date + "T12:00:00Z")) / 864e5) : null,
    social_note: live ? "Stocktwits and ApeWisdom as of captured_at; social_lag_days is how long after the call that was" : "not recorded: Stocktwits and ApeWisdom have no history, so a backfilled call cannot be given one"
  };
  return ctx;
}

// A record worth fetching again: no context, or a part that failed for a reason a later run can fix.
export function needsRetry(rec) {
  const c = rec?.context;
  if (!c) return true;
  const ok = c.data_ok ?? {};
  return !!c.news?.error || ok.market === false || ok.fng === false || ok.edgar === "failed" || (ok.bars === false && (rec.retries ?? 0) < 5);
}

// Fold a fresh context over an earlier one: a live social snapshot is never thrown away (it cannot be
// fetched again), and a run that skipped news (--no-news) keeps the earlier news.
export function mergeContext(prev, next) {
  if (!prev) return next;
  const out = { ...next };
  if (prev.social && !next.social) { out.social = prev.social; out.social_lag_days = prev.social_lag_days; out.social_note = prev.social_note; out.mode = "live"; }
  if (prev.social && next.social) { out.social = prev.social; out.social_lag_days = prev.social_lag_days; }   // the first live snapshot wins
  if (next.news == null && prev.news) { out.news = prev.news; out.data_ok = { ...out.data_ok, news: !prev.news.error }; }
  return out;
}

function bookRows() {
  const rows = JSON.parse(readFileSync(join(ROOT, "db/archive.json"), "utf8"));
  return rows.filter((r) => r?.id && r.date && !isShadow(r) && !NOT_INSTRUMENTS.has(String(r.ticker ?? "").toUpperCase()));
}

function load() {
  if (!existsSync(DB)) return { generated: null, method: null, records: {} };
  try { return JSON.parse(readFileSync(DB, "utf8")); }
  catch (e) { console.error(`REFUSED - ${DB} does not parse (${e.message}); fix or restore it from git, nothing was written`); process.exit(2); }
}

function headerFor(row) {
  return {
    id: row.id, ticker: row.ticker, date: row.date, review_time: row.review_time ?? null, review_price: row.review_price ?? null,
    call_type: String(row.call_type ?? "").trim().toLowerCase() || null, origin: row.origin ?? null,
    grade: row.grades?.overall ?? null, readiness: row.readiness ?? null, fomo: row.fomo ?? null,
    market_risk: row.market_risk ?? null, confidence_pct: row.confidence_pct ?? null,
    call: String(row.final_call ?? "").slice(0, 280)
  };
}

// Re-read the file and fold in only the records this run touched, then write a temp file and rename it
// over the old one. Two runs at once (a capture during a backfill) each keep their own records, and a
// crash mid-write leaves the previous file whole.
function save(db, touched, rows) {
  const fresh = load();
  for (const id of touched) fresh.records[id] = db.records[id];
  for (const row of rows) { const rec = fresh.records[row.id]; if (rec) { Object.assign(rec, headerFor(row)); rec.outcome = outcomeOf(row); } }
  fresh.generated = new Date().toISOString();
  fresh.method = "see the header of scripts/call-context.mjs; market and sentiment as of the prior session close; social live only";
  const tmp = `${DB}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(fresh, null, 1) + "\n");
  renameSync(tmp, DB);
  db.records = fresh.records;
}

async function marketBars() {
  const [spy, qqq, iwm, smh, vix, vix3m, fng] = await Promise.all([bars("SPY"), bars("QQQ"), bars("IWM"), bars("SMH"), bars("^VIX"), bars("^VIX3M"), fearGreed()]);
  return { spy, qqq, iwm, smh, vix, vix3m, fng };
}

async function main() {
  const cmd = argv[0];
  const write = has("--write");
  if (cmd === "outcomes" || cmd === "backfill" || cmd === "capture") {
    const db = load(), rows = bookRows();
    let refreshed = 0;
    for (const row of rows) {
      const rec = db.records[row.id];
      if (!rec) continue;
      Object.assign(rec, headerFor(row));
      rec.outcome = outcomeOf(row); refreshed++;
    }
    if (cmd === "outcomes") {
      console.log(`OUTCOMES refreshed on ${refreshed} records${write ? "" : " (dry run, add --write)"}`);
      if (write) save(db, [], rows);
      return;
    }
    const capture = cmd === "capture";
    const date = val("--date", nyDate());
    const ids = val("--ids") ? new Set(val("--ids").split(",")) : null;
    // capture: every row from the last 5 days not yet captured live (a row logged after the 3:20p close
    // routine, or before a holiday, is caught on a later evening; social_lag_days says how late), and
    // also any older row with no record or a failed part, recorded as backfill (no social).
    const from = addDays(date, -5);
    const liveIds = new Set(capture && !ids ? rows.filter((r) => r.date >= from && r.date <= date && db.records[r.id]?.context?.mode !== "live").map((r) => r.id) : ids && capture ? ids : []);
    let todo = rows.filter((r) => (ids ? ids.has(r.id) : has("--rebuild") || liveIds.has(r.id) || needsRetry(db.records[r.id])));
    if (val("--limit")) todo = todo.slice(0, Number(val("--limit")));
    console.log(`${capture ? `CAPTURE ${date}: ${liveIds.size} live, ${todo.length - todo.filter((r) => liveIds.has(r.id)).length} backfill/retry` : `BACKFILL: ${todo.length} rows`}${write ? "" : " (dry run, add --write)"}`);
    if (!todo.length) { if (write) save(db, [], rows); return; }
    const M = await marketBars();
    if (!M.spy.length) { console.error("REFUSED - no SPY bars from Yahoo; nothing written"); process.exit(2); }
    if (!M.fng.length) console.log("  Fear & Greed unavailable this run (CNN refused); recorded as null and retried next run");
    let done = 0;
    const touched = new Set();
    for (const row of todo) {
      const existing = db.records[row.id];
      const live = liveIds.has(row.id);
      try {
        const ctx = mergeContext(existing?.context, await contextFor(row, M, { live, withNews: !has("--no-news") }));
        db.records[row.id] = { ...headerFor(row), outcome: outcomeOf(row), context: ctx, retries: existing?.context ? (existing.retries ?? 0) + 1 : 0 };
      } catch (e) {
        db.records[row.id] = { ...headerFor(row), outcome: outcomeOf(row), context: existing?.context ?? null, retries: (existing?.retries ?? 0) + 1, error: String(e.message || e) };
      }
      touched.add(row.id);
      done++;
      if (done % 25 === 0) { process.stderr.write(`  ${done}/${todo.length}\n`); if (write) { save(db, touched, rows); touched.clear(); } }
    }
    if (write) save(db, touched, rows);
    const recs = Object.values(db.records);
    console.log(`  recorded ${done}. File now holds ${recs.length} calls: ${recs.filter((r) => r.outcome?.result === "right").length} right, ${recs.filter((r) => r.outcome?.result === "wrong").length} wrong, ${recs.filter((r) => r.outcome?.result === "flat").length} flat, ${recs.filter((r) => !r.outcome?.result).length} not scored yet.`);
    const retry = recs.filter((r) => needsRetry(r)).length;
    if (retry) console.log(`  ${retry} calls have a part that failed (news rate limit, a market fetch, EDGAR); the next run retries them.`);
    return;
  }
  if (cmd === "report") {
    const db = load();
    const rep = buildReport(Object.values(db.records), { type: val("--type"), min: Number(val("--min", "8")) });
    console.log("CALL CONTEXT REPORT - right vs wrong, inside each call type. A pattern here is a hypothesis to test forward, never a rule.");
    console.log("Each field: median when the call was right / wrong, then the win rate (right %) in the low, middle and high third");
    console.log("of that field by rank, with its range, rows (n), distinct dates (d) and tickers (t); hidden under 3 dates, 3 tickers or --min rows.");
    console.log("The book re-logs the same name often, so n overstates how many independent bets a third holds: read d and t first.");
    for (const t of rep) {
      console.log(`\n${t.call_type}: ${t.n} scored (${t.right} right, ${t.wrong} wrong, ${t.flat} flat)`);
      for (const f of t.fields) {
        const th = f.thirds.map((x) => `${x.win == null ? "    -" : String(x.win).padStart(5) + "%"} [${x.lo}..${x.hi}, n${x.n}, ${x.dates}d ${x.tickers}t]`).join("  ");
        console.log(`  ${f.label.padEnd(24)} right ${String(f.right_median ?? "-").padStart(7)}  wrong ${String(f.wrong_median ?? "-").padStart(7)}  | ${th}`);
      }
    }
    return;
  }
  if (cmd === "show") {
    const rec = load().records[argv[1]];
    console.log(rec ? JSON.stringify(rec, null, 2) : `no record for ${argv[1]}`);
    return;
  }
  console.log("usage: node scripts/call-context.mjs backfill|capture|outcomes|report|show  (see the header)");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
