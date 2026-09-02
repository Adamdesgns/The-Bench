// rs.mjs — relative strength as a computed line, not an eyeball.
//
//   node scripts/rs.mjs --ticker COHR                      vs SPY, QQQ (sector auto if known)
//   node scripts/rs.mjs --ticker COHR --sector SOXX        name the sector ETF
//   node scripts/rs.mjs --ticker COHR --json
//   node scripts/rs.mjs --ticker X --bars-file f.json      offline: {X:[{date,close}],SPY:[...],QQQ:[...],SECTOR:[...]}
//
// WHY THIS EXISTS (v29, 2026-09-02)
// ---------------------------------
// Lens 2's Institutional Lens asks "leading or lagging, over 1D / 5D / 20D / 60D,
// vs SPY, QQQ and the sector". Every review answered it by hand from whatever
// quotes happened to be on screen. This prints the table from the same daily
// closes every time, and says LEADER / LAGGARD / MIXED from the 20- and 60-day
// legs, which are the ones institutions actually rank on.
//
// Relative performance = ticker % change minus benchmark % change over the same
// sessions, in percentage points. Positive = outperformed.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

export const HORIZONS = [1, 5, 20, 60];

// A small default map so "--sector" is optional for the names this book runs.
const SECTOR_HINT = {
  COHR: "SOXX", LITE: "SOXX", AAOI: "SOXX", CIEN: "IGV", MRVL: "SOXX", AVGO: "SOXX", NVDA: "SOXX", AMD: "SOXX", MU: "SOXX", INTC: "SOXX", KLIC: "SOXX", AMAT: "SOXX", LRCX: "SOXX", ASML: "SOXX", TSM: "SOXX", SNDK: "SOXX", WDC: "SOXX", STX: "SOXX",
  GOOGL: "XLC", META: "XLC", MSFT: "XLK", AMZN: "XLY", AAPL: "XLK", ORCL: "XLK", PATH: "IGV", HPE: "XLK", HPQ: "XLK", DELL: "XLK", SMCI: "XLK",
  TLN: "XLU", CEG: "XLU", VST: "XLU", FRVO: "XLU", GEV: "XLI",
  HIMS: "XLV", PLAB: "SOXX", GDS: "KWEB", BE: "XLI",
};

export function pctChange(closes, n) {
  if (closes.length < n + 1) return null;
  const a = closes.at(-1 - n);
  const b = closes.at(-1);
  return ((b - a) / a) * 100;
}

export function relTable(tick, benches) {
  const rows = [];
  for (const h of HORIZONS) {
    const t = pctChange(tick, h);
    const row = { horizon: `${h}D`, ticker: t === null ? null : Number(t.toFixed(2)) };
    for (const [name, closes] of Object.entries(benches)) {
      const b = pctChange(closes, h);
      row[name] = b === null ? null : Number(b.toFixed(2));
      row[`vs_${name}`] = t === null || b === null ? null : Number((t - b).toFixed(2));
    }
    rows.push(row);
  }
  return rows;
}

export function verdict(rows, benchName = "SPY") {
  const r20 = rows.find((r) => r.horizon === "20D")?.[`vs_${benchName}`];
  const r60 = rows.find((r) => r.horizon === "60D")?.[`vs_${benchName}`];
  if (r20 === null || r20 === undefined || r60 === null || r60 === undefined) return "INSUFFICIENT HISTORY";
  if (r20 > 0 && r60 > 0) return "LEADER";
  if (r20 < 0 && r60 < 0) return "LAGGARD";
  if (r20 > 0 && r60 < 0) return "EMERGING — outperforming over 20 sessions, still behind over 60";
  return "FADING — behind over 20 sessions, still ahead over 60";
}

async function yahooCloses(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TheBench rs.mjs)" } });
  if (!res.ok) throw new Error(`yahoo ${symbol}: ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const cl = r?.indicators?.quote?.[0]?.close ?? [];
  const out = [];
  for (let i = 0; i < ts.length; i++) if (cl[i] !== null && cl[i] !== undefined) out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: cl[i] });
  if (!out.length) throw new Error(`yahoo ${symbol}: no bars`);
  return out;
}

const closesOf = (bars) => (bars ?? []).map((b) => Number(b.close ?? b.c ?? b));

async function main() {
  const ticker = (val("--ticker") ?? "").toUpperCase();
  if (!ticker) {
    console.error("REFUSED — --ticker is required.");
    process.exit(1);
  }
  const sector = (val("--sector") ?? SECTOR_HINT[ticker] ?? "").toUpperCase();
  const file = val("--bars-file");
  let series;
  let source;
  if (file) {
    const raw = JSON.parse(readFileSync(resolve(file), "utf8"));
    series = { T: raw[ticker] ?? raw.T, SPY: raw.SPY, QQQ: raw.QQQ, SECTOR: raw.SECTOR ?? raw[sector] };
    source = `file:${file}`;
  } else {
    series = { T: await yahooCloses(ticker), SPY: await yahooCloses("SPY"), QQQ: await yahooCloses("QQQ") };
    if (sector) series.SECTOR = await yahooCloses(sector);
    source = "yahoo";
  }
  if (!series.T?.length) {
    console.error(`REFUSED — no closes for ${ticker}.`);
    process.exit(1);
  }
  const benches = { SPY: closesOf(series.SPY), QQQ: closesOf(series.QQQ) };
  if (series.SECTOR?.length && sector) benches[sector] = closesOf(series.SECTOR);
  const rows = relTable(closesOf(series.T), benches);
  const asof = series.T.at(-1)?.date ?? null;
  const out = { ticker, sector: sector || null, asof, source, rows, verdict_vs_spy: verdict(rows, "SPY"), verdict_vs_sector: sector && benches[sector] ? verdict(rows, sector) : null };

  if (has("--json")) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(`RELATIVE STRENGTH — ${ticker}${sector ? ` (sector ${sector})` : ""} · as of ${asof} (${source})`);
  const names = Object.keys(benches);
  console.log(`  ${"".padEnd(5)}${"ticker".padStart(9)}${names.map((n) => `${n.padStart(9)}${("vs " + n).padStart(10)}`).join("")}`);
  for (const r of rows) {
    const f = (v) => (v === null ? "n/a".padStart(9) : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`.padStart(9));
    console.log(`  ${r.horizon.padEnd(5)}${f(r.ticker)}${names.map((n) => `${f(r[n])}${f(r[`vs_${n}`]).padStart(10)}`).join("")}`);
  }
  console.log(`  VERDICT vs SPY: ${out.verdict_vs_spy}${out.verdict_vs_sector ? ` · vs ${sector}: ${out.verdict_vs_sector}` : ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`rs: ${e.message}`);
    process.exit(1);
  });
}
