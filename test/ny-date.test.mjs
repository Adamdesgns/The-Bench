// The book's calendar is New York's, not UTC's. A row logged at 7:30pm CDT
// on 2026-09-23 is 00:30 UTC on the 24th, and toISOString() stamped it the
// 24th — B-551..B-555 had to be hand-corrected. These tests pin the fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nyDate } from "../server/nyDate.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("nyDate: 00:30 UTC on 9/24 is still 9/23 in New York", () => {
  assert.equal(nyDate(new Date("2026-09-24T00:30:00Z")), "2026-09-23");
});

test("nyDate: rolls over at New York midnight, not UTC midnight", () => {
  assert.equal(nyDate(new Date("2026-09-24T03:59:00Z")), "2026-09-23");
  assert.equal(nyDate(new Date("2026-09-24T04:00:00Z")), "2026-09-24");
});

test("nyDate: follows the EST offset in winter", () => {
  assert.equal(nyDate(new Date("2026-12-15T04:30:00Z")), "2026-12-14");
  assert.equal(nyDate(new Date("2026-12-15T05:00:00Z")), "2026-12-15");
});

test("book loggers never stamp today with the UTC date", () => {
  const loggers = [
    "scripts/log-call.mjs",
    "scripts/log-pattern.mjs",
    "scripts/log-catalyst.mjs",
    "scripts/quant-evidence.mjs",
    "scripts/hunt-list.mjs",
  ];
  for (const f of loggers) {
    const src = readFileSync(resolve(ROOT, f), "utf8");
    assert.doesNotMatch(src, /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/, `${f} stamps a UTC date`);
  }
});
