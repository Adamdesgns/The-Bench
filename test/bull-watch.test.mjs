// bull-watch.test.mjs — 12-1 leadership rank, the 200-day switch with memory, transitions. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { measure, mom121, nextSwitch, rankAll, tierOf, withClose } from "../scripts/bull-watch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/bull-watch.mjs");

function series(n, f) {
  const out = []; const d0 = Date.UTC(2024, 0, 1);
  for (let i = 0; i < n; i++) out.push({ date: new Date(d0 + i * 864e5).toISOString().slice(0, 10), close: f(i), high: f(i) });
  return out;
}

test("12-1 momentum skips the most recent month", () => {
  const c = Array.from({ length: 300 }, (_, i) => (i < 279 ? 100 : 200));   // the jump is inside the last 21 bars
  assert.equal(mom121(c, 299), 0, "a move in the skipped month does not count");
  const c2 = Array.from({ length: 300 }, (_, i) => 100 + i);
  assert.ok(Math.abs(mom121(c2, 299) - ((378 / 147 - 1) * 100)) < 1e-9);
});

test("rankAll orders by 12-1, tiers the top 3 as LEADER and 4-6 as CONTENDER", () => {
  const mk = (slope) => measure(series(300, (i) => 100 + i * slope));
  const ms = { A: mk(0.5), B: mk(0.4), C: mk(0.3), D: mk(0.2), E: mk(0.1), F: mk(0.05), G: mk(-0.1) };
  const r = rankAll(ms);
  assert.deepEqual(r.map((x) => x.sym), ["A", "B", "C", "D", "E", "F", "G"]);
  assert.deepEqual(r.map((x) => x.tier), ["LEADER", "LEADER", "LEADER", "CONTENDER", "CONTENDER", "CONTENDER", "-"]);
  assert.equal(tierOf(7), "-");
});

test("the 200-day switch has memory: +3% to switch on, -3% to switch off", () => {
  const m = (close, s200 = 100) => ({ close, s200 });
  assert.equal(nextSwitch(undefined, m(102)), "OFF", "+2% is not enough to switch on");
  assert.equal(nextSwitch(undefined, m(104)), "BULL");
  assert.equal(nextSwitch("BULL", m(98)), "BULL", "-2% is not enough to switch off");
  assert.equal(nextSwitch("BULL", m(96)), "OFF");
});

test("withClose appends an official close and drops a later partial bar", () => {
  const out = withClose([{ date: "2026-09-21", close: 10 }, { date: "2026-09-23", close: 11 }], "2026-09-22", 10.5);
  assert.deepEqual(out.map((b) => b.date), ["2026-09-21", "2026-09-22"]);
});

test("CLI: a sector overtaking the leaders is logged as a leadership transition", () => {
  const dir = mkdtempSync(join(tmpdir(), "bw-"));
  const db = join(dir, "db.json"), f1 = join(dir, "b1.json"), f2 = join(dir, "b2.json");
  const base = { A: series(300, (i) => 100 + i * 0.5), B: series(300, (i) => 100 + i * 0.4), C: series(300, (i) => 100 + i * 0.3) };
  writeFileSync(f1, JSON.stringify({ ...base, D: series(300, (i) => 100 + i * 0.1) }));
  writeFileSync(f2, JSON.stringify({ ...base, D: series(300, (i) => 100 + i * 0.9) }));   // D rotates to #1
  const args = ["--symbols", "A,B,C,D", "--write", "--db", db];
  execFileSync(process.execPath, [CLI, "--bars-file", f1, ...args], { encoding: "utf8" });
  assert.equal(JSON.parse(readFileSync(db, "utf8")).states.D.tier, "CONTENDER");
  const out = execFileSync(process.execPath, [CLI, "--bars-file", f2, ...args], { encoding: "utf8" });
  assert.match(out, /D leadership CONTENDER->LEADER/);
  assert.match(out, /C leadership LEADER->CONTENDER/);
  assert.equal(JSON.parse(readFileSync(db, "utf8")).states.D.rank, 1);
});
