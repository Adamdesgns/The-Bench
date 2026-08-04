# THE THESIS LEDGER

Defined in **v22** (carried from v21). The Bench Archive logs *trades*. Most of this
framework's output is deliberately **not** a trade — "No Trade", "wait", "gapped past
us", "too expensive to size". Under v20 a correct read that produced no trade left no
record, so the book could be **right** and show **nothing**.

This ledger is the second record. **Every validated thesis is logged and scored,
whether or not a trade was taken** — and scored on *thesis accuracy*, separately from
trade P&L. Two different questions: *were we right about what would happen?* and *did
we make money?*

A row qualifies when the read is **specific, checkable, and directional, with a
reason**. Not a vibe — a falsifiable call.

> **Catalyst dates live here too.** Added 2026-08-04 after SPCX reported with nobody
> watching: the market scan checks the earnings calendar against the *active board*,
> so a name we review and pass on drops off the radar entirely. A No Trade **with a
> catalyst** is exactly what becomes a tradeable post-print reaction, so every
> reviewed name carries its next catalyst forward in this file.

---

## Ledger

| # | Date | Thesis (one line) | Name | Direction | Why no trade | Price at logging | Next catalyst | Outcome |
|---|---|---|---|---|---|---|---|---|
| T-001 | 2026-08-04 | AI-software re-rating: PLTR's Q2 would confirm the compute-plus-software trade | PLTR | Long | **Never brought to the desk** — mentioned in another chat, never logged, so the framework never graded it | not logged | Q3 ~Nov 2026 | ❌ **MISS.** Beat and gapped +26%, closed the day ~$162.55 (+29%). A real miss — and the reason this ledger now exists. The read was Adam's and it was right; the failure was that it left no record to act on. |
| T-002 | 2026-08-04 | AMD *is* hyperscaler capex; the PLTR halo plus a bid AI complex should carry the print | AMD | Long | **Passed on the pre-catalyst run.** All four Conviction Tier gates passed, but AMD had already run **+8.6% into its own print** ($484.64 → $526.20), so the beat was priced before it landed. Flagged twice as "a beat that merely meets raised expectations can still sell off from here." | $526.20 | Q3 2026-11-03 pm | ✅ **CORRECT PASS.** AMD **beat** — EPS **$1.66 vs $1.55** — and fell to **$476.40** after hours (−9.5% from the decision price, below the prior close). The planned 545/550 spread would have been a **total loss: −$168**. |
| T-003 | 2026-08-04 | SPCX is a falling knife with no floor — a first real print on an unvaluable story is not a setup | SPCX | No trade / avoid | Fails Conviction Gate 1: our own logged thesis is "unpriceable", so there is no validated thesis to press. Also no options history to price a sane structure against. | $124.41 | reported 2026-08-04 pm | ✅ **CORRECT PASS.** Reported and sold off to **$116.49** (−6.4% from logging, −7.5% from the close). |

**Running tally — 2 correct passes, 1 miss.**

---

## Framework-improvement candidates

Per the **v22 Self-Audit Loop**: candidates are *proposals*, reviewed before they ever
change a rule, **never auto-applied**. The guardrail is that rules change on
**structural gaps or repeated patterns, never single outcomes** — a loss that broke no
assumption and revealed no gap is variance, and "no change" is the correct result most
of the time.

### C-001 — The Pre-Catalyst Run Gate *(proposed 2026-08-04, from AMD)*

**Status: candidate. Not adopted.**

**The observation.** The AMD pass was correct, and the framework *already* caught it —
the Second-Hand Catalyst Rule and Earnings Quality both fired, and the risk was stated
out loud twice before the print. So by the strict reading, the audit result here is
**"no change"**: the rules worked.

**The refinement worth considering.** What fired was a *judgment call* ("8.6% is a
lot"), not a *checkable gate*. There is no threshold in the framework that says when a
pre-catalyst press is dead on arrival. Proposed:

> **Measure the pre-catalyst move against the options-implied move.** If the underlying
> has already travelled **≥ 50% of the implied move** before the print, the
> pre-catalyst press is dead — the reaction entry is the only remaining trade.

**Worked example (AMD, 2026-08-04):** implied move ≈ **±$45 (±8.6%)** at IV ~134%. AMD
moved **+$41.56 (+8.6%)** on the day *before* reporting — roughly **92% of the entire
implied move already spent** pre-print. Under this gate the press is auto-killed at
~11a, hours before the 2p deadline, with no judgment required.

**Why it may still be wrong.** One instance. It needs a second and third case before
adoption, and a threshold pulled from one example is a number, not a rule. Watch it
against the next several prints (SMCI 2026-08-11 is the immediate test) and adopt only
if the pattern repeats.

**Counter-case to watch for:** a name that runs hard pre-print *and* keeps running
(the momentum case). If that shows up more than once, the gate is too blunt and should
become a size reduction rather than a hard kill.

### C-002 — Log every ticker Adam names *(proposed 2026-08-04, from PLTR)*

**Status: candidate. Partially in force — this file is the mechanism.**

A ticker mentioned in passing — in any chat, in a screenshot, as "this looks good" —
currently evaporates unless it becomes a formal review. PLTR was named and lost, and
the loss was invisible until after the move. Proposal: **any ticker Adam names gets a
Ledger row with the date and price, even if it is never run.** Then "remember when I
told you about X" has a receipt, and his hit-rate gets measured honestly alongside the
framework's.

**Why this is not just bookkeeping:** if his uninstrumented reads consistently beat the
framework's passes, that is a *structural* finding about where the edge actually lives
— and it can only be discovered if the reads are recorded before the outcome.
