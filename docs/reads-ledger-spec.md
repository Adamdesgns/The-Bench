# The reads ledger — closing the loop on published reads

**Built 2026-09-02.** Scripts: `scripts/log-read.mjs`, `scripts/resolve-reads.mjs`. Ledger: `db/reads.json`.

---

## The defect this fixes

On 2026-09-02 The Bench published three reads and missed all three in the same
direction. The closing-bell thread that graded them told readers:

> Grade the direction your misses share, not each miss alone. Three errors
> pointing one way is one bad assumption, not three bad calls.

The pipeline that published that advice could not follow it. Measured the same
afternoon:

| | count |
|---|---|
| Book rows (`db/archive.json`) | 251 |
| Rows carrying a grade made **before** the call | 251 |
| Rows carrying a **resolved outcome** | **5** |
| Rows with a `grade_verdict` | 3 |

Two percent closure. The framework is excellent at scoring a call in advance —
opportunity score, readiness, A–F grades, quant evidence, named invalidations —
and almost never scores one afterwards. `db/receipt-posted.json` held exactly
one row, and that row's own note said no 30-day verdict was available anywhere
in the book.

Worse, the **reads** were not in the book at all. The book tracks position calls:
B-rows on tickers. It does not track the claims the daily posts actually make —
*"the tape is treating Dell's backlog as Dell's revenue"*, *"I am not chasing
467"*, *"the move has to beat the price of the move."* Those go on the timeline
six times a day and had no ledger anywhere.

So the only way a miss ever got graded was a later routine hand-reading the
previous slot's `.txt` out of `queue\`. That works exactly as long as somebody
remembers to look, it dies at the end of the session, and it never accumulates.
Nobody re-reads yesterday's close post to check whether "beats are priced in"
held up.

**The result: the same bias could repeat indefinitely without ever becoming
visible.** On 2026-09-02 nobody could say whether three misses in one direction
was a real lean or one bad Wednesday, because there was no table to ask.

---

## The design

One row per published read, written **at publish time**, resolved **on a clock**.

The load-bearing field is `direction`. Every read is a bet that a move stops
(`fade`) or that it continues (`continuation`). Record which, and a wrong read
tells you *which way* you were wrong, not merely that you were:

| read direction | when wrong, it means | `error_direction` |
|---|---|---|
| `fade` | the move kept going | `under-priced-the-bid` |
| `continuation` | the move stopped | `over-priced-the-bid` |
| `neutral` | — | `neutral-read-missed` |

Aggregate that column and "am I systematically fading strength?" becomes a
number instead of an anecdote.

### Row schema (`db/reads.json`)

```
id              R-001
date            2026-09-02        slot   14:07  (CT)
scope           name | layer | market        ticker  DELL | null
claim           the assertion, in one line, as published
direction       fade | continuation | neutral
invalidation    REQUIRED — the condition that settles it
resolve_by      YYYY-MM-DD — when it becomes gradeable
ref             the number the invalidation turns on (nullable)
post            the x.com URL
status          open | resolved | unresolvable
outcome         right | wrong | null
error_direction filled automatically from direction when outcome=wrong
actual          the settling number, pulled live
note / logged_at / resolved_at / source
```

---

## Usage

Log at publish, immediately after `post_next.py` echoes a URL:

```
node scripts/log-read.mjs --date 2026-09-02 --slot 14:07 --scope name --ticker DELL \
  --claim "Not chasing DELL at 467.04 - above it I was wrong to hesitate" \
  --direction fade --invalidation "DELL closes above 467.04" \
  --resolve-by 2026-09-02 --ref 467.04 --post https://x.com/i/status/2095228531055743127
```

Check what is owed (**exit 1 = reads are due**, same convention as
`inbox-check.mjs`, `vault-check`, `catalyst-watch.mjs`):

```
node scripts/resolve-reads.mjs --due
```

Grade one — **pull the settling number live, never from memory**:

```
node scripts/resolve-reads.mjs --resolve R-003 --outcome wrong --actual 492.18
```

Read the tally:

```
node scripts/resolve-reads.mjs --bias
```

### Guardrails, all tested 2026-09-02

- `--invalidation` is **required**. A read with no stated invalidation cannot be
  graded, which is the exact defect the ledger exists to stop.
- `--actual` is **required** to resolve. The script never invents a price.
- Re-resolving a graded row is refused without `--force`: *a verdict that gets
  rewritten after the fact is not a verdict.*
- `--bias` **says nothing** under 10 resolved rows. It prints the sample size
  next to every rate and refuses to name a lean, because over-correcting off six
  rows just builds the opposite bias with the same blindness.

### Why the script does not fetch prices

The Robinhood MCP is available to the assistant, not to a CLI process. The split
matches the rest of the repo: the **script** owns the ledger, the arithmetic and
the tally; the **assistant** owns the live pull.

---

## Seed data

Backfilled with 2026-09-02's three published reads, all graded against pulled
closes:

| id | slot | direction | outcome | settled on |
|---|---|---|---|---|
| R-001 | 05:40 | fade | wrong | DELL 492.18 vs the 481.73 upper break-even |
| R-002 | 08:39 | fade | wrong | power layer closed 6 of 7 green |
| R-003 | 14:07 | fade | wrong | DELL 492.18, +5.38% above the self-set 467.04 |

`--bias` currently reports 3 of 3 misses `under-priced-the-bid` **and correctly
refuses to call it a bias** at n=3.

---

## What is still owed

1. **Wiring.** `prompts/bench-daily-v4.md` carries its own rule: *"Never
   overwrite this file — a change means `bench-daily-v5.md` and updating the
   pointer line in each routine."* So the log-at-publish step belongs in a **v5
   §8**, with the pointer repointed in all six routine SKILL files
   (premarket, sotm, midday, power-hour, closing-bell, trending-snapshot).
   **Not done — it changes live automation and needs Adam's yes.** Until then the
   ledger is usable by hand but nothing calls it automatically, which is the
   `benny-v2.md` failure mode exactly (written 2026-08-14, first read
   2026-08-22). Do not let it sit.
2. **A `--due` check at session start**, next to `inbox-check.mjs` in the
   step-zero ritual.
3. **The trend-day hypothesis.** 2026-09-02 produced a specific, testable claim:
   *high relative volume (>4x) + verified fundamental catalyst + raised guidance
   → the "it has already moved too much" instinct is wrong.* DELL closed at
   **91% of its daily range** on **6.05x** volume after a $25B guidance raise.
   `scripts/quant-evidence.mjs` and `db/patterns.json` already exist to test it.
   Turn the instinct into a number before it becomes a rule.

---

## The principle

Measurement, not a new caution rule. A rule that says "don't fade strength"
manufactures the opposite bias with no more evidence behind it. The ledger does
not tell Benny to be bolder — it makes the lean *visible* so it can be corrected
against the tape instead of against a feeling.
