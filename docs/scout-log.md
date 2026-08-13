# THE BENCH — Scout Log & Calibration

**Purpose:** record every multi-agent market scan's raw picks *before* the outcome is known, then grade them at fixed checkpoints. Timestamped call, then result — proof, not hype.

Once enough scans accumulate, the data answers questions a single trade never can:
- **Which scout lanes have real signal?** (earnings-catalyst vs breakout vs accumulation vs AI-thesis vs crypto)
- **Does agent conviction predict outcome?** (do the 7/10s actually beat the 5/10s?)
- **Which setups pay in which regime?** — the market-psychology layer: momentum-breakouts may win in a calm/greedy tape and die in a fearful one; accumulation may only pay after a flush. We tag the regime at scan time so the correlation is measurable later.

## Method

- **One section per scan.** Append only — never edit a logged call, only fill its Outcome.
- **Benchmark:** equities vs **SPY**, crypto vs **BTC** (mirrors `db/archive.json` scorecard). A ±1.0-pt alpha dead-band reads as *flat*.
- **Scoring at each checkpoint (7d / 30d):**
  - `long` pick → **right** if it beat the benchmark; **wrong** if it lagged.
  - `pass` / `watch` → **right** if we correctly avoided a loser (it fell or lagged); a pass that missed a 10%+ run is **wrong** and flagged *expensive pass* — that's where the lesson is.
  - `taken` + profitable = the strongest signal (the scout call *and* our execution both worked).
- **Prices are the session close on the log date** unless noted. Re-pull before acting on any level.
- Checkpoints track the scorecard cadence: **7 / 30 (/ 90)** days.

---

## Scan 2026-07-31 — "Next entry for the ~$646 free cash"

**Dispatched:** 5 scouts (earnings-catalyst · AI picks-and-shovels · sub-$150 breakouts · accumulation/pullback · crypto+asymmetric).
**Account:** ~$1,000 Robinhood "Agentic" cash, ~$646 free, hunting 25%+ swings, defined risk.
**Regime at scan (mood):** SPY $747 (52-wk highs) · VIX ~16 (complacent/greed) · 30Y yield 5.28% (highest since 2007, hostile bonds) · 10Y 4.74% · Fed held 7/29 (3 dissents for a hike). Tape = equities at highs on a hostile bond market. Dominant thesis: *"the market pays for companies that monetize AI without paying for AI."*
**Checkpoints due:** 7d ≈ 2026-08-07 · 30d ≈ 2026-08-31.

| Scout lane | Ticker | Px @7/31 close | Plan (entry → stop → target) | Conv /10 | Catalyst | Call type | Taken? | +7d % / vs SPY | +30d % / vs SPY | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Breakout | **LTH** | $45.14 | $43.25 pullback → $42.00 → $50-51 / $56 | 7.5 | Q2 beat 7/30 (done); next Nov 3 | long | **YES — 7 sh starter, limit resting** | | | |
| Earnings | **SMCI** | $28.40 | Aug-21 $30/$34 call spread ~$110 | 7 | Earnings Aug 11 pm | BET (defined-risk) | **NO — PASSED at the deadline** | +9.61% / **+6.10 vs SPY** | *(due 8/31)* | **SCOUT RIGHT, WE PASSED** |
| Accumulation | NKE | $41.72 | 14 sh → $39.50 (floor $40) → $52 | 6.5 | none near | long (watch) | no | | | |
| AI shovels | CAMT | $132.35 | 3-4 sh → $115 → $165 | 6 | Earnings Aug 10 pm | long (watch) | no | | | |
| Earnings | CELH | $29.23 | ~20 sh → $27 → $33 / $37 | 6 | Earnings Aug 6 am | long (watch) | no | | | |
| Accumulation | UBER | $70.37 | 8 sh → $65 (floor $65.41) → $88 | 6 | none near (Waymo overhang) | long (watch) | no | | | |
| Crypto | SOL | ~$74.65 (web) | ~$475 → $70 → $97 | 6 | SOL ETF/ETP cluster | long (watch) | no | | | |
| Breakout | HALO | $82.55 | buy-stop >$84.50 → $79.50 → $103 | 6 | none confirmed | watch (untriggered) | no | | | |
| Breakout | DINO | $91.41 | pullback to $88 (extended) | 5.5 | crack spreads | watch | no | | | |
| Crypto | ETH | ~$1,981 (web) | breakout >$2,030 → $1,980 | 5 | staking ETP | watch (at resistance) | no | | | |
| Earnings | HIMS | $27.78 | post-print reaction >$30 | 4 | Earnings Aug 10 pm | watch (post-catalyst) | no | | | |
| AI shovels | NVT | $153.92 | pullback to hold $150 | 4 | Q2 blowout 7/31 (gap-faded) | watch | no | | | |

