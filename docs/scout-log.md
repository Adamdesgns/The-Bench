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

---

## Scan 2026-08-13 (second scan, afternoon) — "10 scouts on the catalyst list"

**Dispatched:** 10 scouts, at Adam's request, across the catalyst calendar 8/17–9/30 — by date block (A: 8/17-19 · B: 8/20-21 · C: 8/24-26 · D: 8/27-9/4 · E: 9/8-18 · F: 9/19-30) and by theme (G: non-earnings catalysts · H: China ADRs · I: high-beta sub-$30 movers · J: energy/power/shipping).
**Account:** ~$1,018 — ~$581 Agentic cash (L2), ~$200 margin (L3).
**New constraints this scan:** Adam rejected ETFs outright — *"I don't want an etf they don't move enough"* — so single names only, and every scout had to quantify the **dollar swing per $581 position**. Affordability wall unchanged: prefer <$60/share, ceiling $120.
**Regime at scan:** SPY $777.68 (+0.67%) · VIX 14.69 · F&G 65 Greed · memory/storage leading (MU +6.8%, WDC +8.7%) · KOSPI +3.56%. AMAT pre-catalyst deadline passed at 2:00pm CT with the framework on PASS; AMAT closed the window back BELOW its 50-day at ~554.8 after briefly clearing it.
**Checkpoints due:** 7d ≈ 2026-08-20 · 30d ≈ 2026-09-14.

| Scout lane | Ticker | Px @ 8/13 2:01pm CT | Catalyst (verified?) | Plan | Conv /10 | Call type | Taken? | +7d / vs SPY | +30d / vs SPY | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| G · non-earnings | **ZYME** | $25.83 | **PDUFA 8/25** (SEC 8-K sourced) | PRE-position, stop 23.98 (rising 50d) | **7** | conditional **B-085** | no | | | |
| B · 8/20-21 | **AAP** | $57.43 | Q2 **8/20 am, verified** | POST-print, hold earnings-day low | **8** | watch | no | | | |
| A · 8/17-19 | **KLAR** | $20.58 | Q2 **8/18 am, verified** | POST-print, reclaim opening range | 7 | watch | no | | | |
| C · 8/24-26 | **KSS** | $19.575 | Q2 **8/26 am, verified** | POST-print, hold opening-range high | 7 | watch | no | | | |
| D · 8/27-9/4 | **AMBA** | $82.615 | Q2 **9/3 pm, verified** | POST-print 9/4 | 7 | watch | no | | | |
| J · shipping | SFL | $12.205 | Q2 8/25 am (**unverified**) | POST-print hold | 6 | watch | no | | | |
| I · movers | CSIQ | $15.375 | Q2 **8/27 am, verified** | POST-print, 13.25 floor | 6 | watch | no | | | |
| H · China | BZ | $15.285 | Q2 8/24 am (**unverified**) | POST-print, reclaim the open | 6 | watch | no | | | |
| — · Adam ask | **ONDS** | $8.89 | none named | **NO TRADE both ways**; short arms below 8.52 | — | pass **B-084** | no | | | |
| E · 9/8-18 | PLAY / ODD | $10.71 / $13.11 | 9/14(t) / **9/9 pm verified** | diary only | 6 / 5 | diary | no | | | |
| F · 9/19-30 | KMX / LW | $59.90 / $54.14 | **9/29 am verified** / 9/29(t) | diary only | 5 / 4 | diary | no | | | |

### The scan's real output was three falsifications, not the picks

1. **The government fiscal-year-end seasonal is FOLKLORE — tested and killed.** Scout F pulled 11 years of September returns across KTOS, LDOS, CACI, SAIC, BAH, LMT, NOC, GD (88 name-years): **mean −0.83%, median −1.12%, positive only 40/88. Six of eight names LOSE money in September**, and every one underperforms its own all-other-month average. Relative to SPY there is a +0.52% mean tilt with sd 1.82% and **t = 0.94** — economically worthless. Worse for us: the *affordable* small caps are actively hostile — **BKSY mean September −12.8% (2/5 positive), RDW −4.8% (2/5)**. **This directly weakens the secondary leg of the PL thesis** from this morning's scan, which leaned partly on the 9/30 federal FY-end. PL's 9/3 earnings catalyst stands; the FY-end tailwind does not.

