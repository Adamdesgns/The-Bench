// scorecardPost.js — render the weekly scorecard as an X draft. Pure.
//
// The rules encoded here are honesty rules, and they are the point:
//   - the scored count is always stated, so a bad week reads as a bad week
//   - misses render alongside hits, never filtered out
//   - not_scorable rows are counted as excluded, never silently dropped
//   - nothing scored produces NO draft, rather than an empty boast
//
// The system drafts. Adam publishes. Journal voice, past tense, never advice.
//
// Spec: docs/scorecard-spec.md

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

  // Loudest calls first, but always lead with one of each verdict when both
  // exist — a generator that sorts purely by size can bury every miss.
  const bySize = (a, b) => Math.abs(b.alpha ?? 0) - Math.abs(a.alpha ?? 0);
  const wins = scored.filter((r) => r.verdict === "right").sort(bySize);
  const losses = scored.filter((r) => r.verdict === "wrong").sort(bySize);
  const rest = scored.filter((r) => r.verdict === "flat").sort(bySize);

  const ordered = [];
  while (wins.length || losses.length) {
    if (wins.length) ordered.push(wins.shift());
    if (losses.length) ordered.push(losses.shift());
  }
  ordered.push(...rest);

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