**Cross-scout disagreement logged:** the earnings scout ranked **SMCI #1** (clean defined-risk structure); the AI-shovels scout independently **culled SMCI** (commoditized box-assembler, governance cloud). Recorded so the outcome settles which lens was right on this name.

**→ SETTLED 2026-08-11: the EARNINGS scout was right; the AI-shovels cull was wrong.** SMCI reported Q4 FY26 after the close on 8/11 and traded **34.42 post-market, +9.41%** on the day (+21.20% from the $28.40 scan price, **+18.06 pts vs SPY**). It *missed* revenue ($11.1B vs $11.551B expected) — exactly the commoditized-box-assembler worry — and rallied anyway on the guide: **FY27 sales $65–72B against a $52.5B street**, Q1 FY27 $14.5–15.5B vs $11.68B, EPS $1.62 vs $0.96, and gross margin **15–17% vs the 8.2–8.4% guided** on richer AI-system mix. The margin print is the specific rebuttal to the "commoditized assembler" thesis.

**What the pass cost (counterfactual — the BET was never entered):** at the 8/11 close the Aug-21 $30/$34 spread quoted **3.55 ask / 1.76 bid = $1.79 debit**, $179/contract against a $400 max width. Holding above $34 to 8/21 expiry = **+$221/contract, +123%**. At the original ~$110 scoping it would have been **+$290, +264%**. Not realized, and not safe: 34.42 is only **$0.42 above the short strike** with 10 days left. Option quotes stamped 15:59:59 ET, *before* the post-market move — they have not repriced.

**Why we passed, recorded so it can be judged:** every reason given was about the tape and the print — the $30 strike was already 1.15 ITM so the spread was no longer the cheap OTM ticket it was scoped as, it faded from a 32.00 open to the session low on both 8/10 and 8/11, volume ran 37.6M vs a 44.4M 30-day average, and it sat 47% below its 52-week high. All true. **None of it was about the guide, and the guide was the entire move.** See pattern **P-008** (opened 8/11, 2/2): *when the reported quarter and the forward guide point opposite ways, the reaction follows the guide.*

