// quant-evidence.test.mjs — CLI behavior, offline via --bars-file. No network, no writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/quant-evidence.mjs");
const BARS = resolve(HERE, "fixtures/quant-bars.json");

function run(args) {
  try {
    return { out: execFileSync("node", [CLI, ...args], { encoding: "utf8" }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}

test("refuses without --ticker", () => {
  const { code, out } = run(["--setup", "move", "--threshold", "-5", "--horizon", "10"]);
  assert.equal(code, 1);
  assert.match(out, /--ticker/);
});

test("refuses move without --threshold", () => {
  // --dry-run belt-and-braces: if the refusal ever regresses, the test still must not write
  const { code, out } = run(["--ticker", "TEST", "--setup", "move", "--horizon", "10", "--bars-file", BARS, "--dry-run"]);
  assert.equal(code, 1);
  assert.match(out, /--threshold/);
});

test("refuses an unknown setup kind", () => {
  const { code, out } = run(["--ticker", "TEST", "--setup", "vibes", "--horizon", "10", "--bars-file", BARS]);
  assert.equal(code, 1);
  assert.match(out, /setup/i);
});

test("refuses a --row that is not in the book", () => {
  const { code, out } = run([
    "--ticker", "TEST", "--setup", "move", "--threshold", "-5", "--horizon", "10",
    "--bars-file", BARS, "--row", "B-99999", "--dry-run"
  ]);
  assert.equal(code, 1);
  assert.match(out, /B-99999/);
});

test("dry-run computes events, stats and a grade from a bars file, writes nothing", () => {
  const { code, out } = run([
    "--ticker", "TEST", "--setup", "move", "--threshold", "-5", "--window", "5",
    "--horizon", "10", "--bars-file", BARS, "--dry-run"
  ]);
  assert.equal(code, 0);
  assert.match(out, /EVENTS\s+3 raw/);
  assert.match(out, /GRADE\s+[A-F]/);
  assert.match(out, /dry-run/i);
  assert.doesNotMatch(out, /QR-\d+ logged/);
});

test("zero events is a graded F, not an error", () => {
  const { code, out } = run([
    "--ticker", "TEST", "--setup", "move", "--threshold", "-90", "--window", "5",
    "--horizon", "10", "--bars-file", BARS, "--dry-run"
  ]);
  assert.equal(code, 0);
  assert.match(out, /GRADE\s+F/);
});
