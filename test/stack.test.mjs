// stack.test.mjs — the stack lane: Adam names it and sizes it, the desk gives mechanical add levels,
// and the book scores it against SPY. It records; it never places an order. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atr14, pivotLows, addLevels, isSpikeDay, settledBars, parseGate, addName, setTranche,
  recordBuy, position, scoreName, tranchePlan, checkTouches, spikeRead, levelsAsOf, chartRows,
} from "../scripts/stack.mjs";

const day = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
// Every bar closes at p with a 2-wide range, so ATR(14) is exactly 2.
const flat = (n, p = 100) => Array.from({ length: n }, (_, i) => ({ d: day(i), o: p, h: p + 1, l: p - 1, c: p, v: 1000 }));
const dip = (bars, i, low) => { bars[i] = { ...bars[i], l: low }; return bars; };

const base = (o = {}) => ({ sym: "ZZZ", why: "own it for years", date: "2026-11-09", by: "adam", price: 50, spy: 500, row: "B-1", ...o });
const entry = (o = {}) => { const db = { names: {} }; addName(db, base(o)); return db.names[o.sym ?? "ZZZ"]; };

test("atr14 on a flat tape is the bar range", () => {
  assert.equal(atr14(flat(30)), 2);
});

test("a pivot low needs three higher bars on each side", () => {
  const bars = dip(flat(20), 10, 90);
  assert.deepEqual(pivotLows(bars).map((p) => [p.d, p.price]), [[day(10), 90]]);
});

test("a low inside the last three bars is not a confirmed pivot yet", () => {
  const bars = dip(flat(20), 18, 90);
  assert.deepEqual(pivotLows(bars), []);
});

test("the first level sits at least one ATR under the price", () => {
  const bars = dip(dip(flat(300), 200, 98.5), 150, 95);
  const levels = addLevels(bars, { price: 100 });
  assert.equal(levels[0].price, 95); // 98.5 is only 0.75 ATR down, so it is skipped
  assert.equal(levels[0].kind, "pivot low");
});

test("levels are at least one ATR apart and there are at most three", () => {
  const bars = flat(300);
  [[50, 95], [100, 94.5], [150, 92.5], [200, 90], [250, 85]].forEach(([i, l]) => dip(bars, i, l));
  const prices = addLevels(bars, { price: 100 }).map((l) => l.price);
  assert.deepEqual(prices, [95, 92.5, 90]);
});

test("moving averages under the price count, and none above it does", () => {
  const up = Array.from({ length: 260 }, (_, i) => { const c = 50 + i * 0.2; return { d: day(i), o: c, h: c + 0.5, l: c - 0.5, c, v: 1000 }; });
  const levels = addLevels(up, { price: 101 });
  assert.ok(levels.some((l) => /-day/.test(l.kind)), "a moving average should be listed");
  assert.ok(levels.every((l) => l.price < 101));
});

test("the 52-week low is a level even when it is not a confirmed pivot", () => {
  const bars = dip(flat(300), 298, 80);
  const levels = addLevels(bars, { price: 100 });
  assert.deepEqual(levels.map((l) => [l.price, l.kind]), [[80, "52-week low"]]);
});

test("no level under the price gives an empty list", () => {
  assert.deepEqual(addLevels(flat(300), { price: 90 }), []);
});

test("a day up one ATR or more is a spike day", () => {
  assert.equal(isSpikeDay({ price: 104, prevClose: 100, atr: 4 }), true);
});

test("a smaller up day and a down day are not spike days", () => {
  assert.equal(isSpikeDay({ price: 103, prevClose: 100, atr: 4 }), false);
  assert.equal(isSpikeDay({ price: 90, prevClose: 100, atr: 4 }), false);
});

test("today's bar is dropped while the session is open and kept after the close", () => {
  const bars = flat(5);
  const today = bars.at(-1).d;
  assert.equal(settledBars(bars, { nyDate: today, nyMinutes: 11 * 60 }).settled.length, 4);
  assert.equal(settledBars(bars, { nyDate: today, nyMinutes: 11 * 60 }).live.d, today);
  assert.equal(settledBars(bars, { nyDate: today, nyMinutes: 16 * 60 + 5 }).settled.length, 5);
  assert.equal(settledBars(bars, { nyDate: today, nyMinutes: 16 * 60 + 5 }).live, null);
});

