# THE BENCH v29 — "Run the market" — Thursday 2026-09-03, 06:36 CT pre-market

**Origin:** adam ("Run v29 on the market"). All four names below are DELTAS of live rows. Prices are pre-market prints at 11:36Z (06:36 CT) against 9/2 official closes — every level is re-pulled at the open before anything is acted on.

---

## THE MARKET TODAY

- **Regime stamp (db/regime.json, 9/2 close):** RISK-ON · Market Risk **4/5**. SPY 765.16 above the 50-day 755.34, VIX 15.27, IWM lagging SPY by 1.95 pts over 20 sessions. This desk reports 4/5 from the stamp and does not disagree.
- **Pre-market:** SPY 765.56 (+0.05%), QQQ 708.81 (−0.06%). Flat tape, single-name dispersion: SNOW +23%, AVGO −2.9%, HPE −3.4%, DELL −1.5%.
- **Macro inside 2 sessions:** jobless claims 7:30 CT today, ISM services 9:00 CT, Fed's Waller/Hammack/Goolsbee speaking, **Friday's jobs report**, and futures pricing ~60% odds of a September HIKE (10-yr 4.76–4.80). **Every Readiness score today is capped at 60 by rule.**
- **Prints tonight on the board:** AMBA (QUEUE) and PATH (NO-TRADE) both report after the close. Pre-catalyst deadline is 1:00 pm CT and nothing defined-risk fits the account, so both pass into the print by arithmetic. Reaction only, tomorrow.
- **Account, live (margin ••6137):** total 2,517.30 · equity 1,016.87 (3 GOOGL) · cash 1,500.43 · **buying power 1,501.43**. Standing 10% band = **$251.73**. As on every day since B-214, the **capital cap binds before the band does**: any new name at these prices is ~$1,450 and takes 96% of buying power. **Only one of AVGO or CEG can be funded, not both.**
- **Hunt lists (scripts/hunt-list.mjs):** DISCOVERY none · STALK **COHR** (266.71 pre, at its 267.51 stalk price — the accumulation lane technically unlocks, but it competes for the same $1,500 as CEG and loses on leadership; stays STALK) · READY 0/3.

---

## 1. AVGO — B-214 DELTA — DECISION DAY (decide-by 2026-09-03)

**Review price:** 356.44 pre-market (11:36Z) vs 367.24 official close, **−2.9%**. Session before: 364.65–371.09 on 38.9M (1.8x avg).

**WHAT CHANGED — the print.** Q3 revenue 29.59B vs 29.36B est (+86% y/y). EPS 3.32 vs 3.16 (broker feed) / 3.24 (Benzinga). AI semiconductor revenue **16.7B, +221% y/y, vs 15.9B est**. Q4 guide **34.8B vs 35.0B street** (0.6% light). Q4 AI revenue guide 21.7B. FY27 AI revenue guided to ~115B (double), FY28 ~230B. Hock Tan: "we can ship significantly more" — supply, land, power and HBM are the constraint, not demand. Street reaction split: Citi 500→515 and President Capital 520→546 UP; Truist 550→520, TD Cowen 500→475, HSBC 600→560 DOWN. Stock −7% after-hours at the guide line, recovered to −3% by the pre-market.

**GUIDE RULE, answered first.** Headline Q4 guide: slightly BELOW street. AI guide and the multi-year outlook: well ABOVE. Mixed guide, and the tape is pricing the headline (P-006 territory: a beat sold on a softer guide). The AI number is the bull's evidence; the total-revenue number is what the algos read. Neither is a cut, so **short gate 1 (thesis broken) fails** — no short lane.

