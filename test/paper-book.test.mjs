// paper-book.test.mjs — the paper account takes every desk ticket and scores it like real money. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { step, summarize } from "../scripts/paper-book.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/paper-book.mjs");
const run = (args) => { try { return execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" }); } catch (e) { return e.stdout; } };

// 6 shares long at 100, stop 95 (risk 30), sell half at 110, the rest at 120, out by the 10/20 close.
const base = {
  id: "PB-001", sym: "TEST", side: "long", lane: "entry-check", entry_date: "2026-10-14", entry: 100, shares: 6,
  stop: 95, t1: 110, t2: 120, stop_after_t1: null, exit_by: "2026-10-20",
  status: "OPEN", shares_open: 6, t1_done: false, legs: [], realized: 0, r: null, last_scored: null, last_close: null,
};

test("a day that touches both the stop and the target scores as the stop", () => {
  const t = step(base, { open: 101, high: 111, low: 94, close: 105 }, "2026-10-15");
  assert.equal(t.status, "CLOSED");
  assert.equal(t.exit_reason, "STOPPED");
  assert.equal(t.realized, -30);
  assert.equal(t.r, -1);
});

test("a later day that opens under the stop exits at the open", () => {
  const t = step(base, { open: 93, high: 96, low: 92, close: 95.5 }, "2026-10-15");
  assert.equal(t.legs[0].price, 93);
  assert.equal(t.realized, -42);
  assert.equal(t.r, -1.4);
});

test("the entry day ignores the open (we bought after it) but still counts the low", () => {
  const quiet = step(base, { open: 90, high: 102, low: 98, close: 101 }, "2026-10-14");
  assert.equal(quiet.status, "OPEN");
  assert.equal(quiet.last_close, 101);
  const hit = step(base, { open: 99, high: 102, low: 94.5, close: 101 }, "2026-10-14");
  assert.equal(hit.exit_reason, "STOPPED");
  assert.equal(hit.legs[0].price, 95);
});

test("the first target sells half (rounded up) and the rest rides to the second target", () => {
  let t = step(base, { open: 101, high: 110.5, low: 100, close: 109 }, "2026-10-15");
  assert.equal(t.status, "OPEN");
  assert.equal(t.t1_done, true);
  assert.equal(t.shares_open, 3);
  assert.equal(t.realized, 30);
  t = step(t, { open: 109, high: 121, low: 108, close: 119 }, "2026-10-16");
  assert.equal(t.status, "CLOSED");
  assert.equal(t.exit_reason, "TARGET");
  assert.equal(t.realized, 90);
  assert.equal(t.r, 3);
});

test("with one share, the first target sells it", () => {
  const t = step({ ...base, shares: 1, shares_open: 1 }, { open: 101, high: 111, low: 100, close: 110 }, "2026-10-15");
  assert.equal(t.status, "CLOSED");
  assert.equal(t.realized, 10);
});

test("with no second target, the first target sells everything", () => {
  const t = step({ ...base, t2: null }, { open: 101, high: 111, low: 100, close: 110 }, "2026-10-15");
  assert.equal(t.status, "CLOSED");
  assert.equal(t.realized, 60);
  assert.equal(t.r, 2);
});

test("a raised stop after the first target applies from the next day", () => {
  let t = step({ ...base, stop_after_t1: 104 }, { open: 101, high: 110.5, low: 100, close: 109 }, "2026-10-15");
  t = step(t, { open: 108, high: 109, low: 103, close: 104.5 }, "2026-10-16");
  assert.equal(t.exit_reason, "STOPPED");
  assert.equal(t.legs[1].price, 104);
  assert.equal(t.realized, 42);
});

test("the exit date sells what is left at that close", () => {
  let t = base;
  for (const d of ["2026-10-15", "2026-10-16", "2026-10-19"]) t = step(t, { open: 101, high: 103, low: 99, close: 102 }, d);
  assert.equal(t.status, "OPEN");
  t = step(t, { open: 102, high: 104, low: 101, close: 103 }, "2026-10-20");
  assert.equal(t.exit_reason, "EXIT-BY");
  assert.equal(t.realized, 18);
  assert.equal(t.r, 0.6);
});

test("the same date is never scored twice, and dates before entry are ignored", () => {
  const once = step(base, { open: 101, high: 103, low: 99, close: 102 }, "2026-10-15");
  assert.equal(step(once, { open: 80, high: 81, low: 79, close: 80 }, "2026-10-15"), once);
  assert.equal(step(base, { open: 80, high: 81, low: 79, close: 80 }, "2026-10-13"), base);
});

test("a short is the mirror image: a high over the stop stops it, a low under the target books it", () => {
  const s = { ...base, side: "short", stop: 105, t1: 90, t2: null };
  const stopped = step(s, { open: 101, high: 106, low: 98, close: 104 }, "2026-10-15");
  assert.equal(stopped.legs[0].price, 105);
  assert.equal(stopped.realized, -30);
  const won = step(s, { open: 99, high: 100, low: 89, close: 91 }, "2026-10-15");
  assert.equal(won.realized, 60);
  assert.equal(won.r, 2);
});

test("the account is the start balance plus realized plus open profit, split by lane", () => {
  const closed = { ...base, status: "CLOSED", shares_open: 0, realized: -30, r: -1 };
  const open = { ...base, id: "PB-002", lane: "dated-catalyst", realized: 0, last_close: 104 };
  const s = summarize({ account: { start_balance: 1000 }, trades: [closed, open] });
  assert.equal(s.realized, -30);
  assert.equal(s.unrealized, 24);
  assert.equal(s.equity, 994);
  assert.equal(s.closed, 1);
  assert.equal(s.open, 1);
  assert.equal(s.by_lane["entry-check"].sum_r, -1);
  assert.equal(s.by_lane["dated-catalyst"].open, 1);
});

test("CLI: init, add with its refusals, score with history, manual close", () => {
  const db = join(mkdtempSync(join(tmpdir(), "pb-")), "book.json");
  assert.match(run(["add", "--sym", "X", "--row", "B-1", "--entry", "100", "--shares", "6", "--stop", "95", "--exit-by", "2026-10-20", "--db", db]), /REFUSED.*init/);
  assert.match(run(["init", "--balance", "1000", "--date", "2026-10-14", "--db", db]), /PAPER BOOK OPENED/);
  assert.match(run(["init", "--balance", "1000", "--db", db]), /REFUSED/);
  const add = ["add", "--sym", "X", "--row", "B-1", "--entry", "100", "--shares", "6", "--stop", "95", "--t1", "110", "--date", "2026-10-14", "--db", db];
  assert.match(run(add), /REFUSED.*--exit-by/);
  assert.match(run(["add", "--sym", "X", "--row", "B-1", "--entry", "100", "--shares", "6", "--stop", "101", "--exit-by", "2026-10-20", "--db", db]), /REFUSED.*stop/);
  assert.match(run(["add", "--sym", "X", "--row", "B-1", "--entry", "100", "--shares", "6", "--stop", "95", "--t1", "99", "--exit-by", "2026-10-20", "--db", db]), /REFUSED.*target/);
  assert.match(run([...add, "--exit-by", "2026-10-20"]), /PB-001/);
  assert.match(run([...add, "--exit-by", "2026-10-20"]), /REFUSED.*already open/);
  assert.match(run(["score", "--bars", '{"x":{"open":101,"high":103,"low":99,"close":102}}', "--date", "2026-10-15", "--write", "--db", db]), /equity 1012/);
  const book = JSON.parse(readFileSync(db, "utf8"));
  assert.equal(book.history.at(-1).date, "2026-10-15");
  assert.equal(book.history.at(-1).equity, 1012);
  assert.match(run(["close", "--id", "PB-001", "--price", "104", "--date", "2026-10-16", "--db", db]), /CLOSED.*\+24/);
  assert.match(run(["report", "--db", db]), /1 closed/);
});

test("CLI: a trade carried in from before the book opened is scored, but no balance is recorded before the start date", () => {
  const db = join(mkdtempSync(join(tmpdir(), "pb-")), "book.json");
  run(["init", "--balance", "1000", "--date", "2026-10-14", "--db", db]);
  assert.match(run(["add", "--sym", "M", "--row", "B-2", "--entry", "100", "--shares", "10", "--stop", "90", "--t1", "130", "--exit-by", "2026-10-23", "--date", "2026-10-13", "--lane", "dated-catalyst", "--db", db]), /PB-001/);
  run(["score", "--bars", '{"M":{"open":98,"high":104,"low":97,"close":103}}', "--date", "2026-10-13", "--write", "--db", db]);
  const book = JSON.parse(readFileSync(db, "utf8"));
  assert.equal(book.trades[0].last_close, 103);
  assert.equal(book.history.length, 0);
});

test("CLI: the score line says what the account made or lost since the last recorded day", () => {
  const db = join(mkdtempSync(join(tmpdir(), "pb-")), "book.json");
  run(["init", "--balance", "1000", "--date", "2026-10-14", "--db", db]);
  run(["add", "--sym", "M", "--row", "B-3", "--entry", "100", "--shares", "10", "--stop", "90", "--exit-by", "2026-10-23", "--date", "2026-10-14", "--db", db]);
  assert.match(run(["score", "--bars", '{"M":{"open":100,"high":104,"low":99,"close":103}}', "--date", "2026-10-14", "--write", "--db", db]), /today \+30\.00/);
  assert.match(run(["score", "--bars", '{"M":{"open":103,"high":103,"low":100,"close":101}}', "--date", "2026-10-15", "--write", "--db", db]), /today -20\.00/);
});
