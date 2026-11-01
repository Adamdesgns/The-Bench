// receipt-guard.test.mjs — only the routine owns a hunt receipt's canonical name. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { writeReceipt, nyDay, sidecarPath } from "../scripts/receipt-guard.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "receipt-guard-"));
const FRI = "2026-10-30T20:25:00.000Z"; // 15:25 CT Friday
const rec = (o) => ({ kind: "options-hunter-candidates", universe: "all", generated: FRI, id: "aaaa1111", ...o });
const routineRec = (o) => rec({ routine: true, ...o });
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

test("nyDay reads the New York calendar day, not UTC", () => {
  assert.equal(nyDay("2026-10-31T02:30:00.000Z"), "2026-10-30"); // Friday 22:30 ET
  assert.equal(nyDay("2026-10-31T14:00:00.000Z"), "2026-10-31");
});

test("the routine takes a free canonical name", () => {
  const p = join(dir(), "2026-10-30.candidates.json");
  const w = writeReceipt(p, routineRec(), { routine: true });
  assert.deepEqual([w.wrote, w.diverted, w.refused], [p, null, false]);
});

test("a routine retry the same New York day replaces its own receipt", () => {
  const p = join(dir(), "2026-10-30.candidates.json");
  writeFileSync(p, JSON.stringify(routineRec()));
  const w = writeReceipt(p, routineRec({ id: "bbbb2222", generated: "2026-10-30T21:10:00.000Z" }), { routine: true });
  assert.equal(w.wrote, p);
  assert.equal(read(p).id, "bbbb2222");
});

test("B-1208 / B-1177: a run without --routine never takes the canonical name, free or not", () => {
  const d = dir(), p = join(d, "2026-10-30.candidates.json");
  const w = writeReceipt(p, rec({ universe: "named", id: "cccc3333" }), {});
  assert.equal(w.wrote, join(d, "2026-10-30.candidates.cccc3333.json"));
  assert.equal(existsSync(p), false, "the name stays free for the routine");
  writeFileSync(p, JSON.stringify(routineRec()));
  writeReceipt(p, rec({ id: "dddd4444", generated: "2026-11-01T03:50:00.000Z" }), {});
  assert.equal(read(p).id, "aaaa1111", "Friday's routine file is untouched");
});

test("review #1: an 11am --universe board run cannot take the name the 15:25 routine needs", () => {
  const p = join(dir(), "2026-10-30.candidates.json");
  writeReceipt(p, rec({ universe: "board", generated: "2026-10-30T16:00:00.000Z", id: "eeee5555" }), {});
  const w = writeReceipt(p, routineRec(), { routine: true });
  assert.equal(w.wrote, p);
  assert.equal(read(p).universe, "all");
});

test("review #2/#3: a same-evening re-run with another band never replaces the routine's file", () => {
  const p = join(dir(), "2026-10-30.ranked.json");
  writeFileSync(p, JSON.stringify(routineRec({ kind: "options-hunter-rank", band: 357 })));
  writeReceipt(p, rec({ kind: "options-hunter-rank", band: 500, generated: "2026-10-30T23:00:00.000Z", id: "ffff6666" }), {});
  assert.equal(read(p).band, 357);
});

test("a routine run that finds yesterday's receipt (market holiday) refuses and goes beside it", () => {
  const p = join(dir(), "2026-10-30.candidates.json");
  writeFileSync(p, JSON.stringify(routineRec()));
  const w = writeReceipt(p, routineRec({ id: "a1b2c3d4", generated: "2026-11-02T20:25:00.000Z" }), { routine: true });
  assert.equal(w.refused, true);
  assert.equal(w.wrote, sidecarPath(p, "a1b2c3d4"));
  assert.equal(read(p).id, "aaaa1111");
});

test("a routine run refuses a same-day file it did not write, or an unreadable one", () => {
  const p = join(dir(), "2026-10-30.candidates.json");
  writeFileSync(p, JSON.stringify(rec())); // same day, no routine mark
  assert.equal(writeReceipt(p, routineRec({ id: "11112222" }), { routine: true }).refused, true);
  writeFileSync(p, "{not json");
  const w = writeReceipt(p, routineRec({ id: "33334444" }), { routine: true });
  assert.equal(w.refused, true);
  assert.equal(readFileSync(p, "utf8"), "{not json");
});

test("--overwrite replaces on purpose", () => {
  const p = join(dir(), "2026-10-30.candidates.json");
  writeFileSync(p, JSON.stringify(routineRec()));
  writeReceipt(p, rec({ id: "55556666", generated: "2026-11-01T03:50:00.000Z" }), { overwrite: true });
  assert.equal(read(p).id, "55556666");
});

test("a side rank never ends in .ranked.json, so band-blocked.mjs does not read it", () => {
  const d = dir(), p = join(d, "2026-10-30.ranked.json");
  writeFileSync(p, JSON.stringify(routineRec({ kind: "options-hunter-rank" })));
  writeReceipt(p, rec({ kind: "options-hunter-rank", id: "r9r9r9r9" }), {});
  assert.deepEqual(readdirSync(d).filter((f) => f.endsWith(".ranked.json")), ["2026-10-30.ranked.json"]);
});

test("options-hunter rank mode: --routine exits 3 when the name holds another day's routine receipt", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const CLI = resolve(HERE, "../scripts/options-hunter.mjs");
  const d = dir();
  const cand = join(d, "cand.json"), marks = join(d, "marks.json");
  // asof 1999 so this never meets a real receipt; the script writes under db/hunts/options, so every
  // file this test makes there is removed in finally
  writeFileSync(cand, JSON.stringify({ asof: "1999-01-04", id: "c0ffee00", universe: "all", opts: { horizon: 10 }, candidates: [] }));
  writeFileSync(marks, "{}");
  const opts = resolve(HERE, "../db/hunts/options");
  const real = join(opts, "1999-01-04.ranked.json");
  const made = () => readdirSync(opts).filter((f) => f.startsWith("1999-01-04."));
  for (const f of made()) rmSync(join(opts, f)); // only this test makes 1999 files; a killed run may leave one
  try {
    writeFileSync(real, JSON.stringify(routineRec({ kind: "options-hunter-rank", generated: "1999-01-04T20:25:00.000Z", id: "seed0000" })));
    let code = 0, out = "";
    try {
      out = execFileSync(process.execPath, [CLI, "--ev-file", marks, "--candidates", cand, "--write", "--routine"], { encoding: "utf8" });
    } catch (e) { code = e.status; out = e.stdout; }
    assert.equal(code, 3);
    assert.match(out, /REFUSED: --routine could not take/);
    assert.equal(read(real).id, "seed0000", "the seeded routine file is untouched");
    assert.equal(made().length, 2, "the run went to one side file");
  } finally {
    for (const f of made()) rmSync(join(opts, f));
  }
});
