# SCORECARD — scoring the book, whether or not a trade was taken

> **HISTORICAL as of 2026-09-12.** This spec was written for the 22-row book of 2026-07-28 and every count in it dates from then. The book is now 367 rows. The verdict rules it describes are still the ones in `server/scoring.js` (plus `bet`, declared 2026-09-12 as not scorable). Current design: `docs/superpowers/specs/2026-09-12-attention-lane-and-scorecard-design.md`. To read the scored book back: `node scripts/scorecard.mjs`.

Status: approved 2026-07-28. Implements the closing half of the archive that
`reconcile.js` promised in its header and never had.

## 2026-10-04: price basis, book labels and corrections

An independent recompute of the book found two stored checkpoints that were
scorer artifacts, not calls. Both are fixed in the scorer. Neither row's text
was edited.

**What was wrong**

| Row | Stored | Cause | Correct |
|---|---|---|---|
| B-325 MGN, 1w | `wrong`, alpha +1939.96 | Logged at a raw 0.1823 on 9/10. A 1-for-30 reverse split took effect 9/17. Yahoo's `close` is split-adjusted all the way back, so the end price (3.72) was on the new share basis and the start price was on the old one. | `right`, alpha -32.61 (entry 0.1823 x 30 = 5.469) |
| B-509 CASH, 1w | `right`, alpha -92.03 | A capital-allocation row logged under the label "CASH". CASH is also the real symbol of Pathward Financial, so the scorer priced it. | `not_scorable` |

**The rules now**

1. **Book labels are never priced.** `isInstrument()` in `scoring.js` refuses
   `CASH`, `BOOK`, `ACCOUNT`, `PORTFOLIO` and anything that is not shaped like
   a symbol. No price is fetched. The checkpoint says `not an instrument` and
   is written once, not on every run.
2. **Splits are carried into the entry.** `getDatedCloses()` asks Yahoo for
   split events with the bars. A logged `review_price` is multiplied by
   `denominator / numerator` for every split that took effect after the review
   day. The checkpoint records `entry` (the start price actually used) and
   `split_factor` (only when it is not 1). A conditional's trigger level is
   carried across the same splits.
3. **A split on the review day is not guessed.** The logged price could be on
   either basis, so the row scores `not_scorable` with that reason.
4. **Basis backstop.** After split adjustment the entry must sit within 2x of
   the series close on the review day, or the row scores `not_scorable` with
   the two numbers in the note. This catches a split the feed never reported
   and a label that happens to be a real symbol. Measured on 711 rows: every
   genuine row sat between 0.72x and 1.14x. Only B-325, B-509 and two option
   premiums (already typed `bet`) were outside 0.5x to 2x.
5. **Missing price series are printed by name.** `score-book.js` ends with a
   `NO PRICE SERIES` block instead of a quiet `price not observable`.

**Corrections: `--recheck`**

Real verdicts are still append-only on a normal run. The one exception is
explicit:

```
node scripts/score-book.js --recheck --dry-run --no-draft   # look
node scripts/score-book.js --recheck --no-draft             # apply
```

`--recheck` re-fetches every ticker that has a settled checkpoint and
re-scores only what it can prove was an artifact: a book label, a basis
mismatch on a checkpoint written before the check existed, or a split that
was already in the series on the day the checkpoint was scored and not in
its entry. A split that landed after a checkpoint was scored does not count:
that verdict was computed on one basis and stands. The old verdict is kept
inside the new checkpoint:

```json
"supersedes": { "verdict": "wrong", "alpha": 1939.96, "asset_pct": 1940.59,
                "price": 3.72, "note": "...", "scored_at": "...", "reason": "..." }
```

A real verdict is never replaced by `price not observable`. If the prices
needed to redo it are missing, it waits for a run that has them. Corrections
are printed in their own block and stay out of the tally and the draft.

