# Does "momentum leaving chips" predict anything? (2026-10-02)

**Asked by Adam, 2026-10-02:** "Watch for the momentum to leave chips and rotate to another section. Maybe power. Maybe software."
**Rule proposed in B-688:** a rotation happens when SMH's 5-day return is behind SPY's AND one other sector's 5-day return beats SPY's by 2+ points, on the same three closes in a row. It ends on the first close SMH's 5-day return is back ahead of SPY's.

**Verdict: REJECTED as an alert, and not built into `bull-watch.mjs`.** No version of the rule warned that chips would fall behind. After the rule fired, chips kept beating SPY at about the same rate as on any other day. The sector it named did not keep leading either.

## Method

- **Data:** Yahoo daily bars from 2016-10-03 to 2026-10-01, 2,513 sessions. The symbols were SPY, SMH and the 17 bull-watch sectors that count as receivers (XLK, QQQ and IBIT are excluded).
- **Signal:** computed on unadjusted closes, the same as the live feed.
- **Outcomes:** measured on adjusted closes, so dividends count.
- **Code:** I tested the 5-day/3-close/+2 rule with the exact functions I wrote for `bull-watch.mjs` (patch not merged). The other variants used the same logic with different numbers plugged in.
- **Baseline:** SMH minus SPY on every session. Chips beat SPY by +1.46% over the next 20 sessions and +4.55% over the next 60.

## Results (all 24 variants, none dropped)

"Chips after" is SMH minus SPY over the next 20 and 60 sessions. A rotation warning only earns its keep if this lands BELOW the baseline, ideally below zero. "Receiver after" is the top named sector minus SPY.

| window | closes | lead | fires/yr | ON % | chips after 20 | chips after 60 | receiver after 20 | receiver after 60 | n |
|---|---|---|---|---|---|---|---|---|---|
| 5d | 3 | +2 | 12.8 | 21% | +1.58% | +5.24% | +0.17% | -1.23% | 128 |
| 5d | 3 | +5 | 5.6 | 8% | +2.67% | +7.46% | -1.97% | -1.37% | 56 |
| 5d | 5 | +2 | 6.9 | 9% | +2.37% | +7.71% | -1.18% | -3.45% | 69 |
| 5d | 5 | +5 | 1.6 | 2% | +1.61% | +9.30% | -3.31% | -1.26% | 16 |
| 5d | 10 | +2 | 0.4 | 1% | -1.84% | +4.76% | -1.56% | -7.65% | 4 |
| 10d | 3 | +2 | 9.4 | 28% | +0.96% | +4.90% | -1.07% | -1.75% | 94 |
| 10d | 3 | +5 | 6.4 | 20% | +1.65% | +5.86% | -0.74% | -1.56% | 64 |
| 10d | 5 | +2 | 6.4 | 20% | +1.41% | +4.58% | -0.61% | -2.21% | 64 |
| 10d | 5 | +5 | 4.6 | 12% | +2.12% | +5.97% | -0.56% | -1.26% | 46 |
| 10d | 10 | +2 | 3.3 | 7% | +3.66% | +8.59% | -0.66% | -0.90% | 33 |
| 10d | 10 | +5 | 1.3 | 3% | +3.97% | +3.57% | -2.47% | +0.23% | 13 |
| 20d | 3 | +2 | 7.3 | 28% | +1.59% | +4.60% | +0.73% | -1.35% | 73 |
| 20d | 3 | +5 | 6.0 | 24% | +1.76% | +5.11% | -0.11% | -1.47% | 60 |
| 20d | 5 | +2 | 5.0 | 23% | +2.19% | +6.40% | -0.25% | -1.04% | 50 |
| 20d | 5 | +5 | 4.0 | 19% | +2.83% | +7.28% | -1.02% | -0.80% | 40 |
| 20d | 10 | +2 | 3.0 | 14% | +3.28% | +7.24% | -1.48% | -1.30% | 30 |
| 20d | 10 | +5 | 2.4 | 11% | +2.96% | +6.58% | -0.74% | +0.23% | 24 |
| 63d | 3 | +2 | 4.3 | 27% | +2.19% | +4.02% | +1.03% | -1.73% | 43 |
| 63d | 3 | +5 | 4.3 | 26% | +2.48% | +4.17% | +1.12% | -1.77% | 43 |
| 63d | 5 | +2 | 3.2 | 23% | +1.08% | +2.98% | +1.93% | +1.54% | 32 |
| 63d | 5 | +5 | 3.2 | 21% | +1.00% | +2.83% | +1.77% | +1.61% | 32 |
| 63d | 10 | +2 | 2.0 | 18% | +1.62% | +1.77% | +1.27% | +2.38% | 20 |
| 63d | 10 | +5 | 1.9 | 15% | +1.46% | +1.89% | +1.61% | +1.24% | 19 |

## What it means

- **The proposed rule fired about 13 times a year.** That is a dip-in-a-bull-market detector, not a regime change. Chips went on to beat SPY by +5.2% over the next 60 sessions after it fired.
- **Faster windows were worse than useless.** A 5- or 10-day lag in a leading sector tends to snap back, the same short-term reversal that the 12-1 rank skips its last month to avoid.
- **The only faint hint was the slowest variant:** a 63-day window confirmed on 10 closes. Chips' 60-session edge shrank from +4.6% to about +1.8%, and the receiver beat SPY by about +2.4% (58% of the time). That is n=19-20 events that overlap each other, the best 2 of 24 variants, in one decade. It is too thin to trust. It is also a slower, noisier copy of the 12-1 leadership rank that `bull-watch.mjs` already runs.
- **Caveat:** 2016-2026 was a chip super-cycle, and SMH beat SPY by about 4.6% per quarter on average. Any rule that says "leave chips" was fighting the decade's strongest trend. This test cannot prove rotation signals never work. It shows these ones would have cost money here.

## What watches rotation instead

The tested rotation alert already runs every evening. In `bull-watch.mjs`, a sector entering the top 3 by 12-1 momentum is logged as a leadership transition by `bench-plan-check-close`. That design returned 23.3%/yr vs SPY 12.9% over 10 years (see `2026-09-23-bull-market-trading.md`).

As of the 10/02 close (`db/bull-watch.json`, official closes) the top 3 were SMH #1, XBI #2 and XLE #3. GRID (power equipment) was #10, XLU (utilities) #16 and IGV (software) #19. Neither power nor software is close to taking the lead.

MC-032 (SMH close below 601.87, expires 10/09) stays as the price-level tripwire from B-688.
