// checkpoints.js — which scoring horizons are due for a row. Pure date maths.
//
// Calendar days, not trading days: the asset and its benchmark are both read on
// the nearest prior available close, so weekends and holidays resolve the same
// way on both sides and the alpha stays honest. A market calendar would add a
// dependency without adding accuracy.
//
// Spec: docs/scorecard-spec.md

import { nyDate } from "./nyDate.js";

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

// The session the logged price belongs to.
//
// Usually that is row.date. But 42 rows (counted 2026-10-04) were logged the
// evening before, or over a weekend, with review_time naming the earlier
// session: "2026-09-09 21:52 CT after the close", "Jul 15 close",
// "2026-09-22T20:50:00-05:00". Their price is that session's, so the benchmark
// leg and the split test both start there.
//
// A review date is only trusted when it sits at most a week before row.date.
// Anything else — time only, unparseable, later than the row — is row.date.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const REVIEW_LOOKBACK_DAYS = 7;

function writtenDay(reviewTime, rowDate) {
  const s = String(reviewTime ?? "").trim();
  if (ISO_INSTANT.test(s)) {
    const t = new Date(s);
    return Number.isNaN(t.getTime()) ? null : nyDate(t);
  }
  const ymd = /^(\d{4}-\d{2}-\d{2})\b/.exec(s);
  if (ymd) return ymd[1];
  const md = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2})\b/.exec(s);
  const month = md && MONTHS[md[1].toLowerCase()];
  if (!month) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const year = Number(rowDate.slice(0, 4));
  const sameYear = `${year}-${pad(month)}-${pad(md[2])}`;
  // "Dec 31" on a row dated in January is last year's.
  return sameYear <= rowDate ? sameYear : `${year - 1}-${pad(month)}-${pad(md[2])}`;
}

export function reviewDay(row) {
  const rowDate = String(row?.date ?? "").slice(0, 10);
  const day = writtenDay(row?.review_time, rowDate);
  if (!day || day > rowDate) return rowDate;
  const gap = (toDate(rowDate).getTime() - toDate(day).getTime()) / DAY_MS;
  return gap <= REVIEW_LOOKBACK_DAYS ? day : rowDate;
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

// Horizons that carry a real verdict, open row or closed. A normal run never
// looks at these again. Only the scorer's --recheck audit does, and only to
// find a verdict that was computed across two share bases (scorecard.js).
export function settledCheckpoints(row) {
  const already = row?.checkpoints ?? {};
  return Object.keys(HORIZON_DAYS).filter((key) => SETTLED.has(already[key]?.verdict));
}
