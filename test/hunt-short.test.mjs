// hunt-short.test.mjs — the short-side hunt: gates, verified floor, 2:1, READY cap. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { screenSymbol, rank, verifiedFloor, atr14 } from "../scripts/hunt-short.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/hunt-short.mjs");

// synthetic daily bars: flat-ish drift, then a crash on volume at the end.
function bars({ n = 300, start = 100, drift = 0, crashPct = 0, crashVol = 1, pivotAt = null, pivotLow = null }) {
  const out = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p = p * (1 + drift / 100);
    let low = p * 0.96, high = p * 1.04, close = p, vol = 1_000_000;
    if (pivotAt !== null && i === pivotAt) low = pivotLow;
    if (i === n - 1 && crashPct) { close = p * (1 + crashPct / 100); low = close * 0.995; high = p; vol = 1_000_000 * crashVol; }
    out.push({ date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, open: p, high, low, close, volume: vol });
  }
  return out;
}
const spy = bars({ n: 300, start: 500 });

test("verifiedFloor finds the nearest pivot low below price and ignores today", () => {
  const b = bars({ n: 200, start: 100, pivotAt: 120, pivotLow: 80 });
  const f = verifiedFloor(b, 95);
  assert.equal(f.level, 80);
  assert.equal(verifiedFloor(b, 70), null); // nothing below 70
});

test("a breakdown on volume with a floor and 2:1 is READY; without a floor it is NO_FLOOR", () => {
  const withFloor = bars({ n: 300, start: 100, crashPct: -12, crashVol: 3, pivotAt: 150, pivotLow: 50 });
  const r = screenSymbol("A", withFloor, spy);
  assert.equal(r.gates.breakdown, true);
  assert.equal(r.gates.laggard, true);
  assert.equal(r.floor.level, 50);
  assert.ok(r.geometry.rr >= 2, `rr ${r.geometry.rr}`);
  assert.equal(r.list, "READY");

  const noFloor = bars({ n: 300, start: 100, crashPct: -12, crashVol: 3 }); // all prior lows are above the crash close
  const r2 = screenSymbol("B", noFloor, spy);
  assert.equal(r2.gates.breakdown, true);
  assert.equal(r2.floor, null);
  assert.notEqual(r2.list, "READY");
  const ranked = rank([r, r2]);
  assert.deepEqual(ranked.READY.map((x) => x.sym), ["A"]);
  assert.deepEqual(ranked.NO_FLOOR.map((x) => x.sym), ["B"]);
});

test("a quiet name above its 50-day is nothing; a laggard under it with no break is DISCOVERY", () => {
  const up = screenSymbol("U", bars({ n: 300, start: 100, drift: 0.2 }), spy);
  assert.equal(up.list, null);
  const lag = screenSymbol("L", bars({ n: 300, start: 100, drift: -0.15, pivotAt: 100, pivotLow: 5 }), spy);
  assert.equal(lag.gates.laggard, true);
  assert.equal(lag.gates.breakdown, false); // steady drift never prints 1.5x volume
  assert.equal(lag.list, lag.floor ? "STALK" : "DISCOVERY");
});

test("READY is capped and the overflow is demoted to STALK, best readiness first", () => {
  const mk = (s, crash) => screenSymbol(s, bars({ n: 300, start: 100, crashPct: crash, crashVol: 3, pivotAt: 150, pivotLow: 50 }), spy);
  const rs = [mk("A", -5), mk("B", -6), mk("C", -7), mk("D", -8)];
  const ranked = rank(rs, 3);
  assert.equal(ranked.READY.length, 3);
  assert.equal(ranked.STALK.filter((x) => x.demoted).length, 1);
});

test("macro inside 2 sessions caps readiness at 60", () => {
  const b = bars({ n: 300, start: 100, crashPct: -12, crashVol: 3, pivotAt: 150, pivotLow: 50 });
  const r = screenSymbol("A", b, spy, { macroInside2: true });
  assert.ok(r.readiness <= 60);
});

test("atr14 is the mean true range of the last 14 bars", () => {
  const b = bars({ n: 50, start: 100 });
  const a = atr14(b);
  assert.ok(a > 0 && a < 10);
});

test("CLI runs offline from --bars-file and prints the lists", () => {
  const dir = mkdtempSync(join(tmpdir(), "hunt-short-"));
  const f = join(dir, "bars.json");
  writeFileSync(f, JSON.stringify({ SPY: spy, A: bars({ n: 300, start: 100, crashPct: -12, crashVol: 3, pivotAt: 150, pivotLow: 50 }), U: bars({ n: 300, start: 100, drift: 0.2 }) }));
  const out = execFileSync("node", [CLI, "--bars-file", f, "--account", "3030"], { encoding: "utf8" });
  assert.match(out, /READY \(1\/3\)/);
  assert.match(out, /put spread/);
  assert.match(out, /MAX LOSS <= 303/);
  assert.match(out, /Nothing here is a ticket/);
});
