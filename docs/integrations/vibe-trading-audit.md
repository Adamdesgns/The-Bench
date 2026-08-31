# Vibe-Trading × The Bench — capability audit and decision record

**Date:** 2026-08-30 · **Decision by:** Adam · **Status: DEFERRED — slice 1 built Bench-native instead.**

Adam brought an integration handoff proposing that [HKUDS/Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) become The Bench's research/quant/evidence engine. Both repos were audited the same day. The audit changed the plan: most of what the handoff wanted to import already existed in this repo, unfed or unfinished. The ruling (Adam, 2026-08-30): *finish the quant machinery The Bench already owns first; install a pinned, isolated Vibe-Trading MCP later, only for questions that genuinely need heavier machinery. Vibe-Trading = optional laboratory. The Bench = system of record and decision framework.*

## What was audited

- **The Bench** at commit `aaef039` (v27 merge on `main`), full-tree read: prompts, `server/`, `scripts/`, `db/`, `site/`, `docs/`, tests.
- **Vibe-Trading** upstream read live on 2026-08-30 via the GitHub API (not cloned): README, `LICENSE` (**MIT**), `pyproject.toml` (PyPI `vibe-trading-ai`, latest release **v0.1.14**, 2026-08-20), `agent/mcp_server.py` (74 tools; stdio/SSE/HTTP transports; shell tools default-off; loopback-only network binding), `agent/backtest/` (custom engines + `metrics.py` + `validation.py` walk-forward/Monte-Carlo/bootstrap + `run_card.py`), `agent/backtest/loaders/registry.py` (39 loaders; US chain yahoo→stooq→…→local, free-first, keyless), `agent/src/hypotheses/registry.py`, `agent/src/swarm/presets/` (~30 team YAMLs), `agent/src/skills/` (130 skill packs), `agent/api_server.py`, `agent/tests/`. Python ≥3.11, LangChain/LangGraph stack. Very active: ~10 PRs/day at audit time.

## Capability map

