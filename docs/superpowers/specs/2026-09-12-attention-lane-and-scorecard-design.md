# Attention lane, scorecard, and dataset durability

Date: 2026-09-12
Status: design, approved in conversation, not yet implemented
Repo: `Projects/apps/the-bench`
Branch at time of writing: `v29-hunter-handoff` (dirty, 15 modified files, 5 untracked)

---

## 0. What already exists

This is not a greenfield build. Most of the machinery is already running and
correct. Stating it here so the plan does not rebuild it.

| Piece | State | Evidence |
|---|---|---|
| Daily pre-pump capture | Running since 2026-09-08 | `db/prepump/YYYY-MM-DD.ndjson`, 4 files |
| Collector | Complete, disciplined | `scripts/prepump-collect.mjs` |
| Forward labeler | Built, never fired | `scripts/prepump-outcomes.mjs` |
| Book scorer | Running, output goes nowhere | `server/scorecard.js`, `scripts/score-book.js` |
| Pattern ledger | Working, 32 patterns / 67 instances | `db/patterns.json` |
| Capture schedule | Weekdays 16:30 CT | task `bench-prepump-snapshot` |
| Label schedule | Saturdays 12:00 CT | task `bench-prepump-outcomes` |

Measured state of the capture, 2026-09-11 session: 593 rows.
448 tagged `core` only, 133 `scan` only, 12 both. Every row `status: ok`.

Measured state of the book, `db/archive.json` at 2026-09-12: 367 rows.
282 carry a populated `checkpoints` object. 369 checkpoint entries exist in
total: 282 at `1w`, 87 at `1m`, **zero at `3m`**. Verdicts across those 369:
right 159, wrong 155, flat 33, not_scorable 22.

---

## 1. The problems, in priority order

### P1. The dataset has exactly one copy

`db/prepump/` is 19 MB, is listed in `.gitignore:42-45`, and is untracked.
It exists on one disk in one house. Its own collector header says
"Every day we don't collect is a day we can't get back", which is equally true
of every day already collected. This is the highest-consequence problem in the
document and the cheapest to fix.

### P2. The capture does not contain the names the desk actually watches

Of the 17 names from the 2026-09-11 screen, only ORCL, META and IREN were
captured. MRVL, HPE, COHR, AIP, VNET, AMAT, PENG, SNDG, AMBA, SPCX, AVAV, SST
and UBER were not. This is by construction, not by accident: the 460-name core
is a stratified statistical sample, not a coverage list.

### P3. Nothing reads the scored book back

282 rows are scored with alpha against SPY and no code has ever aggregated
them. A throwaway aggregation run on 2026-09-12 produced this:

| Bucket | n | Win rate | Avg alpha |
|---|---|---|---|
| conditional, 1w | 122 | 46% | -0.02 |
| pass, 1w | 106 | 40% | +1.58 |
| long, 1w | 28 | 50% | +0.78 |
| conditional, 1m | 31 | 35% | +5.71 |

Passes split 42 right (mean alpha -5.83, correctly skipped) against 44 wrong
(mean alpha +9.45, ran without us). Near coin-flip frequency, misses 1.6x the
size of the saves. That is a finding the desk has never seen.

### P4. Two live defects

- `server/bookLog.js` accepts `call_type: "bet"`; `server/scoring.js`
  `DECLARED_TYPES` does not include it. All 3 bet rows score not_scorable.
- `scripts/score-book.js` writes its product to `../x-poster/queue/`. The X
  channel was retired 2026-09-03. The scorer's output goes nowhere.

---

## 2. Non-goals

- **No predictive model.** Four sessions of data cannot fit anything. The
  earliest labelable row is ~2026-09-22. A screener is October work at the
  earliest and is explicitly out of scope here.
- **No edit to `universe-core.json`.** The file is sealed by its own
  `_status`. If the sample must ever change, it becomes `universe-core-v2.json`
  alongside, never an edit.
- **No writes to `db/archive.json` from the attention lane.** See invariant I2.
- **No public publishing.** The site is down by standing order. All output is
  local or ntfy.

---

## 3. Part A: the attention lane

**Deadline: Monday 2026-09-14, 16:30 CT.** Every session that passes without
this is unrecoverable coverage.

### A1. Desk feed builder (new)

