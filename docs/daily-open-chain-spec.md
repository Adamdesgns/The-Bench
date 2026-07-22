# THE DAILY OPEN — CHAIN SPEC v1
**The two-step pipeline that produces the daily market report.**
`THE BENCH v17` decides what is true → `MARQUEE v3.1` decides how it is told.

Files this depends on (all canonical in `/outputs`):
- `trading-copilot-v17.md` — the analysis engine
- `marquee-v3.1.md` — the writing engine
- `the-bench-brand.md` — visual/voice tokens for the hero image + house style
- `the-bench-archive-v3.xlsx` / `db/archive.json` — the open board

---

## 0. SCHEDULE

- **Trigger:** 9:15 AM ET, Mon–Fri (15 min before the open — Asia has closed, futures are live, the report lands *before* the bell, not after).
- **Skip conditions:** US market holiday → skip. Half-day → run normally.
- **Weekend variant (optional):** Saturday 9:00 AM ET → same chain, but the ANGLE is a week-wrap and the Global Peer Check reads Friday's closes.

---

## STEP 1 — THE BENCH v17 (analysis)

**System prompt:** full contents of `trading-copilot-v17.md`
**Mode flag:** `Research / Battle-Test Mode` = ON (skips the account-size questions; sizing renders as "research-only — sizing pending user settings")

### Data packet to assemble BEFORE the call
Every field is fetched live. Anything that can't be fetched is passed through as the literal string `"not observable"` — never omitted, never guessed. (v17 Data Integrity rule.)

```json
{
  "review_stamp": "2026-07-13T09:15:00-04:00",
  "global_peer_check": {
    "kospi": {"close_pct": null, "note": ""},
    "samsung_005930": {"close_pct": null},
    "sk_hynix_000660": {"close_pct": null},
    "skhy_adr": {"last": null, "pct": null},
    "nikkei": {"close_pct": null},
    "tsmc": {"close_pct": null},
    "asml": {"close_pct": null}
  },
  "us_futures": {"es": null, "nq": null, "ym": null},
  "macro": {
    "wti": null, "brent": null,
    "us10y": null, "dxy": null, "vix": null,
    "gold": null
  },
  "crypto": {"btc": null, "eth": null, "btc_etf_flow_last": null},
  "open_board": [
    {"id": "B-010", "ticker": "MU",   "state": "No Trade",  "trigger": "reclaim + hold $950 on real volume", "invalidation": "", "last": null},
    {"id": "B-019", "ticker": "PENG", "state": "Armed",     "trigger": "hold mid-$60s + reclaim $70–71",     "invalidation": "", "last": null},
    {"id": "B-017", "ticker": "HYPE", "state": "Watchlist",  "trigger": "> $77 breakout",                     "invalidation": "< $52 structure", "last": null},
    {"id": "B-009", "ticker": "LMT",  "state": "Watchlist",  "trigger": "reclaim $540",                       "invalidation": "< $508", "last": null},
    {"id": "B-005..B-008", "ticker": "XOM/CVX/COP/OXY", "state": "Hedge — active", "trigger": "crude bases 2 wks", "invalidation": "", "last": null}
  ],
  "standing_assumptions": [
    "Correction is rotational, not systemic — invalidated if broad breadth cracks with semis",
    "No hawkish shock before FOMC (Jul 28–29) — strained by any crude/yield spike",
    "MU scarcity premium is permanently gone post-SKHY listing (structural, logged Jul 10)",
    "Memory weakness was IPO-supply-driven — final leg resolves ~Jul 15 repatriation"
  ],
  "calendar_next_10d": [],
  "headlines_overnight": []
}
```

### Required output from Step 1 (structured JSON — this is Marquee's raw material)

