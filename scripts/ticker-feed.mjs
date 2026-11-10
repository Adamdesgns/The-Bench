#!/usr/bin/env node
// ticker-feed.mjs - the short list of what the desk is watching right now, with a live quote on each,
// for the taskbar ticker strip (tools/ticker-strip) and the Grok Bot wallpaper. Adam, 2026-11-09:
// "i want to build my stock tickers into a desktop wallpaper ... or into my task bar so we see what
// we're watching at all times."
//
// Read only on the book: it reads db/watchlist.json, db/pump-watch.json, db/stack.json and the optional
// db/ticker-pins.json, and writes one file, db/ticker-feed.json (git-ignored, rewritten every minute).
// Quotes come from the free Yahoo chart feed, no key. Nothing here touches a broker or the phone.
//
//   node scripts/ticker-feed.mjs                 pick the list, pull quotes, write db/ticker-feed.json
//   node scripts/ticker-feed.mjs --also <file>   also write the same JSON to <file> (the wallpaper's copy)
//   node scripts/ticker-feed.mjs --list          print the picked list only, no quotes, writes nothing
//
// db/ticker-pins.json (optional, Adam's to edit): { "pin": ["TSLA"], "hide": ["XOM"], "max": 16 }
// pin = always shown right after the gauges; hide = never shown; max = how many symbols at most.

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(ROOT, "db");
const OUT = join(DB, "ticker-feed.json");

export const GAUGES = ["SPY", "QQQ", "SMH"]; // the market itself, always first
export const DEFAULT_MAX = 16;
// Watchlist statuses that mean "this could turn into a trade soon", hottest first.
export const HOT_STATUS = ["HIGH-ALERT", "HOT-ACCUMULATE", "ARMED", "ARMED-ACCUMULATE", "ARMED-CONDITIONAL", "STALK", "QUEUE"];
// Bare coin tickers on the book are coins, not US listings (same rule as call-context.mjs).
const COINS = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "TRX", "ADA", "AVAX", "LINK", "XLM", "ZEC"]);
const YAHOO_COIN = { HYPE: "HYPE32196-USD" };
const UA = { headers: { "User-Agent": "Mozilla/5.0" } };

// What Yahoo calls it. The label on screen stays the book's name.
export function yahooSymbol(sym) {
  if (YAHOO_COIN[sym]) return YAHOO_COIN[sym];
  if (COINS.has(sym)) return `${sym}-USD`;
  return sym.replace(".", "-"); // share classes: BRK.B is BRK-B on Yahoo
}
export const isCrypto = (sym) => yahooSymbol(sym).endsWith("-USD");

// When the quotes on screen were last really pulled. A run where every fetch failed must not make old
// prices look fresh, so it keeps the previous stamp; the strip and the ribbon turn amber from this.
export function feedStamp(items, previous, now) {
  return items.some((x) => !x.stale) ? now : previous || now;
}

// A real ticker, not a note like "52WK-SCREEN".
export const isTicker = (s) => typeof s === "string" && /^[A-Z][A-Z.]{0,5}(-USD)?$/.test(s);

// The pick. Pure: takes the four files' contents and today's date (YYYY-MM-DD, New York), returns
// [{ sym, tag }] in display order. Tags: gauge, pin, pump, stack, hot.
// Order: gauges, Adam's pins, pump watches that are live or still ahead, stack names, then the hot
// watchlist names hottest status first. A symbol shows once, under the first tag that claims it.
export function pickSymbols({ watchlist = [], pump = { watches: [] }, stack = { names: {} }, pins = {} }, today) {
  const hide = new Set((pins.hide || []).map((s) => String(s).toUpperCase()));
  const max = Number.isInteger(pins.max) && pins.max > 0 ? pins.max : DEFAULT_MAX;
  const out = [];
  const seen = new Set();
  const take = (sym, tag) => {
    const s = String(sym || "").toUpperCase();
    if (!isTicker(s) || hide.has(s) || seen.has(s) || out.length >= max) return;
    seen.add(s);
    out.push({ sym: s, tag });
  };
  for (const s of GAUGES) take(s, "gauge");
  for (const s of pins.pin || []) take(s, "pin");
  for (const w of pump.watches || []) if (!w.ended && w.date >= today) take(w.ticker, "pump");
  for (const s of Object.keys(stack.names || {})) if (!stack.names[s]?.kill) take(s, "stack");
  const rank = (st) => HOT_STATUS.indexOf(String(st || "").toUpperCase());
  const hot = watchlist.filter((r) => rank(r.status) >= 0).sort((a, b) => rank(a.status) - rank(b.status));
  for (const r of hot) take(r.sym, "hot");
  return out;
}

