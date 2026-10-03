// bookLog.test.js — the rules that make a call loggable.
//
// The book has 17 of 26 checkpoints unscorable for two reasons: conditionals
// logged without a trigger level, and hedges logged without a position size.
// Those are not mistakes to remember harder about — they are rows that should
// have been impossible to write. That is what this module enforces.

import { test } from "node:test";
import assert from "node:assert/strict";

import { nextId, requiredFields, validateCall, buildRow } from "./bookLog.js";

const rows = (...ids) => ids.map((id) => ({ id }));

const base = {
  ticker: "SPCX",
  price: 125.9,
  call: "No Trade - falling knife",
  type: "pass",
  date: "2026-08-04",
};

test("nextId continues the sequence", () => {
  assert.equal(nextId(rows("B-001", "B-022", "B-023")), "B-024");
});

test("nextId starts at B-001 on an empty book", () => {
  assert.equal(nextId([]), "B-001");
});

test("nextId uses the highest number, not the last row", () => {
  assert.equal(nextId(rows("B-023", "B-009")), "B-024");
});

test("nextId pads to three digits", () => {
  assert.equal(nextId(rows("B-007")), "B-008");
});

// ── the two holes that broke the book ───────────────────────────────────────

test("a conditional MUST carry a trigger level", () => {
  const problems = validateCall({ ...base, type: "conditional" });
  assert.match(problems.join(" "), /trigger/);
});

test("a conditional with a trigger is accepted", () => {
  assert.deepEqual(validateCall({ ...base, type: "conditional", trigger: 77, decide_by: "2026-08-11" }), []);
});

test("a hedge MUST carry a position size", () => {
  const problems = validateCall({ ...base, type: "hedge" });
  assert.match(problems.join(" "), /size/);
});

test("a hedge with a size is accepted", () => {
  assert.deepEqual(validateCall({ ...base, type: "hedge", size: 4 }), []);
});

test("a long MUST carry an invalidation, or it cannot be graded", () => {
  const problems = validateCall({ ...base, type: "long" });
  assert.match(problems.join(" "), /invalidation/);
});

test("a BET MUST state its max loss in dollars", () => {
  const problems = validateCall({ ...base, type: "bet" });
  assert.match(problems.join(" "), /max_loss/);
});

test("a pass needs nothing extra — declining is always loggable", () => {
  assert.deepEqual(validateCall(base), []);
});

// ── the fields every call needs ─────────────────────────────────────────────

test("ticker, price, call text and date are always required", () => {
  const problems = validateCall({ type: "pass" });
  const joined = problems.join(" ");
  for (const f of ["ticker", "price", "call", "date"]) {
    assert.match(joined, new RegExp(f), `expected a complaint about ${f}`);
  }
});

test("an unknown call type is refused rather than guessed", () => {
  const problems = validateCall({ ...base, type: "vibes" });
  assert.match(problems.join(" "), /type/);
});

test("a price that is not a number is refused, never coerced", () => {
  assert.match(validateCall({ ...base, price: "125.90" }).join(" "), /price/);
});

test("requiredFields reports what a type needs, for the CLI's error text", () => {
  assert.ok(requiredFields("conditional").includes("trigger"));
  assert.ok(requiredFields("hedge").includes("size"));
  assert.equal(requiredFields("pass").length, 0);
});

// ── building the row ───────────────────────────────────────────────────────

test("buildRow produces a schema-shaped row with the right id", () => {
  const row = buildRow({ ...base }, rows("B-023"));
  assert.equal(row.id, "B-024");
  assert.equal(row.ticker, "SPCX");
  assert.equal(row.review_price, 125.9);
  assert.equal(row.engine, "claude");
});

test("buildRow leaves grades null rather than inventing them", () => {
  const row = buildRow({ ...base }, []);
  assert.equal(row.grades.overall, null);
  assert.equal(row.opportunity_score, null);
});

test("buildRow carries the trigger through for a conditional", () => {
  const row = buildRow({ ...base, type: "conditional", trigger: 77, decide_by: "2026-08-11" }, []);
  assert.equal(row.trigger, 77);
});

test("buildRow refuses to build an invalid row at all", () => {
  assert.throws(() => buildRow({ ...base, type: "hedge" }, []), /size/);
});

test("buildRow records which chat logged it, for the cross-chat rule", () => {
  const row = buildRow({ ...base, source: "codex" }, []);
  assert.equal(row.logged_by, "codex");
});

// ── v29: readiness, origin, hunter calibration fields ──────────────────────

test("v29 fields default to null / unspecified", () => {
  const row = buildRow(base, []);
  assert.equal(row.readiness, null);
  assert.equal(row.origin, "unspecified");
  assert.equal(row.universe, null);
  assert.equal(row.hunter_opportunity, null);
  assert.equal(row.hunter_readiness, null);
});

test("v29 fields are carried when supplied", () => {
  const row = buildRow(
    { ...base, readiness: 42, origin: "hunter", universe: "market", hunter_opportunity: 87, hunter_readiness: 61 },
    []
  );
  assert.equal(row.readiness, 42);
  assert.equal(row.origin, "hunter");
  assert.equal(row.universe, "market");
  assert.equal(row.hunter_opportunity, 87);
  assert.equal(row.hunter_readiness, 61);
});

test("readiness outside 0-100 or non-integer is refused", () => {
  assert.match(validateCall({ ...base, readiness: 101 }).join(" "), /readiness must be an integer 0-100/);
  assert.match(validateCall({ ...base, readiness: 42.5 }).join(" "), /readiness must be an integer 0-100/);
  assert.match(validateCall({ ...base, hunter_readiness: -1 }).join(" "), /hunter_readiness must be/);
});

test("unknown origin or universe is refused; missing is fine", () => {
  assert.match(validateCall({ ...base, origin: "twitter" }).join(" "), /origin must be one of/);
  assert.match(validateCall({ ...base, universe: "crypto" }).join(" "), /universe must be one of/);
  assert.deepEqual(validateCall(base), []);
});