test("a gate string is parsed and unknown tests are refused", () => {
  assert.deepEqual(parseGate("durable=unproven,fundamentals=fail"), { durable: "unproven", fundamentals: "fail" });
  assert.throws(() => parseGate("vibes=great"), /vibes/);
});

test("a name with no reason is refused", () => {
  assert.throws(() => addName({ names: {} }, base({ why: "  " })), /why/i);
});

test("the same name cannot be added twice", () => {
  const db = { names: {} };
  addName(db, base());
  assert.throws(() => addName(db, base()), /already/i);
});

test("a failed gate never refuses: the name goes on and the answers are kept", () => {
  const e = entry({ gate: { fundamentals: "fail" }, row: "B-1", kill: "dilution over 25%" });
  assert.equal(e.gate.fundamentals, "fail");
  assert.equal(e.row, "B-1");
  assert.equal(e.kill, "dilution over 25%");
});

test("a size nobody named stays empty", () => {
  assert.equal(entry().tranche_dollars, null);
  assert.deepEqual(tranchePlan(entry(), [{ price: 40, kind: "pivot low" }]), [{ price: 40, kind: "pivot low", shares: null, dollars: null }]);
});

test("a named size turns each level into shares, fractions rounded down", () => {
  const e = entry();
  setTranche(e, 100);
  assert.deepEqual(tranchePlan(e, [{ price: 33, kind: "x" }])[0], { price: 33, kind: "x", shares: 3.03, dollars: 100 });
});

test("a size of zero is refused", () => {
  assert.throws(() => setTranche(entry(), 0), /positive/);
});

test("a buy needs positive shares and a positive price", () => {
  assert.throws(() => recordBuy(entry(), { shares: 0, price: 40, spy: 500, date: "2026-11-10" }), /shares/);
  assert.throws(() => recordBuy(entry(), { shares: 1, price: -1, spy: 500, date: "2026-11-10" }), /price/);
});

test("a buy needs the SPY price, or it cannot be scored", () => {
  assert.throws(() => recordBuy(entry(), { shares: 1, price: 40, date: "2026-11-10" }), /spy/i);
});

test("position adds up shares and average cost", () => {
  const e = entry();
  recordBuy(e, { shares: 10, price: 40, spy: 500, date: "2026-11-10" });
  recordBuy(e, { shares: 10, price: 30, spy: 500, date: "2026-11-11" });
  assert.deepEqual(position(e), { shares: 20, cost: 700, avg: 35 });
});

test("a name with no buys is a watch, scored in percent only", () => {
  const s = scoreName(entry({ price: 50, spy: 500 }), { price: 60, spy: 550 });
  assert.equal(s.mode, "watch");
  assert.equal(s.pct, 20);
  assert.equal(s.spy_pct, 10);
  assert.equal(s.vs_spy, 10);
  assert.equal(s.held, null);
});

test("a held name is scored against the same dollars in SPY on the same days", () => {
  const e = entry();
  recordBuy(e, { shares: 10, price: 100, spy: 500, date: "2026-11-10" });
  const s = scoreName(e, { price: 120, spy: 550, account: 2400 });
  assert.equal(s.mode, "held");
  assert.deepEqual(s.held, { shares: 10, avg: 100, cost: 1000, value: 1200, pct: 20, spy_value: 1100, vs_spy_dollars: 100, account_pct: 50 });
  assert.deepEqual(s.tranches, [{ date: "2026-11-10", shares: 10, price: 100, pct: 20, spy_pct: 10, vs_spy: 10 }]);
});

test("a low at or under a level records a touch", () => {
  const e = entry();
  e.levels = [{ price: 40, kind: "pivot low" }, { price: 35, kind: "50-day" }];
  e.levels_asof = day(0);
  const bars = [{ d: day(1), o: 42, h: 43, l: 39.9, c: 41, v: 1 }];
  assert.deepEqual(checkTouches(e, bars), [{ date: day(1), price: 40, kind: "pivot low", low: 39.9, close: 41 }]);
  assert.equal(e.touches.length, 1);
});

test("running the check again on the same bar adds nothing", () => {
  const e = entry();
  e.levels = [{ price: 40, kind: "pivot low" }];
  e.levels_asof = day(0);
  const bars = [{ d: day(1), o: 42, h: 43, l: 39, c: 41, v: 1 }];
  checkTouches(e, bars);
  e.levels_asof = day(1);
  assert.deepEqual(checkTouches(e, bars), []);
  assert.equal(e.touches.length, 1);
});