`--recheck` also goes back for rows the scorer itself closed as `Unscored`
because no price series could be fetched. A closed row is never due again, so
without this a fixed symbol would never reach the row it was fixed for. A row
a person closed carries their outcome and is never reopened.

**ZEC and HYPE**

Both had no price series. ZEC was missing from the crypto list, so it was
fetched as a stock with no bars. HYPE's plain pair answers 404 on Yahoo, which
lists Hyperliquid as `HYPE32196-USD`. Both are mapped now, and both series
were checked against Robinhood's live quotes on 2026-10-04 (ZEC 1346.52 vs
1346.36, HYPE 90.93 vs 90.97). Robinhood itself cannot feed the scorer: its
connector has live crypto quotes but no dated crypto history, and a script
cannot call the connector. B-309 (ZEC) scores on the next run. B-017 (HYPE)
was closed as `Unscored` and scores on the next `--recheck`.

**Where each leg starts (known limit)**

The asset leg starts at the logged `review_price`, which is a print at the
time of the review. The benchmark leg starts at a daily close. Two cases:

- **Logged the evening before, or over a weekend** (42 rows as of 2026-10-04,
  for example `review_time: "2026-09-09 21:52 CT after the close"` on a row
  dated 9/10). The benchmark used to start at the close of `row.date`, one
  session after the asset. **Fixed going forward:** `reviewDay()` in
  `checkpoints.js` reads the session from `review_time` and both legs start
  there. Stored verdicts were not re-scored for this. Measured: 26 stored
  checkpoints start on a different session, the largest shift is 1.90 points
  of benchmark, and 4 verdicts near the dead band would flip (B-311, B-520,
  B-523, B-524).
- **Logged intraday.** The asset starts at the intraday print and the
  benchmark at that day's close. This is not fixed. Daily bars cannot fix it,
  and the error is at most one session of benchmark movement.

**Stooq is gone**

Its history endpoint has served a bot-wall since 2026-07-28 and its quote
endpoint now answers 404. It was removed from `dataProviders.js` on both
chains. `getDatedCloses()` is Yahoo only and returns an `error` when it fails.
`getQuote()` and `getDailyCloses()` are Alpha Vantage only; with no key or no
budget they return "not observable" with an `error` and warn once on stderr.
A Stooq series would also have carried no split events, so the scorer could
not have trusted it.

## Why this exists

`db/archive.json` was built with `outcome`, `outcome_price`, `pct_move`,
`lesson` and `grade_verdict` on every row. All of them are null on 21 of 22
rows. `reconcile.js` prices open rows and applies board deltas but contains no
code that ever closes one, and every row has `trigger: null` /
`invalidation: null`, so there is nothing for it to test against even in
principle.

The consequence: The Bench has a book and no track record.

This spec closes that loop. The output is two things at once, from one
mechanism:

1. **Learning** — which calls were right, which were wrong, and which passes
   were expensive.
2. **Content** — a weekly draft post backed by receipts instead of claims.

Both depend on the same rule, so the rule is written once, in one pure module,
and tested.

## The scoring rule

**A call is right when it beat its benchmark in the direction the call
implied.** No trade needs to have been taken. The book is graded on what it
said, not on what was executed.

### Benchmarks

| Asset | Benchmark |
|---|---|
| US equity | SPY |
| Crypto (except BTC) | BTC |
| BTC | SPY |

Crypto is graded against BTC because grading DOGE against the S&P measures the
crypto tide, not the call. `dataProviders.classify()` already distinguishes the
two and is reused rather than duplicated.

### Call types

Classified from `final_call` first, `hodl` second. `final_call` wins: B-010
carries `hodl: "Accumulate"` with `final_call: "No Trade — trigger: reclaim
$950 on volume"`, and the call is the decline.

Matching is on the leading phrase of `final_call`, case-insensitive:

