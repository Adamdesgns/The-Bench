// paper-quant.test.mjs — the quant-exit twin lane: same entry as the paper trade, but the exit is
// decided every close by the hunter's own measurements and a trailing stop. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { replay, makeTwin, shapeOf } from "../scripts/paper-quant.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/paper-quant.mjs");
const run = (args) => { try { return execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" }); } catch (e) { return e.stdout + e.stderr; } };

// Weekday dates starting 2026-07-01.
function dates(n, from = "2026-07-01") {
  const out = [], d = new Date(`${from}T12:00:00Z`);
  while (out.length < n) { if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
// A bar series from a list of closes: open = prior close, high/low = close +/- 1.
const series = (closes, ds) => closes.map((c, i) => ({ date: ds[i], open: i ? closes[i - 1] : c, high: c + 1, low: c - 1, close: c, volume: 1000 }));

// 70 sessions falling 0.5 a day from 100 (a clean downtrend), SPY flat at 500.
const DS = dates(90);
const down = Array.from({ length: 70 }, (_, i) => 100 - i * 0.5);    // last = 65.5 on DS[69]
const spy = series(Array(90).fill(500), DS);
const ENTRY_DATE = DS[69];

const shortTwin = (over = {}) => ({
  id: "PQ-001", of: "PB-001", sym: "TEST", side: "short", lane: "quant-exit", source_lane: "hunter-short", source_row: "B-1",
  entry_date: ENTRY_DATE, entry: 65.5, shares: 10, stop0: 70, hard_exit: DS[89], hard_exit_why: "time",
  status: "OPEN", ...over,
});

test("shape: a clean downtrend holds for a short and fails for a long", () => {
  const bars = series(down, DS);
  const s = shapeOf(bars, spy.slice(0, 70), "short");
  assert.equal(s.holds, true);
  assert.ok(s.close < s.sma20 && s.sma20 < s.sma50 && s.rs20 < 0);
  assert.equal(shapeOf(bars, spy.slice(0, 70), "long").holds, false);
});

test("short: the trailing stop only ratchets down and exits at the stop price when touched", () => {
  // keeps falling 1 a day for 5 sessions, then rips +6 in one day
  const after = [64.5, 63.5, 62.5, 61.5, 60.5, 66.5];
  const bars = series([...down, ...after], DS);
  const t = replay(shortTwin(), bars, spy);
  assert.equal(t.status, "CLOSED");
  assert.equal(t.exit_reason, "STOP");
  // trail after the 60.5 close: max(60.5 + ATR, 2-session high 62.5)
  assert.ok(t.exit_price < 70 && t.exit_price > 60.5, `trailed below the 70 entry stop, got ${t.exit_price}`);
  assert.equal(t.exit_date, DS[75]);
  assert.ok(t.r > 0, "a trailed stop below the entry locks a gain");
  assert.equal(t.best_close, 60.5);
});

test("short: shape break with a stop out of reach exits at the close and says which leg failed", () => {
  const ds = DS, base = series(down, ds);
  // one session: closes far above the 20-day but the high stays under the trailing stop (opened low, wide stop)
  const bars = [...base, { date: ds[70], open: 64, high: 64.2, low: 63, close: 64, volume: 1 }];
  // force the shape to fail by making SPY drop hard so rs20 >= 0 on the last bar
  const spyFall = spy.map((b, i) => (i === 70 ? { ...b, close: 300 } : b));
  const t = replay(shortTwin({ stop0: 200 }), bars, spyFall);
  assert.equal(t.exit_reason, "SHAPE-BROKE");
  assert.equal(t.exit_price, 64);
  assert.match(t.exit_why, /SPY/);
});

test("short: a gap open through the trailing stop exits at the open, not the stop", () => {
  const bars = series([...down, 64.5], DS);
  bars.push({ date: DS[71], open: 80, high: 81, low: 79, close: 80, volume: 1 });
  const t = replay(shortTwin(), bars, spy);
  assert.equal(t.exit_reason, "STOP-GAP");
  assert.equal(t.exit_price, 80);
  assert.ok(t.r < -1, "a gap past the stop costs more than 1R");
});

test("hard exit: out at the close of the hard-exit session while the shape still holds", () => {
  const bars = series([...down, 65, 64.5, 64], DS);
  const t = replay(shortTwin({ hard_exit: DS[71], hard_exit_why: "earnings 2026-10-13" }), bars, spy);
  assert.equal(t.exit_reason, "HARD-EXIT");
  assert.equal(t.exit_date, DS[71]);
  assert.equal(t.exit_price, 64.5);
  assert.match(t.exit_why, /earnings/);
});

test("a trade that did not have the shape at entry cannot lose it: only the stop and hard exit apply", () => {
  // uptrend history, short entered anyway (like a desk pullback buy on the wrong side of the 20-day)
  const up = Array.from({ length: 70 }, (_, i) => 50 + i * 0.5);    // last 84.5
  const bars = series([...up, 84, 83.5], DS);
  const t = replay(shortTwin({ entry: 84.5, stop0: 90, hard_exit: DS[71] }), bars, spy);
  assert.equal(t.shape_seen, false);
  assert.equal(t.exit_reason, "HARD-EXIT");
});

test("long: mirror image - trail ratchets up, a drop through it exits", () => {
  const up = Array.from({ length: 70 }, (_, i) => 50 + i * 0.5);    // last 84.5
  const bars = series([...up, 85.5, 86.5, 87.5, 81], DS);
  const t = replay({ ...shortTwin(), side: "long", entry: 84.5, stop0: 80 }, bars, spy);
  assert.equal(t.exit_reason, "STOP");
  assert.ok(t.exit_price > 80, `trail moved up from 80, got ${t.exit_price}`);
  assert.equal(t.best_close, 87.5);
});

test("replay is a pure function of the bars: running it twice gives the same twin", () => {
  const bars = series([...down, 64.5, 63.5], DS);
  assert.deepEqual(replay(shortTwin(), bars, spy), replay(shortTwin(), bars, spy));
});

test("makeTwin: hard exit = later of the trade's exit date and 20 sessions, cut to the session before earnings", () => {
  const pb = { id: "PB-003", sym: "ASTS", side: "short", lane: "hunter-short", source_row: "B-895", entry_date: "2026-10-14", entry: 41.8, shares: 58, stop: 47.75, exit_by: "2026-10-28", kind: undefined };
  const a = makeTwin(pb, { earnings: "2026-11-09" });
  assert.equal(a.id, "PQ-003");
  assert.equal(a.stop0, 47.75);
  assert.equal(a.hard_exit, "2026-11-06");               // Fri before the Mon 11/09 print (20 sessions = 11/11)
  assert.match(a.hard_exit_why, /earnings 2026-11-09/);
  const b = makeTwin(pb, { earnings: "2027-01-06" });
  assert.equal(b.hard_exit, "2026-11-11");               // 20 sessions out
  const c = makeTwin(pb, { earnings: null });
  assert.equal(c.hard_exit, "2026-10-28");               // unknown earnings: never longer than the trade itself
  assert.match(c.hard_exit_why, /EARNINGS UNKNOWN/);
  const d = makeTwin({ ...pb, lane: "dated-catalyst", exit_by: "2026-10-23" }, { earnings: "2026-11-06" });
  assert.equal(d.hard_exit, "2026-10-23");               // a dated-catalyst trade must be out before its event
  assert.match(d.hard_exit_why, /event/);
});

test("CLI: sync twins every share trade once, score offline, report the pair", () => {
  const dir = mkdtempSync(join(tmpdir(), "pq-"));
  const paper = join(dir, "paper.json"), db = join(dir, "quant.json"), barsFile = join(dir, "bars.json");
  writeFileSync(paper, JSON.stringify({ account: { start_date: ENTRY_DATE, start_balance: 1000 }, trades: [
    { id: "PB-001", sym: "TEST", side: "short", lane: "hunter-short", source_row: "B-1", entry_date: ENTRY_DATE, entry: 65.5, shares: 10, stop: 70, t1: 50, t2: null, exit_by: DS[75], status: "OPEN", shares_open: 10, legs: [], realized: 0, r: null, last_close: 64.5 },
    { id: "PB-002", sym: "OPT", kind: "option", side: "long", lane: "x", entry_date: ENTRY_DATE, exit_by: DS[75], status: "OPEN" },
  ] }));
  writeFileSync(barsFile, JSON.stringify({ SPY: spy.slice(0, 72), TEST: series([...down, 64.5, 63.5], DS) }));
  const s1 = run(["sync", "--paper", paper, "--db", db, "--earnings", '{"TEST":"2027-01-01"}', "--write"]);
  assert.match(s1, /ADDED\s+PQ-001/);
  assert.doesNotMatch(s1, /OPT/);
  assert.match(run(["sync", "--paper", paper, "--db", db, "--write"]), /0 added/);
  const sc = run(["score", "--paper", paper, "--db", db, "--bars-file", barsFile, "--write"]);
  assert.match(sc, /PQ-001 TEST/);
  const q = JSON.parse(readFileSync(db, "utf8"));
  assert.equal(q.twins[0].status, "OPEN");
  assert.equal(q.twins[0].last_scored, DS[71]);
  const rep = run(["report", "--paper", paper, "--db", db]);
  assert.match(rep, /PB-001/);
  assert.match(rep, /fixed/i);
});
