# THE BENCH

The private source of truth for **@TheBenchTrades**: the v23 research framework,
append-only trade book, challenge ledger, scoring tools, and Windows desktop
workstation.

> **Keep this repository private.** It contains prompt IP, open research calls,
> levels, and account-history context.

## Report workstation — v0.5.0

The Windows app is a research workstation, not a broker terminal. It provides:

- a fixed decision desk with the current book loaded from `db/archive.json`;
- a generate-first workflow for ticker and full-market investigations;
- real backend progress with one active local report job at a time;
- immutable saved report snapshots and a searchable report library;
- immersive report rooms with deep-dive sections and a source/as-of ledger;
- automatic, dependency-free PDF rendering and repeatable downloads;
- row-level thesis, trigger, invalidation, source, and as-of evidence;
- the append-only $10K challenge scoreboard from `db/challenge.json`;
- a tamper-evident local audit trail;
- real v23 → Marquee report runs with visible progress and loud failures;
- local Claude/OpenAI key storage; and
- an explicit research-only boundary. There is no order route and no posting tool.

The current desktop installer is built locally as `dist/The-Bench-Setup-0.5.0.exe`.
GitHub Releases may lag the source; do not claim v0.5.0 is published until a
release asset is uploaded and verified.

v0.4 is a complete local report product, but it is **not a public multi-user
service yet**. The backend remains loopback-only. Public hosting requires
managed authentication, tenant-isolated database/object storage, durable jobs,
and per-user cost limits before the bind address changes.

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
server/reportStore.js           immutable local report persistence
server/reportPdf.js             portable PDF renderer
server/mcp.js                   research-only MCP boundary
docs/APP-SPEC.md                v0.5 workstation and web beta contract
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

Generated report JSON and PDF files live under `BENCH_RUNTIME_DATA_DIR` when
set. Development defaults to ignored `db/runtime/`; Electron uses the Windows
application-data directory so installed reports survive application updates.

*Proof, not hype.*

## Invite-only web beta

v0.5 adds a separate hosted server (`npm run start:web`) backed by Supabase Auth, owner-scoped Postgres rows, a durable leased job queue, and private PDF Storage. The browser receives only Generate, Library, and Report Room. Adam's archive, challenge ledger, audit log, model-key settings, and local run routes do not exist on the hosted server.

The beta is ticker-only until a licensed multi-user market-data feed is selected. See `docs/WEB-BETA.md` for the deployment and verification gates. The code is deployable, but no public service or Supabase project is implied by a local build.