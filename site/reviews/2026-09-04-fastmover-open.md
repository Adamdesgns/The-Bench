# Fast-Mover Trigger Check — 2026-09-04, 08:58 CT

**Framework v29** · Regime stamp today: **TRENDING, Market Risk 4/5** (SPY 772.23 above 20/50/200, VIX 14.14, TNX 4.77 — computed on settled bars, so it does not yet contain today's hike repricing; flagged, not overridden).

Account 929016137: total **3,024.135**, equity 1,023.705, cash 2,000.43, BP **2,001.43**. Standing 10% risk band = **302.41**. (Cash is up 500 on a deposit since yesterday.)

---

## The macro that set the day

August non-farm payrolls **+162,000** against a 55,000 Bloomberg consensus — nearly triple — with July revised **up** to +21,000 from -23,000. CME FedWatch now prices a **58% probability of a September HIKE**. 2-yr 4.393% (+5.7bp), 10-yr 4.786% (+2.6bp), gold -1.9%, WTI 90.83.

And the tape ignored it where it mattered: SPY **-0.09%**, QQQ **+0.58%**, while memory and storage went vertical.

---

## 1. GOOGL — THE STOP IS AT THE BROKER. B-266 WAS WRONG AND IS RETRACTED. → B-272

`get_equity_orders` on 929016137 with **no state filter** returns three orders, not two. The third:

| field | value |
|---|---|
| side / qty | sell 3.000000 |
| type / trigger | market / **stop** |
| stop_price | **326.000000** |
| time_in_force | GTC |
| market_hours | regular_hours |
| placed_agent | user |
| **state** | **confirmed** |
| created | **2026-09-03 09:34:58 CT** |

B-261 and B-266 both queried `state=queued` and read the empty list as proof of absence. **A resting GTC stop at Robinhood sits in `confirmed`, not `queued`.** B-261 ran 36 minutes *before* the order existed and was honest. B-266 ran **5h24m after** it existed and published "FIFTH SESSION ON THE SAME UNDONE ACTION" about an action that was done. That is a false alarm in the book and it is retracted here.

- **Stop passes its gate.** ATR(14) 8.246833 on the 9/3 bar (down from 8.299666 and 8.385794 — three sessions of contraction). 326.00 is 9.255 under the 335.255 basis = **1.1223 ATR**, above the 1.0 floor.
- **Ex-dividend today**, 0.22/sh = 0.66 on 3 sh (record 9/7, payable 9/14). The feed shows it: adjusted_previous_close 342.26 vs previous_close 342.48. Live 341.30 is **-0.28% on the adjusted close** — use that number or the dividend reads as a loss.
- **Ratchet touched and died, again.** Threshold = 335.255 + 8.2468 = **343.50**. The 08:30 CT opening bar high was **343.53** — through by three cents — then 341.21 / 341.92 / 341.04 / 340.485 / 340.64. Second straight session the unlock prints on the high and fades. **No ratchet authorized.**
- Position 3 sh = 1,023.90 = **33.86%** of the account, down from 40.6% — and it fell because 500 of cash arrived, not because anything was sold. **Concentration Declaration still owed. It is now the only open item.**

## 2. CEG — THE WINDOW OPENED, TRADED, AND WAS MISSED. SECOND CONSECUTIVE SESSION. → B-273

ATR(14) re-pulled on a January seed: 9.085651 (9/1) → 9.360248 (9/2) → **9.718087 (9/3)**. Volatility expanded 3.8%, so the minimum compliant entry with the 277.50 stop moves from B-269's 286.86 to **287.22**. Live window **287.22 – 288.50**.

| 5-min bar (CT) | range | inside band? |
|---|---|---|
| 08:30 | 284.04 – 287.50 | opened **below** the compliant floor |
| 08:35 | 285.27 – 287.13 | no |
| 08:40 | 285.10 – **287.22** | high tags the minimum to the penny |
| **08:45** | **287.29 – 288.872** (close 288.39) | **entire bar inside the band** |
| 08:50 | 287.515 – 289.795 | low inside |

**A resting limit at 288.00 fills on the 08:45 bar without ambiguity. Nothing was resting.** Yesterday price fell *down* through the window and chopped in it for three hours (B-265/B-269). Today it came *up* through it and left out the top in fifteen minutes. **Down through it, then up through it, unfilled both times.** The levels have now been proven correct twice; what is missing is an order.

**No chase at 290.615** — and the objection is R:R, not the floor. Risk 13.115 to 277.50 = 1.35 ATR (clears). But T1 310.45 pays 19.835 = **1.51:1**, and the gate is 2:1. At 287.22 the same target pays **2.39:1**; at 288.50 exactly **2.00:1**. The band is not a preference, it is the only place this trade is legal.

Tape flipped back: CEG **+1.95%** vs SPY -0.09% — **leader** again after one laggard day. 200-day 296.83 still overhead, untested (session high 289.795). Sized from the band, not from buying power: at 9.72 risk/share the 302.41 band funds 31 shares. (Cash context only — BP 2,001.43 covers 6 sh at 288 = 1,728, risk 58.32 = 19.3% of the band.) **Readiness 40 (up from 35). Watchlist Only.**

## 3. MU — THE RECLAIM CONFIRMED AND THE ENTRY IS GONE. → B-274

50-day re-derived live for the seventh check running: 955.0037 (8/28) → 951.4985 (8/31) → 945.9397 (9/1) → 944.0259 (9/2) → **942.2189 (9/3)**.

**Live 997.68 is 55.46 above it.** Open 971.88 (a +1.43% gap), low 969.00, high 999.74 at 08:35 CT, and every bar since has held above 990. +4.12% on the **958.16** official close — which corrects B-268's 958.63, an intraday read.

B-268 called this correctly twenty-four hours early. It counted the record on **settled closes** rather than intraday pokes (8/31 above, 9/1 below, 9/2 above, 9/3 above), set readiness 50, and wrote *"a fourth confirming close comes first."* The fourth confirming close is printing right now — and the entry it was written for is 55 points below the market. **This is a runaway, logged as one.**

**There is no compliant entry here and it is not close.** ATR(14) 54.47337 (9/3), contracting four straight sessions.

- **Path A — the written invalidation.** 997.68 → 887.61 = 110.07 risk = 2.02 ATR. Legal on the floor, but **one share alone carries 110.07 of dollar risk = 36.4% of the 302.41 band**, and the band funds only 2.75 shares total. **Refused on the risk band** — which is the correct gate. (Per Adam's 2026-09-03 ruling, buying power is context and never the reason a call is refused or ranked.)
- **Path B — the tightest legal stop.** 997.68 − 54.47 = 943.21, which is the 50-day itself. The 1,036.13 target pays 38.45 on 54.47 = **0.71:1**. **Refused on R:R.**

There is no third path. The 881 accumulation zone is 13.24% below spot and **not in play** — do not conflate the lanes. **Readiness 25, down from 50, and the drop is entirely execution.** Fundamental A stands, technical is now A- on a confirmed reclaim, execution is **F**: the desk had the right plan, published it, watched the condition satisfy, and had nothing at the broker.

## 4. PATH — INVALIDATION BROKEN ON THE GAP. THE REFUSAL SAVED 137 DOLLARS. → B-275

Live **15.275**, **-16.16%** on the 18.22 close, against SPY -0.09% / QQQ +0.58% — fully name-specific. Open 16.40, high 16.69, low 14.77. **The 17.00 invalidation was never traded — it was gapped through.** The 19.84 trigger is 29.9% overhead. ~8.9M shares in the first 25 minutes.

**And the print was good.** Revenue 410.26M vs 397.95M (+13% y/y), EPS 0.15 in line, RPO +14% to 1.378B, ARR +12% on 37M net new, cloud ARR ~1.3B (+19%), adjusted operating income 89M at a 22% margin (+400bp), NDR 109%, 1.4B cash and no debt. **FY27 guide RAISED to 1.789–1.794B from 1.776–1.781B, above the 1.778B street.**

**So the Guide Rule produced a counterexample.** B-240's trigger explicitly required a raised guide. The guide was raised. The stock fell 16%. The v24 rule is right about which *number* matters; it is not a rule about *direction*. What decided the tape is everything B-240 already flagged as LATE: +97% off the 5/14 low, RSI 78.3, 29% above the then-mean target of 14.07, and CEO Dines selling 1.40M shares for 22.54M on 8/19 — insider verdict DISTRIBUTION. QR-007 (grade B) put the 10-bar median at **-3.21%** with a 44% win rate. The median was negative; the realized outcome was worse.

**The refused 9/4 18-strike call at 1.37 expires worthless today. 137 dollars = 45.3% of today's risk band.** That goes in the book as loudly as a loss would.

**Short lane does not open:** invalidation above exists ✓, level lost ✓, **thesis broken ✗** — the company beat and raised. Two of three gates. **No short.** Selling a name down 16% in its first half hour is the mirror image of chasing MU up 4%, refused an hour earlier.

## 5. HIMS — third consecutive session below the 200-day

Live 27.59, -0.83%. Floor re-pulled live because the file was stale by one session **again**: sma/200/day = 28.50155 (9/1) → 28.46470 (9/2) → **28.41890 (9/3)**. Price is 0.83 under the honest number. Session 27.38–27.95, no reclaim attempted. **Momentum lane** — fails Accumulation gate 1 on a C+ fundamental, sits here only on Adam's 2026-08-21 ruling; no rr_target on this lane by design, so no R:R is reported. **Not a buy. Thesis review stands.** Neither B-176 falsifier has printed.

## 6. SOL / BSOL — neither leg live

SOL mark **101.63** (bid 100.665 / ask 102.60), -2.19% vs the Central-midnight close. B-270's Plan B trigger 110.04 is **8.3% overhead**; Plan A zone 95.75–96.50 is 5.8% below; the 94.20 void level is intact. BSOL 13.98, -3.32% — ratio 0.1375, consistent with B-271's 0.1378, so the mapping holds. **The 1.9% market-maker spread B-270 flagged at 22:24 CT is still 1.9% in US hours** — that is structural, not an overnight artifact. Limit orders only. BTC 79,332, **below** the 80.9K reference B-270 cited for its sector gate. Crypto is red across the board on the hawkish print.

## 7. Fast-mover screen — seven names cleared 5%

| | move |
|---|---|
| SNDG | **+13.48%** |
| SOXL | **+10.24%** |
| MUU | **+8.21%** |
| INTW | **+6.61%** |
| SNDK | **+6.47%** |
| STX | **+5.82%** |
| WDC | **+5.49%** |
| MU | +4.12% |
| SOXX | +3.49% |
| INTC | +3.33% |
| VRT | +3.18% |
| SMCI | +2.98% |
| NVDA | +2.55% |
| DELL | +2.46% |
| HPQ | +0.13% |

MUU tracked **1.99x** against MU — the leveraged ETF is confirming the underlying, not moving on its own. **HPQ did not move** (+0.13%), so no expensive-pass warning there. DELL +2.46% is under the 5% flag.

**KLIC +3.36% at 81.47** — one session after B-259 retired it on a broken invalidation at 76.40. Watch it: that is now +6.6% off the retirement print and it is the shape of an expensive pass. Not proposing an entry; peripheral vision only.

---

## Verdict

**No trade from this desk. Nothing was placed, modified or cancelled — Adam executes every order.**

The one thing that costs money next: **CEG has now had its compliant window fill on two consecutive sessions with nothing resting at the broker.** MU is the same disease with a different symptom — the plan was right, the confirmation arrived, and the entry left. Both are the B-116 hole, and the GOOGL correction above shows the fix works when it is actually done.

**Rows: B-272 (GOOGL), B-273 (CEG), B-274 (MU), B-275 (PATH).**
