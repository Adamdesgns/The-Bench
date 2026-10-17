# Weekend hunt, Fri 2026-10-16 after the close, for Mon 10/19

Workflow `wf_7627ed22-355`: 6 hunters (catalysts, leaders, pullbacks, shorts, options EV, post-earnings drift), 4 Opus judges on framework v35, 1 builder. 11 agents, 18 names judged.

## Desk corrections before logging (read these first)

**The judges' long zones broke the ATR floor.** The ATR floor says the stop must sit at least 1.0 ATR under the entry. For CRM, DE and WDAY, the bottom of each zone was closer to the stop than one ATR, so only a sliver at the very top of the zone was a legal fill. The desk fixed each one the same way: zone bottom = stop + 1.0 ATR, zone top = the highest entry that still pays 2:1 to T1.

| Ticker | Judge zone / stop | Logged zone / stop | Row |
|---|---|---|---|
| CRM | 224.00-226.50 / 217.40 | **224.00-224.96 / 214.91** (Benny 9 sh, about $90 risk) | B-944 |
| DE | 619.00-622.50 / 603.60 | **617.89-619.46 / 599.00** | B-948 |
| WDAY | 183.50-185.80 / 178.60 | **183.15-184.08 / 176.00** | B-949 |

LW, APLD and IREN were already consistent and are logged as judged.

**Armed for Monday's 9:02 entry check** (db/plan-signals.json `armed_not_signaled`): CRM B-944, LW B-947, DE B-948 (watch only), WDAY B-949 (watch only). The shorts are **not** armed there. APLD B-945 is a Benny options ticket and IREN B-946 is its swap, and the entry check only writes BUY tickets.

**Rows:** B-944..B-950 conditional, B-951..B-961 pass. **Watchers:** MC-190..MC-213.

---

# Monday 10/19 play sheet: Benny's $10,000 paper book

Every price below was re-pulled from Robinhood after Friday's close: CRM 240.68, APLD 18.05, IREN 27.00, EOG 158.05, WDAY 190.80, DE 641.85, LW 53.56, COP 146.51, SPY 763.30. All of them match the judged numbers. I could not re-pull the option prices. The judges gave only the first 8 characters of each contract ID, so every option price here is Friday's 3:59pm price. Re-price them at the open.

**The market mood is RISK-OFF.** SPY closed at 763.30, under its 50-day average of 768.50 (the average close over the last 50 sessions). VIX, the market's fear gauge, is 19.99 and up 34.7% in 5 sessions. That cuts two ways. Any dip-buy on this sheet only fills if the market sells off first. The short side has the tape behind it.

**Terms, defined once:**
- **Zone:** the price range we are allowed to buy in.
- **First 30-min bar:** the 9:30–10:00 ET price bar. Its close is the signal.
- **Stop:** the price where we are wrong and get out.
- **T1 / T2:** the first and second price targets.
- **ATR:** the average size of one day's move.
- **R:R:** dollars we can make for each dollar we risk.
- **Put debit spread:** buy one put and sell a cheaper put below it. The most we can lose is what we paid.
- **Natural debit:** the cost if we pay the ask on the put we buy and take the bid on the put we sell. That is the worst normal fill.

**Monday rules:**
- Nothing is entered on Friday's close.
- Every entry needs the first 30-min bar on Monday or later to close inside the zone.
- A 9:02 NO TRADE stands for the whole session.

---

## 1. Lower-risk core (shares, $100 risk each)

**CRM (Salesforce), long, ENTER-PLAN. It fires only on a dip.**
- **Zone:** 224.00–226.50. Price is 240.68, so this needs about a 6% drop first. After-hours was 239.56.
- **Stop:** 217.40, a daily close below it.
- **Targets:** T1 245.06, T2 251.94.
- **Size:** 10 shares. That is about $2,265 of stock and **$91 at risk**.
- **If it hits:** at T1 the whole position makes **+$186**. Selling half at T1 and half at T2 makes **+$220**. The stop loses **–$91**.
- **Exit by:** 11/20. FOMC and MSFT earnings both land 10/28, inside the hold. CRM's own earnings are 12/2, after the exit.
- **Why it is the one core name:** it leads both SPY and the software sector (IGV) over 20 and 60 sessions. It is the only long that also pays 2:1 to a level the chart has actually printed.
- **The weak spots:** Friday was a bearish reversal (opened 250.51, closed 240.70). It also needs a selloff to fill.

