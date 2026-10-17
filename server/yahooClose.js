// yahooClose.js — settle the newest daily bar when Yahoo posts it without a close.
//
// THE BUG (2026-10-14 19:10 CT): after the bell, Yahoo's chart API (interval=1d) returns
// today's bar with close = null (open/high/low/volume are present) for a while, while
// meta.regularMarketPrice already holds the settled price. Scripts that skip null closes
// silently lose today's bar, so regime.mjs stamped "as of 2026-10-13" and named the wrong
// next-session macro event (CPI instead of PPI). Reproduced live the same night on ASTS,
// HIMS, MRNA, IREN, APLD and AAOI.
//
// THE FIX: when the NEWEST bar's close is null, take meta.regularMarketPrice as its close,
// but only when all of these hold. Anything else leaves the null in place (the caller drops
// it, the old behaviour):
//   - regularMarketPrice is a finite number > 0
//   - regularMarketTime falls on the same calendar date (exchange time zone) as the bar
//   - the regular session for that date is over, with a short grace for the closing print
// A mid-session bar is never filled: the price is not a close until the bell has rung.
// A null anywhere but the newest bar is never filled.

export const CLOSE_GRACE_SEC = 10 * 60;

function dayIn(epochSec, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(epochSec * 1000));
}

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

// Is the regular session that owns `barDate` finished (plus grace) at `nowSec`?
function sessionOver(meta, tz, barDate, nowSec) {
  const reg = meta.currentTradingPeriod?.regular;
  if (isNum(reg?.start) && isNum(reg?.end)) {
    const periodDate = dayIn(reg.start, tz);
    if (periodDate === barDate) return nowSec >= reg.end + CLOSE_GRACE_SEC;
    return periodDate > barDate; // Yahoo already rolled to a later session: the bar's day is over
  }
  // No trading-period block: only a bar from an earlier calendar day is surely over.
  return barDate < dayIn(nowSec, tz);
}

// result: chart.result[0]. Returns { closes, filled }; closes lines up index-for-index with
// result.timestamp (nulls elsewhere stay null). The input is never mutated.
export function settledCloses(result, { now = new Date() } = {}) {
  const raw = result?.indicators?.quote?.[0]?.close;
  const closes = Array.isArray(raw) ? [...raw] : [];
  const stamps = result?.timestamp;
  if (!Array.isArray(stamps) || !stamps.length) return { closes, filled: false };
  const last = stamps.length - 1;
  if (closes[last] !== null && closes[last] !== undefined) return { closes, filled: false };

  const meta = result.meta ?? {};
  const price = meta.regularMarketPrice;
  const priceTime = meta.regularMarketTime;
  if (!isNum(price) || price <= 0 || !isNum(priceTime)) return { closes, filled: false };

  const tz = meta.exchangeTimezoneName || "America/New_York";
  const barDate = dayIn(stamps[last], tz);
  if (dayIn(priceTime, tz) !== barDate) return { closes, filled: false };
  if (!sessionOver(meta, tz, barDate, now.getTime() / 1000)) return { closes, filled: false };

  closes[last] = price;
  return { closes, filled: true };
}
