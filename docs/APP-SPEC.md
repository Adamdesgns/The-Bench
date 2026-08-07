# THE BENCH — APP SPEC v0.4

## Product definition

The Bench is Adam's local Windows report workstation for the v23 framework and
the working foundation for a future authenticated web product.
It helps answer one question quickly and honestly: **what does the evidence
support right now?**

The app analyzes, reconciles, records, and drafts. It does not execute trades
or publish content.

## Interface contract — institutional workstation

The v0.4 shell is a fixed, dense workspace. It deliberately retires the
macOS-window metaphor, draggable panels, traffic lights, ticker crawl, and
bottom dock.

### Persistent shell

- Top status rail: framework version, research-only mode, loaded book count,
  data state, and CT/ET clocks.
- Left navigation rail: Generate, Library, Desk, Book, Audit, and Settings.
- Bottom disclosure rail: version, account, educational disclaimer, and latest
  book date.
- Graphite/ink base with restrained brass accents. Red is reserved for losses,
  broken integrity, and unavailable model paths. No green.

### Desk

- One real report command bar. No simulated step log.
- Open/closed/all book filters.
- Selected research file beside the board: call, score, grades, trigger,
  invalidation, last observation, source, as-of time, and lesson.
- Evidence rail: archive load state, audit-chain result, model path, and the
  capability boundary.
- $10K challenge scoreboard sourced from the append-only challenge ledger.
- Report output appears only after the backend returns a real result. Failures
  stay visible and are never restyled as success.

### Generate

- Ticker and full-market report requests use the real v23 report chain.
- Every accepted run receives an idempotent job ID and exposes its real backend
  step and elapsed time.
- Exactly one local report job runs at a time.
- A completed or partial result is saved as an immutable snapshot before the
  interface claims that a report or PDF exists.

### Library and Report Room

- The Library lists saved reports newest-first and supports search and status
  filtering.
- A Report Room exposes the saved summary, full report/deep-dive sections,
  limitations, source/as-of records, copy controls, and repeatable PDF download.
- The PDF is generated from the immutable saved snapshot, not transient DOM.
- Report JSON and PDF data use an isolated runtime directory and survive an
  Electron application update.

### Book

- Renders every row from `db/archive.json`; no embedded book snapshot.
- Search across ID, ticker, call, lesson, and outcome.
- Shows total/open/closed counts, scored checkpoints, and conditionals missing
  a trigger.

### Audit

- Verifies the local hash chain before claiming it is intact.
- Shows recent events and supports CSV export.

### Settings

- Model providers only.
- Local key entry is explicit about storage.
- A permanent capability card states that order routing, auto-execution, and
  public posting are unavailable.

## Data-integrity contract

- Current framework: `prompts/trading-copilot-v23.md`.
- Current book: `db/archive.json`.
- Challenge ledger: `db/challenge.json`.
- Unavailable values render as `NOT OBSERVED`; the UI does not infer them.
- Every observed price carries source and as-of context when available.
- A stale ledger may still be displayed, but its date must remain visible.
- Market report runs may reconcile the book, so the command bar warns before a
  run and the backend accepts the action only by POST.

## Local security contract

- Backend listens on `127.0.0.1` only.
- Browser context isolation, sandboxing, disabled Node integration, and web
  security remain on.
- External navigation is blocked inside the app and handed to the OS browser.
- Wildcard CORS is disabled.
- Read and action routes use the correct HTTP methods.
- JSON request bodies are capped and invalid ticker/origin input fails closed.
- Duplicate generation requests can reuse an idempotency key instead of
  starting another model run.
- No order route exists in the HTTP or MCP interfaces.

## Public-web boundary

v0.4 remains a loopback, single-user release. Do not expose `server/index.js`
directly to the internet. A public beta requires authenticated user identity,
tenant-isolated hosted storage, durable background jobs, signed PDF downloads,
server-side model credentials, and distributed rate/cost limits. Adam's
canonical archive and challenge ledger must never become shared visitor data.

## Release gate

Before calling a desktop release ready:

1. `npm test` passes.
2. `npm run dist:win` produces the expected installer.
3. Generate, Library, Report Room, PDF download, Desk, Book, Audit, Settings,
   board selection, filters, and real report failure/success states are checked
   at desktop and phone viewports.
4. Packaged output contains the v23 prompt, challenge ledger, and all public UI
   assets.
5. Current archive/challenge timestamps are reviewed; the UI does not turn an
   old ledger into a current claim.

*Proof, not hype.*
