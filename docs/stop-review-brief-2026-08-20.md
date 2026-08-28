# FRAMEWORK REVIEW BRIEF — the stop/holding-period conflict (P-013)

**Prepared 2026-08-19 · to be run 2026-08-20 · Self-Audit Loop candidate, NOT yet applied**

Adam authorised this review on 2026-08-19 after GDS stopped out, on the claim *"our stop losses are costing us on stocks that otherwise return to their levels."* That claim was tested the same day (B-148) and the review exists because the **test found something different from what the claim asserted.**

---

## THE FINDING THAT OPENED THIS — P-013, `supported` at 3/3

**Every closed swing in this book exited at its STOP. Not one has ever reached Target 1.**

| Trade | Held | Intended window | T1 | Best print | Exit |
|---|---|---|---|---|---|
| GOOGL | 6 sessions | 2–8 weeks | — | 384.48 | trailing stop 357.00 |
| HPQ | 6 sessions | 2–8 weeks | 32.80 | 31.30 | ratcheted stop 29.29 |
| GDS | 24h 52s | 2–8 weeks | 37.85 | 35.045 | stop 32.60 |

The stated hypothesis was: *a 1.0–1.1 ATR stop is a one-to-three-day stop, not a two-to-eight-week stop, so the ATR Floor and the default holding window are in structural conflict.*

**The counterfactual below partly refutes that hypothesis.** Run the review on what the data actually says, not on the hypothesis that opened it.

---

## THE COUNTERFACTUAL — would a wider stop have survived?

All prices from daily bars pulled live 2026-08-19.

### GDS — a wider stop changes almost nothing
- Basis **34.40**, ATR(14) **1.6916**. Actual stop 32.60 = **1.064 ATR**, hit 8/19 8:50:26a.
- A **2.0 ATR** stop would sit at **31.02**. Lowest print since entry is ~**32.55**, so it would **not** have been hit.
- But the position would simply still be open at **32.70**, marked **−$27.20 against a realized −$28.80.**
- **Verdict: the wider stop buys $1.60 and an open losing position. It does not rescue this trade.** This case cuts *against* raising the Floor.

### HPQ — the RATCHET killed it, not the stop
- Basis **29.145**, ATR **1.374**. Original stop **27.65 = 1.09 ATR**. Ratcheted to **29.30 = 0.11 ATR** on 8/13; hit 8/17 at 29.29.
- Lowest print across the entire holding period: **28.305** (8/12).
- **The original 1.09 ATR stop was NEVER HIT. Neither was a hypothetical 1.0 ATR stop at 27.771** — it had 0.39 ATR of clearance at the worst moment.
- Without the ratchet the position is open today at **30.245 = +$16.50** instead of +$2.17.
- **Verdict: this is the one genuine "stop cost us money" case in the book, and v25 ALREADY fixed it** — the ATR Floor was written from this exact trade and now forbids that ratchet.

### GOOGL — the trailing stop BEAT holding
- Basis **332.38**, entered 7/30, trailed 323 → 335 → 350 → **357**, filled 8/5. Realized **+$24.62**.
- The original 323 stop was never threatened (post-entry low 340.19).
- Holding to today: **345.45 = +$13.07.**
- **Verdict: the ratchet made $11.55 that holding would not have. The same mechanism that killed HPQ made GOOGL.**

---

## THE REFRAME THIS FORCES

The initial stop was **never the problem in any of the three trades.** HPQ's original stop was never hit. GDS's was correctly placed and a wider one would only have prolonged a loss. GOOGL's was never threatened.

**In two of three trades, the outcome turned on the RATCHET.** It destroyed HPQ (+$16.50 → +$2.17) and it created GOOGL (+$13.07 → +$24.62).

> **The review's real question is therefore NOT "is 1.0 ATR wide enough?" It is: "when should a stop be ratcheted at all, and to where?"**

v25 constrained how *tight* a ratchet may go (1.0 ATR minimum). It never said when a ratchet is *warranted*. GOOGL ratcheted into strength and was paid. HPQ ratcheted into a position that had barely moved, and was taken out of a winner.

---

## QUESTIONS THE REVIEW MUST ANSWER

1. **What triggers a ratchet?** Candidate: only after T1 is touched, or after a defined multiple of ATR of progress — never on elapsed time or on a green day.
2. **Does P-013's "zero targets reached" survive the reframe?** Three trades exited before T1 — but if the ratchet is what ended two of them, the target was never given a chance rather than being set too far.
3. **Is the 2–8 week default window honest?** Three trades averaged ~4 sessions. Either the window is wrong or the management is. Say which.
4. **Should the instrument change instead of the rule?** A long call or defined-width spread cannot be stopped out by a wick at all — max loss is the premium. This is already in the framework (Conviction Tier, Size-Aware Conviction) and has **never been used** — 0 rows tagged `Conviction/Call`. Account is option level 2 (cash, long calls/puts) and level 3 (margin, spreads, but only $5.84 in it).
5. **What does this mean for the live MU plan?** Its stop is 1.053 ATR, and a 2.0 ATR stop (~$146) needs T1 at 1173 against a confirmed double top at 1036 — the payoff gate fails. So any Floor increase must state what happens to setups it disqualifies.

## THE GUARDRAIL

v25: *the loop makes the framework smarter, never looser.* Nothing here may be used to justify removing a stop, widening one after entry, or holding a loser. The refutation to beat: **exits across the whole book SAVED $122.63** — RCAX alone would be −$115.95 held to today instead of −$1.53.

## WHAT WOULD FALSIFY THE WHOLE PREMISE

One trade that exits at T1 or T2, or one 1.0-ATR stop that survives a full four-week hold. Either result closes P-013 and this brief with it.
