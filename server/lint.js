// lint.js — post-generation house-style checks.
//
// Two engines, two shapes:
//   lintArticle(body)  long-form Marquee output. Unchanged contract.
//   lintChain(text)    a Bench chain per bench-daily-v1.md §0 and
//                      x-viral-engine-v1.md — 3-6 parts split by exactly three
//                      dashes alone on a line, each part under 280 chars.
//
// Count in code; never trust the model's estimate. That rule is why the viral
// engine's 0-50 self-score is drafting discipline and everything countable in
// it lives here instead.
//
// lintArticle's checks are all HARD FLAGS. lintChain adds a `warnings` list for
// the few rules a regex can only approximate (is there a saveable element?).
// Those report and never block: a brittle pattern must not be able to kill a
// real post, and since the --auto publish gates came off 2026-08-04 a false
// failure has nowhere to appeal to.
//
// NOTE: `---` means opposite things in the two shapes. In long-form it is a
// stray divider and gets flagged. In a chain it is the thread separator, which
// is why a valid chain fails lintArticle and must never be checked with it.
//
// Usage:
//   import { lintArticle, lintChain } from './lint.js';
//   const { ok, flags, charCount } = lintArticle(articleBody);
//   const { ok, flags, warnings, parts } = lintChain(draftText);

export const BANNED_PHRASES = [
  "delve",
  "tapestry",
  "testament to",
  "navigate the landscape",
  "game-changer",
  "unlock",
  "it's worth noting",
  "at the end of the day",
  "in today's fast-paced world",
  "let's dive in"
];

export const BOILERPLATE = [
  "Proof, not hype.",
  "@TheBenchTrades",
  "Not financial advice. Educational only."
];

export const CHAR_LIMIT = 3900; // X compose enforces 4000; leave buffer.
export const ARTICLE_EM_DASH_CAP = 2; // marquee-v3.1's contract, unchanged.

// --- chain constants (x-viral-engine-v1.md) --------------------------------

export const PART_LIMIT = 280;
export const MIN_PARTS = 3;   // fewer than three is just a post
export const MAX_PARTS = 6;   // more than six and people stop
export const MAX_HASHTAGS = 2;
export const EM_DASH_CAP = 0; // "Never use em dashes." Zero, not few.

// Exactly three dashes, alone on their line, no leading whitespace. An indented
// run is inside a quote or a code block, and a dash in prose never splits.
export const SEPARATOR = /^---[ \t]*$/;

// The eight generic openers the viral engine bans, checked against part 1 only.
export const BANNED_HOOKS = [
  "the future is here",
  "this changes everything",
  "let that sink in",
  "most people don't realize",
  "i don't know who needs to hear this",
  "here's the thing",
  "game changer",
  "you're not ready for this"
];

export const BAIT_QUESTIONS = [
  "thoughts?",
  "agree?",
  "who's with me?",
  "am i the only one?"
];

// The signoff the auto-publish path requires. Matched loosely on the two parts
// that carry the weight, so punctuation drift does not cause a false failure.
export const DISCLAIMER_MARKERS = ["@thebenchtrades", "not financial advice"];

// "Open on a number, not a verdict" — but bench-daily-v1's own worked example
// spells it: "Three of the five biggest companies in America are red before the
// bell." That is a number-first hook and must pass, so digits are not enough.
// Erring toward accepting is deliberate: a false flag blocks a real post.
const NUMBER_WORDS = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "dozen", "twenty", "thirty", "forty", "fifty", "sixty",
  "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion",
  "trillion", "half", "double", "triple", "quarter", "third"
];
const NUMBER_WORD_RE = new RegExp(`\\b(${NUMBER_WORDS.join("|")})s?\\b`, "i");

export function hasCheckableNumber(text) {
  const t = String(text ?? "");
  return /\d/.test(t) || NUMBER_WORD_RE.test(t);
}

// A saveable element, approximated: a labelled level or a named invalidation.
const SAVEABLE_MARKERS = [
  "the level", "the levels", "invalidation", "invalidates", "invalidated",
  "the gate", "the test", "the trigger", "stop", "confirm"
];

// Count grapheme-ish length the way X does: code points, not UTF-16 units.
export function charCount(text) {
  return [...(text ?? "")].length;
}

