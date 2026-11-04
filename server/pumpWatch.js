// pumpWatch.js - which way is a watched name heading this morning? Pure logic; scripts/pump-watch.mjs
// does the I/O and scripts/trip-judge.mjs runs it on the same 5-minute tick.
//
// WHY (Adam, 2026-11-04, after AMZN ran 250.69 -> 270 on the election open and the desk had only a
// pullback plan at 226-231): "If I say watch a ticker like amazon for the pump. You run the hunters and
// set a 5 min check until lunch time and find out which direction it's likely heading."
//
// THE READ, from today's regular-session 5-minute bars (no prediction, just where the tape is pointing):
//   FORMING  the first 30 minutes (09:30-10:00 ET) have not finished; nothing is called yet.
//   UP       last trade above the opening-range high AND above session VWAP, volume pace >= MIN_PACE.
//   DOWN     last trade below the opening-range low AND below session VWAP, volume pace >= MIN_PACE.
//   UNCLEAR  anything else: inside the range, or on the wrong side of VWAP, or on thin volume.
// A first UP or DOWN of the day (or a flip from one to the other) is a CALL: the tick starts the judge,
// which checks it on live Robinhood data and the v35 framework and texts BUY / WAIT / NO.
// Volume pace = today's volume so far / (20-day average x the share of the session gone by).

export const MIN_PACE = 1.5;
export const OPENING_RANGE_MIN = 30;
export const DEFAULT_UNTIL = "12:00"; // CT, "until lunch time"
export const MAX_CALLS_PER_TICKER = 2; // one per direction a day
export const MAX_PUMP_JUDGES_PER_DAY = 4; // cost cap across all watches (review finding 6c)
export const GAP_PCT = 3; // a gap this size that HOLDS is the move itself (review finding 6d: AMZN 11/04 made its run on the gap)

const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

// bars: [{ t (unix seconds), o, h, l, c, v }] for the regular session only, oldest first.
export function readDirection({ bars, prevClose, avgVol, regStart, regEnd, now }) {
  const clean = (bars || []).filter((b) => b && b.c != null && b.h != null && b.l != null && b.t >= regStart && b.t < regEnd);
  const nowS = Math.floor((now ?? Date.now()) / 1000);
  const base = { prev: r2(prevClose), last: clean.length ? r2(clean.at(-1).c) : null };
  if (!clean.length) return { ...base, read: "FORMING", why: "no regular-session bars yet" };
  const orEnd = regStart + OPENING_RANGE_MIN * 60;
  const orBars = clean.filter((b) => b.t < orEnd);
  const gap_pct = prevClose ? r2(((clean[0].o ?? clean[0].c) / prevClose - 1) * 100) : null;
  if (nowS < orEnd || !orBars.length) return { ...base, gap_pct, read: "FORMING", why: "the first 30 minutes have not closed" };

  const or_high = Math.max(...orBars.map((b) => b.h));
  const or_low = Math.min(...orBars.map((b) => b.l));
  let pv = 0, vol = 0;
  for (const b of clean) { const v = b.v || 0; pv += ((b.h + b.l + b.c) / 3) * v; vol += v; }
  const vwap = vol ? pv / vol : null;
  const elapsed = Math.min(1, Math.max(0, (Math.min(nowS, regEnd) - regStart) / (regEnd - regStart)));
  const pace = avgVol && elapsed > 0 ? vol / (avgVol * elapsed) : null;
  const last = clean.at(-1).c;
  const out = { ...base, gap_pct, or_high: r2(or_high), or_low: r2(or_low), vwap: r2(vwap), pace: r2(pace), session_high: r2(Math.max(...clean.map((b) => b.h))), session_low: r2(Math.min(...clean.map((b) => b.l))) };

  const heavy = pace != null && pace >= MIN_PACE;
  if (last > or_high && vwap != null && last > vwap && heavy) return { ...out, read: "UP", why: `over the ${r2(or_high)} opening-range high and the ${r2(vwap)} VWAP on ${r2(pace)}x volume pace` };
  if (last < or_low && vwap != null && last < vwap && heavy) return { ...out, read: "DOWN", why: `under the ${r2(or_low)} opening-range low and the ${r2(vwap)} VWAP on ${r2(pace)}x volume pace` };
  // GAP-AND-HOLD: the move already happened on the open (AMZN +5.6% on 11/04). A 3%+ gap still above VWAP and in
  // the top half of its opening range on heavy volume is holding, not fading; the mirror for a gap down.
  const mid = (or_high + or_low) / 2;
  if (gap_pct != null && gap_pct >= GAP_PCT && vwap != null && last > vwap && last >= mid && heavy) return { ...out, read: "UP", why: `a ${gap_pct}% gap holding: over the ${r2(vwap)} VWAP and the top half of the ${r2(or_low)}-${r2(or_high)} opening range on ${r2(pace)}x volume pace` };
  if (gap_pct != null && gap_pct <= -GAP_PCT && vwap != null && last < vwap && last <= mid && heavy) return { ...out, read: "DOWN", why: `a ${gap_pct}% gap holding down: under the ${r2(vwap)} VWAP and the bottom half of the ${r2(or_low)}-${r2(or_high)} opening range on ${r2(pace)}x volume pace` };
  const why = last >= or_low && last <= or_high ? "inside the opening range"
    : !heavy ? `volume pace ${r2(pace) ?? "unknown"}x is under ${MIN_PACE}x`
    : "on the wrong side of VWAP for its break";
  return { ...out, read: "UNCLEAR", why };
}