No other shares plan qualified as ENTER-PLAN. The rest of the longs are on the WATCH list below.

## 2. Higher-risk options (risk cap $300 each, $900 open at most)

**A. APLD (Applied Digital), short, ENTER-PLAN. This is the only live options ticket.**
- **Trigger:** Monday's first 30-min bar closes inside 17.81–18.19.
  - Void if it closes above 18.36. That means the breakdown failed.
  - Void if it closes below 17.81. That means it gapped through, and we do not chase.
- **Legs:** buy the 10/30 18 put, sell the 10/30 15 put.
  - Friday quotes: 18P 1.25 bid / 1.41 ask. 15P 0.33 bid / 0.40 ask. The 15P is thin, with only 21 contracts on the bid.
  - Natural debit is 1.08, so $108 per contract. Do not pay more than 1.15.
- **Size:** 2 contracts. **Max loss $216** (up to $230 at the 1.15 ceiling). **Max gain $384** (1.78x). Breakeven 16.92.
- **Exits:**
  - Out on a close above 19.95.
  - Out on the 10/23 close if APLD has not closed under 16.92.
  - Out completely by the 10/29 close.
  - Take profit near 1.6x the debit if APLD trades around 16.20.
- **Risk inside the window:** META reports 10/21 after the close. That date comes from the AAOI judgment and I did not re-verify it here. MSFT reports 10/28. A strong AI-spending headline from either one could squeeze this short.
- **Correlation:** the main paper book already holds APLD short (PB-007). Benny's book is separate, but this is the same idea twice across the two books.

**B. IREN, short, WATCH. Use it only as the swap if APLD voids or is already closed.**
- **Trigger:** Monday's first 30-min bar closes at or under 26.45, inside 26.00–26.45. After-hours was 26.96, so it is not there yet.
- **Legs:** buy the 10/30 27 put, sell the 10/30 22 put.
  - Natural debit 1.88, so $188. Do not pay more than 1.90.
  - 1 contract. **Max loss $188, max gain $312** (1.66x). Breakeven 25.12.
- **Alternative:** the 10/30 25/20 put spread. 2 contracts, $256 at risk, $744 max gain, breakeven 23.72. Only 2 contracts are offered at the 20P ask, so that fill is soft.
- **Kills:** a close over 30.39 ends the idea. The decision deadline is 10/23.

**C. EOG, long call spread, WATCH. It is the backup structure, and I prefer the shares plan.**
- **Trigger:** Monday's first 30-min bar closes above 158.37.
- **Legs:** buy the 10/30 160 call at the 3.40 ask, sell the 10/30 167.5 call at the 0.75 bid.
  - 1 contract, debit 2.65, so **$265 at risk**. Max gain **$485** (1.83x). Breakeven 162.65.
- **The problem:** the max gain needs 167.5. That number is ATR arithmetic, not a price the stock has printed before. It is an all-time high, so there is no overhead level to aim at.
- **Rule:** take EOG as shares or as this spread, never both.

**Options cap check:** the most that can be open under these rules is APLD $216 plus EOG $265, or $481. That leaves $419 of room under the $900 cap. APLD and IREN are never open at the same time.

## 3. Watch list (one trigger away)

Every trigger below is a first 30-min bar close, Monday or later.

| Ticker | Exact trigger | Stop | T1 | Size if it fires | Risk |
|---|---|---|---|---|---|
| EOG long | **above 158.37**, never filled above 159.25 | 154.60 | 163.60 (ATR guess) | 21 shares at 159.25 | $97.65 |
| LW long | inside **50.60–50.95**; deadline 10/23 | 48.60 | 55.70 | 42 shares at 50.95 | $98.70 |
| DE long | inside **619.00–622.50** | 603.60 | 660.39 | 5 shares at 622.50 | $94.50 |
| WDAY long | inside **183.50–185.80**, and only if CRM is not open | 178.60 | 200.23 | 13 shares at 185.80 | $94 |
| IREN short | at or under **26.45**, and only if APLD is not open | 29.30 | 22 spread strike | 1 × 27/22 put spread | $188 |
| COP long (swap for EOG) | EOG opens below 155 **and** COP closes above **146.59** on 1.5x volume | 142.90 | 152.00 (ATR guess) | 22 shares at 147.40 | $99 |