// X wraps every URL in a 23-character t.co link regardless of real length, so a
// part carrying a link is shorter than it looks. Same rule as scorecardPost.js.
const URL_RE = /https?:\/\/\S+/g;

export function effectiveLength(text) {
  return charCount((text ?? "").replace(URL_RE, "x".repeat(23)));
}

// Split a draft into chain parts. Never splits on a dash inside prose.
export function splitChain(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .reduce(
      (acc, line) => {
        if (SEPARATOR.test(line)) acc.push([]);
        else acc[acc.length - 1].push(line);
        return acc;
      },
      [[]]
    )
    .map((lines) => lines.join("\n").trim());
}

export function lintArticle(body) {
  const text = body ?? "";
  const lower = text.toLowerCase();
  const flags = [];

  // 1. Character count <= 3900
  const chars = charCount(text);
  if (chars > CHAR_LIMIT) {
    flags.push({ rule: "char-limit", detail: `${chars} chars > ${CHAR_LIMIT} limit` });
  }

  // 2. Em dashes <= 2
  const emDashes = (text.match(/—/g) || []).length;
  if (emDashes > ARTICLE_EM_DASH_CAP) {
    flags.push({ rule: "em-dash-cap", detail: `${emDashes} em dashes > ${ARTICLE_EM_DASH_CAP} (AI tell)` });
  }

  // 3. No --- divider lines in body
  if (/^\s*-{3,}\s*$/m.test(text)) {
    flags.push({ rule: "divider-line", detail: "found '---' divider line in body" });
  }

  // 4. No numbered-thread patterns (1/ 2/ ...) — long-form only
  const threadHits = text.match(/(^|\s)\d{1,2}\/(\s|$)/g);
  if (threadHits) {
    flags.push({ rule: "numbered-thread", detail: `found thread markers: ${threadHits.map(s => s.trim()).join(", ")}` });
  }

  // 5. Banned phrases
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      flags.push({ rule: "banned-phrase", detail: `banned phrase: "${phrase}"` });
    }
  }

  // 6. Boilerplate present
  for (const line of BOILERPLATE) {
    if (!text.includes(line)) {
      flags.push({ rule: "missing-boilerplate", detail: `missing required line: "${line}"` });
    }
  }

  return { ok: flags.length === 0, flags, charCount: chars, emDashes };
}

// --- lintChain -------------------------------------------------------------
//
// A chain is what actually publishes. Everything here is countable; anything
// that needs judgment stays in the prompt.

