# Quant Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the quant machinery The Bench already owns — backfill checkpoints onto the book, add setup base-rate testing with A–F evidence grading and persisted runs, and evolve the framework to v28 — with Vibe-Trading explicitly deferred.

**Architecture:** Everything builds on the existing, tested scorer stack (`server/scoring.js`, `server/checkpoints.js`, `server/scorecard.js`, `server/dataProviders.getDatedCloses()`). New logic lands as one pure module (`server/evidence.js`) tested offline with `node --test`, fronted by one zero-dep CLI (`scripts/quant-evidence.mjs`) that persists append-only runs to `db/quant-runs.json`. The framework change is a new integer prompt file (`prompts/trading-copilot-v28.md`), never an overwrite.

**Tech Stack:** Node ≥20 ESM, zero external dependencies (repo has only `dotenv`), `node --test`, Yahoo→Stooq free historical bars.

## Global Constraints

- **Zero new dependencies.** `package.json` dependencies stay exactly `{ "dotenv": "^16.6.1" }`.
- **Never overwrite a prompt version** — v28 is a new file; v27 and earlier stay on disk untouched.
- **Append-only data files.** `db/quant-runs.json` rows are never edited or deleted once written. Archive mutation happens only through the existing `scoreRows`/`writeArchive` path.
- **No invented numbers.** Missing data → `not_scorable` / grade `F` / refusal — never an estimate.
- **Nothing touches the unattended X publishing path.** All `score-book.js` runs use `--no-draft`. No file is written to `../x-poster/`.
- **No push, no deploy, no merge.** Work happens on branch `quant-slice-1`; commits are local; Adam owns push/PR/merge/deploy.
- **Adam's uncommitted stray files** (`va1.html`, `undefinedsmoke-handoff.json`, `scripts/buy-zone.mjs.bak`) are never staged, committed, or deleted.
- Research surfaces never place trades; nothing here mounts broker order tools.

---

### Task 1: Branch and land the pending desk work

The working tree carries Adam's desk output from 2026-08-29 (CEG review B-220 + pattern update + benny changelog + receipt log + review markdown). It must be its own commit before backfill touches `db/archive.json`, following the precedent of commit `5e210cd` ("book: land today's rows and tape before anything merges").

**Files:**
- Commit (pre-existing changes, not authored here): `db/archive.json`, `db/patterns.json`, `docs/benny-changelog.md`, `db/receipt-posted.json`, `site/reviews/2026-08-29-ceg-ai-infra.md`
- Never staged: `va1.html`, `undefinedsmoke-handoff.json`, `scripts/buy-zone.mjs.bak`

