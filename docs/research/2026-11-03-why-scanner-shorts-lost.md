# Why the scanner shorts lost (2026-11-03)

Adam: "Scanner shorts obviously not working. Analyze why they were all bad calls." Source: `db/paper-book.json`, lane `hunter-short`, 19 trades (14 closed, 5 open on 11/03). Builds on `docs/research/2026-10-30-lane-reviews.md`; nothing here changes a rule.

## The record

14 closed: 6 won, 8 lost, -3.77R, -$1,151.80. Exits: 4 full stops (WULF, LITE, AMAT, COHR, about -1R each), 10 time exits worth +0.24R between them, 0 targets. They were not all wrong on direction: 8 of 14 moved 1R in the short's favour first (10/30 review). The money went out through the four stops while the winners were sold for pennies at the 10-session clock.

## Why

1. **The scanner's own odds said no, and READY ignored them.** Every automatic entry carries the scanner's base rate in its note. p_dir (the chance the stock is lower in 10 sessions) had a median of 41% across the 13 automatic closed trades; only 3 were above 50%, and one of those (SNDG, 100%) rested on a handful of cases. p_reach (the chance of hitting the target) was under 5% on 12 of 13. READY is set by geometry alone (2:1 to a verified floor), so trades the scanner itself priced as worse than a coin flip still went on paper.
2. **The targets were drops these stocks almost never make in two weeks.** The "verified floor" is the nearest old pivot low in five years of bars that pays 2:1. For names that ran up hard, that floor sits a long way down: median target -28% in 10 sessions (AAOI -51%, IREN -43%, 11/02 LITE -69%). To fit 2:1, the stops were wide too (median +13%, LITE +28%), so a normal bounce was worth a full -1R while the target was out of reach.
3. **They shorted leaders in a bull tape.** 15 of 19 are AI-infrastructure leaders (LITE twice, COHR, AMAT, VRT, GEV, CRWV, IREN, WULF, APLD, ANET, ETN, PWR, AAOI, MRVL) while the desk's AI BULL MARKET MODE was ON. Dips in those names were bought. The short screen was never tested over history (the long breakout was, R-007, and failed).
4. **Fourteen trades were really about four bets.** They entered on four evenings (10/14, 10/15, 10/20, 10/22), mostly the same sector in the same pullback. They won and lost together.
5. **AMZN was priced on a stale screen.** The scanner ran on the 10/29 settle, 243.79, with target 220.50 and stop 255.36. The paper fill came after hours at the 231.10 bid, after the earnings drop, with the stop left where it was: 24.26 of risk for 10.60 of reward, 0.44 to 1. The same failure is the B-1172 lesson (the target was already taken in the after-hours tape before any plan could price).

## What would have worked, in-sample only

Replaying the same 14 with every share out at 1R instead of the far target turns -3.73R into +4.15R (10/30 review). That came from these 14 trades, so it proves nothing. The near twin (PQN) was its forward test; it was switched off with the other twins on 11/03.
