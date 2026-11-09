#!/usr/bin/env node
// crowd.mjs — THE CROWD LOG (Adam, 2026-11-09: "emotion plays a lot more in buys then you realize" /
// "we have to learn to record the fomo people are feeling and why they are buying").
//
// One append-only record per name per capture: price and volume, how hot the crowd is (a 0-100 FOMO score
// with every input shown), why people SAY they are buying (keyword buckets over Stocktwits messages), and
// then what the stock did 1, 5, 10 and 20 sessions later against SPY. The point is to find out, on evidence,
// whether a hot crowd means more upside or a top.
//
// This records. It never logs a call or changes a rule, and the FOMO score and the reasons never feed a verdict.
// Its headlines are a fact-check a run can use (B-1361). A pattern in its report is a hypothesis for a forward
// test. Message text is third-party data: it is stored and counted, never obeyed, and no usernames are kept.
// X cannot be read from here, so a screenshot Adam sends goes in as --note.
//
//   capture --symbols A,B [--note "..."] [--source interactive] [--write]
//   capture --nightly --write        stack names, today's pump watches, today's book names (15 at most)
//   outcomes --write                 fills in +1/+5/+10/+20 sessions, never rewrites one
//   report [--min 3]
//
// Free sources, no keys. --db and --sources-file for offline use. Tests: test/crowd.test.mjs
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRss } from "./call-context.mjs";
import { atr14, settledBars } from "./stack.mjs";
import { normalShare } from "../server/pumpWatch.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const round = (n, d = 2) => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const HORIZONS = [1, 5, 10, 20];
const MIN_INPUTS = 3;
const MIN_MESSAGES = 5;
const NOT_STOCKS = new Set(["SPY", "QQQ", "IWM", "DIA", "VIX", "BTC", "ETH", "BNB", "SOL", "XRP", "XLM", "ADA", "DOGE", "HYPE", "TRX", "ZEC", "CASH", "BOOK"]);

