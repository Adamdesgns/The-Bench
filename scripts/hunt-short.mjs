// hunt-short.mjs — HUNT SHORT: source the downside on purpose, then let the desk judge it.
//
//   node scripts/hunt-short.mjs                                  board + watchlist universe, print
//   node scripts/hunt-short.mjs --symbols GRAB,HPE,CEG,ORCL      a named list
//   node scripts/hunt-short.mjs --universe board|watchlist|all   (default all)
//   node scripts/hunt-short.mjs --write                          also write db/hunts/short/YYYY-MM-DD.json (the receipt)
//   node scripts/hunt-short.mjs --json                           machine-readable
//   node scripts/hunt-short.mjs --bars-file f.json               offline: {SYM:[{date,open,high,low,close,volume}], SPY:[...]}
//   node scripts/hunt-short.mjs --account 3030 [--band 303]      band for the put-spread max loss (default 10 pct of --account)
//   node scripts/hunt-short.mjs --vol-min 1.5 --cap 3            screen knobs (defaults shown)
//
// WHY THIS EXISTS (2026-09-16, Adam: "we need to start eyeing quicker plays like this puts or what shorts")
// ------------------------------------------------------------------------------------------------------
// v23 made the short side "evaluated automatically on every scan", but nothing ever
// HUNTED for it. The hunter fires on relative-strength acceleration, a long-only
// screen, so shorts only reached the desk as longs that broke. GRAB (B-415) arrived
// with all three short gates passing and no verified target, because nobody was
// looking for that setup on purpose. This script looks for it on purpose.
//
// WHAT IT DOES AND DOES NOT DO
//   - Screens the universe for the BREAKDOWN shape on the last settled bar:
//       G1 breakdown  close < 50-day SMA, close at/under the prior 20-session low, volume >= vol-min x 30-day avg
//       G2 laggard    20- and 5-session return both behind SPY
//       G3 catalyst   NOT computable here. Printed as OWED: the desk verifies a live catalyst
//                     (news, filing, guide, insider file) before anything is READY for a ticket.
//   - Finds a VERIFIED FLOOR: the nearest pivot low BELOW the close in up to five years of bars
//     (a pivot = a low lower than the 5 bars either side). No pivot below = NO VERIFIED FLOOR,
//     and the name cannot show 2:1, which is exactly the GRAB gap.
//   - Geometry (short): entry = close, stop = the higher of (close + 1.0 ATR) and the 2-session high,
//     target = the verified floor, R:R = (close - floor) / (stop - close). 2:1 or it is not READY.
//   - Readiness (0-100), capped at 60 when a macro row on the catalyst board sits inside 2 sessions.
//   - Lists: READY (G1 + G2 + verified floor + 2:1), capped at --cap (3); STALK (G1 or G2 with a floor);
//     DISCOVERY (below the 50-day and lagging, no break yet).
//   - Structure line: a defined-risk PUT SPREAD, long strike near the close, short strike near the floor,
//     MAX LOSS <= the band. The script cannot price options; the desk prices the spread at the open.
//   - Clock: decide-by 5 sessions. Short setups resolve in days; the 8-week swing window does not apply.
//
// WHAT IT NEVER DOES: place anything, size past the band, or skip a gate. Every hit still runs the
// full v29 framework and gets logged with log-call.mjs. Zero dependencies, read-only unless --write.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

export const DEFAULTS = { volMin: 1.5, cap: 3, decideSessions: 5, pivotWidth: 5, macroCap: 60 };

// ---------- pure math ----------
export function sma(vals, n) { if (vals.length < n) return null; let s = 0; for (let i = vals.length - n; i < vals.length; i++) s += vals[i]; return s / n; }

export function atr14(bars, n = 14) {
  if (bars.length < n + 1) return null;
  const trs = [];
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)));
  }
  return trs.reduce((a, c) => a + c, 0) / n;
}

export function pct(closes, n) { if (closes.length < n + 1) return null; const a = closes.at(-1 - n), b = closes.at(-1); return ((b - a) / a) * 100; }

