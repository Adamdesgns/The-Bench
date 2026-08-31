# AI Infrastructure — which layer runs next (B-220 CEG)

**2026-08-29, Saturday. Market closed — every number below is the 2026-08-28 settled close.**
Weekend prep run for the reminder Adam set 2026-08-24: *"We need to start pivoting to the next likely pump in ai infrastructure."*
Framework v27. Board: `db/board.json`. **Nothing owned. Nothing ordered. This is a watch with a trigger.**

---

## 1. The week, by layer

Equal-weight, 8/21 close → 8/28 close.

| Layer | WTD | Detail |
|---|---|---|
| **buyers** | **+3.72%** | MSFT +6.30, META +5.11, AMZN +3.00, GOOGL +0.48 |
| box | +2.09% | ANET +3.54, DELL +3.16, SMCI −0.43 |
| silicon | −2.48% | NVDA +1.31, AVGO +0.06, AMD −1.62, MU −3.52, MRVL −8.63 |
| power | −2.88% | CEG +1.42, VST +0.65, VRT −1.93, ETN −3.90, GEV −4.74, PWR −5.73, TLN −5.90 |
| **crypto_bridge** | **−7.76%** | WULF −1.66, APLD −6.76, CORZ −7.19, IREN −15.41 |
| *SPY* | *+0.48%* | *QQQ +0.42, SOXX −2.22* |

**Buyers-minus-silicon spread: 6.20 points**, wider than the 5.15 logged on 8/24.

**The money rotated UP the chain, not down it.** The honest answer to "which layer runs next" is that the layer that ran is the one that funds everything else, and buying it here is the Late FOMO the framework exists to refuse.

## 2. The crypto bridge — thread answered, and it is a NO

Adam's setup was that on 8/24 the miners were red while ETH was +3.67% and BTC +3.44% — trading as AI-infrastructure names, not crypto names.

**That seam has not closed. It has widened.** This week BTC and ETH proxies were *up* — IBIT +0.53%, ETHA +0.76% — while the four miners fell **7.76%**, roughly **3.5x SOXX** (−2.22%).

The miners now carry **downside beta to both sides and upside beta to neither.** That is the most crowded expression of the layer being sold, not a setup.

**IREN is the proof:** −15.41% WTD. EPS −0.74 vs −0.55 est. Revenue $137.2M against $187.3M a year ago. A $684M net loss including a ~$450M impairment on decommissioned Bitcoin mining hardware. A $2.4B Blue Owl GPU financing at **9.0% fixed** against a **$12.66B** market cap.

## 3. Power — the candidate layer

The least-covered layer, the stated bottleneck, and the only one where the buyers are publicly committing money the market has not paid for.

**Dated commitments, all 8/26–8/28:**
- Huang on the 8/26 NVDA call: an AI factory needs "land, power, and shell," and that takes two to three years. NVDA put up credit support for the first **4.25 GW** at SB Energy's Ohio campus plus **$1.5B** into the developer.
- MSFT development chief Noelle Walsh memo (Bloomberg, 8/28): plans for **up to 40 GW** of renewables.
- AMZN, 8/28: a **600 MW** Gennaker offshore wind PPA plus four Swedish wind projects.

**Meanwhile the listed layer is in a real drawdown:** VRT −32.4% from its 5/14 high, GEV −23.8% from 7/6, PWR −23.6% from 5/6, ETN −15.7% from a high set only 8/12, and **TLN printed a fresh 52-week low (294.75) on 8/28.**

## 4. Why CEG and explicitly not GEV

| | CEG | GEV |
|---|---|---|
| Price vs 50-day | 276.75 vs **264.97** → **+4.4% above** | 911.53 vs **1031.65** → **−11.6% below** |
| To reclaim the 50-day | already above | **+13.2%** |
| PE | 26.95, profitable, pays a dividend | 26.10 |
| YTD | **−25.49%** | **+40.81%** |

**GEV is a knife and is not the candidate.** CEG is the only power name checked that is above its 50-day, and it is making higher lows into the selloff: **264.82 (8/18) → 269.53 (8/24) → 275.99 (8/28)**.