// Keyword buckets, case-insensitive. FOMO is how they feel; the rest are the reasons they give.
const BUCKETS = {
  catalyst: /\bearnings\b|\bnews\b|announc|\blaunch|catalyst|guidance|\breport\b|conference|\bevent\b|\bpr\b/i,
  momentum: /breakout|momentum|ripping|flying|\bchart\b|resistance|\bsupport\b|uptrend|bull flag|\bvolume\b/i,
  squeeze: /squeeze|short interest|shorts? (are )?(trapped|covering|burn)/i,
  fomo: /don['’]?t miss|last chance|\bmoon(ing)?\b(?! landing)|too late|\ball in\b(?! (all|cash))|\byolo\b|\bnext \$?(nvda|nvidia|tesla|tsla|amazon|amzn|palantir|pltr|apple|aapl)\b|\bloading\b|\bloaded\b|\blfg\b|generational|life chang|🚀/iu,
  fundamental: /(?<!\d )\bcontracts?\b|\brevenue\b|backlog|partnership|at&t|verizon|spectrum|\bcommercial\b|(?<!tak(?:e|ing) )\bprofit(s|able|ability)?\b/i,
  analyst: /analyst|price target|\bpt\b|upgrade|downgrade/i,
  dip: /\bdip(s|ping)?\b|oversold|\bbounce\b|\bbottom(ed)?\b(?! line)|discount|\bcheap\b|averag(e|ing) down/i,
  options: /(?<!margin |earnings |conference )\b(calls|puts)\b|\bgamma\b|\boptions?\b|\b0dte\b|\bstrikes\b|strike price|\b\d+ contracts?\b|\b\d+(\.\d+)?[cp]\b/i,
};

// Links and handles are not what someone said: a path like /news/earnings/ is not a reason.
const strip = (b) => String(b).replace(/https?:\/\/\S+/g, " ").replace(/@\w+/g, " ");

export function whyBuckets(bodies) {
  const counts = Object.fromEntries(Object.keys(BUCKETS).map((k) => [k, 0]));
  for (const body of bodies.map(strip)) for (const [k, re] of Object.entries(BUCKETS)) if (re.test(body)) counts[k]++;
  const n = bodies.length;
  const shares = Object.fromEntries(Object.entries(counts).map(([k, c]) => [k, n ? round((c / n) * 100) : 0]));
  return { n, counts, shares };
}

export function dominantWhy(counts, n = Infinity) {
  if (n < MIN_MESSAGES) return null;
  const ranked = Object.entries(counts).filter(([k, c]) => k !== "fomo" && c > 0).sort((a, b) => b[1] - a[1]);
  return !ranked.length || ranked[0][1] === ranked[1]?.[1] ? null : ranked[0][0];
}

export const fomoLabel = (score) => (!Number.isFinite(score) ? null : score < 25 ? "Quiet" : score < 50 ? "Warming" : score < 75 ? "Hot" : "Euphoric");

// Six inputs, each 0-100, the mean is the score: the same auditable shape as the framework's Readiness.
// A source that failed is null and left out, because a blank is not a calm crowd.
export function fomoScore({ moveAtr, pace, trendingRank: rank, onTrendingList, mentions, mentions24h, bullShare, tagged, fomoShare, n }) {
  const pct = (x) => Math.round(clamp01(x) * 100);
  const ok = Number.isFinite;
  const inputs = {
    price: !ok(moveAtr) ? null : pct(moveAtr / 2),                      // up 2 ATR on the day = 100
    volume: !ok(pace) ? null : pct((pace - 1) / 2),                     // 1x pace = 0, 3x = 100
    trending: onTrendingList == null ? null : onTrendingList ? pct((31 - rank) / 30) : 0, // 1st on the list = 100, off it = 0
    mentions: !ok(mentions) ? null : mentions24h > 0 ? pct((mentions / mentions24h - 1) / 2) : mentions >= 5 ? 100 : 0, // 1x yesterday = 0, 3x = 100
    bulls: !ok(bullShare) || tagged < MIN_MESSAGES ? null : pct((bullShare - 50) / 50), // half bulls = 0, all bulls = 100
    fomo_talk: !ok(fomoShare) || n < MIN_MESSAGES ? null : pct(fomoShare / 30),         // 30% of messages or more = 100
  };
  const have = Object.values(inputs).filter((v) => v != null);
  const score = have.length >= MIN_INPUTS ? Math.round(have.reduce((p, q) => p + q, 0) / have.length) : null;
  return { score, label: fomoLabel(score), used: have.length, inputs };
}

const unescapeHtml = (s) => String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// Bodies and counts only: who wrote a message is not part of the record.
export function parseStocktwits(json) {
  if (!json) return null;
  const msgs = json.messages ?? [];
  // One voice per account: a promoter posting ten times is one person, not ten. The newest message stands (the feed is newest first).
  const who = (m) => m.user?.id ?? m.user?.username ?? null;
  const seen = new Set();
  const voices = msgs.filter((m) => { const a = who(m); if (a === null) return true; if (seen.has(a)) return false; seen.add(a); return true; });
  const tags = voices.map((m) => m.entities?.sentiment?.basic).filter(Boolean);
  const bull = tags.filter((t) => t === "Bullish").length, bear = tags.filter((t) => t === "Bearish").length;
  const times = msgs.map((m) => Date.parse(m.created_at)).filter(Number.isFinite).sort((a, b) => a - b);
  const hours = times.length > 1 ? (times.at(-1) - times[0]) / 3600000 : 0;
  return { watchers: json.symbol?.watchlist_count ?? null, n: msgs.length, authors: seen.size, bull, bear, tagged: tags.length, bull_share: tags.length ? round((bull / tags.length) * 100) : null, msgs_per_hour: hours > 0 ? round(msgs.length / hours) : null, bodies: voices.map((m) => unescapeHtml(m.body ?? "")) };
}

export function apeRow(list, sym) {
  const r = (list ?? []).find((x) => x.ticker === sym);
  if (!r) return null;
  const n = (v) => (v == null ? null : Number(v));
  return { rank: n(r.rank), mentions: n(r.mentions), mentions_24h_ago: n(r.mentions_24h_ago), upvotes: n(r.upvotes), rank_24h_ago: n(r.rank_24h_ago) };
}

export function trendingRank(json, sym) {
  const i = (json?.symbols ?? []).findIndex((s) => s.symbol === sym);
  return i >= 0 ? i + 1 : null;
}

// Pace against a normal day: today's volume over (average day x the share of a day's volume normally done
// by this minute, NORMAL_DAY_SHARE in server/pumpWatch.js). An even clock read an average day as 2.2x at 09:00 CT.
export const volumePace = ({ today, avg, minutes }) => {
  const share = normalShare(minutes);
  return Number.isFinite(today) && avg && share ? round(today / (avg * share)) : null;
};

export function sampleQuotes(bodies, { max = 5, len = 140 } = {}) {
  const hasReason = (b) => Object.values(BUCKETS).some((re) => re.test(b));
  const clean = (b) => b.replace(/\s+/g, " ").trim().slice(0, len).trim();
  const withReason = bodies.map(strip).filter(hasReason);
  const ordered = [...withReason.filter((b) => BUCKETS.fomo.test(b)), ...withReason.filter((b) => !BUCKETS.fomo.test(b))];
  return [...new Set(ordered.map(clean))].slice(0, max);
}

export function appendCapture(db, rec) {
  const top = db.captures.reduce((p, c) => Math.max(p, Number(String(c.id ?? "").replace("CR-", "")) || 0), 0);
  const entry = { id: `CR-${String(top + 1).padStart(3, "0")}`, ...rec };
  db.captures.push(entry);
  return entry;
}

export const alreadyCaptured = (db, sym, date, source) => db.captures.some((c) => c.sym === sym && c.date === date && c.source === source);

const change = (now, then) => round((now / then - 1) * 100);

// Session 0 is the session the capture's price belongs to, not the calendar day it was taken.
// Yahoo's bars are adjusted for every later split, so the stored price is too. A filled horizon is never written again.
export function fillOutcomes(db, barsBySym, splitsBySym = {}) {
  let filled = 0;
  const spy = barsBySym.SPY;
  for (const c of db.captures) {
    const bars = barsBySym[c.sym];
    if (!bars || !spy || !c.price || !c.spy_price) continue;
    const session = c.session ?? c.date;
    const i = bars.findIndex((b) => b.d === session), s = spy.findIndex((b) => b.d === session);
    if (i < 0 || s < 0) continue;
    const factor = (splitsBySym[c.sym] ?? []).filter((x) => x.d > session).reduce((p, x) => p * x.factor, 1);
    for (const h of HORIZONS) {
      if (c.outcomes?.[h] || !bars[i + h] || !spy[s + h]) continue;
      const pct = change(bars[i + h].c, c.price / factor), spy_pct = change(spy[s + h].c, c.spy_price);
      (c.outcomes ??= {})[h] = { date: bars[i + h].d, close: bars[i + h].c, pct, spy_pct, vs_spy: round(pct - spy_pct) };
      filled++;
    }
  }
  return filled;
}

function median(a) {
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : round((s[m - 1] + s[m]) / 2);
}

function groupStats(name, rows, h, min, extra = {}) {
  const dates = new Set(rows.map((r) => r.date)).size;
  const hidden = dates < min;
  const pcts = rows.map((r) => r.outcomes[h].pct), vs = rows.map((r) => r.outcomes[h].vs_spy);
  return { name, n: rows.length, dates, ...extra, hidden, median_pct: hidden ? null : median(pcts), median_vs_spy: hidden ? null : median(vs), pct_up: hidden ? null : round((pcts.filter((p) => p > 0).length / pcts.length) * 100) };
}

// Hidden under `min` distinct dates: ten names on one wild day are one observation.
export function buildCrowdReport(captures, { min = 3 } = {}) {
  const horizons = {};
  const seen = new Set();
  const once = captures.filter((c) => { if (c.price == null) return false; const k = `${c.sym}|${c.session ?? c.date}`; if (seen.has(k)) return false; seen.add(k); return true; }); // log order, so the earliest good one stands
  for (const h of HORIZONS) {
    const done = once.filter((c) => c.outcomes?.[h]);
    const scored = done.filter((c) => c.fomo?.score != null).sort((a, b) => a.fomo.score - b.fomo.score);
    const n = scored.length;
    const cuts = [[0, Math.floor(n / 3), "coolest"], [Math.floor(n / 3), Math.floor((2 * n) / 3), "middle"], [Math.floor((2 * n) / 3), n, "hottest"]];
    const thirds = cuts.filter(([a, b]) => b > a).map(([a, b, name]) => groupStats(name, scored.slice(a, b), h, min, { score_from: scored[a].fomo.score, score_to: scored[b - 1].fomo.score }));
    const byWhy = new Map();
    for (const c of done) if (c.why?.main) (byWhy.get(c.why.main) ?? byWhy.set(c.why.main, []).get(c.why.main)).push(c);
    const why = [...byWhy.entries()].map(([name, rows]) => groupStats(name, rows, h, min));
    horizons[h] = { thirds, why };
  }
  return { horizons };
}

export function nightlySymbols({ stack, pump, book, date, cap = 15 }) {
  const fromStack = Object.keys(stack?.names ?? {});
  const fromPump = (pump?.watches ?? []).filter((w) => w.date === date).map((w) => w.ticker);
  const fromBook = (book ?? []).filter((r) => r.date === date && /^[A-Z]{1,5}$/.test(r.ticker ?? "") && !NOT_STOCKS.has(r.ticker)).map((r) => r.ticker);
  return [...new Set([...fromStack, ...fromPump, ...fromBook])].slice(0, cap);
}

// ---- command line ----
const argv = process.argv.slice(2);
const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const has = (k) => argv.includes(k);
const dbPath = () => (val("--db") ? resolve(val("--db")) : resolve(ROOT, "db/crowd-log.json"));
const load = () => (existsSync(dbPath()) ? JSON.parse(readFileSync(dbPath(), "utf8")) : { schema: 1, captures: [] });
const save = (db) => { const p = dbPath(), tmp = `${p}.tmp`; writeFileSync(tmp, JSON.stringify(db, null, 2) + "\n"); renameSync(tmp, p); }; // never a half-written file
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const signed = (n) => (n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);

function nyNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { nyDate: `${p.year}-${p.month}-${p.day}`, nyMinutes: Number(p.hour) * 60 + Number(p.minute) };
}

