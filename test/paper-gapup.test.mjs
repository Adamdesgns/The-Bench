// paper-gapup.test.mjs — the gap-up paper test records, scores conservatively, and decides at 10. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { stopFor, step, summarize } from "../scripts/paper-gapup.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/paper-gapup.mjs");
const run = (args) => { try { return execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" }); } catch (e) { return e.stdout; } };

const base = { status: "OPEN", sessions: 0, last_scored: null, entry_date: "2026-09-16", entry: 100, stop: 95, target: 110 };

test("the stop is the wider of the signal-day low and 1 ATR", () => {
  assert.equal(stopFor(100, 97, 2), 97, "signal low is wider than 1 ATR");
  assert.equal(stopFor(100, 99, 2), 98, "1 ATR is wider than the signal low");
});

test("a day that touches both stop and target scores as the stop", () => {
  const t = step(base, { high: 111, low: 94, close: 105 }, "2026-09-16");
  assert.equal(t.status, "STOPPED");
  assert.equal(t.r, -1);
});

test("an open under the stop exits at the open, not the stop", () => {
  const t = step(base, { open: 93, high: 96, low: 92, close: 95.5 }, "2026-09-17");
  assert.equal(t.exit, 93);
  assert.equal(t.r, -1.4);
});

test("a target hit books the target; five quiet sessions exit at the close", () => {
  assert.equal(step(base, { high: 110.5, low: 99, close: 110 }, "2026-09-17").r, 2);
  let t = base;
  ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22"].forEach((d) => { t = step(t, { high: 103, low: 99, close: 102 }, d); });
  assert.equal(t.status, "TIME");
  assert.equal(t.r, 0.4);
});

test("the same date is never scored twice", () => {
  const once = step(base, { high: 103, low: 99, close: 102 }, "2026-09-16");
  assert.equal(step(once, { high: 103, low: 99, close: 102 }, "2026-09-16").sessions, 1);
});

test("summarize decides only at 10 closed", () => {
  const closed = Array.from({ length: 9 }, () => ({ status: "TIME", r: 0.5 }));
  assert.equal(summarize(closed).decided, false);
  assert.equal(summarize([...closed, { status: "STOPPED", r: -1 }]).decided, true);
});

test("CLI: refuses a non-gap-up entry and a duplicate, then scores a real one", () => {
  const db = join(mkdtempSync(join(tmpdir(), "pg-")), "db.json");
  const common = ["--signal-row", "B-900", "--signal-date", "2026-09-15", "--signal-low", "95", "--zone-high", "99", "--atr", "2", "--target", "110", "--date", "2026-09-16", "--db", db];
  assert.match(run(["add", "--sym", "TEST", "--entry", "98", ...common]), /REFUSED - entry 98 is not above the zone top/);
  assert.match(run(["add", "--sym", "TEST", "--entry", "100", ...common]), /PAPER PG-001 TEST: entry 100 .* stop 95/);
  assert.match(run(["add", "--sym", "TEST", "--entry", "100", ...common]), /already in the test/);
  assert.match(run(["score", "--bars", '{"TEST":{"high":110.2,"low":99,"close":109}}', "--date", "2026-09-17", "--write", "--db", db]), /TARGET\s+PG-001 TEST exit 110 = 2R/);
  assert.equal(JSON.parse(readFileSync(db, "utf8")).trades[0].status, "TARGET");
  assert.match(run(["report", "--db", db]), /1\/10 closed.*\n.*\n.*avg 2R/);
});
