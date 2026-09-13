# Desk Lane, Scorecard and Dataset Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture every name the desk touches without corrupting the pre-pump base rate, read the scored book back into per-setup statistics, and make the dataset's definition files durable.

**Architecture:** A new `desk` source tag joins `core` and `scan` in the daily capture, fed by a pure extractor over the book, the day's read files, an alias map and manual adds. The sealed 460-name core sample is never edited, and base rates filter to `core` through a required argument. A separate read-only aggregator over `db/archive.json` produces the scorecard.

**Tech Stack:** Node >= 20 ESM, zero dependencies, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-09-12-attention-lane-and-scorecard-design.md` (read its correction blocks; they supersede its first draft).

## Global Constraints

- Repo: `C:\Users\steam\Projects\apps\the-bench`. All paths below are relative to it.
- **Deadline for Tasks 1-6: Monday 2026-09-14 16:30 CT** (the `bench-prepump-snapshot` run). A missed session is unrecoverable.
- Test command is scoped, never bare: `node --test test/*.test.mjs server/*.test.js`. Bare `node --test` also discovers the stale worktree at `.claude/worktrees/practical-turing-8938e9`. Baseline on 2026-09-12: **282 tests, 282 pass**.
- Never pipe a test run into another command before checking its exit code.
- `test/*.test.mjs` import style: `import { test } from "node:test";`. `server/*.test.js` style: `import test from "node:test";`.
- **Never edit** `db/prepump/universe-core.json`. **Never write** `db/archive.json` from any new code in this plan.
- Never rewrite an existing `db/prepump/*.ndjson`. Everything appends.
- No new code calls a broker/MCP tool. No push, no merge, no deploy, no post, no ntfy.
- The working tree is dirty with other sessions' files (`db/archive.json`, `db/watchlist.json`, `db/tape.json`, `scripts/tripwire.mjs`, ...). **`git add` only the files a task names.** Never `git add -A` or `git add .`.
- Commit messages end with the attribution line required by the committing assistant's own instructions.

---

## Phase C - Durability

### Task 1: Commit the dataset definition files

**Files:**
- Commit (already on disk, never tracked): `db/prepump/universe-core.json`, `db/prepump/nyse-calendar-2026-2028.json`, `db/prepump/runs/*.json`, `docs/prepump-dataset-findings.md`

**Interfaces:** none.

- [ ] **Step 1: Prove none of the row data would be staged**

Run:
```bash
for f in db/prepump/universe-core.json db/prepump/nyse-calendar-2026-2028.json db/prepump/runs/2026-09-11.json db/prepump/2026-09-11.ndjson db/prepump/history-state.json; do if git check-ignore -q "$f"; then echo "IGNORED  $f"; else echo "addable  $f"; fi; done
```
Expected: the first three `addable`, the `.ndjson` and `history-state.json` `IGNORED`.

- [ ] **Step 2: Stage exactly the definitions**

```bash
git add db/prepump/universe-core.json db/prepump/nyse-calendar-2026-2028.json db/prepump/runs/ docs/prepump-dataset-findings.md
git diff --cached --name-only
```
Expected: only those paths. **If any `.ndjson`, `raw/`, `outcomes/` or `history-state.json` appears, run `git restore --staged <path>` and stop.**

- [ ] **Step 3: Commit**

```bash
git commit -m "data: version the pre-pump definition files the gitignore always meant to keep"
```

**Not in this task:** a backup of the row data. Off-machine copies are ruled out by `.gitignore:37-40`. An on-machine second copy is Adam's decision.

---

## Phase A - Desk lane (deadline Monday 16:30 CT)

### Task 2: Extract a pure `buildUniverse()` from `cmdPlan`

**Files:**
- Modify: `scripts/prepump-collect.mjs` (`cmdPlan`, currently the union at ~:172 and the `symbols` map at ~:185-190)
- Create: `test/prepump-collect.test.mjs`

**Interfaces:**
- Produces: `export function buildUniverse({ core, scanSyms, scanOf, deskSyms }) -> { all: string[], symbols: {symbol, source: string[], scan_ids: string[]}[], counts: {core, scan, desk, total} }`
- `source` order is always `core`, `scan`, `desk`. Existing rows must keep the exact `["core"]`, `["scan"]`, `["core","scan"]` shapes.

Importing this module in a test is safe: `main()` only runs when the file is executed directly (`prepump-collect.mjs:525`).

- [ ] **Step 1: Write the failing test**

Create `test/prepump-collect.test.mjs`:

```js
// prepump-collect.test.mjs — offline, zero-dep. node --test test/prepump-collect.test.mjs
//
// buildUniverse is the one place the capture decides who gets collected and
// how each row is tagged. The tag is what keeps the core denominator honest,
// so these tests pin the tag shapes existing rows already carry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUniverse } from "../scripts/prepump-collect.mjs";

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/prepump-collect.test.mjs`
Expected: FAIL, `buildUniverse` is not exported.

- [ ] **Step 3: Add `buildUniverse` above `cmdPlan`**

In `scripts/prepump-collect.mjs`, directly above `// ---------- plan ----------`:

```js
/**
 * Who gets collected, and why. Pure.
 *
 * Every row carries a `source` array. `core` rows are the stratified base-rate
 * sample and are the ONLY rows a base rate may count. `scan` and `desk` rows are
 * selected because something happened to them — non-random by construction —
 * so they ride alongside the sample and never join its denominator.
 */
