// patternLog.test.js — the rules for logging an observed market pattern.
//
// The book records CALLS: one ticker, one verdict, scoreable. This records
// OBSERVATIONS: cross-ticker, repeatable, testable. "A beat that follows a big
// run into the print gets sold" is not a call on any ticker — it is a claim
// about how the tape behaves, and it is worthless until it has instances
// attached and a way to be proven wrong.
//
// The teeth here: a pattern with no falsification test is a vibe, and vibes are
// what the Self-Audit Loop is supposed to keep out of the framework.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  nextPatternId,
  validatePattern,
  validateInstance,
  buildPattern,
  addInstance,
  summarise,
  daysSince,
} from "./patternLog.js";

const base = {
  claim: "A beat that follows an 8%+ run into the print gets sold on the reaction",
  test: "Track post-earnings 2-day return on names up 8%+ in the 5 sessions before the print",
  first_seen: "2026-08-04",
};

const inst = { date: "2026-08-04", ticker: "AMD", detail: "+8% into print, beat, -8% AH", holds: true };

test("nextPatternId continues the P-### sequence", () => {
  assert.equal(nextPatternId([{ id: "P-001" }, { id: "P-007" }]), "P-008");
});

test("nextPatternId starts at P-001", () => {
  assert.equal(nextPatternId([]), "P-001");
});

// ── the teeth ──────────────────────────────────────────────────────────────

test("a pattern with no falsification test is refused", () => {
  const { test: _drop, ...noTest } = base;
  assert.match(validatePattern(noTest).join(" "), /test/);
});

test("a pattern with a test is accepted", () => {
  assert.deepEqual(validatePattern(base), []);
});

test("a claim is required", () => {
  const { claim: _drop, ...noClaim } = base;
  assert.match(validatePattern(noClaim).join(" "), /claim/);
});

test("an instance must say whether the pattern HELD or FAILED", () => {
  const { holds: _drop, ...noVerdict } = inst;
  assert.match(validateInstance(noVerdict).join(" "), /holds/);
});

test("an instance must carry a ticker and a date", () => {
  const problems = validateInstance({ holds: true }).join(" ");
  assert.match(problems, /ticker/);
  assert.match(problems, /date/);
});

test("a clean instance validates", () => {
  assert.deepEqual(validateInstance(inst), []);
});

// ── building and accumulating ──────────────────────────────────────────────

test("a new pattern starts proposed, with no instances", () => {
  const p = buildPattern(base, []);
  assert.equal(p.id, "P-001");
  assert.equal(p.status, "proposed");
  assert.deepEqual(p.instances, []);
});

test("buildPattern refuses an untestable claim outright", () => {
  const { test: _drop, ...noTest } = base;
  assert.throws(() => buildPattern(noTest, []), /test/);
});

test("addInstance appends and leaves the original alone", () => {
  const p = buildPattern(base, []);
  const next = addInstance(p, inst);
  assert.equal(p.instances.length, 0, "original untouched");
  assert.equal(next.instances.length, 1);
  assert.equal(next.instances[0].ticker, "AMD");
});

test("a pattern stays proposed until it has three instances", () => {
  let p = buildPattern(base, []);
  p = addInstance(p, inst);
  p = addInstance(p, { ...inst, ticker: "SPCX" });
  assert.equal(p.status, "proposed", "two instances is still a coincidence");
});

test("three holds promotes it to supported", () => {
  let p = buildPattern(base, []);
  for (const t of ["AMD", "SPCX", "MU"]) p = addInstance(p, { ...inst, ticker: t });
  assert.equal(p.status, "supported");
});

test("a majority of failures marks it refuted, not quietly dropped", () => {
  let p = buildPattern(base, []);
  p = addInstance(p, { ...inst, ticker: "AMD", holds: false });
  p = addInstance(p, { ...inst, ticker: "SPCX", holds: false });
  p = addInstance(p, { ...inst, ticker: "MU", holds: true });
  assert.equal(p.status, "refuted");
});

test("summarise reports the hit rate so a weak pattern cannot hide", () => {
  let p = buildPattern(base, []);
  p = addInstance(p, { ...inst, ticker: "AMD", holds: true });
  p = addInstance(p, { ...inst, ticker: "SPCX", holds: true });
  p = addInstance(p, { ...inst, ticker: "MU", holds: false });
  const s = summarise(p);
  assert.equal(s.total, 3);
  assert.equal(s.held, 2);
  assert.equal(s.rate, 66.7);
});

test("summarise on an empty pattern does not divide by zero", () => {
  assert.equal(summarise(buildPattern(base, [])).rate, null);
});


// ---- row_ref: join an instance to the book row it tested ----

test("an instance can carry the book row it tested, and it survives attachment", () => {
  const out = addInstance(buildPattern(base, []), { ...inst, row_ref: "B-360" });
  assert.equal(out.instances[0].row_ref, "B-360");
});

test("an instance without a row_ref still attaches, with row_ref null", () => {
  assert.equal(addInstance(buildPattern(base, []), inst).instances[0].row_ref, null);
});

test("a row_ref that is not a book id is refused", () => {
  assert.ok(validateInstance({ ...inst, row_ref: "360" }).some((p) => /row_ref/.test(p)));
  assert.deepEqual(validateInstance({ ...inst, row_ref: "B-360" }), []);
});

test("daysSince counts whole calendar days and refuses anything that is not a date", () => {
  assert.equal(daysSince("2026-09-11", "2026-09-12"), 1);
  assert.equal(daysSince("2026-09-12", "2026-09-12"), 0);
  assert.equal(daysSince("2026-08-31", "2026-09-12"), 12);
  assert.equal(daysSince("not a date", "2026-09-12"), null);
});

test("daysSince rejects impossible dates rather than normalising them", () => {
  assert.equal(daysSince("2026-02-30", "2026-03-03"), null);
  assert.equal(daysSince("2026-13-01", "2026-03-03"), null);
});
