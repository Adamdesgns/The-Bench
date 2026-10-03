// rs.test.mjs — relative strength, offline via --bars-file. No network, no writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { pctChange, relTable, verdict } from "../scripts/rs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/rs.mjs");

function run(args) {
  try {
    return { out: execFileSync("node", [CLI, ...args], { encoding: "utf8" }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}

const closes = (fn, n = 80) => Array.from({ length: n }, (_, i) => fn(i));
const series = (fn, n = 80) => closes(fn, n).map((close, i) => ({ date: `D${i}`, close }));

test("pctChange over n sessions", () => {
  assert.equal(pctChange([100, 110, 121], 1), 10);
  assert.equal(pctChange([100, 110, 121], 2), 21);
  assert.equal(pctChange([100], 1), null);
});

test("a name rising while SPY is flat is a LEADER on every leg", () => {
  const rows = relTable(closes((i) => 100 + i), { SPY: closes(() => 100), QQQ: closes(() => 100) });
  for (const r of rows) assert.ok(r.vs_SPY > 0, `${r.horizon} should outperform`);
  assert.equal(verdict(rows, "SPY"), "LEADER");
});

test("a name falling while SPY rises is a LAGGARD", () => {
  const rows = relTable(closes((i) => 200 - i), { SPY: closes((i) => 100 + i * 0.2), QQQ: closes(() => 100) });
  assert.equal(verdict(rows, "SPY"), "LAGGARD");
});

test("outperforming over 20 but not 60 is EMERGING", () => {
  // down for 60 sessions (200 -> 141), then up the last 20 (141 -> 160): ahead over
  // 20 sessions, still behind where it was 60 sessions ago
  const t = closes((i) => (i < 60 ? 200 - i : 140 + (i - 59) * 1));
  const rows = relTable(t, { SPY: closes(() => 100), QQQ: closes(() => 100) });
  assert.match(verdict(rows, "SPY"), /^EMERGING/);
});

test("insufficient history is stated, not faked", () => {
  const rows = relTable(closes(() => 100, 10), { SPY: closes(() => 100, 10), QQQ: closes(() => 100, 10) });
  assert.equal(rows.find((r) => r.horizon === "60D").ticker, null);
  assert.equal(verdict(rows, "SPY"), "INSUFFICIENT HISTORY");
});

test("CLI refuses without --ticker", () => {
  const { code, out } = run([]);
  assert.equal(code, 1);
  assert.match(out, /--ticker/);
});

test("CLI reads --bars-file and prints the table and verdicts", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-"));
  const f = join(dir, "bars.json");
  writeFileSync(
    f,
    JSON.stringify({ XYZ: series((i) => 100 + i), SPY: series(() => 100), QQQ: series(() => 100), SECTOR: series((i) => 100 + i * 0.5) })
  );
  const { code, out } = run(["--ticker", "XYZ", "--sector", "SOXX", "--bars-file", f, "--json"]);
  assert.equal(code, 0, out);
  const j = JSON.parse(out);
  assert.equal(j.ticker, "XYZ");
  assert.equal(j.verdict_vs_spy, "LEADER");
  assert.equal(j.verdict_vs_sector, "LEADER");
  assert.equal(j.rows.length, 4);
});