// One quote from a Yahoo chart response. Pure, so the tests can feed it a fixture.
// price/pct = the regular session (last close vs the close before it). ext = the latest trade after
// the last regular trade (pre-market or after hours), when there is one, with its change from price.
export function parseChart(json) {
  const r = json?.chart?.result?.[0];
  if (!r?.meta) throw new Error("no chart");
  const m = r.meta;
  const price = m.regularMarketPrice;
  if (!Number.isFinite(price)) throw new Error("no price");
  const prev = m.chartPreviousClose ?? m.previousClose;
  const pct = Number.isFinite(m.regularMarketChangePercent)
    ? m.regularMarketChangePercent
    : Number.isFinite(prev) && prev > 0 ? (price / prev - 1) * 100 : null;
  let ext = null;
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  if (m.instrumentType !== "CRYPTOCURRENCY" && Number.isFinite(m.regularMarketTime)) {
    for (let i = ts.length - 1; i >= 0; i--) {
      if (ts[i] <= m.regularMarketTime + 60) break; // back inside the regular session: no extended trade
      if (Number.isFinite(closes[i])) {
        const hourNY = Number(new Date(ts[i] * 1000).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
        ext = { price: closes[i], pct: (closes[i] / price - 1) * 100, session: hourNY >= 16 ? "AH" : "PRE" };
        break;
      }
    }
  }
  return { price, pct, ext, name: m.shortName || null, at: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null };
}

async function fetchQuote(sym, fetchFn = globalThis.fetch) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(sym))}?interval=5m&range=1d&includePrePost=true`;
  const res = await fetchFn(url, { ...UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  return parseChart(await res.json());
}

// At most `n` requests at a time.
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; } };

// Write to a temp file beside the target, then swap it in, so a reader polling the file never sees half of it.
function writeAtomic(p, text) {
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, p);
}

const todayNY = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function main(argv = process.argv.slice(2)) {
  const also = argv.includes("--also") ? argv[argv.indexOf("--also") + 1] : null;
  const picked = pickSymbols({
    watchlist: readJson(join(DB, "watchlist.json"), []),
    pump: readJson(join(DB, "pump-watch.json"), { watches: [] }),
    stack: readJson(join(DB, "stack.json"), { names: {} }),
    pins: readJson(join(DB, "ticker-pins.json"), {}),
  }, todayNY());
  if (argv.includes("--list")) {
    for (const p of picked) console.log(`${p.sym.padEnd(8)} ${p.tag}`);
    return;
  }
  // A failed fetch keeps the last good quote (marked stale) instead of blanking the symbol.
  const before = readJson(OUT, { items: [] });
  const last = new Map((before.items || []).map((x) => [x.sym, x]));
  // One quote, or null. A failed symbol gets a second try after a pause (network blips here last a few seconds).
  const errors = new Map();
  const pull = async ({ sym, tag }) => {
    try { return { sym, tag, crypto: isCrypto(sym), ...(await fetchQuote(sym)), stale: false }; }
    catch (e) { errors.set(sym, String(e.message || e)); return null; }
  };
  const fresh = await mapLimit(picked, 6, pull);
  if (fresh.some((x) => !x)) {
    await new Promise((r) => setTimeout(r, 2000));
    await mapLimit(picked, 6, async (p, i) => { if (!fresh[i]) fresh[i] = await pull(p); });
  }
  const items = picked.map(({ sym, tag }, i) => {
    if (fresh[i]) return fresh[i];
    const old = last.get(sym);
    return old?.price != null
      ? { ...old, tag, stale: true, error: errors.get(sym) }
      : { sym, tag, crypto: isCrypto(sym), price: null, pct: null, ext: null, stale: true, error: errors.get(sym) };
  });
  const feed = { updated: feedStamp(items, before.updated, new Date().toISOString()), source: "yahoo chart (free, ~15 min delay on some exchanges)", items };
  const text = JSON.stringify(feed, null, 2);
  writeAtomic(OUT, text);
  if (also && existsSync(dirname(also))) writeAtomic(also, text);
  const bad = items.filter((x) => x.stale).length;
  console.log(`ticker-feed: ${items.length} symbols, ${bad} stale -> ${OUT}${also ? ` + ${also}` : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`ticker-feed: ${e.message || e}`); process.exit(1); });
}
