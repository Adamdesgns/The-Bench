// kalshi-odds.mjs — the crowd's odds on the events the desk trades around, read
// from Kalshi's free public market feed (no account, no key, read only).
//
//   node scripts/kalshi-odds.mjs                     macro + politics, one line per event
//   node scripts/kalshi-odds.mjs --series KXFEDDECISION,CONTROLS
//   node scripts/kalshi-odds.mjs --json              machine-readable
//   node scripts/kalshi-odds.mjs --write             also save db/kalshi/<date>.json (the record)
//   node scripts/kalshi-odds.mjs --file f.json       offline: {events:[...]} as the API returns them
//
// Exit 0 = at least one series read; exit 2 = nothing read or a hard failure.
//
// WHY THIS EXISTS (2026-11-03)
// ----------------------------
// Adam asked whether the desk could see Robinhood's prediction markets. The
// Robinhood connection cannot (its search refuses asset_type "event"), but most of
// Robinhood's event contracts are Kalshi's, and Kalshi publishes every price for
// free. A contract at 72 cents is the crowd putting about 72% on that outcome.
//
// HOW A PRICE BECOMES ODDS: the midpoint of the yes bid and ask when the spread
// is 10 cents or less; otherwise the last trade held inside the bid/ask, marked
// THIN. "chg" is against the same measure about 24 hours earlier.
//
// THREE SHAPES OF EVENT:
//   pick one   (Fed decision, House control) -> each live outcome at 3%+, best first
//   ladder     ("above 0.2%", "above 0.3%"…) -> the middle of the crowd's range,
//              plus the four rungs nearest even money
//   yes/no     (recession this year)         -> the yes odds
//
// PERCENT LADDERS SETTLE ON ONE-DECIMAL PRINTS (reviewer, 2026-11-03): on CPI,
// "above 0.2%" pays only on 0.3% or higher, so the middle is a print, not a point
// between rungs. The old straight-line guess read 0.23% when the crowd's center
// was 0.3% (49% on exactly 0.3%). Count ladders (payrolls) still interpolate.
//
// Crowd odds are quoted, never a desk prediction and never a buy signal.
// Nothing here places or suggests a bet.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.elections.kalshi.com/trade-api/v2";
export const DEFAULT_SERIES = [
  "KXFEDDECISION", "KXCPI", "KXCPICORE", "KXPAYROLLS", "KXU3", "KXRECSSNBER", "CONTROLH", "CONTROLS",
];

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

// ── math ────────────────────────────────────────────────────────────────────

const num = (x) => (x === undefined || x === null || x === "" ? null : Number(x));
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

// One side of the book (now or ~24h ago) as a probability, 0..1.
function price(bid, ask, last) {
  if (bid !== null && ask !== null && ask > 0 && ask - bid <= 0.1) return { p: (bid + ask) / 2, thin: false };
  if (last === null || Number.isNaN(last)) return null;
  // A stale last trade outside a live (if wide) book is not today's price.
  if (bid !== null && ask !== null && ask > 0) return { p: clamp(last, bid, ask), thin: true };
  return { p: last, thin: true };
}

export function odds(m) {
  const now = price(num(m.yes_bid_dollars), num(m.yes_ask_dollars), num(m.last_price_dollars));
  if (!now) return null;
  const before = price(num(m.previous_yes_bid_dollars), num(m.previous_yes_ask_dollars), num(m.previous_price_dollars));
  return { pct: Math.round(now.p * 100), chg: before ? Math.round((now.p - before.p) * 100) : null, thin: now.thin };
}

// rungs: ascending strikes, pct = P(above strike).
// Discrete (one-decimal % prints): the middle is the lowest print with 50%+ on
// "that or higher", with the odds of landing exactly on it.
// Continuous (counts): straight line between the two rungs around 50%.
// Returns {kind: "at"|"below"|"above", value, exact?} or null.
export function middleGuess(rungs, step = null) {
  if (!rungs.length) return null;
  if (step) {
    let i = -1;
    for (let k = 0; k < rungs.length; k++) if (rungs[k].pct >= 50) i = k;
    if (i < 0) return { kind: "below", value: rungs[0].strike + step };
    if (i === rungs.length - 1) return { kind: "above", value: rungs[i].strike };
    const value = Math.round((rungs[i].strike + step) * 1000) / 1000;
    return { kind: "at", value, exact: rungs[i].pct - rungs[i + 1].pct };
  }
  for (let i = 1; i < rungs.length; i++) {
    const a = rungs[i - 1], b = rungs[i];
    if (a.pct >= 50 && b.pct < 50) {
      return { kind: "at", value: a.strike + ((a.pct - 50) / (a.pct - b.pct)) * (b.strike - a.strike) };
    }
  }
  return rungs[0].pct < 50 ? { kind: "below", value: rungs[0].strike } : { kind: "above", value: rungs[rungs.length - 1].strike };
}

const active = (e) => (e.markets || []).filter((m) => m.status === "active");
const closeOf = (e) => active(e).map((m) => m.close_time).filter(Boolean).sort()[0] || "";

// The open event that closes soonest in each series.
export function pickEvent(events) {
  return events.filter((e) => active(e).length).sort((a, b) => closeOf(a).localeCompare(closeOf(b)))[0] || null;
}