EOG is still a WATCH even if it triggers. T1 is only 0.94 times the risk and the target was never printed before, so the desk has to upgrade it before it is a trade.

**Passed, but the trigger should be watched:**
- BBIO above 69.77 (expires 11/25)
- IONS above 46.95 (MC-131, through 10/23)
- AAOI back above 85.02
- APOG above 44.05
- BLK first 30-min close at 1089–1091
- IOVA above 15.30 on 1.5x volume

## 4. Correlation check (no stacking the same bet)

- **Software is one slot.** CRM and WDAY are the same sector dip. If both trigger, only the first one is taken.
- **Oil is one slot.** EOG first, COP only as the swap. Both are the same Hormuz headline.
- **Neocloud short is one slot.** APLD first, IREN only as the swap. WULF and AAOI were passed, and the main paper book already holds all four.
- **AI semis have zero slots.** NVDA and the AAOI long both failed the test that a name must beat SPY on at least one of the 20- or 60-session windows.
- **What the sheet ends up as:** software dip + oil breakout + industrial dip (DE) + staples drift (LW) + AI-infrastructure short. The APLD short partly offsets the three dip-buys.
- **The hidden link:** CRM, DE and LW all fill on market weakness. If the market keeps falling, they can all be stopped together. That is the one real stack left, and it is about $285 of risk.

## 5. The money

**What is in the money: shares exposure.** The four longs together, CRM + EOG + DE + LW, come to about **$10,860**, which is more than the $10,000 book. So the four cannot all be held at once with cash. The first three to fire get funded. A fourth goes in only if cash allows, with about $300 kept free for options.

| Scenario | Plays | Dollars at risk | All hit T1 | All stopped |
|---|---|---|---|---|
| A. Live tickets only | CRM + APLD | **$307** | **+$570** (CRM +$186, APLD +$384 max) | **–$307** |
| B. Everything allowed fills | CRM, APLD, EOG shares, DE, LW | **$598** (6% of the book) | **+$1,050** (CRM +$186, APLD +$384, EOG +$91, DE +$189, LW +$200) | **–$598** |

- Scenario B's all-stopped loss of –$598 is far from the 15% drawdown pause ($1,500).
- APLD's +$384 only comes at expiry at or below 15. An early exit pays less.

## 6. An honest word on $1,000 a month

$1,000 a month on $10,000 is 10% a month. **The Bench's measured record does not support that yet.**

**What the scorecard says** (`node scripts/scorecard.mjs`, as of 10/17):
- **Every call, scored once:** 271 right, 347 wrong, 71 flat. That is 39% right.
- **Long calls at one month:** right 53% of the time, but only 32 calls have been scored.
- **Long calls at one week:** right 35% of the time.
- **Conditional calls** (buy only if a trigger fires) that fired: at one week, 42 ran and 92 did not, so about 31% worked. At one month it was 44 and 54, about 45%.
- **Calls that came from the hunters:** 3 of 25 right, 12%. Benny's book has no closed record of its own yet.

**What the paper book says** (`node scripts/paper-book.mjs report`): it shows +37% since 10/14. That number is mostly unbooked gains on shorts in a three-day selloff. The only closed trade lost 1.23 times its risk (–$406). That is not evidence of anything yet.

**The math behind a realistic number:**
- A shares trade risks $100 to make $200 (2:1).
- At a 40% hit rate, each trade earns about $20 on average.
- A $300 options ticket paying 1.8x at the same hit rate earns about $36.
- So $1,000 a month would take roughly 30 to 50 trades a month. This sheet is 2 live tickets and 5 conditionals, and in a RISK-OFF tape most dip zones either never fill or fill into more selling. That second case is exactly the "fired and did not run" group above.

**What this sheet points to:** $0 to $570 in the next two weeks if it goes right, and up to –$600 if everything is stopped. A realistic monthly pace at today's hit rates is **$100 to $300**.

