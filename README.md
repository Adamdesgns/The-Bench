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
db/         archive.json (the book, source of truth) + archive-v3.xlsx (export)
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
cp .env.example .env      # fill in OPENAI_API_KEY (+ optional ALPHAVANTAGE_KEY)
npm install
npm run seed              # validate db/archive.json
node server/lint.js path/to/article.txt   # house-style check
```

## Status

Scaffold + provisional archive seed in place. **Not yet wired:** real v17 /
Marquee prompts (stubs in `prompts/`), `server/` runner code (dataProviders,
indicators, reviewer, index), `public/` dashboards, and the authoritative
`db/archive-v3.xlsx`. `db/archive.json` is a provisional hand-seed from the
handoff — re-seed from the real xlsx via
`node scripts/seed-archive.js --from-xlsx db/archive-v3.xlsx`.

*Proof, not hype.*
