// pumpWatch.js - which way is a watched name heading this morning? Pure logic; scripts/pump-watch.mjs
// does the I/O and scripts/trip-judge.mjs runs it on the same 5-minute tick.
//
// WHY (Adam, 2026-11-04, after AMZN ran 250.69 -> 270 on the election open and the desk had only a
// pullback plan at 226-231): "If I say watch a ticker like amazon for the pump. You run the hunters and
// set a 5 min check until lunch time and find out which direction it's likely heading."
//
// THE READ, from today's regular-session 5-minute bars (no prediction, just where the tape is pointing):
//   FORMING  the first 30 minutes (09:30-10:00 ET) have not finished and no early read below has fired.
//   FLUSH    EARLY, inside the first 30 minutes (from 5 minutes in): opened down GAP_PCT+, and the last trade is
//            back over the open AND over VWAP, FLUSH_BOUNCE_PCT+ off the session low, volume pace >= MIN_PACE.
//            Counts as UP. Added 2026-11-12 after NVDA opened 150.99 (-13%), flushed to 148.80 in five minutes and
//            was 159.55 by 08:40 CT, all before the old read could say anything (B-1452, P-074; Adam: "I TOLD you
//            not to miss this").
//   FADE     the mirror, counts as DOWN: opened up GAP_PCT+, now under the open and VWAP, FLUSH_BOUNCE_PCT+ off the high.
//   UP       last trade above the opening-range high AND above session VWAP, volume pace >= MIN_PACE.
//   DOWN     last trade below the opening-range low AND below session VWAP, volume pace >= MIN_PACE.
//   UNCLEAR  anything else: inside the range, or on the wrong side of VWAP, or on thin volume.
// A first UP or DOWN of the day (or a flip from one to the other) is a CALL: the tick starts the judge,
// which checks it on live Robinhood data and the v36 framework and texts BUY / WAIT / NO.
// Volume pace = today's volume so far / (20-day average x the share of a normal day's volume normally done by now).
// Not the share of the clock: volume comes in heavy at the open, so on an even clock an average morning read 2.2x at
// 09:00 CT and the 1.5x bar meant nothing before about 11:00 CT (docs/research/2026-11-09-pump-pace-clock.md).
// "Today's volume" is the feed's own day total, never the sum of the 5-minute bars: those carry junk rows (B-1362,
// GOOGL 11/09: 13.44M in one bar against a 0.34M median, called DOWN on 2.75x when it really ran about 1.3x). No day total, no pace.

export const MIN_PACE = 1.5;
export const OPENING_RANGE_MIN = 30;
export const DEFAULT_UNTIL = "12:00"; // CT, "until lunch time"
export const MAX_CALLS_PER_TICKER = 2; // one per direction a day
export const MAX_PUMP_JUDGES_PER_DAY = 4; // cost cap across all watches (review finding 6c)
export const GAP_PCT = 3; // a gap this size that HOLDS is the move itself (review finding 6d: AMZN 11/04 made its run on the gap)
// Adam, 2026-11-12: "Watch starts at 8am catches the pre market through the open from now on." The tick reads every
// live watch from 08:00 CT; before the 08:30 open it sends one pre-market card, then FLUSH / FADE can fire from 08:35.
export const PUMP_FIRST_TICK = "08:00"; // CT
export const OPEN_CT = "08:30"; // the regular-session open, CT
export const FLUSH_BOUNCE_PCT = 3; // how far off the extreme the reclaim has to be, so a one-tick poke is not a call
export const FLUSH_MIN_MINUTES = 5; // at least one whole 5-minute bar before an early read can fire
// Which way each call points. An early read has its OWN slot (one per watch a day) and its own judge cap, so a
// FLUSH judged at 08:35 never uses up the 09:00+ UP call or the MAX_PUMP_JUDGES_PER_DAY budget (review 2026-11-12,
// finding 3). A second judge on the same move is caught by the judge's own same-plan test (trip-judge-v1 step 1).
export const DIR_OF = { UP: "UP", FLUSH: "UP", DOWN: "DOWN", FADE: "DOWN" };
export const EARLY_READS = new Set(["FLUSH", "FADE"]);
export const MAX_EARLY_JUDGES_PER_DAY = 3; // across all watches

const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

