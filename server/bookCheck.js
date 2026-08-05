// bookCheck.js — find calls that were made somewhere and never logged. Pure.
//
// v1 asked "does this ticker have a row?" That gave FALSE CONFIDENCE, which is
// worse than no checker at all. AMD was discussed and passed on 2026-08-04 and
// never written to the book; by the next morning the pre-market routine had
// logged an AMD row for 08-05, so the ticker read as covered while the actual
// decision was missing. One row made a ticker look accounted for even though
// three separate calls had been made on it.
//
// v2 matches a mention to a row NEAR THAT DATE. A call made on the 4th needs a
// row on the 4th (or the next morning, since write-ups legitimately lag by a
// session). Anything further apart is drift, not a write-up.

// $TICKER is the reliable signal. A bare uppercase word is not — "AI", "CEO"
// and "THE" would all read as tickers and bury the real findings in noise.
const CASHTAG = /\$([A-Z]{1,5})\b/g;

// Appear constantly as market context rather than as calls.
const BENCHMARKS = new Set([
  "SPY", "QQQ", "DIA", "VIX", "SPX", "NDX", "IWM", "TLT", "HYG", "GLD", "USO", "BTC", "ETH",
]);

// $X is a real ticker (US Steel) but in our own notes it is nearly always a
// placeholder — "$X was transferred in", "$X.XX". Ignoring it trades a rare
// true positive for a guaranteed recurring false one.
const PLACEHOLDERS = new Set(["X", "XX", "XXX", "XXXX"]);

// A call written up the next session is normal. Two days later is drift.
const DEFAULT_WINDOW_DAYS = 1;

export function cashtags(text) {
  const found = new Set();
  for (const m of String(text).matchAll(CASHTAG)) {
    const t = m[1];
    if (!BENCHMARKS.has(t) && !PLACEHOLDERS.has(t)) found.add(t);
  }
  return found;
}

const daysApart = (a, b) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

// mentions: [{ ticker, date, where }]   rows: [{ ticker, date }]
// Returns [{ ticker, date, where: [...], nearest }] — one per uncovered
// ticker-day, with the nearest existing row so the gap is actionable.
export function findGaps(mentions = [], rows = [], windowDays = DEFAULT_WINDOW_DAYS) {
  const byTicker = new Map();
  for (const r of rows) {
    const t = String(r.ticker).toUpperCase();
    if (!byTicker.has(t)) byTicker.set(t, []);
    byTicker.get(t).push(r.date);
  }

  // Collapse repeated mentions of the same ticker on the same day, keeping
  // every source — one gap, several places it was said.
  const byKey = new Map();
  for (const m of mentions) {
    const ticker = String(m.ticker).toUpperCase();
    const key = `${ticker}|${m.date}`;
    if (!byKey.has(key)) byKey.set(key, { ticker, date: m.date, where: [] });
    if (m.where) byKey.get(key).where.push(m.where);
  }

  const gaps = [];
  for (const { ticker, date, where } of byKey.values()) {
    const dates = byTicker.get(ticker) ?? [];
    const covered = dates.some((d) => daysApart(d, date) <= windowDays);
    if (covered) continue;

    // Nearest row for this ticker, so the report can say "logged, but on the
    // wrong day" rather than just "missing".
    let nearest = null;
    let best = Infinity;
    for (const d of dates) {
      const gap = daysApart(d, date);
      if (gap < best) {
        best = gap;
        nearest = d;
      }
    }
    gaps.push({ ticker, date, where, nearest });
  }

  return gaps.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
}