async function getText(url) {
  let last = "no response";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.ok) return { ok: true, text: await r.text() };
      last = r.status;
      if (r.status !== 429 && r.status !== 503) break;
    } catch (e) { last = e.message; }
    await sleep(1500 * (attempt + 1));
  }
  return { ok: false, error: `failed: ${last}` };
}

const getJson = async (url) => { const r = await getText(url); if (!r.ok) return r; try { return { ok: true, json: JSON.parse(r.text) }; } catch { return { ok: false, error: "failed: bad json" }; } };
const chartUrl = (sym, q) => `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${q}`;

async function livePrice(sym) {
  const r = await getJson(chartUrl(sym, "interval=5m&range=1d"));
  if (!r.ok) return { error: r.error };
  const c = r.json.chart?.result?.[0];
  if (!c) return { error: "failed: empty chart" };
  const reg = c.meta.currentTradingPeriod.regular, now = Date.now() / 1000;
  // minutes since the open; a finished session (a half day included) reads as a whole day
  const minutes = now >= reg.end ? 390 : Math.max(0, (now - reg.start) / 60);
  // regularMarketVolume, never the sum of the 5-minute bars: those carry junk rows (GOOGL 11/09: a 13.4M bar against a 0.34M median).
  // It matched Robinhood's own volume to the share on six names (B-1362).
  const session = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(c.meta.regularMarketTime * 1000));
  return { price: c.meta.regularMarketPrice, prev_close: c.meta.chartPreviousClose, today_volume: c.meta.regularMarketVolume, minutes, session };
}