// ATR(14), Wilder's smoothing, from completed daily bars [{ h, l, c }] oldest first. Null under 15 bars.
export function atr14(daily) {
  const d = (daily || []).filter((b) => b && [b.h, b.l, b.c].every(Number.isFinite));
  if (d.length < 15) return null;
  const tr = d.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - d[i].c), Math.abs(b.l - d[i].c)));
  let atr = tr.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  for (const x of tr.slice(14)) atr = (atr * 13 + x) / 14;
  return atr;
}

// The share of a normal day's official volume done by each 5-minute mark after the 09:30 ET open (point k = minute 5k).
// Median of 1,593 full name-days: 27 names, 59 sessions, 2026-08-17 to 2026-11-06. Rebuild and compare with
// `node scripts/volume-curve.mjs` (it prints, it never rewrites this). The last point is about 0.85, not 1: the
// closing auction is in the official day total but not in the 5-minute bars, and it lands at minute 390.
export const NORMAL_DAY_SHARE = [
  0.0000, 0.0727, 0.0975, 0.1184, 0.1379, 0.1557, 0.1718, 0.1878, 0.2006, 0.2146,
  0.2278, 0.2407, 0.2535, 0.2654, 0.2770, 0.2890, 0.3006, 0.3116, 0.3225, 0.3335,
  0.3432, 0.3550, 0.3640, 0.3750, 0.3834, 0.3936, 0.4016, 0.4107, 0.4189, 0.4266,
  0.4343, 0.4421, 0.4502, 0.4566, 0.4642, 0.4709, 0.4785, 0.4857, 0.4921, 0.4986,
  0.5057, 0.5112, 0.5194, 0.5267, 0.5330, 0.5391, 0.5452, 0.5522, 0.5593, 0.5661,
  0.5724, 0.5793, 0.5848, 0.5905, 0.5966, 0.6038, 0.6103, 0.6162, 0.6229, 0.6283,
  0.6349, 0.6408, 0.6486, 0.6549, 0.6628, 0.6717, 0.6804, 0.6890, 0.6960, 0.7058,
  0.7159, 0.7246, 0.7329, 0.7436, 0.7561, 0.7671, 0.7820, 0.8043, 0.8511,
];

// minutes after the open -> that share, in a straight line between marks. A half day is read at the same clock minute.
export function normalShare(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  if (minutes >= 390) return 1;
  const i = Math.floor(minutes / 5);
  const next = NORMAL_DAY_SHARE[i + 1] ?? 1;
  return NORMAL_DAY_SHARE[i] + (next - NORMAL_DAY_SHARE[i]) * (minutes / 5 - i);
}

// The bars may only claim the volume that really traded: whatever they add up to over the day's total comes off the
// biggest bars first, so junk rows lose their weight and an honest day is left alone. Measured 11/09 against
// Robinhood's clean bars on AMZN, GOOGL and NVDA, VWAP missed by 0.08% of price this way, 0.31% on the raw bars and
// 0.22% capping at 10x the median. No fixed multiple can sort them: an honest opening bar reaches 29x the median,
// as big as a junk row. So the opening bar goes last: it is honestly the biggest bar most days, and none of the 19
// junk days measured had its worst row there.
export function trimToDayVolume(vols, dayVolume) {
  const out = [...vols];
  let excess = out.reduce((a, v) => a + v, 0) - dayVolume;
  for (const i of out.map((_, j) => j).slice(1).sort((a, b) => out[b] - out[a]).concat(0)) {
    if (excess <= 0) break;
    const cut = Math.min(out[i], excess);
    out[i] -= cut;
    excess -= cut;
  }
  return out;
}