// Is this watch live at this CT time today?
export function isActive(w, today, hhmm) {
  return w && w.date === today && !w.ended && hhmm <= (w.until || DEFAULT_UNTIL);
}

// Decide what a tick does with a fresh read: "call" (start the judge), "end" (past lunch, send the wrap-up)
// or "none". A call fires on the first UP or DOWN of the day for that direction, at most MAX_CALLS_PER_TICKER.
export function nextAction(w, read, today, hhmm) {
  if (!w || w.date !== today || w.ended) return { act: "none" };
  if (hhmm > (w.until || DEFAULT_UNTIL)) return { act: "end" };
  if (read.read !== "UP" && read.read !== "DOWN") return { act: "none" };
  const calls = w.calls || [];
  if (calls.length >= MAX_CALLS_PER_TICKER || calls.some((c) => c.read === read.read)) return { act: "none" };
  return { act: "call" };
}

export function judgeTrip(w, read) {
  const up = read.read === "UP";
  return {
    ticker: w.ticker, kind: "PUMP", dir: up ? "above" : "below", price: up ? read.or_high : read.or_low,
    touched: read.last, last: read.last, prev: read.prev, src: `pump-watch ${w.date}`, key: `${w.ticker}|PUMP|${read.read}`,
    pump: { read: read.read, why: read.why, catalyst: w.why || "none given", vwap: read.vwap, or_high: read.or_high, or_low: read.or_low, pace: read.pace, gap_pct: read.gap_pct, session_high: read.session_high, session_low: read.session_low },
  };
}

export function endCard(w, read) {
  const calls = (w.calls || []).map((c) => `${c.read} at ${c.at_ct}`).join(", ");
  const head = calls ? `${w.ticker} pump watch ended at ${w.until || DEFAULT_UNTIL} CT. Called: ${calls}.` : `${w.ticker} pump watch ended at ${w.until || DEFAULT_UNTIL} CT with no direction call.`;
  const now = read && read.last != null ? ` Now ${read.last} (${read.read}: ${read.why}). Range ${read.or_low ?? "?"}-${read.or_high ?? "?"}, VWAP ${read.vwap ?? "?"}, prior close ${read.prev ?? "?"}.` : "";
  return `${head}${now} Catalyst: ${w.why || "none given"}.`;
}
