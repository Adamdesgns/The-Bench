# THE BENCH — DEVELOPER HANDOFF NOTE
*For whoever (or whatever) builds the auto-runner. Read this before touching code.*

---

## WHAT THIS SYSTEM IS

A daily pipeline that produces one market report for @TheBenchTrades. Two model calls, chained:

1. **THE BENCH v17** — the analysis engine. Takes a live data packet, returns a structured verdict as JSON. Decides *what is true*.
2. **MARQUEE v3.1** — the writing engine. Takes v17's JSON, returns a magazine-style X article. Decides *how it's told*.

The human triggers or reviews; the code fetches data, runs the chain, reconciles the archive, and **presents** the output. **The code never posts.** That line is not negotiable — see Guardrails.

---

## CANONICAL FILES (source of truth — all in this folder)

| File | Role | Notes |
|---|---|---|
| `trading-copilot-v17.md` | Analysis prompt (system) | The ONLY version to load. v1–v16 are history, kept for rollback. Never load an older one. |
| `marquee-v3.1.md` | Writing prompt (system) | Full six-part output format lives here. |
| `daily-open-chain-spec.md` | The pipeline spec | Data-packet shape, JSON contract, angle-selection logic, the §2.5 archive-reconcile block, cron. **This is the build blueprint — implement it literally.** |
| `the-bench-brand.md` | Design tokens + voice | Feed §3 (color) + §5 (devices) to any image/asset step. Hex values are exact. |
| `the-bench-archive-v3.xlsx` | The human-facing ledger | Current dashboard. 19 rows through B-021. |
| `bench-archive-mobile.html` | Read-only mobile view | Regenerated on request, not live. |

If a file's content and this note ever disagree, the file wins — but flag it.

---

## WHAT THE CODE MUST DO (in order)

Per `daily-open-chain-spec.md` §5, the loop is:

```
loadArchive(db/archive.json)          // the live board — read it, never assume it
  → fetchDataPacket(board)            // price EVERY open row + peers + macro + crypto
  → callBench(v17, packet)            // → structured JSON verdict
  → reconcileArchive(bench.board)     // close/open/update rows; write db/archive.json
  → renderArchiveBlock()              // the printed ▦ ARCHIVE — RECONCILED section
  → selectAngle(bench.narrative_vs_evidence_gaps)   // highest strength; tie-break per spec
  → callMarquee(marquee, bench + archiveBlock, angle)
  → present(research + archiveBlock + article)      // NEVER post
```

- Schedule: `15 9 * * 1-5` ET, guarded for US market holidays.
- Every fetched value that fails → pass the literal string `"not observable"`. Never omit, never guess. (v17 Data Integrity.)
- If `reconcileArchive` throws or can't write → **halt and report. Do not write an article** against an unreconciled board.

---

## KNOWN ISSUES TO FIX BEFORE THE 50-RUN BATTLE TEST

These are real, found in review of the first MVP. Fix them or the archive it produces will need cleaning.

1. **Archive-ID collision.** Two archives exist: the xlsx (B-001…B-021) and `db/archive.json`. If the runner mints its own B-numbers it will double up. **Fix:** seed `archive.json` with the existing 21 rows, OR give runner rows their own prefix (`A-001`…) until a merge step reconciles them. Never invent a Trade ID — if the sequence isn't visible, write `Pending Archive ID`.

2. **Schema needs a `not_observable` field.** v17 requires unverifiable inputs (13F trends, block prints, whale flows, exact ARR multiples) to be *labeled*, not dropped. If the JSON schema has no home for "we couldn't verify this," the model will silently produce fake-complete verdicts — the exact failure v15's Data Integrity rule exists to kill. Add the field; make it required.

3. **Engine tag on every row.** Add `engine: "gpt-runner" | "claude" | "manual"` to each archive row. The calibration buckets (confidence % vs. actual win rate) are only honest if you can separate which model produced which call. The existing 21 rows were `claude`.

