# THE BENCH — REPO HANDOFF

Everything needed to stand up `the-bench` as a GitHub repo and continue the build. Written for a developer or coding agent picking this up cold.

**Make the repo PRIVATE.** It contains an open trading book, position triggers, and prompt IP. Nothing here should be public until you decide otherwise.

---

## 1. WHAT THIS PROJECT IS

A research system that produces one market report per trading day for a public trading-research brand (@TheBenchTrades).

Two model calls, chained:

1. **THE BENCH v17** — analysis engine. Live data packet in, structured JSON verdict out. Decides *what is true*.
2. **MARQUEE v3.1** — writing engine. v17's JSON in, magazine-style long-form article out. Decides *how it is told*.

Around that: a live data layer, an append-only archive of every call, and dashboards to view it.

**The system drafts. A human publishes. That line is a hard requirement, not a preference.**

---

## 2. PROPOSED REPO STRUCTURE

```
the-bench/
├── README.md                     # start here; points at docs/
├── .gitignore                    # MUST cover .env, db/*.json backups
├── .env.example                  # key names only, never values
├── package.json
│
├── prompts/
│   ├── trading-copilot-v17.md    # THE OPERATING VERSION — load this one
│   ├── marquee-v3.1.md           # writing engine
│   └── archive/                  # v1–v16, frozen, for rollback only
│       └── trading-copilot-v1..v16.md
│
├── docs/
│   ├── REPO-HANDOFF.md           # this file
│   ├── HANDOFF-code.md           # runner-specific build notes + known issues
│   ├── daily-open-chain-spec.md  # THE BUILD BLUEPRINT — implement literally
│   └── the-bench-brand.md        # colors, type, voice, boilerplate
│
├── server/
│   ├── index.js                  # local API/backend
│   ├── dataProviders.js          # Alpha Vantage + Stooq fallback
│   ├── indicators.js             # SMA, EMA, RSI, MACD, trend structure
│   ├── reviewer.js               # THE CHAIN: bench → reconcile → marquee
│   ├── benchPrompt.js            # loads prompts/trading-copilot-v17.md
│   ├── reviewSchema.js           # structured-output JSON schema
│   └── lint.js                   # NEW: post-generation house-style checks
│
├── public/
│   ├── index.html                # runner dashboard
│   ├── console.html              # v17 run console (6 panels, one per run type)
│   ├── desk.html                 # Anvil-style market desk (catalysts, board)
│   └── archive-mobile.html       # phone ledger view
│
├── db/
│   ├── archive.json              # THE BOOK — append-only source of truth
│   └── archive-v3.xlsx           # human/dashboard export
│
└── scripts/
    └── seed-archive.js           # one-time: load B-001..B-022 into archive.json
```

---

## 3. FILE MAP — WHAT EXISTS TODAY

| File | Goes to | Role |
|---|---|---|
| `trading-copilot-v17.md` | `prompts/` | **The only prompt version to load.** |
| `trading-copilot-v1..v16.md` | `prompts/archive/` | History. Never loaded. Rollback only. |
| `marquee-v3.1.md` | `prompts/` | Writing engine, six-part output format. |
| `daily-open-chain-spec.md` | `docs/` | Data packet shape, JSON contract, angle selection, §2.5 archive reconcile block, cron. **Implement literally.** |
| `HANDOFF-code.md` | `docs/` | Runner build notes, 7 known issues, fastest-path-to-green. |
| `the-bench-brand.md` | `docs/` | Exact hex tokens, type, devices, boilerplate strings. |
| `the-bench-archive-v3.xlsx` | `db/` | 22-row ledger, 1 closed. Human view. |
| `bench-v17-console.html` | `public/console.html` | Run-output view. Every value carries `data-field` matching the chain-spec JSON. |
| `bench-anvil-desk.html` | `public/desk.html` | Market view: catalyst countdowns, open board, peer check, macro. |
| `bench-archive-mobile.html` | `public/archive-mobile.html` | Phone ledger, card per call. |
| `the-bench-brand.md` + PDFs/HTML templates | `docs/` or `assets/` | Research-note templates, prior issues. |

---

## 4. SECURITY — DO THIS BEFORE FIRST COMMIT

1. `.gitignore` must contain, at minimum:
   ```
   .env
   .env.*
   !.env.example
   node_modules/
   db/*.backup.json
   ```
2. `.env.example` ships key **names** only: `OPENAI_API_KEY=`, `ALPHAVANTAGE_KEY=`.
3. **No brokerage credentials in this repo, ever.** The system never places trades and never logs into a broker. If that changes, it goes in a separate, separately-permissioned service.
4. **No X/Twitter credentials.** Publishing is manual by design.
5. Run `git log -p | grep -i -E "sk-|api[_-]?key"` before making the repo accessible to anyone else.

---

## 5. THE PIPELINE (implement in this order)

From `docs/daily-open-chain-spec.md`:

