// scorecardStats.test.js — the honesty rules of the scorecard. Pure, no fs.

import test from "node:test";
import assert from "node:assert/strict";

import {
  entries, groupStats, recordCounts, normalizeFomo, confidenceBand, isShadow, firstClosingDate, MIN_N,
} from "./scorecardStats.js";

const cp = (verdict, alpha) => ({ asof: "2026-07-07", verdict, alpha });
const rows = [
  { id: "B-001", date: "2026-06-30", ticker: "MSFT", call_type: "long", fomo: "Late FOMO", confidence_pct: 58,
    checkpoints: { "1w": cp("right", 4.5), "1m": cp("right", 22.1) } },
  { id: "B-002", date: "2026-07-01", ticker: "AMD", call_type: "pass", fomo: "LATE FOMO", confidence_pct: 40,
    checkpoints: { "1w": cp("wrong", 11.2) } },
  { id: "B-003", date: "2026-07-02", ticker: "HPQ", call_type: "pass", checkpoints: { "1w": cp("flat", 0.4) } },
  { id: "B-004", date: "2026-07-03", ticker: "GDS", final_call: "Watch — prose only",
    checkpoints: { "1w": cp("not_scorable", null) } },
  { id: "B-091", date: "2026-08-14", ticker: "IWM", call_type: "bet",
    final_call: "SHADOW TEST (not a Bench call): JC Merlo OAT default config, 1x IWM 8/21 304C @ 2.15",
    checkpoints: { "1w": { verdict: "not_scorable", alpha: null, asset_pct: 13851.63 } } },
  { id: "B-005", date: "2026-07-04", ticker: "XOM" },
];

test("fomo case variants merge, unknown text survives, empty is null", () => {
  assert.equal(normalizeFomo("LATE FOMO"), "Late FOMO");
  assert.equal(normalizeFomo("HEATING UP"), "Heating Up");
  assert.equal(normalizeFomo("Something New"), "Something New");
  assert.equal(normalizeFomo("  "), null);
  assert.equal(normalizeFomo(null), null);
});

test("confidence bands have exact edges", () => {
  assert.equal(confidenceBand(54.9), "<55");
  assert.equal(confidenceBand(55), "55-61");
  assert.equal(confidenceBand(61.9), "55-61");
  assert.equal(confidenceBand(62), "62+");
  assert.equal(confidenceBand(null), null);
});

test("a shadow test is recognised and excluded unless asked for", () => {
  assert.equal(isShadow(rows[4]), true);
  assert.equal(entries(rows).length, 5);
  assert.equal(entries(rows, { includeShadow: true }).length, 6);
});

test("each entry carries the scorer's note, so an outcome like an expensive pass can be grouped", () => {
  const e = entries([{ id: "B-9", call_type: "pass", checkpoints: { "1w": { verdict: "wrong", alpha: 12, note: "pass — expensive pass, it ran without us" } } }]);
  assert.equal(e[0].note, "pass — expensive pass, it ran without us");
});

test("a row with no call_type is prose provenance, never pooled silently", () => {
  const e = entries(rows).find((x) => x.id === "B-004");
  assert.equal(e.provenance, "prose");
  assert.equal(e.call_type, null);
});

test("a thin cell shows its counts and suppresses its rate", () => {
  const pass = groupStats(entries(rows), (e) => e.call_type).find((g) => g.key === "pass");
  assert.equal(MIN_N, 8);
  assert.equal(pass.suppressed, true);
  assert.equal(pass.win_rate, null);
  assert.equal(pass.mean_alpha, null);
  assert.deepEqual([pass.right, pass.wrong, pass.flat], [0, 1, 1]);
});

test("a flat is shown as a flat and never counted as a loss", () => {
  const pass = groupStats(entries(rows), (e) => e.call_type, { minN: 1 }).find((g) => g.key === "pass");
  assert.equal(pass.real, 2);
  assert.equal(pass.win_rate, 0);
  assert.equal(pass.wrong, 1);
  assert.equal(pass.flat, 1);
  assert.equal(pass.mean_alpha, 5.8);
});

test("a grouping that mixes call types reports no mean alpha, because a right pass and a right long have opposite signs", () => {
  const groups = groupStats(entries(rows), (e) => e.provenance, { minN: 1, withAlpha: false });
  assert.ok(groups.length > 0);
  for (const g of groups) assert.equal(g.mean_alpha, null);
  assert.equal(groups.find((g) => g.key === "declared").win_rate, 50);
});

test("a null key is reported as (none), not dropped", () => {
  const keys = groupStats(entries(rows), (e) => e.call_type, { minN: 1 }).map((g) => g.key);
  assert.ok(keys.includes("(none)"));
});

test("the three record counts are labelled and reconcile", () => {
  const r = recordCounts(rows);
  assert.deepEqual(
    [r.every_checkpoint_entry.n, r.every_checkpoint_entry.right, r.every_checkpoint_entry.wrong, r.every_checkpoint_entry.flat, r.every_checkpoint_entry.not_scorable],
    [6, 2, 1, 1, 2]
  );
  assert.deepEqual(
    [r.one_per_call_latest_horizon.n, r.one_per_call_latest_horizon.right, r.one_per_call_latest_horizon.not_scorable],
    [5, 1, 2]
  );
  assert.deepEqual(
    [r.one_per_call_latest_real_verdict.n, r.one_per_call_latest_real_verdict.right, r.one_per_call_latest_real_verdict.wrong, r.one_per_call_latest_real_verdict.flat],
    [3, 1, 1, 1]
  );
});

test("the first closing checkpoint is the oldest row plus the closing horizon", () => {
  assert.equal(firstClosingDate(rows), "2026-09-28");
});

test("alpha cannot mix unknown or different call types even with the default options", () => {
  for (const list of [[{call_type: null, verdict: "right", alpha: 10}], [{call_type: "pass", verdict: "right", alpha: -10}, {call_type: "long", verdict: "right", alpha: 10}]]) {
    assert.equal(groupStats(list, () => "all", {minN: 1})[0].mean_alpha, null);
  }
});
test("unscorable alpha is excluded and a thin alpha sample is suppressed", () => {
  const list = [{call_type: "long", verdict: "right", alpha: 2}, {call_type: "long", verdict: "wrong", alpha: null}, {call_type: "long", verdict: "not_scorable", alpha: 13851}];
  assert.equal(groupStats(list, () => "long", {minN: 1})[0].mean_alpha, 2);
  assert.equal(groupStats(list, () => "long", {minN: 2})[0].mean_alpha, null);
});
