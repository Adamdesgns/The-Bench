// lane-expectancy.test.mjs — the stop path: a touch exits at the stop, a gap exits at the open,
// an untriggered conditional is not a trade. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathR, summarize, bookTrades } from "../scripts/lane-expectancy.mjs";

const bar = (date, open, high, low, close) => ({ date, open, high, low, close });

test("no stop touch: valued at the checkpoint price", () => {
  const bars = [bar("2026-10-01", 100, 101, 99, 100), bar("2026-10-02", 100, 105, 99, 104)];
  const p = pathR({ entry: 100, stop: 95, from: "2026-10-01", to: "2026-10-02", exitPrice: 110, needsTrigger: false }, bars);
  assert.equal(p.stopped, false);
  assert.equal(p.r, 2);
});

test("a touch exits at -1R even if the checkpoint recovered", () => {
  const bars = [bar("2026-10-01", 100, 101, 99, 100), bar("2026-10-02", 99, 100, 94, 96), bar("2026-10-03", 96, 112, 96, 110)];
  const p = pathR({ entry: 100, stop: 95, from: "2026-10-01", to: "2026-10-03", exitPrice: 110, needsTrigger: false }, bars);
  assert.equal(p.r, -1);
  assert.equal(p.raw, 2);
  assert.equal(p.sessions, 1);
});

test("an open through the stop exits at the open, worse than -1R", () => {
  const bars = [bar("2026-10-01", 100, 101, 99, 100), bar("2026-10-02", 90, 92, 88, 91)];
  const p = pathR({ entry: 100, stop: 95, from: "2026-10-01", to: "2026-10-02", exitPrice: 91, needsTrigger: false }, bars);
  assert.equal(p.gap, true);
  assert.equal(p.r, -2);
});

test("a conditional whose trigger is never reached is not a trade", () => {
  const bars = [bar("2026-10-01", 100, 101, 99, 100), bar("2026-10-02", 100, 102, 99, 101)];
  assert.equal(pathR({ entry: 105, stop: 98, from: "2026-10-01", to: "2026-10-02", exitPrice: 101, needsTrigger: true }, bars), null);
});

test("a conditional enters on the trigger day and the stop counts from there", () => {
  const bars = [bar("2026-10-01", 96, 97, 93, 96), bar("2026-10-02", 99, 101, 98, 100), bar("2026-10-03", 100, 106, 99, 105)];
  // The 93 low on 10/01 is before the trigger, so it is not a stop.
  const p = pathR({ entry: 100, stop: 95, from: "2026-10-01", to: "2026-10-03", exitPrice: 105, needsTrigger: true }, bars);
  assert.equal(p.stopped, false);
  assert.equal(p.r, 1);
});

test("summarize reports win rate, average win, average loss and expectancy", () => {
  const s = summarize([{ r: 2 }, { r: -1 }, { r: -1 }, { r: 3 }]);
  assert.deepEqual(s, { n: 4, win_pct: 50, avg_win: 2.5, avg_loss: -1, exp: 0.75 });
});

test("bookTrades skips rows with no stop, no checkpoint, or a stop above entry", () => {
  const cp = { "1w": { asof: "2026-10-08", price: 110 } };
  const rows = [
    { id: "B-1", call_type: "long", ticker: "A", date: "2026-10-01", review_price: 100, invalidation: 95, checkpoints: cp },
    { id: "B-2", call_type: "long", ticker: "B", date: "2026-10-01", review_price: 100, invalidation: null, checkpoints: cp },
    { id: "B-3", call_type: "conditional", ticker: "C", date: "2026-10-01", trigger: 100, invalidation: 105, checkpoints: cp },
    { id: "B-4", call_type: "pass", ticker: "D", date: "2026-10-01", review_price: 100, invalidation: 95, checkpoints: cp },
  ];
  assert.deepEqual(bookTrades(rows).map((t) => t.id), ["B-1"]);
});
