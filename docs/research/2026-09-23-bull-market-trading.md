# Trading in a bull market — what the evidence says, and what it means for The Bench
2026-09-23 · Adam: "its an ai bull market rules are different" / "Investigate anything with information about trading in a bull market"

## 1. Our own book says the same thing
- **The desk's no's beat the market.** 204 passes: median +3.8% since the pass vs SPY +0.9% over the same windows; 53 up 10%+ vs 18 down 10%+ (docs/pass-audit-2026-09-23.json).
- **Adam's picks = the chip index.** 27 names since 9/2: +6.4% avg vs SPY +1.3%, QQQ +3.7%, SMH +6.4%. The edge is the theme call, and the desk captured none of it (+$8.85 realized since 8/1).
- **Extension wasn't a sell signal.** SNDK and MU, conditioned on already being extended, had HIGHER odds of continuing, not lower (B-514/B-515).
- **Dip levels never fill in a trend (P-047).** META 548 (B-201), MU 881 (B-144/B-374): the discount never came.
- **Moving-average targets capped trades that ran through them (P-059).**

## 2. What the research says
| finding | source | what it means here |
|---|---|---|
| Returns persist for 1–12 months across 58 markets, then partly reverse; trend strategies do best in extreme markets | Moskowitz, Ooi & Pedersen 2012, *JFE* | trends are real and last months; "it already ran" isn't a reason on its own |
| Nearness to the 52-week high predicts future returns better than past returns do, and does not reverse | George & Hwang 2004, *J. Finance* | in a bull market, target the 52-week high / next pivot, not a moving average |
| Momentum crashes are rare but brutal, and they happen in "panic states": after declines, high volatility, **during the rebound** | Daniel & Moskowitz 2016, *JFE* | the danger to momentum is the snap-back after a selloff, not a steady bull run |
| Stop-losses destroy value in a random walk but ADD value when returns trend (+50–100 bp/month in stop-out periods, US equities 1950–2004) | Kaminski & Lo 2014, *J. Financial Markets* | "rules are different" does NOT mean drop the stops. Stops are worth more in a trend |
| A slow trend switch (price vs. 10-month average) kept equity-like returns with far smaller drawdowns | Faber 2007 | the right on/off switch is SLOW |
| A sector up 100%+ over 2 years vs. the market: **53% odds of a 40% crash within 2 years; 80% at +150%**. But run-ups do NOT predict lower average returns. Volatility, share issuance and an accelerating price path raise the crash odds | Greenwood, Shleifer & You 2019, *JFE* | ride it, but assume a 40% drop is roughly a coin flip, and watch issuance (lockups, IPOs) |
| Hedge funds rode the 1998–2000 tech bubble, tilted into it, and cut exposure before the collapse | Brunnermeier & Nagel 2004, *J. Finance* | riding a bubble with an exit plan is rational; being in it without one is not |
| Best and worst days cluster (median ~7 days apart), mostly in bad markets | Morningstar / Wells Fargo / JPM-style studies | a fast switch sells the bottom and misses the snap-back |
| Normal bull markets still see ~3 pullbacks of 5–10% a year and a 10% correction about every 1–2 years | LPL, A Wealth of Common Sense | a 5–10% dip inside a bull market is weather, not a regime change |
| Practitioner trend filter: price above rising 150/200-day, within 25% of the 52-week high | Minervini "Trend Template" | a usable leader screen for this regime |

## 3. Our own test of the on/off switch (chip index SMH, since 2017)
| switch | gain kept | worst drop | times switched on |
|---|---|---|---|
| none (just hold) | 1,297% | −45% | — |
| off under 50-day | 242% | −35% | 92 |
| **off 3% under the 200-day, back on 3% over** | **1,007%** | **−31%** | **8** |
| 50-day crosses under 200-day | 849% | −34% | 5 |

**Where we are today:** SMH 600.91 vs 200-day 489.68 (+23%), so the switch is ON. SMH is +151% over two years vs SPY +35%: squarely in the paper's high-crash-odds zone. Worst SMH drawdown since 9/2024: −32.6%.

## 4. Proposed: AI BULL MARKET MODE (draft for v32, needs Adam's yes)
**The switch (measured, not felt):** ON while SMH closes more than 3% above its 200-day average; OFF when it closes more than 3% below. Today: ON.

While ON:
1. **The theme sleeve.** Hold the chip index (SMH) as a trend position: no 2:1 target, exit only on the OFF switch or its stop. Size from the 10% band with the stop at the switch-off level (~475 today, ~21% away), so ~2 shares and ~$250 of risk. The stop is always a resting order.
2. **"Extended" stops being a reason to pass.** A name up big is judged on its own history conditional on being extended (the SNDK/MU method), not on "it already ran."
3. **Targets = the next verified pivot or the 52-week high,** not the nearest moving average (P-059 becomes the rule while ON; George & Hwang supports it; our own book is 1–1 so far).
4. **Dip levels get a 5-session clock.** If the name trends away from the level, re-judge it as a breakout instead of carrying the dip (P-047).
5. **Crash discipline, because the odds say ~50/50 on a 40% drop:** no 2x/3x ETFs on the theme, stops always resting, size never above the band, and an issuance watch (lockups, IPOs, secondaries: CBRS, SPCX's 328M-share unlock) flagged in every run.
6. **The company catalyst lane (v31) stays**, and in this mode a theme name's own catalyst gets first look.

When OFF: the sleeve sells the next session, and every rule reverts to standard v31.

**What doesn't change, ON or OFF:** the ATR floor, the 10% band, stops placed the same minute as the fill, no Friday-close entries, and Adam placing every order.

## Sources
- Moskowitz, Ooi, Pedersen, "Time Series Momentum," JFE 2012 — https://w4.stern.nyu.edu/facdir/lpederse/papers/TimeSeriesMomentum.pdf
- George & Hwang, "The 52-Week High and Momentum Investing," J. Finance 2004 — https://www.bauer.uh.edu/tgeorge/papers/gh4-paper.pdf
- Daniel & Moskowitz, "Momentum Crashes," JFE 2016 — https://www.nber.org/papers/w20439
- Kaminski & Lo, "When Do Stop-Loss Rules Stop Losses?" — https://dspace.mit.edu/bitstream/handle/1721.1/114876/Lo_When%20Do%20Stop-Loss.pdf
- Faber, "A Quantitative Approach to Tactical Asset Allocation" — https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf
- Greenwood, Shleifer & You, "Bubbles for Fama," JFE 2019 — https://www.nber.org/system/files/working_papers/w23191/w23191.pdf
- Brunnermeier & Nagel, "Hedge Funds and the Technology Bubble," J. Finance 2004 — https://www.princeton.edu/~markus/research/papers/hedgefunds_bubble.pdf
- Best/worst days clustering — https://www.morningstar.com/funds/you-can-beat-stock-market-by-avoiding-its-worst-days-you-wont
- Pullback frequency — https://www.lpl.com/research/blog/more-pullback-perspective.html · https://awealthofcommonsense.com/2026/03/a-short-history-of-stock-market-pullbacks/
- Minervini Trend Template — https://www.chartmill.com/documentation/stock-screener/technical-analysis-trading-strategies/496-Mark-Minervini-Trend-Template-A-Step-by-Step-Guide-for-Beginners
