# Self-Audit Loop — v23 framework audit, 2026-08-12

**Prompted by:** Adam — *"audit v23, it seems to miss more wins than it catches. we need to tighten this up."*
**Method:** `score-book.js --dry-run` (40 checkpoints due as of 2026-08-12) + full 72-row tabulation + scout-log review. Nothing written to the archive by the scorer; this doc and its candidates are the output. Per the loop's guardrail, rule changes below are **candidates for Adam's review** — nothing is auto-applied, and any adopted change ships as a **new file (v24)**, never an edit to v23.

## The claim, tested against the scored record

**40 checkpoints due → 9 RIGHT · 5 WRONG · 1 flat · 25 not scorable.**

Of the scorable, 60% right. The five wrongs:

| Row | What happened | Kind of wrong |
|---|---|---|
| B-019 PENG | conditional triggered, −20.2 alpha | a real loss |
| B-023 SPCX | pass, +6.0 alpha @1w | missed win |
| B-025 BRKR | pass, +11.3 alpha @1w | missed win (post-crash bounce) |
| B-026 PLTR | pass, +10.4 alpha @1w | missed win (post-gap continuation) |
| B-034 PODD | conditional, +8.6 alpha @1w | missed win (post-crash bounce) |

**Adam's feel has a real signal: 4 of 5 wrongs are misses, not losses.** When v23 is wrong, it is wrong by absence. That asymmetry is genuine and worth engineering on.

**But the headline claim is not supported.** The nine rights include the saves the misses make invisible: OUST **−43.2%**, VIVO **−24.7%**, MU **−15.9%**, XLM −15.0 alpha, DOGE −9.1 — plus MSFT +22.1 alpha (long) and LMT +11.3 (conditional, triggered and ran). The right-passes dodged an average ≈ −20%; the wrong-passes missed +6–11% bounces. On expectancy the pass discipline is still heavily net-positive. And per the book's own P-002, **1-week verdicts invert** (LMT was WRONG @1w, RIGHT @1m); every expensive pass above is a 1-week verdict on a post-crash bounce. Their 30-day checkpoints land ~Sep 3–4.

Outside the archive, the same asymmetry: SMCI (+21% from scan price, passed at the deadline — scout log records every pass reason was about the tape, none about the guide) and the pre-v21 lineage misses (NBIS→v18, AMZN→v20, AMD→v21) that already drove versions. The loop has been catching exactly this class of failure; v23's changelog is its receipts.

## Candidates

### C1 — MEASUREMENT (fix now, no rule change): 25 of 40 checkpoints are unscorable
The book cannot currently answer Adam's question at full strength — 62% of due checkpoints return "—". Causes:
1. **Legacy field gaps** (hedges w/o size, conditionals w/o trigger) — pre-guard rows, already fenced by `log-call.mjs`; unfixable honestly, leave them.
2. **Seven fixable rows (B-024, B-027–B-033):** the scorer reports *"call phrasing not recognised"*; gates live in prose ("prove 287", "prove 500", "reclaim and HOLD 126.71") while the `trigger` field is null, and `backfill-triggers.js`'s parser does not recognize those phrasings. **Proposal:** backfill structured `trigger`/`call_type` on those seven rows *from their own logged prose* (values already in the text — zero invention), and extend `server/triggerParse.js` to recognize "prove N" / "reclaim and hold N". Needs Adam's OK to touch logged rows; PR either way (no main access).
3. HYPE — price genuinely unobservable; correct behavior.

### C2 — RULE CANDIDATE for v24: codify P-008 into the earnings-reaction entry
P-008 (*"when the quarter and the guide point opposite ways, the reaction follows the GUIDE"*) promoted `proposed → supported` today at 3-for-3 (ONON, SMCI, SMCI D+1). The SMCI pass failed precisely here: the deadline decision weighed the tape and the print, and never the guide. **Proposed rule text:** on any post-earnings evaluation, the guide's direction outranks the beat/miss and outranks the pre-print tape read; a guide-driven move qualifies as the "reaction" the framework already prefers to trade, with normal defined-risk structure. This tightens *toward catching SMCI-class wins* without loosening any risk gate — entry remains post-print, stopped, sized.

### C3 — HOLD FOR DATA: the expensive-pass cluster (BRKR / PLTR / PODD / SPCX-B-023)
All four are 1-week verdicts on names that had just crashed or gapped. P-002 says these invert too often to act on. **Decision deferred to the 30d checkpoints (~Sep 3–4).** If the bounces hold at 30d, that is a repeated pattern and the v24 candidate becomes: a **scheduled re-look gate on every crash-day No Trade** — "a knife gets no opinion until it stops falling" must carry the level at which it has provably stopped falling (PODD's row did: 138.41 first test; BRKR and PLTR carried none), logged in the `trigger` field so the pass expires instead of lasting forever. Micro-version of this is adoptable now as logging discipline without a framework change.

## Housekeeping surfaced by the audit
- `book-check.mjs`: **$PLUG (8/11)** and **$CSCO (8/12)** appear in posted content with no book row — Adam to confirm whether either was a call; log or dismiss.
- Grades on recent rows remain null where the full framework didn't run — correct per the rule, noted for completeness.

## Verdict
The scored book does **not** show v23 missing more wins than it catches — it shows a 60% hit rate whose errors are **100%-concentrated on the miss side in the last two weeks** (4 of 5 recent wrongs). The response that keeps discipline intact: fix the measurement layer (C1), codify the guide-outranks-print rule the data just promoted (C2), and let the 30-day prints decide the crash-bounce question (C3) instead of rewriting entry gates on one week of bounce data. No risk gate is loosened by any of these.
