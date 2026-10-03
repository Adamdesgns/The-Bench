# v29 OPEN read - Tuesday 2026-09-15 08:30 CT (data pulled 08:25 CT, five minutes before the bell)

Interactive run, Adam at the keyboard: "RUN THE MARKET." Framework: prompts/trading-copilot-v29.md. Every price below is a Robinhood pre-market print at 08:25 CT against the official 9/14 settled close unless it says otherwise. Pre-market is thin; every level is re-checked at the open before anything is acted on. Claude places nothing.

## THE MARKET TODAY

Flat and waiting. SPY 760.71, down 0.02 percent from Monday's 760.88 settle. QQQ 708.84, down 0.05. IWM 286.67, down 0.17. DIA 523.94, down 0.10. The semiconductor ETF SMH is 545.47, up 0.73, bouncing a fifth of Monday's 4.7 percent loss. XLK 184.37 flat, XLE 64.66 up 0.20. TLT 80.66, down 0.33, which is the tape saying rates are still rising into the meeting; the 10-year touched 5.041 overnight and sat at 5.016 at 5:16 CT per CNBC (this morning's pre-market read), the 30-year about 5.38. VIXY 17.38, down 0.6, so the VIX is holding near 17. Bitcoin 76,879, down 0.9. Solana 100.94, Zcash 1,134.

The Fed meeting starts today and decides tomorrow at 13:00 CT with a dot plot and a press conference; CME FedWatch had a quarter-point hike above 92 percent at 5:40 this morning. Empire State printed at 07:30 CT and industrial production at 08:15 CT; neither was pulled here, so they are not in this read.

Regime: db/regime.json now reads EVENT, Market Risk 2 of 5, written this run by scripts/regime.mjs on the 9/14 bar (SPY 760.88, 20-day 766.11, 50-day 758.94, 200-day 714.69, VIX 16.89, 10-year 4.996). The label switched from CHOP to EVENT because a macro release sits on the next session. This run agrees with the stamp. Yesterday's run said 2 of 5 against a CHOP 3 stamp; today the stamp caught up. On the v29 scale 1 is Defense Only and 5 is Aggressive, so 2 means: hold what is held, write plans, fund nothing new before the decision.

Fear and Greed: not pulled this run. Scored without it.

## THE TWO-LAYER TAPE (P-036 test is at the close, not now)

The 05:44 pre-market read logged P-036: after Monday's buyers-over-silicon split, Tuesday reverses it. It holds if the silicon median beats the buyers median at today's 15:00 CT close. At 08:25 the order is still flipped from Monday.

Silicon, six names: Micron 933.61 up 1.04, AMD 499.39 up 1.21, Nvidia 212.95 up 0.94, TSMC 421.20 up 0.76, Broadcom 345.73 up 0.29, Marvell 220.96 up 0.98. Median plus 0.96, all six green.

Buyers, four names: Microsoft 501.55 down 0.76, Alphabet 346.60 down 0.80, Meta 662.36 down 0.49, Amazon 252.50 down 0.41. Median minus 0.63, none green.

The spread is 1.59 points in silicon's favor, a touch wider than the 1.49 at 5:40. Power and cooling is the layer that moved since the pre-market read: Vertiv 240.00 up 1.10, Eaton 398.92 up 1.47 on a thin 395 to 400 book, GE Vernova 886.30 up 1.32, Constellation 266.00 up 0.54, Vistra 141.47 up 0.53. Median plus 1.10, ahead of silicon, with the 10-year above 5. That is the opposite of P-034 (power falls harder than silicon on a rates day) and it gets its next test on Fed day, not today. Servers and storage: Dell 535.90 up 0.30, HPE 55.47 up 0.11, Supermicro 36.68 down 0.16.

The lesson stands from this morning: ask which side of a spread moved. Buyers are giving back part of Monday's gain; silicon is winning back a fraction of Monday's loss. Neither is a trend yet. Disclosure: the model writing this is made by Anthropic.

## THE ACCOUNT, LIVE (this decides more than any chart today)

Margin account ••6137: total 3,057.45, cash 61.41, buying power 62.41. Two positions, both verified at 08:25 CT with no state filter on the orders pull:

- 27 UBER at 71.84, filled Monday 07:44 CT in extended hours (order 6aa7ec20). Stop-loss SELL 27 at 68.90, GTC, regular hours, state confirmed, order 6aa7efa8, last touched by the broker sweep 07:23 CT today.
- 3 GOOGL at 335.26. Stop-loss SELL 3 at 326, GTC, regular hours, state confirmed, order 6a998591, last touched 07:24 CT today.

Agentic cash account ••7724: 10.66 cash, no positions.

The 10 percent band is 305.75. Committed risk at the two stops is 79.38 (Uber) plus 27.78 (Alphabet) = 107.16, so 198.59 of the band is free on paper. In practice nothing is: 62.41 of buying power funds no ticket on this board. Every plan below is therefore a WATCH by arithmetic until Uber or Alphabet exits or outside money arrives. Sized from the band as the rule says; the cap is reported because it binds.

## THE BOARD

**UBER - held, B-391 is the live row, nothing to do.** 72.45 pre-market (bid 72.35, ask 72.50), down 0.25 from Monday's 72.63 close. Unrealized plus 0.61 a share, plus 16.47. Monday's bar: open 71.975, low 71.26, high 72.80, close 72.63 on 19.1M shares, the lightest day of the week and a close in the top third of the range, which is what a stabilizing name looks like after a 2.2x-volume reversal day. ATR(14) settled through 9/14 is 2.54, so the 68.90 stop sits 3.55 below spot, 1.40 ATR, compliant. The v25 ratchet floor says a raised stop must stay at least 1.0 ATR under cost, which caps any ratchet at 69.30; forty cents is not worth touching a resting order for. Target 77.50 (the 9/8 President's-buy zone), 5.05 away, 1.99 ATR. Readiness stays capped at 60 by the macro window. The one thing that changes this row before Wednesday is a daily close under 71.00, the zone floor and the CEO's 70.96 basis; that would be a thesis flag, not a stop, and the stop stays where it is. Hold the 27. Adam owns the stop.

**GOOGL - held, and Monday paid.** Closed 349.39, up 3.25, on 35.9M shares, the biggest volume day of the week, then gave back 0.80 to 346.60 pre-market with the rest of the buyer layer. Unrealized plus 11.34 a share, plus 34.02. ATR(14) 8.39. The 326 stop is 20.60 under spot, 2.46 ATR, and 9.26 under cost. The ratchet floor caps a raise at 326.87, so no change. The B-303 tell (a close back above the 338.36 prior close) fired Friday and was logged Monday in B-373; Monday extended it with a close above the 20-day. Hold the 3, no add (B-297's ruling, and there is no buying power to add with). Alphabet remains the cleanest customer-side expression on the board and it is the one already owned.

**MU - B-374 watch only by rule, 52.61 over the line, decide-by Friday.** 933.61 pre-market, up 1.04, after Monday's 902.60 low and 924.03 close. The 881 zone is 0.99 ATR away (ATR 53.37). Readiness is capped at 40 because earnings sit inside the swing window; the date is 9/30 after the close, company-verified per B-335 (verified=true on the earnings feed). The catalyst board's 9/22 row was stale and is corrected this run. The B-144 pre-catalyst deadline 9/18 is Micron's own deadline; the desk owes a fresh run before then if 881 prints, and B-390 already showed the October call spread getting cheaper because the odds got worse, not better. No ticket possible either way this week.

**LITE - B-392 alive to 9/18, trigger unmet.** 845.54 pre-market, up 1.26. Monday settled 835.03 and the 50-day moved up to 828.58 (settled 9/14; it was 826.44 on the 9/11 bar the row was written on), so the hold was 6.45 above the average, 0.10 ATR. Volume 4.92M against a 4.2M average, 1.17x, which is not the fading volume the trigger requires. A hold on rising volume is a test that has not finished, not a passed test. The plan wants a close at or near the 50-day on volume below average; that has not happened. Watch the 15:00 CT close. Stop 777, thesis invalidation 784.47, target 988.98, per the row.

**IREN - B-377 watch, decide-by Wednesday 9/17.** 42.79 pre-market, down 0.88, after Monday's 41.77 touch and 43.17 close. The zone is a daily close inside 41.50 to 42.00 that holds the 20-day (41.73, settled 9/14) on fading volume. Monday's close was outside the zone, so no signal; Monday's volume was 35.2M, also not fading. Pre-market is 0.79 above the zone top. The trigger is the close, never the touch.

**MRVL - B-397 holding the 50-day, fresh run owed after the Fed.** 220.96 pre-market, up 0.98. The 50-day is 216.32 (settled 9/14), 4.64 below, 0.31 ATR on ATR 14.88. B-397's condition was a hold of the 50-day on the Tuesday and Wednesday closes, then re-arm on a close above the 20-day 227.75 on volume. The geometry still fails 2 to 1 from here; nothing changes until Wednesday's close.

**DELL and HPE - P-032 grades Friday, one floor holding, one lost.** Dell 535.90 pre-market, 18.18 above the 517.72 initiation-gap floor (B-360, decide-by 9/18). HPE 55.47, and Monday's 55.41 close is under its 56.34 earnings-gap floor by 0.93. The pattern grades on the fifth-session return at Friday's close, not on today, and no instance is written yet. Dell is the one that would get a pullback plan after the Fed if it holds.

**CEG - B-356 voided, logged this run.** Monday settled 264.57, under the 277.50 floor of the 287.22 to 288.50 band. The plan-check at 15:30 Monday named it void and wrote no row; this run writes the row so the tripwire stops listing a dead gate. 266.00 pre-market. Next level of record is the 200-day (298.95 on the 9/4 run, unverified since). Fresh run only on a reclaim.

**VST - watchlist floor lost, breakout plan untouched.** Monday closed 140.73 under the 141.50 watchlist floor, 141.47 pre-market. The accumulation lane is off. B-301's plan is a daily close above 160.00 on 1.5x volume, decide-by 10/02, and that plan does not depend on the floor. The thesis review the worklog owes is: the CEO's 135.00 to 135.25 buys are 4.4 percent below spot and untested. Note only today.

**The rest, one line each.** ORCL 143.61, no position (B-385); the 50-day 140.68 is the line Thursday's post keys on, fresh run after the Fed if it holds 140. AVGO 345.73, B-394 watch, reclaim of record 384.58. NVDA 212.95, no live row. CBRS 181.52; the lockup releases Wednesday 05:00 CT, B-312's 173 trigger is 4.7 percent below. SPCX 148.75, Nasdaq-100 weight step-up at Friday's close (expected). KLIC 79.30, under 85 again (B-364, decide-by 10/26). AVAV 152.00, no plan. HIMS 28.30, down 1.8, watch. AAOI 96.20, CRWV 82.76, NBIS 212.75, all passes from last night, nothing changed overnight.

## CATALYSTS INSIDE THE WINDOW

Today: FOMC day one. Wednesday 05:00 CT: CBRS lockup, 6.7 percent of eligible securities. Wednesday 13:00 CT: the decision, the dots, the presser. Wednesday is also IREN's decide-by. Friday 9/18: triple witching, S&P rebalance at the close, SpaceX step-up (expected), Micron's B-144 deadline, Dell's B-360 decide-by, LITE's B-392 decide-by, P-032's fifth session. Friday or Monday: RARE PDUFA (B-292, no position). Micron reports 9/30 after the close, verified.

## THE TRAP

Buying the silicon bounce the day before a dot-plot meeting because it is up 1 percent after being down 5. Monday's run said the same thing about the dip and it was right by the close. Today there is a second guard: there is no buying power to do it with, so the trap would have to be funded by selling Uber or Alphabet, and neither exit condition has printed.

## WHAT WOULD CHANGE MY MIND

If silicon still leads buyers at 15:00 CT, P-036 holds and the essay trade has become a two-day round trip rather than a re-rating; that argues for fresh runs on MRVL and LITE Thursday. If buyers retake the lead by the close, P-036 fails, the slowdown read is the one the market believes, and Alphabet's stop is the position to keep tight. If the Fed does not hike, the regime stamp is wrong in the other direction and every readiness cap gets recomputed Thursday morning. Nothing on this board is a Wednesday trade.

Rows logged this run are echoed in the worklog. Nothing was placed, and Claude places nothing.
