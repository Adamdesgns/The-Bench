// mind-changer.test.mjs — written tests fire, hold, expire. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { parseWhen, evaluate, addDays } from "../scripts/mind-changer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/mind-changer.mjs");
const run = (args) => execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("parseWhen reads TICKER op LEVEL and refuses prose", () => {
  assert.deepEqual(parseWhen("META>624.80"), { ticker: "META", op: ">", level: 624.8 });
  assert.deepEqual(parseWhen("pwr >= 650.58"), { ticker: "PWR", op: ">=", level: 650.58 });
  assert.throws(() => parseWhen("META holds the line"), /TICKER>LEVEL/);
});

test("the Muse replay: META closing 654 over 624.80 FIRES", () => {
  const mc = { when: [parseWhen("META>624.80")], expires: "2026-09-16" };
  assert.equal(evaluate(mc, { META: 654 }, "2026-09-09").verdict, "FIRED");
});

test("a compound test fires only when every condition holds", () => {
  const mc = { when: ["PWR>650.58", "GEV>957.27", "QQQ>=747.46"].map(parseWhen), expires: "2026-09-25" };
  assert.equal(evaluate(mc, { PWR: 652, GEV: 960, QQQ: 748 }, "2026-09-23").verdict, "FIRED");
  assert.equal(evaluate(mc, { PWR: 652, GEV: 950, QQQ: 748 }, "2026-09-23").verdict, "HOLDING");
});

test("a missing price is NO PRICE, never a silent pass or fail", () => {
  const mc = { when: [parseWhen("META>624.80")], expires: "2026-09-16" };
  assert.equal(evaluate(mc, {}, "2026-09-09").verdict, "NO PRICE");
});

test("past its expiry a test EXPIRES even if it would fire", () => {
  const mc = { when: [parseWhen("META>624.80")], expires: "2026-09-16" };
  assert.equal(evaluate(mc, { META: 700 }, "2026-09-17").verdict, "EXPIRED");
});

test("CLI: add refuses without meaning/source; add -> check --write marks it fired", () => {
  const db = join(mkdtempSync(join(tmpdir(), "mc-")), "mc.json");
  assert.throws(() => run(["add", "--when", "META>624.80", "--db", db]), /REFUSED|Command failed/);
  const out = run(["add", "--when", "META>624.80", "--meaning", "real repricing", "--source", "docs/reads/2026-09-09-premarket.md", "--row", "B-296", "--date", "2026-09-09", "--db", db]);
  assert.match(out, /LOGGED MC-001/);
  assert.equal(JSON.parse(readFileSync(db, "utf8")).items[0].expires, addDays("2026-09-09", 7));
  const chk = run(["check", "--prices", '{"META":654}', "--date", "2026-09-09", "--write", "--db", db]);
  assert.match(chk, /1 FIRED of 1/);
  const saved = JSON.parse(readFileSync(db, "utf8")).items[0];
  assert.equal(saved.status, "fired");
  assert.equal(saved.fired_on, "2026-09-09");
  assert.match(run(["list", "--db", db]), /none open/);
});
