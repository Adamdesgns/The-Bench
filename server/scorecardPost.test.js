// scorecardPost.test.js — the draft generator's honesty rules.
//
// These tests exist because the failure mode of a track-record generator is
// not a crash. It is a post that quietly only ever shows wins.

import test from "node:test";
import assert from "node:assert/strict";

import { renderWeeklyPost } from "./scorecardPost.js";

const win = {
  id: "B-018", ticker: "DOGE", type: "pass", call: "No Trade — fails every gate",
  horizon: "1w", verdict: "right", alpha: -14, assetPct: -18, benchPct: -4,
  bench: "BTC", note: "pass — correctly skipped", score: 25
};
const miss = {
  id: "B-017", ticker: "HYPE", type: "conditional", call: "Top watchlist — >$77 / dies <$52",
  horizon: "1w", verdict: "wrong", alpha: 12, assetPct: 14, benchPct: 2,
  bench: "BTC", note: "conditional — never triggered and it ran without us", score: 66
};
const skipped = {
  id: "B-005", ticker: "XOM", type: "hedge", call: "Hedge — active, delta overdue",
  horizon: "1w", verdict: "not_scorable", alpha: null,
  note: "hedge — no position, size or entry is recorded to score against", score: 56
};

test("the post states how many calls were scored", () => {
  const out = renderWeeklyPost([win, miss], { today: "2026-07-28" });
  assert.match(out, /2 calls/);
});

test("a week with nothing but losses still produces a post", () => {
  const out = renderWeeklyPost([miss], { today: "2026-07-28" });
  assert.ok(out && out.length > 0);
  assert.match(out, /HYPE/);
});

test("the misses appear, not only the hits", () => {
  const out = renderWeeklyPost([win, miss], { today: "2026-07-28" });
  assert.match(out, /DOGE/);
  assert.match(out, /HYPE/);
});

test("not_scorable rows are counted as excluded rather than dropped silently", () => {
  const out = renderWeeklyPost([win, skipped], { today: "2026-07-28" });
  assert.match(out, /1 not scored/);
});

test("a not_scorable row is never presented as a result", () => {
  const out = renderWeeklyPost([win, skipped], { today: "2026-07-28" });
  assert.doesNotMatch(out, /XOM/);
});

test("nothing scored produces no draft at all, rather than an empty post", () => {
  assert.equal(renderWeeklyPost([], { today: "2026-07-28" }), null);
  assert.equal(renderWeeklyPost([skipped], { today: "2026-07-28" }), null);
});

test("the right/wrong tally matches the rows passed in", () => {
  const out = renderWeeklyPost([win, win, miss], { today: "2026-07-28" });
  assert.match(out, /2 right/);
  assert.match(out, /1 wrong/);
});

test("the post fits X's 280-character limit", () => {
  const out = renderWeeklyPost([win, miss], { today: "2026-07-28" });
  assert.ok(out.length <= 280, `post was ${out.length} chars:\n${out}`);
});

// --- the chain -------------------------------------------------------------
//
// Same honesty rules as the single post, plus one the chain adds: post_next.py
// refuses a whole chain if ANY part would truncate, so an overflowing part is
// not a cosmetic bug, it is a week where the recap silently never posted.

import { renderWeeklyChain, effectiveLength, CHAIN_SEPARATOR, SIGNOFF } from "./scorecardPost.js";

const partsOf = (chain) => chain.split(`\n${CHAIN_SEPARATOR}\n`);

const flatCall = {
  id: "B-030", ticker: "LMT", type: "conditional", horizon: "1w",
  verdict: "flat", alpha: 0, assetPct: 0.2, benchPct: 0.2, bench: "SPY"
};

test("chain: every part fits in a post, so post_next never refuses the chain", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    ...win, id: `B-${i}`, ticker: `TICK${i}`, alpha: -i
  }));
  for (const part of partsOf(renderWeeklyChain(many, { link: "https://example.com/book" }))) {
    assert.ok(effectiveLength(part) <= 280, `part was ${effectiveLength(part)} chars:\n${part}`);
  }
});

