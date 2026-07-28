// triggerParse.test.js — pulling structured levels out of v17's prose.
//
// Every string here is a real final_call from db/archive.json. A wrong level
// silently corrupts every conditional verdict downstream, which is why this is
// parsed into a PROPOSAL a human confirms, and why it is tested hard.

import test from "node:test";
import assert from "node:assert/strict";

import { parseLevels } from "./triggerParse.js";

test("'reclaim $540' proposes an above-trigger at 540", () => {
  const out = parseLevels("Watchlist — trigger: reclaim $540");
  assert.deepEqual(out.trigger, { direction: "above", level: 540 });
  assert.equal(out.invalidation, null);
});

test("'>$77 / dies <$52' proposes both sides", () => {
  const out = parseLevels("Top watchlist — >$77 / dies <$52");
  assert.deepEqual(out.trigger, { direction: "above", level: 77 });
  assert.deepEqual(out.invalidation, { direction: "below", level: 52 });
});

test("K suffixes expand to thousands", () => {
  const out = parseLevels("Watchlist — >$63.8-64.5K / <$56.2K");
  assert.deepEqual(out.trigger, { direction: "above", level: 63800 });
  assert.deepEqual(out.invalidation, { direction: "below", level: 56200 });
});

test("a range takes the level that must actually be cleared", () => {
  const out = parseLevels("ARMED — hold mid-$60s + reclaim $70-71");
  assert.deepEqual(out.trigger, { direction: "above", level: 70 });
});

test("'must hold $1.00' is an invalidation, not a trigger", () => {
  const out = parseLevels("No Trade — $1.00 must hold");
  assert.equal(out.trigger, null);
  assert.deepEqual(out.invalidation, { direction: "below", level: 1.0 });
});

test("'reclaim + hold $200-203' proposes an above-trigger at the lower bound", () => {
  const out = parseLevels("No Trade — reclaim + hold $200-203");
  assert.deepEqual(out.trigger, { direction: "above", level: 200 });
});

test("commas in large numbers are handled", () => {
  const out = parseLevels("Entered — stop $1,020");
  assert.deepEqual(out.invalidation, { direction: "below", level: 1020 });
});

test("prose with no level yields nothing rather than a guess", () => {
  assert.deepEqual(parseLevels("Setup Forming — earnings gate Jul 22"), { trigger: null, invalidation: null });
  assert.deepEqual(parseLevels("No Trade — Aug 6 earnings revisit"), { trigger: null, invalidation: null });
  assert.deepEqual(parseLevels("Hedge — active, delta overdue"), { trigger: null, invalidation: null });
  assert.deepEqual(parseLevels(""), { trigger: null, invalidation: null });
});

test("a bare month-day number is never mistaken for a price", () => {
  assert.equal(parseLevels("No Trade — Aug 6 earnings revisit").trigger, null);
  assert.equal(parseLevels("Setup Forming — earnings gate Jul 22").invalidation, null);
});