**Interfaces:**
- Produces: branch `quant-slice-1` with a clean separation between desk work and slice-1 work.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b quant-slice-1
```

- [ ] **Step 2: Stage exactly the desk files and commit**

```bash
git add db/archive.json db/patterns.json docs/benny-changelog.md db/receipt-posted.json site/reviews/2026-08-29-ceg-ai-infra.md
git commit -m "book: land 2026-08-29 desk work (B-220 CEG, patterns, receipts) before slice-1 touches the archive"
```

- [ ] **Step 3: Verify only strays remain untracked**

Run: `git status --short`
Expected: only `?? scripts/buy-zone.mjs.bak`, `?? undefinedsmoke-handoff.json`, `?? va1.html`, and the plan file itself.

- [ ] **Step 4: Commit the plan**

```bash
git add docs/superpowers/plans/2026-08-30-quant-slice-1.md
git commit -m "docs: quant slice-1 implementation plan"
```

---

### Task 2: Baseline — prove the existing tests pass before anything changes

**Files:** none modified.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: all existing tests pass (executor contract/app, freshness gate, server modules). Record the count. If anything fails, STOP and report — do not build on a broken baseline.

---

### Task 3: Backfill checkpoints onto the book

No new code. One supervised run of the existing scorer. `dueCheckpoints()` returns every elapsed, unsettled horizon for every open row, so a single run scores the whole backlog. `not_scorable` entries remain due (placeholders, by design) and can be rescued on later runs.

**Files:**
- Modify (via existing code only): `db/archive.json`

**Interfaces:**
- Consumes: `scripts/score-book.js` CLI (`--dry-run`, `--no-draft`, `--today`), `server/scorecard.scoreBook()`.
- Produces: `row.checkpoints = { "1w"|"1m"|"3m": { asof, price, asset_pct, bench, bench_pct, alpha, verdict, note, source, scored_at } }` on scored rows; 3m checkpoints also set `outcome`/`outcome_price`/`pct_move`/`grade_verdict`. The site's masthead record derives from these.

- [ ] **Step 1: Safety copy of the archive (outside the repo)**

```bash
cp db/archive.json "$TMPDIR_SCRATCHPAD/archive-pre-backfill.json"
```

(Use the session scratchpad directory; do not add copies inside the repo.)

- [ ] **Step 2: Dry-run and inspect**

Run: `node scripts/score-book.js --dry-run --no-draft`
Expected: a table of scored checkpoints (hundreds of lines for a 220-row book) and a tally JSON. Review: verdict distribution sane, crypto rows benchmarked vs BTC, `not_scorable` reasons honest (missing trigger, no bars), no thrown errors. If Yahoo rate-limits (`yahoo: 429`), wait and re-run; rows degrade to `not_scorable`, never to guesses.

- [ ] **Step 3: Real run**

Run: `node scripts/score-book.js --no-draft`
Expected: same table; archive written under its lock.

- [ ] **Step 4: Verify the archive**

```bash
node -e "const a=JSON.parse(require('fs').readFileSync('db/archive.json','utf8'));const w=a.filter(r=>r.checkpoints&&Object.keys(r.checkpoints).length);const closed=a.filter(r=>r.outcome);console.log('rows',a.length,'with checkpoints',w.length,'closed',closed.length)"
```

Expected: `rows 220` (unchanged count — append-only respected), `with checkpoints` > 0, `closed` > 0.

- [ ] **Step 5: Rebuild the site locally and check the record**

Run: `node site/build.mjs`
Expected: build succeeds; `site/dist/index.html` masthead record is no longer `0–0–0`. Build only — **no deploy**.

- [ ] **Step 6: Commit**

```bash
git add db/archive.json
git commit -m "book: backfill checkpoints across all 220 rows via the existing scorer - calibration live"
```

---

### Task 4: `server/evidence.js` — pure setup base-rate engine (TDD)

**Files:**
- Create: `server/evidence.js`
- Test: `server/evidence.test.js`

**Interfaces:**
- Consumes: `closeOnOrBefore(bars, isoDate)` from `server/checkpoints.js`; bar shape `{date: "YYYY-MM-DD", close: number}` oldest→newest (the `getDatedCloses` shape).
- Produces (used by Task 5):
  - `detectEvents(bars, setup) -> number[]` — bar indexes, cluster-collapsed to the first qualifying day of each run. `setup` is `{kind:"move", windowDays, thresholdPct}` | `{kind:"breakout", lookback}` | `{kind:"breakdown", lookback}`.
  - `independentCount(eventIdxs, horizonBars) -> number` — greedy count of events spaced ≥ horizonBars apart.
  - `forwardReturns(bars, eventIdxs, horizonBars, benchBars?) -> { instances, pending }` — `instances: [{date, entry, exit_date, exit, pct, alpha}]` (`alpha: null` without benchBars), `pending` = events whose horizon hasn't elapsed (excluded, never guessed).
  - `summarize(instances) -> {n, win_rate, avg_pct, median_pct, best_pct, worst_pct, avg_alpha, alpha_win_rate}` (alpha fields `null` when no instance carries alpha).
  - `gradeEvidence({events, independent, spanYears, source}) -> {grade: "A"|"B"|"C"|"D"|"F", why}`.
  - `barsSpanYears(bars) -> number` (calendar years between first and last bar, 1 decimal).

Grade ladder (deterministic, independent-events based — overlapping windows must not inflate the sample):
- `F` — `source === "none"` or `events === 0`.
- `D` — `independent < 5`.
- `C` — `independent < 15` or `spanYears < 2`.
- `B` — `independent < 30` or `spanYears < 5`.
- `A` — otherwise (≥30 independent events across ≥5 years).

- [ ] **Step 1: Write the failing test**

Create `server/evidence.test.js`:

```js
// evidence.test.js — offline, synthetic bars, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectEvents, independentCount, forwardReturns, summarize, gradeEvidence, barsSpanYears
} from "./evidence.js";

// helper: bars from a close series starting 2026-01-01, one bar per day
function mkBars(closes, start = "2026-01-01") {
  const t0 = new Date(`${start}T00:00:00Z`).getTime();
  return closes.map((close, i) => ({
    date: new Date(t0 + i * 86400000).toISOString().slice(0, 10),
    close
  }));
}

test("move: detects a -5% 2-bar drop, collapses consecutive qualifying days to the first", () => {
  // 100,100,94,89,100,100 — idx2 (-6% vs idx0) and idx3 (-11% vs idx1) qualify; cluster -> [2]
  const bars = mkBars([100, 100, 94, 89, 100, 100]);
  const events = detectEvents(bars, { kind: "move", windowDays: 2, thresholdPct: -5 });
  assert.deepEqual(events, [2]);
});

