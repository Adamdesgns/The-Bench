// options-hunter.mjs — watch ~100 setups at once, put a graded probability on each, rank by
// expected value per session, and hand the desk the three best. Both sides. Defined-risk only.
//
//   HUNT (screen + base rates; no options data needed):
//     node scripts/options-hunter.mjs --hunt [--symbols A,B | --universe board|watchlist|all] [--account N] [--write] [--json]
//     node scripts/options-hunter.mjs --hunt --bars-file f.json          offline: {SYM:[{date,open,high,low,close,volume}], SPY:[...]}
//     -> prints candidates; --write saves db/hunts/options/YYYY-MM-DD.candidates.json
//
//   RANK (after the routine has pulled option marks through the Robinhood MCP):
//     node scripts/options-hunter.mjs --ev-file marks.json --candidates db/hunts/options/YYYY-MM-DD.candidates.json [--band 303] [--top 3] [--write]
//     marks.json = { "SYM": { "expiry":"2026-09-25", "days":7, "long":{"strike":850,"mark":63.85,"chance_of_profit":0.31,"delta":0.52},
//                              "short":{"strike":950,"mark":30.25,"delta":0.31} }, ... }
//     -> EV per session, max loss <= band, disagreement between the desk's p and the market's p; top N.
//
// WHY THIS EXISTS (2026-09-16, Adam: "you have the ability to watch 100 different set ups at once and
// generate probabilities for those trades and bring me the best probabilities and faster payout")
// ----------------------------------------------------------------------------------------------
// The desk already owned every piece: a long hunt (RS acceleration), HUNT SHORT (breakdowns), the
// evidence engine (server/evidence.js, graded base rates), and the Robinhood option chain with the
// broker's chance-of-profit on every contract. Nothing joined them. This does, in the open:
//   1. Both screens run on the same bars (long: breakout of the prior 20-session high on volume,
//      leader vs SPY; short: HUNT SHORT's gates). Each hit gets a stop, a verified target, and R:R.
//   2. Each hit gets a BASE RATE from its own history: how often did this shape, at this horizon,
//      (a) move in the trade's direction and (b) move at least as far as the target? Graded A-F by
//      independent sample size and regime span (the grade is the point; a D never outranks the tape).
//   3. The routine pulls 1-2 week option marks and this script computes, per candidate spread:
//      cost, max gain, EV = p_reach x max gain - (1 - p_dir) x cost, EV per session, and the gap
//      between the desk's p and the broker's chance of profit. Max loss <= the band or it is out.
//   4. Top three by EV per session. The desk still verifies the catalyst gate and judges each one.
//
// WHAT A PROBABILITY IS HERE: a count of what happened the last N times, with a grade that says how
// little to trust it. Never a buy signal (v28 QUANT EVIDENCE). Nothing here is a ticket.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { sma, atr14, pct, verifiedFloor, screenSymbol as screenShort, DEFAULTS as SHORT_DEFAULTS } from "./hunt-short.mjs";
import { detectEvents, independentCount, forwardReturns, summarize, gradeEvidence, barsSpanYears } from "../server/evidence.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const r2 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Number(x.toFixed(2)));

export const DEFAULTS = { volMin: 1.5, horizon: 10, lookback: 20, expiryDays: [7, 14], top: 3, macroCap: 60, pivotWidth: 5 };

// ---------- long side ----------
export function verifiedCeiling(bars, price, width = DEFAULTS.pivotWidth, skip = 1) {
  let best = null;
  for (let i = width; i < bars.length - skip - width; i++) {
    const hi = bars[i].high;
    if (!(hi > price)) continue;
    let pivot = true;
    for (let k = 1; k <= width && pivot; k++) if (bars[i - k].high >= hi || bars[i + k].high >= hi) pivot = false;
    if (pivot && (best === null || hi < best.level)) best = { level: hi, date: bars[i].date };
  }
  return best;
}

// Mirror of hunt-short's payingFloor: walk verified ceilings up until one pays minRR against the stop.
export function payingCeiling(bars, price, stop, atr, { minRR = 2, maxAtr = 6, width = DEFAULTS.pivotWidth } = {}) {
  const risk = price - stop;
  let level = price, shelf = null, first = null;
  for (let i = 0; i < 12; i++) {
    shelf = verifiedCeiling(bars, level, width);
    if (!shelf) return { first, paying: null };
    if (!first) first = shelf;
    if ((shelf.level - price) / atr > maxAtr) return { first, paying: null, too_far: shelf };
    if (risk > 0 && (shelf.level - price) / risk >= minRR) return { first, paying: shelf };
    level = shelf.level;
  }
  return { first, paying: null };
}

