import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const PT = join(ROOT, "scripts/position-target.mjs");
const TW = join(ROOT, "scripts/tripwire.mjs");
const tmp = () => join(mkdtempSync(join(tmpdir(), "pt-")), "targets.json");

test("add writes a target, add again replaces it, remove deletes it", () => {
  const db = tmp();
  execFileSync("node", [PT, "add", "--ticker", "zzzt", "--target", "50.5", "--row", "B-001", "--qty", "3", "--db", db]);
  execFileSync("node", [PT, "add", "--ticker", "ZZZT", "--target", "55", "--row", "B-002", "--db", db]);
  const t = JSON.parse(readFileSync(db, "utf8")).targets;
  assert.equal(t.length, 1);
  assert.equal(t[0].sym, "ZZZT");
  assert.equal(t[0].target, 55);
  assert.equal(t[0].row, "B-002");
  execFileSync("node", [PT, "remove", "--ticker", "ZZZT", "--db", db]);
  assert.equal(JSON.parse(readFileSync(db, "utf8")).targets.length, 0);
});

test("add refuses a target with no book row", () => {
  const r = spawnSync("node", [PT, "add", "--ticker", "ZZZT", "--target", "50", "--db", tmp()], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--row/);
});

test("tripwire --list watches a position target as TARGET >=", () => {
  const db = tmp();
  execFileSync("node", [PT, "add", "--ticker", "ZZZT", "--target", "123.45", "--row", "B-003", "--db", db]);
  const out = execFileSync("node", [TW, "--list", "--targets", db], { encoding: "utf8" });
  assert.match(out, /ZZZT\s+TARGET\s+>=\s+123\.45\s+\(B-003\)/);
});