**Lens 1:** 356.44 is now BELOW the 200-day (369.68) and the 50-day (384.58, migrated from B-214's 386.59). RSI 42. 26% off the 495 high. **Trend Strength 3/10.** rs.mjs: **LAGGARD vs SPY, FADING vs SOXX** (−5.5 pts vs SOXX over 20 sessions).
**Lens 2:** AI-infra chain got paid yesterday (power 6/7 green, DELL +15.8%); AVGO is the odd one out this morning. Insiders: not re-pulled this run (B-214 basis stands).

**THE PLAN B-214 WROTE, applied to today's numbers.** Entry post-print only, on a hold above the first 30–60 min opening range, stop under the post-print session low, stop ≥ 1.0 ATR, thesis void under 350.06.
- ATR(14) = 12.66 on the 9/2 bar and will expand through today. Pre-market is 1.8% above 350.06, so the day-low stop and the thesis invalidation collapse into one line: **stop 349.50**.
- 1.0 ATR above 349.50 = **362.16 = the minimum compliant entry.** Below that, no stop passes the floor.
- **Trigger: a 30-min close above the opening-range high AND ≥ 362.16, after 09:30 CT, with 350.06 never lost intraday.** Decide-by: today's close. Not met = B-214 resolves UNFIRED, No Trade, name returns to WATCH with the 50-day 384.58 as the next reclaim.
- Size: band 251.73 / 12.66 = 19.9 sh ≈ 7,200 — **capital cap: 4 sh ≈ 1,449 = 96.5% of buying power, risk $50.64 (2.0%). CONCENTRATED**, and alongside GOOGL that is 98% of the account in two names.
- T1 420.16 (8/10 low, base of the breakdown) = 4.6:1 from 362.16. T2 — the 50-day reclaim first, 384.58, is the honest checkpoint.

**CAPITAL COMPETITION:** vs cash — marginal in a hike-odds week · vs SPY — no edge (LAGGARD) · vs watchlist — **loses to CEG** (leader, no print, clean fire) · swap — no. **Overall capped at C.**

**Readiness 60** = trigger 70 (0.45 ATR to the minimum entry) · FOMO 10 (Post-FOMO Fade, 26% off high, momentum gone) · volume 100 · stop 40 (compliant only above 362.16) · catalyst 100 (fresh print) · macro 40 → mean 60, macro cap 60. Opportunity **55** (C cap 69).

**Bear case + assumptions:** assumes 350.06 holds today (invalidated on any print below) · assumes the earnings print IS the trade, 9/2 pm — done · assumes the FOMO stage holds · assumes the headline-guide selling exhausts inside the opening range · assumes no second concentrated position is added while GOOGL's stop is not resting.

**THE WHY.** Broadcom just said AI chip revenue triples this year and doubles again next year, and the only reason it isn't shipping more is that nobody can build data centers fast enough. The stock is being sold this morning because the next quarter's total revenue number came in a fraction light. That is a headline-versus-substance gap, and the trade exists only if buyers prove it by holding the opening range above 350. If they do not, the market is telling you the de-rate is not finished, and the framework waits.

**VERDICT — AVGO:** Opportunity 55 / Readiness 60 · Origin delta · Tech D · Fund A− · Exec C · **Overall C** · Trend 3/10 · Post-FOMO Fade · Market Risk 4 · Confidence 55% / Conviction 4 sh, $50.64 · **Final Call: CONDITIONAL — reaction entry ≥ 362.16 on an opening-range hold, stop 349.50, decide-by today's close. Second in line for capital behind CEG.** HODL: Hold-quality, wait for value — durable, funded, secular, survivable; the swing entry is the only thing in question. Golden Rule: yes, but only on the hold, not the story.

---

## 2. CEG — B-250 DELTA — THE FULL RUN B-250 ASKED FOR (trigger fired 9/2)

**Review price:** 290.70 pre-market (11:33Z) vs **290.04 official close** (+0.2%). 9/2 session: 277.88 low → 290.81 high on 2.93M (1.29x 2-wk avg). Trigger 287 crossed in the 13:30 CT bar and never traded back under.

**WHAT CHANGED:** the 9/2 close confirmed the fire (B-250 was written on the 14:58 CT live print). ATR expanded again: **9.35** (from 9.08). B-250 stopped at "needs a T1 and 2:1 at a fundable size." Here it is.

**Lens 1:** 290.81 is the highest print since **May** — above every daily bar from June through August (prior range top 285.26–287.00). Above the 20-day (276.01) and 50-day; **the 200-day sits at 296.83, 2.1% overhead.** Structure above, from the weekly bars: 296.90 (5/18 wk high) · 310.45 (5/25 wk high) · 317.74 (5/11 wk high) · 328.80 (5/4 wk high) · 412.70 (52-wk high, 10/2025). **Trend Strength 7/10.** rs.mjs: **LEADER vs SPY and vs XLU on every horizon** (+17.6 pts vs XLU over 60 sessions).
**Lens 2:** the power layer is the bottleneck Hock Tan named on last night's call — that is the thesis, said out loud by the biggest AI chip vendor. No earnings inside the swing window (next print early November). No dated catalyst inside the window → catalyst input 50.

**THE ARITHMETIC — and why the entry is a retest, not a chase.**
- From 290.70 with B-220's 264.82 invalidation: risk 25.88 (2.77 ATR), T1 310.45 = 0.76:1. **Fails 2:1.**
- From 290.70 with a structural stop under the 9/2 base (277.88 → **277.50**): risk 13.20, T1 310.45 = 1.5:1. **Still fails.**
- **From a retest of the trigger, 287.00 ± 1.50, stop 277.50:** risk 9.50–11.00 = 1.02–1.18 ATR (compliant), T1 310.45 = **2.1–2.5:1**, T2 328.80 = 3.8–4.4:1. This is the only entry that clears the floor AND 2:1.
- **Trigger: a hold of 287 on a pullback — a 30-min close back above 287 after tagging 286.50–288.50.** Decide-by 2026-09-19 (B-250 stands). If CEG runs away above 296.83 without retesting, the trade is missed and logged as missed, not chased.
- Size: 251.73 / 9.50 = 26 sh ≈ 7,500 — **capital cap: 5 sh ≈ 1,437 = 95.7% of buying power, risk $47.50–55.00 (~2%). CONCENTRATED**, 98% of the account in two names alongside GOOGL.
- T1 310.45 (trim 50%, stop to breakeven) · T2 328.80.

**CAPITAL COMPETITION:** vs cash — yes (leader, defined stop, no event) · vs SPY — yes (+17.6 pts vs sector over 60 sessions) · vs watchlist — **wins; the best-shaped setup on the board** · swap — GOOGL is a working position and stays. **Grade stands: B.**

**Readiness 60** = trigger 77 (0.34 ATR to the retest zone) · FOMO 75 (Heating Up) · volume 60 (1.29x) · stop 100 (compliant, 2.1:1+) · catalyst 50 · macro 40 → mean 67, **macro cap 60**. Opportunity **72** (B cap 89).

**Bear case + assumptions:** the 200-day at 296.83 is overhead supply and a failed test there sends it back into the range · assumes no earnings print inside the window (next ~early Nov, outside) · assumes the FOMO stage holds · assumes 277.88 (9/2 base) holds — a close under it voids the breakout · assumes the rate shock (10-yr 4.8%, hike odds 60%) does not reprice utilities-with-AI by duration (P-016, proposed) · assumes GOOGL's stop is resting before a second concentrated name is added.

**THE WHY.** Constellation runs the nuclear plants that AI data centers want to plug into, and last night the biggest AI chip company said power, not chips, is what is slowing deployments. The stock just closed at its highest level since May after grinding one way all day, and it is leading both the market and its own sector on every horizon. The trade is not buying that close. It is buying the first pullback to the breakout level with a stop under yesterday's base, so the worst case is about two percent of the account and the first target is two-plus times that.

**VERDICT — CEG:** Opportunity 72 / Readiness 60 · Origin delta · Tech B · Fund B · Exec B− · **Overall B** · Trend 7/10 · Heating Up · Market Risk 4 · Confidence 60% / Conviction 5 sh, ~$50 · **Final Call: SETUP FORMING — CONDITIONAL, buy the retest hold of 287, stop 277.50, T1 310.45, T2 328.80, decide-by 9/19. FIRST in line for capital today.** HODL: Accumulate on weakness — durable, real cash flow, secular power tailwind, survivable balance sheet; separate bucket, separate plan. Golden Rule: yes — this one was armed on 8/29 before it moved.

---

## 3. GOOGL — B-238 DELTA — POSITION, LIFECYCLE: WORKING

**Review price:** 338.94 pre-market (11:35Z) vs 337.12 close (+0.5%). Position: **3 sh @ 335.26**, +3.68/sh, **+$11.04** unrealized. Ex-dividend TOMORROW 9/4 ($0.22/sh, $0.66 to the position, payable 9/14) — hold through it, nothing to do.

**WHAT CHANGED:** nothing that breaks a logged assumption. Ninth session of a working position. ATR 8.30; stop 326 is 9.26 below basis = **1.12 ATR, compliant.** Breakeven ratchet is not available until price ≥ 343.56 (basis + 1.0 ATR) and is not permitted before. rs.mjs: **LAGGARD vs SPY and vs XLC** on 20 and 60 sessions — this is a value-zone accumulation (B-228 lineage at the 336 zone), not a momentum trade, and it is behaving like one.

**THE ONE ACTION THAT IS OVERDUE, again:** the 326 stop was NOT resting at the broker as of B-243/B-250. A level in a row is not protection (P-014, proposed, 0/0 — this position is the instance waiting to happen). Rest the stop. This is the third row to say it.

**Readiness 60** (in position 100 · FOMO 75 · volume 30 at 0.96x · stop 100 · catalyst 50 · macro 40 → 66, macro cap 60). Opportunity 65.

**VERDICT — GOOGL:** Opportunity 65 / Readiness 60 · Origin delta · Tech C · Fund A · Exec B · **Overall B** · Trend 4/10 · Heating Up · Market Risk 4 · Confidence 60% / Conviction 3 sh, $27.78 at the stop · **Final Call: SETUP WORKING — MANAGE. Stop 326 must be resting. No add, no ratchet until 343.56.** HODL: Accumulate on weakness. 

---

## 4. HPE — B-249 CLOSE-OUT — THE NO-TRADE WAS RIGHT, AND THE GUIDE LOST TO THE RUN

**Review price:** 50.09 pre-market (11:36Z) vs 51.83 close, **−3.4%** (was −5.2% after-hours at 49.15).

**THE PRINT:** revenue 12.21B vs 11.91B est · EPS 1.11 vs 0.93 · **FY26 EPS guide RAISED to 3.75–3.85 vs 3.43 street · revenue guide RAISED to 45.96–46.99B vs 44.94B** · Oracle expands Juniper networking across its AI data centers. Deutsche Bank 62→68.

**GUIDE RULE:** the guide was raised, materially, and the stock is being sold anyway. That is the case the rule says must carry the burden of proof, and the proof is on the record: HPE ran 50.18 → 52.10 (+3.8%) in the final 90 minutes into the print on 3.73M shares (B-249), after +160% off the February low. **P-001 (supported, 3/3 → 4/4): a beat after a run into the print gets sold on the reaction. P-007 (supported, 4/4 → 5/5): the run INTO the print set the reaction.** Both logged as instances this run.

**What B-249 refused, priced:** shares bought at 52.10 at 14:27 CT yesterday would be −3.9% at this print with no stop that could have worked overnight. The refusal is the framework working.

**Short lane:** gate 1 fails — a raised guide is not a broken thesis. No short. **Long lane:** a post-print gap down AGAINST a raised guide is the Guide Rule's preferred reaction only once a level holds; 49.50 (B-244's structural invalidation) is 1.2% below. Watchlist: a hold of 49.50 and reclaim of 51.00 is the next look, not today.

