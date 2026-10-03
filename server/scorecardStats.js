// scorecardStats.js — the scored book read back as per-setup statistics. Pure: no fs, no network.
//
// WHY THIS EXISTS (2026-09-12): 282 rows carry scored checkpoints and nothing had
// ever aggregated them. The first throwaway aggregation found conditional calls
// at 1 week sitting at -0.02 mean alpha over 122 entries, and passes costing
// 9.45 when wrong against 5.83 saved when right.
//
// THE HONESTY RULES, each one a way a scorecard lies without meaning to:
//  - A rate on too few entries is suppressed, and its count is still shown.
//  - Flats are displayed, never folded into losses.
//  - The population is named. "The record" was three different numbers in one
//    day's notes (95-80-16, 64-75-17, 159-155-33) because nobody said what was
//    being counted.
//  - Shadow tests are not Bench calls and are excluded unless asked for.
//  - A call typed at log time and a call classified from prose are separate
//    provenance and are never silently pooled.

import { HORIZON_DAYS, CLOSING_HORIZON } from "./checkpoints.js";

export const MIN_N = 8;
const HORIZON_ORDER = ["3m", "1m", "1w"];
const VERDICTS = ["right", "wrong", "flat", "not_scorable"];
const REAL = new Set(["right", "wrong", "flat"]);
const SHADOW = /shadow test|not a bench call/i;

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

export function isShadow(row) {
  return SHADOW.test(String(row?.final_call ?? ""));
}

// Measured 2026-09-12: "LATE FOMO" x2 beside "Late FOMO" x25, "HEATING UP" x1 beside "Heating Up" x45.
const FOMO = {
  "post-fomo fade": "Post-FOMO Fade",
  "late fomo": "Late FOMO",
  "heating up": "Heating Up",
  "pre-fomo": "Pre-FOMO",
  "no fomo": "No FOMO",
  neutral: "Neutral",
  "post-peak washout": "Post-peak washout",
};

export function normalizeFomo(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim();
  return FOMO[s.toLowerCase()] ?? s;
}

// Measured 2026-09-12 over 123 rows: min 30, p25 55, median 58, p75 62, max 85.
// Confidence is bunched, so three bands is all the data can support.
export function confidenceBand(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 55) return "<55";
  if (n < 62) return "55-61";
  return "62+";
}

export function provenance(row) {
  return String(row?.call_type ?? "").trim() ? "declared" : "prose";
}

/** One entry per scored checkpoint. */
export function entries(rows, { includeShadow = false } = {}) {
  const out = [];
  for (const r of rows ?? []) {
    if (!includeShadow && isShadow(r)) continue;
    for (const [horizon, c] of Object.entries(r?.checkpoints ?? {})) {
      if (!c) continue;
      out.push({
        id: r.id ?? null,
        ticker: r.ticker ?? null,
        horizon,
        call_type: String(r.call_type ?? "").trim().toLowerCase() || null,
        provenance: provenance(r),
        origin: r.origin ?? null,
        engine: r.engine ?? null,
        confidence_band: confidenceBand(r.confidence_pct),
        fomo: normalizeFomo(r.fomo),
        market_risk: r.market_risk ?? null,
        verdict: c.verdict ?? null,
        note: c.note ?? null,
        alpha: typeof c.alpha === "number" && Number.isFinite(c.alpha) ? c.alpha : null,
      });
    }
  }
  return out;
}

/**
 * Group entries by keyFn. A null key is reported as "(none)", never dropped.
 *
 * withAlpha: pass false whenever a group can hold more than one call type. A
 * correct pass has NEGATIVE alpha (the name lagged and we skipped it), and a
 * conditional that never triggered while the name ran is WRONG with POSITIVE
 * alpha. A mean alpha pooled across types is a number with no meaning. The
 * verdict-based win rate is direction-aware and is safe to pool.
 */
export function groupStats(list, keyFn, { minN = MIN_N, withAlpha = true } = {}) {
  const groups = new Map();
  for (const e of list) {
    const raw = keyFn(e);
    const key = raw === null || raw === undefined ? "(none)" : String(raw);
    if (!groups.has(key)) groups.set(key, { key, n: 0, right: 0, wrong: 0, flat: 0, not_scorable: 0, alphaSum: 0, alphaN: 0, callTypes: new Set() });
    const g = groups.get(key);
    g.n++;
    g.callTypes.add(e.call_type ?? null);
    if (VERDICTS.includes(e.verdict)) g[e.verdict]++;
    if (REAL.has(e.verdict) && typeof e.alpha === "number" && Number.isFinite(e.alpha)) {
      g.alphaSum += e.alpha;
      g.alphaN++;
    }
  }
  return [...groups.values()]
    .map((g) => {
      const real = g.right + g.wrong + g.flat;
      const suppressed = real < minN;
      return {
        key: g.key,
        n: g.n,
        real,
        right: g.right,
        wrong: g.wrong,
        flat: g.flat,
        not_scorable: g.not_scorable,
        win_rate: suppressed ? null : round1((g.right / real) * 100),
        mean_alpha: !withAlpha || g.callTypes.size !== 1 || g.callTypes.has(null) || suppressed || g.alphaN < minN ? null : round2(g.alphaSum / g.alphaN),
        suppressed,
      };
    })
    .sort((a, b) => b.real - a.real || a.key.localeCompare(b.key));
}

/** Three honest ways to count "the record", each labelled. Unfiltered, so it reconciles with the site. */
export function recordCounts(rows) {
  const fresh = () => ({ n: 0, right: 0, wrong: 0, flat: 0, not_scorable: 0 });
  const bump = (t, v) => {
    t.n++;
    if (VERDICTS.includes(v)) t[v]++;
  };
  const every = fresh();
  const latest = fresh();
  const latestReal = fresh();
  for (const r of rows ?? []) {
    const cp = r?.checkpoints ?? {};
    for (const c of Object.values(cp)) if (c) bump(every, c.verdict);
    const h = HORIZON_ORDER.find((k) => cp[k]);
    if (h) bump(latest, cp[h].verdict);
    const hr = HORIZON_ORDER.find((k) => cp[k] && REAL.has(cp[k].verdict));
    if (hr) bump(latestReal, cp[hr].verdict);
  }
  return {
    every_checkpoint_entry: { ...every, note: "what the site masthead counts; a call scored at 1w and 1m counts twice" },
    one_per_call_latest_horizon: { ...latest, note: "each call once, at its most advanced checkpoint" },
    one_per_call_latest_real_verdict: { ...latestReal, note: "each call once, at its most advanced right/wrong/flat - the recommended headline" },
  };
}

/** The date the first closing checkpoint can land. Until then every statistic is a short-horizon statistic. */
export function firstClosingDate(rows) {
  const oldest = (rows ?? [])
    .map((r) => r?.date)
    .filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()[0];
  if (!oldest) return null;
  const t = new Date(`${oldest}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + HORIZON_DAYS[CLOSING_HORIZON]);
  return t.toISOString().slice(0, 10);
}
