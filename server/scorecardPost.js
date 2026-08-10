// scorecardPost.js — render the weekly scorecard as an X draft. Pure.
//
// The rules encoded here are honesty rules, and they are the point:
//   - the scored count is always stated, so a bad week reads as a bad week
//   - misses render alongside hits, never filtered out
//   - not_scorable rows are counted as excluded, never silently dropped
//   - nothing scored produces NO draft, rather than an empty boast
//
// Two renderers, same rules:
//   renderWeeklyPost  — one post, <=280. The original. Kept for callers that
//                       want a single surface.
//   renderWeeklyChain — the chain. Default since bench-daily-v1 §0 retired
//                       long form: one post is one surface in a timeline, the
//                       same material as five parts is five.
//
// The system drafts. Adam publishes. Journal voice, past tense, never advice.
//
// Spec: docs/scorecard-spec.md, docs/cadence-spec-v1.md
// Format: prompts/bench-daily-v1.md §0 (chain), §1 (hook), §2 (saveable)

const MAX_LEN = 280;
const URL_RE = /https?:\/\/\S+/g;

// X wraps every URL in a 23-character t.co link regardless of real length.
export function effectiveLength(text) {
  return text.replace(URL_RE, "x".repeat(23)).length;
}

function fmtPct(n) {
  if (typeof n !== "number") return "n/a";
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? "+" : ""}${r}%`;
}

function phraseFor(row) {
  const { type, verdict, alpha, triggerFired } = row;
  if (verdict === "flat") return "went nowhere";
  if (type === "pass") {
    if (verdict === "right") return "passed, correctly";
    return alpha >= 10 ? "passed — it ran without us" : "passed — it outran";
  }
  if (type === "long") return verdict === "right" ? "called it" : "called it, lagged";
  if (type === "conditional") {
    if (verdict === "right") return triggerFired ? "gate fired, it ran" : "gate held, correctly";
    return triggerFired ? "triggered, then stalled" : "never triggered, ran anyway";
  }
  return verdict;
}

function markFor(verdict) {
  if (verdict === "right") return "✅";
  if (verdict === "wrong") return "❌";
  return "•";
}

function renderLine(row) {
  return `${markFor(row.verdict)} $${row.ticker} — ${phraseFor(row)}. ${fmtPct(row.assetPct)} vs ${
    row.bench
  } ${fmtPct(row.benchPct)}`;
}

// Loudest calls first, but always lead with one of each verdict when both
// exist — a generator that sorts purely by size can bury every miss. Anything
// that truncates downstream truncates a balanced list, not a wins-first one.
function interleaveByVerdict(scored) {
  const bySize = (a, b) => Math.abs(b.alpha ?? 0) - Math.abs(a.alpha ?? 0);
  const wins = scored.filter((r) => r.verdict === "right").sort(bySize);
  const losses = scored.filter((r) => r.verdict === "wrong").sort(bySize);
  const rest = scored.filter((r) => r.verdict === "flat").sort(bySize);

  const ordered = [];
  while (wins.length || losses.length) {
    if (wins.length) ordered.push(wins.shift());
    if (losses.length) ordered.push(losses.shift());
  }
  return [...ordered, ...rest];
}

// scored rows -> a draft string, or null when there is nothing honest to post.
export function renderWeeklyPost(rows, { link = null } = {}) {
  const all = rows ?? [];
  const scored = all.filter((r) => ["right", "wrong", "flat"].includes(r.verdict));
  const excluded = all.length - scored.length;

  if (scored.length === 0) return null;

  const right = scored.filter((r) => r.verdict === "right").length;
  const wrong = scored.filter((r) => r.verdict === "wrong").length;
  const flat = scored.filter((r) => r.verdict === "flat").length;

  const tally = [`${right} right`, `${wrong} wrong`];
  if (flat) tally.push(`${flat} flat`);

  let header = `The book scored ${scored.length} calls. ${tally.join(", ")}.`;
  if (excluded) header += ` (${excluded} not scored.)`;

  const ordered = interleaveByVerdict(scored);

  const footer = link ? `\n\nEvery call, misses included: ${link}` : "";

  const lines = [];
  for (const row of ordered) {
    const candidate = [header, "", ...lines, renderLine(row)].join("\n") + footer;
    if (effectiveLength(candidate) > MAX_LEN) break;
    lines.push(renderLine(row));
  }

  // Header alone must still go out if no line fits — the tally is the post.
  if (lines.length === 0) return header;

  return [header, "", ...lines].join("\n") + footer;
}

// ---------------------------------------------------------------------------
// THE CHAIN
//
// bench-daily-v1 §0: every post is a thread of parts, each under 280. The
// separator is exactly three dashes alone on a line; post_next.py posts part
// one then replies each following part to the one before, and refuses the whole
// chain if any part would truncate. So every part is length-checked HERE — a
// part that overflows is a chain that never posts at all.

export const CHAIN_SEPARATOR = "---";
export const SIGNOFF = "Proof, not hype. @TheBenchTrades. Not financial advice.";

// Hook + calls + saveable = 3 at minimum, 5 at most. bench-daily §0: "Three to
// six parts. Fewer than three is just a post; more than six and people stop."
const MAX_CALL_PARTS = 3;

// Longest first — the builder takes the longest variant that still fits.
const SAVEABLE_VARIANTS = [
  "SAVE THIS: every call above was written down before the outcome, with its trigger and its invalidation. The book is append-only, so the misses stay in it.",
  "SAVE THIS: every call above was written down before the outcome, with its trigger and its invalidation. Append-only, so the misses stay in.",
  "SAVE THIS: every call above was written down before the outcome, trigger and invalidation included. Append-only.",
  "SAVE THIS: every call was written down before the outcome. The book is append-only."
];

// Pack rendered lines into at most MAX_CALL_PARTS parts of <=280.
// Returns the parts plus how many rows actually made it in, because the count
// that did not fit has to be stated rather than quietly dropped.
function packCallParts(lines) {
  const parts = [];
  let current = [];
  let shown = 0;

  for (const line of lines) {
    const candidate = current.length ? `${current.join("\n")}\n${line}` : line;
    if (effectiveLength(candidate) <= MAX_LEN) {
      current.push(line);
      shown += 1;
      continue;
    }

    if (current.length) {
      parts.push(current.join("\n"));
      current = [];
      if (parts.length >= MAX_CALL_PARTS) return { parts, shown };
    }

    // A single line longer than a whole post cannot be chained anywhere. Skip
    // it; it stays counted as omitted.
    if (effectiveLength(line) <= MAX_LEN) {
      current.push(line);
      shown += 1;
    }
  }

  if (current.length) parts.push(current.join("\n"));
  return { parts, shown };
}

// Build the closing part: the omitted count, the saveable, the link, the
// signoff. The count and the signoff are mandatory, so the saveable prose and
// then the link give way to keep the part under the limit.
function buildClosingPart({ omitted, link }) {
  const head = omitted
    ? `+${omitted} more scored call${omitted === 1 ? "" : "s"} in the book, same rules.`
    : null;
  const linkLine = link ? `Every call, misses included: ${link}` : null;

  const assemble = (saveable, withLink) =>
    [head, saveable, withLink ? linkLine : null, "", SIGNOFF].filter((x) => x !== null).join("\n");

  for (const withLink of [true, false]) {
    if (withLink && !linkLine) continue;
    for (const saveable of SAVEABLE_VARIANTS) {
      const candidate = assemble(saveable, withLink);
      if (effectiveLength(candidate) <= MAX_LEN) return candidate;
    }
  }

  // Everything optional has already been dropped. The tally is the post.
  return [head, "", SIGNOFF].filter((x) => x !== null).join("\n");
}

// scored rows -> a chain string, or null when there is nothing honest to post.
// Parts are separated by a line of exactly three dashes.
export function renderWeeklyChain(rows, { link = null } = {}) {
  const all = rows ?? [];
  const scored = all.filter((r) => ["right", "wrong", "flat"].includes(r.verdict));
  const excluded = all.length - scored.length;

  if (scored.length === 0) return null;

  const right = scored.filter((r) => r.verdict === "right").length;
  const wrong = scored.filter((r) => r.verdict === "wrong").length;
  const flat = scored.filter((r) => r.verdict === "flat").length;

  const tally = [`${right} right`, `${wrong} wrong`];
  if (flat) tally.push(`${flat} flat`);

  // THE HOOK — a checkable number first, no verdict, ending on an open loop
  // the rest of the chain actually pays off (bench-daily §1).
  let hook = `The book scored ${scored.length} call${scored.length === 1 ? "" : "s"} this week. ${tally.join(", ")}.`;
  if (excluded) hook += ` (${excluded} not scored.)`;
  hook +=
    wrong > 0
      ? `\n\nHere is every one, including the ${wrong} that went against us.`
      : `\n\nHere is every one, and what each was measured against.`;

  const ordered = interleaveByVerdict(scored);
  const { parts: callParts, shown } = packCallParts(ordered.map(renderLine));
  const omitted = scored.length - shown;

  const closing = buildClosingPart({ omitted, link });

  return [hook, ...callParts, closing].join(`\n${CHAIN_SEPARATOR}\n`);
}
