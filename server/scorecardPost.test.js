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