// bars: [{ t (unix seconds), o, h, l, c, v }] for the regular session only, oldest first.
// dayVolume: the session's real volume so far, from the feed's day total.
export function readDirection({ bars, prevClose, avgVol, dayVolume, regStart, regEnd, now, atr = null }) {
  const clean = (bars || []).filter((b) => b && b.c != null && b.h != null && b.l != null && b.t >= regStart && b.t < regEnd);
  const nowS = Math.floor((now ?? Date.now()) / 1000);
  const base = { prev: r2(prevClose), last: clean.length ? r2(clean.at(-1).c) : null, atr: r2(atr) };
  if (!clean.length) return { ...base, read: "FORMING", why: "no regular-session bars yet" };
  const orEnd = regStart + OPENING_RANGE_MIN * 60;
  const orBars = clean.filter((b) => b.t < orEnd);
  const open = clean[0].o ?? clean[0].c;
  const gap_pct = prevClose ? r2((open / prevClose - 1) * 100) : null;

  const day = Number.isFinite(dayVolume) && dayVolume > 0 ? dayVolume : null;
  const vols = clean.map((b) => (Number.isFinite(b.v) && b.v > 0 ? b.v : 0));
  const weights = day == null ? vols.map(() => 0) : trimToDayVolume(vols, day); // no day total: no bar can be trusted, so no VWAP
  let pv = 0, vol = 0;
  clean.forEach((b, i) => { pv += ((b.h + b.l + b.c) / 3) * weights[i]; vol += weights[i]; });
  const vwap = vol ? pv / vol : null;
  const share = normalShare((Math.min(nowS, regEnd) - regStart) / 60);
  const pace = day != null && avgVol && share > 0 ? day / (avgVol * share) : null;
  const last = clean.at(-1).c;
  const heavy = pace != null && pace >= MIN_PACE;
  const session_high = Math.max(...clean.map((b) => b.h));
  const session_low = Math.min(...clean.map((b) => b.l));

  if (nowS < orEnd || !orBars.length) {
    // EARLY READ (2026-11-12, B-1452): a gap that flushes and reclaims, or spikes and fades, is often done before the
    // opening range closes. Same evidence as UP/DOWN (VWAP, heavy pace), measured against the open instead of the range.
    const early = { ...base, gap_pct, open: r2(open), vwap: r2(vwap), pace: r2(pace), session_high: r2(session_high), session_low: r2(session_low) };
    // Only inside the first 30 minutes (a name with no bars there, halted or late to open, gets no early read after
    // 09:00), and only after one whole 5-minute bar from its first print.
    if (nowS < orEnd && nowS >= Math.max(regStart, clean[0].t) + FLUSH_MIN_MINUTES * 60 && heavy && vwap != null && gap_pct != null) {
      if (gap_pct <= -GAP_PCT && last > open && last > vwap && last >= session_low * (1 + FLUSH_BOUNCE_PCT / 100))
        return { ...early, read: "FLUSH", why: `a ${gap_pct}% gap down flushed to ${r2(session_low)} and is back over the ${r2(open)} open and the ${r2(vwap)} VWAP on ${r2(pace)}x volume pace` };
      if (gap_pct >= GAP_PCT && last < open && last < vwap && last <= session_high * (1 - FLUSH_BOUNCE_PCT / 100))
        return { ...early, read: "FADE", why: `a ${gap_pct}% gap up spiked to ${r2(session_high)} and is back under the ${r2(open)} open and the ${r2(vwap)} VWAP on ${r2(pace)}x volume pace` };
    }
    return { ...early, read: "FORMING", why: "the first 30 minutes have not closed" };
  }

  const or_high = Math.max(...orBars.map((b) => b.h));
  const or_low = Math.min(...orBars.map((b) => b.l));
  const out = { ...base, gap_pct, or_high: r2(or_high), or_low: r2(or_low), vwap: r2(vwap), pace: r2(pace), session_high: r2(session_high), session_low: r2(session_low) };

  if (last > or_high && vwap != null && last > vwap && heavy) return { ...out, read: "UP", why: `over the ${r2(or_high)} opening-range high and the ${r2(vwap)} VWAP on ${r2(pace)}x volume pace` };
  if (last < or_low && vwap != null && last < vwap && heavy) return { ...out, read: "DOWN", why: `under the ${r2(or_low)} opening-range low and the ${r2(vwap)} VWAP on ${r2(pace)}x volume pace` };
  // GAP-AND-HOLD: the move already happened on the open (AMZN +5.6% on 11/04). A 3%+ gap still above VWAP and in
  // the top half of its opening range on heavy volume is holding, not fading; the mirror for a gap down.
  const mid = (or_high + or_low) / 2;
  if (gap_pct != null && gap_pct >= GAP_PCT && vwap != null && last > vwap && last >= mid && heavy) return { ...out, read: "UP", why: `a ${gap_pct}% gap holding: over the ${r2(vwap)} VWAP and the top half of the ${r2(or_low)}-${r2(or_high)} opening range on ${r2(pace)}x volume pace` };
  if (gap_pct != null && gap_pct <= -GAP_PCT && vwap != null && last < vwap && last <= mid && heavy) return { ...out, read: "DOWN", why: `a ${gap_pct}% gap holding down: under the ${r2(vwap)} VWAP and the bottom half of the ${r2(or_low)}-${r2(or_high)} opening range on ${r2(pace)}x volume pace` };
  const why = last >= or_low && last <= or_high ? "inside the opening range"
    : pace == null ? "volume pace unknown, so no call"
    : !heavy ? `volume pace ${r2(pace)}x is under ${MIN_PACE}x`
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
  // Before the open nothing is called: a feed that still shows yesterday's session must never start a judge (review finding 6).
  if (hhmm < OPEN_CT || !DIR_OF[read.read]) return { act: "none" };
  const calls = w.calls || [];
  if (EARLY_READS.has(read.read)) return calls.some((c) => EARLY_READS.has(c.read)) ? { act: "none" } : { act: "call" };
  const regular = calls.filter((c) => !EARLY_READS.has(c.read));
  if (regular.length >= MAX_CALLS_PER_TICKER || regular.some((c) => c.read === read.read)) return { act: "none" };
  return { act: "call" };
}