export function screenLong(sym, bars, spy, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const out = { sym, side: "long", ok: false };
  if (!bars || bars.length < 60 || !spy || spy.length < 25) { out.problem = "not enough bars"; return out; }
  const closes = bars.map((b) => b.close), vols = bars.map((b) => b.volume ?? 0);
  const last = bars.at(-1);
  const sma50 = sma(closes, 50), atr = atr14(bars);
  const prior20 = bars.slice(-21, -1);
  const high20 = Math.max(...prior20.map((b) => b.high));
  const vol30 = sma(vols.slice(0, -1), 30);
  const volRatio = vol30 ? last.volume / vol30 : null;
  const spyC = spy.map((b) => b.close);
  const rs20 = pct(closes, 20) - pct(spyC, 20), rs5 = pct(closes, 5) - pct(spyC, 5);
  const g1 = last.close > sma50 && last.close >= high20 && volRatio !== null && volRatio >= o.volMin;
  const g2 = rs20 > 0 && rs5 > 0;
  const low2 = Math.min(bars.at(-1).low, bars.at(-2).low);
  const stop = Math.min(last.close - atr, low2);
  const walk = payingCeiling(bars, last.close, stop, atr, { width: o.pivotWidth });
  const first = walk.first;            // nearest overhead shelf: where a rally stalls first
  const ceiling = walk.paying;         // the TARGET: first verified level that pays 2:1
  const ceiling2 = first && ceiling && first.level !== ceiling.level ? first : null;
  const rr = ceiling ? (ceiling.level - last.close) / (last.close - stop) : first ? (first.level - last.close) / (last.close - stop) : null;
  const ready = g1 && g2 && !!ceiling && rr >= 2;
  const list = ready ? "READY" : (g1 || g2) && ceiling && last.close > sma50 ? "STALK" : g2 && last.close > sma50 ? "DISCOVERY" : null;
  const volScore = volRatio === null ? 0 : Math.min(100, Math.round(volRatio / 2 * 100));
  const rrScore = rr === null ? 0 : Math.min(100, Math.round(rr / 3 * 100));
  const rsScore = Math.min(100, Math.max(0, Math.round(50 + rs20 * 5)));
  const distScore = ceiling ? ((ceiling.level - last.close) / atr < 1 ? 20 : (ceiling.level - last.close) / atr > 6 ? 40 : 100) : 0;
  let readiness = Math.round((volScore + rrScore + rsScore + distScore) / 4);
  if (o.macroInside2) readiness = Math.min(readiness, o.macroCap);
  Object.assign(out, {
    ok: true, date: last.date, close: r2(last.close), sma50: r2(sma50), atr: r2(atr), high20: r2(high20), volRatio: r2(volRatio), rs20: r2(rs20), rs5: r2(rs5),
    gates: { breakout: g1, leader: g2, catalyst: "OWED - desk verifies" },
    target: ceiling ? { level: r2(ceiling.level), date: ceiling.date } : null,
    first_shelf: first ? { level: r2(first.level), date: first.date, rr: r2((first.level - last.close) / (last.close - stop)) } : null,
    too_far: walk.too_far ? { level: r2(walk.too_far.level), date: walk.too_far.date } : null,
    target2: ceiling2 ? { level: r2(ceiling2.level), date: ceiling2.date, rr: r2((ceiling2.level - last.close) / (last.close - stop)) } : null,
    geometry: { entry: r2(last.close), stop: r2(stop), stop_atr: r2((last.close - stop) / atr), target: ceiling ? r2(ceiling.level) : null, rr: r2(rr) },
    readiness, list,
  });
  return out;
}

// ---------- base rates ----------
// p_dir   = share of past events that moved in the trade's direction by the horizon
// p_reach = share that moved at least as far as this trade's target (the payoff the spread needs)
export function baseRate(bars, side, horizon, targetPct, lookback = DEFAULTS.lookback) {
  const setup = { kind: side === "short" ? "breakdown" : "breakout", lookback };
  const events = detectEvents(bars, setup);
  const independent = independentCount(events, horizon);
  const { instances, pending } = forwardReturns(bars, events, horizon, null);
  const stats = summarize(instances);
  const spanYears = barsSpanYears(bars);
  const { grade, why } = gradeEvidence({ events: events.length, independent, spanYears, source: "bars" });
  const n = instances.length;
  const dir = side === "short" ? (x) => x.pct < 0 : (x) => x.pct > 0;
  const reach = side === "short" ? (x) => x.pct <= -Math.abs(targetPct) : (x) => x.pct >= Math.abs(targetPct);
  return {
    setup: setup.kind, horizon, n, independent, pending, span_years: spanYears, grade, why,
    p_dir: n ? r2((instances.filter(dir).length / n) * 100) : null,
    p_reach: n ? r2((instances.filter(reach).length / n) * 100) : null,
    avg_pct: stats.avg_pct, median_pct: stats.median_pct, target_pct: r2(targetPct),
  };
}

