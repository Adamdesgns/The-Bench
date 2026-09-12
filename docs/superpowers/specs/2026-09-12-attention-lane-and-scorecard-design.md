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

### A1. Attention feed builder (new)

`scripts/attention-feed.mjs` writes `db/prepump/attention/YYYY-MM-DD.json`.

Sources, in order:

1. **`db/archive.json`** - every row whose `date` equals the session date.
   Measured yield for 2026-09-11: 33 rows, 15 unique tickers.
2. **`docs/reads/YYYY-MM-DD-*.md`** - tickers named in that day's read files.
   This is what catches HPE, ANET, SNDK, STX, WDC and SOXL, none of which were
   logged to the book on 2026-09-11 despite leading the closing read.

Extraction rule for the markdown source, deliberately conservative:

- Match `\b[A-Z]{1,5}\b` only, then intersect against a resolvable-symbol set.
- The resolvable set is a cache, `db/prepump/attention/known-symbols.json`,
  seeded from the 460 core names plus every ticker ever seen in
  `db/archive.json` and `db/watchlist.json`. A token already in the cache costs
  nothing. Only a genuinely novel token is resolved live through
  `get_equity_fundamentals`, and the verdict is written back to the cache so it
  is resolved once, ever. An unresolvable token is dropped, never guessed.
- Maintain `db/prepump/attention/stoplist.json` for English words that are also
  tickers (`IT`, `ON`, `ALL`, `NOW`, `BY`, `SO`, `AN`, `OR`, `ARE`, `CEO`...).
- Every accepted symbol records `why`: the file and line it came from.

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

Add `bet` to `server/scoring.js` `DECLARED_TYPES` with an explicit direction
rule. 23 rows predating B-035 carry no `call_type` at all and are currently
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

19 MB, one copy, gitignored. Options, recommended first:

1. **Track it in git.** Remove `db/prepump/*.ndjson` from `.gitignore` and
   commit. The vault already auto-pushes to a private GitHub repo every 15
   minutes; the same pattern gives this dataset an offsite copy for free.
   NDJSON compresses well and 19 MB is not a problem at this scale. Growth is
   roughly 1 MB per session, so about 250 MB a year - fine for years, worth
   revisiting if the universe ever doubles.
2. A scheduled copy into the OneDrive-synced tree.

Either way: **the dataset is not durable today and that must change before more
days accumulate.** Recommend option 1 and a one-time backfill commit of the
four sessions already collected.

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