export function buildUniverse({ core, scanSyms = new Set(), scanOf = {}, deskSyms = new Set() }) {
  const all = [...new Set([...core, ...scanSyms, ...deskSyms])].sort();
  const coreSet = new Set(core);
  const symbols = all.map((s) => ({
    symbol: s,
    source: [
      coreSet.has(s) ? "core" : null,
      scanSyms.has(s) ? "scan" : null,
      deskSyms.has(s) ? "desk" : null,
    ].filter(Boolean),
    scan_ids: scanOf[s] ?? [],
  }));
  return { all, symbols, counts: { core: core.length, scan: scanSyms.size, desk: deskSyms.size, total: all.length } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/prepump-collect.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/prepump-collect.mjs test/prepump-collect.test.mjs
git commit -m "prepump: extract buildUniverse so the capture's tagging rule is testable"
```

### Task 3: Read the desk file in `cmdPlan`, add `plan --dry-run`, count `desk` in the manifest

**Files:**
- Modify: `scripts/prepump-collect.mjs` (`cmdPlan` from `const all = ...` through the final `console.log`; manifest `written` block in `cmdBuild`)
- Modify: `test/prepump-collect.test.mjs`

**Interfaces:**
- Consumes: `buildUniverse` (Task 2).
- Produces: `export function readDeskSymbols(path) -> { syms: Set<string>, found: boolean }`. Desk file shape it accepts: `{ "symbols": [ {"symbol":"HPE", ...} | "HPE", ... ] }`.
- Produces: `plan --dry-run` prints the plan and writes nothing.
- Produces: plan fields `counts.desk`, `counts.first_appearance`, `desk_file`; manifest field `written.desk`. All additive; `plan.schema` stays `bench-prepump-plan-v1`.

**Why `--dry-run` is required:** `plan --date <past date>` today overwrites that date's `raw/<date>/plan.json`, which is part of the raw drop kept for rebuilds. Verifying against 2026-09-11 without a dry-run would damage it.

- [ ] **Step 1: Write the failing tests**

Append to `test/prepump-collect.test.mjs` (and add `readDeskSymbols` to the import from `../scripts/prepump-collect.mjs`, plus these imports at the top):

```js
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/prepump-collect.test.mjs`
Expected: FAIL, `readDeskSymbols` is not exported.

- [ ] **Step 3: Add `readDeskSymbols` directly below `buildUniverse`**

```js
/** The desk group for a session, if desk-feed.mjs wrote one. Missing = empty, never an error. */
export function readDeskSymbols(path) {
  if (!existsSync(path)) return { syms: new Set(), found: false };
  const d = JSON.parse(readFileSync(path, "utf8"));
  const syms = new Set();
  for (const s of d.symbols ?? []) {
    const t = typeof s === "string" ? s : s?.symbol;
    if (typeof t === "string" && /^[A-Z]{1,5}$/.test(t)) syms.add(t);
  }
  return { syms, found: true };
}
```

Note the regex is case-sensitive on purpose: a lowercase `hpe` is a malformed file, not a ticker.

- [ ] **Step 4: Replace the tail of `cmdPlan`**

Replace everything in `cmdPlan` from the line `const all = [...new Set([...core, ...scanSyms])].sort();` down to and including the last line of the function, the one that prints the `-> plan.json` path, with:

```js
  const deskPath = join(PREPUMP, "desk", `${date}.json`);
  const { syms: deskSyms, found: deskFound } = readDeskSymbols(deskPath);

  const { all, symbols, counts } = buildUniverse({ core, scanSyms, scanOf, deskSyms });
  const { due, state } = historyDue(date, all, cal);
  const firstSeen = due.filter((s) => !state[s]);

  const plan = {
    schema: "bench-prepump-plan-v1",
    date,
    planned_at: new Date().toISOString(),
    universe_version: u._version,
    early_close: isEarlyClose(date, cal),
    counts: { ...counts, history_due: due.length, first_appearance: firstSeen.length },
    scans_read: scanFiles.length,
    desk_file: deskFound ? deskPath : null,
    symbols: symbols.map((p) => ({ ...p, history_due: due.includes(p.symbol) })),
    batches: {
      fundamentals: chunk(all, 10),   // hard cap 10
      quotes: chunk(all, 20),         // >20 silently drops the `close` block from EVERY result
      historicals: chunk(due, 10),    // hard cap 10
    },
  };

  console.log(`plan ${date}: ${all.length} symbols (core ${counts.core}, scan ${counts.scan}, desk ${counts.desk})`);
  console.log(`  history due: ${due.length} (first appearance: ${firstSeen.length})`);
  console.log(`  batches: fundamentals ${plan.batches.fundamentals.length} x<=10 · quotes ${plan.batches.quotes.length} x<=20 · historicals ${plan.batches.historicals.length} x<=10`);
  if (!scanFiles.length) console.log(`  NOTE: no scan-*.json found in ${dir} — scan group is empty for this run.`);
  if (!deskFound) console.log(`  NOTE: no desk file at ${deskPath} — desk group is empty for this run.`);
  if (has("--dry-run")) {
    console.log("  --dry-run: plan.json NOT written.");
    return;
  }
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  console.log(`  -> ${join(dir, "plan.json")}`);
```

The old `coreSet` constant and the old "both" count are removed; `buildUniverse` owns both.

- [ ] **Step 5: Count `desk` in the manifest**

In `cmdBuild`, in the `written: { ... }` object, directly after
`scan: rows.filter((r) => r.source.includes("scan")).length,` add:

```js
      desk: rows.filter((r) => r.source.includes("desk")).length,
```

- [ ] **Step 6: Run the unit tests**

Run: `node --test test/prepump-collect.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 7: Prove the real 2026-09-11 plan reproduces and is not touched**

```bash
sha256sum db/prepump/raw/2026-09-11/plan.json
node scripts/prepump-collect.mjs plan --date 2026-09-11 --dry-run
echo "exit=$?"
sha256sum db/prepump/raw/2026-09-11/plan.json
```
Expected: the first line of output reads `plan 2026-09-11: 593 symbols (core 460, scan 145, desk 0)`, the desk NOTE prints, `--dry-run: plan.json NOT written.` prints, `exit=0`, and **both sha256 lines are identical**. 593 is the row count actually written for that session (448 core-only + 133 scan-only + 12 both).

- [ ] **Step 8: Full suite**

Run: `node --test test/*.test.mjs server/*.test.js`
Expected: 290 tests, 0 fail (282 baseline + 8).

- [ ] **Step 9: Commit**

```bash
git add scripts/prepump-collect.mjs test/prepump-collect.test.mjs
git commit -m "prepump: desk group joins the plan, plan --dry-run, desk counted in the manifest"
```

### Task 4: The desk feed (`scripts/desk-feed.mjs`)

**Files:**
- Create: `scripts/desk-feed.mjs`
- Create: `test/desk-feed.test.mjs`
- Create: `db/prepump/desk/aliases.json`
- Create: `db/prepump/desk/stoplist.json`

**Interfaces:**
- Produces CLI: `node scripts/desk-feed.mjs build --date D [--dry-run]` and `node scripts/desk-feed.mjs add --date D --symbols A,B --note "..."`. Exit 0 ok, 2 refused.
- Produces file `db/prepump/desk/<D>.json`: `{ schema: "bench-desk-feed-v1", date, window: {after, through}, counts: {symbols, book, read, manual}, symbols: [{symbol, why: [...]}], rejected: {unknown, stoplisted}, built_at }`. Consumed by `readDeskSymbols` (Task 3), which reads `symbols[].symbol`.
- Produces file `db/prepump/desk/manual/<D>.json`: `{ schema: "bench-desk-manual-v1", date, adds: [{symbol, note, added_at}] }`.
- Window rule: a session D takes book rows, read files and manual files dated **after the previous session and through D**, so weekend work feeds Monday.

**This exact code was run on 2026-09-12 against copies of the real inputs.** Results: 10/10 tests pass. `build --date 2026-09-11 --dry-run` produced 30 names from 10 read files and 15 book tickers with a known set of 590, caught all 13 targets (HPE ANET SNDK STX WDC SOXL DELL NVDA MU ORCL CEG VRT SMCI), and leaked none of `B S T ET HP FAST AI CPI`. `build --date 2026-09-14 --dry-run` produced 5 names from the weekend, then 20 after `add --date 2026-09-12` of the 17-name screen. Saturday, a malformed date, a non-ticker symbol, no command, and a missing `stoplist.json` all exit 2 and write nothing.

- [ ] **Step 1: Write the failing test**

Create `test/desk-feed.test.mjs`:

```js
// desk-feed.test.mjs — offline, zero-dep. node --test test/desk-feed.test.mjs
//
// The failure mode of a name extractor is not a crash. It is a quiet feed that
// either misses the day's biggest mover or collects a book id as a ticker.
// Every fixture here is a shape that actually appeared in docs/reads/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  stripIds, collectKnown, extractTickers, matchAliases, inWindow, buildDeskFeed, appendManual,
} from "../scripts/desk-feed.mjs";

const known = new Set(["HPE", "DELL", "NVDA", "SPY", "ANET", "HP", "ET", "B", "SNDK", "STX", "WDC", "ORCL"]);
const stoplist = new Set(["HP", "ET", "AI", "CEO"]);
const aliases = { SanDisk: "SNDK", Seagate: "STX", "Western Digital": "WDC", Dell: "DELL", Oracle: "ORCL" };

test("book, pattern, quant and read ids are stripped before tokenising", () => {
  const out = stripIds("That is P-032, logged with B-360, QR-019 and R-017.");
  assert.doesNotMatch(out, /B-360|P-032|QR-019|R-017/);
});

test("a book id never becomes the ticker B, and single letters are ignored", () => {
  const { hits } = extractTickers("Logged B-360. I think A is fine.", { known, stoplist });
  assert.deepEqual(hits, []);
});

test("known tickers are kept with their line number", () => {
  const { hits } = extractTickers("tape line\nHPE closed 62.08 and SPY 764.20", { known, stoplist });
  assert.deepEqual(hits, [{ symbol: "HPE", line: 2 }, { symbol: "SPY", line: 2 }]);
});

test("stoplisted and unknown tokens are reported, never kept", () => {
  const r = extractTickers("HP said ET close, CPI hot, AI capex", { known, stoplist });
  assert.deepEqual(r.hits, []);
  assert.deepEqual([...r.stoplisted].sort(), ["AI", "ET", "HP"]);
  assert.deepEqual([...r.unknown].sort(), ["CPI"]);
});

test("the 2026-09-11 closing read names storage by company, and the aliases catch it", () => {
  const line = "Storage sold off outright: SanDisk down 3.48, Seagate down 3.80, Western Digital down 2.98.";
  assert.deepEqual(matchAliases(line, aliases).map((h) => h.symbol).sort(), ["SNDK", "STX", "WDC"]);
  assert.deepEqual(extractTickers(line, { known, stoplist }).hits, []);
});

test("an alias matches a possessive but not a longer word or a different case", () => {
  assert.equal(matchAliases("Dell's gap floor", aliases).length, 1);
  assert.equal(matchAliases("Dellwood Capital", aliases).length, 0);
  assert.equal(matchAliases("the oracle of Omaha", aliases).length, 0);
});

test("collectKnown reads every shape the repo stores tickers in, and nothing else", () => {
  const k = collectKnown([
    { symbols: [{ symbol: "AAPL", band: "MEGA" }] },
    [{ id: "B-001", ticker: "MSFT", final_call: "No Trade" }],
    [{ sym: "AVGO", note: "WATCH" }],
    { layers: { buyers: { what: "The capex line", tickers: ["GOOGL", "AMZN"] } }, added: [{ sym: "MRVL" }] },
    { quotes: [{ sym: "HPQ", last: 35.4 }] },
    { _rule: "VERIFY A TICKER", note: "lower case aapl is not a ticker" },
  ]);
  assert.deepEqual([...k].sort(), ["AAPL", "AMZN", "AVGO", "GOOGL", "HPQ", "MRVL", "MSFT"]);
});

test("the window starts after the previous session, so a weekend feeds Monday", () => {
  const w = { after: "2026-09-11", through: "2026-09-14" };
  assert.equal(inWindow("2026-09-11", w), false);
  assert.equal(inWindow("2026-09-12", w), true);
  assert.equal(inWindow("2026-09-14", w), true);
  assert.equal(inWindow("2026-09-15", w), false);
  assert.equal(inWindow(undefined, w), false);
});

test("buildDeskFeed merges book, reads and manual adds and says why for each", () => {
  const feed = buildDeskFeed({
    date: "2026-09-11",
    window: { after: "2026-09-10", through: "2026-09-11" },
    archiveRows: [
      { id: "B-360", date: "2026-09-11", ticker: "DELL" },
      { id: "B-331", date: "2026-09-10", ticker: "ANET" },
    ],
    reads: [{ file: "2026-09-11-close.md", text: "HPE closed 62.08.\nSeagate down 3.80." }],
    manual: [{ symbol: "keel", note: "screen from chat" }],
    known,
    stoplist,
    aliases,
  });
  assert.deepEqual(feed.symbols.map((s) => s.symbol), ["DELL", "HPE", "KEEL", "STX"]);
  assert.deepEqual(feed.counts, { symbols: 4, book: 1, read: 2, manual: 1 });
  const stx = feed.symbols.find((s) => s.symbol === "STX");
  assert.deepEqual(stx.why, [{ source: "read", file: "2026-09-11-close.md", line: 2, via: "alias", name: "Seagate" }]);
});

test("manual adds append, dedupe within a call, and refuse anything that is not a ticker", () => {
  const p = join(mkdtempSync(join(tmpdir(), "desk-manual-")), "manual", "2026-09-14.json");
  appendManual(p, { date: "2026-09-14", symbols: ["mrvl", " COHR ", "MRVL"], note: "chat screen", addedAt: "2026-09-12T22:00:00Z" });
  const doc = appendManual(p, { date: "2026-09-14", symbols: ["AIP"], note: null, addedAt: "2026-09-12T22:05:00Z" });
  assert.deepEqual(doc.adds.map((a) => a.symbol), ["MRVL", "COHR", "AIP"]);
  assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), doc);
  assert.throws(() => appendManual(p, { date: "2026-09-14", symbols: ["B-360"], addedAt: "x" }), /not tickers/);
  assert.throws(() => appendManual(p, { date: "2026-09-14", symbols: [" ", ""], addedAt: "x" }), /no symbols/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/desk-feed.test.mjs`
Expected: FAIL, cannot find module `../scripts/desk-feed.mjs`.

- [ ] **Step 3: Create the module**

Create `scripts/desk-feed.mjs`:

```js
// desk-feed.mjs — the names the desk touched, for the pre-pump capture's `desk` group.
//
//   node scripts/desk-feed.mjs build --date 2026-09-14 [--dry-run]
//   node scripts/desk-feed.mjs add   --date 2026-09-14 --symbols MRVL,COHR --note "screen from chat"
//
// EXIT CODES: 0 ok · 2 REFUSED (bad input, not a session, missing definition file)
//
// WHY THIS EXISTS (2026-09-12)
// ----------------------------
// The capture's 460-name core is a stratified statistical sample — the
// DENOMINATOR for a pre-pump base rate — so the names the desk actually watches
// mostly are not in it. Of 17 names on a 2026-09-11 screen, 3 were captured.
// This builds a third group, tagged `desk`, that rides beside the sample.
//
// THE RULE THAT MATTERS: desk names are chosen BECAUSE something happened to
// them. Non-random inclusion. A `desk` row never counts toward a base rate.
//
// WHAT IT REFUSES TO DO:
//  - It calls no broker tool. A token outside the known set is rejected, never
//    looked up. A chat screen that never touched disk comes in through `add`.
//  - It never writes db/archive.json. It reads tickers from the book.
//  - It does not decide instrument class. Collection stays label-free.
//
// MEASURED 2026-09-12 on 46 read files: `B` was the most frequent "ticker" at
// 135 hits, all of them book ids like B-360, so ids are stripped first. Reads
// name companies more often than tickers for 10 of 20 board names (Oracle 47,
// ORCL 9), so aliases are required. Against 2026-09-11 this catches HPE, ANET,
// SNDK, STX, WDC, SOXL, DELL, NVDA, MU, ORCL, CEG, VRT and SMCI.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCalendar, isTradingDay, shiftSessions, todayET } from "./prepump-session.mjs";

// BENCH_ROOT exists so tests and dry runs can point at a copy of the inputs.
const ROOT = process.env.BENCH_ROOT
  ? resolve(process.env.BENCH_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESK = join(ROOT, "db", "prepump", "desk");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TICK = /^[A-Z]{1,5}$/;
export const SCHEMA = "bench-desk-feed-v1";

const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

function refuse(msg) {
  console.error(`REFUSED — ${msg}`);
  process.exit(2);
}

// ---------- pure ----------

/** Book, pattern, quant and read ids look like tickers to a regex. Remove them first. */
export function stripIds(text) {
  return String(text ?? "").replace(/\b(?:B|P|QR|R)-\d+\b/g, " ");
}

/** Every ticker-shaped value under a sym/symbol/ticker key, or inside a symbols/tickers array. */
export function collectKnown(values) {
  const known = new Set();
  const note = (t) => {
    if (typeof t === "string" && TICK.test(t)) known.add(t);
  };
  const walk = (v, key = "") => {
    if (Array.isArray(v)) {
      for (const x of v) {
        if (typeof x === "string" && /^(symbols|tickers)$/i.test(key)) note(x);
        else walk(x, key);
      }
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (/^(sym|symbol|ticker)$/i.test(k)) note(x);
        walk(x, k);
      }
    }
  };
  for (const v of values) walk(v);
  return known;
}

/** Ticker mentions in prose, with line numbers. Unknown and stoplisted tokens are reported, never kept. */
export function extractTickers(text, { known, stoplist }) {
  const hits = [];
  const unknown = new Set();
  const stoplisted = new Set();
  String(text ?? "").split(/\r?\n/).forEach((raw, i) => {
    for (const m of stripIds(raw).matchAll(/\b[A-Z]{2,5}\b/g)) {
      const t = m[0];
      if (stoplist.has(t)) stoplisted.add(t);
      else if (!known.has(t)) unknown.add(t);
      else hits.push({ symbol: t, line: i + 1 });
    }
  });
  return { hits, unknown, stoplisted };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Company names -> tickers. Case-sensitive, and a name inside a longer word does not count. */
export function matchAliases(text, aliases) {
  const compiled = Object.entries(aliases).map(([name, symbol]) => [
    name,
    symbol,
    new RegExp(`(^|[^A-Za-z])${escapeRe(name)}(?![A-Za-z])`),
  ]);
  const hits = [];
  String(text ?? "").split(/\r?\n/).forEach((line, i) => {
    for (const [name, symbol, re] of compiled) if (re.test(line)) hits.push({ symbol, name, line: i + 1 });
  });
  return hits;
}

/** after < date <= through. `after` is the previous session, so a weekend feeds Monday. */
export function inWindow(date, { after, through }) {
  return typeof date === "string" && date > after && date <= through;
}

export function buildDeskFeed({ date, window, archiveRows = [], reads = [], manual = [], known, stoplist, aliases }) {
  const why = new Map();
  const add = (symbol, w) => {
    if (!why.has(symbol)) why.set(symbol, []);
    why.get(symbol).push(w);
  };

  for (const r of archiveRows) {
    if (!inWindow(r?.date, window)) continue;
    const t = String(r.ticker ?? "").trim().toUpperCase();
    if (TICK.test(t)) add(t, { source: "book", row: r.id ?? null, date: r.date });
  }

  const unknown = new Set();
  const stoplisted = new Set();
  for (const { file, text } of reads) {
    const x = extractTickers(text, { known, stoplist });
    for (const h of x.hits) add(h.symbol, { source: "read", file, line: h.line, via: "ticker" });
    for (const h of matchAliases(text, aliases)) add(h.symbol, { source: "read", file, line: h.line, via: "alias", name: h.name });
    x.unknown.forEach((t) => unknown.add(t));
    x.stoplisted.forEach((t) => stoplisted.add(t));
  }

  // A manual add is a person or a chat saying "we looked at this". It is trusted
  // past the known set; a bad symbol comes back not_found from the collector.
  for (const m of manual) {
    const t = String(m?.symbol ?? "").trim().toUpperCase();
    if (TICK.test(t)) add(t, { source: "manual", note: m.note ?? null, date: m.date ?? null });
  }

  const symbols = [...why.keys()].sort().map((symbol) => ({ symbol, why: why.get(symbol) }));
  const bySource = (s) => symbols.filter((x) => x.why.some((w) => w.source === s)).length;
  return {
    schema: SCHEMA,
    date,
    window,
    counts: { symbols: symbols.length, book: bySource("book"), read: bySource("read"), manual: bySource("manual") },
    symbols,
    rejected: { unknown: [...unknown].sort(), stoplisted: [...stoplisted].sort() },
  };
}

/** Append-only. Returns the document as written. Throws on anything that is not a ticker. */
export function appendManual(path, { date, symbols, note, addedAt }) {
  const clean = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
  if (!clean.length) throw new Error("no symbols given");
  const bad = clean.filter((s) => !TICK.test(s));
  if (bad.length) throw new Error(`not tickers: ${bad.join(", ")}`);
  const doc = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { schema: "bench-desk-manual-v1", date, adds: [] };
  for (const symbol of clean) doc.adds.push({ symbol, note: note ?? null, added_at: addedAt });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
  return doc;
}

// ---------- io ----------

function readJson(p, fallback) {
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback;
}

function requireJson(p, what) {
  if (!existsSync(p)) refuse(`${p} is missing — ${what}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function loadInputs(date, cal) {
  const window = { after: shiftSessions(date, -1, cal), through: date };
  const u = requireJson(join(ROOT, "db/prepump/universe-core.json"), "the frozen core universe");
  const archiveRows = readJson(join(ROOT, "db/archive.json"), []);
  const known = collectKnown([
    { symbols: u.symbols }, // NOT the whole file: _dropped lists names deliberately excluded from the sample
    archiveRows,
    readJson(join(ROOT, "db/watchlist.json"), []),
    readJson(join(ROOT, "db/board.json"), {}),
    readJson(join(ROOT, "db/tape.json"), {}),
    readJson(join(ROOT, "db/catalysts.json"), []),
  ]);
  const stoplist = new Set(requireJson(join(DESK, "stoplist.json"), "without it prose words become tickers").symbols);
  const aliases = requireJson(join(DESK, "aliases.json"), "without it SanDisk, Seagate and Western Digital are missed").aliases;

  const readsDir = join(ROOT, "docs/reads");
  const reads = existsSync(readsDir)
    ? readdirSync(readsDir)
        .filter((f) => f.endsWith(".md") && inWindow(f.slice(0, 10), window))
        .sort()
        .map((file) => ({ file, text: readFileSync(join(readsDir, file), "utf8") }))
    : [];

  const manual = [];
  const manualDir = join(DESK, "manual");
  if (existsSync(manualDir)) {
    for (const f of readdirSync(manualDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && inWindow(f.slice(0, 10), window)).sort()) {
      for (const a of readJson(join(manualDir, f), { adds: [] }).adds ?? []) manual.push({ ...a, date: f.slice(0, 10) });
    }
  }
  return { window, known, stoplist, aliases, archiveRows, reads, manual };
}

function cmdBuild() {
  const date = val("--date") ?? todayET();
  if (!DATE_RE.test(date)) refuse(`--date must be YYYY-MM-DD, got "${date}"`);
  const cal = loadCalendar();
  let session;
  try {
    session = isTradingDay(date, cal);
  } catch (e) {
    refuse(e.message);
  }
  if (!session) refuse(`${date} is not a trading session.`);

  const inputs = loadInputs(date, cal);
  const feed = buildDeskFeed({ date, ...inputs });
  console.log(
    `desk ${date} (window ${inputs.window.after} < d <= ${date}): ${feed.counts.symbols} symbols ` +
      `(book ${feed.counts.book}, read ${feed.counts.read}, manual ${feed.counts.manual}) from ${inputs.reads.length} read file(s), known set ${inputs.known.size}`
  );
  console.log(`  ${feed.symbols.map((s) => s.symbol).join(" ")}`);
  console.log(`  rejected: ${feed.rejected.unknown.length} unknown · stoplisted ${feed.rejected.stoplisted.join(" ") || "none"}`);
  if (has("--dry-run")) {
    console.log("  --dry-run: nothing written.");
    return;
  }
  mkdirSync(DESK, { recursive: true });
  const path = join(DESK, `${date}.json`);
  // Derived, not collected: a re-run regenerates it. The capture rows record `desk` in their own source tag.
  writeFileSync(path, JSON.stringify({ ...feed, built_at: new Date().toISOString() }, null, 2) + "\n");
  console.log(`  -> ${path}`);
}

function cmdAdd() {
  const date = val("--date") ?? todayET();
  if (!DATE_RE.test(date)) refuse(`--date must be YYYY-MM-DD, got "${date}"`);
  const raw = val("--symbols");
  if (!raw) refuse("--symbols is required, comma-separated");
  try {
    const doc = appendManual(join(DESK, "manual", `${date}.json`), {
      date,
      symbols: raw.split(","),
      note: val("--note"),
      addedAt: new Date().toISOString(),
    });
    console.log(`manual ${date}: ${doc.adds.length} add(s) on file -> ${join(DESK, "manual", `${date}.json`)}`);
  } catch (e) {
    refuse(e.message);
  }
}

function main() {
  if (cmd === "build") return cmdBuild();
  if (cmd === "add") return cmdAdd();
  refuse(`unknown command "${cmd ?? ""}". Use: build | add`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 4: Create the alias map and the stoplist**

Create `db/prepump/desk/aliases.json`:

```json
{
  "_schema": "bench-desk-aliases-v1",
  "_note": "Company names the reads use instead of tickers. Case-sensitive and letter-bounded, so 'Dell's' matches and 'Dellwood' does not. Measured 2026-09-12 across 46 read files: 10 of 20 board names appear more often by name than by ticker (Oracle 47 vs ORCL 9, Vertiv 38 vs VRT 15). Add a name only after a read has actually used it.",
  "_excluded": {
    "Meta": "an ordinary English word, and META is ticker-dominant in the reads (12 vs 6)",
    "Coherent": "an ordinary English word, with zero name uses in the reads",
    "Hewlett Packard": "ambiguous between HPE and HPQ; only the full 'Hewlett Packard Enterprise' is mapped"
  },
  "_caution": {
    "Constellation": "means Constellation Energy (CEG) on this board; Constellation Brands is STZ"
  },
  "aliases": {
    "AeroVironment": "AVAV",
    "Applied Materials": "AMAT",
    "Arista": "ANET",
    "Broadcom": "AVGO",
    "Constellation": "CEG",
    "Dell": "DELL",
    "Hewlett Packard Enterprise": "HPE",
    "Marvell": "MRVL",
    "Micron": "MU",
    "Nvidia": "NVDA",
    "Oracle": "ORCL",
    "SanDisk": "SNDK",
    "Sandisk": "SNDK",
    "Seagate": "STX",
    "Super Micro": "SMCI",
    "Uber": "UBER",
    "Vertiv": "VRT",
    "Western Digital": "WDC"
  }
}
```

Create `db/prepump/desk/stoplist.json`:

```json
{
  "_schema": "bench-desk-stoplist-v1",
  "_note": "Real tickers the reads use as ordinary words or abbreviations. A stoplisted token is reported under rejected.stoplisted and never collected. Seeded 2026-09-12 from the 46-file read corpus (ET 10 = Eastern Time, HP 7 = shorthand for HP Inc or Hewlett Packard, FAST 2, OPEN 1, BAND 1, SAIL 1, PUMP 1) plus common short English words.",
  "symbols": ["AI", "ALL", "AN", "ARE", "AT", "BAND", "BE", "BY", "CEO", "ET", "FAST", "GO", "HP", "IT", "NOW", "ON", "OPEN", "OR", "PUMP", "SAIL", "SO", "UP", "US"]
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/desk-feed.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 6: Dry-run Friday on the real tree and check every target**

```bash
node scripts/desk-feed.mjs build --date 2026-09-11 --dry-run > /tmp/desk911.txt; echo "exit=$?"; cat /tmp/desk911.txt
L=$(sed -n '2p' /tmp/desk911.txt); for t in HPE ANET SNDK STX WDC SOXL DELL NVDA MU ORCL CEG VRT SMCI; do echo " $L " | grep -q " $t " && echo "$t CAUGHT" || echo "$t MISSED"; done
```
Expected, as measured 2026-09-12 (the known-set size grows as the book grows):
```
desk 2026-09-11 (window 2026-09-10 < d <= 2026-09-11): 30 symbols (book 15, read 28, manual 0) from 10 read file(s), known set 590
  AMZN ANET AVAV AVGO CBRS CEG DELL ETN GOOGL HIMS HPE HPQ IREN KLIC MRVL MU NVDA ORCL QQQ SMCI SNDK SOXL SPCX SPY STX TLT UBER VRT WDC ZEC
  rejected: 22 unknown · stoplisted AI AT ET FAST HP
  --dry-run: nothing written.
```
All 13 lines `CAUGHT`. **Any `MISSED` is a stop.**

- [ ] **Step 7: Prove the dry run wrote nothing**

Run: `ls db/prepump/desk/`
Expected: only `aliases.json` and `stoplist.json`.

- [ ] **Step 8: Prove Tasks 2-4 compose on Friday's real data**

```bash
node scripts/desk-feed.mjs build --date 2026-09-11
sha256sum db/prepump/raw/2026-09-11/plan.json
node scripts/prepump-collect.mjs plan --date 2026-09-11 --dry-run
sha256sum db/prepump/raw/2026-09-11/plan.json
rm db/prepump/desk/2026-09-11.json
```
Expected, as measured 2026-09-12 by applying Tasks 2-3 verbatim to a copy of the collector: `plan 2026-09-11: 612 symbols (core 460, scan 145, desk 30)` and `history due: 18 (first appearance: 18)`, so the desk group adds 19 names and 2 extra historicals calls. The core count is still **460**, both sha256 lines match, and the temporary desk file is removed afterwards so 9/11 is left exactly as collected.

- [ ] **Step 9: Full suite**

Run: `node --test test/*.test.mjs server/*.test.js`
Expected: 300 tests, 0 fail.

- [ ] **Step 10: Commit**

```bash
git add scripts/desk-feed.mjs test/desk-feed.test.mjs db/prepump/desk/aliases.json db/prepump/desk/stoplist.json
git commit -m "prepump: desk feed - the names the desk touched, tagged apart from the base-rate sample"
```

---

### Task 5: Wire the desk feed into the snapshot routine  **[GATED: Adam says go]**

**Why gated:** this edits a live scheduled task. House precedent (Open Loops 2026-09-02, the reads-ledger repoint) is that live-automation edits wait on Adam. **Without this task, Monday's capture has no desk group and the deadline is missed**, so ask for the go before Monday 16:30 CT, not after.

**Files:**
- Modify: `C:\Users\steam\.claude\scheduled-tasks\bench-prepump-snapshot\SKILL.md` (outside the repo, not committed)

- [ ] **Step 1: Insert a step between STEP 2 and STEP 3**

Directly above the line `=== STEP 3 — RE-PLAN so the scan names join the universe ===`, insert:

```
=== STEP 2b — THE DESK GROUP (names the desk touched since the previous session) ===
  node scripts/desk-feed.mjs build --date DATE
This writes db\prepump\desk\DATE.json from the book, the day's read files and any manual adds. It calls NO broker tool.
Exit 2 means REFUSED: say so in your final message and CONTINUE without a desk group. A missing desk group must NEVER stop the core capture — the core rows are the dataset.
Desk rows are tagged "desk" and are never part of a base rate.
```

- [ ] **Step 2: Report the desk count in STEP 6**

In STEP 6, directly after the sentence telling the session to check `written.total` against `expected.total` and check `complete`, add:

```
Also read written.core and written.desk. written.core must equal expected.core (460 unless a name is not_found). Report written.desk in your final three lines.
```

- [ ] **Step 3: Confirm the file parses and the step reads correctly**

Run: `grep -n "STEP 2b" -A5 "C:/Users/steam/.claude/scheduled-tasks/bench-prepump-snapshot/SKILL.md"`
Expected: the inserted block, directly above STEP 3.

---

### Task 6: Verify Monday's run  **[after 2026-09-14 16:30 CT]**

**Files:** read only.

- [ ] **Step 1: Read the manifest**

```bash
node -e "const m=require('./db/prepump/runs/2026-09-14.json');console.log(JSON.stringify({expected:m.expected,written:m.written,complete:m.complete},null,1))"
```
Expected: `complete: true`; `written.core` equals `expected.core`; `written.desk` greater than 0; `written.total` equals `expected.total`.

- [ ] **Step 2: Prove the denominator did not move**

```bash
node -e "const fs=require('fs');const rows=fs.readFileSync('db/prepump/2026-09-14.ndjson','utf8').trim().split('\n').map(JSON.parse);const c=rows.filter(r=>r.source.includes('core')).length;const d=rows.filter(r=>r.source.includes('desk')).length;const dOnly=rows.filter(r=>r.source.length===1&&r.source[0]==='desk').length;console.log({rows:rows.length,core:c,desk:d,desk_only:dOnly})"
```
Expected: `core` is 460 (or 460 minus any `not_found`), and `desk_only` rows are exactly the names that were in neither core nor scan.

- [ ] **Step 3: If `complete` is false**

Follow the routine's own rule: retry once at most, never fabricate a row. Record which batches failed in the vault Daily note and Open Loops.

---

## Phase B - Scorecard (no deadline)

Every fenced block the plan expects you to paste is preceded by an `<!-- apply: ID -->` marker. The markers are how this plan was verified: a script extracted each block, applied it to a full copy of the working tree, and ran the whole suite. Leave them in; they are harmless.

### Task 7: Declare `bet` honestly in the scorer

**Files:**
- Modify: `server/scoring.js` (`DECLARED_TYPES`; `scoreCall` directly above its price check)
- Modify: `server/scoring.test.js` (append)

**Interfaces:**
- Produces: `classifyCall({ call_type: "bet" }) === "bet"`.
- Produces: `scoreCall({ type: "bet", ... })` returns `{ verdict: "not_scorable", alpha: null, note: "bet — an options structure; checkpoints price the underlying, not the contract" }`.

**Why not score a bet like a long.** All three bet rows are options structures. B-091 and B-092 are an IWM 304C shadow test bought at a 2.15 premium; B-335 is an MU call spread. The scorer prices the underlying, so B-091's 1w checkpoint already reads `asset_pct: 13851.63`. And **`dueCheckpoints` keeps a `not_scorable` checkpoint due** (`server/checkpoints.js`: only right, wrong and flat are settled), so the next real `score-book.js` run rescores it. Scored like a long, that row would write an alpha near +13,853 into the book the same Saturday.

**What the next real scorer run will change, on purpose:** B-091 and B-092's 1w checkpoints get rewritten with the new note, still `not_scorable`, still `alpha: null`.

- [ ] **Step 1: Append the failing tests to `server/scoring.test.js`**

<!-- apply: B7-test -->
```js
// ---- bet ----

test("a declared bet classifies as bet, not from prose", () => {
  assert.equal(classifyCall({ call_type: "bet", final_call: "CONVICTION BET LANE - STRUCTURE TEST" }), "bet");
});

test("a bet is never scored like a long, because the scorer prices the underlying", () => {
  // B-091: an IWM 304C bought at a 2.15 premium, scored against IWM at 299.96.
  const r = scoreCall({ type: "bet", assetPct: 13851.63, benchPct: -1.37 });
  assert.equal(r.verdict, "not_scorable");
  assert.equal(r.alpha, null);
  assert.match(r.note, /options structure/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test server/scoring.test.js`
Expected: 2 failures. The first receives `"unknown"`; the second receives the note `"unhandled call type"`.

- [ ] **Step 3: Add `bet` to the declared types**

In `server/scoring.js`, find:

<!-- apply: B7-find-declared -->
```text
const DECLARED_TYPES = new Set(["pass", "hedge", "conditional", "long", "closed"]);
```

Replace with:

<!-- apply: B7-repl-declared -->
```js
const DECLARED_TYPES = new Set(["pass", "hedge", "conditional", "long", "closed", "bet"]);
```

- [ ] **Step 4: Give it the honest reason**

In `scoreCall`, find:

<!-- apply: B7-find-price -->
```text
  if (typeof assetPct !== "number" || typeof benchPct !== "number") {
```

Insert directly above it:

<!-- apply: B7-insert-bet -->
```js
  if (type === "bet") {
    // Every bet in the book is an options structure. The checkpoint prices the
    // underlying, so B-091 (an IWM call bought at 2.15) reads +13,851%. Scoring
    // that like a long would put one row on top of every mean in the scorecard.
    return unscorable("bet — an options structure; checkpoints price the underlying, not the contract");
  }
```

- [ ] **Step 5: Run to verify they pass**

Run: `node --test server/scoring.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 6: Full suite**

Run: `node --test test/*.test.mjs server/*.test.js`
Expected: 302 tests, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add server/scoring.js server/scoring.test.js
git commit -m "scoring: declare bet and say why it cannot be scored, instead of falling through to prose"
```

---

### Task 8: `score-book.js` stops writing under x-poster

**Files:**
- Modify: `server/scorecardPost.js` (append)
- Modify: `server/scorecardPost.test.js` (import line; append)
- Modify: `scripts/score-book.js` (header comment; import line; draft-write block)

**Interfaces:**
- Produces: `export function draftDecision({ dryRun, draft, queueExists }) -> "write" | "print"`. `"write"` only when `draft === true`, `dryRun !== true` and `queueExists === true`.
- Produces CLI flag `--draft`. `--dry-run` and `--no-draft` keep their meanings.

**Why.** The 2026-09-05 standing order says nothing writes under `apps/x-poster/`. On 2026-09-12 the week recap ran the scorer for real and it wrote a scorecard draft into `x-poster/queue/`, which was removed by hand. **The vault hub note says the scorer writes "even --dry-run". That is wrong:** the old guard is `!dryRun && existsSync(QUEUE_DIR)`, so only a real run writes.

- [ ] **Step 1: Write the failing test**

In `server/scorecardPost.test.js`, find:

<!-- apply: B8-find-testimport -->
```text
import { renderWeeklyPost } from "./scorecardPost.js";
```

Replace with:

<!-- apply: B8-repl-testimport -->
```js
import { renderWeeklyPost, draftDecision } from "./scorecardPost.js";
```

Append to the end of the file:

<!-- apply: B8-test -->
```js

test("a scorecard draft is printed, never written, unless --draft is asked for on a real run", () => {
  assert.equal(draftDecision({ dryRun: false, draft: false, queueExists: true }), "print");
  assert.equal(draftDecision({ dryRun: true, draft: true, queueExists: true }), "print");
  assert.equal(draftDecision({ dryRun: false, draft: true, queueExists: false }), "print");
  assert.equal(draftDecision({ dryRun: false, draft: true, queueExists: true }), "write");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/scorecardPost.test.js`
Expected: FAIL, `The requested module './scorecardPost.js' does not provide an export named 'draftDecision'`.

- [ ] **Step 3: Implement**

Append to the end of `server/scorecardPost.js`:

<!-- apply: B8-impl -->
```js

// Where a scorecard draft goes. The X channel was retired 2026-09-05 and nothing
// writes under x-poster unless a person explicitly asks for it with --draft.
export function draftDecision({ dryRun, draft, queueExists }) {
  return draft === true && dryRun !== true && queueExists === true ? "write" : "print";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/scorecardPost.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Wire it into `scripts/score-book.js`**

Find:

<!-- apply: B8-find-header -->
```text
//   node scripts/score-book.js               # score, write archive, draft post
//   node scripts/score-book.js --dry-run     # score and print, touch nothing
//   node scripts/score-book.js --today 2026-09-30
//   node scripts/score-book.js --no-draft    # score only, no X draft
//
// The draft lands in x-poster/queue/ — Adam approves it there, exactly like
// every other post. The system drafts. Adam publishes.
```

Replace with:

<!-- apply: B8-repl-header -->
```js
//   node scripts/score-book.js               # score, write archive, print the draft
//   node scripts/score-book.js --dry-run     # score and print, touch nothing
//   node scripts/score-book.js --today 2026-09-30
//   node scripts/score-book.js --no-draft    # score only, no draft at all
//   node scripts/score-book.js --draft       # also write the draft into x-poster/queue/
//
// Nothing is written under x-poster unless --draft is passed. The X channel was
// retired 2026-09-05 and the standing order forbids routines writing there.
```

Find:

<!-- apply: B8-find-import -->
```text
import { renderWeeklyPost } from "../server/scorecardPost.js";
```

Replace with:

<!-- apply: B8-repl-import -->
```js
import { renderWeeklyPost, draftDecision } from "../server/scorecardPost.js";
```

Find:

<!-- apply: B8-find-write -->
```text
    if (!dryRun && existsSync(QUEUE_DIR)) {
      const path = nextDraftPath(today);
      writeFileSync(path, post + "\n", "utf8");
      console.log(`\nQueued for approval: ${path}`);
    } else if (!dryRun) {
      console.log(`\nx-poster queue not found at ${QUEUE_DIR} — draft printed only.`);
    }
```

Replace with:

<!-- apply: B8-repl-write -->
```js
    if (draftDecision({ dryRun, draft: has("--draft"), queueExists: existsSync(QUEUE_DIR) }) === "write") {
      const path = nextDraftPath(today);
      writeFileSync(path, post + "\n", "utf8");
      console.log(`\nQueued: ${path}`);
    } else if (!dryRun) {
      console.log("\nDraft printed only. Nothing written under x-poster (retired 2026-09-05). Pass --draft to write it.");
    }
```

- [ ] **Step 6: Verify without running the scorer**

Do **not** run `score-book.js` for real to test this: it fetches prices and writes `db/archive.json`.

```bash
node --check scripts/score-book.js; echo "check=$?"
grep -n -e "draftDecision" -e "writeFileSync(path" scripts/score-book.js
```
Expected: `check=0`; `draftDecision` on the import line and on the `if`; exactly one `writeFileSync(path` on the line directly under that `if`.

- [ ] **Step 7: Full suite**

Run: `node --test test/*.test.mjs server/*.test.js`
Expected: 303 tests, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add server/scorecardPost.js server/scorecardPost.test.js scripts/score-book.js
git commit -m "score-book: print the draft, write under x-poster only with --draft"
```

---

### Task 9: The scorecard (`server/scorecardStats.js`, `scripts/scorecard.mjs`)

**Files:**
- Create: `server/scorecardStats.js`
- Create: `server/scorecardStats.test.js`
- Create: `scripts/scorecard.mjs`

**Interfaces:**
- Consumes: `HORIZON_DAYS`, `CLOSING_HORIZON` from `server/checkpoints.js`.
- Produces: `MIN_N` (8), `isShadow(row)`, `normalizeFomo(v)`, `confidenceBand(n)`, `provenance(row)`, `entries(rows, { includeShadow })`, `groupStats(list, keyFn, { minN, withAlpha })`, `recordCounts(rows)`, `firstClosingDate(rows)`.
- Produces CLI: `node scripts/scorecard.mjs [--json] [--min-n N] [--include-shadow]`. Read-only. Exit 2 on a bad `--min-n`.

**Why each rule exists (all measured 2026-09-12):**
- **Three record counts, labelled.** One day's notes carried 95-80-16, 64-75-17 and 159-155-33 as "the record". They reconcile exactly: 95-80-16 was every checkpoint entry before that morning's scorer run, 64-75-17 was only what that run scored, and 159-155-33 is every entry now. The site masthead counts entries, so a call scored at 1w and at 1m counts twice (87 calls). One verdict per call gives 126-115-28 across 269 calls.
- **Alpha is hidden on groupings that mix call types.** A right pass has negative alpha and a right long has positive alpha, so a pooled mean is meaningless. Inside one call type and one outcome, alpha is the size of what that outcome cost or earned.
- **Outcome tables for conditionals and passes.** They carry the two findings the book has never shown. At 1w, 34 conditionals never triggered while the name ran (mean alpha +4.51) and 32 triggered and did not run (-5.16). At 1m the largest group is 11 that never triggered and ran +12.58. Passes: 42 correctly skipped (mean -5.83) against 44 that outran the benchmark (+9.45).
- **Case-normalised fomo** (`LATE FOMO` x2 beside `Late FOMO` x25). **Confidence in three bands**, because 123 values sit between p25 55 and p75 62. **Shadow tests excluded by default** (B-091, B-092 say "not a Bench call"). **Prose-classified rows kept apart** (23 rows predate `call_type`).
- **The horizon warning.** No 3m checkpoint has ever fired. The oldest row is 2026-06-30, so the first can land 2026-09-28.

- [ ] **Step 1: Write the failing test**

Create `server/scorecardStats.test.js`:

<!-- apply: B9-test -->
```js
// scorecardStats.test.js — the honesty rules of the scorecard. Pure, no fs.

import test from "node:test";
import assert from "node:assert/strict";

import {
  entries, groupStats, recordCounts, normalizeFomo, confidenceBand, isShadow, firstClosingDate, MIN_N,
} from "./scorecardStats.js";

const cp = (verdict, alpha) => ({ asof: "2026-07-07", verdict, alpha });
const rows = [
  { id: "B-001", date: "2026-06-30", ticker: "MSFT", call_type: "long", fomo: "Late FOMO", confidence_pct: 58,
    checkpoints: { "1w": cp("right", 4.5), "1m": cp("right", 22.1) } },
  { id: "B-002", date: "2026-07-01", ticker: "AMD", call_type: "pass", fomo: "LATE FOMO", confidence_pct: 40,
    checkpoints: { "1w": cp("wrong", 11.2) } },
  { id: "B-003", date: "2026-07-02", ticker: "HPQ", call_type: "pass", checkpoints: { "1w": cp("flat", 0.4) } },
  { id: "B-004", date: "2026-07-03", ticker: "GDS", final_call: "Watch — prose only",
    checkpoints: { "1w": cp("not_scorable", null) } },
  { id: "B-091", date: "2026-08-14", ticker: "IWM", call_type: "bet",
    final_call: "SHADOW TEST (not a Bench call): JC Merlo OAT default config, 1x IWM 8/21 304C @ 2.15",
    checkpoints: { "1w": { verdict: "not_scorable", alpha: null, asset_pct: 13851.63 } } },
  { id: "B-005", date: "2026-07-04", ticker: "XOM" },
];

test("fomo case variants merge, unknown text survives, empty is null", () => {
  assert.equal(normalizeFomo("LATE FOMO"), "Late FOMO");
  assert.equal(normalizeFomo("HEATING UP"), "Heating Up");
  assert.equal(normalizeFomo("Something New"), "Something New");
  assert.equal(normalizeFomo("  "), null);
  assert.equal(normalizeFomo(null), null);
});

test("confidence bands have exact edges", () => {
  assert.equal(confidenceBand(54.9), "<55");
  assert.equal(confidenceBand(55), "55-61");
  assert.equal(confidenceBand(61.9), "55-61");
  assert.equal(confidenceBand(62), "62+");
  assert.equal(confidenceBand(null), null);
});

test("a shadow test is recognised and excluded unless asked for", () => {
  assert.equal(isShadow(rows[4]), true);
  assert.equal(entries(rows).length, 5);
  assert.equal(entries(rows, { includeShadow: true }).length, 6);
});

test("each entry carries the scorer's note, so an outcome like an expensive pass can be grouped", () => {
  const e = entries([{ id: "B-9", call_type: "pass", checkpoints: { "1w": { verdict: "wrong", alpha: 12, note: "pass — expensive pass, it ran without us" } } }]);
  assert.equal(e[0].note, "pass — expensive pass, it ran without us");
});

test("a row with no call_type is prose provenance, never pooled silently", () => {
  const e = entries(rows).find((x) => x.id === "B-004");
  assert.equal(e.provenance, "prose");
  assert.equal(e.call_type, null);
});

test("a thin cell shows its counts and suppresses its rate", () => {
  const pass = groupStats(entries(rows), (e) => e.call_type).find((g) => g.key === "pass");
  assert.equal(MIN_N, 8);
  assert.equal(pass.suppressed, true);
  assert.equal(pass.win_rate, null);
  assert.equal(pass.mean_alpha, null);
  assert.deepEqual([pass.right, pass.wrong, pass.flat], [0, 1, 1]);
});

test("a flat is shown as a flat and never counted as a loss", () => {
  const pass = groupStats(entries(rows), (e) => e.call_type, { minN: 1 }).find((g) => g.key === "pass");
  assert.equal(pass.real, 2);
  assert.equal(pass.win_rate, 0);
  assert.equal(pass.wrong, 1);
  assert.equal(pass.flat, 1);
  assert.equal(pass.mean_alpha, 5.8);
});

test("a grouping that mixes call types reports no mean alpha, because a right pass and a right long have opposite signs", () => {
  const groups = groupStats(entries(rows), (e) => e.provenance, { minN: 1, withAlpha: false });
  assert.ok(groups.length > 0);
  for (const g of groups) assert.equal(g.mean_alpha, null);
  assert.equal(groups.find((g) => g.key === "declared").win_rate, 50);
});

test("a null key is reported as (none), not dropped", () => {
  const keys = groupStats(entries(rows), (e) => e.call_type, { minN: 1 }).map((g) => g.key);
  assert.ok(keys.includes("(none)"));
});

test("the three record counts are labelled and reconcile", () => {
  const r = recordCounts(rows);
  assert.deepEqual(
    [r.every_checkpoint_entry.n, r.every_checkpoint_entry.right, r.every_checkpoint_entry.wrong, r.every_checkpoint_entry.flat, r.every_checkpoint_entry.not_scorable],
    [6, 2, 1, 1, 2]
  );
  assert.deepEqual(
    [r.one_per_call_latest_horizon.n, r.one_per_call_latest_horizon.right, r.one_per_call_latest_horizon.not_scorable],
    [5, 1, 2]
  );
  assert.deepEqual(
    [r.one_per_call_latest_real_verdict.n, r.one_per_call_latest_real_verdict.right, r.one_per_call_latest_real_verdict.wrong, r.one_per_call_latest_real_verdict.flat],
    [3, 1, 1, 1]
  );
});

test("the first closing checkpoint is the oldest row plus the closing horizon", () => {
  assert.equal(firstClosingDate(rows), "2026-09-28");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/scorecardStats.test.js`
Expected: FAIL, cannot find module `./scorecardStats.js`.

- [ ] **Step 3: Create the module**

Create `server/scorecardStats.js`:

<!-- apply: B9-impl -->
```js
// scorecardStats.js — the scored book read back as per-setup statistics. Pure: no fs, no network.
//
// WHY THIS EXISTS (2026-09-12): 282 rows carry scored checkpoints and nothing had
// ever aggregated them. The first throwaway aggregation found conditional calls
// at 1 week sitting at -0.02 mean alpha over 122 entries, and passes costing
// 9.45 when wrong against 5.83 saved when right.
//
// THE HONESTY RULES, each one a way a scorecard lies without meaning to:
//  - A rate on too few entries is suppressed, and its count is still shown.
//  - Flats are displayed, never folded into losses.
//  - The population is named. "The record" was three different numbers in one
//    day's notes (95-80-16, 64-75-17, 159-155-33) because nobody said what was
//    being counted.
//  - Shadow tests are not Bench calls and are excluded unless asked for.
//  - A call typed at log time and a call classified from prose are separate
//    provenance and are never silently pooled.

import { HORIZON_DAYS, CLOSING_HORIZON } from "./checkpoints.js";

export const MIN_N = 8;
const HORIZON_ORDER = ["3m", "1m", "1w"];
const VERDICTS = ["right", "wrong", "flat", "not_scorable"];
const REAL = new Set(["right", "wrong", "flat"]);
const SHADOW = /shadow test|not a bench call/i;

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

export function isShadow(row) {
  return SHADOW.test(String(row?.final_call ?? ""));
}

// Measured 2026-09-12: "LATE FOMO" x2 beside "Late FOMO" x25, "HEATING UP" x1 beside "Heating Up" x45.
const FOMO = {
  "post-fomo fade": "Post-FOMO Fade",
  "late fomo": "Late FOMO",
  "heating up": "Heating Up",
  "pre-fomo": "Pre-FOMO",
  "no fomo": "No FOMO",
  neutral: "Neutral",
  "post-peak washout": "Post-peak washout",
};

export function normalizeFomo(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim();
  return FOMO[s.toLowerCase()] ?? s;
}

// Measured 2026-09-12 over 123 rows: min 30, p25 55, median 58, p75 62, max 85.
// Confidence is bunched, so three bands is all the data can support.
export function confidenceBand(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 55) return "<55";
  if (n < 62) return "55-61";
  return "62+";
}

export function provenance(row) {
  return String(row?.call_type ?? "").trim() ? "declared" : "prose";
}

/** One entry per scored checkpoint. */
export function entries(rows, { includeShadow = false } = {}) {
  const out = [];
  for (const r of rows ?? []) {
    if (!includeShadow && isShadow(r)) continue;
    for (const [horizon, c] of Object.entries(r?.checkpoints ?? {})) {
      if (!c) continue;
      out.push({
        id: r.id ?? null,
        ticker: r.ticker ?? null,
        horizon,
        call_type: String(r.call_type ?? "").trim().toLowerCase() || null,
        provenance: provenance(r),
        origin: r.origin ?? null,
        engine: r.engine ?? null,
        confidence_band: confidenceBand(r.confidence_pct),
        fomo: normalizeFomo(r.fomo),
        market_risk: r.market_risk ?? null,
        verdict: c.verdict ?? null,
        note: c.note ?? null,
        alpha: typeof c.alpha === "number" && Number.isFinite(c.alpha) ? c.alpha : null,
      });
    }
  }
  return out;
}

/**
 * Group entries by keyFn. A null key is reported as "(none)", never dropped.
 *
 * withAlpha: pass false whenever a group can hold more than one call type. A
 * correct pass has NEGATIVE alpha (the name lagged and we skipped it), and a
 * conditional that never triggered while the name ran is WRONG with POSITIVE
 * alpha. A mean alpha pooled across types is a number with no meaning. The
 * verdict-based win rate is direction-aware and is safe to pool.
 */
export function groupStats(list, keyFn, { minN = MIN_N, withAlpha = true } = {}) {
  const groups = new Map();
  for (const e of list) {
    const raw = keyFn(e);
    const key = raw === null || raw === undefined ? "(none)" : String(raw);
    if (!groups.has(key)) groups.set(key, { key, n: 0, right: 0, wrong: 0, flat: 0, not_scorable: 0, alphaSum: 0, alphaN: 0 });
    const g = groups.get(key);
    g.n++;
    if (VERDICTS.includes(e.verdict)) g[e.verdict]++;
    if (typeof e.alpha === "number") {
      g.alphaSum += e.alpha;
      g.alphaN++;
    }
  }
  return [...groups.values()]
    .map((g) => {
      const real = g.right + g.wrong + g.flat;
      const suppressed = real < minN;
      return {
        key: g.key,
        n: g.n,
        real,
        right: g.right,
        wrong: g.wrong,
        flat: g.flat,
        not_scorable: g.not_scorable,
        win_rate: suppressed ? null : round1((g.right / real) * 100),
        mean_alpha: !withAlpha || suppressed || !g.alphaN ? null : round2(g.alphaSum / g.alphaN),
        suppressed,
      };
    })
    .sort((a, b) => b.real - a.real || a.key.localeCompare(b.key));
}

/** Three honest ways to count "the record", each labelled. Unfiltered, so it reconciles with the site. */
export function recordCounts(rows) {
  const fresh = () => ({ n: 0, right: 0, wrong: 0, flat: 0, not_scorable: 0 });
  const bump = (t, v) => {
    t.n++;
    if (VERDICTS.includes(v)) t[v]++;
  };
  const every = fresh();
  const latest = fresh();
  const latestReal = fresh();
  for (const r of rows ?? []) {
    const cp = r?.checkpoints ?? {};
    for (const c of Object.values(cp)) if (c) bump(every, c.verdict);
    const h = HORIZON_ORDER.find((k) => cp[k]);
    if (h) bump(latest, cp[h].verdict);
    const hr = HORIZON_ORDER.find((k) => cp[k] && REAL.has(cp[k].verdict));
    if (hr) bump(latestReal, cp[hr].verdict);
  }
  return {
    every_checkpoint_entry: { ...every, note: "what the site masthead counts; a call scored at 1w and 1m counts twice" },
    one_per_call_latest_horizon: { ...latest, note: "each call once, at its most advanced checkpoint" },
    one_per_call_latest_real_verdict: { ...latestReal, note: "each call once, at its most advanced right/wrong/flat - the recommended headline" },
  };
}

/** The date the first closing checkpoint can land. Until then every statistic is a short-horizon statistic. */
export function firstClosingDate(rows) {
  const oldest = (rows ?? [])
    .map((r) => r?.date)
    .filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()[0];
  if (!oldest) return null;
  const t = new Date(`${oldest}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + HORIZON_DAYS[CLOSING_HORIZON]);
  return t.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/scorecardStats.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Create the CLI**

Create `scripts/scorecard.mjs`:

<!-- apply: B9-cli -->
```js
// scorecard.mjs — the book, read back as per-setup statistics. READ-ONLY.
//
//   node scripts/scorecard.mjs                  # tables
//   node scripts/scorecard.mjs --json           # machine-readable
//   node scripts/scorecard.mjs --min-n 12       # stricter suppression
//   node scripts/scorecard.mjs --include-shadow # count shadow tests too
//
// Reads db/archive.json. Writes nothing, anywhere. Spec:
// docs/superpowers/specs/2026-09-12-attention-lane-and-scorecard-design.md

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { entries, groupStats, recordCounts, firstClosingDate, MIN_N } from "../server/scorecardStats.js";

const ROOT = process.env.BENCH_ROOT
  ? resolve(process.env.BENCH_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const minN = val("--min-n") === undefined ? MIN_N : Number(val("--min-n"));
if (!Number.isInteger(minN) || minN < 1) {
  console.error("REFUSED — --min-n must be a whole number of at least 1");
  process.exit(2);
}

const rows = JSON.parse(readFileSync(join(ROOT, "db/archive.json"), "utf8"));
const includeShadow = has("--include-shadow");
const list = entries(rows, { includeShadow });
// The session date in New York, the repo convention (prepump-session todayET). toISOString is UTC and reads tomorrow every evening.
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const closing = firstClosingDate(rows);

// "conditional — never triggered and it ran without us" -> "never triggered and it ran without us"
const outcome = (note) => String(note ?? "(no note)").replace(/^[a-z]+ — /, "");

// withAlpha is false for every grouping that mixes call types: a right pass has
// negative alpha and a right long has positive alpha, so a pooled mean means nothing.
// Inside one call type and one outcome, alpha is the size of what that outcome cost or earned.
const DIMENSIONS = [
  { name: "call type x horizon", key: (e) => `${e.call_type ?? "(none)"} ${e.horizon}`, withAlpha: true },
  { name: "conditional calls by outcome", key: (e) => `${e.horizon} ${outcome(e.note)}`, withAlpha: true, only: (e) => e.call_type === "conditional" },
  { name: "passes by outcome", key: (e) => `${e.horizon} ${outcome(e.note)}`, withAlpha: true, only: (e) => e.call_type === "pass" },
  { name: "provenance", key: (e) => e.provenance, withAlpha: false },
  { name: "origin", key: (e) => e.origin, withAlpha: false },
  { name: "engine", key: (e) => e.engine, withAlpha: false },
  { name: "confidence band", key: (e) => e.confidence_band, withAlpha: false },
  { name: "fomo (case-normalised)", key: (e) => e.fomo, withAlpha: false },
  { name: "market risk", key: (e) => e.market_risk, withAlpha: false },
];

const report = {
  as_of: today,
  rows: rows.length,
  entries: list.length,
  include_shadow: includeShadow,
  min_n: minN,
  first_closing_checkpoint: closing,
  short_horizon_only: Boolean(closing) && today < closing,
  record: recordCounts(rows),
  groups: Object.fromEntries(
    DIMENSIONS.map((d) => [d.name, groupStats(d.only ? list.filter(d.only) : list, d.key, { minN, withAlpha: d.withAlpha })])
  ),
};

if (has("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const pct = (v) => (v === null ? "     -" : `${v.toFixed(1)}%`.padStart(6));
const alp = (v) => (v === null ? "      -" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`.padStart(7));

console.log(`THE BENCH SCORECARD — as of ${today}. Read-only.`);
console.log(`${rows.length} rows, ${list.length} scored checkpoint entries, shadow tests ${includeShadow ? "INCLUDED" : "excluded"}. Rates hidden below ${minN} right/wrong/flat entries.`);
if (report.short_horizon_only) {
  console.log(`HORIZON WARNING: no closing (3m) checkpoint can exist before ${closing}. Every number below is a 1-week or 1-month statistic.`);
}
console.log("");
console.log("THE RECORD, THREE WAYS - each answers a different question:");
for (const [k, v] of Object.entries(report.record)) {
  console.log(`  ${k.padEnd(34)} n=${String(v.n).padStart(4)}  ${v.right}-${v.wrong}-${v.flat}  not scorable ${v.not_scorable}  (${v.note})`);
}
for (const d of DIMENSIONS) {
  const groups = report.groups[d.name];
  const w = Math.max(22, ...groups.map((g) => g.key.length + 2));
  console.log("");
  console.log(d.name.toUpperCase() + (d.withAlpha ? "" : "  (alpha hidden: this grouping mixes call types)"));
  console.log(`  ${"group".padEnd(w)}${"real".padStart(5)}${"R".padStart(5)}${"W".padStart(5)}${"F".padStart(5)}${"NS".padStart(5)}${"win".padStart(8)}${"alpha".padStart(9)}`);
  for (const g of groups) {
    console.log(
      `  ${g.key.padEnd(w)}${String(g.real).padStart(5)}${String(g.right).padStart(5)}${String(g.wrong).padStart(5)}` +
        `${String(g.flat).padStart(5)}${String(g.not_scorable).padStart(5)}  ${pct(g.win_rate)}  ${alp(g.mean_alpha)}${g.suppressed ? "  too few" : ""}`
    );
  }
}
```

- [ ] **Step 6: Run it, and prove it wrote nothing**

```bash
sha256sum db/archive.json
node scripts/scorecard.mjs; echo "exit=$?"
sha256sum db/archive.json
```
Expected: `exit=0` and identical sha256 lines. The output below was produced by this exact code against a copy of the book on 2026-09-12. Counts will have grown by the time you run it; the shape and the reconciliation will not.

```
THE BENCH SCORECARD — as of 2026-09-13. Read-only.
367 rows, 367 scored checkpoint entries, shadow tests excluded. Rates hidden below 8 right/wrong/flat entries.
HORIZON WARNING: no closing (3m) checkpoint can exist before 2026-09-28. Every number below is a 1-week or 1-month statistic.

THE RECORD, THREE WAYS - each answers a different question:
  every_checkpoint_entry             n= 369  159-155-33  not scorable 22  (what the site masthead counts; a call scored at 1w and 1m counts twice)
  one_per_call_latest_horizon        n= 282  126-115-28  not scorable 13  (each call once, at its most advanced checkpoint)
  one_per_call_latest_real_verdict   n= 269  126-115-28  not scorable 0  (each call once, at its most advanced right/wrong/flat - the recommended headline)

CALL TYPE X HORIZON
  group                  real    R    W    F   NS     win    alpha
  conditional 1w          122   56   66    0    0   45.9%    -0.02
  pass 1w                 106   42   44   20    2   39.6%    +1.58
  conditional 1m           31   11   20    0    0   35.5%    +5.71
  long 1w                  28   14    6    8    0   50.0%    +0.78
  pass 1m                  27   12   12    3    0   44.4%    +0.39
  (none) 1m                13    9    3    1    9   69.2%    -3.18
  (none) 1w                13    8    4    1    9   61.5%    -1.78
  long 1m                   7    7    0    0    0       -        -  too few

CONDITIONAL CALLS BY OUTCOME
  group                                      real    R    W    F   NS     win    alpha
  1w never triggered and it ran without us     34    0   34    0    0    0.0%    +4.51
  1w correctly never triggered                 32   32    0    0    0  100.0%    -4.28
  1w triggered and did not run                 32    0   32    0    0    0.0%    -5.16
  1w triggered and ran                         24   24    0    0    0  100.0%    +6.11
  1m never triggered and it ran without us     11    0   11    0    0    0.0%   +12.58
  1m triggered and ran                         10   10    0    0    0  100.0%    +9.67
  1m triggered and did not run                  9    0    9    0    0    0.0%    -5.19
  1m correctly never triggered                  1    1    0    0    0       -        -  too few

PASSES BY OUTCOME
  group                                        real    R    W    F   NS     win    alpha
  1w correctly skipped                           42   42    0    0    0  100.0%    -5.83
  1w it outran the benchmark                     28    0   28    0    0    0.0%    +4.98
  1w went nowhere either way                     20    0    0   20    0    0.0%    -0.17
  1w expensive pass, it ran without us           16    0   16    0    0    0.0%   +17.28
  1m correctly skipped                           12   12    0    0    0  100.0%   -11.27
  1m expensive pass, it ran without us            6    0    6    0    0       -        -  too few
  1m it outran the benchmark                      6    0    6    0    0       -        -  too few
  1m went nowhere either way                      3    0    0    3    0       -        -  too few
  1w price not observable at this checkpoint      0    0    0    0    2       -        -  too few

PROVENANCE  (alpha hidden: this grouping mixes call types)
  group                  real    R    W    F   NS     win    alpha
  declared                321  142  148   31    2   44.2%        -
  prose                    26   17    7    2   18   65.4%        -

ORIGIN  (alpha hidden: this grouping mixes call types)
  group                  real    R    W    F   NS     win    alpha
  (none)                  307  143  140   24   20   46.6%        -
  routine                  16    7    6    3    0   43.8%        -
  adam                     11    5    5    1    0   45.5%        -
  delta                    10    4    3    3    0   40.0%        -
  hunter                    1    0    0    1    0       -        -  too few
  unspecified               1    0    1    0    0       -        -  too few
  x-post                    1    0    0    1    0       -        -  too few

ENGINE  (alpha hidden: this grouping mixes call types)
  group                  real    R    W    F   NS     win    alpha
  claude                  347  159  155   33   20   45.8%        -

CONFIDENCE BAND  (alpha hidden: this grouping mixes call types)
  group                  real    R    W    F   NS     win    alpha
  (none)                  283  129  127   27   18   45.6%        -
  55-61                    38   19   14    5    0   50.0%        -
  62+                      20    7   12    1    2   35.0%        -
  <55                       6    4    2    0    0       -        -  too few

FOMO (CASE-NORMALISED)  (alpha hidden: this grouping mixes call types)
  group                  real    R    W    F   NS     win    alpha
  (none)                  225   96  111   18    0   42.7%        -
  Post-FOMO Fade           57   28   18   11   14   49.1%        -
  Heating Up               27   13   11    3    4   48.1%        -
  Late FOMO                26   13   12    1    0   50.0%        -
  Pre-FOMO                  8    7    1    0    2   87.5%        -
  Post-peak washout         2    0    2    0    0       -        -  too few
  Neutral                   1    1    0    0    0       -        -  too few
  No FOMO                   1    1    0    0    0       -        -  too few

MARKET RISK  (alpha hidden: this grouping mixes call types)
  group                  real    R    W    F   NS     win    alpha
  (none)                  319  141  148   30    2   44.2%        -
  3                        14    9    4    1    2   64.3%        -
  2                        10    8    1    1   16   80.0%        -
  4                         4    1    2    1    0       -        -  too few
```

- [ ] **Step 7: Full suite**

Run: `node --test test/*.test.mjs server/*.test.js`
Expected: 314 tests, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add server/scorecardStats.js server/scorecardStats.test.js scripts/scorecard.mjs
git commit -m "scorecard: read the scored book back by setup, with the record counted three labelled ways"
```

---

### Task 10: Pattern instances name the book row they tested, and `--list` shows age

**Files:**
- Modify: `server/patternLog.js` (`validateInstance`, `addInstance`; append `daysSince`)
- Modify: `server/patternLog.test.js` (import block; append)
- Modify: `scripts/log-pattern.mjs` (usage comment, import, `--list` line and header, `--instance` fields)

**Interfaces:**
- Produces: instance field `row_ref: "B-###" | null`. `validateInstance` refuses a `row_ref` that is not `B-` followed by digits. `addInstance` keeps it.
- Produces: `export function daysSince(from, to) -> integer | null` (whole calendar days between two `YYYY-MM-DD` strings).
- Produces CLI: `log-pattern.mjs --instance P-### ... --row B-###`. `--list` gains an AGE column (days since `first_seen`).

**Why.** `db/patterns.json` holds 32 patterns and 67 instances, and **no instance carries a book id**. Instances key on `{date, ticker, detail, holds}` only, so a pattern cannot be joined to the call it tested. A date plus ticker join is lossy: 2026-09-11 alone has 33 book rows over 15 tickers. Existing instances stay as they are; `row_ref` makes the join possible from here on. And 24 of the 32 patterns are `proposed`, with nothing showing how long each has waited for a third instance.

- [ ] **Step 1: Write the failing tests**

In `server/patternLog.test.js`, find:

<!-- apply: B10-find-testimport -->
```text
  addInstance,
  summarise,
} from "./patternLog.js";
```

Replace with:

<!-- apply: B10-repl-testimport -->
```js
  addInstance,
  summarise,
  daysSince,
} from "./patternLog.js";
```

Append to the end of the file:

<!-- apply: B10-test -->
```js

// ---- row_ref: join an instance to the book row it tested ----

test("an instance can carry the book row it tested, and it survives attachment", () => {
  const out = addInstance(buildPattern(base, []), { ...inst, row_ref: "B-360" });
  assert.equal(out.instances[0].row_ref, "B-360");
});

test("an instance without a row_ref still attaches, with row_ref null", () => {
  assert.equal(addInstance(buildPattern(base, []), inst).instances[0].row_ref, null);
});

test("a row_ref that is not a book id is refused", () => {
  assert.ok(validateInstance({ ...inst, row_ref: "360" }).some((p) => /row_ref/.test(p)));
  assert.deepEqual(validateInstance({ ...inst, row_ref: "B-360" }), []);
});

test("daysSince counts whole calendar days and refuses anything that is not a date", () => {
  assert.equal(daysSince("2026-09-11", "2026-09-12"), 1);
  assert.equal(daysSince("2026-09-12", "2026-09-12"), 0);
  assert.equal(daysSince("2026-08-31", "2026-09-12"), 12);
  assert.equal(daysSince("not a date", "2026-09-12"), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test server/patternLog.test.js`
Expected: FAIL, `does not provide an export named 'daysSince'`.

- [ ] **Step 3: Validate and keep `row_ref`**

In `server/patternLog.js`, find:

<!-- apply: B10-find-holdsend -->
```text
        "pattern held is decoration, and it will quietly inflate the hit rate"
    );
  }
```

Replace with:

<!-- apply: B10-repl-holdsend -->
```js
        "pattern held is decoration, and it will quietly inflate the hit rate"
    );
  }
  if (input.row_ref !== undefined && input.row_ref !== null && !/^B-\d+$/.test(String(input.row_ref))) {
    problems.push("row_ref must be a book id like B-360, so the instance can be joined to the call it tested");
  }
```

Find:

<!-- apply: B10-find-field -->
```text
      holds: instance.holds,
```

Replace with:

<!-- apply: B10-repl-field -->
```js
      holds: instance.holds,
      row_ref: instance.row_ref ?? null,
```

Append to the end of the file:

<!-- apply: B10-days -->
```js

// Whole calendar days from one YYYY-MM-DD to another, or null when either is not a date.
// log-pattern --list uses it to show how long a claim has waited for its instances.
export function daysSince(from, to) {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE.test(String(from ?? "")) || !DATE.test(String(to ?? ""))) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test server/patternLog.test.js`
Expected: PASS, 20 tests.

- [ ] **Step 5: Wire the CLI**

In `scripts/log-pattern.mjs`, find:

<!-- apply: B10-find-import -->
```text
import { buildPattern, addInstance, summarise } from "../server/patternLog.js";
```

Replace with:

<!-- apply: B10-repl-import -->
```js
import { buildPattern, addInstance, summarise, daysSince } from "../server/patternLog.js";
```

Find:

<!-- apply: B10-find-usage -->
```text
//       --detail "+8% into the print, beat, -8% after hours"
```

Replace with:

<!-- apply: B10-repl-usage -->
```js
//       --detail "+8% into the print, beat, -8% after hours" \
//       --row B-004   (optional: the book row this instance tested)
```

Find:

<!-- apply: B10-find-return -->
```text
  return `${p.id}  ${s.status.padEnd(9)} ${rate}  ${s.held}/${s.total}  ${p.claim.slice(0, 78)}`;
```

Replace with:

<!-- apply: B10-repl-return -->
```js
  const age = daysSince(p.first_seen, new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  return `${p.id}  ${s.status.padEnd(9)} ${rate}  ${s.held}/${s.total}  ${age === null ? "  -" : String(age).padStart(3)}d  ${p.claim.slice(0, 72)}`;
```

Find:

<!-- apply: B10-find-header -->
```text
  console.log("ID     STATUS     RATE   HIT   CLAIM");
```

Replace with:

<!-- apply: B10-repl-header -->
```js
  console.log("ID     STATUS     RATE   HIT   AGE   CLAIM");
```

Find:

<!-- apply: B10-find-detail -->
```text
    detail: val("--detail"),
```

Replace with:

<!-- apply: B10-repl-detail -->
```js
    detail: val("--detail"),
    row_ref: val("--row"),
```

- [ ] **Step 6: Prove the CLI end to end without writing**

```bash
node scripts/log-pattern.mjs --list | head -6
sha256sum db/patterns.json
node scripts/log-pattern.mjs --instance P-032 --ticker DELL --date 2026-09-18 --holds true --detail "dry run" --row B-360 --dry-run; echo "exit=$?"
node scripts/log-pattern.mjs --instance P-032 --ticker DELL --date 2026-09-18 --holds true --detail "dry run" --row 360 --dry-run; echo "exit=$?"
sha256sum db/patterns.json
```
Expected: the `--list` header reads `ID     STATUS     RATE   HIT   AGE   CLAIM` and each row shows a day count; the `--row B-360` dry run exits 0 and ends `--dry-run: nothing written.`; the `--row 360` run exits non-zero with `row_ref must be a book id like B-360`; both sha256 lines match.

- [ ] **Step 7: Full suite**

Run: `node --test test/*.test.mjs server/*.test.js`
Expected: 318 tests, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add server/patternLog.js server/patternLog.test.js scripts/log-pattern.mjs
git commit -m "patterns: instances name the book row they tested; --list shows how long a claim has waited"
```

---

### Task 11: Point the docs at what is now true

**Files:**
- Modify: `docs/scorecard-spec.md` (banner under the title)
- Modify: `CLAUDE.md` (one paragraph under LOG IT)

**Why.** `docs/scorecard-spec.md` describes the 22-row book of 2026-07-28 and still reads as current. And the desk lane only captures a chat screen if the chat registers it: the 17-name volume screen of 2026-09-12 lived only in a chat window, so without an `add` it is invisible to the capture. Every desk on this machine reads `CLAUDE.md`, so that is where the rule goes.

- [ ] **Step 1: Mark the old spec historical**

In `docs/scorecard-spec.md`, find the title line:

<!-- apply: B11-find-title -->
```text
# SCORECARD — scoring the book, whether or not a trade was taken
```

Insert directly after that line:

<!-- apply: B11-banner -->
```markdown

> **HISTORICAL as of 2026-09-12.** This spec was written for the 22-row book of 2026-07-28 and every count in it dates from then. The book is now 367 rows. The verdict rules it describes are still the ones in `server/scoring.js` (plus `bet`, declared 2026-09-12 as not scorable). Current design: `docs/superpowers/specs/2026-09-12-attention-lane-and-scorecard-design.md`. To read the scored book back: `node scripts/scorecard.mjs`.
```

- [ ] **Step 2: Tell every desk how to register a screen**

In `CLAUDE.md`, find:

<!-- apply: B11-find-gaps -->
```text
**Check for gaps before you add to them:**
```

Insert directly after the line containing it:

<!-- apply: B11-screens -->
````markdown

**Screens get logged too (2026-09-12).** The pre-pump capture already collects every ticker in the day's book rows and read files, tagged `desk`. A screen, scan or watch list that only ever lived in a chat window is invisible to it. Register those names the same day; the date defaults to today in New York, and weekend adds feed Monday's run:

```bash
node scripts/desk-feed.mjs add --symbols MRVL,COHR,HPE --note "volume screen from chat"
```

`desk` names ride beside the 460-name base-rate sample and never count toward a base rate. `node scripts/scorecard.mjs` reads the scored book back by setup.
````

- [ ] **Step 3: Confirm both landed once**

```bash
grep -c "HISTORICAL as of 2026-09-12" docs/scorecard-spec.md
grep -c "Screens get logged too" CLAUDE.md
```
Expected: `1` and `1`.

- [ ] **Step 4: Commit**

```bash
git add docs/scorecard-spec.md CLAUDE.md
git commit -m "docs: mark the July scorecard spec historical, tell every desk how to register a screen"
```

---

### Task 12: Retire the stale `scorecard` branch  **[report only; deletion is Adam's call]**

**Files:** none.

`CLAUDE.md` says `scorecard` has two commits that are "not on main or on v25-runs-0817". They are on this line of history under new hashes. Proven on 2026-09-12 by patch-id, which compares content regardless of parent:

| Stale commit | On `v29-hunter-handoff` as | patch-id |
|---|---|---|
| `c1f746e` Score the book | `a5124a7` | identical `71c1c8d4...` |
| `0e94cc5` Backfill the triggers | `44d6b2f` | identical `814dc779...` |

- [ ] **Step 1: Re-prove it before reporting**

```bash
for p in "c1f746e a5124a7" "0e94cc5 44d6b2f"; do set -- $p; A=$(git show $1 | git patch-id --stable | cut -d' ' -f1); B=$(git show $2 | git patch-id --stable | cut -d' ' -f1); echo "$1 $2 $( [ "$A" = "$B" ] && echo IDENTICAL || echo DIFFERENT )"; done
```
Expected: two `IDENTICAL` lines.

- [ ] **Step 2: Report it to Adam.** Do not delete the branch. `git push origin --delete scorecard` is his decision.

---

## Self-review against the spec

| Spec requirement | Task |
|---|---|
| C1 definitions committed, row data stays on this machine | 1 |
| A1 desk feed: book, reads, aliases, stoplist, manual adds, no broker call | 4 |
| A2 instrument class decided late, not at collection | 4 (not implemented by design) |
| A3 `desk` tag in `cmdPlan`, manifest counter | 2, 3 |
| A4 base rates filter to `core` | 2 (tag), 6 (verified on real rows) |
| A5 collector test + dry run | 2, 3 |
| A6 first-run cost visible | 3 (`first_appearance` count) |
| A7 timing: desk feed before the re-plan | 5 |
| B1 `bet` declared, not scored as a long | 7 |
| B2 aggregator: min-n, flats, fomo, horizon warning, population named | 9 |
| B3 pattern instances join the book | 10 |
| B4 local delivery only | 9 |
| B5 retire the x-poster write | 8 |
| Open question 2 (stale branch) | 12 |
| Open question 3 (historical spec) | 11 |

**Deliberately not built:** a predictive model (four sessions of data; first labels ~2026-09-22); any instrument-class labelling at capture time; any backup of row data off this machine.

## Decisions that belong to Adam

1. **Task 5's go**, before Monday 2026-09-14 16:30 CT. It edits a live scheduled task. Without it, Monday is captured without a desk group.
2. **An on-machine second copy of the row data** (`db/prepump/*.ndjson`). Off-machine is ruled out by `.gitignore:37-40`.
3. **Which branch this lands on and who pushes it.** Everything here commits locally on `v29-hunter-handoff`. Nothing is pushed.
4. **Deleting `origin/scorecard`** (Task 12).
