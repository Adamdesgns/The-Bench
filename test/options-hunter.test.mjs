// options-hunter.test.mjs — both screens, base rates, EV ranking, the band. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { screenLong, verifiedCeiling, baseRate, candidates, evRank } from "../scripts/options-hunter.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/options-hunter.mjs");

// synthetic bars with a repeating shape so the evidence engine has events to count
function bars({ n = 600, start = 100, drift = 0, endPct = 0, endVol = 1, pivotAt = null, pivotLow = null, pivotHigh = null, wave = 0 }) {
  const out = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p = p * (1 + drift / 100) * (1 + (wave ? Math.sin(i / 9) * wave / 100 : 0));
    let low = p * 0.96, high = p * 1.04, close = p, vol = 1_000_000;
    if (pivotAt !== null && i === pivotAt) { if (pivotLow !== null) low = pivotLow; if (pivotHigh !== null) high = pivotHigh; }
    if (i === n - 1 && endPct) { close = p * (1 + endPct / 100); if (endPct > 0) { high = close * 1.005; low = p; } else { low = close * 0.995; high = p; } vol = 1_000_000 * endVol; }
    const d = new Date(Date.UTC(2021, 0, 1) + i * 864e5 * 1.4);
    out.push({ date: d.toISOString().slice(0, 10), open: p, high, low, close, volume: vol });
  }
  return out;
}
const spy = bars({ n: 600, start: 500 });

test("verifiedCeiling finds the nearest pivot high above price", () => {
  const b = bars({ n: 200, start: 100, pivotAt: 120, pivotHigh: 130 });
  assert.equal(verifiedCeiling(b, 105).level, 130);
  assert.equal(verifiedCeiling(b, 140), null);
});

test("a breakout on volume with a ceiling and 2:1 is READY long", () => {
  const b = bars({ n: 600, start: 100, endPct: 8, endVol: 3, pivotAt: 300, pivotHigh: 140 });
  const r = screenLong("A", b, spy);
  assert.equal(r.gates.breakout, true);
  assert.equal(r.gates.leader, true);
  assert.equal(r.target.level, 140);
  assert.ok(r.geometry.rr >= 2, `rr ${r.geometry.rr}`);
  assert.equal(r.list, "READY");
});

test("baseRate counts direction and reach with a grade", () => {
  const b = bars({ n: 600, start: 100, wave: 4 });
  const e = baseRate(b, "long", 10, 3);
  assert.ok(e.n > 0);
  assert.ok(e.p_dir >= 0 && e.p_dir <= 100);
  assert.ok(e.p_reach <= e.p_dir);
  assert.match(e.grade, /^[A-F]/);
});

test("candidates runs both sides and attaches a spread request", () => {
  const series = { SPY: spy, UP: bars({ n: 600, start: 100, endPct: 8, endVol: 3, pivotAt: 300, pivotHigh: 140 }), DN: bars({ n: 600, start: 100, endPct: -12, endVol: 3, pivotAt: 300, pivotLow: 50 }), FLAT: bars({ n: 600, start: 100 }) };
  const { candidates: c } = candidates(series);
  const up = c.find((x) => x.sym === "UP" && x.side === "long");
  const dn = c.find((x) => x.sym === "DN" && x.side === "short");
  assert.ok(up && up.spread_request.structure === "call debit spread");
  assert.ok(dn && dn.spread_request.structure === "put debit spread");
  assert.ok(!c.find((x) => x.sym === "FLAT"));
  assert.equal(c[0].list, "READY"); // READY sorts first
});

test("evRank computes cost, max gain, EV per day, respects the band and the top cap", () => {
  const cands = [
    { sym: "A", side: "long", list: "READY", readiness: 70, evidence: { p_dir: 60, p_reach: 40, grade: "B", n: 20 }, geometry: { stop: 95, target: 120, rr: 2.5 } },
    { sym: "B", side: "short", list: "READY", readiness: 65, evidence: { p_dir: 55, p_reach: 30, grade: "C", n: 12 }, geometry: { stop: 105, target: 80, rr: 2.2 } },
    { sym: "C", side: "long", list: "STALK", readiness: 50, evidence: { p_dir: 50, p_reach: 20, grade: "D", n: 4 }, geometry: { stop: 95, target: 110, rr: 2 } },
  ];
  const marks = {
    A: { expiry: "2026-09-25", days: 7, long: { strike: 100, mark: 4.0, chance_of_profit: 0.45 }, short: { strike: 120, mark: 1.0 } },   // cost 300, width 2000, gain 1700
    B: { expiry: "2026-09-25", days: 7, long: { strike: 100, mark: 6.0, chance_of_profit: 0.40 }, short: { strike: 80, mark: 1.5 } },    // cost 450 > band 303
    C: { expiry: "2026-10-02", days: 12, long: { strike: 100, mark: 2.0 }, short: { strike: 110, mark: 0.5 } },                          // cost 150, gain 850
  };
  const r = evRank(cands, marks, { band: 303, top: 3 });
  assert.deepEqual(r.rejected.map((x) => x.sym), ["B"]);
  const a = r.top.find((x) => x.sym === "A");
  assert.equal(a.cost, 300);
  assert.equal(a.max_gain, 1700);
  assert.equal(a.ev, Number((0.4 * 1700 - 0.4 * 300).toFixed(2)));
  assert.equal(a.disagreement, 15);
  assert.equal(r.top[0].sym, "A"); // highest EV/day first
  const capped = evRank(cands, marks, { band: 1e9, top: 1 });
  assert.equal(capped.top.length, 1);
  assert.equal(capped.rest.length, 2);
});

test("CLI: --hunt offline then --ev-file rank, no writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "options-hunter-"));
  const barsFile = join(dir, "bars.json");
  writeFileSync(barsFile, JSON.stringify({ SPY: spy, UP: bars({ n: 600, start: 100, endPct: 8, endVol: 3, pivotAt: 300, pivotHigh: 140 }) }));
  const out = execFileSync("node", [CLI, "--hunt", "--bars-file", barsFile, "--json"], { encoding: "utf8" });
  const cand = JSON.parse(out);
  assert.ok(cand.candidates.length >= 1);
  const candFile = join(dir, "cand.json"); writeFileSync(candFile, out);
  const marksFile = join(dir, "marks.json");
  writeFileSync(marksFile, JSON.stringify({ UP: { expiry: "2026-09-25", days: 7, long: { strike: 108, mark: 4, chance_of_profit: 0.4 }, short: { strike: 140, mark: 0.5 } } }));
  const rank = execFileSync("node", [CLI, "--ev-file", marksFile, "--candidates", candFile, "--band", "1000"], { encoding: "utf8" });
  assert.match(rank, /TOP 3/);
  assert.match(rank, /UP\s+long/);
  assert.match(rank, /Nothing here is a ticket/);
});