2. **"Uranium is extended" was WRONG — Scout J refuted this morning's read with live data.** The complex is not extended, it is **wrecked and three weeks off a bottom**: UUUU −47.7% off its high, NNE −66.7% (52wk low 7/29), LEU −59.0% (low 7/17), SMR −82.6%, OKLO −75.6% (low 7/29), CCJ −27.4% and it did NOT hold $100. The +12%/+13% five-session moves are the first leg off a July capitulation, not a crowded trade. **Correcting our own morning call.** The "merchant IPPs are overlooked" half was confirmed (NRG −36.9% with its 52wk low on 8/04, VST −33.1%).

3. **P-010 logged:** a commodity/rate-linked stock only trades its own earnings if earnings days appear in its ten biggest single-day moves. Evidence: ZIM 0/10 (avg earnings move 1.90%), FRO 0/10 (3.55%), NMM 0/10 (2.04%), NAT 1/10 (3.20%) — versus falsifying controls SFL 4/10 (8.57%) and TRMD 2/10 (6.05%). Six names, clean split. Saves us from buying a rate proxy wearing an earnings costume.

### Capital collisions the calendar creates (there is only ~$581 — this is a QUEUE, not a portfolio)
- **KLAR 8/18 collides with VNET 8/18.** Same session.
- **KSS 8/26 and ZYME's 8/25 PDUFA both collide with the LOCKED PLAB print on 8/26 (B-082).**
- Non-conflicting sequence: **VNET 8/18 → AAP 8/20 → PLAB 8/26 (locked) → AMBA 9/3.**

### Other intelligence
- **China ADRs sold off complex-wide** — Scout H found 22 of 23 red while SPY was +0.61%, KWEB −2.78% vs FXI −1.15% (ADR/internet hit 2.4x harder than China broad). Cause not identifiable with price data alone; **not guessed**. **VNET was the exception at +0.67% green** — real relative strength on a bad day for its group, which supports the VNET thesis without de-risking its 8/18 print.
- **Guide-lane finding still holds:** ANF has beaten EPS four straight quarters and fallen on two of them; CHWY has beaten six straight and sits −49% off its high. Beat-and-fall is the modal outcome in retail right now (P-006).
- Highest ATR% found and **rejected**: FCEL at 14.31% of price per day — volatility with no structure, no invalidation that survives contact. Rejected as "a coin flip with a ticker on it."

---

## Scan 2026-08-16 — "AI startups to catch early + small-cap energy"

