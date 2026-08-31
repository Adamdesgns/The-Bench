// evidence.js — setup base rates from historical closes. Pure: no network, no fs.
//
// This is the quant leg of the framework (v28 QUANT EVIDENCE): "what happened
// the last N times this ticker did X." It counts, it never predicts — the
// output is a sample, a distribution and an honest grade, and the framework
// decides what it means. A pretty base rate is never a buy signal.
//
// Bars are [{date, close}] oldest -> newest — the getDatedCloses shape.
// Spec: docs/integrations/vibe-trading-audit.md (slice 1)

import { closeOnOrBefore } from "./checkpoints.js";

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// Event detection. Consecutive qualifying days are one event, dated to the
// first day of the run — a 3-day slide that keeps qualifying is one slide,
// not three samples.
export function detectEvents(bars, setup) {
  const qualifies = qualifier(bars, setup);
  const events = [];
  let inRun = false;
  for (let i = 0; i < bars.length; i += 1) {
    const q = qualifies(i);
    if (q && !inRun) events.push(i);
    inRun = q;
  }
  return events;
}

function qualifier(bars, setup) {
  const kind = setup?.kind;
  if (kind === "move") {
    const { windowDays, thresholdPct } = setup;
    if (!Number.isFinite(windowDays) || windowDays < 1 || !Number.isFinite(thresholdPct)) {
      throw new Error("move setup needs windowDays >= 1 and a numeric thresholdPct");
    }
    return (i) => {
      if (i < windowDays) return false;
      const from = bars[i - windowDays].close;
      if (!from) return false;
      const pct = ((bars[i].close - from) / from) * 100;
      return thresholdPct >= 0 ? pct >= thresholdPct : pct <= thresholdPct;
    };
  }
  if (kind === "breakout" || kind === "breakdown") {
    const { lookback } = setup;
    if (!Number.isFinite(lookback) || lookback < 1) throw new Error(`${kind} setup needs lookback >= 1`);
    return (i) => {
      if (i < lookback) return false;
      const window = bars.slice(i - lookback, i).map((b) => b.close);
      return kind === "breakout"
        ? bars[i].close > Math.max(...window)
        : bars[i].close < Math.min(...window);
    };
  }
  throw new Error(`unknown setup kind: ${kind}`);
}

// Events closer together than the horizon share forward windows — they are one
// observation wearing two dates. The grade is built on this count, not the raw
// one, so overlap can never dress a thin sample up as a fat one.
export function independentCount(eventIdxs, horizonBars) {
  let count = 0;
  let lastKept = -Infinity;
  for (const i of eventIdxs) {
    if (i - lastKept >= horizonBars) {
      count += 1;
      lastKept = i;
    }
  }
  return count;
}

// Forward return per event over horizonBars trading bars. Events whose horizon
// has not elapsed are counted as pending and excluded — never extrapolated.
// Benchmark legs resolve by DATE (nearest prior close), same rule the
// checkpoint scorer uses, so both sides of the alpha read the same session.
export function forwardReturns(bars, eventIdxs, horizonBars, benchBars = null) {
  const instances = [];
  let pending = 0;
  for (const i of eventIdxs) {
    const j = i + horizonBars;
    if (j >= bars.length) {
      pending += 1;
      continue;
    }
    const entry = bars[i].close;
    const exit = bars[j].close;
    const pct = round2(((exit - entry) / entry) * 100);
    let alpha = null;
    if (benchBars) {
      const b0 = closeOnOrBefore(benchBars, bars[i].date)?.close;
      const b1 = closeOnOrBefore(benchBars, bars[j].date)?.close;
      if (typeof b0 === "number" && typeof b1 === "number" && b0 !== 0) {
        alpha = round2(pct - ((b1 - b0) / b0) * 100);
      }
    }
    instances.push({ date: bars[i].date, entry, exit_date: bars[j].date, exit, pct, alpha });
  }
  return { instances, pending };
}

export function summarize(instances) {
  const n = instances.length;
  if (!n) {
    return {
      n: 0, win_rate: null, avg_pct: null, median_pct: null,
      best_pct: null, worst_pct: null, avg_alpha: null, alpha_win_rate: null
    };
  }
  const pcts = instances.map((x) => x.pct).sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 ? pcts[mid] : round2((pcts[mid - 1] + pcts[mid]) / 2);
  const alphas = instances.map((x) => x.alpha).filter((a) => typeof a === "number");
  return {
    n,
    win_rate: round1((instances.filter((x) => x.pct > 0).length / n) * 100),
    avg_pct: round2(pcts.reduce((s, p) => s + p, 0) / n),
    median_pct: median,
    best_pct: pcts[n - 1],
    worst_pct: pcts[0],
    avg_alpha: alphas.length ? round2(alphas.reduce((s, a) => s + a, 0) / alphas.length) : null,
    alpha_win_rate: alphas.length ? round1((alphas.filter((a) => a > 0).length / alphas.length) * 100) : null
  };
}

// The grade answers one question: how hard is it for this sample to be lying?
// It is a property of the EVIDENCE, not of the setup — a great setup with 4
// occurrences is still a D, and a D never outranks primary framework evidence.
export function gradeEvidence({ events, independent, spanYears, source }) {
  if (source === "none" || !events) {
    return { grade: "F", why: "no observable events — nothing to grade" };
  }
  const base = `${independent} independent event(s) over ${spanYears}y (${events} raw)`;
  if (independent < 5) return { grade: "D", why: `${base} — sample too small to mean anything` };
  if (independent < 15 || spanYears < 2) {
    return { grade: "C", why: `${base} — directional at best: thin sample or single regime` };
  }
  if (independent < 30 || spanYears < 5) {
    return { grade: "B", why: `${base} — useful, not yet regime-proof` };
  }
  return { grade: "A", why: `${base} — large sample across multiple regimes` };
}

export function barsSpanYears(bars) {
  if (!bars?.length) return 0;
  const ms = new Date(`${bars[bars.length - 1].date}T00:00:00Z`) - new Date(`${bars[0].date}T00:00:00Z`);
  return round1(ms / (365.25 * 24 * 3600 * 1000));
}