// Nearest pivot low strictly below `price`, searching all bars except the last `skip` (today's bar is not a pivot yet).
export function verifiedFloor(bars, price, width = DEFAULTS.pivotWidth, skip = 1) {
  let best = null;
  for (let i = width; i < bars.length - skip - width; i++) {
    const lo = bars[i].low;
    if (!(lo < price)) continue;
    let pivot = true;
    for (let k = 1; k <= width && pivot; k++) if (bars[i - k].low <= lo || bars[i + k].low <= lo) pivot = false;
    if (pivot && (best === null || lo > best.level)) best = { level: lo, date: bars[i].date };
  }
  return best;
}

// Walk the verified floors down until one pays `minRR` against the stop. The first shelf is still
// reported (it is where a bounce starts); the PAYING floor is the target a spread is built on.
// Gives up past `maxAtr` ATRs below price: a target six daily ranges away is not a 5-session play.
export function payingFloor(bars, price, stop, atr, { minRR = 2, maxAtr = 6, width = DEFAULTS.pivotWidth } = {}) {
  const risk = stop - price;
  let level = price, shelf = null, first = null;
  for (let i = 0; i < 12; i++) {
    shelf = verifiedFloor(bars, level, width);
    if (!shelf) return { first, paying: null };
    if (!first) first = shelf;
    if ((price - shelf.level) / atr > maxAtr) return { first, paying: null, too_far: shelf };
    if (risk > 0 && (price - shelf.level) / risk >= minRR) return { first, paying: shelf };
    level = shelf.level;
  }
  return { first, paying: null };
}

export function screenSymbol(sym, bars, spy, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const out = { sym, ok: false };
  if (!bars || bars.length < 60 || !spy || spy.length < 25) { out.problem = "not enough bars"; return out; }
  const closes = bars.map((b) => b.close), vols = bars.map((b) => b.volume ?? 0);
  const last = bars.at(-1);
  const sma50 = sma(closes, 50), sma20 = sma(closes, 20), atr = atr14(bars);
  const prior20 = bars.slice(-21, -1);
  const low20 = Math.min(...prior20.map((b) => b.low));
  const vol30 = sma(vols.slice(0, -1), 30);
  const volRatio = vol30 ? last.volume / vol30 : null;
  const spyC = spy.map((b) => b.close);
  const rs20 = pct(closes, 20) - pct(spyC, 20), rs5 = pct(closes, 5) - pct(spyC, 5);
  const g1 = last.close < sma50 && last.close <= low20 && volRatio !== null && volRatio >= o.volMin;
  const g2 = rs20 < 0 && rs5 < 0;
  const high2 = Math.max(bars.at(-1).high, bars.at(-2).high);
  const stop = Math.max(last.close + atr, high2);
  const walk = payingFloor(bars, last.close, stop, atr, { width: o.pivotWidth });
  const first = walk.first;                       // nearest shelf: where a bounce starts
  const floor = walk.paying;                      // the TARGET: first verified level that pays 2:1
  const floor2 = first && floor && first.level !== floor.level ? first : null; // kept for the printout
  const rr = floor ? (last.close - floor.level) / (stop - last.close) : first ? (last.close - first.level) / (stop - last.close) : null;
  const dropToFloorAtr = floor ? (last.close - floor.level) / atr : null;
  // readiness: volume conviction, geometry, relative weakness, floor distance (a floor inside 1 ATR is too close to pay)
  const volScore = volRatio === null ? 0 : Math.min(100, Math.round(volRatio / 2 * 100));
  const rrScore = rr === null ? 0 : Math.min(100, Math.round(rr / 3 * 100));
  const rsScore = Math.min(100, Math.max(0, Math.round(50 - rs20 * 5)));
  const floorScore = dropToFloorAtr === null ? 0 : dropToFloorAtr < 1 ? 20 : dropToFloorAtr > 6 ? 40 : 100;
  let readiness = Math.round((volScore + rrScore + rsScore + floorScore) / 4);
  if (o.macroInside2) readiness = Math.min(readiness, o.macroCap);
  const ready = g1 && g2 && !!floor && rr >= 2;
  const list = ready ? "READY" : (g1 || g2) && floor && last.close < sma50 ? "STALK" : g2 && last.close < sma50 ? "DISCOVERY" : null;
  Object.assign(out, {
    ok: true, date: last.date, close: r2(last.close), sma50: r2(sma50), sma20: r2(sma20), atr: r2(atr), low20: r2(low20),
    volume: last.volume, vol30: Math.round(vol30 ?? 0), volRatio: volRatio === null ? null : r2(volRatio),
    rs20: r2(rs20), rs5: r2(rs5),
    gates: { breakdown: g1, laggard: g2, catalyst: "OWED - desk verifies" },
    floor: floor ? { level: r2(floor.level), date: floor.date, atr_away: r2(dropToFloorAtr) } : null,
    first_shelf: first ? { level: r2(first.level), date: first.date, rr: r2((last.close - first.level) / (stop - last.close)) } : null,
    floor2, too_far: walk.too_far ? { level: r2(walk.too_far.level), date: walk.too_far.date } : null,
    geometry: { entry: r2(last.close), stop: r2(stop), stop_atr: r2((stop - last.close) / atr), target: floor ? r2(floor.level) : null, rr: rr === null ? null : r2(rr) },
    readiness, list,
  });
  return out;
}