async function dailyBars(sym, range = "3mo") {
  const r = await getJson(chartUrl(sym, `interval=1d&range=${range}&events=split`));
  if (!r.ok) return null;
  const c = r.json.chart?.result?.[0];
  if (!c?.timestamp) return null;
  const q = c.indicators.quote[0];
  const iso = (s) => new Date(s * 1000).toISOString().slice(0, 10);
  const all = c.timestamp.map((s, n) => ({ d: iso(s), o: q.open[n], h: q.high[n], l: q.low[n], c: q.close[n], v: q.volume[n] })).filter((b) => b.c != null && b.l != null && b.h != null);
  return { bars: settledBars(all, nyNow()).settled, splits: Object.values(c.events?.splits ?? {}).map((s) => ({ d: iso(s.date), factor: s.numerator / s.denominator })) };
}

async function allApe() {
  const out = [];
  for (let p = 1; p <= 10; p++) {
    const r = await getJson(`https://apewisdom.io/api/v1.0/filter/all-stocks/page/${p}`);
    if (!r.ok) return { error: r.error }; // a partial list would score every name it missed as zero mentions
    out.push(...(r.json.results ?? []));
    if (p >= (r.json.pages ?? 1)) break;
    await sleep(400);
  }
  return out.length ? { list: out } : { error: "failed: empty list" };
}

