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

// ---- crypto and named-ticker fixes (2026-10-08, BTC-USD vanished from both hunters) ----
import { rsVs, tradesWeekends, whyNotShort, applyMarks } from "../scripts/hunt-short.mjs";

// real calendar: a weekday series (SPY) and a 7-day series (crypto) over the same span
function calendarBars(days, { weekends, start = 100, step = 0 }) {
  const out = []; let p = start;
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(2026, 6, 1) + i * 864e5); const wd = d.getUTCDay();
    if (!weekends && (wd === 0 || wd === 6)) continue;
    p = p + step;
    out.push({ date: d.toISOString().slice(0, 10), open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 1000 });
  }
  return out;
}

test("rsVs lines crypto up with SPY by DATE; stocks keep the old count-based math", () => {
  const spyCal = calendarBars(120, { weekends: false, start: 500, step: 1 });
  const btc = calendarBars(120, { weekends: true, start: 100, step: 0 });     // flat
  assert.equal(tradesWeekends(btc), true);
  assert.equal(tradesWeekends(spyCal), false);
  // flat crypto vs SPY over the same 20 CALENDAR days: SPY gained 1/day on ~14 weekdays
  const a = btc.at(-21).date, b = btc.at(-1).date;
  const s0 = spyCal.filter((x) => x.date <= a).at(-1).close, s1 = spyCal.filter((x) => x.date <= b).at(-1).close;
  assert.equal(Number(rsVs(btc, spyCal, 20).toFixed(4)), Number((-(s1 - s0) / s0 * 100).toFixed(4)));
  // a stock on the SPY calendar: identical to the old pct - pct
  const stock = calendarBars(120, { weekends: false, start: 50, step: 0.5 });
  const old = ((stock.at(-1).close / stock.at(-21).close - 1) - (spyCal.at(-1).close / spyCal.at(-21).close - 1)) * 100;
  assert.equal(Number(rsVs(stock, spyCal, 20).toFixed(6)), Number(old.toFixed(6)));
  // the synthetic test bars (dates repeat every 28 days) are never treated as a crypto calendar
  assert.equal(tradesWeekends(bars({ n: 60 })), false);
});

test("a named ticker that misses every list is reported with its reasons, never dropped", () => {
  const quiet = bars({ n: 300, start: 100, drift: 0.05 });   // above its 50-day, not lagging much
  const r = screenSymbol("QUIET", quiet, spy);
  assert.equal(r.list, null);
  const ranked = rank([r]);
  assert.deepEqual(ranked.NOT_LISTED.map((x) => x.sym), ["QUIET"]);
  const why = whyNotShort(r);
  assert.match(why, /above the 50-day/);
});

test("applyMarks puts a live price on the last bar and widens its range", () => {
  const s = { "BTC-USD": [{ date: "2026-10-07", open: 1, high: 84000, low: 82000, close: 83276, volume: 1 }, { date: "2026-10-08", open: 83276, high: 83500, low: 80900, close: 80651, volume: 1 }] };
  const applied = applyMarks(s, "BTC-USD=80000,NOPE=5");
  assert.deepEqual(applied, [{ sym: "BTC-USD", mark: 80000, was: 80651, date: "2026-10-08" }]);
  assert.equal(s["BTC-USD"].at(-1).close, 80000);
  assert.equal(s["BTC-USD"].at(-1).low, 80000);
  assert.equal(s["BTC-USD"].at(-1).high, 83500);
});
