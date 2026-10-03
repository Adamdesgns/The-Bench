// regime.mjs — one market-regime stamp per day, so every framework run that day
// reads the same Market Risk instead of guessing its own.
//
//   node scripts/regime.mjs                       print the stamp
//   node scripts/regime.mjs --write               also write db/regime.json
//   node scripts/regime.mjs --json                machine-readable
//   node scripts/regime.mjs --bars-file f.json    offline: {SPY:[{date,close}],QQQ:[...],IWM:[...],VIX:[...],TNX:[...]}
//   node scripts/regime.mjs --date YYYY-MM-DD     evaluate as of that session (default: last bar)
//   node scripts/regime.mjs --catalysts f.json    catalyst board to read for EVENT (default db/catalysts.json)
//
// WHY THIS EXISTS (v29, 2026-09-02)
// ---------------------------------
// On 2026-09-01 GPRO was stamped Market Risk 4/5 at 10:31 CT and SST 3/5 at
// 21:55 CT; on 9/2 COHR got 3/5 at 09:42. Same market, three answers, because
// each run re-derived the regime by eye. A daily stamp computed once from the
// same inputs is boring, and boring is the point.
//
// THE LABELS, deterministic, from daily closes (no intraday, no futures):
//   TRENDING  SPY > 20 SMA > 50 SMA > 200 SMA and VIX < 20
//   RISK-ON   SPY > 50 SMA, VIX < 20, IWM not lagging SPY by >3% over 20 sessions
//   CHOP      SPY within +/-1.5% of its 20 SMA on every one of the last 10 sessions
//   RISK-OFF  SPY < 50 SMA and (VIX >= 25 or VIX up >= 20% over 5 sessions)
//   EVENT     a macro row on the catalyst board lands on the next session (overrides)
//   NEUTRAL   none of the above
//
// MARKET RISK (1 = Defense Only ... 5 = Aggressive, the v28 scale):
//   TRENDING 4 · RISK-ON 4 · NEUTRAL 3 · CHOP 3 · EVENT 2 · RISK-OFF 1
//
// The stamp is INPUT to a run, never a gate. A run may state a different Market
// Risk, but it must say why, and the stamp it disagreed with is on the record.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "db/regime.json");
const CATALYSTS = resolve(ROOT, "db/catalysts.json");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const SYMBOLS = { SPY: "SPY", QQQ: "QQQ", IWM: "IWM", VIX: "^VIX", TNX: "^TNX" };

// ── math ────────────────────────────────────────────────────────────────────

export function sma(closes, n) {
  if (closes.length < n) return null;
  const s = closes.slice(-n);
  return s.reduce((a, b) => a + b, 0) / n;
}

function pct(a, b) {
  return ((a - b) / b) * 100;
}

// closes: arrays of numbers ending at the evaluation session, oldest first.
export function classify({ SPY, QQQ, IWM, VIX, TNX }, { eventNext = false } = {}) {
  const need = { SPY, QQQ, IWM, VIX };
  for (const [k, v] of Object.entries(need)) {
    if (!Array.isArray(v) || v.length < 20) throw new Error(`${k}: need at least 20 closes (got ${v?.length ?? 0})`);
  }
  const spy = SPY.at(-1);
  const s20 = sma(SPY, 20);
  const s50 = sma(SPY, 50);
  const s200 = sma(SPY, 200);
  const vix = VIX.at(-1);
  const vix5 = VIX.length >= 6 ? pct(vix, VIX.at(-6)) : 0;
  const tnx = TNX?.length ? TNX.at(-1) : null;
  const tnx5 = TNX?.length >= 6 ? tnx - TNX.at(-6) : null;
  const iwmRel20 = IWM.length >= 21 && SPY.length >= 21 ? pct(IWM.at(-1), IWM.at(-21)) - pct(spy, SPY.at(-21)) : 0;
  const qqqRel20 = QQQ.length >= 21 && SPY.length >= 21 ? pct(QQQ.at(-1), QQQ.at(-21)) - pct(spy, SPY.at(-21)) : 0;

  // CHOP: every one of the last 10 closes inside +/-1.5% of that day's 20 SMA,
  // AND the 20 SMA itself went nowhere (< 1% over those 10 sessions). A slow,
  // steady uptrend also hugs its 20 SMA; the flat-slope test is what separates
  // "going nowhere" from "going up quietly".
  let chop = SPY.length >= 30;
  if (chop) {
    for (let i = 0; i < 10; i++) {
      const end = SPY.length - i;
      const c = SPY[end - 1];
      const m = sma(SPY.slice(0, end), 20);
      if (m === null || Math.abs(pct(c, m)) > 1.5) {
        chop = false;
        break;
      }
    }
    if (chop) {
      const mNow = sma(SPY, 20);
      const mThen = sma(SPY.slice(0, SPY.length - 10), 20);
      if (mThen === null || Math.abs(pct(mNow, mThen)) >= 1) chop = false;
    }
  }

  let label = "NEUTRAL";
  const reasons = [];
  if (s50 !== null && spy < s50 && (vix >= 25 || vix5 >= 20)) {
    label = "RISK-OFF";
    reasons.push(`SPY ${spy.toFixed(2)} < 50 SMA ${s50.toFixed(2)}`, `VIX ${vix.toFixed(2)} (${vix5 >= 0 ? "+" : ""}${vix5.toFixed(1)}% / 5 sessions)`);
  } else if (s200 !== null && spy > s20 && s20 > s50 && s50 > s200 && vix < 20) {
    label = "TRENDING";
    reasons.push(`SPY ${spy.toFixed(2)} > 20 ${s20.toFixed(2)} > 50 ${s50.toFixed(2)} > 200 ${s200.toFixed(2)}`, `VIX ${vix.toFixed(2)} < 20`);
  } else if (chop) {
    label = "CHOP";
    reasons.push("SPY inside +/-1.5% of its 20 SMA for 10 straight sessions with a flat 20 SMA");
  } else if (s50 !== null && spy > s50 && vix < 20 && iwmRel20 > -3) {
    label = "RISK-ON";
    reasons.push(`SPY ${spy.toFixed(2)} > 50 SMA ${s50.toFixed(2)}`, `VIX ${vix.toFixed(2)} < 20`, `IWM vs SPY 20-session ${iwmRel20 >= 0 ? "+" : ""}${iwmRel20.toFixed(2)} pts`);
  } else {
    reasons.push(`SPY ${spy.toFixed(2)} vs 50 SMA ${s50 === null ? "n/a" : s50.toFixed(2)}`, `VIX ${vix.toFixed(2)}`);
  }

  if (eventNext) {
    reasons.unshift(`macro release on the next session overrides ${label}`);
    label = "EVENT";
  }

  const risk = { TRENDING: 4, "RISK-ON": 4, NEUTRAL: 3, CHOP: 3, EVENT: 2, "RISK-OFF": 1 }[label];

  return {
    label,
    market_risk: risk,
    reasons,
    inputs: {
      spy, sma20: s20, sma50: s50, sma200: s200,
      vix, vix_5d_pct: Number(vix5.toFixed(2)),
      tnx, tnx_5d_change: tnx5 === null ? null : Number(tnx5.toFixed(3)),
      iwm_rel_20: Number(iwmRel20.toFixed(2)),
      qqq_rel_20: Number(qqqRel20.toFixed(2)),
    },
  };
}

