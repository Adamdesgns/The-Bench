// dataProviders.js — market data, two separate chains.
//
//   Live quotes / close series (the app):  Alpha Vantage (if key + daily
//   budget remain) -> "not observable", with the reason attached and warned.
//
//   Dated history (the scorer, quant evidence):  Yahoo chart -> "none", with
//   the reason attached.
//
// Never guessed, never omitted, and never silent about why.
//
// AV free tier is 25 calls/day. A 50-name queue blows that on run one, so every
// AV call is counted against a per-day budget persisted to db/av-usage.json.
// (HANDOFF-code issues #4 and #7.)
//
// STOOQ WAS REMOVED 2026-10-04. It used to be the keyless fallback on both
// chains. Its history endpoint has served a JavaScript bot-wall since
// 2026-07-28 and its quote endpoint now answers 404, so every call fell
// through to "not observable" without a word. A fallback that cannot succeed
// only hides the failure of the thing in front of it.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, AV } from "./config.js";
import { CRYPTO_TICKERS } from "./scoring.js";

const USAGE_PATH = resolve(ROOT, "db/av-usage.json");
export const NOT_OBSERVABLE = "not observable";

// ---- AV daily budget ledger ----
function today() {
  return new Date().toISOString().slice(0, 10);
}
function loadUsage() {
  try {
    const u = JSON.parse(readFileSync(USAGE_PATH, "utf8"));
    if (u.date === today()) return u;
  } catch {
    /* fresh */
  }
  return { date: today(), used: 0 };
}
function spendAV() {
  const u = loadUsage();
  u.used += 1;
  writeFileSync(USAGE_PATH, JSON.stringify(u) + "\n");
}
export function avRemaining() {
  return Math.max(0, AV.dailyBudget - loadUsage().used);
}
function avAvailable() {
  return Boolean(AV.key) && avRemaining() > 0;
}

// ---- Symbol mapping ----
// The crypto universe is owned by scoring.js — it is the module with no
// dependencies, and the verdict rule needs the same list this layer does.
const CRYPTO = CRYPTO_TICKERS;
export function classify(ticker) {
  return CRYPTO.has(ticker.toUpperCase()) ? "crypto" : "equity";
}

// ---- Fetch helpers ----
async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "the-bench-runner" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

// A missing price is reported once per distinct reason per process: loud
// enough to be seen, not a line per ticker on a 50-name queue. stderr, so the
// MCP server's stdout protocol stream is never touched.
const warned = new Set();
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[dataProviders] ${message}`);
}

// Why there is no live price for this ticker, as a sentence.
function noLiveSource(kind, avError) {
  if (avError) return `Alpha Vantage failed (${avError}) and there is no second live source`;
  if (kind === "crypto") return "no live source for crypto — Alpha Vantage is equity-only here";
  if (!AV.key) return "no live source — Alpha Vantage key is not set (ALPHAVANTAGE_KEY)";
  return `no live source — Alpha Vantage daily budget of ${AV.dailyBudget} is spent`;
}

// Alpha Vantage GLOBAL_QUOTE -> latest price.
async function avQuote(ticker) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(
    ticker
  )}&apikey=${AV.key}`;
  spendAV();
  const data = JSON.parse(await fetchText(url));
  const q = data["Global Quote"];
  const price = q && Number(q["05. price"]);
  if (!price || Number.isNaN(price)) throw new Error("AV: no price (rate-limited or unknown symbol)");
  return { price, asof: q["07. latest trading day"] || today() };
}