// ---------- candidates ----------
export function candidates(series, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const spy = series.SPY;
  const out = [], skipped = [];
  for (const [sym, bars] of Object.entries(series)) {
    if (sym === "SPY") continue;
    if (!Array.isArray(bars)) { skipped.push({ sym, problem: bars?.error ?? "no bars" }); continue; }
    for (const side of ["long", "short"]) {
      const r = side === "long" ? screenLong(sym, bars, spy, o) : { side: "short", ...screenShort(sym, bars, spy, { volMin: o.volMin, macroInside2: o.macroInside2 }) };
      if (!r.ok) { if (side === "long") skipped.push({ sym, problem: r.problem }); continue; }
      if (!r.list) continue;
      const g = r.geometry;
      const targetPct = g.target ? ((g.target - g.entry) / g.entry) * 100 : null;
      const evidence = targetPct === null ? null : baseRate(bars, side, o.horizon, targetPct, o.lookback);
      out.push({
        ...r, sym, side, evidence,
        spread_request: g.target ? { structure: side === "long" ? "call debit spread" : "put debit spread", expiry_days: o.expiryDays, long_strike_near: g.entry, short_strike_near: g.target, stop: g.stop, decide_by_sessions: 5 } : null,
      });
    }
  }
  // order: READY first, then by readiness; evidence grade breaks ties (A best)
  const gradeRank = { A: 0, B: 1, C: 2, D: 3, F: 4 };
  out.sort((a, b) => (a.list === "READY" ? 0 : 1) - (b.list === "READY" ? 0 : 1) || b.readiness - a.readiness || (gradeRank[a.evidence?.grade?.[0]] ?? 9) - (gradeRank[b.evidence?.grade?.[0]] ?? 9));
  return { candidates: out, skipped };
}

// ---------- EV ranking ----------
export function evRank(cands, marks, { band = Infinity, top = DEFAULTS.top, horizon = DEFAULTS.horizon } = {}) {
  const rows = [], rejected = [];
  for (const c of cands) {
    const m = marks[c.sym] ?? marks[`${c.sym}:${c.side}`];
    if (!m || !m.long || !m.short) { rejected.push({ sym: c.sym, side: c.side, why: "no marks" }); continue; }
    const cost = r2((m.long.mark - m.short.mark) * 100);
    const width = r2(Math.abs(m.short.strike - m.long.strike) * 100);
    const maxGain = r2(width - cost);
    if (cost <= 0 || maxGain <= 0) { rejected.push({ sym: c.sym, side: c.side, why: "bad marks (cost or width <= 0)" }); continue; }
    if (cost > band) { rejected.push({ sym: c.sym, side: c.side, why: `max loss ${cost} > band ${r2(band)}` }); continue; }
    const ev = c.evidence ?? {};
    const pDir = (ev.p_dir ?? 0) / 100, pReach = (ev.p_reach ?? 0) / 100;
    const days = m.days ?? horizon;
    const evDollars = r2(pReach * maxGain - (1 - pDir) * cost);
    const marketP = m.long.chance_of_profit ?? null;
    rows.push({
      sym: c.sym, side: c.side, list: c.list, readiness: c.readiness, grade: ev.grade ?? "F", n: ev.n ?? 0,
      p_dir: ev.p_dir ?? null, p_reach: ev.p_reach ?? null, market_p: marketP === null ? null : r2(marketP * 100),
      disagreement: marketP === null || ev.p_dir == null ? null : r2(ev.p_dir - marketP * 100),
      expiry: m.expiry ?? null, days, long_strike: m.long.strike, short_strike: m.short.strike,
      cost, max_gain: maxGain, payoff_ratio: r2(maxGain / cost), break_even: r2(c.side === "long" ? m.long.strike + cost / 100 : m.long.strike - cost / 100),
      ev: evDollars, ev_per_day: r2(evDollars / Math.max(1, days)),
      stop: c.geometry.stop, target: c.geometry.target, rr_shares: c.geometry.rr,
    });
  }
  rows.sort((a, b) => b.ev_per_day - a.ev_per_day || b.ev - a.ev);
  return { top: rows.slice(0, top), rest: rows.slice(top), rejected };
}

