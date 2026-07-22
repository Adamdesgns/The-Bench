// dataProviders.js — live market data with a hard fallback chain.
//
//   Alpha Vantage (if key + daily budget remain) -> Stooq (delayed/provisional)
//   -> "not observable" (never guessed, never omitted).
//
// AV free tier is 25 calls/day. A 50-name queue blows that on run one, so every
// AV call is counted against a per-day budget persisted to db/av-usage.json.
// Once spent, the layer degrades to Stooq and labels those numbers provisional.
// (HANDOFF-code issues #4 and #7.)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, AV } from "./config.js";

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
// Crypto tickers -> Stooq crypto symbols (btcusd, ethusd, ...).
const CRYPTO = new Set(["BTC", "ETH", "BNB", "XRP", "SOL", "TRX", "DOGE", "HYPE", "XLM", "ADA", "LTC"]);
function stooqSymbol(ticker, kind) {
  if (kind === "crypto") return `${ticker.toLowerCase()}usd`;
  return `${ticker.toLowerCase()}.us`; // US equities on Stooq
}
export function classify(ticker) {
  return CRYPTO.has(ticker.toUpperCase()) ? "crypto" : "equity";
}

// ---- Fetch helpers ----
async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "the-bench-runner" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
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

// Stooq single-quote CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
async function stooqQuote(symbol) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
  const csv = await fetchText(url);
  const line = csv.trim().split("\n")[1];
  if (!line) throw new Error("stooq: empty");
  const cols = line.split(",");
  const close = Number(cols[6]);
  if (!close || Number.isNaN(close)) throw new Error("stooq: no close");
  return { price: close, asof: cols[1] || today() };
}

// Stooq daily history CSV -> closes (oldest -> newest).
async function stooqDailyCloses(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const csv = await fetchText(url);
  const lines = csv.trim().split("\n").slice(1);
  const closes = lines.map((l) => Number(l.split(",")[4])).filter((n) => !Number.isNaN(n));
  if (!closes.length) throw new Error("stooq: no history");
  return closes;
}

// ---- Public: one quote with full provenance ----
// Returns { ticker, price, source, asof, provisional } or price = NOT_OBSERVABLE.
export async function getQuote(ticker) {
  const kind = classify(ticker);
  if (kind === "equity" && avAvailable()) {
    try {
      const { price, asof } = await avQuote(ticker);
      return { ticker, price, source: "alphavantage", asof, provisional: false };
    } catch {
      /* fall through to Stooq */
    }
  }
  try {
    const { price, asof } = await stooqQuote(stooqSymbol(ticker, kind));
    return { ticker, price, source: "stooq", asof, provisional: true };
  } catch {
    return { ticker, price: NOT_OBSERVABLE, source: "none", asof: null, provisional: true };
  }
}

// Close series for indicators, same fallback chain.
export async function getDailyCloses(ticker) {
  const kind = classify(ticker);
  if (kind === "equity" && avAvailable()) {
    try {
      return { closes: await avDailyCloses(ticker), source: "alphavantage", provisional: false };
    } catch {
      /* fall through */
    }
  }
  try {
    return { closes: await stooqDailyCloses(stooqSymbol(ticker, kind)), source: "stooq", provisional: true };
  } catch {
    return { closes: [], source: "none", provisional: true };
  }
}
