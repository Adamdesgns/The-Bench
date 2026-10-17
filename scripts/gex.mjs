// gex.mjs — THE FREE GAMMA HEAT MAP: where options dealers are estimated to be long or short gamma, by strike and expiry.
//
//   node scripts/gex.mjs --symbols SPY,QQQ [--window 7] [--days 35] [--write] [--json]
//   node scripts/gex.mjs --file chain.json --symbol SPY ...          offline (a saved CBOE chain)
//   --out <dir>   where --write saves receipts (default db/gex/), one file per symbol: <asof date>-<SYM>.json
//   --rate 0.045  the risk-free rate for the flip grid
//
// SOURCE: CBOE's free delayed-quote feed (cdn.cboe.com/api/global/delayed_quotes/options/<SYM>.json, index symbols
// take a leading underscore: _SPX, _NDX). One request returns the whole chain with gamma and open interest, about
// 15 minutes delayed. Checked 2026-10-17 against Robinhood: open interest matched to the contract (SPY 10/23 760P,
// 10,019), gamma within 7%. Free First: this replaces paid tools such as Skylit's Heatseeker for our use.
//
// THE NUMBER: dollar gamma per 1% move = gamma x open interest x 100 x spot^2 x 0.01, calls counted positive and
// puts negative. That sign is an ASSUMPTION (the usual one): customers buy calls and puts, so dealers are short puts
// and long calls. Nobody can see dealer books. Positive gamma: dealers trade against the move, so moves tend to stall
// and price gets pulled toward big strikes. Negative gamma: dealers trade with the move, so moves tend to extend.
//
// THE LEVELS:
//   king node  the strike with the biggest total, either sign (the strongest magnet or accelerant)
//   call wall  the strike with the biggest call-side total (a ceiling in positive gamma)
//   put wall   the strike with the biggest put-side total (a floor that can break hard)
//   flip       the price where the net total changes sign, found by re-pricing every contract's gamma
//              (Black-Scholes, its own implied vol) on a grid of spot prices; null when no sign change is in range
//
// SUPPORTING EVIDENCE ONLY (Adam, 2026-10-17): a level from this file can support a stop, a target or a read. It is
// never a buy signal, never a reason to enter, and it never outranks the price levels the framework verifies. It is a
// model of positioning, not observed positioning. Zero-dep. Tests: test/gex.test.mjs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 864e5;

export function parseOcc(sym) {
  const m = /^([A-Z_]+?)(\d{6})([CP])(\d{8})$/.exec(String(sym));
  if (!m) return null;
  const [, root, d, type, k] = m;
  return { root, expiry: `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`, type, strike: Number(k) / 1000 };
}

const phi = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
export function bsGamma(S, K, T, iv, r = 0.045) {
  if (!(T > 0) || !(iv > 0) || !(S > 0) || !(K > 0)) return 0;
  const v = iv * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * iv * iv) * T) / v;
  return phi(d1) / (S * v);
}

const asofMs = (ts) => Date.parse(String(ts).replace(" ", "T") + (/[zZ+]/.test(String(ts).slice(10)) ? "" : "Z"));
// Expiry at the 4:00 pm ET close, taken as 20:00 UTC. An hour off in winter only matters on expiry day itself.
const yearsTo = (expiry, now) => (Date.parse(`${expiry}T20:00:00Z`) - now) / (365 * DAY);