const usableTrending = (j) => (j?.symbols?.length ? j : null);
const usableApe = (l) => (Array.isArray(l) && l.length ? l : null);

// Live sources, or one frozen file when testing. Each returns what it found plus how the fetch went.
async function shared() {
  if (val("--sources-file")) {
    const f = JSON.parse(readFileSync(resolve(val("--sources-file")), "utf8"));
    const trending = usableTrending(f.trending), ape = usableApe(f.ape);
    return { file: f, spy: f.SPY, trending, ape, date: f.now.date, status: { trending: trending ? "ok" : "failed", ape: ape ? "ok" : "failed" } };
  }
  const [spy, t, a] = [await livePrice("SPY"), await getJson("https://api.stocktwits.com/api/2/trending/symbols.json"), await allApe()];
  const trending = t.ok ? usableTrending(t.json) : null;
  return { file: null, spy, trending, ape: a.list ?? null, date: nyNow().nyDate, status: { trending: trending ? "ok" : t.error ?? "failed: empty list", ape: a.list ? "ok" : a.error } };
}

async function gather(sym, ctx) {
  if (ctx.file) {
    const f = ctx.file[sym];
    return { ...f, st: f.stocktwits ?? null, rssText: f.rss ?? "", status: { price: "ok", stocktwits: f.stocktwits ? "ok" : "failed", news: f.rss ? "ok" : "failed" } };
  }
  const p = await livePrice(sym);
  const daily = (await dailyBars(sym))?.bars ?? [];
  const st = await getJson(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(sym)}.json`);
  const rss = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(`${sym} stock when:2d`)}&hl=en-US&gl=US&ceid=US:en`);
  return { ...p, daily, st: st.ok ? st.json : null, rssText: rss.ok ? rss.text : "", status: { price: p.error ?? "ok", stocktwits: st.ok ? "ok" : st.error, news: rss.ok ? "ok" : rss.error } };
}

function headlinesFrom(text) {
  try { return { list: parseRss(text).slice(0, 8), ok: true }; } catch { return { list: [], ok: false }; }
}

