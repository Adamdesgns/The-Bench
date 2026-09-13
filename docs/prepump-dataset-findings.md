# Pre-pump dataset — what the build found, including three corrections to the brief

**2026-09-05.** Written while building `bench-prepump-snapshot` / `bench-prepump-outcomes` at Adam's
direction. Every claim below was measured against the live API or read out of source in this session.
Nothing here is reasoned from documentation alone.

The brief was right about the thing that matters most (point-in-time discipline, record the negatives,
never label at collection time). These are the places where the measurement disagreed with it, plus the
hazards that would have silently ruined the dataset.

---

## 0. TWO CORRECTIONS TO THIS DOCUMENT, added 2026-09-06 after a slow search finished

I published section 1 and section 7 below before a background search over `Projects\` had finished.
I read the still-empty output file and treated it as an answer. **That is precisely the failure this
document warns about two sections down — "a fetch failure is never reported as an empty result" — and I
committed it while writing the warning.** Both claims are corrected here rather than edited away.

**(a) The 8.7x figure IS documented in Hunter.** It is at `apps/hunter/docs/PREPUMP-NEXT.md:18`,
verbatim: *"Volume for any derived figure comes from `get_equity_fundamentals`, never from intraday
historicals (Robinhood intraday bars under-report volume by up to 8.7x)."* So Adam's brief was quoting
his own project's written rule, not misremembering. My measurement (1.67x-2.93x, median 2.77x on a
30-minute regular-hours grid across 8 symbols) **disagrees with that documented number.** Both the
measurement and the doc now exist; the discrepancy should be resolved before either is cited again. The
operational rule they both support is unaffected.

**(b) Substantial prior pre-pump work exists, and it reached a NEGATIVE result.** See section 10.

---

## 1. The intraday volume ratio, measured

Measured on a like-for-like 30-minute regular-hours grid across 8 symbols, the actual ratio is
**1.67x to 2.93x, median 2.77x** — not 8.7x (see section 0a for where 8.7x comes from).

**The rule the brief drew from it is still correct, and is now better supported.** The real defect is
worse than a constant factor: the intraday feed has **non-deterministic dropouts**, and different
intervals disagree with each other. `interval=hour` with `bounds=regular` is outright unusable — it omits
13:30-14:00Z entirely and truncates the final half hour containing the closing auction. A constant 8.7x
could be corrected for. Dropouts cannot.

**So: take volume from `get_equity_fundamentals`, never from intraday bars.** Same instruction, sounder
reason, and the number in the brief should be retired rather than repeated.

## 2. The brief asks for a field that does not exist on this surface

The brief requires "from `get_equity_quotes`: the official last-completed-session close."

**On day D there is no endpoint that returns day D's official settled close.**

- `get_equity_quotes.close` is by contract the **prior** session's close. Verified: on Saturday 9/5,
  with 9/4 being the last completed session, `close.date` read `2026-09-03` for SPY, AAPL and HIMS.
- `get_equity_fundamentals` has **no close field at all** — it returns open/high/low/volume only.
- `get_equity_historicals`' most recent daily bar is disowned by its own tool guide: *"close_price on the
  most recent bar is NOT the official settled close."*

Two sources give a day-D closing price and they **disagree**: `quote.last_trade_price` (AAPL 319.99)
and the daily bar's `close_price` (AAPL 319.97).

**Resolution:** record all of them, each with its own provenance and date, and never collapse them into
one field called "close". `entry_close` is **provisional at write time** and gets reconciled on a later
pass that writes a NEW column beside the original rather than editing it. That is the only way the
disagreement stays visible instead of becoming invisible.

## 3. 17:30 ET is 90 minutes after the close, and the bar is not settled

Measured directly: at **21:25 ET on 9/4** the 9/4 daily bar was still `interpolated: true` — volume 0,
OHLC all equal to the prior close. By Saturday it was real. Independently, Hunter's Robinhood adapter
holds bars back **720 minutes (12 hours)** after the close before treating them as final
(`robinhood-eod-adapter.ts`), which is 03:00 ET the next morning.

Keeping the 17:30 ET run is still right — it is the realistic decision moment a live detector faces, and
`get_equity_fundamentals` genuinely carries the completed session's real OHLCV at that hour. But:

- every `interpolated` bar must be **dropped and counted** (note: the `interpolated` key is **absent**
  when false, so test with `'interpolated' in bar`, never `bar.interpolated === false`)
- the day-D OHLCV comes from fundamentals, keyed on its own `market_date`
- the quotes close is stored as `prior_session_close` with its own date

## 4. HAZARD — split adjustment silently rewrites your history

`get_equity_historicals` defaults to `adjustment_type: "split"`. The restatement is live and provable:
**NVDA's 2024-06-07 close returns 1208.88 raw and 120.888 split-adjusted from the same endpoint** — a 10x
silent rewrite of a past row.

Robinhood **never echoes** which adjustment it applied (Hunter's own acceptance doc records this as
`REQUEST_PARAMETER_ATTESTATION_ONLY`). So the parameter must be passed explicitly on every call and
recorded in the row, and neither setting is safe alone:

- adjusted-only silently erases "it was a $0.60 stock"
- unadjusted-only fires a false signal on every reverse split, and low-priced pump candidates
  reverse-split constantly

**Store unadjusted as the primary series, split-adjusted as a second column, with a divergence flag.**
Also: daily bars can never be dividend-adjusted on this surface, so only price returns are computable,
never total return.

## 5. HAZARD — ticker recycling makes a dead symbol come back as a different company

`FB` now resolves to a $2.7M buffer ETF, **not Meta**, and returns a valid-looking row rather than
`not_found`. A frozen universe that keeps polling a delisted symbol will silently start collecting a
different company's data under the same name.

**Rule: once a symbol is sealed GONE, never re-query it.** Seal from stored terminal state, not from a
fresh lookup.

And delisting is **unrecoverable**, verified both ways: Yahoo returns HTTP 404 for ATVI/SGEN/TWTR/VMW,
and Robinhood puts ATVI and SGEN in `not_found`. There is no backfill later. The exit rule has to be
right on day one.

## 6. CORRECTION — the $1.00 price floor deletes the phenomenon

The first frozen universe used a `price >= $1.00` floor. That floor is wrong here, and the book proves it:
**GPRO traded $4.28M-$5.38M/day at about $0.60 in the three sessions before a +181.7% move on 24.5x
volume.** It is the clearest positive example in the entire book, and a $1 floor deletes it. Adam's own
saved scan (market cap > $2B, volume > 3M shares) deletes it too.

The principled floor is **dollar volume**, which answers the real question — can one retail order move
this print — while a price floor just removes the population where pumps are densest. Fixed before any
collection: a low-price / high-dollar-volume stratum was added to the core universe.

## 7. Hunter overlap — cleared, with one governance flag

**A Bench-side collector does not duplicate Hunter.** Hunter has built the *analysis* half (frozen-universe
prospective cohorts with point-in-time forward observations) but is **structurally incapable of holding
real data**: every Lab and durable write path throws `LAB_PROVIDER_RETENTION_NOT_AUTHORIZED` unless every
bar's source starts with `fixture:` and every asset is `synthetic: true`. The live Robinhood path it
actually runs is capped at 40 symbols and writes nothing to disk, by design. The collector fills exactly
the gap Hunter's own docs list as deliberately deferred: *"no `--out` flag, no cache directory, no
yesterday's-bars file, and no run ledger."*

Boundaries that must hold: no Bench imports inside Hunter and no Hunter imports inside The Bench
(`AGENTS.md` forbids it, and Hunter's README states it has no integration with The Bench). Any handoff is
a file on disk that Hunter optionally reads, one way.

**The governance flag, surfaced rather than decided:** Hunter treats persisting derived provider metrics
daily as crossing a rights gate, and its own note says *"That is his decision, and this design does not
pre-stage it."* Building the collector in The Bench does not make that question disappear — it moves it to
a repo that had not written the gate down. Adam's brief effectively answers it (personal research use,
stays on this machine, not licensed for redistribution), so this build **writes that position down** in
the dataset manifest and enforces it with a gitignore that excludes the row data from the repo while
keeping the definitions versioned.

## 8. Horizons — collect the superset

The brief asks for 1/3/5/10 sessions. Hunter's Lab uses 1/3/7/14/30. The bars are pulled either way, so
the outcomes job computes **1/3/5/7/10/14/30** and leaves the longer ones null until enough completed
sessions exist. Costs nothing, and avoids a recollection if the horizon definition ever moves.

## 9. Scale — this cannot be an in-context agent loop

Measured: the naive "collect everything for 400 symbols" plan is **103 tool calls and ~3.30M characters,
roughly 970K tokens** — about five times a 200K context, with `get_equity_historicals` alone accounting
for 66% of it. Batch limits are hard: fundamentals 10/call, historicals 10/call, quotes 20/call if you
need the `close` block at all (above 20 the `close` object is silently absent from **every** result in the
batch, with `closes_error` set).

Also: **tool results above roughly 40KB are not delivered to the model** — they are written to a file. A
single 10-symbol × 31-session historicals call is 53,940 characters and already exceeds that.

The collector therefore has to shard and write to disk. That is a structural constraint, not a preference.

---

## Standing rules this dataset inherits from the repo

- **Nothing posts.** Standing order 2026-09-05: the public channel is retired, `HALT` stays in x-poster
  permanently, `post_next.py` is never invoked. The only delivery path is `scripts/ntfy-read.mjs` to the
  standing topic. This build sends exactly one setup report and then runs silent, as instructed.
- **Read-only market data.** No order, account, position, portfolio or watchlist tool is called anywhere
  in this build.
- **A fetch failure is never reported as an empty result.** `tripwire.mjs` sets the precedent: *"This is a
  FETCH FAILURE, not 'nothing tripped'. Do not read silence as safety."* A partial run must be detectable
  and excludable, never mistaken for a quiet day.
- **Refuse rather than guess.** The repo's scripts refuse un-scoreable input by design. So does this one.

---

## 10. THE PRIOR WORK — the pre-pump hypothesis was already tested, and it FAILED

Found 2026-09-06, after this document's first draft. `research/vibe-trading-runs/prepump/` holds a
properly pre-registered study programme (Studies A through G, `RESULTS.md` now 881 lines), run
2026-09-05 to 09-06 over **6,935 US common stocks, 8,456,388 daily bars, 2020-2026**, develop
2021-2023 with the 2024-2026 test window sealed until the hypothesis was written down in
`DECLARED-BEFORE-TEST.md`.

**Headline verdict: `does_not_survive`.**

| rule (test window, baseline 1.84 up/down) | up lift | crash lift | up/down |
|---|---|---|---|
| beaten_down only | 4.59 | 5.05 | 1.67 worse |
| volume_surge only | 2.96 | 3.57 | 1.52 worse |
| beaten_down AND volume_surge | 10.95 | 15.98 | 1.26 worse |
| beaten_down AND coiled | 6.48 | 9.03 | 1.32 worse |
| all three | 19.68 | **49.27** | **0.73 — it is a crash detector** |

Verbatim from the study: *"Every rule tested is a volatility detector. Not one improves the odds of up
versus down, and several make them worse."* Shipped as a pre-pump indicator, the three-way rule would
have pointed at falling knives twice as often as at pumps.

**What survived, and it replicated almost exactly out of sample:** MAGNITUDE. `beaten_down AND
volume_surge` lifted the odds of a 30% move from 0.4% to ~4.4% — 11.09x on develop, **10.95x on test**.
It says something is about to happen to this name. It says nothing about which way.

### What this changes here — three things

1. **It is why the outcomes job now records the DOWNSIDE.** `worst_close_pct_1d/3d/5d/10d` and
   `min_intraday_low_10d` were added on 2026-09-06 in direct response to this. A dataset that recorded
   only max gain could not have detected the 49x-crash-vs-20x-pump result at all, and would have made
   the same failed detector look good a second time. This is the single most valuable change the prior
   work produced, and it was nearly missed.
2. **It does NOT make this collection redundant, and the study itself says why.** Its own "still
   genuinely untested" list names three gaps: **earnings proximity** (yfinance returned only 694 of
   6,935 symbols, "a non-random 10%, so no study was run; needs a better source"), **true point-in-time
   float** ("from a paid vendor"), and pre-move news/social volume (no archive held).
   **This collector records the first two, daily, point-in-time, at no extra cost:** `e_next_date` /
   `e_sessions_until` for the whole universe from `get_earnings_calendar`, and `f_float` captured every
   session so point-in-time float accumulates without a vendor. Those are features a retrospective
   yfinance backtest structurally cannot reconstruct without lookahead. That is the gap this fills.
3. **The framing in the task brief is one day out of date.** "Zero calibration, no base rate, no way to
   tell a real detector from a coin flip" was true before 2026-09-05. There is now a base rate, a sealed
   test, and a negative result. What is missing is not calibration of the OHLCV rules — it is
   forward point-in-time data on the features nobody could test.

### Do not repeat the mistake the study exists to prevent

On develop, the failed rule looked like the one genuine find: 3.08 against a 2.23 baseline, a 38%
improvement. Out of sample it inverted to a 28% degradation. That is textbook overfitting, caught only
because the test window was sealed before the hypothesis was declared. **Any hypothesis run against
this dataset must be written down before it is tested, the same way** — `DECLARED-BEFORE-TEST.md` is
the template, and it is the only reason the overfitted result was caught instead of shipped.
