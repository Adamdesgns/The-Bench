# THE BENCH

Daily market-report pipeline for **@TheBenchTrades**. Two model calls, chained:

1. **THE BENCH v17** — analysis engine. Live data packet in, structured JSON
   verdict out. Decides *what is true*.
2. **MARQUEE v3.1** — writing engine. v17's JSON in, magazine-style long-form
   article out. Decides *how it is told*.

**The system drafts. A human publishes. That line is a hard requirement.**
The chain ends at `present`, never `post`. No brokerage or X credentials live
in this repo, ever.

> **Make this repo PRIVATE.** It holds an open trading book, position triggers,
> and prompt IP.

## Start here

- `docs/REPO-HANDOFF.md` — repo structure + security (read first).
- `docs/daily-open-chain-spec.md` — the build blueprint. Implement literally.
- `docs/HANDOFF-code.md` — runner build notes + known issues.
- `docs/SESSION-HANDOFF.md` — full brand/context restore.
- `docs/the-bench-brand.md` — color, type, boilerplate.

## Layout

```
prompts/    v17 (operating) + marquee-v3.1 + archive/ (v1–v16, rollback only)
docs/       specs, handoffs, brand
server/     dataProviders · indicators · reviewer (the chain) · reviewSchema · lint
public/     dashboards (console, desk, archive-mobile)
db/         archive.json (the book, source of truth) + archive-v4.xlsx (export)
scripts/    seed-archive.js
```

## The pipeline (`server/reviewer.js`)

```
loadArchive(db/archive.json)          // read the live board, never assume it
  → fetchDataPacket(board)            // price EVERY open row + peers + macro + crypto
  → callBench(v17, packet)            // structured JSON verdict
  → reconcileArchive(bench.board)     // close/open/update rows; write archive.json
  → renderArchiveBlock()              // the printed ▦ ARCHIVE — RECONCILED section
  → selectAngle(bench.narrative_vs_evidence_gaps)
  → callMarquee(marquee, bench + archiveBlock, angle)
  → lint(article)                     // char count, em-dash cap, banned phrases
  → present(research + archiveBlock + article)   // NEVER post
```

Cron: `15 9 * * 1-5` ET, guarded for US market holidays. Any unfetchable value
passes through as the literal string `"not observable"` — never omit, never
guess. If `reconcileArchive` fails: halt and report; do not write an article
against an unreconciled board.

## Setup

```bash
cp .env.example .env      # set OPENAI_API_KEY and/or ANTHROPIC_API_KEY (+ optional ALPHAVANTAGE_KEY)
npm install
npm run seed              # validate db/archive.json
npm run run:mock          # run the FULL chain offline (stubbed data + model) — no keys, no network
npm run run:market        # run live (needs a model key + network)
node server/index.js      # local backend: /api/run?mock=1 · /api/archive  (never posts)
```

### Providers — you can use either key, or both

The runner works with **OpenAI or Anthropic**. Set the keys you have, then pick
which provider runs each step (defaults to whichever key is present):

```
MODEL_PROVIDER=anthropic     # default for both steps
BENCH_PROVIDER=anthropic     # v17 analysis on Claude...
MARQUEE_PROVIDER=openai      # ...Marquee writing on GPT (mix freely)
```

Each archive row the runner produces is tagged with its engine
(`gpt-runner` for OpenAI, `claude` for Anthropic) so calibration stays honest.

## Status

**In place:** real v17 + Marquee v3.1 prompts; authoritative book
(`db/archive.json` from `db/archive-v4.xlsx`, 22 rows, validated); **the full
runner** — `server/` chain (data layer with AV budget + Stooq fallback,
indicators, dual-provider model layer, archive reconcile with write-lock,
deterministic angle selection + No-Story Rule, post-gen lint, local backend).
Runs end-to-end offline via `npm run run:mock`.

**Not yet wired:** `public/` dashboards (console, desk, archive-mobile) and the
v1–v16 prompt history in `prompts/archive/`.

*Proof, not hype.*
