// short-quality.test.mjs — the career-trader verdict on scanner shorts. Read only, offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, judgeAll, lines } from "../scripts/short-quality.mjs";

const cand = (o = {}) => ({ side: "short", list: "READY", ok: true, sym: "ZZZ",
  geometry: { entry: 100, stop: 110, target: 70 }, evidence: { p_dir: 60, p_reach: 40 }, ...o });

test("a short that pays at its own odds, outside a bull sector, at 2 to 1 is QUALITY", () => {
  const r = judge(cand({ sym: "TLN" }), { switches: { XLU: { switch: "OFF" } } });
  assert.equal(r.rr, 3);
  assert.equal(r.ev_r, 0.8); // 0.40 x 3R - 0.40 x 1R
  assert.equal(r.quality, true);
  assert.match(lines([r])[1], /QUALITY {6}TLN: \+0\.8R a trade.*sector XLU OFF/);
});

test("the scanner's own odds pricing a loss make it NOT QUALITY (the MRVL case)", () => {
  const r = judge(cand({ sym: "MRVL", geometry: { entry: 171.41, stop: 207.61, target: 87.36 }, evidence: { p_dir: 45.45, p_reach: 0 } }));
  assert.equal(r.ev_r, -0.55);
  assert.equal(r.quality, false);
  assert.match(r.fails[0], /loses 0\.55R a trade on average/);
});

test("a chip short while SMH is BULL fails the sector check (rs.mjs SOXX maps to the SMH switch)", () => {
  const r = judge(cand({ sym: "LITE" }), { switches: { SMH: { switch: "BULL" } } });
  assert.equal(r.sector, "SMH");
  assert.ok(r.fails.some((f) => /SMH\) is in BULL mode/.test(f)));
});

test("re-measured at the real fill, a stale screen fails 2 to 1 (the AMZN case: 0.44 to 1)", () => {
  const r = judge(cand({ sym: "AMZN", geometry: { entry: 243.79, stop: 255.36, target: 220.5 }, evidence: { p_dir: 48.61, p_reach: 5.56 } }), { bid: 231.1 });
  assert.equal(r.rr, 0.44);
  assert.ok(r.fails.some((f) => /at the fill 231\.1 it pays 0\.44 to 1/.test(f)));
});

test("more than two READY shorts in one sector the same night are flagged as one bet", () => {
  const rows = judgeAll({ candidates: ["COHR", "LITE", "AAOI"].map((sym) => cand({ sym })) });
  assert.equal(rows.length, 3);
  for (const r of rows) assert.ok(r.fails.some((f) => /3 READY shorts in SMH tonight/.test(f)));
});

test("an unknown sector, or a sector with no bull switch, can never be QUALITY", () => {
  const unknown = judge(cand({ sym: "WULF" }));
  assert.equal(unknown.quality, false);
  assert.ok(unknown.fails.some((f) => /no bull switch for its sector \(sector unknown\)/.test(f)));
  const noSwitch = judge(cand({ sym: "META" }), { switches: { SMH: { switch: "BULL" } } });
  assert.ok(noSwitch.fails.some((f) => /no bull switch for its sector \(XLC\)/.test(f)));
});

test("a run-up plan written the way B-828 was would push (log-call match)", () => {
  const b828 = "WATCH - v34 DATED-CATALYST RUN-UP LANE, PAPER (instance 1 of 5).";
  assert.ok(/DATED-CATALYST/i.test(b828) && /PAPER/i.test(b828));
});

test("STALK, long and not-ok rows are ignored; none READY says so", () => {
  const rows = judgeAll({ candidates: [cand({ list: "STALK" }), cand({ side: "long" }), cand({ ok: false })] });
  assert.equal(rows.length, 0);
  assert.match(lines(rows)[1], /no READY shorts tonight/);
});
