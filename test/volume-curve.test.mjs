// The normal-day volume curve generator: pure maths only, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { etParts, dayCurve, shareCurve, fullPriorDays, drift, POINTS } from "../scripts/volume-curve.mjs";

const flat = (v = 100) => Array.from({ length: 78 }, (_, i) => ({ min: i * 5, v }));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test("etParts gives the New York date and minutes after the 09:30 open, winter and summer", () => {
  assert.deepEqual(etParts(Date.UTC(2026, 10, 6, 14, 30) / 1000), { day: "2026-11-06", min: 0 }); // EST
  assert.deepEqual(etParts(Date.UTC(2026, 7, 17, 13, 30) / 1000), { day: "2026-08-17", min: 0 }); // EDT
  assert.deepEqual(etParts(Date.UTC(2026, 10, 6, 20, 55) / 1000), { day: "2026-11-06", min: 385 });
});

test("dayCurve is the running share of the official day volume at each 5-minute mark", () => {
  const c = dayCurve(flat(), 8000, 0.975); // 7,800 in the bars, 200 in the closing auction
  assert.equal(c.length, POINTS);
  assert.equal(POINTS, 79);
  assert.equal(c[0], 0);
  near(c[1], 100 / 8000);
  near(c[6], 600 / 8000);
  near(c[78], 0.975);
});

test("dayCurve: a junk bar is trimmed to what the day really traded", () => {
  const junk = flat().map((b, i) => (i === 40 ? { ...b, v: 5000 } : b));
  const c = dayCurve(junk, 8000, 0.975);
  near(c[41] - c[40], 100 / 8000);
  near(c[78], 0.975);
});

test("dayCurve reads bars in clock order and counts a missing bar as no volume", () => {
  const b = flat().filter((x) => x.min !== 50).reverse();
  const c = dayCurve(b, 7700, 1);
  near(c[10], 1000 / 7700);
  near(c[11], 1000 / 7700);
  near(c[78], 1);
});

test("dayCurve refuses a day with no usable official volume", () => {
  for (const bad of [0, -1, null, undefined, NaN]) assert.equal(dayCurve(flat(), bad, 1), null);
});

test("shareCurve is the median across days at each point, rounded to 4 places, starting at 0", () => {
  const mk = (x) => Array.from({ length: POINTS }, (_, k) => (k === 0 ? 0 : x + k / 1000));
  const s = shareCurve([mk(0.1), mk(0.3), mk(0.2), null]);
  assert.equal(s.length, POINTS);
  assert.equal(s[0], 0);
  assert.equal(s[6], 0.206);
  assert.equal(shareCurve([mk(0.1), mk(0.2)])[6], 0.156); // even count: the midpoint
  assert.equal(shareCurve([mk(0.12345)])[1], 0.1245);
});

test("drift names the mark where a fresh curve sits furthest from the shipped one", () => {
  const a = Array.from({ length: POINTS }, (_, k) => k / 100);
  const b = a.map((v, k) => (k === 12 ? v + 0.02 : k === 40 ? v - 0.05 : v));
  const d = drift(b, a);
  assert.equal(d.mark, 40);
  assert.equal(d.minute, 200);
  near(d.gap, -0.05);
  assert.deepEqual(drift(a, a), { mark: 0, minute: 0, gap: 0 });
  assert.equal(drift(a.slice(0, 5), a), null); // a different length is not comparable
});

test("fullPriorDays drops today's unfinished session and thin days", () => {
  const days = new Map([
    ["2026-11-05", flat()],
    ["2026-11-06", flat().slice(0, 69)], // a half day
    ["2026-11-09", flat().slice(0, 72)], // today, 72 bars in: looks full, is not
  ]);
  assert.deepEqual(fullPriorDays(days, "2026-11-09").map(([d]) => d), ["2026-11-05"]);
  assert.deepEqual(fullPriorDays(days, "2026-11-10").map(([d]) => d), ["2026-11-05", "2026-11-09"]);
});
