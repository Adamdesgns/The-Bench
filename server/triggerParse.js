// triggerParse.js — pull structured levels out of v17's free-text final_call.
//
// v17 writes its levels as prose ("Top watchlist — >$77 / dies <$52") while the
// archive has structured `trigger` / `invalidation` fields that sit null. This
// module proposes the structured form. It does NOT write it: a wrong level
// silently corrupts every conditional verdict downstream, so a human confirms
// before anything lands. (scripts/backfill-triggers.js)
//
// Only $-prefixed numbers are ever treated as prices, which is what keeps
// "Aug 6 earnings revisit" from becoming a $6 trigger.
//
// Spec: docs/scorecard-spec.md

// $63.8-64.5K   $1,020   $77   $1.00   $60s
// The K/M suffix must be glued to the digits and end on a word boundary —
// with whitespace allowed, "$1.00 must hold" parsed as one million dollars.
const MONEY = /\$\s*([\d,]+(?:\.\d+)?)(?:\s*[-–]\s*([\d,]+(?:\.\d+)?))?(?:([KkMm])\b)?/g;

const ABOVE_WORDS = /(>|reclaim|above|over|breaks?\s+out|clears?)/i;
const BELOW_WORDS = /(<|dies|stops?|must\s+hold|hold|below|under|loses?|fails?)/i;

const MULTIPLIER = { k: 1e3, m: 1e6 };

function toNumber(raw, suffix) {
  const n = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return suffix ? n * MULTIPLIER[suffix.toLowerCase()] : n;
}

// "reclaim" is dominant: "reclaim + hold $200-203" means clear 200, whereas
// "hold mid-$60s" on its own is a floor. Checking above-words first is what
// separates those two, and both phrasings are in the real book.
function directionIn(text) {
  if (!text) return null;
  if (ABOVE_WORDS.test(text)) return "above";
  if (BELOW_WORDS.test(text)) return "below";
  return null;
}

// { trigger, invalidation } — either may be null. Never guesses.
export function parseLevels(finalCall) {
  const text = String(finalCall ?? "");
  let trigger = null;
  let invalidation = null;
  let cursor = 0;

  for (const match of text.matchAll(MONEY)) {
    const [full, lowRaw, highRaw, suffix] = match;
    const before = text.slice(cursor, match.index);
    const after = text.slice(match.index + full.length, match.index + full.length + 24);
    cursor = match.index + full.length;

    // The words in front of the number describe it; if there are none, a
    // trailing phrase like "$1.00 must hold" does.
    const direction = directionIn(before) ?? directionIn(after);
    if (!direction) continue;

    const low = toNumber(lowRaw, suffix);
    const high = highRaw ? toNumber(highRaw, suffix) : null;
    if (low === null) continue;

    // An up-trigger is cleared at the bottom of its range; a down-level breaks
    // at the top of its range.
    const level = direction === "above" ? low : high ?? low;

    if (direction === "above" && !trigger) trigger = { direction, level };
    if (direction === "below" && !invalidation) invalidation = { direction, level };
  }

  return { trigger, invalidation };
}