export function lintChain(text) {
  const raw = String(text ?? "");
  const parts = splitChain(raw);
  const lower = raw.toLowerCase();
  const flags = [];
  const warnings = [];

  const nonEmpty = parts.filter((p) => p.length > 0);

  // 1. An empty part means a doubled separator. post_next.py would post a blank.
  if (nonEmpty.length !== parts.length) {
    flags.push({
      rule: "empty-part",
      detail: `${parts.length - nonEmpty.length} empty part(s) — doubled or trailing separator`
    });
  }

  // 2. Three to six parts.
  if (nonEmpty.length < MIN_PARTS || nonEmpty.length > MAX_PARTS) {
    flags.push({
      rule: "part-count",
      detail: `${nonEmpty.length} parts, needs ${MIN_PARTS}-${MAX_PARTS}`
    });
  }

  // 3. Every part under 280, counted the way X counts.
  const measured = parts.map((p, i) => {
    const eff = effectiveLength(p);
    if (eff > PART_LIMIT) {
      flags.push({
        rule: "part-too-long",
        detail: `part ${i + 1}: ${eff} chars > ${PART_LIMIT} (${charCount(p)} raw), ${eff - PART_LIMIT} over`
      });
    }
    return { index: i + 1, text: p, chars: charCount(p), effective: eff };
  });

  // 4. Em dashes. Zero.
  const emDashes = (raw.match(/—/g) || []).length;
  if (emDashes > EM_DASH_CAP) {
    flags.push({ rule: "em-dash", detail: `${emDashes} em dash(es) — the cap is ${EM_DASH_CAP}` });
  }

  // 5-7. The hook carries rules the rest of the chain does not.
  const hook = nonEmpty[0] ?? "";
  const hookLower = hook.toLowerCase();

  if (!hasCheckableNumber(hook)) {
    flags.push({ rule: "hook-no-number", detail: "part 1 has no checkable number — open on a number, not a verdict" });
  }
  if (hook.trim().endsWith("?")) {
    flags.push({ rule: "hook-is-question", detail: "part 1 is a question — reads as bait and invites a scroll-past" });
  }
  for (const phrase of BANNED_HOOKS) {
    if (hookLower.includes(phrase)) {
      flags.push({ rule: "banned-hook", detail: `generic opener in part 1: "${phrase}"` });
    }
  }

  // 8. Marquee's banned phrases, anywhere.
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      flags.push({ rule: "banned-phrase", detail: `banned phrase: "${phrase}"` });
    }
  }

  // 9. Engagement bait, anywhere.
  for (const q of BAIT_QUESTIONS) {
    if (lower.includes(q)) {
      flags.push({ rule: "bait-question", detail: `engagement bait: "${q}"` });
    }
  }

  // 10. Hashtag cap. A cashtag is $AMD and does not count.
  const hashtags = raw.match(/(?:^|\s)#[A-Za-z]\w*/g) || [];
  if (hashtags.length > MAX_HASHTAGS) {
    flags.push({
      rule: "hashtag-cap",
      detail: `${hashtags.length} hashtags > ${MAX_HASHTAGS}: ${hashtags.map((h) => h.trim()).join(" ")}`
    });
  }

  // 11. The signoff rides on the LAST part — that is the one people reach.
  const last = (nonEmpty[nonEmpty.length - 1] ?? "").toLowerCase();
  const missing = DISCLAIMER_MARKERS.filter((m) => !last.includes(m));
  if (missing.length) {
    flags.push({
      rule: "missing-disclaimer",
      detail: `last part is missing: ${missing.join(", ")}`
    });
  }

  // --- warnings: approximated, never blocking ------------------------------

  if (!SAVEABLE_MARKERS.some((m) => lower.includes(m))) {
    warnings.push({
      rule: "no-saveable",
      detail: "no level or named invalidation found — every post needs one thing worth bookmarking"
    });
  }

  const lastRaw = (nonEmpty[nonEmpty.length - 1] ?? "");
  const beforeSignoff = lastRaw.split(/\n/).filter((l) => {
    const t = l.trim().toLowerCase();
    return t && !DISCLAIMER_MARKERS.some((m) => t.includes(m));
  });
  if (!beforeSignoff.some((l) => l.trim().endsWith("?"))) {
    warnings.push({
      rule: "no-closing-question",
      detail: "last part does not close on a question — the conversation trigger is missing"
    });
  }

  return { ok: flags.length === 0, flags, warnings, parts: measured };
}

// CLI:
//   node server/lint.js path/to/article.txt          long-form
//   node server/lint.js --chain path/to/draft.txt    a Bench chain
// Either form reads stdin when no path is given.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const args = process.argv.slice(2);
  const chainMode = args.includes("--chain");
  const path = args.find((a) => !a.startsWith("--"));
  const body = path ? readFileSync(path, "utf8") : readFileSync(0, "utf8");

  if (chainMode) {
    const result = lintChain(body);
    console.log(`${result.parts.length} parts`);
    for (const p of result.parts) {
      const over = p.effective > PART_LIMIT ? `  ← ${p.effective - PART_LIMIT} OVER` : "";
      const shown = p.effective === p.chars ? `${p.chars}` : `${p.effective} (${p.chars} raw)`;
      console.log(`  ${String(p.index).padStart(2)}. ${shown.padStart(12)} chars${over}`);
    }
    for (const w of result.warnings) console.log(`  [warn] [${w.rule}] ${w.detail}`);
    if (result.ok) {
      console.log("PASS — no house-style flags.");
    } else {
      console.log(`FAIL — ${result.flags.length} flag(s):`);
      for (const f of result.flags) console.log(`  [${f.rule}] ${f.detail}`);
      process.exit(1);
    }
  } else {
    const result = lintArticle(body);
    console.log(`chars: ${result.charCount}  em-dashes: ${result.emDashes}`);
    if (result.ok) {
      console.log("PASS — no house-style flags.");
    } else {
      console.log(`FAIL — ${result.flags.length} flag(s):`);
      for (const f of result.flags) console.log(`  [${f.rule}] ${f.detail}`);
      process.exit(1);
    }
  }
}
