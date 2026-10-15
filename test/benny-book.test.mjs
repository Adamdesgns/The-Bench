// benny-book.test.mjs — Benny's $10,000 book mirrors Adam's paper book, and takes nothing until risk_pct is set. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mirror, sizeShares } from "../scripts/benny-book.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/benny-book.mjs");
const trade = (id, o = {}) => ({
  id, sym: "TEST", side: "long", lane: "entry-check", source_row: "B-900", entry_date: "2026-10-20", entry: 100, shares: 6,
  stop: 95, t1: 110, t2: 120, stop_after_t1: null, exit_by: "2026-10-30", readiness: 60, grade: "B",
  status: "OPEN", shares_open: 6, t1_done: false, legs: [], realized: 0, r: null, last_scored: null, last_close: null, ...o,
});
const adam = (trades) => ({ account: { start_date: "2026-10-14", start_balance: 3575.98 }, trades, history: [] });
const benny = () => ({ account: { start_date: "2026-10-20", start_balance: 10000 }, trades: [], history: [], skipped: [] });

test("sizing is floor(equity x risk% / |entry - stop|)", () => {
  assert.equal(sizeShares(10000, 1, 100, 95), 20);
  assert.equal(sizeShares(10000, 1.5, 50, 53), 50);
  assert.equal(sizeShares(10000, 1, 900, 700), 0);
});

test("while risk_pct is null nothing is added and today's plans are returned to post unsized", () => {
  const b = benny();
  const r = mirror(adam([trade("PB-010")]), b, { risk_pct: null }, "2026-10-20");
  assert.equal(r.added.length, 0);
  assert.equal(r.waiting.length, 1);
  assert.equal(b.trades.length, 0);
});

test("a new trade is mirrored at Benny's size with the same levels and dates", () => {
  const b = benny();
  const r = mirror(adam([trade("PB-010")]), b, { risk_pct: 1 }, "2026-10-20");
  assert.equal(r.added.length, 1);
  const t = b.trades[0];
  assert.equal(t.mirror_of, "PB-010");
  assert.equal(t.shares, 20);
  assert.deepEqual([t.entry, t.stop, t.t1, t.t2, t.exit_by, t.lane, t.side], [100, 95, 110, 120, "2026-10-30", "entry-check", "long"]);
});

test("a re-run does not mirror the same trade twice", () => {
  const b = benny(), a = adam([trade("PB-010")]);
  mirror(a, b, { risk_pct: 1 }, "2026-10-20");
  const r = mirror(a, b, { risk_pct: 1 }, "2026-10-20");
  assert.equal(r.added.length, 0);
  assert.equal(b.trades.length, 1);
});

test("under one share is skipped, recorded, and not retried", () => {
  const b = benny(), a = adam([trade("PB-011", { entry: 900, stop: 700, t1: 1300, t2: null })]);
  const r = mirror(a, b, { risk_pct: 1 }, "2026-10-20");
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].why, /under one share/);
  assert.equal(mirror(a, b, { risk_pct: 1 }, "2026-10-20").skipped.length, 0);
});

test("trades from before Benny's book opened, and trades Adam's book already scored, are not mirrored", () => {
  const b = benny();
  const r = mirror(adam([trade("PB-001", { entry_date: "2026-10-13" }), trade("PB-012", { sym: "LATE", last_scored: "2026-10-20" })]), b, { risk_pct: 1 }, "2026-10-21");
  assert.equal(r.added.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].why, /already scored/);
});

function cliRoot() {
  const root = mkdtempSync(join(tmpdir(), "benny-book-"));
  mkdirSync(join(root, "db"));
  writeFileSync(join(root, "db/benny-config.json"), JSON.stringify({ mode: "dry", start_balance: 10000, risk_pct: null, daily_answer_cap: 20 }));
  writeFileSync(join(root, "db/paper-book.json"), JSON.stringify(adam([trade("PB-010")])));
  return root;
}
const run = (args) => { try { return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" }) }; } catch (e) { return { code: e.status, out: e.stdout }; } };

test("mirror on the CLI waits while risk_pct is null", () => {
  const root = cliRoot();
  const r = run(["mirror", "--date", "2026-10-20", "--root", root]);
  assert.equal(r.code, 0);
  assert.match(r.out, /WAITING/);
});

test("open sets risk_pct and opens the book once; a second open is refused", () => {
  const root = cliRoot();
  assert.equal(run(["open", "--risk-pct", "1", "--date", "2026-10-20", "--root", root]).code, 0);
  const cfg = JSON.parse(readFileSync(join(root, "db/benny-config.json"), "utf8"));
  assert.equal(cfg.risk_pct, 1);
  const book = JSON.parse(readFileSync(join(root, "db/benny-book.json"), "utf8"));
  assert.deepEqual(book.account, { start_date: "2026-10-20", start_balance: 10000 });
  const again = run(["open", "--risk-pct", "2", "--root", root]);
  assert.equal(again.code, 1);
  assert.match(again.out, /REFUSED/);
});

test("open refuses a risk percent outside 0-10", () => {
  assert.equal(run(["open", "--risk-pct", "25", "--root", cliRoot()]).code, 1);
});
