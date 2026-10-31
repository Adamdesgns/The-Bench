# Call context: first read (2026-10-30)

**The ask (Adam, 2026-10-30):** "we need a file of your calls that were right and more than the standard ledger. Market, sentiment, social media, news, etc ... let's record them and find some patterns later" and "then we need losers recorded too".

**What exists now:** `db/call-context.json`, one record per book row (1,198 rows: 453 right, 397 wrong, 83 flat, 265 not scored yet). Winners and losers carry the same fields, so they can be compared. Script: `scripts/call-context.mjs` (tests `test/call-context.test.mjs`).

## What each record holds

- **Market the day before the call:** SPY, QQQ and SMH returns and their distance from the 50- and 200-day lines, VIX and VIX/VIX3M.
- **Sentiment:** CNN Fear & Greed from the day before.
- **The ticker's own chart:** 1/5/20/60-day returns, distance from the 50- and 200-day lines and the 52-week high, ATR %, volume ratio, relative strength vs SPY.
- **Calendar:** weekday, sessions since and to earnings, an 8-K in the prior days.
- **News:** Google News headlines from the 3 days before the call.
- **Social:** Stocktwits and ApeWisdom. These have no history, so they only exist for calls captured live. From today the 3:20pm close routine (`bench-plan-check-close` step 2c) captures each new call within 5 days.
- **The outcome:** the latest real verdict (right / wrong / flat) from the scorecard, with every checkpoint kept.

Nothing in the context is read from the call day or later, so a field can't leak the answer. Call-day moves are kept apart, under `same_day`.

## First read: longs (89 scored, 26 right)

These are leads to watch, not rules. The report ran about 60 comparisons, so a few extreme thirds are expected by chance alone.

| Lead | Win rate | But |
|---|---|---|
| Long called after a down week for SPY (5d ≤ −0.96%) | 1 of 29 (3%) vs 57% in the middle third | 10 dates, 7 tickers. Bunched in three bad weeks: ZYME 8/21–24, UBER/GOOGL/ORCL 9/14–17, ETN/IREN/GOOGL 9/29–30 |
| Long called after the ticker fell the prior week | 10% vs 43% | 14 dates, 8 tickers |
| Long called within 28 sessions after earnings | 10% vs 50% at 44+ | 16 dates, 12 tickers. The widest spread of the lot |
| Fear & Greed in the upper third (46–66) | 43% vs 20–24% in fear | 12 dates, 9 tickers |
| Ticker deep under its 52-week high (−17% or worse) | 14% vs 33% near the high | 17 dates, 11 tickers |
| More headlines in the 3 days before | 40% vs 21% | Busy names get more coverage and more rows |

**What they have in common:** most long losers were bought into weakness, after a red week, under the 52-week high, or soon after earnings, while the market itself was soft. Winners came more often in calm-to-greedy tape on names already near their highs. That fits the desk's earlier finding that longs win about 34% overall.

## Passes and conditionals

- **Passes** were right more often on volatile names (high ATR, 72%), on names deep under their 52-week high (71%), and on names that fell the prior week (71%). That's the mirror image of the long losers: the desk was right to stay out of falling names.
- **Conditionals** show only weak splits. Below the 200-day line: 27% right. Well above it: 46%.

## Why none of this is a rule yet

- **Not independent:** the book re-logs the same name many times (UBER 14 rows in the week of 9/14, 8 of them longs). The report now prints distinct dates (d) and tickers (t) for each third. A third is hidden under 3 of either.
- **In-sample:** every lead was found on the same rows it describes. It counts only when it holds on calls made after today.
- **Many comparisons:** about 60 splits across call types. At that count, a few 10%-vs-50% gaps are expected by luck.
- **Two rows have no price history:** SNYR B-323 and BLFS B-525 (Yahoo has no bars). Their context is partial.

## What happens next

- **The close routine captures every new call nightly,** including social, and refreshes outcomes.
- **A forward check in about a month,** once 30 or more new longs are scored. Re-run `node scripts/call-context.mjs report --type long` and see whether the down-week and after-earnings leads hold on calls made after 2026-10-30.
- **No framework change.** Turning any lead into a gate is a v36 question and Adam's call.
