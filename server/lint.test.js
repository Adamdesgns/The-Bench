// lint.test.js — the rules that make a post publishable.
//
// This file exists because of a specific hole: the `--auto` publish gates came
// off 2026-08-04, so the drafting step is the only check standing between a
// draft and the public account. lint.js was that check and had no tests.
//
// It also pins a bug this change fixes. `bench-daily-v1.md` §0 made a line of
// exactly three dashes the THREAD SEPARATOR, but lintArticle flags that same
// line as a stray divider. A correctly-formed chain failed lint. lintChain
// treats it as the separator; lintArticle keeps the old rule for long-form.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  lintArticle,
  lintChain,
  splitChain,
  charCount,
  effectiveLength,
  hasCheckableNumber,
  PART_LIMIT,
  MAX_PARTS,
  EM_DASH_CAP
} from "./lint.js";

const SIGNOFF = "Proof, not hype. @TheBenchTrades. Not financial advice.";

// A real chain, from the worked example in prompts/bench-daily-v1.md §0.
const GOOD_CHAIN = [
  "Three of the five biggest companies in America are red before the bell.\nThe S&P is green anyway.",
  "SOXX is up 4.2%. MU +4.4%, AMD +4.0%, NVDA +1.6%.",
  "THE LEVEL: SPY 760. Hold it and 765 is the next air pocket. Lose 757.67 in the first hour and the gap is a fade.",
  `The read: supply is being bought, demand is being sold.\n\nWhat would change your mind on that?\n\n${SIGNOFF}`
].join("\n---\n");

const rulesOf = (r) => r.flags.map((f) => f.rule);
const warnsOf = (r) => r.warnings.map((w) => w.rule);

// Rebuild a chain with one part swapped, so each test changes exactly one thing.
function chainWith(index, part) {
  const parts = GOOD_CHAIN.split("\n---\n");
  parts[index] = part;
  return parts.join("\n---\n");
}

// ---------------------------------------------------------------- splitChain

test("splitChain splits on exactly three dashes alone on a line", () => {
  assert.equal(splitChain("a\n---\nb\n---\nc").length, 3);
});

test("splitChain ignores a dash inside prose", () => {
  const parts = splitChain("the level - 760 - is the gate\n---\nsecond");
  assert.equal(parts.length, 2);
  assert.match(parts[0], /760/);
});

test("splitChain ignores four dashes and two dashes", () => {
  assert.equal(splitChain("a\n----\nb").length, 1);
  assert.equal(splitChain("a\n--\nb").length, 1);
});

test("splitChain tolerates trailing whitespace on the separator", () => {
  assert.equal(splitChain("a\n--- \nb").length, 2);
});

test("splitChain does not split on an indented separator", () => {
  // Indented means it is inside a code block or a quote, not a boundary.
  assert.equal(splitChain("a\n  ---\nb").length, 1);
});

test("splitChain trims each part", () => {
  assert.deepEqual(splitChain("  a  \n---\n  b  "), ["a", "b"]);
});

// -------------------------------------------------------------- the good case

test("a real posted chain passes clean", () => {
  const r = lintChain(GOOD_CHAIN);
  assert.deepEqual(r.flags, [], `unexpected flags: ${JSON.stringify(r.flags)}`);
  assert.equal(r.ok, true);
});

test("REGRESSION: the chain lintArticle rejects, lintChain accepts", () => {
  // The bug this change fixes, pinned in both directions.
  assert.ok(rulesOf(lintArticle(GOOD_CHAIN)).includes("divider-line"));
  assert.ok(!rulesOf(lintChain(GOOD_CHAIN)).includes("divider-line"));
});

test("a clean chain reports its part count and per-part lengths", () => {
  const r = lintChain(GOOD_CHAIN);
  assert.equal(r.parts.length, 4);
  assert.equal(r.parts[1].chars, charCount("SOXX is up 4.2%. MU +4.4%, AMD +4.0%, NVDA +1.6%."));
});

// --------------------------------------------------------------- hard flags

test("fewer than three parts flags part-count", () => {
  const r = lintChain(`AMD is up 4.0% before the bell. Here's what broke.\n---\n${SIGNOFF}`);
  assert.ok(rulesOf(r).includes("part-count"));
});

test("more than six parts flags part-count", () => {
  const parts = Array.from({ length: MAX_PARTS + 1 }, (_, i) => `Part ${i} holds 4.2% of the move.`);
  parts[parts.length - 1] += `\n\nWhat are you seeing?\n\n${SIGNOFF}`;
  assert.ok(rulesOf(lintChain(parts.join("\n---\n"))).includes("part-count"));
});