**Notes for scoring:**
- LTH is the only *taken* call (starter). Fill is conditional on a pullback to $43.25; if it never fills, mark **no-fill** (the scout was right on the name but the entry discipline kept us out — a separate, useful data point).
- SMCI is a **BET**, graded separately from the `long` picks — it lives outside `db/archive.json` by rule.
- SOL/ETH prices are web-verified (Robinhood MCP can't quote crypto pairs); confirm before scoring.

---

## Scan 2026-08-13 — "AI that hasn't popped + power rotation"

**Dispatched:** 4 scouts (AI laggards/Pre-FOMO · power & the AI-electricity rotation · dated catalysts in the swing window · **guide-verification**).
**Account:** ~$1,018 total — ~$581 Agentic cash (L2, shares + long calls/puts), ~$200 margin (L3, spreads). Hard affordability screen: prefer <$60/share, ceiling $120.
**Regime at scan (mood):** SPY $776.73 (+0.55%) · VIX 14.69 · F&G 65 Greed · SMH +2.03% · memory ripping (MU +6.81%, WDC +8.72%) · KOSPI closed +3.56%, 4th straight up day. Tape = risk-on, complacent hedging, leadership rotating INTO memory/storage and OUT of generators.
**Checkpoints due:** 7d ≈ 2026-08-20 · 30d ≈ 2026-09-12.

**Method note — the fourth scout is new and it earned its slot.** A dedicated guide-verification lane was dispatched to answer the v24 Guide Rule question on every "beat-and-fell" candidate the other scouts surfaced. **It killed two of three picks from the AI lane.** KLIC and VECO both *raised* guidance and had already recovered ABOVE their pre-print prices — there was no drawdown left to buy, only a one-session sell-the-news fade that round-tripped. Without that lane we would have pitched two names on a discount that no longer existed. Recommend the guide lane becomes standing on every scan.

| Scout lane | Ticker | Px @ 8/13 12:39pm CT | Plan (entry -> stop -> target) | Conv /10 | Catalyst | Call type | Taken? | +7d % / vs SPY | +30d % / vs SPY | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Calendar | **PLAB** | $33.82 | POST-print 8/26: hold >$30.75 -> stop $30.75 -> $40 / $46 | 7.5 | Q3 earnings 8/26 am (verified), est $0.41 cut from the $0.53 it missed on | watch (post-catalyst) | no | | | |
| Power | **NI** | $42.145 | 13 sh -> stop $41.40 -> $46 / $49 | 7 | Q3 10/28 am (tentative); no near event | watch | no | | | |
| AI laggard | **AMKR** | $58.33 | 9 sh -> stop $51.19 -> $70 / $80 | 6 | Q3 10/26 pm (tentative) | watch | no | | | |
| Power | **VST** | $145.89 | L3 only: Sep-18 155/160 call debit spread, ~$138-170 debit | 6.5 | Q3 11/05 am; no near catalyst | watch (spread) | no | | | |
| Calendar | **PL** | $24.68 | POST-print 9/3: 23 sh -> stop $22.57 -> $32 / $38 | 6 | Q2 9/3 pm (verified) + US federal FY-end 9/30 (unverified-by-tool) | watch (post-catalyst) | no | | | |
| Power | EXC | $45.43 | 12 sh -> stop $44.30 | 6 | Q3 11/03; div ex-date 9/04 | watch | no | | | |
| Calendar | WOLF | $31.90 | POST-print 8/20 only, must hold $29.00 | 5 | Q4 earnings 8/19 pm (verified), est -$1.47 | watch (post-catalyst) | no | | | |

**Killed by the guide lane (logged so they are not re-pitched):**
- **KLIC** $96.92 — guide RAISED hard (Q4 rev $355-395M vs $328.8M cons; TCB FY27 $150-200M vs $100M). Trades ABOVE its pre-print price. No drawdown to buy.
- **VECO** $54.55 — FY26 revenue RAISED to $780-810M vs $763.8M cons; $200M advanced-packaging orders booked, mostly 2027 delivery. Also above pre-print. The gap-fade was 2027-weighting, not deterioration.
- **CEVA** $30.60 — guide raised on the wrong line item: licensing +21% y/y but **royalties flat**, and royalties are the annuity. Only name of the five that never bounced (3 straight sessions of bleed). Market repricing the royalty inflection to 2027.
- **MIR** $15.41 — reaffirmed 5-7% FY organic after delivering **1.2%**, requiring a 7.5-11.2% H2 quadrupling, plus an $18M China order cancellation. Gapped UP then collapsed = the call did the damage, not the release. Correct repricing, thesis NOT intact.

**Framework candidate raised by this scan (not applied):** *a raise is only as good as the line item carrying it.* CEVA raised FY guidance and still got sold, because the raise came from lumpy licensing while the recurring royalty line went flat. A literal P-008 reading ("guide up = buy the reaction") would have been wrong here. Proposed refinement to the Guide Rule: when a guide is raised, identify WHICH line carries it and whether that line is recurring or one-off. Needs a second instance before it changes any rule.

**Sector intelligence:** most extended = uranium/enrichment + electrical equipment (UUUU +12.2% in 5 sessions, NNE +13.0%, CCJ printed $100.14 on 8/12). Most overlooked = **merchant IPPs** — the companies that literally sell electrons to hyperscalers de-rated hardest (VST -33.4% off its high, NRG -36.4% and printed a 52-week low on 8/04). Capital rotated into the fuel and the hardware and out of the generators. Also: **every datacenter-exposed regulated utility missed Q2** (EXC 7/30, NI 8/05, VST 8/07) — that is WHY the rotation has not reached this shelf yet.
