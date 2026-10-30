// up-in-down-tape.test.mjs — event detection and date-clustered stats. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";

import { findEvents, summarize } from "../scripts/up-in-down-tape.mjs";

// 300 sessions: stock and SPY drift together, then one +12% stock day on a -1.5% SPY day.
function fixture() {
  const bars = [], spy = new Map();
  let s = 100, m = 400;
  for (let i = 0; i < 300; i++) {
    const date = new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10);
    const mv = i % 2 ? 0.004 : -0.003;
    if (i === 260) { m *= 0.985; s *= 1.12; }
    else if (i > 0) { m *= 1 + mv; s *= 1 + 1.5 * mv; }
    bars.push({ date, close: s });
    spy.set(date, m);
  }
  return { bars, spy };
}

test("finds the jump on a down-SPY day and measures forward from its close", () => {
  const { bars, spy } = fixture();
  const ev = findEvents(bars, spy, { jump: 0.10, keep: (x) => x <= -0.01 });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].d0, 260);
  assert.ok(Math.abs(ev[0].beta - 1.5) < 0.01);
  const raw5 = bars[265].close / bars[260].close - 1;
  assert.ok(Math.abs(ev[0].fwd[5].raw - raw5) < 1e-12);
  const spy5 = spy.get(bars[265].date) / spy.get(bars[260].date) - 1;
  assert.ok(Math.abs(ev[0].fwd[5].excess - (raw5 - 1.5 * spy5)) < 1e-9);   // beta 1.5 fits exactly: excess ~ 0
  assert.equal(ev[0].fwd[20].raw > -1, true);
});

test("an up-SPY filter rejects the same jump", () => {
  const { bars, spy } = fixture();
  assert.equal(findEvents(bars, spy, { jump: 0.10, keep: (x) => x >= 0 }).length, 0);
});

test("summarize clusters by date: one crowded day counts once in the t", () => {
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push({ x: 0.2, date: "2020-03-24" });       // one wild day
  for (const d of ["2021-01-05", "2021-02-05", "2021-03-05", "2021-04-05"]) rows.push({ x: d.endsWith("1-05") ? 0.01 : -0.01, date: d });
  const s = summarize(rows);
  assert.equal(s.n, 44);
  assert.equal(s.dates, 5);
  assert.ok(s.mean > 15);                                    // the pooled mean is dominated by the crowded day
  assert.ok(Math.abs(s.t) < 2);                              // the clustered t is not
});
