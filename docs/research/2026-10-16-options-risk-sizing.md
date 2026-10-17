# How much should Benny risk per options trade? (2026-10-16)

> **UPDATED THE SAME EVENING: 3% per trade, 9% open.** Adam then gave a per-trade target: "makes 1k on 10k is optimal", with about $500 acceptable at lower risk. The 2% answer below was sized for a yearly return. A winner's size is risk x payoff, so:
>
> | Risk per trade | At risk | Win at 1.6R | Win at 2R | Win at 3R | 5 losses in a row | 10 losses in a row |
> |---|---|---|---|---|---|---|
> | 2% | $200 | $320 | $400 | $600 | -9.6% | -18.3% |
> | **3%** | **$300** | **$480** | **$600** | **$900** | **-14.1%** | **-26.3%** |
> | 3.3% | $333 | $533 | $667 | $1,000 | -15.6% | -28.8% |
> | 5% | $500 | $800 | $1,000 | $1,500 | -22.6% | -40.1% |
>
> (A loss is counted as the whole debit, compounded.)
>
> **A year of 60 trades, on $10,000, without compounding:**
>
> | Risk | Win 40% at +1.6R, lose -0.85R | Win 35% at +1.8R, lose -0.95R (thin edge) |
> |---|---|---|
> | 2% | +$1,560 | +$150 |
> | **3%** | **+$2,340** | **+$225** |
> | 5% | +$3,900 | +$375 |
>
> **Why 3% and not 5%:**
> 1. 3% gets ordinary spreads, paying 1.6-3x their cost, to $480-900 winners, which is Adam's $500 floor and close to the $1,000 ideal.
> 2. It is the top of tastylive's defined-risk range, and still inside every source here.
> 3. 5% would hit $1,000 at 2:1, but it is the size where the Monte Carlo puts a 27% chance of losing half the book in a year if the edge is thin, and Adam said he would take $500 wins for lower risk.
> 4. The 15% drawdown pause stops new options entries after about five straight full losses at 3%, so the 10-loss -26% row cannot run all the way. The worst realistic hit is about the 15% pause plus whatever is still open, at most the 9% cap.
>
> **Open cap: 9%,** three full-size trades, keeping Elder's three-positions shape.
>
> **Refill:** at $9,000 the weekly $500 refill starts (design spec, last section). The deposits are never counted as trading gains.

Adam, 2026-10-16, on the first draft of the options lane, which risked 1% per trade: "you will pass on every single trade at 1% risk". Then: "increase the risk to a sensible amount deep dive into what the risks really on with a good trader".

**Answer: 2% of Benny's equity per options trade (about $200 on $10,000), with at most 6% of equity open in options at once (three full-size trades).** The shares lane stays at 1%. The rule is reviewed when the lane has 10 closed trades: if its measured expected value is positive, consider 3%; if it is negative, go back to 1%.

## 1. What experienced traders actually risk