// ---------- data / io ----------
async function yahooBars(symbol, range = "5y") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TheBench options-hunter.mjs)" } });
  if (!res.ok) throw new Error(`yahoo ${symbol}: ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp ?? [], q = r?.indicators?.quote?.[0] ?? {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null || q.low?.[i] == null) continue;
    out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume?.[i] ?? 0 });
  }
  if (!out.length) throw new Error(`yahoo ${symbol}: no bars`);
  return out;
}

function defaultUniverse(which) {
  const syms = new Set();
  if (which === "board" || which === "all") {
    try { const b = JSON.parse(readFileSync(resolve(ROOT, "db/board.json"), "utf8")); const layers = Array.isArray(b.layers) ? b.layers : Object.values(b.layers ?? {}); for (const l of layers) for (const t of l.tickers ?? l.names ?? []) syms.add((t.sym ?? t.ticker ?? t).toUpperCase()); } catch {}
  }
  if (which === "watchlist" || which === "all") {
    try { const w = JSON.parse(readFileSync(resolve(ROOT, "db/watchlist.json"), "utf8")); for (const e of w) if (e.sym && !/^(CLOSED|PASS)$/.test(e.status ?? "")) syms.add(e.sym.toUpperCase()); } catch {}
  }
  for (const x of ["SPY", "QQQ", "IWM", "DIA", "SMH"]) syms.delete(x);
  return [...syms].filter((s) => /^[A-Z.]{1,6}$/.test(s));
}

function macroInside2(asof) {
  try {
    const raw = JSON.parse(readFileSync(resolve(ROOT, "db/catalysts.json"), "utf8"));
    const cats = Array.isArray(raw) ? raw : raw.catalysts ?? [];
    const d0 = new Date(asof + "T00:00:00Z");
    return cats.filter((c) => c.type === "macro").some((c) => { const diff = (new Date(c.date + "T00:00:00Z") - d0) / 864e5; return diff >= 0 && diff <= 3; });
  } catch { return false; }
}

const line = (c) => {
  const e = c.evidence, g = c.geometry;
  const shelf = c.first_shelf && (!g.target || c.first_shelf.level !== g.target) ? ` (first shelf ${c.first_shelf.level})` : "";
  return `  ${c.sym.padEnd(6)} ${c.side.padEnd(5)} ${c.list.padEnd(9)} ${String(c.close).padStart(9)}  stop ${String(g.stop).padStart(8)}  target ${String(g.target ?? (c.too_far ? "none<6ATR" : "-")).padStart(9)}${shelf}  R:R ${String(g.rr ?? "-").padStart(5)}  readiness ${String(c.readiness).padStart(3)}  base rate ${e ? `${e.p_dir}% dir / ${e.p_reach}% reach  n=${e.n}  grade ${e.grade}` : "n/a (no target)"}`;
};

async function main() {
  const account = Number(val("--account") ?? 0);
  const band = Number(val("--band") ?? (account ? account * 0.1 : 0)) || Infinity;
  const top = Number(val("--top") ?? DEFAULTS.top);
  const dir = resolve(ROOT, "db/hunts/options");

  if (val("--ev-file")) {
    const marks = JSON.parse(readFileSync(resolve(val("--ev-file")), "utf8"));
    const cfile = val("--candidates") ?? refuse("--candidates <file> is required with --ev-file");
    const cand = JSON.parse(readFileSync(resolve(cfile), "utf8"));
    const ranked = evRank(cand.candidates, marks, { band, top, horizon: cand.opts?.horizon ?? DEFAULTS.horizon });
    const receipt = { kind: "options-hunter-rank", asof: cand.asof, candidates_receipt: cand.id, band: band === Infinity ? null : band, generated: new Date().toISOString(), ...ranked };
    receipt.id = createHash("sha1").update(JSON.stringify(ranked)).digest("hex").slice(0, 8);
    if (has("--write")) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); const p = resolve(dir, `${cand.asof}.ranked.json`); writeFileSync(p, JSON.stringify(receipt, null, 2) + "\n"); receipt.wrote = p; }
    if (has("--json")) { console.log(JSON.stringify(receipt, null, 2)); return; }
    console.log(`OPTIONS HUNTER - RANK  ·  as of ${cand.asof}  ·  receipt ${receipt.id}  ·  band ${band === Infinity ? "none" : band}`);
    console.log(`  EV = p_reach x max gain - (1 - p_dir) x cost, per contract; EV/day = EV / sessions to expiry. p from the name's own history, graded. Nothing here is a ticket.`);
    console.log(`\nTOP ${top}`);
    if (!ranked.top.length) console.log("  (none clears the band)");
    for (const r of ranked.top) console.log(`  ${r.sym.padEnd(6)} ${r.side.padEnd(5)} ${r.expiry ?? ""} ${r.long_strike}/${r.short_strike}  cost ${r.cost}  max gain ${r.max_gain} (${r.payoff_ratio}x)  break-even ${r.break_even}  p_dir ${r.p_dir}% p_reach ${r.p_reach}% grade ${r.grade} n=${r.n}  market p ${r.market_p ?? "-"}%  gap ${r.disagreement ?? "-"}  EV ${r.ev}  EV/day ${r.ev_per_day}  stop ${r.stop} target ${r.target}`);
    if (ranked.rest.length) { console.log(`\nREST (${ranked.rest.length})`); for (const r of ranked.rest) console.log(`  ${r.sym.padEnd(6)} ${r.side.padEnd(5)} cost ${r.cost} EV/day ${r.ev_per_day} grade ${r.grade}`); }
    if (ranked.rejected.length) console.log(`\nrejected: ${ranked.rejected.map((x) => `${x.sym} ${x.side} (${x.why})`).join("; ")}`);
    if (receipt.wrote) console.log(`\nwrote ${receipt.wrote}`);
    return;
  }

  // --hunt
  const opts = { volMin: Number(val("--vol-min") ?? DEFAULTS.volMin), horizon: Number(val("--horizon") ?? DEFAULTS.horizon) };
  let series = {}, source, universe;
  if (val("--bars-file")) { series = JSON.parse(readFileSync(resolve(val("--bars-file")), "utf8")); source = "file"; universe = "file"; }
  else {
    const symbolsArg = val("--symbols");
    universe = symbolsArg ? "named" : val("--universe") ?? "all";
    const syms = symbolsArg ? symbolsArg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : defaultUniverse(universe);
    source = "yahoo";
    series.SPY = await yahooBars("SPY", "1y");
    for (const s of syms) { try { series[s] = await yahooBars(s); } catch (e) { series[s] = { error: e.message }; } }
  }
  const asof = series.SPY?.at?.(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const macro = macroInside2(asof);
  const { candidates: cands, skipped } = candidates(series, { ...opts, macroInside2: macro });
  const receipt = { kind: "options-hunter-candidates", asof, source, universe, generated: new Date().toISOString(), macro_inside_2_sessions: macro, band: band === Infinity ? null : band, opts, scanned: Object.keys(series).length - 1, candidates: cands, skipped };
  receipt.id = createHash("sha1").update(JSON.stringify({ asof, cands })).digest("hex").slice(0, 8);
  if (has("--write")) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); const p = resolve(dir, `${asof}.candidates.json`); writeFileSync(p, JSON.stringify(receipt, null, 2) + "\n"); receipt.wrote = p; }
  if (has("--json")) { console.log(JSON.stringify(receipt, null, 2)); return; }
  console.log(`OPTIONS HUNTER - HUNT  ·  as of ${asof} (${source})  ·  scanned ${receipt.scanned}  ·  receipt ${receipt.id}  ·  macro inside 2 sessions: ${macro ? "YES - readiness capped " + DEFAULTS.macroCap : "no"}`);
  console.log(`  long: breakout of the prior 20-session high on >= ${opts.volMin}x volume, leader vs SPY · short: HUNT SHORT gates · target = nearest verified pivot · base rate at ${opts.horizon} sessions from the name's own history`);
  for (const L of ["READY", "STALK", "DISCOVERY"]) {
    const rows = cands.filter((c) => c.list === L);
    console.log(`\n${L} (${rows.length})`);
    if (!rows.length) console.log("  (none)");
    for (const c of rows) console.log(line(c));
  }
  const withReq = cands.filter((c) => c.spread_request && c.list !== "DISCOVERY");
  if (withReq.length) { console.log(`\nSPREAD REQUESTS for the routine (pull marks ${DEFAULTS.expiryDays[0]}-${DEFAULTS.expiryDays[1]} days out, then --ev-file):`); for (const c of withReq) console.log(`  ${c.sym} ${c.side}: ${c.spread_request.structure}, long strike near ${c.spread_request.long_strike_near}, short strike near ${c.spread_request.short_strike_near}, stop ${c.spread_request.stop}`); }
  if (skipped.length) console.log(`\nskipped: ${skipped.map((s) => `${s.sym} (${s.problem})`).join(", ")}`);
  if (receipt.wrote) console.log(`\nwrote ${receipt.wrote}`);
  console.log(`\nRule: every name here still runs the full v29 framework, verifies its catalyst, and gets a row. Nothing here is a ticket.`);
}

function refuse(msg) { console.error(`options-hunter: REFUSED - ${msg}`); process.exit(1); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`options-hunter: ${e.message}`); process.exit(1); });
}