test("a part over 280 chars flags part-too-long, with its index and overage", () => {
  const long = "SPY 760 is the gate. " + "x".repeat(300);
  const r = lintChain(chainWith(1, long));
  const flag = r.flags.find((f) => f.rule === "part-too-long");
  assert.ok(flag, "expected part-too-long");
  assert.match(flag.detail, /part 2/);
  assert.match(flag.detail, new RegExp(String(charCount(long))));
});

test("part length counts a URL as 23 chars, the way X does", () => {
  // 260 real chars + a 60-char URL is 320 raw but 283 effective: still too long.
  const url = "https://x.com/i/status/" + "9".repeat(37);
  assert.equal(url.length, 60);
  const part = "SPY 760 is the gate. " + "x".repeat(239) + " " + url;
  assert.ok(charCount(part) > PART_LIMIT);
  assert.ok(effectiveLength(part) > PART_LIMIT);
  assert.ok(rulesOf(lintChain(chainWith(1, part))).includes("part-too-long"));

  // The same part with a short body passes only because the URL shrinks.
  const ok = "SPY 760 is the gate. " + "x".repeat(200) + " " + url;
  assert.ok(charCount(ok) > PART_LIMIT, "raw length is over");
  assert.ok(effectiveLength(ok) <= PART_LIMIT, "effective length is under");
  assert.ok(!rulesOf(lintChain(chainWith(1, ok))).includes("part-too-long"));
});

test("an emoji counts as one character, not two", () => {
  // Naive .length would count each 🚀 as 2 UTF-16 units and false-flag this.
  const part = "SPY 760 " + "🚀".repeat(135); // 8 + 135 = 143 code points
  assert.equal(charCount(part), 143);
  assert.ok(!rulesOf(lintChain(chainWith(1, part))).includes("part-too-long"));
});

test("any em dash flags, the cap is zero", () => {
  assert.equal(EM_DASH_CAP, 0);
  const r = lintChain(chainWith(1, "SOXX is up 4.2% — that is the whole story."));
  assert.ok(rulesOf(r).includes("em-dash"));
});

test("a hook with no checkable number flags hook-no-number", () => {
  const r = lintChain(chainWith(0, "Something strange is happening in semis. Here's what broke."));
  assert.ok(rulesOf(r).includes("hook-no-number"));
});

test("a hook with a number does not flag hook-no-number", () => {
  const r = lintChain(chainWith(0, "SOXX is up 4.2% before the bell. Here's what broke."));
  assert.ok(!rulesOf(r).includes("hook-no-number"));
});

test("a SPELLED number counts — bench-daily-v1's own worked example is spelled", () => {
  // "Three of the five biggest companies in America are red before the bell."
  // is the ✅ example in bench-daily-v1 §1. A digits-only check rejects it.
  assert.ok(hasCheckableNumber("Three of the five biggest companies are red"));
  assert.ok(hasCheckableNumber("Half the tape is green"));
  assert.ok(!hasCheckableNumber("Semis are moving and nobody is talking about it"));
  assert.ok(!rulesOf(lintChain(GOOD_CHAIN)).includes("hook-no-number"));
});

test("a hook that is a question flags hook-is-question", () => {
  const r = lintChain(chainWith(0, "Did you see SOXX rip 4.2% before the bell?"));
  assert.ok(rulesOf(r).includes("hook-is-question"));
});

test("a question in a later part is fine", () => {
  // The conversation trigger closes the post. Only the hook is barred.
  assert.ok(!rulesOf(lintChain(GOOD_CHAIN)).includes("hook-is-question"));
});

test("a banned generic opener flags banned-hook", () => {
  const r = lintChain(chainWith(0, "This changes everything. SOXX is up 4.2%. Here's what broke."));
  assert.ok(rulesOf(r).includes("banned-hook"));
});

test("banned-hook only looks at part 1", () => {
  const r = lintChain(chainWith(2, "Most people don't realize SPY 760 is the gate."));
  assert.ok(!rulesOf(r).includes("banned-hook"));
});

test("a marquee banned phrase flags anywhere in the chain", () => {
  const r = lintChain(chainWith(2, "Let's dive in. SPY 760 is the gate."));
  assert.ok(rulesOf(r).includes("banned-phrase"));
});

test("a bait question flags bait-question", () => {
  const r = lintChain(chainWith(3, `The read: supply is bought.\n\nThoughts?\n\n${SIGNOFF}`));
  assert.ok(rulesOf(r).includes("bait-question"));
});

test("more than two hashtags flags hashtag-cap", () => {
  const r = lintChain(chainWith(1, "SOXX +4.2% #semis #stocks #trading"));
  assert.ok(rulesOf(r).includes("hashtag-cap"));
});

