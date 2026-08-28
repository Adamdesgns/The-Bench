# THE BENCH — EXECUTION & CONNECTIONS

How the app talks to models, agents, and the broker. **Read this before wiring
live orders.**

> **STATUS NOTE (2026-08-26): two execution designs exist in this repo; only one is sanctioned for the first live test.** This file describes the desktop app's `executeOrder` path — **NOT WIRED, Paper by default** — and it stays that way for now. The sanctioned lane for the first live order is `prompts/bench-executor-v1.md` under `docs/executor-test-protocol.md`, whose hardcoded $5/order test ceiling outranks the $150/$500 defaults below. Do not wire both; consolidation is an open decision. This file's "order audit log" item maps to the executor's durable receipt registry (`executor-tests/receipts/`).

## Principle: no keys in the app

The app holds **zero secrets.** Credentials live in the MCP servers or the host
environment — never in the repo, never in the UI, never in `db/connections.json`
(which stores endpoints + policy only; secret-looking keys are stripped on
write). `server/settings.js` enforces this.

## Connections (Settings window)

| Provider | Kind | Role |
|---|---|---|
| **Claude** | model | v17 / Marquee analysis |
| **OpenAI** | model | v17 / Marquee analysis |
| **Hermes Agents** | agent | task-runner agents that act when tasked |
| **Robinhood** | execution | order placement (buys) via MCP |

Each is an **MCP endpoint reference** + an enabled toggle + a live/connected
status. Model calls and agent tasks route through these connections; the app is
a client.

## Analysis vs execution — kept separate

- **Analysis** (`/api/run` → `server/api.js runCommand`) runs v17 → Marquee and
  returns a reviewable draft. It **never places orders.**
- **Execution** (`server/api.js executeOrder`) is a distinct, gated path that
  routes to the Robinhood MCP. It is never triggered by an analysis command —
  an agent invokes it when a trigger fires.

## Execution policy (gates — ALL must pass to place a buy)

Set in Settings → Execution policy, stored in `db/connections.json`:

- **Robinhood connected** — enabled + MCP endpoint set.
- **Mode = Live** — defaults to **Paper**. Paper simulates, never sends.
- **Kill switch off** — flip it on to block every order instantly.
- **Confirm before every buy** — when on, each order needs a human confirm token.
- **Per-trade cap** / **Daily cap** (USD) — hard ceilings (default $150 / $500,
  matching the v17 aggressive risk band).

`settings.status().canExecute` is true only when Robinhood is connected, mode is
live, and the kill switch is off. `executeOrder` refuses otherwise.

## Still to wire

1. **Robinhood MCP endpoint** — drop the real endpoint in Settings; then
   `executeOrder` routes orders through it (currently returns "not wired yet").
2. **Hermes agent endpoint** — the task-runner that watches triggers and calls
   `executeOrder`. Needs its MCP endpoint + a definition of what tasks it runs.
3. **Order audit log** — append every order (paper + live) to an immutable log
   for calibration and review.
4. **Model connections** — point Claude/OpenAI at their MCP servers (or the host
   env for the local dev runner) so `callBench`/`callMarquee` run for real.

*Proof, not hype.*