export function rank(results, cap = DEFAULTS.cap) {
  const ok = results.filter((r) => r.ok && r.list);
  const ready = ok.filter((r) => r.list === "READY").sort((a, b) => b.readiness - a.readiness || b.geometry.rr - a.geometry.rr);
  const demoted = ready.slice(cap).map((r) => ({ ...r, list: "STALK", demoted: `READY cap ${cap}` }));
  return {
    READY: ready.slice(0, cap),
    STALK: [...ok.filter((r) => r.list === "STALK"), ...demoted].sort((a, b) => b.readiness - a.readiness),
    DISCOVERY: ok.filter((r) => r.list === "DISCOVERY").sort((a, b) => b.readiness - a.readiness),
    NO_FLOOR: ok.filter((r) => (r.gates.breakdown && r.gates.laggard) && !r.floor),
    skipped: results.filter((r) => !r.ok),
  };
}

export function spreadLine(r, band) {
  if (!r.floor) return `NO VERIFIED FLOOR - no target, no spread. Pull a longer history or wait for a bounce to define one.`;
  const lo = Math.round(r.close), sh = Math.round(r.floor.level);
  return `put spread: long ~${lo}P / short ~${sh}P, 1-2 week expiry, MAX LOSS <= ${band.toFixed(0)} (the band); price at the open, never on stale marks. Decide-by ${DEFAULTS.decideSessions} sessions.`;
}

const r2 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Number(x.toFixed(2)));

// ---------- data ----------
async function yahooBars(symbol, range = "5y") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TheBench hunt-short.mjs)" } });
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
    try {
      const b = JSON.parse(readFileSync(resolve(ROOT, "db/board.json"), "utf8"));
      const layers = Array.isArray(b.layers) ? b.layers : Object.values(b.layers ?? {});
      for (const l of layers) for (const t of l.tickers ?? l.names ?? []) syms.add((t.sym ?? t.ticker ?? t).toUpperCase());
    } catch {}
  }
  if (which === "watchlist" || which === "all") {
    try {
      const w = JSON.parse(readFileSync(resolve(ROOT, "db/watchlist.json"), "utf8"));
      for (const e of w) if (e.sym && !/^(CLOSED|PASS)$/.test(e.status ?? "")) syms.add(e.sym.toUpperCase());
    } catch {}
  }
  for (const x of ["SPY", "QQQ", "IWM", "DIA", "SMH"]) syms.delete(x);
  return [...syms].filter((s) => /^[A-Z.]{1,6}$/.test(s));
}

function macroInside2(asof) {
  try {
    const raw = JSON.parse(readFileSync(resolve(ROOT, "db/catalysts.json"), "utf8"));
    const cats = Array.isArray(raw) ? raw : raw.catalysts ?? [];
    const d0 = new Date(asof + "T00:00:00Z");
    return cats.filter((c) => c.type === "macro").some((c) => { const d = new Date(c.date + "T00:00:00Z"); const diff = (d - d0) / 864e5; return diff >= 0 && diff <= 3; });
  } catch { return false; }
}

