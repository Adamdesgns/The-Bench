# Lane expectancy and the stop path (2026-10-29)

**Question (Adam, 2026-10-28):** how do we build a pattern that picks winners above 65%?
**Answer the data gave:** the wrong target. Expectancy is the number. Measured here per lane, in R, with the stop path checked on daily bars.

**Status:** research. No framework rule changed because of this note. What it changed is listed at the bottom.

## Corrections to the first answer (from Adam's review, checked)

- Long calls at 1 week are 30 right, 40 wrong, 19 flat. The scorecard's win column puts flats in the denominator (33.7%). Without flats it is 42.9%. Longs look like the rest of the book.
- 45% at 2.5:1 is +0.58R a trade. 65% at 1:1 is +0.30R. The first earns nearly double.
- Passes right 51% of the time is a coin flip, not skill. The 72 passes that "ran without us" were picked because they ran.
- The desk's stated 58% vs actual 22% is n=9. Noise.
- Not conceded: TRENDING is a real regime label (`scripts/regime.mjs`: SPY > 20 > 50 > 200 SMA and VIX < 20, market risk 4).

## Method

Book rows with a numeric stop, scored at their latest checkpoint. Entry = trigger for a conditional (first day the high crossed it), review price for a long. Stop = invalidation. Daily bars from Yahoo, six months. A low at or under the stop is a fill at the stop; an open through it exits at the open. Script: `scripts/lane-expectancy.mjs`.

## Results

| Lane | n | Stopped | Win | Avg win | Avg loss | Exp, stop honored | Exp, no stop |
|---|---|---|---|---|---|---|---|
| Conditional, triggered | 144 | 62% | 31% | +1.95R | -1.01R | -0.09R | -0.11R |
| Long | 87 | 40% | 39% | +0.64R | -0.78R | -0.23R | +0.12R |
| Both | 231 | 54% | 34% | +1.39R | -0.93R | -0.14R | -0.02R |

- Median time to the stop: 3 sessions (conditionals), 4 (longs).
- 20 conditionals and 8 longs touched the stop and later finished in profit.
- Same-day stop touches: 15 conditionals, 2 longs. Excluding them, conditionals are +0.05R.
- Stop distance: stopped trades averaged 5.35% from entry, survivors 7.11%.
- The repo script reads the trigger day from the bars rather than the scorer's note, so it finds 166 triggered conditionals, not 144: 32.5% win, +1.75R / -0.99R, -0.10R a trade stop honored, -0.13R without. Same conclusion.

Paper book, closed, stops and targets honored: hunter-short 10 trades, 40% win, +0.22R avg win, -0.52R avg loss, -0.23R a trade. Exits across all 12 closed: 1 target, 3 stops, 8 time exits.

All passes vs all takes, latest checkpoint, no subgroup picking: passes moved -3.97% on average (median -2.60%), conditionals -1.63%, longs -0.87%.

## What it means

1. Honoring the stop does not rescue the book. It cuts the average loser from -1.80R to -1.01R and turns 20 recoveries into -1R losers. The two cancel. Conditionals are a 0R lane either way.
2. The stops are too close for these setups. Six in ten triggered conditionals touch the stop, median three sessions in. At a 31% win rate the break-even payoff is 2.2:1; winners average 1.95R. Just short.
3. Longs have a winner problem: +0.64R average win. The stops are not the main issue there.
4. Hunter-short loses on the clock. The 2:1 target to a verified floor is rarely reached in 10 sessions.

## Limits

- 231 rows on 50 tickers, August to October 2026. Far from independent.
- An intraday touch is treated as a fill. A trigger is treated as filled at the trigger price.
- This is the history the change would be fitted to. A wider stop chosen here must prove itself forward, not on these rows.

## What this note changed

- `scripts/lane-expectancy.mjs`: per-lane expectancy with the stop path, so every future review starts from R, not win rate.
- `scripts/paper-quant.mjs`: a third twin, **wide** (PQW-###). Same entry, same target and exit date as the paper trade, a wider stop, shares cut so the dollar risk matches. The only thing that differs from the paper trade is the stop. Compared at 10 closed pairs, like the other twins; Adam picks the rule.
- The wide stop rule, fixed 2026-10-30 before any forward result: the wider of 4/3 of the paper stop's distance (the 7.11 / 5.35 ratio above) and 1.5 ATR(14) measured on sessions before entry.
- Backfill the same day, 20 paper trades: 14 closed pairs, fixed -0.82R ($-583.73) vs wide -0.38R ($-301.12), 7 winners each. The wide stop survived WULF, LITE and COHR, which the paper stop lost, and earned less on every winner because it holds fewer shares. This is the same history the rule came from, so it proves nothing. Only pairs opened after 2026-10-30 count toward the review.

## What it did not change (Adam's call)

- The framework's stop rule (ATR Floor, 1.0 ATR). A change would be v36, after the wide twin has a forward record or a Vans Thesis backtest on point-in-time constituents with costs and the random-buy control.
- The hunter-short target. Its 10-closed review is due; a nearer-target twin is the candidate.
- Trigger confirmation on a close and volume. It conflicts with THE ENTRY CHECK IS FINAL and buys in higher; it must be scored on expectancy, not follow-through.
- Ten paper closes can kill a badly broken lane. They cannot promote a rule (at a true 50% win rate, 10 trades spans roughly 20% to 80%).
