// readout-sweep.test.mjs — dates and windows come out of company prose correctly. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";

import { extractWhen, findEvents } from "../scripts/readout-sweep.mjs";

test("a single date and a meeting range both parse", () => {
  const w = extractWhen("presented on October 24, 2026 at ESMO Congress 2026, held October 23-27, 2026 in Madrid");
  assert.deepEqual(w.map((x) => [x.start, x.end, x.kind]), [
    ["2026-10-24", "2026-10-24", "date"],
    ["2026-10-23", "2026-10-27", "range"]
  ]);
});

test("a range across months keeps both months", () => {
  const [w] = extractWhen("the meeting runs November 30 - December 2, 2026");
  assert.equal(w.start, "2026-11-30");
  assert.equal(w.end, "2026-12-02");
});

test("quarters, halves and year-end become windows", () => {
  const w = extractWhen("topline data expected in the fourth quarter of 2026, with Q1 2027 filing, and 2H 2027 launch; year-end 2026");
  const got = w.map((x) => [x.kind, x.start, x.end]);
  assert.ok(got.some((g) => g[0] === "quarter" && g[1] === "2026-10-01" && g[2] === "2026-12-31"));
  assert.ok(got.some((g) => g[0] === "quarter" && g[1] === "2027-01-01" && g[2] === "2027-03-31"));
  assert.ok(got.some((g) => g[0] === "half" && g[1] === "2027-07-01" && g[2] === "2027-12-31"));
});

test("findEvents keeps future events near an event word and names the meeting", () => {
  const text = "Revenue for the quarter ended June 30, 2026 was $10M. " + "x ".repeat(300) +
    "The Company will present late-breaking data in a Presidential Symposium at ESMO Congress 2026 on October 24, 2026.";
  const ev = findEvents(text, "2026-10-11");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].start, "2026-10-24");
  assert.equal(ev[0].meeting, "ESMO");
});

test("findEvents drops past dates and anything more than ~13 months out", () => {
  const ev = findEvents("topline data was reported on August 19, 2026; pivotal data expected in the second half of 2028", "2026-10-11");
  assert.equal(ev.length, 0);
});

test("cash is not ASH and a balance-sheet date is not an event", () => {
  const ev = findEvents("Cash and cash equivalents topline at December 31, 2026 were $110M", "2026-10-11");
  assert.equal(ev.length, 0);
  const real = findEvents("data will be presented at ASH on December 6, 2026", "2026-10-11");
  assert.equal(real.length, 1);
  assert.equal(real[0].meeting, "ASH");
});