| Vibe-Trading capability | Existing Bench capability | Ruling | Why |
|---|---|---|---|
| Backtest engines + metrics (Sharpe, Sortino, max-DD, walk-forward, Monte Carlo) | `server/scorecard.js`/`scoring.js`/`checkpoints.js` (checkpoint calibration, live as of 2026-08-30) + `server/evidence.js` (base rates, slice 1) | **DEFER** | Base rates + calibration cover the questions a $2.5k account actually asks. Walk-forward/Monte-Carlo/factor work is the slice-2 trigger, not a day-one need. |
| Data loader registry (24+ sources, fallback chains) | Robinhood MCP (live quotes/options/fundamentals, interactive) + `getDatedCloses()` Yahoo→Stooq (historical, keyless) | **IGNORE** (live) / **DEFER** (deep history) | The handoff's own rule: never replace a working provider. The only gap is very long history, and Yahoo `range=5y+` currently serves it free. |
| Hypothesis registry (exploring→testing→validated/rejected) | `db/patterns.json` (falsifiable claims, mandatory test, proposed→supported at 3 instances) + `docs/thesis-ledger.md` + Self-Audit Loop | **IGNORE** | Already exists, twice, with sharper rules (a pattern without a falsification test is refused at log time). Building a third registry would violate the handoff's own no-parallel-systems rule. |
| Run cards (hash-verified reproducible run artifacts) | None (before slice 1) | **ADAPT** | The shape was borrowed, scaled down: `db/quant-runs.json` — QR-### id, full params, source + bar span, per-instance results, grade, `row_ref` to the book. Provenance without the Python. |
| MCP server (74 tools, stdio, shell-off, loopback-only) | `server/mcp.js` (Bench's own stdio MCP for the app) | **DEFER** | This is the slice-2 integration boundary — the cleanest one available. Pin to a release tag, stdio only, isolated venv. |
| Agent swarms (~30 presets: investment committee, war rooms) | The actual desk: Morgan, Grant, Fundy, Remy, the handoff bus, the worklog | **IGNORE** | LLM role-theater imitating something The Bench runs for real, with humans accountable and a claims log. Token-expensive, unverifiable output. |
| Skills library (130 method packs) | `prompts/` (the framework IS the method pack) | **IGNORE** | The handoff itself said "do not blindly copy 89 skills into our prompts." Correct. |
| Live-trading layer (13+ broker connectors) | `executor/` + `prompts/bench-executor-v1.md`, gated by `docs/executor-test-protocol.md` | **IGNORE, permanently** | Research-only mandate. The Bench's execution lane is its own program with its own untested-until-proven gate. No second execution path, ever, and no broker credentials near Vibe-Trading. |
| Options analysis tooling | Robinhood MCP option chains/quotes + v28 Options Discipline (gated on explicit request) | **IGNORE** | Covered, and the gate ("Run options $TICKER") is a Bench rule worth keeping. |
| Trade journal / shadow analysis | `docs/scout-log.md` (regime-tagged, benchmark-scored) + `score-book.js` + patterns | **IGNORE** | The feedback loop exists and already produced rule changes (P-008 → the Guide Rule). Extend it, don't import a parallel one. |
| Frontend / desktop UI | `site/build.mjs` (public scoreboard) + Bench OS (in dev) | **IGNORE** | The handoff said don't bolt the Vibe UI on. Correct. |

## What slice 1 actually built (2026-08-30, branch `quant-slice-1`)

1. **Checkpoint catch-up** — 33 due checkpoints scored through the existing `score-book.js`; public record 95–80–16 across 220 rows. (Correction to the pre-work audit: 181 rows already carried checkpoints; the scorer had been running. The gap was smaller than reported — it was a catch-up, not a resurrection.)
2. **`server/evidence.js`** — pure setup base-rate engine: event detection (move/breakout/breakdown, cluster-collapsed), forward returns vs benchmark by date, overlap-aware independent-sample counting, A–F evidence grading. Offline-tested.
3. **`scripts/quant-evidence.mjs`** — zero-dep CLI; refuses unscoreable requests (missing threshold, unknown setup, `--row` not in the book); appends every run to `db/quant-runs.json` with a QR id. First real run: QR-001 (CEG 5-bar −5% dips → 21 bars forward, grade B, linked to B-220).
4. **`prompts/trading-copilot-v28.md`** — §QUANT EVIDENCE: on demand, never by default; grade travels with the number; C/D/F never outranks primary evidence; LOG IT extends to QR ids; never on the unattended posting path.

## Slice 2 — when and how Vibe-Trading actually gets mounted

**Trigger:** a real research question `quant-evidence.mjs` cannot answer — walk-forward validation, factor analysis, Monte Carlo on a strategy, multi-asset regime segmentation — arising more than once (the Self-Audit Loop's own bar: patterns, not single wants).

**How, when triggered:**
- `pip install vibe-trading-ai==<pinned release>` into a **dedicated venv outside this repo** (it is a LangChain-stack Python platform; the zero-dep rule protects this repo, not the whole machine).
- Consume via **stdio MCP** (`vibe-trading-mcp`) mounted on the interactive research surface only. Shell tools stay default-off. No HTTP transport unless loopback-bound.
- **Feature-flagged and absent by default:** if the venv/MCP is missing, every Bench flow behaves exactly as today. `Quant analysis unavailable` is a complete, honest answer.
- Results are normalized into the same `db/quant-runs.json` QR record (`engine` field distinguishes `bench-native` from `vibe-trading@<version>`), so the book cannot tell which engine produced the evidence and the LOG IT rule holds either way.
- **Never:** on the unattended X posting path; near broker credentials; as a source of buy/sell signals; tracking upstream `main` (releases only, re-verified on every bump — upstream moves ~10 PRs/day).

## Security notes

- Vibe-Trading ships live-broker connectors (Alpaca, IBKR, OKX, MT5, …). Research-only use means those are never configured; no keys, no accounts. The Bench's only execution lane remains `executor/` behind `docs/executor-test-protocol.md`.
- The upstream MCP server's own posture is decent (shell tools opt-in, loopback Host/Origin allow-lists), but a pinned release is the trust boundary — never `pip install` from `main`.
- Nothing in slice 1 added a dependency, a network surface, or a credential. The CLI hits the same Yahoo/Stooq endpoints `tripwire.mjs` and the scorer already use.

## Handoff items deliberately not done, and where their intent landed

- Phases 5 (swarms), 6 (options), 8 (trade journal) — see the map: covered by existing Bench systems or rejected outright.
- Phase 3 (hypothesis registry) — intent satisfied by `patterns.json` + Thesis Ledger; quant runs link in via `row_ref`/QR citations instead of a new lifecycle.
- Phase 7 (Strategy Lab) — deferred with slice 2; the "try to kill the idea" ethos landed in v28's §QUANT EVIDENCE instead.
- `.env.example` — unchanged: slice 1 needs zero keys, and the file already documents the app's existing ones.