$500 months are possible on a good run. $1,000 months need a better hit rate than the book has shown, and that will not be known until Benny has 20 or more closed trades.

The way to get there is to log every fill, score it, and change the rules that lose. Adding risk will not get there.

---

```json
[
 {"ticker":"CRM","side":"long","lane":"LOWER-RISK PULLBACKS","verdict":"ENTER-PLAN","sheet_role":"CORE","grade":"B-","readiness":52,"price":240.68,"price_asof":"2026-10-16 close (RH re-pulled)","entry_zone":"224.00-226.50","trigger":"first 30-min bar Mon 10/19 or later closes inside 224.00-226.50; Option A only","stop":217.40,"atr14":9.09,"target1":245.06,"target2":251.94,"rr":2.04,"structure":"shares","size":"10 sh","exposure_usd":2265,"dollar_risk":91,"t1_gain_usd":185.60,"t1_t2_split_gain_usd":220.00,"exit_date":"2026-11-20","earnings_date":"2026-12-02 pm (tentative)","events_in_hold":"FOMC 10/28, MSFT 10/28 pm","correlation_group":"software","correlation_rule":"only one software dip open (CRM before WDAY)","kills":"no entry if the 30-min bar closes under 224.00 or above 226.50; out on a daily close under 217.40; reclaim of 251.94 on 1.5x with no dip voids the plan","watches_to_register":[226.50,217.40,245.06]},
 {"ticker":"APLD","side":"short","lane":"SHORT SIDE put debit spread","verdict":"ENTER-PLAN","sheet_role":"OPTIONS-LIVE","grade":"C+","readiness":66,"price":18.05,"price_asof":"2026-10-16 close (RH re-pulled; AH 18.06)","entry_zone":"17.81-18.19","trigger":"first 30-min bar Mon 10/19 closes inside 17.81-18.19; void above 18.36 or below 17.81","stop":19.95,"atr14":1.76,"target1":13.53,"target2":13.16,"rr":2.0,"structure":"BUY 10/30 18P / SELL 10/30 15P","legs":{"long":"10/30 18P bid 1.25 ask 1.41","short":"10/30 15P bid 0.33 ask 0.40 (thin)"},"option_ids_prefix":["6b5775ae","97b88675"],"marks_asof":"2026-10-16 3:59pm, not re-pulled (only partial IDs)","debit_natural":1.08,"debit_ceiling":1.15,"contracts":2,"dollar_risk":216,"max_gain_usd":384,"payoff_multiple":1.78,"breakeven":16.92,"t1_gain_usd":384,"exit_date":"2026-10-29 close; time stop 10/23 close if not closed under 16.92","earnings_date":"none in window (next 2027-01-06 pm, unverified)","events_in_hold":"META 10/21 pm (from AAOI judgment, unverified here), MSFT/GOOGL 10/28","correlation_group":"neocloud-short","correlation_rule":"APLD or IREN, never both; main paper book holds PB-007 APLD","kills":"close above 19.95; CRWV close over 69.69; company-specific positive (lease, financing)","watches_to_register":[18.36,19.95,16.92,13.53]},
 {"ticker":"IREN","side":"short","lane":"SHORT SIDE put debit spread","verdict":"WATCH","sheet_role":"OPTIONS-SWAP","grade":"C+","readiness":58,"price":26.9998,"price_asof":"2026-10-16 close (AH 26.96)","entry_zone":"26.00-26.45","trigger":"first 30-min bar closes at or under 26.45; only if APLD not open","stop":29.30,"atr14":2.85,"target1":17.22,"target2":14.72,"rr":2.66,"structure":"BUY 10/30 27P / SELL 10/30 22P","legs":{"long":"27P bid 2.06 ask 2.23","short":"22P bid 0.35 ask 0.72"},"option_ids_prefix":["44889384","ca6edd2d"],"debit_natural":1.88,"debit_ceiling":1.90,"contracts":1,"dollar_risk":188,"max_gain_usd":312,"payoff_multiple":1.66,"breakeven":25.12,"alt_structure":{"legs":"10/30 25P / 20P","ids_prefix":["148824c8","fe1068d3"],"debit":1.28,"contracts":2,"dollar_risk":256,"max_gain_usd":744,"breakeven":23.72,"note":"20P ask size 2, soft"},"exit_date":"2026-10-29 close","earnings_date":"2026-11-05 pm (unverified)","correlation_group":"neocloud-short","kills":"close over 30.39 kills idea; close back over 28.93 after a break = failed; decide-by 10/23","watches_to_register":[26.45,29.30,30.39]},
 {"ticker":"EOG","side":"long","lane":"LEADERS AND BREAKOUTS","verdict":"WATCH","sheet_role":"WATCH (shares preferred; call spread alternative)","grade":"B-","readiness":55,"price":158.05,"price_asof":"2026-10-16 close (AH 158.33)","entry_zone":"158.40-159.25","trigger":"first 30-min bar closes above 158.37; ceiling 159.25","stop":154.60,"atr14":3.54,"target1":163.60,"target2":168.55,"rr":0.94,"structure":"shares","size":"21 sh at 159.25","exposure_usd":3344,"dollar_risk":97.65,"t1_gain_usd":91.35,"options_alternative":{"legs":"BUY 10/30 160C ask 3.40 / SELL 10/30 167.5C bid 0.75","debit":2.65,"contracts":1,"dollar_risk":265,"max_gain_usd":485,"payoff_multiple":1.83,"breakeven":162.65,"note":"max gain needs ATR-extrapolated 167.5; pick shares OR spread, never both"},"exit_date":"2026-11-04","earnings_date":"2026-11-05 pm","correlation_group":"oil","correlation_rule":"one oil slot; COP is swap only","upgrade_needed":"targets are ATR extrapolations; desk must upgrade before entry","kills":"open or close below 155.00; close below 154.60; Hormuz de-escalation gap","watches_to_register":[158.37,155.00,154.60]},
 {"ticker":"LW","side":"long","lane":"POST-EARNINGS DRIFT","verdict":"WATCH","sheet_role":"WATCH","grade":"B-","readiness":55,"price":53.555,"price_asof":"2026-10-16 close (AH 52.99)","entry_zone":"50.60-50.95","trigger":"first 30-min bar closes inside 50.60-50.95; 5-session clock through 10/23","stop":48.60,"atr14":2.00,"target1":55.70,"target2":60.55,"rr":2.02,"structure":"shares","size":"42 sh at 50.95 (50 sh at 50.60)","exposure_usd":2140,"dollar_risk":98.70,"t1_gain_usd":199.50,"exit_date":"2026-12-17","earnings_date":"2026-12-18 am (tentative)","correlation_group":"staples","kills":"daily close under 49.20; no fill by 10/23 close = re-judge; close above 55.70 on 1.5x = new breakout run, not this plan","watches_to_register":[50.95,48.60,55.70]},
 {"ticker":"DE","side":"long","lane":"LOWER-RISK PULLBACKS","verdict":"WATCH","sheet_role":"WATCH","grade":"C","readiness":47,"price":641.85,"price_asof":"2026-10-16 close","entry_zone":"619.00-622.50","trigger":"first 30-min bar closes inside 619.00-622.50","stop":603.60,"atr14":18.89,"target1":660.39,"target2":689.69,"rr":2.0,"structure":"shares","size":"5 sh at 622.50","exposure_usd":3113,"dollar_risk":94.50,"t1_gain_usd":189.45,"exit_date":"2026-11-24","earnings_date":"2026-11-25 am (verified)","correlation_group":"industrial","kills":"daily close under 617.21 breaks the shelf; under 603.60 void; reclaim 656.71 on 1.5x = fresh judgment","watches_to_register":[622.50,603.60,660.39]},
 {"ticker":"WDAY","side":"long","lane":"LOWER-RISK PULLBACKS","verdict":"WATCH","sheet_role":"WATCH (blocked while CRM open)","grade":"C+","readiness":45,"price":190.80,"price_asof":"2026-10-16 close","entry_zone":"183.50-185.80","trigger":"first 30-min bar closes inside 183.50-185.80; only if CRM not open","stop":178.60,"atr14":7.15,"target1":200.23,"target2":211.83,"rr":2.0,"structure":"shares","size":"13 sh at 185.80","exposure_usd":2415,"dollar_risk":94,"t1_gain_usd":187.29,"exit_date":"2026-11-20","earnings_date":"2026-11-24 pm (tentative)","correlation_group":"software","kills":"daily close under 181.47; close above 201.00 on 1.5x = breakout re-judge","watches_to_register":[185.80,178.60,201.00]},
 {"ticker":"COP","side":"long","lane":"LEADERS AND BREAKOUTS","verdict":"PASS","sheet_role":"SWAP for EOG","grade":"B-","readiness":45,"price":146.51,"price_asof":"2026-10-16 close","entry_zone":"146.80-147.40","trigger":"only if EOG opens below 155 AND COP first 30-min bar closes above 146.59 on 1.5x volume","stop":142.90,"atr14":3.24,"target1":152.00,"target2":156.20,"rr":1.02,"structure":"shares (reference)","size":"22 sh at 147.40","dollar_risk":99,"exit_date":"2026-11-04","earnings_date":"2026-11-05 am","correlation_group":"oil","open_rows":"B-182 still open; delta only","kills":"de-escalation gap; close below 142.90"},
 {"ticker":"IOVA","side":"long","lane":"DATED CATALYSTS v34","verdict":"PASS","grade":"C","readiness":40,"price":13.635,"stop":12.80,"atr14":0.87,"target1":14.74,"target2":15.30,"rr":1.16,"exit_date":"2026-10-23","earnings_date":"2026-11-05 am (tentative)","correlation_group":"biotech-catalyst","reason":"ESMO oral not on catalysts.json 5 sessions ahead; re-presented data; 1.16:1","passed_trigger_to_register":"close above 15.30 on 1.5x volume","kills":"close under 12.92"},
 {"ticker":"BBIO","side":"long","lane":"DATED CATALYSTS v34","verdict":"PASS","grade":"D+","readiness":30,"price":66.395,"stop":60.80,"atr14":2.37,"target1":69.77,"target2":72.94,"rr":1.80,"exit_date":"2026-10-27","earnings_date":"2026-10-28 pm (tentative)","correlation_group":"biotech-catalyst","reason":"earnings inside run-up window; trails SPY on both windows","passed_trigger_to_register":"BBIO > 69.77, expires 2026-11-25","kills":"close under 62.86"},
 {"ticker":"IONS","side":"long","lane":"DATED CATALYSTS v34","verdict":"PASS","grade":"D+","readiness":20,"price":42.97,"stop":41.14,"atr14":1.86,"target1":45.72,"target2":46.95,"rr":1.22,"exit_date":"2026-10-23","earnings_date":"2026-10-28 am (tentative); PDUFA 2026-10-26","correlation_group":"biotech-catalyst","reason":"Capital Competition No Trade; delta of B-832","passed_trigger_to_register":"MC-131 already registered (close above 46.95)","kills":"close under 42.36"},
 {"ticker":"MCK","side":"long","lane":"LEADERS AND BREAKOUTS","verdict":"PASS","grade":"C","readiness":33,"price":1004.84,"stop":987.80,"atr14":22.45,"target1":1050,"target2":1075,"rr":0.90,"exit_date":"2026-11-04","earnings_date":"2026-11-04 pm (verified)","correlation_group":"healthcare","reason":"no verified pivot; earnings in window","kills":"re-judge on 11/5 reaction"},
 {"ticker":"V","side":"long","lane":"LEADERS AND BREAKOUTS","verdict":"PASS","grade":"C","readiness":40,"price":402.61,"stop":399.40,"atr14":7.06,"target1":413,"target2":420.70,"rr":0.92,"exit_date":"2026-10-27","earnings_date":"2026-10-27 pm (verified)","correlation_group":"financials","reason":"no verified pivot; 7-session window before earnings","kills":"re-judge after 10/27 and MA 10/29 prints"},
 {"ticker":"NVDA","side":"long","lane":"LOWER-RISK PULLBACKS","verdict":"PASS","grade":"No Trade (Capital Competition)","readiness":40,"price":214.14,"stop":201.40,"atr14":5.97,"target1":223.08,"target2":234.76,"rr":2.05,"exit_date":"n/a","earnings_date":"2026-11-17 pm (verified)","correlation_group":"ai-semis","reason":"trails SPY on both 20/60 windows; RISK-OFF","open_rows":"B-713,B-714,B-745,B-749,B-758,B-790,B-809 delta only","kills":"re-judge when ahead of SPY on one window and regime off RISK-OFF; close under 202.99 ends premise"},
 {"ticker":"AAOI","side":"short","lane":"SHORT SIDE","verdict":"PASS","grade":"D (G1 fails)","readiness":55,"price":75.59,"stop":85.10,"atr14":9.42,"target1":41.12,"target2":31.67,"rr":3.15,"exit_date":"n/a","earnings_date":"2026-11-05 pm (verified)","correlation_group":"neocloud-short","reason":"no company-specific damage; main paper book holds PB-005","kills":"reopen only on company-specific damage before 10/30; close over 85.10 = unwind over"},
 {"ticker":"WULF","side":"short","lane":"SHORT SIDE","verdict":"PASS","grade":"C-","readiness":38,"price":11.655,"stop":11.60,"atr14":1.13,"target1":8.60,"target2":5.02,"rr":1.31,"exit_date":"n/a","earnings_date":"2026-11-06 am (verified)","correlation_group":"neocloud-short","reason":"breakdown not fired; stacked support; B-942 NO; main paper book holds PB-004","kills":"reopen on close under 10.35 on 1.5x plus a 2:1 structure; close over 12.83 ends short idea"},
 {"ticker":"AAOI","side":"long","lane":"OPTIONS EV lottery","verdict":"PASS","grade":"F / No Trade","readiness":30,"price":75.57,"stop":66.17,"atr14":9.42,"target1":85.02,"target2":100,"rr":1.0,"exit_date":"n/a","earnings_date":"2026-11-05 pm (verified)","correlation_group":"ai-semis","reason":"loses Capital Competition on both windows; no structural stop; would only be a labeled BET","passed_trigger_to_register":"close above 85.02 on 1.5x volume","kills":"n/a"},
 {"ticker":"APOG","side":"long","lane":"POST-EARNINGS DRIFT","verdict":"PASS","grade":"C","readiness":42,"price":41.38,"stop":39.15,"atr14":1.61,"target1":42.89,"target2":44.05,"rr":0.59,"exit_date":"n/a","earnings_date":"2027-01-06 am (tentative)","correlation_group":"industrial-smallcap","reason":"three overhead pivots; 0.59:1","passed_trigger_to_register":"weekly close above 44.05","kills":"daily close under 39.15"},
 {"ticker":"BLK","side":"long","lane":"POST-EARNINGS DRIFT","verdict":"PASS","grade":"C","readiness":45,"price":1133.87,"price_asof":"2026-10-16 close (RH re-pulled)","stop":1062,"atr14":26.8,"target1":1150.30,"target2":1187.17,"rr":0.88,"exit_date":"n/a","earnings_date":"2027-01-14 am (tentative)","correlation_group":"financials","reason":"rejected at 1150.30 pivot; hunter zone fails","passed_trigger_to_register":"first 30-min bar closes 1089-1091 (stop 1062, 3 sh, $87 risk, 2.0-2.15:1 to 1150.30)","kills":"daily close under 1062"},
 {"sheet_totals":{"scenario_A_live_only":{"plays":["CRM","APLD"],"dollar_risk":307,"all_t1_usd":570,"all_stops_usd":-307},"scenario_B_all_allowed":{"plays":["CRM","APLD","EOG shares","DE","LW"],"dollar_risk":597.85,"all_t1_usd":1049.90,"all_stops_usd":-597.85,"shares_exposure_usd":10862,"cash_note":"four longs exceed $10k; fund the first three to fire"},"options_open_max_usd":481,"options_cap_usd":900,"drawdown_pause_usd":1500,"regime":"RISK-OFF (SPY 763.30 < 50d 768.50, VIX 19.99 +34.7% 5d)","scorecard_ref":"one-per-call 271-347-71; long 1m 53.1% n=32; triggered conditionals 1w 42 ran / 92 did not","paper_book_ref":"since 10/14: 1 closed, -1.23R (-$406.23); +$1,727.91 open, mostly hunter shorts"}}
]
```