> **Corrected 2026-09-12 22:30 CT.** The source tag is `desk`, not `attention`.
> `server/bookLog.js:39-40` already uses "attention-sourced" to mean names that
> arrived by tweet or headline, the opposite of hunter-sourced. Reusing the word
> for a different concept would mislead anyone joining book origin to capture
> source. Everywhere below that says "attention", read `desk`.
>
> Measured against real 2026-09-11 data, the rules below catch all 13 target
> names (HPE, ANET, SNDK, STX, WDC, SOXL, DELL, NVDA, MU, ORCL, CEG, VRT, SMCI)
> with a known set of 607 symbols and **no live broker call**. Reads write
> company names more often than tickers for 10 of 20 board names (Oracle 47 vs
> ORCL 9), so an alias map is required, not optional. A chat screen that never
> touches disk (the 17-name list) can only be captured by a manual add.

`scripts/desk-feed.mjs` writes `db/prepump/desk/YYYY-MM-DD.json`.

Sources, in order:

0. **Manual adds** - `db/prepump/desk/manual/YYYY-MM-DD.json`, written by
   `node scripts/desk-feed.mjs add --date D --symbols A,B,C --note "..."`.

1. **`db/archive.json`** - every row whose `date` equals the session date.
   Measured yield for 2026-09-11: 33 rows, 15 unique tickers.
2. **`docs/reads/YYYY-MM-DD-*.md`** - tickers named in that day's read files.
   This is what catches HPE, ANET, SNDK, STX, WDC and SOXL, none of which were
   logged to the book on 2026-09-11 despite leading the closing read.

Extraction rule for the markdown source, measured on 46 read files:

- **Strip book and pattern ids first** (`B-360`, `P-032`, `QR-019`, `R-017`).
  Without this, `B` is the most frequent "ticker" in the corpus at 135 hits.
- Match `\b[A-Z]{2,5}\b`. The two-letter floor removes `I`, `P`, `R`, `A`, `C`,
  `D`, `B`, `S`, `T`.
- Keep a token only if it is in the **known set**: every symbol in
  `universe-core.json`, `archive.json` tickers, `watchlist.json` `sym`,
  `board.json` layer `tickers` and added/removed `sym`, `tape.json` quotes `sym`,
  and `catalysts.json` tickers. Measured size 607. Captured `.ndjson` symbols
  are deliberately **excluded**: they added 122 names, and the ones they added
  were the false positives (`ET`, `FAST`, `B`, `S`).
- Drop anything on `db/prepump/desk/stoplist.json`, seeded with `AI AT ET FAST
  HP OPEN BAND SAIL PUMP NOW ALL ON IT SO ARE BY AN OR BE GO UP CEO US`.
- Resolve company names through `db/prepump/desk/aliases.json`, case-sensitive,
  letter-bounded. "Meta" and "Coherent" are excluded as ordinary English words.
- **No live resolution.** A token outside the known set is recorded as rejected
  and never collected. The feed calls no broker tool.
- Every accepted symbol records `why`: source, file, line and whether it came in
  by ticker, alias, book row or manual add.
- Instrument class (fund, index, crypto) is **not** decided here. Collection
  stays label-free (I4); any analysis that deliberately includes `desk` rows
  derives class later from the row's own fields.

The builder is **read-only** against every source it reads.

### A2. Instrument gate

`universe-core.json._floors` restricts the sample to US-listed common stock, no
ETFs, funds, trusts or crypto. The desk's reads touch SPY, QQQ, SOXL and SNDG
(a 2x leveraged fund on SNDK), none of which are common stock.

Rule: attention symbols that fail the common-stock test are **captured with a
tag, and excluded from every outcome computation**. They are not dropped,
because knowing the desk watched SPY that day is itself data. But
`prepump-outcomes.mjs` benchmarks every row against SPY, so SPY-vs-SPY alpha is
structurally zero and crypto has no float at all.

Field: `instrument_class` in `{common, fund, index, crypto, unresolved}`.

### A3. Collector change

Three insertions in `cmdPlan()` of `scripts/prepump-collect.mjs`:

1. After the scan-file loop (~:170), read
   `db/prepump/attention/<date>.json` into `attentionSyms` if it exists.
2. Widen the union (~:172) to
   `[...new Set([...core, ...scanSyms, ...attentionSyms])].sort()`.
3. Add a third tag at the `source` assignment (~:186):
   `attentionSyms.has(s) ? "attention" : null`.

Plus a fourth counter in the plan's `counts` object and in the manifest, so a
silent miscount is visible.

Nothing else changes. Batching at ~:190-194 chunks the union, so the courier
fetches the new names automatically. `cmdBuild` copies `p.source` verbatim.

### A4. Base-rate protection

**This is the reason the design is a separate lane rather than a wider core.**