test("a level touched on two missed nights counts once, on the first date", () => {
  const e = entry();
  e.levels = [{ price: 40, kind: "pivot low" }];
  e.levels_asof = day(0);
  const bars = [{ d: day(1), o: 42, h: 43, l: 39, c: 41, v: 1 }, { d: day(2), o: 41, h: 42, l: 38, c: 40, v: 1 }];
  assert.deepEqual(checkTouches(e, bars).map((t) => t.date), [day(1)]);
});

test("a name with no book row is refused: the framework runs first", () => {
  assert.throws(() => addName({ names: {} }, base({ row: null })), /row/i);
});

test("a price, a SPY price or a size that is not a positive number is refused", () => {
  assert.throws(() => addName({ names: {} }, base({ price: NaN })), /price/i);
  assert.throws(() => addName({ names: {} }, base({ spy: 0 })), /spy/i);
  assert.throws(() => addName({ names: {} }, base({ tranche: -50 })), /tranche/i);
});

test("while the session is open the spike is today's price against yesterday's close", () => {
  const settled = flat(30), live = { d: "live", c: 102.5 };
  assert.deepEqual(spikeRead({ settled, live, price: 102.5 }), { spike: true, atrs: 1.25 });
});

test("after the close the spike is the settled day against the day before it", () => {
  const settled = [...flat(30), { d: "last", o: 100, h: 105, l: 100, c: 105, v: 1 }];
  assert.deepEqual(spikeRead({ settled, live: null, price: 105 }), { spike: true, atrs: 2.5 });
});

test("a level written during the session cannot be touched by that same session", () => {
  assert.equal(levelsAsOf({ settled: flat(5), live: { d: "today" } }), "today");
  assert.equal(levelsAsOf({ settled: flat(5), live: null }), day(4));
});

test("a split after the buy changes the shares and the price, not the money", () => {
  const e = entry();
  recordBuy(e, { shares: 10, price: 100, spy: 500, date: "2026-11-10" });
  const s = scoreName(e, { price: 10, spy: 500, splits: [{ d: "2026-12-01", factor: 10 }] });
  assert.equal(s.held.shares, 100);
  assert.equal(s.held.avg, 10);
  assert.equal(s.held.value, 1000);
  assert.equal(s.held.vs_spy_dollars, 0);
  assert.deepEqual(s.tranches[0], { date: "2026-11-10", shares: 100, price: 10, pct: 0, spy_pct: 0, vs_spy: 0 });
});

test("a split before the buy changes nothing", () => {
  const e = entry();
  recordBuy(e, { shares: 10, price: 100, spy: 500, date: "2026-11-10" });
  assert.equal(scoreName(e, { price: 100, spy: 500, splits: [{ d: "2026-01-01", factor: 10 }] }).held.shares, 10);
});

test("a split after a watch was added is adjusted out of the score", () => {
  const s = scoreName(entry({ price: 100, spy: 500 }), { price: 10, spy: 500, splits: [{ d: "2026-12-01", factor: 10 }] });
  assert.equal(s.pct, 0);
});

// The command line, end to end, on a throwaway file and fixed bars.
const cli = () => {
  const dir = mkdtempSync(join(tmpdir(), "stack-"));
  const db = join(dir, "stack.json"), barsFile = join(dir, "bars.json");
  const asts = dip(flat(300, 40), 200, 34);
  writeFileSync(barsFile, JSON.stringify({ ASTS: asts, SPY: flat(300, 500) }));
  const run = (...args) => spawnSync(process.execPath, ["scripts/stack.mjs", ...args, "--db", db, "--bars-file", barsFile], { encoding: "utf8", env: { ...process.env, BENCH_NO_PUSH: "1" } });
  return { db, barsFile, run, asts };
};