```json
{
  "review_stamp": "",
  "regime": "Risk-On | Neutral | Risk-Off",
  "market_risk": 1,
  "global_peer_read": "one paragraph — what Asia's close forecasts for the US open",
  "us_read": "one paragraph — futures, sector leadership, what's actually bid",
  "crypto_read": "one paragraph — or 'not verified this hour'",
  "board": [{"id":"", "ticker":"", "state":"", "action":"", "note":""}],
  "assumption_ledger": [{"assumption":"", "status":"intact | strained | broken", "why":""}],
  "calendar": [{"date":"", "event":"", "why_it_matters":""}],
  "narrative_vs_evidence_gaps": [
    {"gap":"", "consensus_says":"", "tape_says":"", "strength": 1}
  ],
  "not_observable": []
}
```

**The `narrative_vs_evidence_gaps` array is the critical field.** It is the bridge to Marquee. Each entry names what the crowd believes and what the tape is actually doing, scored 1–5 on how wide the gap is. If the array is empty, see §4 (No-Story Rule).

---

## STEP 2 — MARQUEE v3.1 (writing)

**System prompt:** full contents of `marquee-v3.1.md`

**User message — the three inputs, assembled from Step 1's JSON:**

```
MATERIAL:
<paste the complete Step 1 JSON, verbatim>

Additional context:
- Brand tokens for the hero image: [paste §3 + §5 of the-bench-brand.md]
- Standing rule: the article must be ≤3,900 characters (X compose limit is
  enforcing 4,000; verify the count before returning).
- Every number in the article must appear in MATERIAL. If it is not in
  MATERIAL, it does not go in the article. Anything in `not_observable`
  must be labeled as unverified or omitted entirely.

ANGLE / THESIS:
<the highest-`strength` entry from narrative_vs_evidence_gaps, written as a
one-sentence thesis in The Bench's voice>

LENGTH:
600–650 words (≈3,600–3,900 characters).
```

### Angle selection logic (deterministic — no improvisation)
1. Take the entry from `narrative_vs_evidence_gaps` with the highest `strength`.
2. **Tie-break, in order:** (a) a gap involving an *open board position* wins — the report should earn its keep on our own money first; (b) a gap tied to a *dated calendar event within 10 days* wins next — it gives the reader a resolution date; (c) otherwise, take the first entry.
3. Write it as one sentence: *"Consensus believes X; the tape is doing Y; that gap is the story."* That sentence becomes ANGLE.

---

## 2.5 — THE ARCHIVE UPDATE (mandatory, and it is *shown*)

**The archive is not a background side-effect. It is a visible section of every run, printed before the article.** If the board isn't reconciled, the report isn't finished.

Every daily run ends Step 1 by walking the entire open board — every row, no exceptions — and printing this block:

```
▦ ARCHIVE — RECONCILED [timestamp]

OPEN ROWS
B-###  TICKER   Review $   Last $   State        Trigger              Δ since last run
...one line per open row, every row, even if nothing changed...

CHANGED TODAY
- B-###  <trigger fired | invalidation broke | state change | assumption broken>
         → action taken: <row closed / state updated / new row opened>

CLOSED TODAY
B-###  TICKER   Outcome: Win/Loss/Scratch   Review $ → Outcome $   % move
       Lesson: <one honest line>
       Grade verdict: vindicated / wrong

NEW ROWS
B-###  TICKER   Review $ / time   Score   Grades   Final Call   HODL   Confidence %

NO CHANGE: <list of row IDs that are unchanged — say so explicitly, never silently>
```

**Rules for the archive step:**
- **Every open row is priced every run.** A row with no fresh print is marked `unverified` — never carried forward on a stale number. (v17 Data Integrity: stale levels are dead levels.)
- **A trigger firing or an invalidation breaking is an event.** It closes or opens a row that same run — not "we'll log it later."
- **Closing a row requires all four:** Outcome, Outcome Price, % move from Review Price, and one honest Lesson line. Plus the verdict on whether the original grade was vindicated or wrong.
- **New rows get a Trade ID from the live archive.** If the sequence isn't visible to the runner, the row is marked `Pending Archive ID` — never invented. (v17 rule.)
- **Engine tag on every row:** `engine: "gpt-runner" | "claude" | "manual"` so calibration buckets stay honest across sources.
- **The written record updates too** — `db/archive.json` first (machine), then the xlsx on demand (human). The JSON is the source of truth for the runner; the spreadsheet is the source of truth for the dashboard.
- **The archive block is included in the MATERIAL handed to Marquee** — so the article can reference what actually changed on the board today, which is usually the most honest story available.