**Dispatched:** 5 scouts on Adam's ask — *"find some ai startups that we can maybe catch early or energy stocks small caps."* Lanes: **A** AI software/application layer · **B** AI picks-and-shovels hardware · **C** energy levered to AI/datacenter power · **D** recent IPOs + S-1s on file · **E** traditional small-cap energy (value side).
**Scope note:** private AI startups are not investable — no ticker, no filings, nothing to grade. Lane D is the closest real proxy (public but not yet widely owned).
**Regime at scan:** SPY **$776.34** (8/14 close, flat vs the 8/13 scan's $777.68) · XLE $61.91 · URA $44.93 · **WTI $82.20 (+31.1% y/y)** · **Henry Hub ~$2.74**, EIA sees sub-$3.00 through November, record 3,985 Bcf storage into winter. Tape = oil bid on Hormuz disruption, gas broken, AI hardware 18–42% off May–June highs.
**Prices:** Friday **2026-08-14** close throughout. Logged Sunday 8/16 — **two sessions stale by the next open, re-pull before acting.**
**Checkpoints due:** 7d ≈ 2026-08-23 · 30d ≈ 2026-09-15.

### The scan's headline finding: the insider tape splits cleanly by theme

Across **22 AI names** run through SEC Form 4s in three independent lanes (A, B, D), there was **exactly ONE open-market insider buy** — PGY's CEO, $250,468 at $15.43 in June. Everything else was distribution. Across lane E's royalty/coal names, insiders were **buying**: DMLP 15 buys / $1.92M / zero sells (CEO + CFO + directors), NRP buys only, ARLP one buy zero sells.

Three scouts that could not see each other's work produced that split. Some AI selling is clearly scheduled 10b5-1 (FORM's CEO tranches, RMBS's uniform 5,000-share director clips) — but some is not: **MOD executives sold $20.8M at $280–300 and the stock closed $209.50; CAMT's CFO and a director sold 3 days after a record print.**

| Scout lane | Ticker | Px @ 8/14 close | Mkt cap | The number that earns the slot | Conv /10 | Catalyst (verified?) | Call type | Taken? | +7d / vs SPY | +30d / vs SPY | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| E · royalty | **DMLP** | $27.69 | $1.36B | 11.52% FCF yield, **84.07% FCF margin**, net cash $69M, **15 insider buys / $1.92M / 0 sells** | **7.5** | Q3 distribution + results early Nov (**tentative**) | watch | no | | | |
| E · royalty | **NRP** | $104.85 | $1.39B | 11.54% FCF yield, debt $30.8M, payout only 39.8% of FCF, insider buys only | **7.5** | **Ex-distribution 8/18** (verified); Q3 11/04 (t) | watch | no | | | |
| E · coal | **ARLP** | $25.42 | $3.26B | 10.48% FCF yield **covers** the 9.44% distribution; 0.86x leverage | 7 | Q3 late Oct (**tentative**) | watch | no | | | |
| A · AI software | **PGY** | $21.56 | $1.80B | 16.7x P/E, 6 straight quarters of compounding GAAP profit, **the only AI insider BUY in the scan** | 7 | Q3 11/09 am (**tentative**) | watch | no | | | |
| E · E&P | **MGY** | $26.24 | $6.22B | 8.77% FCF yield, **0.37x debt/EBITDA**, Q2 FCF $234.6M (2x y/y) | 6.5 | Q3 11/04 pm (**tentative**) | watch | no | | | |
| C · power EPC | **AGX** | $578.22 | $8.11B | +50.2% rev, 14.6% net margin, backlog **$1.4B → $2.9B**, 79% gas-fired | 6.5 | **~9/3 (UNVERIFIED — no scheduled date in feed)** | watch | no | | | |
| B+C · switchgear | **POWL** | $213.48 | $7.78B | Backlog **$2.4B, +69% y/y**; largest single order in company history **>$400M datacenter** | 6.5 | Q4 FY26 11/17 (**tentative**) | watch | no | | | |
| A · AI software | **INOD** | $63.85 | $2.19B | **+57.8% rev, GAAP profitable**, top customer 56% → 37%; −49% off high | 6 | **CEO handover 9/30 (verified)**; Q3 11/05 pm (t) | watch | no | | | |
| B · probe cards | **FORM** | $131.60 | $10.28B | GAAP gross margin **37.3% → 50.7% (+1,340bps)** on +31.9% rev | 6 | Q3 10/28 pm (**tentative**) | watch | no | | | |
| B · packaging | **AMKR** | $58.99 | $14.66B | **P/E 26.5** — cheapest in lane B; top-10 concentration **72% → 66% (falling)** | 6 | Q3 10/26 pm (**tentative**) | watch | no | | | |
| B · memory IF | **RMBS** | $100.85 | $10.94B | **79.8% gross / 32.6% net margin**; −42.1% off high | 5.5 | Q3 10/26 pm (**tentative**) | watch | no | | | |
| D · IPO | **HAWK** | $22.78 | $2.23B | **+116.5% rev**; float already **78.3%** → Nov unlock is largely a non-event | 5.5 | **Lockup ~11/03**; Q3 11/12 (t), cons +$0.01 | watch | no | | | |
| D · IPO | **LFTO** | $21.61 | $3.59B | GAAP profitable YTD (+$45.1M), 60% EBITDA margin, ~4.1x FY26 guide | 5.5 | **Lockup ~12/01**; Q3 11/17 (t) | watch | no | | | |
| C · HALEU | **LEU** | $190.15 | $3.80B | **$4.5B backlog through 2040**, $900M DOE task order, Oklo + X-energy offtakes | 5 | Q3 11/04 (**tentative**) | watch | no | | | |
| D · IPO | **CBRS** | $218.98 | $47.50B | $25.4B RPO, core rev +103%; only non-Nvidia AI silicon at scale | 5 | **Lockup ~11/10 lands BEFORE Q3 on 11/19** | watch | no | | | |
| E · E&P | **CRC** | $53.31 | $4.73B | **6.29% buyback + 3.01% dividend ≈ 9% returned**; −25.9% off high | 4.5 | Ex-div **9/04**; Q3 11/03 am (t) | watch | no | | | |

**Cut but logged so it is not re-pitched as new:** **TNK** $85.13 — 5.02x P/E, net cash **$1.17B = 40% of market cap**, 11.30% FCF yield. Cut because it printed its 52-week high **on 8/14** after +95.5% off the low, on tanker rates inflated by July Strait-of-Hormuz vessel strikes. A 5x multiple on peak-cycle earnings is ~15x on normalized. Peer insiders (INSW, ASC) distributing.

### Falsifications this scan produced

1. **"AI-power is the most hyped theme right now" — WRONG, and it was MY premise handed to scout C.** The theme did not peak recently; it topped **2025-10-15/16** and broke. LEU −59.0%, OKLO −77.1%, NNE −67.7%, SMR −83.7%, AMSC −54.7%, FRMI −82.7% — all off that same week. **This CONFIRMS and extends the 8/13 correction (item 2 of the afternoon scan)** which found uranium "wrecked and three weeks off a bottom." Four weeks later it has not recovered. What made *new* 2026 highs were the boring earners (ATKR, PLPC, IESC).

2. **AMSC is sold as an AI-power name and had ZERO datacenter orders last quarter — by its own disclosure.** Record >$130M quarterly orders, >$400M backlog, +30.0% rev — all real, all from **utility and mining** customers. Management says it is bidding. Logged as the cleanest example this scan of a label outrunning the revenue. Not proposed. Falsifier: two more quarters with no datacenter order = value it as a grid/wind cyclical, full stop.

3. **HNRG's datacenter PPA may not exist.** The "Exclusive Commitment Agreement" with an unnamed "leading global data center developer" was effective **2026-01-02** with a **105-business-day** window and up to $5M of payments. That is **19+ months** past a ~5-month exclusivity window with **no definitive agreement verifiable**. Meanwhile it swung from +$41.9M FY25 net income to consecutive quarterly losses (−$9.3M, −$15.2M) with widening EPS misses and +9.7% dilution. Not proposed.

4. **Insider buying alone is not a thesis — GRNT is the counterexample.** Best insider cluster found anywhere in the sweep: **12 open-market buys, $863K, CEO + CFO + directors, zero sells.** And **FCF yield −15.2%**, negative FCF in 5 of 6 years, $462M debt, with **the 8.6% dividend funded by borrowing.** Same trap in ACDC (Wilks family bought $4.02M on 8/12; debt/EBITDA 3.95, buyback yield −11.74%) and NOG (director bought $500K; FCF yield −11.3%, net debt $2.68B).

### Pattern candidate raised (proposed for `db/patterns.json`, not yet logged)

**Every 2025–26 AI-adjacent IPO checked sold off hard into or after its lockup expiry.** Instances: FIG −69% off high, FRMI −82.7%, NTSK −44%, VCX −94% (premium to NAV collapsed from a reported ~1,900% to +81% in five months, straight into an accelerated 8/13 unlock). Falsification test: a 2025–26 AI IPO that trades flat-to-up through its unlock window on rising volume. **Needs Adam's OK before it gets an ID** — 4 instances is already past the 3-instance promotion gate.

### Hard rejects (documented so the reasoning survives)

| Ticker | The bait | The disqualifier |
|---|---|---|
| **AI** C3.ai | "beaten-down AI name" | **Revenue −52.5% y/y** ($108.7M → $51.6M), GAAP gross margin **62% → 21.9%**, −$115.6M quarterly loss. Broken business, not a dip. Possible short-side work. |
| **QNT** Quantinuum | Only large-cap trapped-ion pure play, $2.1B cash | **$16.5B cap on $28–32M FY26 guidance ≈ 550x sales**, guiding *below* FY25's $30.9M. Float **11.5%** — the price exists only because 88.5% is locked until ~12/01. |
| **SWMR** Swarmer | Combat-proven drone-swarm autonomy, $16.3M backlog | **$451M market cap on $236,738 of H1 revenue.** Lockup **~9/17** — ~6.4M restricted shares vs ~264K ADV = **24+ days of volume**, held at a $5 basis with the stock at $41.60. |
| **QMLS** QumulusAI | −81% from listing-day high, "cheap neocloud" | **Explicit going-concern disclosure**, 85% of revenue from one partner (RunPod), 25 employees, TTM losses $93.68M on ~$3.4M quarterly revenue. |
| **AAOI** | +86.4% rev, fastest growth in lane B | **Largest customer is 42% of revenue and is CATV, not a hyperscaler**; top 10 = 99%. Gross margin FELL to 27.7%. Still GAAP unprofitable. |
| **FCEL** | −40.9% off high | **Share count +196.6% y/y** (22.8M → 67.6M, verified not a split). Negative gross profit. |
| **AMR** Alpha Met | Net cash $327M, zero debt, near 52-wk low | FCF yield **−0.07%** (was $1.32B in 2022). "Insider buying" is essentially **one director + one activist**, mostly at $175–200 vs $166. Guidance **cut**. |
| **METC** Ramaco | −79% off high, looks like capitulation | **67 insider SELL transactions, $40.09M, zero buys.** |
| **DK** Delek | **16.99% FCF yield — highest in the screen** | P/B **21.5** (almost no book equity), debt/EBITDA 2.94, at 52-wk high, insiders selling. |
| **SM** SM Energy | 5.66x P/E, 12.5% earnings yield | **Buyback yield −45.08%** — massive issuance. $7.43B total debt. |
| Also cut | PARR (+188% off low, insiders selling) · CVI (Icahn bought at ~$21, stock $35.66 — signal 70% spent) · KOS (debt/EBITDA 4.38) · EGY (FCF yield −22.0%) · OKLO/NNE/SMR/FRMI/NRGV (pre-revenue + heavy dilution) · CXAI (**"Noncompliant"** exchange flag) · RZLV/GRRR (SPAC reverse mergers) · DOMO (negative book value) · BBAI (11x sales on 13% growth) |

### Data limitations — log honestly

- **The `financial-datasets` MCP returned "Insufficient credits" / "balance is $0.00" on EVERY call, in all five lanes.** This matches the 2026-08-12 decision to drop the paid connector. Consequence: **`screen_stocks` was unavailable**, so no lane ran a true quantitative screen — universes were built by hand from web search and verified downstream. Coverage is therefore narrower than a real screen and **absence from this list is not evidence a name was rejected.**
- Fallback stack actually used: Robinhood MCP (quotes, fundamentals, financials, earnings calendar) · **`scripts/insider-check.mjs`** for SEC EDGAR Form 4s (the v24 insider leg — worked correctly, 270-day windows) · SEC XBRL `dei:EntityCommonStockSharesOutstanding` for share counts · Jina Reader for bot-walled pages.
- **One number NOT SEC-verified: LEU's ~15% dilution is press-reported.** Its XBRL share-count tag was discontinued in 2022. Confirm against the 10-Q before LEU gets a book row. Its **$1B ATM** is the reason this matters.
- **Two large "insider sells" that are structural, not opinions:** ExxonMobil liquidating its inherited 16.6M-share PUMP stake ($276.6M) and CPPIB exiting 3.5M CRC shares at $61.10 ($213.9M). Real overhangs; not management losing faith.

### Calendar collision the scan surfaces

**Catalysts cluster brutally in Nov 3–20** — CBRS, LFTO, QNT, HAWK, LEU, POWL, RMBS, AMKR, FORM, MGY, CRC, ARLP, NRP and DMLP all report or unlock inside that window, on ~$581 of deployable cash. Before then there are only three dated events in this entire scan: **NRP ex-distribution 8/18 (verified)**, **AGX ~9/3 (unverified)**, **SWMR lockup ~9/17**, and **CRC ex-dividend 9/4**. Between mid-September and November this list is nearly eventless — which argues for patience, not position-building.

**Nothing from this scan has a `db/archive.json` row.** These are candidates, not calls: `log-call.mjs` would correctly refuse every one of them for want of a `--trigger` / `--invalid` / `--size`. Row IDs get issued when a name goes to a full v24 run.
