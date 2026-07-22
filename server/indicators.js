// indicators.js — Lens 1 technical math. Pure functions over a close series.
// Covers SMA, EMA, RSI(14), MACD(12,26,9), and a Trend Strength 0-10 heuristic.
// Lens 2 (insider filings, ETF flows, analyst targets, peer check) is NOT here —
// it cannot be computed from price and must come from other sources or be passed
// as "not observable". A price-only packet must never produce a full-scorecard
// verdict on its own. (HANDOFF-code issue #7.)

export function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values, then roll forward.
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Full MACD line, signal, histogram using an EMA series.
export function macd(values, fast = 12, slow = 26, signal = 9) {
  if (values.length < slow + signal) return null;
  const emaSeries = (arr, p) => {
    const out = [];
    const k = 2 / (p + 1);
    let e = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
    out[p - 1] = e;
    for (let i = p; i < arr.length; i++) {
      e = arr[i] * k + e * (1 - k);
      out[i] = e;
    }
    return out;
  };
  const fastE = emaSeries(values, fast);
  const slowE = emaSeries(values, slow);
  const macdLine = values.map((_, i) =>
    fastE[i] != null && slowE[i] != null ? fastE[i] - slowE[i] : null
  );
  const macdVals = macdLine.filter((v) => v != null);
  const signalLine = ema(macdVals, signal);
  const line = macdLine[macdLine.length - 1];
  return {
    line,
    signal: signalLine,
    histogram: line != null && signalLine != null ? line - signalLine : null
  };
}

// Trend Strength Score (0-10) from higher highs/lows, MA alignment (20>50>200),
// distance above the 200 SMA, and momentum persistence. A heuristic that feeds
// the Technical Grade — not a substitute for the model's read.
export function trendStrength(closes) {
  if (closes.length < 30) return { score: null, note: "insufficient history" };
  const last = closes[closes.length - 1];
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  let score = 5;
  const notes = [];

  // MA alignment
  if (s20 != null && s50 != null && s200 != null) {
    if (s20 > s50 && s50 > s200) {
      score += 2;
      notes.push("clean bullish stack 20>50>200");
    } else if (s20 < s50 && s50 < s200) {
      score -= 2;
      notes.push("bearish stack 20<50<200");
    }
    if (last > s200) score += 1;
    else score -= 1;
  }

  // Higher highs / higher lows over the last ~20 bars vs the prior ~20.
  const recent = closes.slice(-20);
  const prior = closes.slice(-40, -20);
  if (prior.length === 20) {
    if (Math.max(...recent) > Math.max(...prior)) score += 1;
    if (Math.min(...recent) > Math.min(...prior)) score += 1;
    if (Math.max(...recent) < Math.max(...prior)) score -= 1;
  }

  // Momentum persistence
  const r = rsi(closes);
  if (r != null) {
    if (r > 55) score += 1;
    else if (r < 45) score -= 1;
  }

  score = Math.max(0, Math.min(10, score));
  const band =
    score >= 9 ? "Elite" : score >= 7 ? "Strong" : score >= 5 ? "Neutral" : score >= 3 ? "Weak" : "Broken";
  return { score, band, note: notes.join("; ") || "neutral" };
}

// Bundle the indicators for a single symbol's close series.
export function computeIndicators(closes) {
  return {
    last: closes.length ? closes[closes.length - 1] : null,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    ema20: ema(closes, 20),
    rsi14: rsi(closes),
    macd: macd(closes),
    trend_strength: trendStrength(closes)
  };
}