export const isEarly = (read) => Boolean(read && EARLY_READS.has(read.read));

// The card a FLUSH or FADE sends the moment it fires, before the judge rules (the judge takes a minute or two and
// the move is fast). Mechanical levels only: the live price, a stop at least 1.0 ATR away AND past the session
// extreme, and the gap fill (the prior close) as the first target. It is the read, not a ticket.
export function earlyCard(w, read, hhmm, { judged = true, cap = MAX_EARLY_JUDGES_PER_DAY } = {}) {
  const up = read.read === "FLUSH";
  const head = up
    ? `${w.ticker} FLUSH at ${hhmm} CT: opened ${read.open} (${read.gap_pct}% gap), flushed to ${read.session_low}, now ${read.last}, back over the open and the ${read.vwap} VWAP on ${read.pace}x volume pace.`
    : `${w.ticker} FADE at ${hhmm} CT: opened ${read.open} (+${read.gap_pct}% gap), spiked to ${read.session_high}, now ${read.last}, back under the open and the ${read.vwap} VWAP on ${read.pace}x volume pace.`;
  let levels;
  const reward = read.last != null && read.prev != null ? (up ? read.prev - read.last : read.last - read.prev) : null;
  if (reward != null && reward <= 0) {
    levels = ` The gap is already filled (prior close ${read.prev}), so the gap fill is not a target from here.`;
  } else if (read.atr && reward != null) {
    const stop = up ? Math.min(read.last - read.atr, read.session_low - 0.01) : Math.max(read.last + read.atr, read.session_high + 0.01);
    const risk = Math.abs(read.last - stop);
    levels = ` Gap fill ${read.prev} pays ${r2(reward / risk)}:1 from here with the stop at ${r2(stop)} (1 ATR is ${read.atr}, and ${up ? "under the low" : "over the high"}).`;
  } else {
    levels = ` Gap fill ${read.prev}. ATR not available, so the stop goes at least 1 ATR away and ${up ? "under the low" : "over the high"}.`;
  }
  const tail = judged ? "The judge rules on it next." : `Not judged: the early-read cap of ${cap} a day is reached. Ask Claude to run ${w.ticker}.`;
  return `${head}${levels} This is the read, not a ticket. ${tail}`;
}

// What the name did before the open: the pre-market bars between preStart and the regular open. The range is
// taken from bar CLOSES: Yahoo's thin pre-market bars carry junk wicks (NVDA 11/12 07:20 CT printed a 173.30 high
// inside a 159 bar), and a close-to-close range cannot be poisoned by one of them.
export const PRE_MOVE_PCT = 2; // a pre-market move this big after the first card earns one more card before the open
export function preMarketRead({ bars, prevClose, preStart, regStart }) {
  const pre = (bars || []).filter((b) => b && Number.isFinite(b.c) && b.t >= preStart && b.t < regStart);
  if (!pre.length) return null;
  const last = pre.at(-1).c;
  const closes = pre.map((b) => b.c);
  return { last: r2(last), chg_pct: prevClose ? r2((last / prevClose - 1) * 100) : null, pm_high: r2(Math.max(...closes)), pm_low: r2(Math.min(...closes)), prev: r2(prevClose) };
}

const signed = (x) => `${x >= 0 ? "+" : ""}${x}`;
const vsClose = (pre) => (pre.chg_pct == null || pre.prev == null ? "" : ` ${signed(pre.chg_pct)}% on the ${pre.prev} close,`);