test("move: positive threshold means rises", () => {
  const bars = mkBars([100, 100, 106, 100, 100, 112]);
  const events = detectEvents(bars, { kind: "move", windowDays: 2, thresholdPct: 5 });
  assert.deepEqual(events, [2, 5]);
});

test("breakout: close above the max of the prior lookback closes, cluster-collapsed", () => {
  // lookback 3: idx4 close 111 > max(101,102,103)=103 -> event; idx5 (112) still above but same run
  const bars = mkBars([100, 101, 102, 103, 111, 112, 100, 100, 100, 120]);
  const events = detectEvents(bars, { kind: "breakout", lookback: 3 });
  assert.deepEqual(events, [4, 9]);
});

test("breakdown: close below the min of prior lookback closes", () => {
  const bars = mkBars([100, 99, 98, 97, 90, 89, 100]);
  const events = detectEvents(bars, { kind: "breakdown", lookback: 3 });
  assert.deepEqual(events, [4]);
});

test("independentCount enforces horizon spacing greedily", () => {
  assert.equal(independentCount([2, 5, 30, 33, 80], 21), 3); // 2, 30, 80
  assert.equal(independentCount([], 21), 0);
});

test("forwardReturns computes pct, excludes pending, matches benchmark by date", () => {
  const bars = mkBars([100, 100, 90, 95, 99, 100, 100]);
  const bench = mkBars([50, 50, 50, 50, 51, 50, 50]); // +2% over idx2->idx4 window
  const { instances, pending } = forwardReturns(bars, [2, 6], 2, bench);
  assert.equal(pending, 1); // idx6 + 2 is past the end
  assert.equal(instances.length, 1);
  const inst = instances[0];
  assert.equal(inst.date, bars[2].date);
  assert.equal(inst.entry, 90);
  assert.equal(inst.exit, 99);
  assert.equal(inst.pct, 10);       // (99-90)/90
  assert.equal(inst.alpha, 8);      // 10 - 2
});

test("forwardReturns without bench leaves alpha null", () => {
  const bars = mkBars([100, 90, 99]);
  const { instances } = forwardReturns(bars, [1], 1);
  assert.equal(instances[0].alpha, null);
});

test("summarize: win rate, median, extremes; alpha null-safe", () => {
  const s = summarize([
    { pct: 10, alpha: null }, { pct: -5, alpha: null }, { pct: 2, alpha: null }
  ]);
  assert.equal(s.n, 3);
  assert.equal(s.win_rate, 66.7);
  assert.equal(s.median_pct, 2);
  assert.equal(s.best_pct, 10);
  assert.equal(s.worst_pct, -5);
  assert.equal(s.avg_alpha, null);
});

test("grade ladder: F on nothing, D tiny, C thin, B decent, A strong", () => {
  assert.equal(gradeEvidence({ events: 0, independent: 0, spanYears: 5, source: "yahoo" }).grade, "F");
  assert.equal(gradeEvidence({ events: 3, independent: 3, spanYears: 5, source: "yahoo" }).grade, "D");
  assert.equal(gradeEvidence({ events: 20, independent: 10, spanYears: 5, source: "yahoo" }).grade, "C");
  assert.equal(gradeEvidence({ events: 20, independent: 16, spanYears: 1.5, source: "yahoo" }).grade, "C");
  assert.equal(gradeEvidence({ events: 40, independent: 20, spanYears: 5, source: "yahoo" }).grade, "B");
  assert.equal(gradeEvidence({ events: 60, independent: 35, spanYears: 6, source: "yahoo" }).grade, "A");
  assert.equal(gradeEvidence({ events: 5, independent: 5, spanYears: 5, source: "none" }).grade, "F");
});

