import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// prepump-collect.test.mjs — offline, zero-dep. node --test test/prepump-collect.test.mjs
//
// buildUniverse is the one place the capture decides who gets collected and
// how each row is tagged. The tag is what keeps the core denominator honest,
// so these tests pin the tag shapes existing rows already carry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUniverse, readDeskSymbols } from "../scripts/prepump-collect.mjs";

const bySym = (u) => Object.fromEntries(u.symbols.map((s) => [s.symbol, s]));

// The algorithm as it stood before the desk lane, kept here as the oracle.
function legacy(core, scanSyms, scanOf) {
  const all = [...new Set([...core, ...scanSyms])].sort();
  const coreSet = new Set(core);
  return all.map((s) => ({
    symbol: s,
    source: [coreSet.has(s) ? "core" : null, scanSyms.has(s) ? "scan" : null].filter(Boolean),
    scan_ids: scanOf[s] ?? [],
  }));
}

test("with no desk names the output is identical to the pre-desk algorithm", () => {
  const core = ["AAPL", "MSFT", "NVDA"];
  const scanSyms = new Set(["NVDA", "IREN"]);
  const scanOf = { NVDA: ["64b67fb5"], IREN: ["c6ec0ad7"] };
  const u = buildUniverse({ core, scanSyms, scanOf, deskSyms: new Set() });
  assert.deepEqual(u.symbols, legacy(core, scanSyms, scanOf));
});

test("a core-only name keeps the exact source shape existing rows carry", () => {
  const u = buildUniverse({ core: ["AAPL"], scanSyms: new Set(), scanOf: {}, deskSyms: new Set() });
  assert.deepEqual(bySym(u).AAPL.source, ["core"]);
});

test("a desk-only name is tagged desk and nothing else", () => {
  const u = buildUniverse({ core: ["AAPL"], scanSyms: new Set(), scanOf: {}, deskSyms: new Set(["HPE"]) });
  assert.deepEqual(bySym(u).HPE.source, ["desk"]);
});

test("a name in all three lanes is tagged in core, scan, desk order", () => {
  const u = buildUniverse({ core: ["NVDA"], scanSyms: new Set(["NVDA"]), scanOf: {}, deskSyms: new Set(["NVDA"]) });
  assert.deepEqual(bySym(u).NVDA.source, ["core", "scan", "desk"]);
});

test("total counts each symbol once; core count is never inflated by desk names", () => {
  const u = buildUniverse({
    core: ["AAPL", "NVDA"],
    scanSyms: new Set(["NVDA"]),
    scanOf: {},
    deskSyms: new Set(["NVDA", "HPE", "ANET"]),
  });
  assert.equal(u.counts.total, 4);
  assert.equal(u.counts.core, 2);
  assert.equal(u.counts.desk, 3);
  assert.deepEqual(u.all, ["AAPL", "ANET", "HPE", "NVDA"]);
});

test("deskSyms defaults to empty so older callers still work", () => {
  const u = buildUniverse({ core: ["AAPL"], scanSyms: new Set(), scanOf: {} });
  assert.equal(u.counts.desk, 0);
});

test("a missing desk file is an empty desk group, not an error", () => {
  const r = readDeskSymbols(join(tmpdir(), "no-such-desk-file-2099-01-01.json"));
  assert.equal(r.found, false);
  assert.equal(r.syms.size, 0);
});

test("the desk file accepts objects or bare strings and drops anything that is not a ticker", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-"));
  const p = join(dir, "2026-09-11.json");
  writeFileSync(p, JSON.stringify({ symbols: [{ symbol: "HPE" }, "ANET", { symbol: "hpe" }, { symbol: "B-360" }, 42, null] }));
  const r = readDeskSymbols(p);
  assert.equal(r.found, true);
  assert.deepEqual([...r.syms].sort(), ["ANET", "HPE"]);
});

test("a corrupt desk file cannot stop the core capture", () => {
  const p = join(mkdtempSync(join(tmpdir(), "bad-desk-")), "desk.json");
  for (const body of ["{broken", "null", JSON.stringify({ symbols: {} })]) {
    writeFileSync(p, body);
    const r = readDeskSymbols(p);
    assert.equal(r.found, true);
    assert.equal(r.syms.size, 0);
    assert.ok(r.error);
    assert.equal(buildUniverse({core: ["AAPL"], deskSyms: r.syms}).counts.core, 1);
  }
});