CEG is **basket A by P-012's own test** — positive earnings, PE under ~27 — sitting inside a layer the tape is selling as if it were all basket B. The de-rate has already happened here, which is the same relative-position logic B-214 used to prefer AVGO over MU.

**Insider leg passes, verified from EDGAR and not from a widget.** `scripts/insider-check.mjs` on CIK 1868275: **one open-market buy, code P** — Director Roger W. Crandall, 1,500 sh @ 278.6206, $417,931, filed 8/13 — and **zero sells**. The tool separately flagged a 462-share grant on 8/06 as routine and excluded it; that distinction is the whole point, and retail Buy/Sell widgets get it wrong. **Friday closed at 276.75, below what the director paid.**

## 5. B-220 — the plan

- **Trigger:** reclaim and **hold 287.00** — the 8/14 high and the top of a three-week shelf that also capped 8/17 at 286.30 and 8/26 at 285.26.
- **Invalidation:** **264.82** — the 8/18 swing low, sitting on the 50-day at 264.97. Losing it means CEG is no longer the relative-strength name and this entire layer read is wrong.
- **Decide by:** 2026-09-19.

**Arithmetic at the trigger — re-derive off post-trigger ATR at entry.** ATR(14) 8.769 (3.17% of price). Working stop 275.99 (the 8/28 low, the most recent higher low) is 11.01 of risk from 287.00 = **1.26 ATR**, clearing the v25 ATR Floor. **T1 310.45** (the 5/25-week high) pays 23.45 = **2.13:1**, clearing the 2:1 minimum. Analyst mean PT 348.95 (FactSet via MT Newswires, 8/21) — context, not a target.

**Sizing is the weak leg, and it is why execution grades C.** Account $2,511.72 all cash; v27 standing band 10% = $251.17. The band wants 22 shares, but 22 × 287.00 = $6,314 = **251% of the account**. The 25% order-value ceiling ($627.93) outranks the plan and caps this at **2 shares** — $574.00 order (22.85% of the account), **$22.02 at risk = 8.8% of the band.** Fundable, but under a tenth of the band. Same Size-Aware Conviction squeeze B-214 hit on AVGO.

## 6. The honest counter — logged as P-016

**Friday was a RATE shock, not an AI event.** Warsh at Jackson Hole moved September hike odds from ~35% to ~60% on CME FedWatch; the 2-year yield jumped 10bp to 4.34%. Gold −2.0%, silver −2.2%, GDX −3.2%, PBW −2.6%, IBB −2.3%, BTC −3.1% all repriced the same way — outside the AI complex entirely.

And the AI news that week was **good**: NVDA reported 8/26 with revenue $96.2B (+106%), data center $89B (+117%), EPS $2.22 vs $2.10, guided ~$108B for Q3 and ~70% FY2028 growth against ~45% consensus — then **gave back the entire 8% pop on 8/28.**

**P-016 is deliberately separate from P-012.** P-012 claims the complex reprices on FY2027 *earnings* across the Jan-2027→Oct-2027 cycle; P-016 claims it reprices on *rates* within a single session. They predict the same shape through different mechanisms, so **a rates day must never be logged as a P-012 instance** — that would inflate P-012 toward its 3-instance promotion threshold on evidence that has nothing to do with earnings.

Capital-intensive power names are directly exposed to a hike, and CEG is a utility. **That is why this is a conditional above a shelf and not a dip buy.**

## 7. Calendar worth watching

- **DELL** Tue 9/1 pm (box, est 4.88) — board name.
- **AVGO** Wed 9/2 pm (silicon, est 3.16) — already **B-214**; the play there is the reaction Thu 9/3.
- **AGX** Wed 9/2 pm — Argan, power-plant EPC. Not on the board; a clean read on the power layer's order book.
- **ORCL** Thu 9/10 pm — not on the board, but its RPO/backlog is the loudest single read on hyperscaler-adjacent AI demand.

---

*Not financial advice. Adam executes every order; nothing here was traded.*