// Smallest gap between strikes, when every strike sits on a 0.1 grid.
function decimalStep(strikes) {
  if (strikes.some((s) => Math.abs(s * 10 - Math.round(s * 10)) > 1e-9)) return null;
  let step = Infinity;
  for (let i = 1; i < strikes.length; i++) step = Math.min(step, strikes[i] - strikes[i - 1]);
  return Number.isFinite(step) && step > 0 ? Math.round(step * 10) / 10 : null;
}

export function summarize(e) {
  const all = e.markets || [];
  const ms = active(e);
  const base = { event: e.event_ticker, title: e.title, closes: closeOf(e) };
  // Shape comes from every market in the event, so a half-closed event keeps its shape.
  const ladder = !e.mutually_exclusive && all.length > 1 && all.every((m) => m.strike_type === "greater" && m.floor_strike != null);
  if (ladder) {
    const rungs = ms
      .map((m) => ({ strike: Number(m.floor_strike), label: m.yes_sub_title, ...odds(m) }))
      .filter((r) => r.pct !== undefined)
      .sort((a, b) => a.strike - b.strike);
    // The four rungs nearest even money, in strike order: enough to see the shape.
    const near = rungs
      .filter((r) => r.pct >= 10 && r.pct <= 90)
      .sort((a, b) => Math.abs(a.pct - 50) - Math.abs(b.pct - 50))
      .slice(0, 4)
      .sort((a, b) => a.strike - b.strike);
    const unit = rungs.some((r) => /%/.test(r.label || "")) ? "%" : "";
    const step = unit ? decimalStep(rungs.map((r) => r.strike)) : null;
    return { ...base, shape: "ladder", middle: middleGuess(rungs, step), unit, rungs: near };
  }
  const outs = ms
    .map((m) => ({ label: m.yes_sub_title || m.title, ...odds(m) }))
    .filter((o) => o.pct !== undefined);
  if (all.length === 1) return { ...base, shape: "yesno", outcomes: outs.map((o) => ({ ...o, label: "yes" })) };
  return { ...base, shape: "pick", outcomes: outs.filter((o) => o.pct >= 3).sort((a, b) => b.pct - a.pct) };
}

// ── words ───────────────────────────────────────────────────────────────────

const TZ = "America/Chicago";
const day = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }) : "?";
const chg = (c) => (c === null || c === 0 ? "" : ` (${c > 0 ? "+" : ""}${c})`);
const one = (o) => `${o.label} ${o.pct}%${chg(o.chg)}${o.thin ? " THIN" : ""}`;
const round = (x) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString("en-US") : String(Math.round(x * 100) / 100));

export function line(s) {
  const head = `${s.title} [${s.event}, closes ${day(s.closes)}]`;
  if (s.shape === "ladder") {
    const m = s.middle, u = s.unit || "";
    const mid = !m ? "no read"
      : m.kind === "at" ? `middle ${round(m.value)}${u}${m.exact !== undefined ? ` (${m.exact}% on exactly that)` : ""}`
      : m.kind === "below" ? `under ${round(m.value)}${u} favored` : `over ${round(m.value)}${u} favored`;
    return `${head}: ${mid}${s.rungs.length ? "; " + s.rungs.map(one).join(", ") : ""}`;
  }
  return `${head}: ${s.outcomes.map(one).join(", ") || "no live outcome"}`;
}

// ── io ──────────────────────────────────────────────────────────────────────

async function fetchSeries(series) {
  const url = `${API}/events?series_ticker=${series}&status=open&limit=50&with_nested_markets=true`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${series}: HTTP ${r.status}`);
  return (await r.json()).events || [];
}

async function main() {
  const series = (val("--series") || DEFAULT_SERIES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  let offline = null;
  if (val("--file")) {
    offline = JSON.parse(readFileSync(val("--file"), "utf8")).events;
    if (!Array.isArray(offline)) throw new Error(`${val("--file")}: no events array`);
  }
  const out = [], errors = [];
  for (const s of series) {
    try {
      const events = offline ? offline.filter((e) => e.series_ticker === s) : await fetchSeries(s);
      const e = pickEvent(events);
      if (e) out.push({ series: s, ...summarize(e) });
      else errors.push(`${s}: no open event`);
    } catch (err) {
      errors.push(`${s}: ${err.message}`);
    }
  }
  const asof = new Date().toISOString();
  const ct = new Date(asof).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (has("--json")) console.log(JSON.stringify({ asof, events: out, errors }, null, 2));
  else {
    console.log(`KALSHI ODDS — the crowd's price, not a signal (${ct} CT)`);
    for (const s of out) console.log("- " + line(s));
    for (const e of errors) console.log("! " + e);
  }
  if (out.length === 0) process.exit(2); // never overwrite a good snapshot with an empty one
  if (has("--write")) {
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const dir = resolve(ROOT, "db/kalshi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${date}.json`), JSON.stringify({ asof, events: out, errors }, null, 2) + "\n");
    console.error(`wrote db/kalshi/${date}.json`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`kalshi-odds: ${err.message}`);
    process.exit(2);
  });
}