| Type | Matches | Count in book |
|---|---|---|
| `pass` | `No Trade` | 8 |
| `hedge` | `Hedge` | 4 |
| `conditional` | `Watchlist`, `Top watchlist`, `ARMED`, `Setup Forming` | 8 |
| `long` | `Entered`, `Accumulate`, or `hodl: Accumulate` | 2 |

Anything unmatched classifies as `unknown` and scores `not_scorable`. Silence
is better than a guessed verdict.

### Verdicts

`alpha` = asset % move − benchmark % move, over the same window.

A **dead band of ±1.0 points of alpha** counts as `flat`. Without it, noise
reads as skill.

| Type | `right` when | `wrong` when |
|---|---|---|
| `long` | alpha > +1 | alpha < −1 |
| `pass` | alpha < −1 (correctly skipped) | alpha > +1 |
| `conditional` | trigger fired and alpha > +1, **or** trigger never fired and alpha ≤ +1 | otherwise |
| `hedge` | — | — |

`hedge` always scores `not_scorable`: no position, size or entry is recorded
anywhere, and a hedge P&L model would be invented rather than measured.

`conditional` scores `not_scorable` when trigger state is unknown, which is the
case until the trigger backfill below has run for that row.

### Expensive passes

A `pass` with alpha ≥ +10 is flagged `expensive pass` in its note. It is still
scored `wrong` by the rule — the flag exists because a pass that missed a large
run is the highest-value lesson in the book and must not read the same as a
pass that missed 2%.

## Checkpoints

Every row is scored at **7, 30 and 90 calendar days** after `date`, and closes
at 90.

Calendar days, not trading days: the benchmark and the asset are both read on
the nearest prior available close, so weekends and holidays resolve identically
for both sides and the alpha stays honest. Trading-day arithmetic would add a
market calendar dependency for no gain in accuracy.

Three checkpoints rather than one because the book mixes horizons — `"Setup
Forming — earnings gate Jul 22"` is a days-long call and `"Accumulate — kids'
UTMA"` is a multi-year one. One window cannot judge both.

## Data shape

Additive. Existing fields are never rewritten by the scorer.

```json
"checkpoints": {
  "1w": {
    "asof": "2026-07-07",
    "price": 342.10,
    "asset_pct": -3.5,
    "bench": "SPY",
    "bench_pct": 1.2,
    "alpha": -4.7,
    "verdict": "right",
    "note": "pass — correctly skipped",
    "source": "stooq",
    "scored_at": "2026-07-28T14:00:00.000Z"
  }
}
```

**Checkpoints are append-only for real verdicts.** `right`, `wrong` and `flat`
are never recomputed or overwritten, matching the tamper-evidence discipline in
`audit.js`.

`not_scorable` is a **placeholder, not a verdict** — it records "this could not
be judged yet" (no observable price, or a trigger still trapped in prose) and
stays due on later runs. Freezing it would mean backfilling a trigger could
never rescue the very row the backfill was for.

At the 90-day checkpoint the scorer also fills the fields the schema already
declares — `outcome`, `outcome_price`, `pct_move`, `grade_verdict` — and the
row leaves the open board.

`lesson` is **never written by the scorer.** It is the one field that is
genuinely Adam's, and a generated lesson would be the fabricated part of an
otherwise measured record.

## Modules

Pure logic is separated from I/O so the rule can be tested without a network,
following how `reconcile.js` already splits `reconcile()` from
`renderArchiveBlock()`.

| File | Responsibility | I/O |
|---|---|---|
| `server/scoring.js` | Call classification, benchmark selection, verdict rule | none |
| `server/checkpoints.js` | Which horizons are due for a row on a given date | none |
| `server/scorecard.js` | Fetch dated closes, compute, write the archive | network + fs |
| `server/scorecardPost.js` | Render the weekly draft post | none |
| `scripts/score-book.js` | CLI entry: score everything due, emit a draft | orchestration |
| `scripts/backfill-triggers.js` | Propose structured triggers from prose | fs, gated |