function buildRecord(sym, raw, ctx, { source, note }) {
  const finite = Number.isFinite;
  const session = raw.session ?? ctx.date;
  const st = parseStocktwits(raw.st);
  const prior = (raw.daily ?? []).filter((b) => b.d < session); // a day cannot be part of its own yardstick
  const atr = prior.length ? atr14(prior) : null;
  const vols = prior.slice(-30).map((b) => b.v).filter(Boolean);
  const avg = vols.length ? vols.reduce((p, q) => p + q, 0) / vols.length : null;
  const dayMove = finite(raw.price) && finite(raw.prev_close);
  const pace = finite(raw.price) ? volumePace({ today: raw.today_volume, avg, minutes: raw.minutes }) : null;
  const moveAtr = atr && dayMove ? round((raw.price - raw.prev_close) / atr) : null;
  const ape = ctx.ape ? apeRow(ctx.ape, sym) : null;
  const rank = trendingRank(ctx.trending, sym);
  const why = whyBuckets(st?.bodies ?? []);
  const fomo = fomoScore({ moveAtr, pace, trendingRank: rank, onTrendingList: ctx.trending ? rank != null : null, mentions: ctx.ape ? (ape?.mentions ?? 0) : null, mentions24h: ctx.ape ? (ape?.mentions_24h_ago ?? 0) : null, bullShare: st?.bull_share ?? null, tagged: st?.tagged ?? 0, fomoShare: st ? why.shares.fomo : null, n: why.n });
  const feed = headlinesFrom(raw.rssText);
  const headlines = feed.list;
  const { bodies, ...stCounts } = st ?? {};
  const pct_today = dayMove ? change(raw.price, raw.prev_close) : null;
  const spy_pct_today = finite(ctx.spy?.price) && finite(ctx.spy?.prev_close) ? change(ctx.spy.price, ctx.spy.prev_close) : null;
  return {
    sym, date: ctx.date, session, time: new Date().toISOString(), source, note: note ?? null,
    price: raw.price ?? null, prev_close: raw.prev_close ?? null, pct_today, spy_price: ctx.spy?.price ?? null, spy_pct_today,
    vs_spy_today: pct_today != null && spy_pct_today != null ? round(pct_today - spy_pct_today) : null,
    atr, move_atr: moveAtr, volume_pace: pace, pace_clock: "normal-day",
    stocktwits: st ? { ...stCounts, trending_rank: rank } : null, ape, fomo,
    why: { ...why, main: dominantWhy(why.counts, why.n) }, samples: sampleQuotes(bodies ?? []),
    news: { count: headlines.length, headlines }, sources: { ...raw.status, ...ctx.status, ...(feed.ok ? {} : { news: "failed: bad feed" }) },
  };
}

// The unattended nightly run leaves the quotes out: it has no use for strangers' text in its working memory.
export function recordLines(r, { samples = true } = {}) {
  const out = [`${r.id ?? "(dry run)"} ${r.sym} ${r.price ?? "no price"} ${signed(r.pct_today)} (SPY ${signed(r.spy_pct_today)}), volume pace ${r.volume_pace ?? "n/a"}x. FOMO ${r.fomo.score ?? "n/a"} ${r.fomo.label ?? ""}`];
  out.push(`  inputs: ${Object.entries(r.fomo.inputs).map(([k, v]) => `${k} ${v ?? "n/a"}`).join(", ")}`);
  const reasons = Object.entries(r.why.shares).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([k, s]) => `${k} ${Math.round(s)}%`);
  out.push(`  why they say they are in (of ${r.why.n} accounts): ${reasons.join(", ") || "nothing readable"}`);
  if (r.stocktwits) out.push(`  Stocktwits: ${r.stocktwits.watchers} watching, ${r.stocktwits.bull} bulls, ${r.stocktwits.bear} bears, trending ${r.stocktwits.trending_rank ?? "off the list"}. ApeWisdom: ${r.ape ? `rank ${r.ape.rank}, ${r.ape.mentions} mentions vs ${r.ape.mentions_24h_ago} a day ago` : "not listed"}.`);
  if (samples) for (const q of r.samples) out.push(`  "${q}"`);
  for (const [k, v] of Object.entries(r.sources)) if (v !== "ok") out.push(`  source ${k}: ${v}`);
  return out;
}

