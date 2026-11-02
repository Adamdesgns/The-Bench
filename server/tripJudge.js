// tripJudge.js - the pure half of scripts/trip-judge.mjs.
//
// Adam, 2026-11-02: "We need to get robinhoods notifications to hit you so when a notification
// hits you have already checked it and can give me a buy." Robinhood's own alerts go only to
// the Robinhood app; nothing on this PC can receive them. So the Bench watches its own committed
// levels (server/tripwire.js, free feed) and, when a BUY-side level is freshly crossed, wakes one
// headless Claude run that judges it on live Robinhood data and texts the verdict.
//
// Three filters keep the expensive run rare:
//   1. BUY side only: a conditional's TRIGGER or a watchlist BUY ZONE. Stops, floors and targets
//      are not buys (paper positions are scored by the close routine).
//   2. FRESH cross only: the prior close sat on the other side of the level. A level the stock
//      has lived beyond for days (QQQ under a 712 trigger at 695) is not news.
//   3. A daily cap, and one judge per level per day.
// Everything here is pure: the clock, files, network and the child process are passed in.

import { BUY_KINDS } from "./marketWatch.js";

export const MAX_JUDGES_PER_DAY = 4;
export const JUDGE_TIMEOUT_MS = 20 * 60 * 1000;
export const LOCK_STALE_MS = 30 * 60 * 1000;
// The first tick waits for the 08:30 CT open: before it, the free feed's day range and prior
// close can still describe yesterday's session (review finding 5).
export const FIRST_TICK = "08:31";

// Every Robinhood tool that places, changes or cancels anything. The judge run is a research
// surface (CLAUDE.md hard rule): these are blocked at the CLI, not left to the prompt.
export const BLOCKED_TOOLS = [
  "place_equity_order", "place_option_order", "place_crypto_order", "place_advanced_order",
  "review_equity_order", "review_option_order", "review_advanced_order", "preview_crypto_order",
  "cancel_equity_order", "cancel_option_order", "cancel_crypto_order", "cancel_advanced_order",
  "exercise_option", "cancel_option_exercise", "decline_trade_approval",
].flatMap((t) => [`mcp__robinhood-trading__${t}`, `mcp__1b3b7b64-c938-4b4e-8805-056a18712e20__${t}`]);

export function freshBuyCrosses(tripped, quotes) {
  return tripped.filter((t) => {
    if (!BUY_KINDS.has(t.kind)) return false;
    const prev = quotes[t.ticker]?.prev;
    if (prev == null) return false;
    return t.dir === "below" ? prev > t.price : prev < t.price;
  });
}

// Watchlist statuses that end a name for the judge, beyond tripwire's CLOSED / PASS / AVOID.
export const JUDGE_KILL_STATUSES = ["NO-TRADE", "RETIRED"];
const SHORT_CALL = /\bSHORT\b/i;

// Is this level still the book's live plan? (Review 2026-11-02, finding 2: BABA was judged on
// B-1088's trigger though B-1197 had passed on it.) tripwire.js lets only conditional and long rows
// replace a ticker's plan, so a later pass never kills a trigger. For the judge, ANY later row on
// the ticker supersedes the source row. A short conditional's trigger is not a buy (finding 10:
// tripwire guesses direction from the review price), and the book marks shorts only in prose.
export function stillLive(level, rows, watchlist = []) {
  const w = watchlist.find((x) => x.sym === level.ticker);
  if (w && JUDGE_KILL_STATUSES.includes(w.status)) return false;
  if (level.src === "watchlist") return true;
  const src = rows.find((r) => r.id === level.src);
  if (!src) return false;
  if (SHORT_CALL.test(String(src.final_call || "").slice(0, 80))) return false;
  const after = rows.slice(rows.indexOf(src) + 1);
  return !after.some((r) => r.ticker === level.ticker);
}

// Which crosses get a judge this tick: ONE (a judge run can take minutes, and the task is killed at
// 30), never a ticker already judged today (one stock, one judge a day, however many levels it has),
// and never past the day's cap.
export function pickToJudge(crosses, state, today, cap = MAX_JUDGES_PER_DAY) {
  const todays = (state.judged || []).filter((j) => j.date === today);
  const doneTickers = new Set(todays.map((j) => j.ticker));
  const fresh = [];
  for (const c of crosses) if (!doneTickers.has(c.ticker) && !fresh.some((f) => f.ticker === c.ticker)) fresh.push(c);
  if (todays.length >= cap) return { pick: [], skipped: fresh };
  return { pick: fresh.slice(0, 1), skipped: [] };
}

// The over-cap alert goes out once per ticker per day, not every 5 minutes (finding 4).
export function newCapAlerts(skipped, state, today) {
  const told = new Set((state.cap_alerts || []).filter((a) => a.date === today).map((a) => a.ticker));
  return skipped.filter((s) => !told.has(s.ticker));
}
export function recordCapAlerts(state, alerted, today) {
  return { ...state, cap_alerts: [...(state.cap_alerts || []).filter((a) => a.date === today), ...alerted.map((s) => ({ date: today, ticker: s.ticker }))] };
}

export function recordJudged(state, trip, today, result, now = new Date()) {
  return {
    ...state,
    judged: [
      ...(state.judged || []).filter((j) => j.date === today),
      { date: today, key: trip.key, ticker: trip.ticker, kind: trip.kind, price: trip.price, src: trip.src, touched: trip.touched, at: now.toISOString(), result },
    ],
  };
}

export function lockIsLive(lock, now = new Date()) {
  return Boolean(lock && lock.at && now.getTime() - Date.parse(lock.at) < LOCK_STALE_MS);
}

export function judgePrompt(trip, today) {
  const side = trip.dir === "below" ? "low" : "high";
  return [
    `TRIP JUDGE ${today}. Follow prompts/trip-judge-v1.md in C:\\Users\\steam\\Projects\\apps\\the-bench exactly.`,
    `The level: ${trip.ticker} ${trip.kind} ${trip.dir === "below" ? "<=" : ">="} ${trip.price} from ${trip.src}.`,
    `The free feed saw a session ${side} of ${trip.touched}, last ${trip.last}, prior close ${trip.prev}. Unverified until you pull Robinhood.`,
  ].join("\n");
}