// One card for every watch that has a pre-market read and has not had its card today: [{ ticker, pre }].
export function preMarketCard(items, hhmm) {
  const lines = items.map(({ ticker, pre }) => `${ticker} ${pre.last} pre-market,${vsClose(pre)} pre-market range ${pre.pm_low}-${pre.pm_high} (closes).`);
  return `PUMP WATCH on from ${hhmm} CT. ${lines.join(" ")} From the 08:30 open: a gap that flushes and takes back the open (or spikes and loses it) texts you from 08:35; the opening-range read starts at 09:00.`;
}

// Did the pre-market move PRE_MOVE_PCT+ since the first card? card = the watch's pre_card ({ at, last }).
export function preMove(card, pre) {
  if (!card || !Number.isFinite(card.last) || !pre || !Number.isFinite(pre.last)) return null;
  const pct = r2((pre.last / card.last - 1) * 100);
  return Math.abs(pct) >= PRE_MOVE_PCT ? pct : null;
}

// [{ ticker, pre, card, pct }]
export function preMoveCard(items, hhmm) {
  const lines = items.map(({ ticker, pre, card, pct }) => `${ticker} ${pre.last} at ${hhmm} CT, ${signed(pct)}% since ${card.last} at ${card.at},${vsClose(pre)} pre-market range ${pre.pm_low}-${pre.pm_high} (closes).`);
  return `PRE-MARKET MOVE. ${lines.join(" ")} The flush / fade read takes over at 08:35.`;
}

// v36 THE PUMP-WATCH EXCEPTION (Adam, 2026-11-04: "Yes, override it"): a pump call may be judged live past a
// 9:02 NO TRADE on a different, older plan, but only when the watch is Adam's order: he added it (by "adam"),
// or the 5:40a catalyst search added it before 09:00 CT (by "routine"), i.e. before any entry check spoke.
// A watch the desk adds itself, or anything added after 09:00 by a routine, gets the plain v33 rule, so the
// exception can never be used to re-plan a refused name (review finding 1, 2026-11-05).
export const WATCH_BY = ["adam", "routine", "desk"];
const ctClock = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
};
export function overrideEligible(w) {
  if (!w) return { ok: false, why: "no watch" };
  if (w.added_by === "adam") return { ok: true, why: "Adam added this watch" };
  if (w.added_by === "routine") {
    const c = ctClock(w.added_at);
    if (c && (c.date < w.date || (c.date === w.date && c.hhmm < "09:00"))) return { ok: true, why: `the 5:40a catalyst search added it at ${c.hhmm} CT, before the entry check` };
    return { ok: false, why: `a routine added it at ${c ? c.hhmm : "an unknown time"} CT, after the entry check` };
  }
  return { ok: false, why: w.added_by === "desk" ? "the desk added this watch itself" : "nobody recorded who added this watch" };
}

export function judgeTrip(w, read) {
  const up = DIR_OF[read.read] === "UP";
  const early = isEarly(read);
  const ov = overrideEligible(w);
  return {
    ticker: w.ticker, kind: "PUMP", dir: up ? "above" : "below", price: early ? read.open : up ? read.or_high : read.or_low,
    touched: read.last, last: read.last, prev: read.prev, src: `pump-watch ${w.date}`, key: `${w.ticker}|PUMP|${read.read}`,
    pump: { read: read.read, early, why: read.why, catalyst: w.why || "none given", added_by: w.added_by || "unknown", override_ok: ov.ok, override_why: ov.why, vwap: read.vwap, or_high: read.or_high, or_low: read.or_low, open: read.open, atr: read.atr, pace: read.pace, gap_pct: read.gap_pct, session_high: read.session_high, session_low: read.session_low },
  };
}

export function endCard(w, read) {
  const calls = (w.calls || []).map((c) => `${c.read} at ${c.at_ct}`).join(", ");
  const head = calls ? `${w.ticker} pump watch ended at ${w.until || DEFAULT_UNTIL} CT. Called: ${calls}.` : `${w.ticker} pump watch ended at ${w.until || DEFAULT_UNTIL} CT with no direction call.`;
  const now = read && read.last != null ? ` Now ${read.last} (${read.read}: ${read.why}). Range ${read.or_low ?? "?"}-${read.or_high ?? "?"}, VWAP ${read.vwap ?? "?"}, prior close ${read.prev ?? "?"}.` : "";
  return `${head}${now} Catalyst: ${w.why || "none given"}.`;
}
