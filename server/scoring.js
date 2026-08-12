// scoring.js — the verdict rule for the book. Pure: no network, no fs, no config.
//
// A call is scored on what it SAID, not on whether a trade was taken. That is
// the whole point: the book is a record of judgement, and judgement can be
// graded without money on the line.
//
// Spec: docs/scorecard-spec.md

// Crypto universe. Lives here rather than in dataProviders.js because the
// verdict rule needs it and this module is the one with no dependencies —
// dataProviders imports it from here so there is exactly one list.
export const CRYPTO_TICKERS = new Set([
  "BTC", "ETH", "BNB", "XRP", "SOL", "TRX", "DOGE", "HYPE", "XLM", "ADA", "LTC"
]);

// Alpha inside this band is noise, not skill.
export const DEAD_BAND = 1.0;

// A pass that missed a run this large is still `wrong`, but it is the most
// expensive kind of wrong and gets flagged for the lesson.
export const EXPENSIVE_PASS = 10;

// Leading phrases of final_call, longest-first so "Top watchlist" is not
// shadowed by "Watchlist". Order across types matters too: a row can carry
// hodl: "Accumulate" while its call was "No Trade" (B-010) — the call wins.
const CALL_PATTERNS = [
  ["pass", [/^no trade\b/]],
  ["hedge", [/^hedge\b/]],
  ["conditional", [/^top watchlist\b/, /^watchlist\b/, /^armed\b/, /^setup forming\b/, /^watch\b/]],
  ["long", [/^entered\b/, /^accumulate\b/]],
  ["closed", [/^closed\b/, /^stopped\b/]]
];

// Types a row may declare structurally. log-call.mjs has written call_type
// since B-035; the field outranks prose because it was validated at log time.
const DECLARED_TYPES = new Set(["pass", "hedge", "conditional", "long", "closed"]);

export function classifyCall(row) {
  const declared = String(row?.call_type ?? "").trim().toLowerCase();
  if (DECLARED_TYPES.has(declared)) return declared;
  const call = String(row?.final_call ?? "").trim().toLowerCase();
  for (const [type, patterns] of CALL_PATTERNS) {
    if (patterns.some((p) => p.test(call))) return type;
  }
  // Fall back to the hold stance only when the call itself said nothing we know.
  if (!call && String(row?.hodl ?? "").trim().toLowerCase() === "accumulate") return "long";
  return "unknown";
}

// Crypto is graded against BTC, because grading DOGE against the S&P measures
// the crypto tide rather than the call. BTC has no crypto to be graded against,
// so it falls back to the market.
export function benchmarkFor(ticker) {
  const t = String(ticker ?? "").toUpperCase();
  if (t === "BTC") return "SPY";
  return CRYPTO_TICKERS.has(t) ? "BTC" : "SPY";
}

const round2 = (n) => Math.round(n * 100) / 100;

export function pctMove(from, to) {
  if (typeof from !== "number" || typeof to !== "number") return null;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return round2(((to - from) / from) * 100);
}

// Did the level actually get taken out between the review and the checkpoint?
//
// Returns null — never a guessed boolean — when the trigger was never recorded
// in structured form or there are no bars to test against. A conditional call
// with an unknown gate state scores not_scorable, which is the honest answer.
//
// trigger: { direction: "above" | "below", level: number }
//
// log-call.mjs stores the trigger as a bare number. The crossing direction is
// recoverable from where the gate sat relative to the review price at logging:
// a gate above the print is a reclaim (fires on close >= level), a gate below
// is a pullback/breakdown touch (fires on close <= level). This normalizes a
// numeric trigger to the structured form; objects pass through untouched, and
// anything else stays null so the row scores not_scorable rather than guessed.
export function normalizeTrigger(trigger, reviewPrice) {
  if (trigger && typeof trigger === "object") return trigger;
  if (typeof trigger !== "number" || !Number.isFinite(trigger)) return null;
  if (typeof reviewPrice !== "number" || !Number.isFinite(reviewPrice)) return null;
  return { direction: trigger >= reviewPrice ? "above" : "below", level: trigger };
}

export function triggerFiredIn(bars, fromDate, toDate, trigger) {
  const level = trigger?.level;
  const direction = trigger?.direction;
  if (typeof level !== "number" || (direction !== "above" && direction !== "below")) return null;

  const window = (bars ?? []).filter((b) => b?.date >= fromDate && b?.date <= toDate);
  if (!window.length) return null;

  return window.some((b) => (direction === "above" ? b.close >= level : b.close <= level));
}

function unscorable(note) {
  return { verdict: "not_scorable", alpha: null, note };
}

// { type, assetPct, benchPct, triggerFired } -> { verdict, alpha, note }
//
// verdict: "right" | "wrong" | "flat" | "not_scorable"
export function scoreCall({ type, assetPct, benchPct, triggerFired = null }) {
  if (type === "hedge") {
    return unscorable("hedge — no position, size or entry is recorded to score against");
  }
  if (type === "unknown") {
    return unscorable("call phrasing not recognised — not guessed");
  }
  if (type === "closed") {
    return unscorable("closed trade — outcome already realized at exit; graded in the row, not at checkpoints");
  }
  if (typeof assetPct !== "number" || typeof benchPct !== "number") {
    return unscorable("price not observable at this checkpoint");
  }

  const alpha = round2(assetPct - benchPct);
  const beat = alpha > DEAD_BAND;
  const lagged = alpha < -DEAD_BAND;

  if (type === "long") {
    if (beat) return { verdict: "right", alpha, note: "long — beat the benchmark" };
    if (lagged) return { verdict: "wrong", alpha, note: "long — lagged the benchmark" };
    return { verdict: "flat", alpha, note: "long — inside the dead band" };
  }

  if (type === "pass") {
    if (lagged) return { verdict: "right", alpha, note: "pass — correctly skipped" };
    if (beat) {
      const expensive = alpha >= EXPENSIVE_PASS;
      return {
        verdict: "wrong",
        alpha,
        note: expensive ? "pass — expensive pass, it ran without us" : "pass — it outran the benchmark"
      };
    }
    return { verdict: "flat", alpha, note: "pass — went nowhere either way" };
  }

  if (type === "conditional") {
    if (triggerFired === null || triggerFired === undefined) {
      return unscorable("conditional — trigger level not recorded, so the gate cannot be judged");
    }
    if (triggerFired) {
      return beat
        ? { verdict: "right", alpha, note: "conditional — triggered and ran" }
        : { verdict: "wrong", alpha, note: "conditional — triggered and did not run" };
    }
    return beat
      ? { verdict: "wrong", alpha, note: "conditional — never triggered and it ran without us" }
      : { verdict: "right", alpha, note: "conditional — correctly never triggered" };
  }

  return unscorable("unhandled call type");
}