`universe-core.json._purpose` reads: "The DENOMINATOR for a pre-pump base rate.
Every one of these names is recorded every trading day whether or not it does
anything." `_known_limitations` warns that a non-random change to the
denominator inflates every rate computed from it.

Attention names are selected *because* something happened to them. That is
textbook non-random inclusion. Therefore:

> **Invariant I1.** Any base rate computed from this dataset filters to
> `source` containing `core`, unless the computation explicitly and in writing
> declares it is doing something else.

This invariant is enforced in code, not documentation: the aggregation helper
takes a required `population` argument with no default.

### A5. Test and dry run

`scripts/prepump-collect.mjs` currently has **no test**. `test/` holds 10 files
and none covers the collector. A change landing on a scheduled daily job with no
harness is how the dataset breaks silently.

Minimum bar before Monday:

- A unit test over `cmdPlan`'s union and tagging, with a fixture attention file.
- A live `plan --date 2026-09-11 --dry-run` against the real attention feed,
  comparing symbol count and tag distribution to the recorded 593/448/133/12.

### A6. First-run cost

`prepump-collect.mjs:129` gives any symbol with no entry in
`history-state.json` a full historicals window unconditionally. Every attention
name is new on day one, so Monday's run pays `ceil(N/10)` extra
`get_equity_historicals` calls - the most expensive leg, on the most important
run.

Expected N on a normal day is 15 to 40 names, so 2 to 4 extra calls. That is
acceptable and no staggering is needed. But the plan output must print the
first-appearance count before the build runs, so a day that suddenly wants 200
history windows is visible rather than silently expensive.

### A7. Timing check (resolved)

The attention feed must run after the day's reads are logged and before the
capture. Confirmed from the task registry:

| Task | Time (CT) |
|---|---|
| bench-power-hour-post | 14:07 |
| bench-closing-bell-post | 15:10 |
| bench-plan-check-close | 15:20 |
| **bench-prepump-snapshot** | **16:30** |

All logging routines complete before 16:30. The feed builder runs as step 0 of
the snapshot task.

---

## 4. Part B: the scorecard

No deadline. Reads a file that is not going anywhere.

### B1. Fix `call_type` once

Add `bet` to `server/scoring.js` `DECLARED_TYPES`, and score it **not_scorable
with an honest reason**, never as a long.