test("a name with no data is reported and the other names still get checked and saved", () => {
  const { db, barsFile, run, asts } = cli();
  writeFileSync(barsFile, JSON.stringify({ ASTS: asts, GONE: flat(300, 20), SPY: flat(300, 500) }));
  run("add", "GONE", "--why", "x", "--row", "B-1");
  run("add", "ASTS", "--why", "x", "--row", "B-1");
  const next = [...asts, { d: day(300), o: 40, h: 40, l: 33, c: 35, v: 1 }];
  writeFileSync(barsFile, JSON.stringify({ ASTS: next, SPY: flat(300, 500) }));
  const r = run("check", "--write");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /STACK: GONE no data/);
  assert.match(r.stdout, /STACK: ASTS touched 34\.00/);
  const saved = JSON.parse(readFileSync(db, "utf8")).names;
  assert.equal(saved.ASTS.touches.length, 1);
  assert.equal(saved.ASTS.levels_asof, day(300));
});

test("a buy on a date with no SPY bar is refused unless the SPY price is given", () => {
  const { run } = cli();
  run("add", "ASTS", "--why", "x", "--row", "B-1");
  const r = run("buy", "ASTS", "--shares", "1", "--price", "40", "--date", "2020-03-21");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SPY/);
});

test("a buy date that is not YYYY-MM-DD is refused", () => {
  const { run } = cli();
  run("add", "ASTS", "--why", "x", "--row", "B-1");
  const r = run("buy", "ASTS", "--shares", "1", "--price", "40", "--spy", "500", "--date", "11/06");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /YYYY-MM-DD/);
});

test("the command line adds a name, prints its levels and never mentions an order", () => {
  const { db, run } = cli();
  const r = run("add", "ASTS", "--why", "Adam wants to own it", "--by", "adam", "--row", "B-1360", "--gate", "fundamentals=fail");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ASTS/);
  assert.match(r.stdout, /34/);
  assert.match(r.stdout, /fundamentals: fail/);
  assert.doesNotMatch(r.stdout, /place|order placed/i);
  assert.equal(JSON.parse(readFileSync(db, "utf8")).names.ASTS.by, "adam");
});

test("the command line refuses a buy on a name that is not on the lane", () => {
  const { run } = cli();
  const r = run("buy", "NOPE", "--shares", "1", "--price", "40", "--spy", "500");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not on the stack lane/i);
});

test("the report prints the watch score", () => {
  const { run } = cli();
  run("add", "ASTS", "--why", "own it", "--row", "B-1");
  const r = run("report");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ASTS/);
  assert.match(r.stdout, /watch/i);
  assert.match(r.stdout, /SPY/);
  assert.match(r.stdout, /price return/i);
});

// Yahoo left today's close empty for ASTS and SPCX after the 2026-11-10 bell while its quote had the price.
// Dropping that bar made the report print Monday's close as Tuesday's price (ASTS -1.78% shown, -10.3% real).
// The payload as Yahoo sent it that night: both bars open at 09:30 ET, the newest close empty, the quote settled.
const sec = (iso) => Date.parse(iso) / 1000;
const astsChart = ({ close = null, rmt = "2026-11-10T21:00:01Z" } = {}) => ({
  meta: {
    exchangeTimezoneName: "America/New_York", regularMarketPrice: 33.69, regularMarketTime: sec(rmt),
    currentTradingPeriod: { regular: { start: sec("2026-11-10T14:30:00Z"), end: sec("2026-11-10T21:00:00Z") } },
  },
  timestamp: [sec("2026-11-09T14:30:00Z"), sec("2026-11-10T14:30:00Z")],
  indicators: { quote: [{ open: [37, 34.13], high: [38, 36.84], low: [36, 31.96], close: [36.89, close], volume: [1, 25613003] }] },
});

test("after the bell an empty newest close takes the settled quote, so the report prices today", () => {
  const rows = chartRows(astsChart(), { now: new Date("2026-11-11T01:39:00Z") });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { d: "2026-11-10", o: 34.13, h: 36.84, l: 31.96, c: 33.69, v: 25613003 });
  assert.equal(rows[0].c, 36.89);
});

test("mid-session an empty newest close is not a close yet, so that bar is left out", () => {
  const rows = chartRows(astsChart({ rmt: "2026-11-10T17:00:00Z" }), { now: new Date("2026-11-10T17:00:30Z") });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].d, "2026-11-09");
});

test("a newest bar that has its own close keeps it", () => {
  const rows = chartRows(astsChart({ close: 33.7 }), { now: new Date("2026-11-11T01:39:00Z") });
  assert.equal(rows[1].c, 33.7);
});
