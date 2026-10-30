# Two lane reviews: hunter-short and the shape twin (2026-10-30)

Both reviews came due at 10 closed: the hunter-short lane on 10/29 (14 closed now), the shape twin at 10 closed pairs. Scored in R, the way `docs/research/2026-10-29-lane-expectancy-stop-path.md` says every review starts. Ten closes can kill a badly broken lane; they cannot promote a rule.

## 1. Hunter-short (the question: is the desk's 2:1-to-a-verified-floor rule costing winners?)

| | |
|---|---|
| Closed | 14 (6 won, 8 lost) |
| Total | -3.77R, -$1,151.80 |
| Per trade | -0.27R |
| Exits | 0 targets, 4 stops (-1R each), 10 time exits (+0.24R between them) |

**The target never fills.** Median target distance was 2.29R. Not one of 14 reached it in ten sessions. The hunter said so at entry. The paper notes carry its own odds: 12 of the 13 automatic entries had p_reach under 5% (SNDG was 33%; ASTS was a manual entry with no hunter odds). The lane traded a target its own base rate called near-impossible.

**The direction was not the problem.** Best move in the trade's favour before any stop:

| Reached before the stop | Trades |
|---|---|
| 0.5R | 10 of 14 |
| 1R | 8 of 14 |
| 1.5R | 2 of 14 |

Replayed through paper-book.mjs's own scoring, every share out at a nearer target, same stops and exit dates:

| Target | Total | Per trade | Winners |
|---|---|---|---|
| As traded (hunter's floor) | -3.73R | -0.27R | 6 |
| 0.75R | +3.86R | +0.28R | 10 |
| 1R | +4.15R | +0.30R | 8 |
| 1.25R | +3.90R | +0.28R | 8 |
| 1.5R | -1.21R | -0.09R | 6 |

(-3.73R here against -3.77R on the book: the replay uses Yahoo bars, the book used Robinhood's, so COHR's gap fill and a few exit-day closes differ by cents.)

**Why that table proves nothing yet.** The 1R idea came from these 14 trades. They were entered on four dates (10/14, 10/15, 10/20, 10/22), and 11 of the 14 are AI-infrastructure names that fell together in one October pullback. That is closer to four bets than fourteen.

**A scoring bug, fixed.** These shorts enter at the after-hours bid, but the scorer counted the entry day's high and low, which happened before the entry. A stop or a target could fire before the trade existed. Re-scored without that bar, none of the 14 results changes. Fixed going forward: `entry_after_close` on the trade, set by `hunt-add`, honoured by paper-book.mjs and every twin. The 18 hunter-short trades on the book carry it now.

**Answer.** No, the desk's rule is not costing winners. Traded exactly as the hunter specified, these lost money, so passing them was right. The setups did move the right way for a few days; the leak is the far target, not the direction.

**Recommendation: keep the lane and the desk's rule unchanged, and test the near target forward.** Built today: the **near twin (PQN-###)**, the paper trade with every share out at the nearer of 1R and the paper trade's own first target (no second target, no stop move after T1). It runs beside every paper trade. Only pairs entered from 2026-10-31 count: the report prints the 16 earlier pairs as IN-SAMPLE and never raises a review on them. At 10 forward pairs, compare near vs fixed and decide. The wide-stop twin is held to the same forward-only rule.

## 2. The shape twin (PQS-###)

| | Closed pairs | Fixed | Shape |
|---|---|---|---|
| Total | 10 | -3.52R | -6.66R |

Nine of the ten pairs finished within 0.02R of the paper trade. The whole gap is one trade: MRNA. The paper trade sold at its target for +2.17R. The shape twin, which has no target and never moves its stop, held while the trend "held" and rode the move back to its -1R stop. A 3.17R swing.

Those ten pairs leave out the six shape twins still open after their paper trade closed, and those are the ones letting a winner run. On the 10/29 marks they total +1.70R against +0.69R for their paper trades (IREN +0.80R vs +0.25R, AAOI +0.36R vs +0.16R, APLD +0.24R vs -0.15R, ETN and ANET level, ASTS -0.21R vs -0.08R). Counting them, the shape twin is still behind: -4.96R against -2.83R, and MRNA is still most of the gap. The shape twin exists to let winners run while the trend holds. It does, a little, on small winners; it gave back the one big winner it had.

**Recommendation: retire the shape twin.** Stop adding new PQS twins; the open ones finish and keep their record. The trail twin stays (16 pairs: -2.35R vs fixed -2.83R, better on 9 and worse on 6 counting any difference, gave back 0.83R a trade); its review comes at 20 pairs.

## Still open, not decided here

- Whether a hunter READY short whose own p_reach is under 5% should be READY at all. That is a hunter rule, and the near twin's forward record answers it better than another in-sample cut.
- The wide-stop twin keeps running (14 closed pairs, all in-sample; forward pairs start 2026-10-31).

Checked by a fresh-context reviewer the same day: every number above was re-derived; its four findings (the forward-only rule was not in the code, the shape pairs left out open twins, the near target could sit further out than the paper target, after-close entries were marked at the pre-entry close) are fixed in the code and in this note.
