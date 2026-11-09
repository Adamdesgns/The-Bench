#!/usr/bin/env node
// The normal-day volume curve: what share of a day's volume is normally done by each 5-minute mark.
// Pump watch's pace test reads against it (NORMAL_DAY_SHARE in server/pumpWatch.js).
// Read-only and report-only: it fetches free Yahoo bars, prints the table, and never rewrites the constant.
//
//   node scripts/volume-curve.mjs [--before YYYY-MM-DD] [--symbols A,B]
//
// Yahoo keeps about 60 days of 5-minute bars, so the curve is one recent stretch of the market.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { trimToDayVolume, NORMAL_DAY_SHARE } from "../server/pumpWatch.js";

export const POINTS = 79; // minute 0, 5, ... 390 after the 09:30 ET open
const FULL_DAY_BARS = 70; // fewer 5-minute bars than this is a half day or a broken one
const BOARD = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "MU", "PLTR", "AVGO", "COIN", "HIMS", "MRNA", "ASTS", "IREN", "APP", "SMCI"];

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// unix seconds -> the New York date and the minutes after the 09:30 open
export function etParts(t) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute - 570 };
}

const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// One day: the running share of the official day volume done before each 5-minute mark.
// honest = what this name's bars normally add up to against the official total (the closing auction is the gap).
export function dayCurve(bars, official, honest = 1) {
  if (!Number.isFinite(official) || official <= 0) return null;
  const b = [...bars].sort((x, y) => x.min - y.min);
  const w = trimToDayVolume(b.map((x) => x.v), official * honest);
  const c = Array(POINTS).fill(0);
  b.forEach((x, n) => { for (let k = Math.floor(x.min / 5) + 1; k < POINTS; k++) c[k] += w[n]; });
  return c.map((v) => v / official);
}

// Many days: the median share at each mark, to 4 places.
export function shareCurve(curves) {
  const ok = curves.filter(Boolean);
  return Array.from({ length: POINTS }, (_, k) => (k === 0 ? 0 : Math.round(median(ok.map((c) => c[k])) * 1e4) / 1e4));
}

// Only finished, full sessions: today's is still trading, and a half day has a different shape.
export function fullPriorDays(days, today) {
  return [...days].filter(([d, b]) => d < today && b.length >= FULL_DAY_BARS).sort((x, y) => (x[0] < y[0] ? -1 : 1));
}

// Where a fresh curve sits furthest from another (the shipped one): the mark, its minute, and fresh minus shipped.
export function drift(fresh, shipped) {
  if (!Array.isArray(fresh) || !Array.isArray(shipped) || fresh.length !== shipped.length) return null;
  let mark = 0;
  fresh.forEach((v, k) => { if (Math.abs(v - shipped[k]) > Math.abs(fresh[mark] - shipped[mark])) mark = k; });
  return { mark, minute: mark * 5, gap: fresh[mark] - shipped[mark] };
}

// ---- command line ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) throw new Error(`http ${r.status}`);
      return await r.json();
    } catch (e) { if (i >= 2) throw e; await sleep(1500); }
  }
}

async function symbolCurves(sym, before) {
  const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}`;
  const i5 = (await getJson(`${base}?interval=5m&range=60d`)).chart.result[0];
  await sleep(120);
  const d1 = (await getJson(`${base}?interval=1d&range=8mo`)).chart.result[0];
  await sleep(120);
  const dv = d1.indicators.quote[0].volume;
  const official = new Map(d1.timestamp.map((t, i) => [etParts(t).day, dv[i]]));
  const q = i5.indicators.quote[0];
  const days = new Map();
  i5.timestamp.forEach((t, i) => {
    const e = etParts(t);
    if (e.min < 0 || e.min >= 390 || e.min % 5 !== 0 || q.close[i] == null) return;
    if (!days.has(e.day)) days.set(e.day, []);
    days.get(e.day).push({ min: e.min, v: q.volume[i] > 0 ? q.volume[i] : 0 });
  });
  const full = fullPriorDays(days, before).filter(([d]) => official.get(d) > 0);
  const honest = Math.min(1, median(full.map(([d, b]) => b.reduce((a, x) => a + x.v, 0) / official.get(d))) ?? 1);
  return full.map(([d, b]) => ({ day: d, curve: dayCurve(b, official.get(d), honest) }));
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const today = etParts(Date.now() / 1000).day;
  const before = arg("--before") || today;
  let syms = arg("--symbols")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!syms) {
    const reg = JSON.parse(readFileSync(join(root, "db", "pump-watch.json"), "utf8"));
    const watched = (reg.watches || []).map((w) => w.ticker).filter((s) => !s.includes("-"));
    syms = [...new Set([...watched, ...BOARD])];
  }
  const rows = [];
  const failed = [];
  for (const s of syms) {
    try { rows.push(...(await symbolCurves(s, before))); } catch (e) { failed.push(`${s}: ${e.message}`); }
  }
  const sessions = [...new Set(rows.map((r) => r.day))].sort();
  if (!rows.length) { console.error(`no data. failed: ${failed.join("; ")}`); process.exit(2); }
  const curve = shareCurve(rows.map((r) => r.curve));
  console.log(`names ${syms.length - failed.length}, name-days ${rows.length}, sessions ${sessions.length} (${sessions[0]} to ${sessions.at(-1)}), full days before ${before}. failed: ${failed.join("; ") || "none"}`);
  console.log("[");
  for (let i = 0; i < POINTS; i += 10) console.log("  " + curve.slice(i, i + 10).map((v) => v.toFixed(4)).join(", ") + ",");
  console.log("]");
  const d = drift(curve, NORMAL_DAY_SHARE);
  console.log(d ? `against the shipped table: biggest gap ${(d.gap * 100).toFixed(2)} points of the day at minute ${d.minute} (fresh ${curve[d.mark].toFixed(4)}, shipped ${NORMAL_DAY_SHARE[d.mark].toFixed(4)}). This prints only; the table in server/pumpWatch.js changes by hand, with Adam's word.` : "the shipped table has a different length: not comparable");
  return curve;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