test("barsSpanYears", () => {
  const bars = [{ date: "2021-08-30", close: 1 }, { date: "2026-08-29", close: 1 }];
  assert.equal(barsSpanYears(bars), 5);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/evidence.test.js`
Expected: FAIL — `Cannot find module ... evidence.js`.

- [ ] **Step 3: Implement `server/evidence.js`**

```js
// evidence.js — setup base rates from historical closes. Pure: no network, no fs.
//
// This is the quant leg of the framework (v28 QUANT EVIDENCE): "what happened
// the last N times this ticker did X." It counts, it never predicts — the
// output is a sample, a distribution and an honest grade, and the framework
// decides what it means. A pretty base rate is never a buy signal.
//
// Bars are [{date, close}] oldest -> newest — the getDatedCloses shape.
// Spec: docs/integrations/vibe-trading-audit.md (slice 1)

import { closeOnOrBefore } from "./checkpoints.js";

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// Event detection. Consecutive qualifying days are one event, dated to the
// first day of the run — a 3-day slide that keeps qualifying is one slide,
// not three samples.
export function detectEvents(bars, setup) {
  const qualifies = qualifier(bars, setup);
  const events = [];
  let inRun = false;
  for (let i = 0; i < bars.length; i += 1) {
    const q = qualifies(i);
    if (q && !inRun) events.push(i);
    inRun = q;
  }
  return events;
}

function qualifier(bars, setup) {
  const kind = setup?.kind;
  if (kind === "move") {
    const { windowDays, thresholdPct } = setup;
    if (!Number.isFinite(windowDays) || windowDays < 1 || !Number.isFinite(thresholdPct)) {
      throw new Error("move setup needs windowDays >= 1 and a numeric thresholdPct");
    }
    return (i) => {
      if (i < windowDays) return false;
      const from = bars[i - windowDays].close;
      if (!from) return false;
      const pct = ((bars[i].close - from) / from) * 100;
      return thresholdPct >= 0 ? pct >= thresholdPct : pct <= thresholdPct;
    };
  }
  if (kind === "breakout" || kind === "breakdown") {
    const { lookback } = setup;
    if (!Number.isFinite(lookback) || lookback < 1) throw new Error(`${kind} setup needs lookback >= 1`);
    return (i) => {
      if (i < lookback) return false;
      const window = bars.slice(i - lookback, i).map((b) => b.close);
      return kind === "breakout"
        ? bars[i].close > Math.max(...window)
        : bars[i].close < Math.min(...window);
    };
  }
  throw new Error(`unknown setup kind: ${kind}`);
}

// Events closer together than the horizon share forward windows — they are one
// observation wearing two dates. The grade is built on this count, not the raw
// one, so overlap can never dress a thin sample up as a fat one.
export function independentCount(eventIdxs, horizonBars) {
  let count = 0;
  let lastKept = -Infinity;
  for (const i of eventIdxs) {
    if (i - lastKept >= horizonBars) {
      count += 1;
      lastKept = i;
    }
  }
  return count;
}

// Forward return per event over horizonBars trading bars. Events whose horizon
// has not elapsed are counted as pending and excluded — never extrapolated.
// Benchmark legs resolve by DATE (nearest prior close), same rule the
// checkpoint scorer uses, so both sides of the alpha read the same session.
export function forwardReturns(bars, eventIdxs, horizonBars, benchBars = null) {
  const instances = [];
  let pending = 0;
  for (const i of eventIdxs) {
    const j = i + horizonBars;
    if (j >= bars.length) {
      pending += 1;
      continue;
    }
    const entry = bars[i].close;
    const exit = bars[j].close;
    const pct = round2(((exit - entry) / entry) * 100);
    let alpha = null;
    if (benchBars) {
      const b0 = closeOnOrBefore(benchBars, bars[i].date)?.close;
      const b1 = closeOnOrBefore(benchBars, bars[j].date)?.close;
      if (typeof b0 === "number" && typeof b1 === "number" && b0 !== 0) {
        alpha = round2(pct - ((b1 - b0) / b0) * 100);
      }
    }
    instances.push({ date: bars[i].date, entry, exit_date: bars[j].date, exit, pct, alpha });
  }
  return { instances, pending };
}

export function summarize(instances) {
  const n = instances.length;
  if (!n) {
    return { n: 0, win_rate: null, avg_pct: null, median_pct: null, best_pct: null, worst_pct: null, avg_alpha: null, alpha_win_rate: null };
  }
  const pcts = instances.map((x) => x.pct).sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 ? pcts[mid] : round2((pcts[mid - 1] + pcts[mid]) / 2);
  const alphas = instances.map((x) => x.alpha).filter((a) => typeof a === "number");
  return {
    n,
    win_rate: round1((instances.filter((x) => x.pct > 0).length / n) * 100),
    avg_pct: round2(pcts.reduce((s, p) => s + p, 0) / n),
    median_pct: median,
    best_pct: pcts[n - 1],
    worst_pct: pcts[0],
    avg_alpha: alphas.length ? round2(alphas.reduce((s, a) => s + a, 0) / alphas.length) : null,
    alpha_win_rate: alphas.length ? round1((alphas.filter((a) => a > 0).length / alphas.length) * 100) : null
  };
}

// The grade answers one question: how hard is it for this sample to be lying?
// It is a property of the EVIDENCE, not of the setup — a great setup with 4
// occurrences is still a D, and a D never outranks primary framework evidence.
export function gradeEvidence({ events, independent, spanYears, source }) {
  if (source === "none" || !events) {
    return { grade: "F", why: "no observable events — nothing to grade" };
  }
  const base = `${independent} independent event(s) over ${spanYears}y (${events} raw)`;
  if (independent < 5) return { grade: "D", why: `${base} — sample too small to mean anything` };
  if (independent < 15 || spanYears < 2) {
    return { grade: "C", why: `${base} — directional at best: thin sample or single regime` };
  }
  if (independent < 30 || spanYears < 5) {
    return { grade: "B", why: `${base} — useful, not yet regime-proof` };
  }
  return { grade: "A", why: `${base} — large sample across multiple regimes` };
}

export function barsSpanYears(bars) {
  if (!bars?.length) return 0;
  const ms = new Date(`${bars[bars.length - 1].date}T00:00:00Z`) - new Date(`${bars[0].date}T00:00:00Z`);
  return round1(ms / (365.25 * 24 * 3600 * 1000));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test server/evidence.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/evidence.js server/evidence.test.js
git commit -m "feat: evidence.js - setup base rates, independence-aware A-F evidence grading (pure, tested)"
```

---

### Task 5: `scripts/quant-evidence.mjs` — the CLI, with offline test

**Files:**
- Create: `scripts/quant-evidence.mjs`
- Create: `test/fixtures/quant-bars.json` (synthetic fixture)
- Test: `test/quant-evidence.test.mjs`

**Interfaces:**
- Consumes: everything Task 4 produces; `getDatedCloses(ticker, {range})` and `benchmarkFor(ticker)`; `db/quant-runs.json` (created on first write).
- Produces: `db/quant-runs.json` — append-only array of run rows `{id: "QR-001", ...}`; the printed report ends by echoing the run ID (the LOG IT contract).

CLI contract:

```
node scripts/quant-evidence.mjs --ticker CEG --setup move --threshold -5 --window 5 --horizon 21
node scripts/quant-evidence.mjs --ticker NVDA --setup breakout --lookback 20 --horizon 10 --range 5y
  --setup       move | breakout | breakdown            (required)
  --ticker      symbol                                  (required)
  --horizon     forward window in trading bars          (required, >= 1)
  --threshold   % move, sign = direction                (required for move)
  --window      bars the move is measured over          (move only, default 5)
  --lookback    prior bars for breakout/breakdown       (default 20)
  --range       history to pull (default 5y)
  --benchmark   default: benchmarkFor(ticker)
  --row B-###   link the run to a book row
  --note "..."  free text
  --dry-run     compute and print, write nothing
  --bars-file / --bench-file   JSON [{date,close}] fixtures (offline/testing)
```

Refusals (exit 1, message says what's missing — the guard working, not an error to route around): missing `--ticker`/`--setup`/`--horizon`; `move` without `--threshold`; unknown setup; horizon < 1; `--row` that doesn't exist in `db/archive.json`.

- [ ] **Step 1: Write the fixture and the failing test**

Create `test/fixtures/quant-bars.json` — 300 synthetic daily bars trending 100→160 with three -6%/5-bar dips (dates 2025-01-01 onward, one bar per calendar day; generate deterministically):

```js
// generate once inside the test setup instead of a checked-in file if simpler —
// but the checked-in file keeps the CLI test byte-stable. Generator:
// closes[i] = 100 + i*0.2, except i in {60..64, 140..144, 220..224} where a
// -8% dip from the local level is applied linearly and recovers over 10 bars.
```

Create `test/quant-evidence.test.mjs` (same spawn pattern as `test/freshness-gate.test.mjs`):

```js
// quant-evidence.test.mjs — CLI behavior, offline via --bars-file. No network.
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
  const { code, out } = run(["--ticker", "TEST", "--setup", "move", "--horizon", "10"]);
  assert.equal(code, 1);
  assert.match(out, /--threshold/);
});

test("dry-run computes events, stats and a grade from a bars file, writes nothing", () => {
  const { code, out } = run([
    "--ticker", "TEST", "--setup", "move", "--threshold", "-5", "--window", "5",
    "--horizon", "10", "--bars-file", BARS, "--dry-run"
  ]);
  assert.equal(code, 0);
  assert.match(out, /EVENTS/);
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/quant-evidence.test.mjs`
Expected: FAIL — CLI does not exist.

- [ ] **Step 3: Implement the CLI**

`scripts/quant-evidence.mjs` — zero-dep, house header style. Core shape:

```js
#!/usr/bin/env node
// quant-evidence.mjs — setup base rates for one ticker, graded and logged.
//
//   node scripts/quant-evidence.mjs --ticker CEG --setup move --threshold -5 --window 5 --horizon 21
//   node scripts/quant-evidence.mjs --ticker NVDA --setup breakout --lookback 20 --horizon 10
//
// Counts what actually happened the last N times; refuses to pretend a thin
// sample is knowledge (the grade is the point). Appends every run to
// db/quant-runs.json — a run is not finished until a QR id has been echoed.
// Framework: prompts/trading-copilot-v28.md §QUANT EVIDENCE.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectEvents, independentCount, forwardReturns, summarize, gradeEvidence, barsSpanYears } from "../server/evidence.js";
import { benchmarkFor } from "../server/scoring.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS_PATH = resolve(ROOT, "db", "quant-runs.json");
const ARCHIVE_PATH = resolve(ROOT, "db", "archive.json");

// ---- args ----
const argv = process.argv.slice(2);
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const has = (f) => argv.includes(f);
const refuse = (msg) => { console.error(`REFUSED: ${msg}`); process.exit(1); };

const ticker = valueOf("--ticker")?.toUpperCase() || refuse("--ticker is required");
const setupKind = valueOf("--setup") || refuse("--setup is required (move | breakout | breakdown)");
const horizon = Number(valueOf("--horizon"));
if (!Number.isFinite(horizon) || horizon < 1) refuse("--horizon must be a whole number of bars >= 1");
// build setup object; move requires --threshold, breakout/breakdown take --lookback (default 20)
// --row must exist in db/archive.json when given
// ---- bars: --bars-file fixture, else getDatedCloses(ticker, {range}) (dynamic import so offline tests never load network code paths)
// ---- compute: detectEvents -> independentCount -> forwardReturns(+bench) -> summarize -> gradeEvidence
// ---- print report:
//   QUANT EVIDENCE — TEST move -5% / 5 bars -> 10 bars forward
//   DATA    yahoo, 2021-08-30 .. 2026-08-29 (5.0y, 1256 bars)
//   EVENTS  14 raw, 9 independent at this horizon, 1 pending (excluded)
//   FORWARD win 55.6% · avg +1.9% · median +2.4% · best +12.1% · worst -9.8%
//   VS SPY  avg alpha +0.7 · alpha win 44.4%
//   GRADE   C — 9 independent event(s) over 5.0y (14 raw) — directional at best...
//   (--dry-run: nothing logged)  OR  (QR-003 logged -> db/quant-runs.json)
// ---- persist (unless --dry-run): append row, id QR-### (max existing + 1, zero-padded 3)
```

The run row written to `db/quant-runs.json` (append-only array; file created with `[]` semantics on first run):

```json
{
  "id": "QR-001",
  "date": "2026-08-30",
  "ticker": "CEG",
  "benchmark": "SPY",
  "setup": { "kind": "move", "windowDays": 5, "thresholdPct": -5 },
  "horizon_bars": 21,
  "range": "5y",
  "source": "yahoo",
  "bars_span": { "first": "2021-08-30", "last": "2026-08-29", "years": 5.0, "bars": 1256 },
  "events": 14,
  "independent": 9,
  "pending": 1,
  "stats": { "n": 13, "win_rate": 55.6, "avg_pct": 1.9, "median_pct": 2.4, "best_pct": 12.1, "worst_pct": -9.8, "avg_alpha": 0.7, "alpha_win_rate": 44.4 },
  "instances": [ { "date": "2022-01-24", "entry": 61.2, "exit_date": "2022-02-23", "exit": 64.1, "pct": 4.74, "alpha": 6.1 } ],
  "grade": "C",
  "grade_why": "9 independent event(s) over 5.0y (14 raw) — directional at best: thin sample or single regime",
  "row_ref": "B-220",
  "note": null,
  "engine": "bench-native",
  "created_at": "2026-08-30T18:00:00.000Z"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/quant-evidence.test.mjs`
Expected: all pass.

- [ ] **Step 5: One live smoke run (network), linked to the CEG row**

Run: `node scripts/quant-evidence.mjs --ticker CEG --setup move --threshold -5 --window 5 --horizon 21 --range 5y --row B-220 --note "slice-1 smoke: CEG 5-bar -5% dips, 1-month forward"`
Expected: report prints with real Yahoo data; `QR-001 logged`; `db/quant-runs.json` exists with one row. (If Yahoo is down, Stooq fallback; if both fail, the refusal is the correct outcome — retry later, do not fake.)

- [ ] **Step 6: Commit**

```bash
git add scripts/quant-evidence.mjs test/quant-evidence.test.mjs test/fixtures/quant-bars.json db/quant-runs.json
git commit -m "feat: quant-evidence CLI - graded setup base rates, persisted to db/quant-runs.json"
```

---

### Task 6: `prompts/trading-copilot-v28.md`

**Files:**
- Create: `prompts/trading-copilot-v28.md` (copy of v27 + the changes below; v27 untouched)

**Interfaces:**
- Consumes: the QR row shape and grade ladder from Tasks 4–5.
- Produces: the governing framework file future sessions load.

Changes, exactly these and nothing else:

- [ ] **Step 1: Copy v27 to v28**

```bash
cp prompts/trading-copilot-v27.md prompts/trading-copilot-v28.md
```

- [ ] **Step 2: Prepend the v28 changelog block** (above the v26→v27 entry, matching the existing stacked-changelog style). Content (verbatim):

```markdown
## WHAT CHANGED — v27 → v28 (2026-08-30)

**One addition: the QUANT EVIDENCE leg.** The Bench gained a base-rate engine
(`scripts/quant-evidence.mjs`, graded A–F) and its checkpoint calibration went
live (all rows backfilled via `scripts/score-book.js`). v28 defines when quant
evidence is pulled, how it is weighed, and where it is logged. Every gate,
floor, lane and the 10% risk band from v27 is untouched. Decision, per Adam
2026-08-30: The Bench stays the system of record and decision framework;
external quant engines (Vibe-Trading) are deferred and, if ever mounted, are
an optional laboratory feeding this section — never a replacement for it
(docs/integrations/vibe-trading-audit.md).
```

- [ ] **Step 3: Insert the new section** after `THE SELF-AUDIT LOOP` (verbatim):

```markdown
## QUANT EVIDENCE (v28)

**On demand, never by default.** Pull quant evidence when (1) the thesis makes
a testable historical claim ("dips like this get bought", "breakouts here
follow through"), (2) Adam asks ("backtest this", "try to disprove this
setup"), or (3) the Self-Audit Loop needs a base rate to judge a proposed rule
change. An ordinary run with no historical claim carries no quant section —
padding every review with numbers that do not change the decision is noise,
not proof.

**The tool:** `node scripts/quant-evidence.mjs --ticker X --setup move|breakout|breakdown ...`
It counts what happened the last N times, benchmarks it, and grades the
evidence. It never predicts.

**The grade travels with the number, always:**
- **A** — ≥30 independent events across ≥5 years. Strong.
- **B** — ≥15 independent events across ≥2 years. Useful.
- **C** — thin sample or single regime. Directional at best.
- **D** — under 5 independent events. An anecdote with a spreadsheet.
- **F** — nothing observable, or broken data. Does not exist as evidence.

**The weighing rule:** quant evidence is one input to the existing gates, never
a gate itself. A-grade evidence can move a Conviction Tier judgement or
sharpen an invalidation; C/D/F evidence can never outrank primary evidence
(price, catalyst, liquidity, risk arithmetic) and is reported with its grade
so the reader sees exactly how little it proves. A beautiful base rate is
never a buy signal, a Sharpe ratio is never a buy signal, and no backtest
overrides an ATR Floor, the risk band, or a refusal.

**Try to kill it:** when quant evidence supports the thesis, state in one
sentence what would falsify it and, when cheap, run the opposite test (the
stop-review brief of 2026-08-20 is the house template — it refuted its own
premise and that was the finding).

**LOG IT applies:** every quant run is appended to `db/quant-runs.json` with a
QR id, and an analysis that used one cites it (`QR-###`) next to the row id.
A quant claim with no QR id is hype, not proof.

**Output shape when the section appears** (between MARKET + SECTOR CONTEXT and
the verdict sections):

QUANT EVIDENCE
- Setup tested: <plain-English one-liner>
- Sample: N events (M independent), YYYY–YYYY, source
- Forward: win %, avg, median, best, worst · vs benchmark: alpha
- Evidence grade: A–F — why
- Run: QR-###

BENCH INTERPRETATION
- One or two sentences: what this actually changes about the thesis — and
  explicitly "nothing" when it changes nothing. ("The base rate supports the
  setup, but valuation and catalyst asymmetry keep this a WATCH" is a
  complete interpretation.)
```

- [ ] **Step 4: Point the calibration paragraph at live checkpoints.** In the `BENCH ARCHIVE` section's confidence-calibration paragraph, append one sentence:

```markdown
As of v28 the checkpoint scorer is live across the whole book
(`node scripts/score-book.js`) — calibration is measured, not promised.
```

- [ ] **Step 5: Update the REQUIRED OUTPUT FORMAT section list** to include `QUANT EVIDENCE + BENCH INTERPRETATION (only when invoked — see §QUANT EVIDENCE)` in its proper position.

- [ ] **Step 6: Verify v27 untouched, commit**

```bash
git diff --stat prompts/trading-copilot-v27.md   # expect: empty
git add prompts/trading-copilot-v28.md
git commit -m "framework v28: the QUANT EVIDENCE leg - graded base rates, on demand, never a buy signal"
```

---

### Task 7: Documentation — the audit record and the operating manual

**Files:**
- Create: `docs/integrations/vibe-trading-audit.md`
- Modify: `CLAUDE.md` (three surgical edits)

- [ ] **Step 1: Write `docs/integrations/vibe-trading-audit.md`** — the capability map recording the 2026-08-30 decision. Sections: (1) what was audited (both repos, dates, upstream commit/release v0.1.14, MIT license); (2) the capability table — each Vibe-Trading capability vs the existing Bench capability with KEEP/EXTEND/DEFER/IGNORE and reason (backtest engine → DEFER to slice 2 via pinned MCP; data loaders → IGNORE for live / DEFER for long history; hypothesis registry → IGNORE, `db/patterns.json` + Thesis Ledger already exist; run cards → ADAPT, shape borrowed for `db/quant-runs.json`; swarms/UI/broker layer/trade journal → IGNORE with reasons); (3) the architecture decision (Bench = system of record; slice 1 native, slice 2 = optional pinned MCP laboratory, feature-flagged, never on the unattended posting path, never with broker credentials); (4) the security note (Vibe-Trading ships live-broker connectors; pin to a release; isolated venv; stdio only; shell tools stay default-off); (5) slice-2 activation criteria (a real question needing walk-forward/Monte-Carlo/factor machinery that `quant-evidence.mjs` cannot answer).

- [ ] **Step 2: Edit `CLAUDE.md`:** (a) framework-version block: v28 is current, one change, v27 stays on disk; (b) repo-state note: correct the stale "Live system is not `main`" claim — the v27 merge (`aaef039`) put the live book and framework on `main` (code beats notes; say the correction happened 2026-08-30); (c) add two lines to the setup list: the quant-evidence command and the score-book calibration command, with the "on demand, never by default / never near the posting pipeline" rule.

- [ ] **Step 3: Commit**

```bash
git add docs/integrations/vibe-trading-audit.md CLAUDE.md
git commit -m "docs: vibe-trading capability audit + decision record; CLAUDE.md -> v28, stale main-note corrected"
```

---

### Task 8: Final verification and desk rituals

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: baseline tests + evidence + quant-evidence CLI tests all pass.

- [ ] **Step 2: Site build sanity**

Run: `node site/build.mjs` — succeeds, record non-zero. No deploy.

- [ ] **Step 3: Worklog + vault rituals**

Append to `C:\Users\steam\Projects\docs\handoffs\worklog\2026-08-30.md` a `**[Claude]**` entry: CLAIMED (no tickers — infrastructure; note that checkpoint backfill wrote scoring fields across all book rows so other desks re-read before citing), TOUCHED, PRODUCED, LEFT. Append `**[Claude]**` bullets to the vault `Daily/2026-08-30.md`; update the Bench hub frontmatter (`version: v28`); add a Dev Log line; add/refresh Open Loops rows (slice 2 deferred; README/executor-validate version drift left as-is).

- [ ] **Step 4: Report to Adam** — the ten-point closeout from the original handoff (discovered / architecture / files / capabilities / tests / broken / setup / remaining Vibe capabilities ranked / security / next step), plus the explicit leftovers: push+PR awaiting his word, site deploy awaiting his word, `executor-validate.mjs` still pins v26, README still says v25/137 rows.

## Self-Review

- Spec coverage: backfill (T3), base-rate testing (T4–5), evidence grading (T4), persisted runs (T5), v28 (T6), audit doc + decision record (T7), Vibe-Trading deferred (T7), no publishing-path contact (global), zero deps (global). Handoff items intentionally out of scope are recorded in the audit doc, not silently dropped.
- Type consistency: bar shape `{date, close}` everywhere; `gradeEvidence` consumes `independentCount` output; CLI consumes exact Task-4 exports.
- No placeholders except the CLI body sketch in Task 5 Step 3, which is intentionally elided where it repeats Task 4's exact call signatures and the printed report/JSON shapes shown in full beside it.