async function main() {
  const symbolsArg = val("--symbols");
  const universe = val("--universe") ?? "all";
  const account = Number(val("--account") ?? 0);
  const band = Number(val("--band") ?? (account ? account * 0.1 : 0));
  const opts = { volMin: Number(val("--vol-min") ?? DEFAULTS.volMin), cap: Number(val("--cap") ?? DEFAULTS.cap) };
  let series = {}, source;
  if (val("--bars-file")) { series = JSON.parse(readFileSync(resolve(val("--bars-file")), "utf8")); source = "file"; }
  else {
    const syms = symbolsArg ? symbolsArg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : defaultUniverse(universe);
    source = "yahoo";
    series.SPY = await yahooBars("SPY", "1y");
    for (const s of syms) { try { series[s] = await yahooBars(s); } catch (e) { series[s] = { error: e.message }; } }
  }
  const spy = series.SPY;
  const asof = spy?.at?.(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const macro = macroInside2(asof);
  const results = [];
  for (const [sym, bars] of Object.entries(series)) {
    if (sym === "SPY") continue;
    if (!Array.isArray(bars)) { results.push({ sym, ok: false, problem: bars?.error ?? "no bars" }); continue; }
    results.push(screenSymbol(sym, bars, spy, { ...opts, macroInside2: macro }));
  }
  const ranked = rank(results, opts.cap);
  const receipt = { kind: "hunt-short", asof, source, generated: new Date().toISOString(), universe: symbolsArg ? "named" : universe, macro_inside_2_sessions: macro, band: band || null, opts, ...ranked };
  receipt.id = createHash("sha1").update(JSON.stringify({ asof, results })).digest("hex").slice(0, 8);

  if (has("--write")) {
    const dir = resolve(ROOT, "db/hunts/short"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const p = resolve(dir, `${asof}.json`); writeFileSync(p, JSON.stringify(receipt, null, 2) + "\n"); receipt.wrote = p;
  }
  if (has("--json")) { console.log(JSON.stringify(receipt, null, 2)); return; }

  console.log(`HUNT SHORT  ·  as of ${asof} (${source})  ·  receipt ${receipt.id}  ·  macro inside 2 sessions: ${macro ? "YES - readiness capped " + DEFAULTS.macroCap : "no"}`);
  console.log(`  gates: G1 breakdown (< 50d, <= 20-session low, vol >= ${opts.volMin}x) · G2 laggard (rs20 & rs5 < 0 vs SPY) · G3 catalyst OWED to the desk`);
  const line = (r) => `  ${r.sym.padEnd(6)} ${String(r.close).padStart(9)}  50d ${String(r.sma50).padStart(8)}  low20 ${String(r.low20).padStart(8)}  vol ${String(r.volRatio ?? "-").padStart(5)}x  rs20 ${String(r.rs20).padStart(7)}  G1 ${r.gates.breakdown ? "Y" : "n"} G2 ${r.gates.laggard ? "Y" : "n"}  target ${r.floor ? `${r.floor.level} (${r.floor.date}, ${r.floor.atr_away} ATR)` : r.too_far ? `NONE inside 6 ATR (next ${r.too_far.level})` : "NONE"}${r.first_shelf && (!r.floor || r.first_shelf.level !== r.floor.level) ? ` first shelf ${r.first_shelf.level} (${r.first_shelf.date}, R:R ${r.first_shelf.rr})` : ""}  stop ${r.geometry.stop} (${r.geometry.stop_atr} ATR)  R:R ${r.geometry.rr ?? "-"}  readiness ${r.readiness}${r.demoted ? "  [" + r.demoted + "]" : ""}`;
  for (const L of ["READY", "STALK", "DISCOVERY"]) {
    console.log(`\n${L} (${ranked[L].length}${L === "READY" ? `/${opts.cap}` : ""})`);
    if (!ranked[L].length) console.log("  (none)");
    for (const r of ranked[L]) { console.log(line(r)); if (L === "READY") console.log(`         ${spreadLine(r, band || r.close)}`); }
  }
  if (ranked.NO_FLOOR.length) { console.log(`\nBOTH GATES, NO VERIFIED FLOOR (cannot show 2:1 - the GRAB gap)`); for (const r of ranked.NO_FLOOR) console.log(line(r)); }
  if (ranked.skipped.length) console.log(`\nskipped: ${ranked.skipped.map((s) => `${s.sym} (${s.problem})`).join(", ")}`);
  if (receipt.wrote) console.log(`\nwrote ${receipt.wrote}`);
  console.log(`\nRule: every READY name still runs the full v29 framework, prices its spread at the open, and gets a row via log-call.mjs. Nothing here is a ticket.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`hunt-short: ${e.message}`); process.exit(1); });
}