| Source | Per-trade risk | Note |
|---|---|---|
| tastylive, defined-risk trades ([sizing article](https://www.tastylive.com/news-insights/Defined-Risk-and-Undefined-Risk-Position-Sizing)) | 1-3% of account for $20k-$100k accounts | Under $20k: "5%, 6%, 7%, or higher at times", because one spread is a large slice of a small account |
| tastylive, $10k account guide ([guide](https://www.tastylive.com/news-insights/trading-10-000-account-complete-guide)) | 1-3% is "healthy"; up to 5% per position on expensive names | Keep at least 5-10 positions on |
| Alexander Elder ([6% rule summary](https://www.incrediblecharts.com/trading/6_percent_rule.php)) | 2% per trade | Total: never lose more than 6% of capital in a month; stop opening trades when open risk plus the month's losses reaches 6% |
| Minervini, as widely summarized ([thread](https://en.rattibha.com/thread/1864744561668423792), [Investagrams](https://investagrams.com/daily/?p=4272)) | 1.25-2.5% of equity | Second-hand: no primary quote found. Shares with stops, not options |
| Van Tharp's percent-risk model, as summarized ([daytrading.com](https://www.daytrading.com/percent-risk-model)) | Commonly 1-3% | Tharp's own point is that the right number depends on the system's win/loss distribution |
| Portfolio heat convention ([explainer](https://completetradersedge.com/?p=231483)) | Total open risk around 6% | Described as a convention, not a law |

The common ground is **1-3% per trade, about 6% total open risk**. The 5%+ small-account allowance exists because one spread is a large share of a small account, not because 5% is safe.

## 2. A defined-risk trade is not the same as a stop-loss trade

- **Shares with a stop:** the planned loss is 1R, but a gap through the stop loses more (the paper book scores this as STOP-GAP). Winners and losers are both partial.
- **A debit spread or long option:** it can never lose more than the debit, with no gap risk. But it loses most or all of the debit far more often. The broker's own chance of profit on the near-the-money legs pulled 2026-10-16 was 0.27-0.36 (UNH, ANET, WULF 10/30 chains), so 60-65% losers is normal.
- **So 2% risked on a spread is a real 2%,** because the debit is the most it can lose. And 2% on a spread is spent more often than 2% on a stock with a stop.

## 3. Drawdown at 1%, 2%, 3% and 5%

This is a Monte Carlo test, 20,000 runs per cell (script in the session scratchpad, reproduced in the spec). R = the debit. Losses below 1R reflect spreads sold on the decide-by date before they reached zero. About 60 options trades a year is assumed.

**Modest edge**: wins 40% of the time at +1.6R, losses at -0.85R, expected value +0.13R a trade, full Kelly 9.5%.

| Risk per trade | Median return, 60 trades | Bad year (10th percentile) | Median worst drawdown | Chance of a 20%+ drawdown in the year |
|---|---|---|---|---|
| 1% | +7.6% | -2.4% | 6.7% | 0% |
| **2%** | **+14.9%** | **-5.4%** | **13.1%** | **10.6%** |
| 3% | +21.6% | -9.1% | 19.1% | 43.8% |
| 5% | +32.8% | -18.0% | 30.5% | 89.0% |

**No edge**: wins 35% at +1.6R, losses at -0.95R, expected value -0.06R a trade. This is what the lane looks like if the hunter's odds are wrong.

| Risk per trade | Median return, 60 trades | Bad year (10th percentile) | Chance of a 20%+ drawdown in the year |
|---|---|---|---|
| 1% | -3.8% | -13.1% | 2.3% |
| **2%** | **-8.3%** | **-25.1%** | **50.8%** |
| 3% | -13.3% | -36.0% | 81.1% |
| 5% | -24.6% | -54.4% | 98.0% |

**Losing streaks:** with 35-40% winners, the longest run of losses in 60 trades is about 6-7 in a typical year and 10-12 in a bad one (90th percentile).

## 4. Why 2%

1. **It meets the goal if the edge is real.** With a modest edge, 2% a trade makes a median of about +15% a year from the options lane alone, which is Adam's target for the whole book, before the shares lane adds anything.
2. **It survives if the edge is not real.** With no edge, 2% loses about 8% in a typical year and 25% in a bad one. That hurts but can be recovered from, and the 10-trade review catches it first. At 3% it is -13% typical and -36% bad. At 5% half the book is gone more than a third of the time.
3. **It is about a quarter of full Kelly on the modest case** (9.5% / 4 = 2.4%). Traders who size by Kelly usually bet a quarter to a half of it, because the edge estimate is uncertain. Ours is unproven: zero closed trades, and on 2026-10-16 all three of the hunter's top spreads were negative EV (B-941..943).
4. **It sits inside every source above** (tastylive 1-3%, Elder 2%, Minervini 1.25-2.5%), without leaning on the small-account allowance.
5. **It fits real spreads.** In the 2026-10-16 chain test at ask-in, bid-out fills, a 5-wide ANET 170/165 put spread cost $174 (fits $200, 1.9:1). The UNH 415/420 call spread cost $215 and does not fit; the next narrower one that does fit is 410/412.5 at $200, but it pays only $50, and the EV gate would reject it.

**The cap on open risk:** options positions open at once may risk at most 6% of equity. That is three trades at 2%, which is Elder's 6% and tastylive's "keep 5-10 positions on" scaled to a book that is just starting. When the cap is full, a new entry is skipped and the reason is recorded.

**Shares stay at 1%.** The evidence puts shares at 1-2.5%, so 1% is conservative but inside the range. Benny's shares lane mirrors every paper-book entry, so many 1% trades can be open at once (Adam's paper book had 11 open on 2026-10-16). Total open risk across both lanes is the number to watch. Recommendation, not a change: the weekly scorecard prints total open risk across both lanes, and if it often runs above 10%, Adam decides whether to cap the shares lane too.

## 5. What would change this number

- **The 10-closed-trade lane review.** If the measured EV per trade is positive at real fills, consider 3%. If it is negative, go back to 1%, or pause the lane.
- **A drawdown of 15% from the book's peak** pauses new options entries until Adam says go. That is about the median worst year at 2%, so reaching it is a signal.