`scorecard.js` reuses the existing lock-and-backup writer discipline rather
than introducing a second path that writes `archive.json`.

### Dated closes

`dataProviders.getDailyCloses()` returns closes without dates, which cannot
answer "what did this close at on 2026-07-07". A `getDatedCloses(ticker)`
returning `[{date, close}]` is added to `dataProviders.js` following the same
Alpha Vantage → Stooq → not-observable fallback chain.

**Historical closes come from Yahoo's chart endpoint.** The original plan was
Stooq, and it does not work: as of 2026-07-28 Stooq answers every history
request with an HTML JavaScript bot-wall instead of CSV, with or without a
browser user-agent. Yahoo is keyless, carries dates, and covers equities
(`GOOGL`) and crypto (`BTC-USD`) alike. Stooq remains second in the chain in
case it returns. *(It did not. Removed 2026-10-04, see the section at the top.)*

⚠️ **This breaks the existing app too.** `getQuote()` and `getDailyCloses()`
both fall back to Stooq, so the live data chain in `reviewer.js` / `reconcile.js`
is degraded to "not observable" for anything Alpha Vantage cannot serve. That is
a pre-existing fault this work surfaced, not one it introduced, and it is not
fixed here.

Alpha Vantage is deliberately not used for history: its free tier is 25
calls/day and already metered against a persisted budget; 22 rows × 3
checkpoints × 2 symbols would exhaust it on the first run. AV stays reserved for
live quotes.

A checkpoint whose price cannot be observed is written as `not_scorable` with
`source: "none"` — never estimated, never silently skipped.

## The weekly post

Written as a `.txt` draft into `../x-poster/queue/`, riding the approval
pipeline that already exists: queue → Adam approves → the scheduled task posts.
No second posting path.

Format follows the highest-performing pattern observed on large finance
accounts (the track-record recap), with the one difference that matters: the
numbers are auditable and the misses are printed.

```
The book scored 7 calls this week. 5 right, 2 wrong.

Passed on $DOGE at 25/100 — failed every gate. It's -18% since, BTC -4%.
Called Accumulate on $GOOGL at $354.46. +8%, SPY +2%.

Missed: $HYPE. Watchlist above $77, it never triggered and ran anyway. +14%.

Every call, including the ones we got wrong: <link>
```

### Rules the generator enforces

- **Misses render with the same prominence as hits.** A generator that can only
  produce wins is a marketing tool, not a track record.
- **The scored count is always stated**, so a bad week reads as a bad week.
- **`not_scorable` rows are counted as excluded**, never silently dropped.
- **No advice, ever.** Journal voice, past tense, what the book said and what
  happened. Carries the existing repo rule: the system drafts, Adam publishes.

## Trigger backfill

Four-plus rows carry their levels in prose rather than structure:

- B-009 `"Watchlist — trigger: reclaim $540"`
- B-011 `"Watchlist — >$63.8-64.5K / <$56.2K"`
- B-017 `"Top watchlist — >$77 / dies <$52"`
- B-019 `"ARMED — hold mid-$60s + reclaim $70-71"`

`scripts/backfill-triggers.js` extracts proposed `trigger` / `invalidation`
values and **prints them for confirmation before writing anything.** Parsing
prose blind would silently corrupt every conditional verdict downstream, and
the existing chain spec's rule is that values are never invented.

Rows whose triggers are not backfilled stay `not_scorable` as conditionals.
That is the honest state, not a gap to paper over.

## Testing

`node --test` is already declared in `package.json` with zero test files.

`scoring.js` and `checkpoints.js` are pure and get real tests written red-first
— the verdict rule is precisely the kind of logic that can be wrong for months
without anyone noticing. Fixtures come from the real 22 rows, including B-010
(the `Accumulate` row whose call is a decline) and the hedge rows.

`scorecardPost.js` is pure given a scored set and is tested on its honesty
rules: a week with only losses must still render, and the scored count must
match the rows passed in.