test("two hashtags are allowed", () => {
  const r = lintChain(chainWith(1, "SOXX +4.2% #semis #stocks"));
  assert.ok(!rulesOf(r).includes("hashtag-cap"));
});

test("cashtags do not count against the hashtag cap", () => {
  const r = lintChain(chainWith(1, "$AMD +4.0%, $NVDA +1.6%, $MU +4.4%, $SOXX +4.2%"));
  assert.ok(!rulesOf(r).includes("hashtag-cap"));
});

test("a missing disclaimer flags missing-disclaimer", () => {
  const r = lintChain(chainWith(3, "The read: supply is bought.\n\nWhat would change your mind?"));
  assert.ok(rulesOf(r).includes("missing-disclaimer"));
});

test("the disclaimer must be on the LAST part, not an earlier one", () => {
  const parts = GOOD_CHAIN.split("\n---\n");
  parts[3] = "The read: supply is bought. What would change your mind?";
  parts[1] += `\n\n${SIGNOFF}`;
  assert.ok(rulesOf(lintChain(parts.join("\n---\n"))).includes("missing-disclaimer"));
});

test("a doubled separator flags empty-part", () => {
  const r = lintChain(GOOD_CHAIN.replace("\n---\n", "\n---\n---\n"));
  assert.ok(rulesOf(r).includes("empty-part"));
});

test("flags accumulate rather than short-circuiting", () => {
  const bad = [
    "Let that sink in. Semis are moving — a lot.",
    "Thoughts? #a #b #c"
  ].join("\n---\n");
  const rules = new Set(rulesOf(lintChain(bad)));
  for (const expected of [
    "part-count", "em-dash", "hook-no-number", "banned-hook",
    "bait-question", "hashtag-cap", "missing-disclaimer"
  ]) {
    assert.ok(rules.has(expected), `expected ${expected}, got ${[...rules].join(", ")}`);
  }
});

// ----------------------------------------------------------------- warnings

test("warnings never make a chain fail", () => {
  const parts = GOOD_CHAIN.split("\n---\n");
  parts[2] = "Breadth is 2 to 1 positive on the day.";           // no saveable
  parts[3] = `The read: supply is bought.\n\n${SIGNOFF}`;          // no question
  const r = lintChain(parts.join("\n---\n"));
  assert.deepEqual(r.flags, [], `unexpected flags: ${JSON.stringify(r.flags)}`);
  assert.equal(r.ok, true);
  assert.ok(warnsOf(r).includes("no-saveable"));
  assert.ok(warnsOf(r).includes("no-closing-question"));
});

test("a level with a consequence satisfies the saveable warning", () => {
  assert.ok(!warnsOf(lintChain(GOOD_CHAIN)).includes("no-saveable"));
});

test("a named invalidation also satisfies it", () => {
  const parts = GOOD_CHAIN.split("\n---\n");
  parts[2] = "INVALIDATION: a close under 757.67 and this thesis is dead.";
  assert.ok(!warnsOf(lintChain(parts.join("\n---\n"))).includes("no-saveable"));
});

// ------------------------------------------------------- lintArticle regress

test("lintArticle still passes a clean long-form article", () => {
  const body = `SOXX is up 4.2% before the bell.\n\nThe gap is the story.\n\n${
    "Proof, not hype."}\n\n@TheBenchTrades\n\nNot financial advice. Educational only.`;
  assert.equal(lintArticle(body).ok, true);
});

test("lintArticle still flags a stray divider in long-form", () => {
  const body = `Body copy.\n\n---\n\nProof, not hype.\n@TheBenchTrades\nNot financial advice. Educational only.`;
  assert.ok(rulesOf(lintArticle(body)).includes("divider-line"));
});

test("lintArticle still allows two em dashes", () => {
  const body = `A — B — C.\n\nProof, not hype.\n@TheBenchTrades\nNot financial advice. Educational only.`;
  assert.ok(!rulesOf(lintArticle(body)).includes("em-dash-cap"));
});

test("lintArticle still flags a third em dash", () => {
  const body = `A — B — C — D.\n\nProof, not hype.\n@TheBenchTrades\nNot financial advice. Educational only.`;
  assert.ok(rulesOf(lintArticle(body)).includes("em-dash-cap"));
});

// ------------------------------------------------------------------- inputs

test("empty and nullish input do not throw", () => {
  for (const input of [undefined, null, "", "   "]) {
    const r = lintChain(input);
    assert.equal(r.ok, false);
    assert.ok(rulesOf(r).includes("part-count"));
  }
});