4. **Alpha Vantage free tier = 25 calls/day.** A 50-name queue with multiple endpoints per name blows the cap on run one, then silently degrades everything to Stooq. Either throttle the queue across days or budget the calls explicitly. Label any Stooq-sourced number as delayed/provisional (the MVP already does this — keep it).

5. **`db/archive.json` has no write-locking.** Don't run batch + single simultaneously or concurrent writes clobber. Add a lock or serialize runs.

6. **Secrets hygiene.** `.env` holds `OPENAI_API_KEY` (+ optional `ALPHAVANTAGE_KEY`). Confirm `.gitignore` covers `.env` before this touches any repo. Never hardcode keys.

7. **Technicals ≠ the whole verdict.** The indicators module (SMA/EMA/RSI/MACD from price) covers Lens 1. It cannot compute Lens 2 (insider filings, ETF flows, short interest, analyst targets, the Global Peer Check, catalysts, earnings dates). Those must come from other sources or be passed as `"not observable"` — do not let a price-only packet produce a confident full-scorecard verdict.

---

## GUARDRAILS (these are product requirements, not nice-to-haves)

- **The chain ends at `present`, never `post`.** Every public mistake this account could make is caught by a human reading the draft. Automate drafting; never automate publishing.
- **No-Story Rule.** If `narrative_vs_evidence_gaps` is empty or the top gap's `strength ≤ 2`, do NOT force an article. Return the research block only, captioned "No story today — the board is unchanged." A daily cadence that manufactures narrative on quiet days kills the brand faster than skipping.
- **Data Integrity is inherited by Marquee.** Step 2 may not introduce any number that isn't in the Step 1 JSON. Pass `not_observable` through and honor it.
- **Char limit.** Articles must verify **≤ 3,900 characters** before returning (X compose enforces 4,000; leave buffer). Count in code, don't trust the model's estimate.
- **Repetition check.** Compare today's angle to the last 5 days; if it's the same gap, the piece must ADVANCE the story (new evidence / resolution / invalidation), not restate it.

---

## HOUSE-STYLE RULES THE WRITER MUST ENFORCE (post-generation lint)

Cheap regex checks worth adding after Marquee returns:

- **Em-dash cap:** flag if the article body uses more than ~1–2 em dashes (`—`). Overuse is an AI tell; the house style prefers periods and colons.
- **No divider lines** (`---`) inside article body.
- **Banned phrases** (from `marquee-v3.1.md`): "delve," "tapestry," "testament to," "navigate the landscape," "game-changer," "unlock," "it's worth noting," "at the end of the day," "in today's fast-paced world," "let's dive in." Flag any hit.
- **Boilerplate present:** must end with `Proof, not hype.` / `@TheBenchTrades` / `Not financial advice. Educational only.`
- **No numbered threads.** Long-form article only. No "1/", "2/" patterns.

---

## OUTPUT CONTRACT (what a run returns)

Every run returns, in this order:
1. The v17 research block (structured).
2. The **▦ ARCHIVE — RECONCILED** block (always shown, even if nothing changed — name the unchanged rows explicitly).
3. The Marquee six-part output: 3 headlines · dek · hero image concept · article (≤3,900 chars) · 3 pull quotes · companion post — **OR** the No-Story caption.

Everything is delivered for human review. Nothing auto-publishes.

---

## FASTEST PATH TO GREEN

1. Wire `not_observable` into the schema (issue #2) — highest leverage, prevents fake verdicts.
2. Seed `archive.json` with the 21 existing rows + engine tags (issues #1, #3).
3. Add the post-gen lint (char count + em-dash + banned phrases + boilerplate).
4. Run ONE ticker end-to-end, eyeball the JSON and the article against a known-good manual run (e.g. NBIS / B-021).
5. Only then point it at the 50-name queue, throttled for the Alpha Vantage cap.

The next real edge is not more code. It's 50–100 closed archive rows feeding the calibration buckets. Build the thing that lets rows close cleanly, then get out of its way.

*Proof, not hype.*