export function buildGex(raw, { window = 7, days = 35, rate = 0.045 } = {}) {
  const spot = Number(raw?.data?.current_price);
  if (!(spot > 0)) throw new Error("the chain has no current_price");
  const now = asofMs(raw.timestamp);
  if (!Number.isFinite(now)) throw new Error("the chain has no usable timestamp");
  const lo = spot * (1 - window / 100), hi = spot * (1 + window / 100);
  const lastExpiry = now + days * DAY;
  const dollar = (gamma, oi, S) => gamma * oi * 100 * S * S * 0.01;

  const kept = [];
  let dropped = 0;
  for (const o of raw.data.options ?? []) {
    const p = parseOcc(o.option);
    const oi = Number(o.open_interest) || 0;
    if (!p || oi <= 0) continue;
    const T = yearsTo(p.expiry, now);
    if (T <= 0) continue;
    if (p.strike < lo || p.strike > hi || Date.parse(`${p.expiry}T20:00:00Z`) > lastExpiry) { dropped++; continue; }
    const sign = p.type === "C" ? 1 : -1;
    kept.push({ ...p, oi, T, iv: Number(o.iv) || 0, sign, g: sign * dollar(Number(o.gamma) || 0, oi, spot) });
  }

  const expiries = [...new Set(kept.map((k) => k.expiry))].sort();
  const byStrike = new Map();
  for (const k of kept) {
    const s = byStrike.get(k.strike) ?? { strike: k.strike, total: 0, calls: 0, puts: 0, by: {} };
    s.total += k.g;
    if (k.sign > 0) s.calls += k.g; else s.puts += k.g;
    s.by[k.expiry] = (s.by[k.expiry] ?? 0) + k.g;
    byStrike.set(k.strike, s);
  }
  const strikes = [...byStrike.values()].sort((a, b) => b.strike - a.strike);
  const net = strikes.reduce((a, s) => a + s.total, 0);
  const pick = (f) => (strikes.length ? strikes.reduce((a, b) => (f(b) > f(a) ? b : a)) : null);
  const lvl = (s, v) => (s && v(s) !== 0 ? { strike: s.strike, gex: v(s) } : null);
  const king = pick((s) => Math.abs(s.total));
  const callWall = pick((s) => s.calls);
  const putWall = pick((s) => -s.puts);

  // The flip: re-price every kept contract's gamma at each grid spot, find where the net total changes sign.
  const step = spot * 0.0025;
  const netAt = (S) => kept.reduce((a, k) => a + k.sign * dollar(bsGamma(S, k.strike, k.T, k.iv, rate), k.oi, S), 0);
  const crossings = [];
  let prevS = lo, prev = netAt(lo);
  for (let S = lo + step; S <= hi + 1e-9; S += step) {
    const cur = netAt(S);
    if ((prev < 0 && cur >= 0) || (prev > 0 && cur <= 0)) {
      crossings.push(prevS + (S - prevS) * (Math.abs(prev) / (Math.abs(prev) + Math.abs(cur))));
    }
    prevS = S; prev = cur;
  }
  const flip = crossings.length ? Number(crossings.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a)).toFixed(2)) : null;

  return {
    kind: "gex",
    asof: String(raw.timestamp),
    spot,
    window,
    days,
    expiries,
    strikes: strikes.map((s) => ({ strike: s.strike, total: s.total, calls: s.calls, puts: s.puts })),
    grid: strikes.map((s) => expiries.map((e) => s.by[e] ?? 0)),
    net,
    regime: net >= 0 ? "positive" : "negative",
    levels: {
      king_node: lvl(king, (s) => s.total),
      call_wall: lvl(callWall, (s) => s.calls),
      put_wall: lvl(putWall, (s) => s.puts),
      flip,
    },
    dropped,
    source: "CBOE delayed quotes (free, about 15 min delayed)",
    convention: "calls +, puts - (assumes dealers long calls, short puts); dollars per 1% move",
    use: "supporting evidence only - never a buy signal",
  };
}

// CBOE stamps in UTC, and an index chain's stamp is the fetch time. A receipt is named for the New York session the
// data describes: before 9:30 am ET counts as the prior day, and a weekend steps back to Friday (holidays not handled).
export function nyDate(ts) {
  const ny = new Date(new Date(asofMs(ts)).toLocaleString("en-US", { timeZone: "America/New_York" }));
  if (ny.getHours() * 60 + ny.getMinutes() < 570) ny.setDate(ny.getDate() - 1);
  while (ny.getDay() === 0 || ny.getDay() === 6) ny.setDate(ny.getDate() - 1);
  return `${ny.getFullYear()}-${String(ny.getMonth() + 1).padStart(2, "0")}-${String(ny.getDate()).padStart(2, "0")}`;
}