> **Corrected 2026-09-12 22:30 CT.** The first draft said to give `bet` a
> direction rule. All three bet rows are options structures (B-091 and B-092 are
> an IWM 304C shadow test at a 2.15 premium; B-335 is an MU call spread). The
> scorer prices the underlying, so B-091 already carries `asset_pct: 13851.63`.
> Scoring it like a long would write an alpha near +13,853 and one row would
> dominate every mean in the scorecard. Today's not_scorable result is the safe
> outcome; the fix is only to state the right reason
> ("bet - an options structure; checkpoints price the underlying, not the
> contract") instead of "call phrasing not recognised". 23 rows predating B-035 carry no `call_type` at all and are currently
classified from prose; the scorecard must report declared and prose-classified
rows as separate provenance, never silently pooled.

### B2. Aggregator (new)

`scripts/scorecard.mjs`, read-only over `db/archive.json`. Groups the scored
checkpoint entries and reports win rate and mean alpha by:

`call_type` x horizon, `origin`, `engine`, `confidence_pct` band, `fomo`,
`market_risk`, and ticker.

Rules that keep it honest:

- **Minimum n.** A cell with fewer than 8 entries prints its count and
  suppresses the rate. Splitting `call_type` by `fomo` (10 values, 200 nulls)
  drops cells to single digits fast.
- **Normalise `fomo` case variants** (`LATE FOMO` vs `Late FOMO`) before
  grouping, and say in the output that it did.
- **Surface the dead band.** `server/scoring.js` `DEAD_BAND = 1.0` turns small
  moves into `flat`. Flats are displayed, never folded into losses.
- **Declare the horizon.** Until 2026-09-28 every statistic is a one-week alpha
  statistic. The header says so, with the date the first `3m` checkpoint lands.
- **Name the population.** "282 rows carry a checkpoint, 369 checkpoint entries
  exist, this table counts entries with a non-null verdict and alpha."

### B3. Pattern report (separate)

`db/patterns.json` is the other honest reading of "which setups earn their
keep": 32 falsifiable claims, 7 supported / 24 proposed / 1 refuted, 67
instances.

Its instances carry **no book id**, so it cannot be joined to the book. Do not
invent a `date`+`ticker` join; 2026-09-11 alone has 33 book rows over 15
tickers and the join would be lossy in both directions. The pattern report is
its own table: claim, status, instances, and how long a `proposed` claim has sat
without a second instance.

Separately, add `row_ref` to the instance schema going forward so the join
becomes possible later.

### B4. Delivery

Local only. A CLI table from `scripts/scorecard.mjs`, plus a written summary
into the weekly recap that already runs Saturdays 11:03 CT. Nothing to X,
nothing to the site.

### B5. Retire the dead path

`scripts/score-book.js` stops writing to `../x-poster/queue/`. Its product
becomes the local scorecard.

---

## 5. Part C: make it a treasure trove

### C1. Back up the dataset

> **Corrected 2026-09-12 22:30 CT, before implementation.** The first draft of
> this section recommended committing the row data to git. That contradicts a
> documented decision in `.gitignore:37-40`: the rows are "Robinhood market data
> pulled under Adam's personal access - not licensed for redistribution, and a
> private GitHub repo is still an off-machine copy. It stays on this machine."
> OneDrive is also off-machine. Growth is ~1.8 MB/day (~450 MB/yr), not 1 MB.

Two different kinds of file live under `db/prepump/`, and they get different
treatment:

> **Also found 2026-09-12 23:40 CT:** the capture code has never been committed
> either. `git ls-files` and `git log` return nothing for
> `scripts/prepump-collect.mjs`, `prepump-session.mjs`, `prepump-outcomes.mjs`
> or `test/prepump-session.test.mjs`, and the `.gitignore` block that keeps the
> row data out of git is an uncommitted 13-line working-copy change. Plan Task 1
> commits all of it unchanged, before any task edits the collector.

1. **Definitions - commit them now.** `universe-core.json`,
   `nyse-calendar-2026-2028.json` and `runs/*.json` are explicitly "DELIBERATELY
   NOT IGNORED... must be versioned" (`.gitignore:41-44`), and `git ls-files
   db/prepump/` returns **zero files**. The sealed denominator the whole dataset
   depends on has never been committed. Commit locally; pushing is Adam's word.
   Note that `universe-core.json` carries `*_at_freeze` prices sourced from the
   broker; the 2026-09-05 decision already chose to version it.
2. **Row data - on-machine only, and Adam decides.** `*.ndjson`,
   `history-state.json`, `raw/` and `outcomes/` stay out of git. The only backup
   compatible with the licensing decision is a second copy on this PC (another
   drive or an external disk). That protects against deletion and corruption,
   not against losing the machine. **Adam owns this call.**

### C2. Record the schema and the decisions

`docs/prepump-dataset-findings.md` exists and is untracked. Track it.

---

## 6. Invariants

- **I1.** Base rates filter to `source` containing `core`. Enforced by a
  required argument, not by a comment.
- **I2.** The attention lane never writes to `db/archive.json`. It reads
  tickers. If it ever wrote rows, Part B's denominator would move underneath it.
- **I3.** `universe-core.json` is never edited. A change is a v2 file alongside.
- **I4.** Collection stays label-free. Outcomes remain a separate, repeatable
  job so the definition of a pump can change without recollecting.
- **I5.** Append-only. A past `.ndjson` is never rewritten; a correction is a
  new row with a later `observed_at`.

---

## 7. Sequencing

1. **C1 backup** - today. Cheapest, highest consequence, unblocks nothing but
   protects everything.
2. **A1-A6 attention lane** - before Monday 16:30 CT. Hard deadline.
3. **B1 call_type fix** - shared dependency, do before B2.
4. **B2-B5 scorecard** - no deadline.
5. **B3 pattern report** - after B2.

A and B share no module and no import. They are coupled only through
`db/archive.json`, which A reads and B consumes, and through `call_type`, which
is fixed once in `server/scoring.js` and consumed by both.

---

## 8. Open questions

1. **Branch.** The tree is dirty on `v29-hunter-handoff`, and Codex holds two
   worktrees (`codex/the-xecutor`, `codex/wall-street-2026`). This work needs
   its own branch and a stated owner to respect the append-only rule.
2. **Stale `scorecard` branch.** Two unique commits ("Score the book",
   "Backfill the triggers v17 wrote as prose, and rescore") have never been
   reconciled. The scorer they describe is present in the working tree, so they
   are probably superseded, but that should be confirmed and the branch closed.
3. **`docs/scorecard-spec.md` is a historical artifact.** It describes a 22-row
   book. It must be marked as such or rewritten, so nobody specs against it.