**Readiness 30** (no trigger 0 · Late FOMO 25 · volume 100 · stop 0 · catalyst 25 already ran · macro 40 → 32; no structural floor confirmed → cap 30). Opportunity 35.

**VERDICT — HPE:** Opportunity 35 / Readiness 30 · Origin delta · Tech C · Fund B+ · Exec F · **Overall D** · Trend 5/10 · Late FOMO · Market Risk 4 · **Final Call: NO TRADE — WATCHLIST ONLY. B-241/B-244/B-248/B-249 chain resolved: no ticket, no loss.** HODL: Hold-quality, wait for value.

**THESIS LEDGER:** 2026-09-03 · "HPE's raise gets sold because the run into the print already priced it" · HPE · direction: down on the reaction · why no trade: post-catalyst only and no compliant level yet · price 50.09 · outcome: blank.

---

## THE SELF-AUDIT LINE

Four rows, zero tickets this morning, and the structural finding is the same one as last week: **on a $2,517 account with $1,501 of buying power, every conditional on the board is a Concentration Declaration by construction.** The band never sizes a trade; the cash does. That is not a rule gap, it is the account size, and Size-Aware Conviction already names the path: the cheapest fitting expression or a grow-into target. No rule change proposed.

*Analysis and education, not financial advice. Every level re-pulled at the open before anything is acted on. Adam executes; the executor is disabled.*

---

**BENCH ARCHIVE (logged this run):** B-253 AVGO conditional (trigger 362.16, decide-by 2026-09-03) · B-254 CEG conditional (trigger 287 retest, stop 277.50, decide-by 2026-09-19) · B-255 GOOGL long delta (stop 326) · B-256 HPE pass. Patterns: P-001 and P-007 instances attached (HPE, both hold). Regime stamp written to db/regime.json.