// ── data ────────────────────────────────────────────────────────────────────

async function yahooCloses(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TheBench regime.mjs)" } });
  if (!res.ok) throw new Error(`yahoo ${symbol}: ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const cl = r?.indicators?.quote?.[0]?.close ?? [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (cl[i] === null || cl[i] === undefined) continue;
    bars.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: cl[i] });
  }
  if (!bars.length) throw new Error(`yahoo ${symbol}: no bars`);
  return bars;
}

function nextSessionDate(from) {
  const d = new Date(`${from}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

function macroOnNextSession(asof) {
  const file = val("--catalysts") ? resolve(val("--catalysts")) : CATALYSTS;
  if (!existsSync(file)) return { eventNext: false, rows: [] };
  let cats = [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    cats = Array.isArray(raw) ? raw : raw.catalysts ?? [];
  } catch {
    return { eventNext: false, rows: [] };
  }
  const next = nextSessionDate(asof);
  const rows = cats.filter((c) => (c.type === "macro" || c.type === "index") && c.date === next);
  return { eventNext: rows.length > 0, rows: rows.map((r) => r.what ?? r.title ?? r.ticker ?? "macro") };
}

async function load() {
  const file = val("--bars-file");
  if (file) {
    const raw = JSON.parse(readFileSync(resolve(file), "utf8"));
    return { series: raw, source: `file:${file}` };
  }
  const out = {};
  for (const [k, sym] of Object.entries(SYMBOLS)) {
    try {
      out[k] = await yahooCloses(sym);
    } catch (e) {
      if (k === "TNX") { out[k] = []; continue; }
      throw e;
    }
  }
  return { series: out, source: "yahoo" };
}

function cut(series, date) {
  const o = {};
  for (const [k, bars] of Object.entries(series)) {
    const b = (bars ?? []).filter((x) => !date || x.date <= date);
    o[k] = b.map((x) => Number(x.close ?? x.c ?? x));
  }
  const last = series.SPY?.filter((x) => !date || x.date <= date).at(-1)?.date ?? date ?? null;
  return { closes: o, asof: last };
}

async function main() {
  if (has("--help")) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n"));
    return;
  }
  const { series, source } = await load();
  const { closes, asof } = cut(series, val("--date"));
  const macro = macroOnNextSession(asof);
  const stamp = classify(closes, { eventNext: macro.eventNext });
  const out = {
    asof,
    generated: new Date().toISOString(),
    source,
    label: stamp.label,
    market_risk: stamp.market_risk,
    reasons: stamp.reasons,
    next_session_macro: macro.rows,
    inputs: stamp.inputs,
    rule: "One stamp per day. A run may state a different Market Risk but must say why; the stamp it disagreed with stays on the record.",
  };

  if (has("--json")) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`REGIME ${out.label}  ·  Market Risk ${out.market_risk}/5  ·  as of ${asof} (${source})`);
    for (const r of out.reasons) console.log(`  - ${r}`);
    if (macro.rows.length) console.log(`  next session macro: ${macro.rows.join(" | ")}`);
    const i = out.inputs;
    console.log(`  SPY ${i.spy?.toFixed(2)} · 20 ${i.sma20?.toFixed(2)} · 50 ${i.sma50?.toFixed(2)} · 200 ${i.sma200 ? i.sma200.toFixed(2) : "n/a"} · VIX ${i.vix?.toFixed(2)} · TNX ${i.tnx ?? "n/a"}`);
  }
  if (has("--write")) {
    writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`wrote ${OUT}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`regime: ${e.message}`);
    process.exit(1);
  });
}
