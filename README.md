# THE BENCH

The private source of truth for **@TheBenchTrades**: the v23 research framework,
append-only trade book, challenge ledger, scoring tools, and Windows desktop
workstation.

> **Keep this repository private.** It contains prompt IP, open research calls,
> levels, and account-history context.

## Desktop app — v0.3.0

The Windows app is a research workstation, not a broker terminal. It provides:

- a fixed decision desk with the current book loaded from `db/archive.json`;
- row-level thesis, trigger, invalidation, source, and as-of evidence;
- the append-only $10K challenge scoreboard from `db/challenge.json`;
- a tamper-evident local audit trail;
- real v23 → Marquee report runs with visible progress and loud failures;
- local Claude/OpenAI key storage; and
- an explicit research-only boundary. There is no order route and no posting tool.

The current installer is built locally as `dist/The-Bench-Setup-0.3.0.exe`.
GitHub Releases may lag the source; do not claim v0.3.0 is published until a
release asset is uploaded and verified.

## Engines

1. **THE BENCH v23** decides what the available evidence supports.
2. **MARQUEE v3.1** turns a verified verdict into a reviewable draft.

The app analyzes and drafts. Adam executes trades outside the app. Public
posting is handled by the separate X Poster project, not by this desktop app.

## Key paths

```text
prompts/trading-copilot-v23.md  current analysis framework
prompts/marquee-v3.1.md         writing engine
db/archive.json                 append-only research book
db/challenge.json               append-only challenge ledger
public/                         desktop workstation UI
server/reviewer.js              real report chain
server/mcp.js                   research-only MCP boundary
docs/APP-SPEC.md                v0.3 workstation contract
docs/EXECUTION.md               capability and connection boundary
```

## Development

```powershell
npm test
npm run start
npm run app
npm run dist:win
```

`npm run start` binds the local backend to `127.0.0.1:8137`. State-changing
research runs use POST routes; data reads use GET routes. API responses do not
send wildcard CORS headers.

*Proof, not hype.*
