# RUN THE MARKET — 2026-09-22, 06:15 CT (pre-market, v30)

Regime TRENDING, market risk 4/5. SPY 773.50 settle, above its 20, 50 and 200-day,
VIX 14.80. Pre-market is quiet: SPY 773.87, QQQ 741.82. Nothing on the board
reports this week.

## The headline: yesterday's two candidates both fail, and one of them fails in a
## way that matters more than the trade

Last night's hunt-close put APLD and SMCI on the book as ranked candidates with
entry lines for this morning. Both rows say the same sentence — the name closed
"clearing the prior 20-session high on 1.5x+ volume."

Neither one did, and the screen that produced them already knew it. The receipt
those rows were written from records `breakout: false` for both. APLD's
20-session high is 29.61 from August 21; it closed 28.19, a dollar forty-two
under. SMCI's is 41.53 from September 8; it closed 41.20, thirty-three cents
under. Volume on APLD was 1.15x, on SMCI 0.96x — below its own average, not half
again above it. I hand-counted both off the daily bars and got the same answer
the receipt gives. The screen listed both as STALK. The rows wrote entry lines
anyway.

That is twice in one file, so I am logging it as a structural gap rather than a
bad night: a row's prose asserted a gate its own receipt marked false. The fix is
cheap — the screen's gate booleans should be quoted into the row instead of
re-described — and I have not made it yet, because it is a change to how the
close routine writes and you should see the evidence before I touch it.

## The second blocker, and this one is yours

Both candidates were priced as call debit spreads. The margin account is at
**options level 2** this morning — long calls and puts only. A vertical spread
needs level 3. Neither structure is placeable.

This is not new. It was written into a row on September 18 and it is still true
four sessions later. Every defined-risk structure the framework prefers — the
call debit spread on the long side, the put spread that v26 makes the *default*
bearish expression — is unavailable until that changes. What is left at level 2
is naked long options, which is the structure the framework likes least: on SMCI
the Oct-02 41 call alone costs 222.50 against 170.00 for the spread, 73% of the
risk band instead of 56%, with the short leg no longer paying for part of it. More
money for worse odds is not a substitute plan, so I did not write one.

Upgrading is a form and an approval and it is yours to do or not do. I am not
asking you to — I am telling you the framework is currently writing plans the
account cannot execute, and that gap will keep producing rows like last night's
until one of the two ends changes.

## What each name is actually worth

**SMCI is the real one.** Corrected as B-507. It is the only name on the board
that leads on every horizon — ahead of SPY, QQQ and XLK at 1, 5, 20 and 60
sessions, above all four moving averages, August golden cross intact. The catalyst
is verified and unchanged: ~60B order book, FY2027 revenue guide of 65-72B
reiterated on the August 11 print, and management at Goldman on September 10 on
6,000 racks a month. Earnings November 3, well clear. The trigger moves up to a
daily close above **41.53** — the real 20-session high, not yesterday's close —
with invalidation 38.32, which is 1.19 ATR and clears the floor. Pre-market 41.00.
Say the uncomfortable part plainly: SMCI's own base rate on this setup is 50.0%
on direction, grade A, 82 samples. A coin flip. Street consensus is HOLD with a
39.50 target *below* spot, Goldman has an outright SELL at 34, and insiders sold
400,000 shares into this range with no open-market buys. It leads and nobody
believes it. Decide-by 9/28.

**APLD is out.** Logged as B-506, no ticket. Beyond the false breakout, it closed
+0.25% on September 21 — the strongest tape of the month, SPY +1.55%, QQQ +2.77% —
and finished red from its own open. Down 31% over 60 sessions, below its 50, 100
and 200-day with an August death cross. The Wells Fargo Overweight and the 36B
take-or-pay lease book are real and the stop geometry was sound; the setup simply
was not there. Re-look on a close above 29.61 on genuine volume.

**CEG: the verification you were owed is done.** B-467 carried a caveat that the
September 18 settled close had not posted and the row must be corrected if it came
back lower. It came back at 254.71 to the cent. The short trigger required a close
*under* 254.71 and by zero cents did not get one. B-467 stands. It is further away
now, not closer — CEG closed 262.11 yesterday, +2.91%, and the line that was being
pressed got defended and bought 3% higher. Readiness 15. Logged B-508.

## The open book

GOOGL, 3 shares at 335.26, marks 356.80 pre-market — up 6.4%, invalidation 326
untouched and 8.6% below. UBER, 13 shares at 71.84, marks 71.30 — down 0.8%, the
68.90 stop resting and confirmed at the broker, decide-by 9/25. Account 3,052.68
with 1,056.38 of buying power. The risk band is 305.27.

The power-layer question from this morning's pre-market read is still the one
worth watching: PWR needs 650.58 and GEV needs 957.27, both about 1.2% away. If
they reclaim on a day QQQ holds its record, September 14 was lag. If QQQ makes new
highs this week and those six stay under, it is a rates repricing and the whole
layer reads differently from here.

## REPORT CARD

- **Verdict:** No entry today. Both of yesterday's candidates fail, for different reasons.
- **Grade:** the screen B, the rows written from it D — the gates were computed correctly and then described wrongly.
- **The number:** 41.53. SMCI's real 20-session high, and the only line on the board worth an order.
- **Plan:** SMCI conditional, close above 41.53, stop 38.32, decide-by 9/28 — structure unresolved.
- **Opens:** B-507 SMCI corrected. **Kills:** B-506 APLD no ticket, B-508 CEG short parked at readiness 15.
- **Next date:** 9/25, UBER decide-by. 9/28, SMCI decide-by.
- **Your call:** whether to pursue options level 3. Until then the framework prices structures the account cannot place.
- **Row:** B-506, B-507, B-508.