```
loadArchive(db/archive.json)           // the live board — read it, never assume
  → fetchDataPacket(board)             // price EVERY open row + peers + macro + crypto
  → callBench(v17, packet)             // structured JSON verdict
  → reconcileArchive(bench.board)      // close/open/update rows; write archive.json
  → renderArchiveBlock()               // printed ▦ ARCHIVE — RECONCILED section
  → selectAngle(bench.narrative_vs_evidence_gaps)
  → callMarquee(marquee, bench + archiveBlock, angle)
  → lint(article)                      // char count, em-dash cap, banned phrases
  → present(research + archiveBlock + article)   // NEVER post
```

- Cron: `15 9 * * 1-5` ET, guarded for US market holidays.
- Any unfetchable value passes through as the literal string `"not observable"`. Never omit, never guess.
- If `reconcileArchive` fails: **halt and report.** Do not write an article against an unreconciled board.

---

## 6. KNOWN ISSUES (fix before the 50-run battle test)

Full detail in `docs/HANDOFF-code.md`. Ranked:

1. **Add `not_observable` to the response schema** — required field. Without it the model silently produces fake-complete verdicts.
2. **Archive-ID collision** — xlsx holds B-001..B-022; `archive.json` starts empty. Seed it (`scripts/seed-archive.js`) or prefix runner rows `A-###`. Never invent an ID; write `Pending Archive ID` if the sequence isn't visible.
3. **Engine tag on every row** — `engine: "gpt-runner" | "claude" | "manual"`. Calibration buckets are only honest if models are separable. Existing 22 rows are `claude`.
4. **Alpha Vantage free tier = 25 calls/day.** A 50-name queue blows it on run one and silently degrades to Stooq. Throttle or budget explicitly; keep the delayed/provisional labeling.
5. **No write-locking on `db/archive.json`.** Serialize runs or add a lock.

---

## 7. POST-GENERATION LINT (`server/lint.js`)

Cheap checks that enforce house style. All are hard flags:

- Article body **≤ 3,900 characters** (X enforces 4,000; count in code, don't trust the model).
- **Em dashes ≤ 2** in body. Overuse is the tell; prefer periods and colons.
- **No `---` divider lines** in body.
- **No numbered-thread patterns** (`1/`, `2/`). Long-form only.
- **Banned phrases** (list lives in `marquee-v3.1.md`): delve, tapestry, testament to, navigate the landscape, game-changer, unlock, it's worth noting, at the end of the day, in today's fast-paced world, let's dive in.
- **Boilerplate present:** ends with `Proof, not hype.` / `@TheBenchTrades` / `Not financial advice. Educational only.`

---

## 8. THE ARCHIVE CONTRACT

One row per review. Append-only. Row shape:

```json
{
  "id": "B-022",
  "date": "2026-07-20",
  "ticker": "GOOGL",
  "review_price": 354.46,
  "review_time": "2026-07-20T09:15:00-04:00",
  "opportunity_score": 74,
  "confidence_pct": 70,
  "grades": {"technical":"B+","fundamental":"A","execution":"C","overall":"B-"},
  "fomo": "Heating Up",
  "market_risk": 3,
  "final_call": "Setup Forming — earnings gate Jul 22",
  "hodl": "Accumulate",
  "trigger": "hold above pre-print close on volume",
  "invalidation": "",
  "outcome": null,
  "outcome_price": null,
  "pct_move": null,
  "lesson": null,
  "grade_verdict": null,
  "engine": "claude",
  "not_observable": []
}
```

Closing a row requires all four: `outcome`, `outcome_price`, `pct_move` (from review_price), `lesson`. Plus `grade_verdict`: vindicated or wrong.

Calibration is **aggregate only** — never judge a single call by its outcome. Buckets become meaningful around 30 closed rows.

---

## 9. CURRENT STATE OF THE BOOK (as of Jul 22, 2026)

- **22 rows. 1 closed** (B-004 MU, Loss, −11.3%, stopped at the pre-defined level).
- **Live triggers:** B-022 GOOGL (earnings gate tonight, reaction decides Thursday) · B-019 PENG ($70–71 reclaim) · B-010 MU ($950 on volume) · B-017 HYPE (>$77) · B-021 NBIS ($200–203) · B-009 LMT ($540) · B-005–008 energy hedges active.
- **Framework:** v17, feature-frozen. Three independent reviews converged: the architecture is done; the next edge is 50–100 closed rows, not another version.

---

## 10. FIRST FIVE COMMITS

1. `init: repo structure, .gitignore, .env.example, README`
2. `docs: chain spec, code handoff, brand file`
3. `prompts: v17 + marquee, v1–v16 archived`
4. `feat: seed archive.json with B-001..B-022 + engine tags`
5. `feat: not_observable schema field + post-gen lint`

Then run **one** ticker end-to-end and diff the output against a known-good manual run (B-021 NBIS or B-022 GOOGL) before pointing it at the queue.

---

*Proof, not hype.*