---

## 3. THE OUTPUT

Every run produces, in this order:
1. **The research block** (Step 1)
2. **The Archive — Reconciled block** (§2.5) — always shown, even when nothing changed
3. **The article** (Step 2), or the No-Story caption

Marquee returns its full six-part format. What gets used:
- **Headline** → the X Article title (pick from the three; the Provocative one is usually right for the timeline, the Straight one for a technical/heavy-data day).
- **Dek** → the article subtitle.
- **Hero image concept** → hand to Claude Design / Canva with `the-bench-brand.md`.
- **The Article** → the post itself. **Verify ≤3,900 characters before publishing.**
- **Pull quotes** → reply-thread material or graphics.
- **Companion X post** → the standalone teaser if the article is scheduled for later.

Every piece closes with the standing boilerplate: `Proof, not hype. / @TheBenchTrades / Not financial advice. Educational only.`

---

## 4. GUARDRAILS (the parts that keep this from producing garbage daily)

**The No-Story Rule.** Some mornings the tape has nothing to say. If `narrative_vs_evidence_gaps` is empty, or the highest strength is ≤2, **do not force an article.** Marquee's own doctrine: *"If there is no gap, there is no article."* On those days the pipeline returns the Step 1 research block only, and the report is captioned *"No story today — the board is unchanged."* A daily cadence that manufactures a narrative on quiet days will destroy the brand faster than skipping a day ever could.

**Data Integrity is inherited, not re-decided.** Step 2 may not introduce a single number that isn't in MATERIAL. The `not_observable` array is passed through and must be honored — a labeled gap is honest; a fabricated fill is fatal.

**Human review before publish. Always.** The chain ends by *presenting* the article, never by posting it. Every scar this account has taken (the $864 print, the PENG ticker collision) was caught by a human reading the output before it went live. Automate the drafting; never automate the publishing.

**Archive discipline.** If Step 1 changes a board state (a trigger fires, an invalidation breaks), that writes a new Archive row or closes an existing one — with a **Review Price and timestamp**. Auto-generated rows are tagged with the engine that produced them (`engine: "gpt-runner"` vs `engine: "claude"`) so the calibration buckets stay honest.

**Repetition check.** Before publishing, compare today's ANGLE to the last 5 days. If it's the same gap, the article must advance the story (new evidence, resolution, or invalidation) — not restate it. The archive is the memory; use it.

---

## 5. IMPLEMENTATION

**In the auto-runner** (`reviewer.js`): one additional model call, and the archive reconcile runs *before* the writer so the article can cite it.
```
loadArchive(db/archive.json)          // the live board — never assume it
  → fetchDataPacket(board)            // prices EVERY open row, not just the day's names
  → callBench(v17, packet)            // → benchJSON (incl. board deltas)
  → reconcileArchive(benchJSON.board) // closes/opens/updates rows; writes db/archive.json
  → renderArchiveBlock()              // the printed ▦ ARCHIVE — RECONCILED section
  → selectAngle(benchJSON.narrative_vs_evidence_gaps)
  → callMarquee(marquee31, benchJSON + archiveBlock, angle)
  → present(research + archiveBlock + article)   // never post
```
Cron: `15 9 * * 1-5` (ET, guard for market holidays).

**Failure mode to guard against:** if `reconcileArchive` throws or the archive file can't be written, **the run halts and reports the failure** — it does not proceed to the article. A report published against an unreconciled board is worse than no report, because it states positions that may no longer exist.

**In Cowork:** one scheduled task, two prompt files attached, same order. Output lands as a draft for review.

**Manual fallback (works today):** send `run the market` at the open → the research block and the article come back in one turn. Same chain, human-triggered.

---

*Proof, not hype.*
