// short-quality.mjs — would a career trader take this scanner short? A verdict printed beside each READY
// short in the hunt receipt. READ ONLY: it never changes READY, never touches the paper book, and the paper
// book keeps taking every READY short exactly as before (Adam, 2026-11-03: "I want nothing about how vans
// thesis trades are placed changed. Fix the rest.").
//
//   node scripts/short-quality.mjs --candidates db/hunts/options/<date>.candidates.json [--bids '{"MRVL":171.2}']
//   add --bull-file f.json for an offline sector-switch file (default db/bull-watch.json); --json for machines
//
// WHY THIS EXISTS (docs/research/2026-11-03-why-scanner-shorts-lost.md)
// ---------------------------------------------------------------------
// 14 closed scanner shorts lost -3.77R. Four causes, each now a check:
//   1. ODDS     the scanner prints its own odds (p_dir = lower in 10 sessions, p_reach = reaches the target)
//               and nothing read them. Here they become a rough expected value in R at the scanner's own
//               odds: p_reach x target-in-R - (1 - p_dir) x 1R. Below zero = the trade loses on average.
//   2. SECTOR   15 of 19 shorted AI leaders while their sector's bull switch was BULL (db/bull-watch.json).
//               A name with no known sector, or a sector with no switch, cannot pass: unknown is not "not bull".
//   3. FILL     AMZN was screened at 243.79 and filled at 231.10 with the same stop: 0.44 to 1. With --bids,
//               the reward-to-risk is re-measured at the real fill and must still be 2 to 1.
//   4. CLUSTER  14 trades were about four bets. More than 2 READY shorts in one sector the same night is flagged.
// A pass on all four is QUALITY. It is a read for Adam, never a gate and never a buy or sell signal.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SECTOR_HINT } from "./rs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const r2 = (x) => Math.round(x * 100) / 100;
// rs.mjs names the chip group SOXX; the bull switch follows SMH for the same group.
const SWITCH_ETF = { SOXX: "SMH" };

export function judge(c, { bid = null, switches = {}, sectorCount = {} } = {}) {
  const g = c.geometry || {}, ev = c.evidence || {};
  const sector = SECTOR_HINT[c.sym] || null;
  const etf = sector ? (SWITCH_ETF[sector] || sector) : null;
  const sw = etf ? switches[etf]?.switch ?? null : null;
  const at = Number.isFinite(bid) && bid > 0 ? bid : g.entry;
  const risk = g.stop - at, reward = at - g.target;
  const rr = risk > 0 ? r2(reward / risk) : null;
  const pDir = Number(ev.p_dir), pReach = Number(ev.p_reach);
  const evR = Number.isFinite(pDir) && Number.isFinite(pReach) && rr != null ? r2((pReach / 100) * rr - (1 - pDir / 100)) : null;
  const fails = [];
  if (evR == null) fails.push("no scanner odds to price it");
  else if (evR <= 0) fails.push(`loses ${Math.abs(evR)}R a trade on average at the scanner's own odds (${pDir}% lower in 10 sessions, ${pReach}% reach the target)`);
  if (sw === "BULL") fails.push(`its sector (${etf}) is in BULL mode: shorting a leader in a bull tape`);
  else if (sw == null) fails.push(`no bull switch for its sector (${etf || "sector unknown"}): cannot confirm it is not a leader in a bull tape`);
  if (rr == null || rr < 2) fails.push(`${Number.isFinite(bid) && bid > 0 ? "at the fill" : "at the screen price"} ${at} it pays ${rr ?? "nothing"} to 1, under 2 to 1`);
  if (etf && (sectorCount[etf] || 0) > 2) fails.push(`${sectorCount[etf]} READY shorts in ${etf} tonight: one bet, not ${sectorCount[etf]}`);
  return { sym: c.sym, at, stop: g.stop, target: g.target, rr, p_dir: pDir, p_reach: pReach, ev_r: evR, sector: etf || "unknown", switch: sw, quality: fails.length === 0, fails };
}

export function judgeAll(cands, { bids = {}, switches = {} } = {}) {
  const ready = (cands.candidates || []).filter((x) => x.side === "short" && x.list === "READY" && x.ok !== false);
  const sectorCount = {};
  for (const x of ready) { const s = SECTOR_HINT[x.sym]; if (s) { const e = SWITCH_ETF[s] || s; sectorCount[e] = (sectorCount[e] || 0) + 1; } }
  return ready.map((x) => judge(x, { bid: Number(bids[x.sym.toUpperCase()]), switches, sectorCount }));
}

export function lines(rows) {
  const out = ["SCANNER SHORT QUALITY - would a career trader take it? (read only: the paper book still takes every READY short)"];
  if (!rows.length) out.push("  no READY shorts tonight");
  for (const r of rows) {
    out.push(r.quality
      ? `  QUALITY      ${r.sym}: ${r.ev_r >= 0 ? "+" : ""}${r.ev_r}R a trade at the scanner's odds, ${r.rr} to 1 at ${r.at}, sector ${r.sector} ${r.switch || "no switch"}`
      : `  NOT QUALITY  ${r.sym}: ${r.fails.join("; ")}`);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  if (!val("--candidates")) { console.log("REFUSED - pass --candidates db/hunts/options/<date>.candidates.json"); process.exit(1); }
  const cands = JSON.parse(readFileSync(resolve(val("--candidates")), "utf8"));
  const bullFile = resolve(val("--bull-file") || resolve(ROOT, "db/bull-watch.json"));
  const switches = existsSync(bullFile) ? JSON.parse(readFileSync(bullFile, "utf8")).states || {} : {};
  let bids = {};
  try { bids = Object.fromEntries(Object.entries(JSON.parse(val("--bids") || "{}")).map(([k, v]) => [k.toUpperCase(), v])); }
  catch { console.log("REFUSED - --bids must be JSON like '{\"MRVL\":171.2}'"); process.exit(1); }
  const rows = judgeAll(cands, { bids, switches });
  if (argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else lines(rows).forEach((l) => console.log(l));
}