test("chain: the separator is exactly three dashes alone on its line", () => {
  const chain = renderWeeklyChain([win, miss]);
  assert.match(chain, /\n---\n/);
  for (const part of partsOf(chain)) {
    assert.doesNotMatch(part, /^\s*-{3,}\s*$/m, `a part contained a stray separator:\n${part}`);
  }
});

test("chain: between three and six parts", () => {
  const n = partsOf(renderWeeklyChain([win, miss])).length;
  assert.ok(n >= 3 && n <= 6, `chain had ${n} parts`);
});

test("chain: part one is the hook and carries no verdict marks", () => {
  const [hook] = partsOf(renderWeeklyChain([win, miss]));
  assert.doesNotMatch(hook, /✅|❌/);
  assert.doesNotMatch(hook, /DOGE|HYPE/);
});

test("chain: the hook opens on a checkable number", () => {
  const [hook] = partsOf(renderWeeklyChain([win, miss]));
  assert.match(hook.split("\n")[0], /\d/);
});

test("chain: the hook ends on an open loop the chain pays off", () => {
  const [hook] = partsOf(renderWeeklyChain([win, miss]));
  assert.match(hook, /Here is every one/);
});

test("chain: the misses appear, not only the hits", () => {
  const chain = renderWeeklyChain([win, miss]);
  assert.match(chain, /DOGE/);
  assert.match(chain, /HYPE/);
});

test("chain: the hook names how many went against us", () => {
  assert.match(renderWeeklyChain([win, miss]), /1 that went against us/);
});

test("chain: a week of nothing but losses still produces a chain", () => {
  const chain = renderWeeklyChain([miss]);
  assert.ok(chain);
  assert.match(chain, /HYPE/);
  assert.match(chain, /0 right, 1 wrong/);
});

test("chain: not_scorable rows are counted as excluded, never shown as results", () => {
  const chain = renderWeeklyChain([win, skipped]);
  assert.match(chain, /1 not scored/);
  assert.doesNotMatch(chain, /XOM/);
});

test("chain: nothing scored produces no chain at all", () => {
  assert.equal(renderWeeklyChain([]), null);
  assert.equal(renderWeeklyChain([skipped]), null);
});

test("chain: flat calls are tallied rather than hidden", () => {
  assert.match(renderWeeklyChain([win, miss, flatCall]), /1 flat/);
});

test("chain: calls that did not fit are counted out loud, not dropped", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    ...win, id: `B-${i}`, ticker: `TICK${i}`, alpha: -i
  }));
  const chain = renderWeeklyChain(many);
  const shown = (chain.match(/\$TICK\d+/g) || []).length;
  const claimed = /\+(\d+) more scored calls? in the book/.exec(chain);
  assert.ok(claimed, `chain omitted ${30 - shown} calls without saying so:\n${chain}`);
  assert.equal(Number(claimed[1]) + shown, 30);
});

test("chain: the saveable element rides in its own part", () => {
  const parts = partsOf(renderWeeklyChain([win, miss]));
  const savePart = parts.filter((p) => p.includes("SAVE THIS"));
  assert.equal(savePart.length, 1);
  assert.doesNotMatch(savePart[0], /✅|❌/);
});

test("chain: the signoff rides on the last part, and only there", () => {
  const parts = partsOf(renderWeeklyChain([win, miss]));
  assert.ok(parts.at(-1).endsWith(SIGNOFF));
  assert.equal(parts.filter((p) => p.includes(SIGNOFF)).length, 1);
});

test("chain: the disclaimer survives even when everything optional is dropped", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    ...win, id: `B-${i}`, ticker: `AVERYLONGTICKER${i}`, alpha: -i
  }));
  const chain = renderWeeklyChain(many, { link: "https://example.com/book" });
  assert.match(chain, /Not financial advice/);
  for (const part of partsOf(chain)) {
    assert.ok(effectiveLength(part) <= 280);
  }
});

test("chain: a link is measured as t.co's 23 chars, not its real length", () => {
  const long = `https://example.com/${"a".repeat(300)}`;
  const chain = renderWeeklyChain([win, miss], { link: long });
  assert.match(chain, /Every call, misses included/);
  for (const part of partsOf(chain)) {
    assert.ok(effectiveLength(part) <= 280);
  }
});
