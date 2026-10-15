// benny-wall.test.mjs — THE WALL: nothing from Adam's real accounts reaches Discord. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { checkWall, numbersIn } from "../scripts/benny-wall.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/benny-wall.mjs");
const SIGN = "Paper trades only. Not financial advice. Educational only.";
const NOW = new Date("2026-10-16T20:00:00Z");
const WALL = { asof: "2026-10-16T13:00:00Z", amounts: [3512.31, 42.17], holdings: [{ sym: "GOOGL", shares: 8, cost: 336.25 }] };
const refused = (text) => checkWall(text, WALL, NOW).ok === false;

test("a clean lesson passes", () => {
  const r = checkWall(`A stop-loss is the price where you sell to cap the loss. GOOGL closed at 251.40; the board's stop is 240.\n\n${SIGN}`, WALL, NOW);
  assert.deepEqual(r, { ok: true, reasons: [] });
});

test("every account identifier is refused", () => {
  for (const x of ["account ••6137", "the 7724 account", "the Agentic account", "the UTMA", "a custodial account", "buying power", "the margin account"])
    assert.ok(refused(`Note: ${x} line.`), x);
});

test("the real balance is refused in four formats", () => {
  for (const x of ["3,512.31", "3512", "$3.5K", "$3,500"]) assert.ok(refused(`Equity was ${x} today.`), x);
});

test("an amount under 100 matches only its exact two-decimal form", () => {
  assert.ok(refused("It costs 42.17 now."));
  assert.ok(!refused("Down 42 points."));
});

test("a real holding's share count next to its ticker is refused, the ticker alone is not", () => {
  for (const x of ["8 GOOGL", "8 shares of GOOGL", "8 googl shares"]) assert.ok(refused(`We have ${x}.`), x);
  assert.ok(!refused("GOOGL is on the board."));
  assert.ok(!refused("18 GOOGL calls traded."));
});

test("a real holding's cost basis is refused", () => {
  assert.ok(refused("Bought near 336.25."));
});

test("possessive account phrases about Adam are refused", () => {
  for (const x of ["Adam's account", "Adam holds", "Adam bought", "my operator's position"]) assert.ok(refused(`${x} is up.`), x);
});

test("a missing or stale wall file refuses everything", () => {
  assert.equal(checkWall("Fine text.", null, NOW).ok, false);
  assert.equal(checkWall("Fine text.", WALL, new Date("2026-10-21T13:00:01Z")).ok, false);
  assert.equal(checkWall("Fine text.", WALL, new Date("2026-10-20T12:00:00Z")).ok, true);
});

test("refusal reasons never carry the real value", () => {
  const r = checkWall("Equity 3,512.31, cost 336.25, 8 GOOGL.", WALL, NOW);
  const all = r.reasons.join(" ");
  for (const v of ["3512", "3,512", "336.25", "42.17"]) assert.ok(!all.includes(v), v);
});

test("numbersIn reads commas, dollars and K", () => {
  assert.deepEqual(numbersIn("$3.5K and 3,512.31 and 7").map((n) => n.value), [3500, 3512.31, 7]);
});

test("write stores the wall outside the repo and prints no amounts", () => {
  const home = mkdtempSync(join(tmpdir(), "benny-home-"));
  const out = execFileSync(process.execPath, [CLI, "write", "--amounts", "3512.31,42.17", "--holdings", '[{"sym":"googl","shares":8,"cost":336.25}]'],
    { encoding: "utf8", env: { ...process.env, BENNY_HOME: home } });
  assert.ok(!out.includes("3512"));
  const w = JSON.parse(readFileSync(join(home, "wall.json"), "utf8"));
  assert.deepEqual(w.amounts, [3512.31, 42.17]);
  assert.equal(w.holdings[0].sym, "GOOGL");
  assert.ok(!Number.isNaN(Date.parse(w.asof)));
});
