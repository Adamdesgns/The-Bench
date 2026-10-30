// earnings-runup.test.mjs — event dating and clustering for the earnings study. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";

import { earningsFilings, reactionIndex, clustered } from "../scripts/earnings-runup.mjs";

test("only 8-K filings carrying Item 2.02 count, with their time of day", () => {
  const subs = { filings: { recent: {
    form: ["8-K", "8-K", "10-Q", "8-K/A"],
    items: ["2.02,9.01", "5.02", "", "2.02"],
    filingDate: ["2026-07-31", "2026-08-01", "2026-08-01", "2026-08-02"],
    acceptanceDateTime: ["2026-07-31T20:05:12.000Z", "2026-08-01T08:00:00.000Z", "", "2026-08-02T07:00:00.000Z"]
  } } };
  const f = earningsFilings(subs);
  assert.equal(f.length, 1);
  assert.equal(f[0].date, "2026-07-31");
  assert.ok(Math.abs(f[0].hour - 16.083) < 0.01);         // 20:05Z in July = 4:05pm New York
});

test("acceptanceDateTime is UTC: an evening filing lands on its New York date, not the next one", () => {
  const subs = { filings: { recent: {
    form: ["8-K", "8-K", "8-K"], items: ["2.02", "2.02", "2.02"],
    filingDate: ["2026-08-04", "2026-01-15", "2026-03-10"],   // filingDate rolls an evening filing to the next day
    acceptanceDateTime: ["2026-08-04T00:30:00.000Z", "2026-01-15T11:45:00.000Z", "2026-03-10T21:10:00.000Z"]
  } } };
  const [jan, mar, aug] = earningsFilings(subs);
  assert.deepEqual(aug, { date: "2026-08-03", hour: 20.5 });   // 8:30pm EDT the day before: reacts 8/4
  assert.deepEqual(jan, { date: "2026-01-15", hour: 6.75 });   // EST, UTC-5: pre-market
  assert.equal(mar.hour, 17 + 10 / 60);                          // 3/10 is after the March DST switch: UTC-4
});

test("after-close filings react the next session; before-close react the same day", () => {
  const bars = [{ date: "2026-07-30" }, { date: "2026-07-31" }, { date: "2026-08-03" }];
  assert.equal(reactionIndex(bars, { date: "2026-07-31", hour: 16.1 }), 2);
  assert.equal(reactionIndex(bars, { date: "2026-07-31", hour: 7 }), 1);
  assert.equal(reactionIndex(bars, { date: "2026-08-01", hour: 7 }), 2); // Saturday filing -> Monday
});

test("clustered t uses quarter means, so one crowded quarter cannot fake significance", () => {
  const rows = [];
  for (let i = 0; i < 50; i++) rows.push({ x: 0.10, q: "2020Q1" }); // one huge, positive quarter
  for (const q of ["2020Q2", "2020Q3", "2020Q4", "2021Q1"]) for (let i = 0; i < 5; i++) rows.push({ x: i % 2 ? 0.01 : -0.01, q });
  const c = clustered(rows);
  assert.equal(c.quarters, 5);
  assert.ok(c.mean > 5, "pooled mean is dominated by the crowded quarter");
  assert.ok(c.t < 2, `clustered t stays modest (${c.t})`);
});
