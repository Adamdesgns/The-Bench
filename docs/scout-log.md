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
| Breakout | **LTH** | $45.14 | $43.25 pullback → $42.00 → $50-51 / $56 | 7.5 | Q2 beat 7/30 (done); next Nov 3 | long | **YES — 7 sh starter, limit resting** | $43.83 · **-2.90%** / -6.41 | | **WRONG** (name lagged) — but **limit FILLED 8/7** @ $43.25 (low $42.77); position +1.34% from fill |
| Earnings | **SMCI** | $28.40 | Aug-21 $30/$34 call spread ~$110 | 7 | Earnings Aug 11 pm | BET (defined-risk) | **WATCH — decide by Aug 11** | $31.11 · **+9.54%** / +6.04 | | *BET — graded separately.* Ahead of the print; spread is now near/through the $30 short strike. **Catalyst pending Aug 11** |
| Accumulation | NKE | $41.72 | 14 sh → $39.50 (floor $40) → $52 | 6.5 | none near | long (watch) | no | $41.71 · **-0.04%** / -3.54 | | **WRONG** — dead flat in a +3.5% tape; no catalyst, no move |
| AI shovels | CAMT | $132.35 | 3-4 sh → $115 → $165 | 6 | Earnings Aug 10 pm | long (watch) | no | $155.57 · **+17.54%** / **+14.04** | | **RIGHT** (best long call) — ran to within $10 of the $165 target *before* the print. **Catalyst pending Aug 10.** Watched, not owned |
| Earnings | CELH | $29.23 | ~20 sh → $27 → $33 / $37 | 6 | Earnings Aug 6 am | long (watch) | no | $27.77 · **-5.00%** / -8.50 | | **WRONG** — reported 8/6: gapped $29.15 → $23.77 (-18.5%), blew through the $27 stop, bounced +16.8% on 8/7. Stop would have paid |
| Accumulation | UBER | $70.37 | 8 sh → $65 (floor $65.41) → $88 | 6 | none near (Waymo overhang) | long (watch) | no | $75.00 · **+6.58%** / +3.08 | | **RIGHT** — held the $65.41 floor (8/5 low $66.74) and broke to new highs |
| Crypto | SOL | ~$74.65 (web) | ~$475 → $70 → $97 | 6 | SOL ETF/ETP cluster | long (watch) | no | ~$72.64 · **-2.69%** / -4.97 *(vs BTC +2.28%)* | | **WRONG** — ETF/ETP catalyst didn't fire; lagged BTC, never threatened $97 |
| Breakout | HALO | $82.55 | buy-stop >$84.50 → $79.50 → $103 | 6 | none confirmed | watch (untriggered) | no | $103.12 · **+24.92%** / **+21.42** | | **WRONG — EXPENSIVE PASS (worst miss).** Buy-stop **triggered 8/6** (high $86.00), then ran to **$103.12 — the exact $103 target**, in one week. Full setup, executed by the tape, not by us |
| Breakout | DINO | $91.41 | pullback to $88 (extended) | 5.5 | crack spreads | watch | no | $81.39 · **-10.96%** / -14.46 | | **RIGHT** — worst decliner in the scan; "extended" read was correct. *Caveat: the $88 pullback entry filled 8/3-8/4 and would have bled to $81.39 — right to pass, wrong entry plan* |
| Crypto | ETH | ~$1,981 (web) | breakout >$2,030 → $1,980 | 5 | staking ETP | watch (at resistance) | no | ~$1,910 · **-3.58%** / -5.86 *(vs BTC +2.28%)* | | **RIGHT** — $2,030 breakout never triggered; rejected at resistance and lagged BTC. Discipline paid |
| Earnings | HIMS | $27.78 | post-print reaction >$30 | 4 | Earnings Aug 10 pm | watch (post-catalyst) | no | $31.59 · **+13.72%** / **+10.21** | | **WRONG — EXPENSIVE PASS.** Ran the move *pre*-print; the >$30 trigger hit 8/3 ($30.82). **Catalyst pending Aug 10** |
| AI shovels | NVT | $153.92 | pullback to hold $150 | 4 | Q2 blowout 7/31 (gap-faded) | watch | no | $164.70 · **+7.00%** / +3.50 | | **WRONG** (not expensive, <10%) — the $150 pullback *did* trigger 8/3 (low $149.25) and paid +10.4% from there. Setup worked; we weren't watching |

**7-day read (scored 2026-08-07 close · SPY $747.03 → $773.20 = **+3.50%** · BTC 7d **+2.28%**):** **4 of 10 graded calls right (40%)** — and *conviction ran backwards*: the 6.5+ tier went **0-for-2** (LTH, NKE) while the 5.0-5.5 tier went **2-for-2** (DINO, ETH). Lanes: **accumulation 1/2, AI-shovels 1/2, crypto 1/2, breakout 1/3, earnings 0/2** — no lane earned trust yet, but *the passes we got right were the disciplined ones* (ETH's untriggered breakout, DINO's "extended" read), while **both expensive passes were setups that triggered and we simply weren't watching**: **HALO +24.9%** (buy-stop fired 8/6, then hit the exact $103 target — the worst miss of the scan) and **HIMS +13.7%**. Add **NVT +7.0%** (its $150 pullback triggered 8/3 and paid +10.4%) and the pattern is unmissable: **the scouts' entry triggers were good; the monitoring was absent.** Only real position **LTH** filled at $43.25 on day 7 — the name lagged (-2.90%) but the limit discipline bought it 4.2% cheaper than the log price. **Three catalysts still ahead** (CAMT + HIMS Aug 10, SMCI Aug 11) — the +30d checkpoint scores those honestly; SMCI (the BET) is +9.54% pre-print, currently siding with the earnings scout over the AI-shovels cull.

**Cross-scout disagreement logged:** the earnings scout ranked **SMCI #1** (clean defined-risk structure); the AI-shovels scout independently **culled SMCI** (commoditized box-assembler, governance cloud). Recorded so the outcome settles which lens was right on this name.

**Notes for scoring:**
- LTH is the only *taken* call (starter). Fill is conditional on a pullback to $43.25; if it never fills, mark **no-fill** (the scout was right on the name but the entry discipline kept us out — a separate, useful data point).
- SMCI is a **BET**, graded separately from the `long` picks — it lives outside `db/archive.json` by rule.
- SOL/ETH prices are web-verified (Robinhood MCP can't quote crypto pairs); confirm before scoring.