function readJson(path, fallback) { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback; }

function printGroup(g) {
  if (g.hidden) { console.log(`    ${g.name.padEnd(12)} n=${g.n}, ${g.dates} date${g.dates === 1 ? "" : "s"}: too few dates to read`); return; }
  const range = g.score_from != null ? ` FOMO ${g.score_from}-${g.score_to}` : "";
  console.log(`    ${g.name.padEnd(12)} n=${g.n}, ${g.dates} dates${range}: median ${signed(g.median_pct)}, vs SPY ${signed(g.median_vs_spy)}, up ${g.pct_up}%`);
}

async function main() {
  const [cmd] = argv;
  const db = load();

  if (cmd === "capture") {
    const ctx = await shared();
    const nightly = has("--nightly");
    const symbols = nightly
      ? nightlySymbols({ stack: readJson(resolve(ROOT, "db/stack.json"), null), pump: readJson(resolve(ROOT, "db/pump-watch.json"), null), book: (() => { const b = readJson(resolve(ROOT, "db/archive.json"), []); return Array.isArray(b) ? b : (b.rows ?? b.reviews ?? b.entries ?? []); })(), date: ctx.date })
      : String(val("--symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) { console.log("crowd: nothing to capture."); return; }
    const source = nightly ? "nightly" : val("--source") ?? "interactive";
    const recs = [];
    for (const sym of symbols) {
      if (nightly && alreadyCaptured(db, sym, ctx.date, source)) continue;
      try { recs.push(buildRecord(sym, await gather(sym, ctx), ctx, { source, note: val("--note") })); }
      catch (e) { console.log(`crowd: ${sym} failed: ${e.message}`); }
      if (!ctx.file) await sleep(1000);
    }
    const fresh = load(); // the sources take a while, and another desk may have written meanwhile
    for (const rec of recs) console.log(recordLines(has("--write") ? appendCapture(fresh, rec) : rec, { samples: !nightly }).join("\n"));
    if (has("--write") && recs.length) save(fresh);
    return;
  }

  if (cmd === "outcomes") {
    const syms = [...new Set(db.captures.map((c) => c.sym))];
    const barsBySym = { SPY: (await dailyBars("SPY", "6mo"))?.bars }, splitsBySym = {};
    for (const s of syms) { const got = await dailyBars(s, "6mo"); barsBySym[s] = got?.bars; splitsBySym[s] = got?.splits ?? []; }
    const n = fillOutcomes(db, barsBySym, splitsBySym);
    console.log(`crowd: ${n} outcome${n === 1 ? "" : "s"} filled across ${db.captures.length} captures.`);
    if (has("--write")) save(db);
    return;
  }

  if (cmd === "report") {
    const r = buildCrowdReport(db.captures, { min: Number(val("--min") ?? 3) });
    console.log(`CROWD LOG: ${db.captures.length} captures. A pattern here is a hypothesis for a forward test, never a rule.`);
    for (const [h, g] of Object.entries(r.horizons)) {
      console.log(`\n+${h} session${h === "1" ? "" : "s"}`);
      if (!g.thirds.length && !g.why.length) { console.log("    nothing scored yet"); continue; }
      console.log("  by how hot the crowd was:");
      g.thirds.forEach(printGroup);
      console.log("  by the main reason people gave:");
      g.why.forEach(printGroup);
    }
    return;
  }

  throw new Error("usage: crowd.mjs capture|outcomes|report (see the header)");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`crowd: ${e.message}`); process.exit(1); });
}