// Alpha Vantage daily series -> array of closes (oldest -> newest).
async function avDailyCloses(ticker) {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
    ticker
  )}&outputsize=compact&apikey=${AV.key}`;
  spendAV();
  const data = JSON.parse(await fetchText(url));
  const series = data["Time Series (Daily)"];
  if (!series) throw new Error("AV: no series");
  return Object.keys(series)
    .sort()
    .map((d) => Number(series[d]["4. close"]));
}

// ---- Public: one quote with full provenance ----
// Returns { ticker, price, source, asof, provisional }, or price =
// NOT_OBSERVABLE with `error` saying why.
export async function getQuote(ticker) {
  const kind = classify(ticker);
  let avError = null;
  if (kind === "equity" && avAvailable()) {
    try {
      const { price, asof } = await avQuote(ticker);
      return { ticker, price, source: "alphavantage", asof, provisional: false };
    } catch (err) {
      avError = err.message;
    }
  }
  const error = noLiveSource(kind, avError);
  warnOnce(`quote not observable: ${error}`);
  return { ticker, price: NOT_OBSERVABLE, source: "none", asof: null, provisional: true, error };
}

// ---- Yahoo chart API: keyless dated history ----
//
// Yahoo's chart endpoint needs no key, carries dates, and covers both equities
// and crypto. Its `close` is SPLIT-ADJUSTED all the way back (and not
// dividend-adjusted), so the split events are fetched with it: a price logged
// before a split is on a different share basis from every bar in the series.

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

// Coins Yahoo lists under a numbered symbol. The plain pair answers 404, which
// is how B-017 (HYPE) was closed as Unscored without ever being priced.
const YAHOO_CRYPTO_SYMBOL = { HYPE: "HYPE32196-USD" };

export function yahooSymbol(ticker, kind) {
  const t = ticker.toUpperCase();
  if (kind !== "crypto") return t;
  return YAHOO_CRYPTO_SYMBOL[t] ?? `${t}-USD`;
}

// Pure: chart JSON -> [{date, close}]. A missing or error payload maps to [],
// never to a throw and never to a zero-filled bar.
export function mapYahooBars(json) {
  const result = json?.chart?.result?.[0];
  const stamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(stamps) || !Array.isArray(closes)) return [];
  const bars = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const close = closes[i];
    if (typeof close !== "number" || Number.isNaN(close)) continue;
    bars.push({ date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), close });
  }
  return bars;
}

// Pure: chart JSON -> [{date, numerator, denominator}], oldest first. A
// 1-for-30 reverse split is 1/30; a 20-for-1 forward split is 20/1. The date
// is the first session that trades on the new basis. An event without a
// usable ratio is dropped, never guessed.
export function mapYahooSplits(json) {
  const events = json?.chart?.result?.[0]?.events?.splits;
  if (!events || typeof events !== "object") return [];
  return Object.values(events)
    .filter((e) => typeof e?.date === "number" && e.numerator > 0 && e.denominator > 0)
    .map((e) => ({
      date: new Date(e.date * 1000).toISOString().slice(0, 10),
      numerator: e.numerator,
      denominator: e.denominator
    }))
    .sort((x, y) => x.date.localeCompare(y.date));
}

async function yahooDatedCloses(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=1d&events=split`;
  const res = await fetch(url, { headers: { "user-agent": BROWSER_UA } });
  if (!res.ok) throw new Error(`yahoo: ${res.status}`);
  const json = await res.json();
  const bars = mapYahooBars(json);
  if (!bars.length) throw new Error("yahoo: no bars");
  return { bars, splits: mapYahooSplits(json) };
}

// Dated closes for scoring past checkpoints — "what did this close at on X".
//
// Yahoo only. Alpha Vantage is deliberately not used: its free tier is 25
// calls/day and already metered, and scoring the book costs rows x horizons x
// 2 symbols. (docs/scorecard-spec.md)
//
// Returns { bars, splits, source: "yahoo" }, or { bars: [], splits: [],
// source: "none", error } — the caller decides how loud to be, and the scorer
// prints every failure by name.
export async function getDatedCloses(ticker, { range = "1y" } = {}) {
  const kind = classify(ticker);
  try {
    const { bars, splits } = await yahooDatedCloses(yahooSymbol(ticker, kind), range);
    return { bars, splits, source: "yahoo" };
  } catch (err) {
    return { bars: [], splits: [], source: "none", error: err.message };
  }
}

// Close series for indicators, same chain as getQuote.
export async function getDailyCloses(ticker) {
  const kind = classify(ticker);
  let avError = null;
  if (kind === "equity" && avAvailable()) {
    try {
      return { closes: await avDailyCloses(ticker), source: "alphavantage", provisional: false };
    } catch (err) {
      avError = err.message;
    }
  }
  const error = noLiveSource(kind, avError);
  warnOnce(`close series not observable: ${error}`);
  return { closes: [], source: "none", provisional: true, error };
}
