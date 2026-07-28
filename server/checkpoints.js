// checkpoints.js — which scoring horizons are due for a row. Pure date maths.
//
// Calendar days, not trading days: the asset and its benchmark are both read on
// the nearest prior available close, so weekends and holidays resolve the same
// way on both sides and the alpha stays honest. A market calendar would add a
// dependency without adding accuracy.
//
// Spec: docs/scorecard-spec.md

export const HORIZON_DAYS = { "1w": 7, "1m": 30, "3m": 90 };

// The horizon at which a row leaves the open board.
export const CLOSING_HORIZON = "3m";

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(iso) {
  return new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
}

export function checkpointDate(row, key) {
  const days = HORIZON_DAYS[key];
  if (days === undefined) throw new Error(`unknown horizon: ${key}`);
  return new Date(toDate(row.date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// A row is closed once it carries an outcome — same rule reconcile.js uses.
export function isBookClosed(row) {
  return Boolean(row?.outcome);
}

// The last bar on or before `isoDate`, or null. A checkpoint can land on a
// weekend or a holiday; asset and benchmark both resolve to the nearest PRIOR
// close so the two sides of the alpha are always read on the same session.
// Never interpolates — an unobservable price stays unobservable.
export function closeOnOrBefore(bars, isoDate) {
  let best = null;
  for (const bar of bars ?? []) {
    if (bar?.date && bar.date <= isoDate && (!best || bar.date > best.date)) best = bar;
  }
  return best;
}

// Horizons that have elapsed as of `today` and are not already settled.
//
// Scoring is append-only for REAL verdicts: right/wrong/flat are never
// recomputed. A `not_scorable` entry is a placeholder, not a verdict — it says
// "we could not judge this yet" (missing price, or a trigger still trapped in
// prose). Freezing those would mean backfilling a trigger could never rescue
// the row it was backfilled for, so a placeholder stays due.
const SETTLED = new Set(["right", "wrong", "flat"]);

export function dueCheckpoints(row, today) {
  if (isBookClosed(row)) return [];
  const now = toDate(today);
  const already = row?.checkpoints ?? {};
  return Object.keys(HORIZON_DAYS).filter((key) => {
    if (SETTLED.has(already[key]?.verdict)) return false;
    return toDate(checkpointDate(row, key)) <= now;
  });
}