const M = (v) => `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1e6).toFixed(0)}M`;

export function render(sym, g, cols = 6) {
  const ex = g.expiries.slice(0, cols);
  const lines = [];
  lines.push(`GAMMA HEAT MAP ${sym}  spot ${+g.spot.toFixed(2)}  as of ${g.asof}  (${g.source})`);
  lines.push(`dollar gamma per 1% move, ${g.convention}. Strikes within ${g.window}%, expiries within ${g.days} days; ${g.dropped} contracts outside dropped.`);
  lines.push(`${"strike".padStart(8)}${ex.map((e) => e.slice(5).padStart(8)).join("")}${"total".padStart(10)}`);
  const near = Math.min(...g.strikes.map((s) => Math.abs(s.strike - g.spot)));
  g.strikes.forEach((s, i) => {
    const row = ex.map((e) => (g.grid[i][g.expiries.indexOf(e)] / 1e6).toFixed(0).padStart(8)).join("");
    lines.push(`${String(s.strike).padStart(8)}${row}${(s.total / 1e6).toFixed(0).padStart(10)}${Math.abs(s.strike - g.spot) === near ? "  <- spot" : ""}`);
  });
  if (g.expiries.length > cols) lines.push(`(${g.expiries.length - cols} later expiries are in the total column, not shown)`);
  const L = g.levels;
  lines.push("");
  lines.push(`NET ${M(g.net)}: ${g.regime.toUpperCase()} GAMMA - ${g.regime === "negative" ? "dealers trade with the move, so moves tend to extend" : "dealers trade against the move, so moves tend to stall"}.`);
  lines.push(`KING NODE ${L.king_node ? `${L.king_node.strike} (${M(L.king_node.gex)})` : "none"}  CALL WALL ${L.call_wall ? `${L.call_wall.strike} (${M(L.call_wall.gex)})` : "none"}  PUT WALL ${L.put_wall ? `${L.put_wall.strike} (${M(L.put_wall.gex)})` : "none"}  FLIP ${L.flip ?? "none in range"}`);
  lines.push("A model of dealer positioning, not observed positioning. Supporting evidence only: never a buy signal.");
  return lines.join("\n");
}

async function fetchChain(sym) {
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(sym)}.json`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });
  if (!res.ok) throw new Error(`CBOE ${sym}: HTTP ${res.status}`);
  return res.json();
}

async function main(argv) {
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const opts = { window: Number(val("--window") ?? 7), days: Number(val("--days") ?? 35), rate: Number(val("--rate") ?? 0.045) };
  const file = val("--file");
  const syms = file ? [val("--symbol") ?? "FILE"] : String(val("--symbols") ?? val("--symbol") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!syms.length) { console.log("usage: gex.mjs --symbols SPY,QQQ [--window 7] [--days 35] [--write] [--json] | --file chain.json --symbol X"); process.exit(1); }
  const out = resolve(ROOT, val("--out") ?? "db/gex");
  const results = {};
  let failed = 0;
  for (const sym of syms) {
    try {
      const raw = file ? JSON.parse(readFileSync(file, "utf8")) : await fetchChain(sym);
      const g = { sym: sym.replace(/^_/, ""), ...buildGex(raw, opts) };
      results[g.sym] = g;
      if (argv.includes("--write")) {
        mkdirSync(out, { recursive: true });
        const p = join(out, `${nyDate(g.asof)}-${g.sym}.json`);
        writeFileSync(p, JSON.stringify(g) + "\n");
        if (!argv.includes("--json")) console.log(`wrote ${p}`);
      }
      if (!argv.includes("--json")) console.log(render(g.sym, g) + "\n");
    } catch (e) {
      failed++;
      console.error(`GEX ${sym} FAILED: ${e.message}`);
    }
  }
  if (argv.includes("--json")) console.log(JSON.stringify(syms.length === 1 ? Object.values(results)[0] ?? null : results, null, 1));
  if (failed) process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
