# ROLL SCOUT - 2026-10-13 07:10 CT (pre-market, v35)

**Adam, 06:50 CT:** "If we stop out on google because chip selloff let's roll into another play. Start scouting and give me setup."

**The answer: Exxon (XOM) on a pullback, B-849, watchlist only today.** It is the only name outside the AI trade that clears the capital test and has a real target. Costco has the best chart but fails the market leg (B-850). XLE is at its high with nothing to aim at (B-851).

## What the scenario means

If GOOGL's 326 stop-losses fill, the chip selling will have spread into the companies that buy the chips. GOOGL is 353.38 pre-market, so a stop-out is a 7.7% drop, about 3.3 of its ATRs. Every AI-infrastructure long the hunters found last night (PWR, GEV, CEG, TLN, VST, ANET, HPE, DELL, PENG) is the same bet that would have just stopped out. So the scout looked outside the AI trade on purpose.

After a fill at 326, the account is about 3,319, the 10% band is about 332, and buying power is about 3,310 (702.30 cash plus 2,608 from the sale). A gap through 326 would fill lower.

## The scout

`rs.mjs` ran on 33 non-AI names and sector funds (20- and 60-session windows), and `options-hunter.mjs --hunt` ran on 12 of them (receipt 7cefd808, as of the 10/12 close, not written to disk).

**v35 market leg:** a name loses if it trails SPY on both windows or QQQ on both windows.
- **Fail (No Trade):** COST (vs QQQ -0.79 / -5.32), WMT, LLY, XLP, XLV, TLT, GLD, XLF, JPM, GS, MS, LMT, RTX, NOC, CAT, UNH, XBI, XLU, DIA.
- **Pass:** XOM (LEADER vs SPY +2.02 / +12.14), XLE (+0.03 / +9.76), ABBV (+5.13 / +5.80).

**Of the three that pass:**
- **XLE:** made its 52-week high Monday (66.42) on 0.60x volume. Nothing overhead means no 2:1 target. Pass, B-851.
- **ABBV:** at an all-time high, 283.70 pre-market, with no target. Earnings 10/30 before the open (verified). Not logged as a plan, same reason as XLE.
- **XOM:** has a target, the 176.41 March 52-week high. It's the plan below.

**Costco, in fairness, B-850:** the best chart in the scout. The 9/25 earnings reversal came off 883.10 on twice-normal volume, followed by seven higher lows since 10/01 and a close at the 10/12 high. It's 967.88 pre-market, over its 200-day. Next earnings are mid-December, so it's the only candidate with no print in the window. September comparable sales were +11.4% (+7.6% excluding gas and currency), with digital +19% ([Costco September sales, 8-K](https://www.sec.gov/Archives/edgar/data/0000909832/000090983226000084/costex9918-k92426.htm); [GlobeNewswire release](https://www.globenewswire.com/news-release/2026/10/07/3376846/0/en/index.html)). It still trails QQQ on both windows, and v35 says that is No Trade, whatever the chart says. It gets re-run when it leads QQQ on one window.

## XOM - the plan (B-849)

**Why it competes:** it leads SPY on both windows, beats its own sector fund XLE on both (20D 4.28% vs 2.29%, 60D 16.82% vs 14.44%), splits against QQQ (behind 0.91 over 20, ahead 9.53 over 60), and splits against SMH, the bull-mode alternative. No cap applies.

**The chart:** Monday it closed 172.15, through the 9/15 high of 169.64, but on light volume (8.81M, 0.66x). The swing lows keep rising: 155.85, 159.27, 160.81, 163.46, 166.71, 171.01. The 20-day is 163.85, the 50-day 161.90, the 200-day 150.59. ATR(14) is 3.52. Pre-market is 173.30.

**Buying now fails:** 173.30 to 176.41 is 3.11 of reward against a stop that must sit at least 3.52 away.

| | |
|---|---|
| **Entry zone** | 164.25 - 165.90. The bottom is 1.0 ATR over the stop (the ATR floor). The top is the 2:1 ceiling (165.94). |
| **Stop-loss** | 160.70, under the 10/01 low (160.81) and the 50-day |
| **Target 1** | 172.55, Monday's high. Sell half here (1.28 times the risk from the ceiling). |
| **Target 2** | 176.41, the March 52-week high. 2.02 times the risk from 165.90, 3.43 times from 164.25. |
| **Entry path** | Option A only: the first 30-minute bar closes inside the zone, buy limit never above 165.90, and the 160.70 stop goes in GTC the same minute. Option B (night-before) does not qualify while readiness is under 50. |
| **Dip clock** | 5 sessions (bull mode rule 4). If XOM never closes in the zone by the 10/19 close, the plan is void and gets re-judged as a breakout. |
| **Hard exit** | The 10/29 close. Earnings are 10/30 before the open (Robinhood shows it unverified, so recheck on each run). Nothing is held into the print. |
| **Size** | The band allows 63 shares at 5.20 risk. Buying power after a GOOGL stop-out caps it at **19 shares, about 3,152, 95% of the account. Concentration declared.** Max loss 98.80. Target 2 pays 199.69. Without the stop-out, today's 702 of cash buys 4 shares. |
| **Wrong if** | A close under 160.70, or XLE losing its 60-session lead over SPY |

**Grades:** Technical B+ (leader with higher lows and a fresh September-high break, but on light volume and 4 points under the March high). Fundamental B (P/E 21.7, dividend 2.44%, 708B cap; the insider leg is thin because the new holding-company filer shows no Form 4s in 180 days). Execution C+ (it needs a 4-5% pullback into a 1.65-point zone, with 12 sessions before the print). **Overall B-, Opportunity 66.**

**Readiness 40, so watchlist only today.** The six inputs: trigger 2.10 ATR away (30), FOMO heating up (75), volume 0.66x (0), stop legal and 2:1 (100), no catalyst in the window (50), and the 10/30 earnings inside the default 2-8 week window (0). The mean is 42.5, capped at 40 by the print.

**Hunter (read after grading):** DISCOVERY, readiness 32, R:R 0.98 to the first shelf. The desk's number is 8 points higher because it prices a pullback entry, not a buy at the current price.

**The rule question, for Adam:** the earnings cap reads the default 2-8 week window, even when the plan sells the session before the print. Read that way, any stock reporting in the next eight weeks is watchlist-only, and it is earnings season. UBER (B-848) hit the same wall this morning. If a hard exit the session before the print counts as keeping earnings out of the window, XOM's event input becomes 40 (CPI tomorrow), and at the zone, after CPI, its readiness is about 71. **The desk recommends yes:** a plan that is flat before the print never carries the gap the cap exists to stop. It is Adam's call, and it would be written into the framework as a new version, not assumed.

**Structures:** shares are the plan. Calls would have to expire before 10/30 and be priced the morning of entry, since a price quoted today at 173 says nothing about a fill at 165. Spreads cannot be placed at options level 2. A 2x energy fund is allowed by the leverage lane, but it is not planned here.

**The other roll, not planned:** if the stop-out comes on a broken market, the move is on the short side (puts on the weakest AI names). The short lane stays closed until after tomorrow's CPI print, and HUNT SHORT re-screens on the day.

**Watchers:** MC-141 (a close at or under 165.90 means the zone was reached, and the entry check runs the next morning), MC-142 (a close under 160.70 means the plan is dead), MC-143 (176.41 without a fill means a missed move). MC-097 already watches GOOGL under 326.

Rows B-849 (XOM), B-850 (COST), B-851 (XLE).
