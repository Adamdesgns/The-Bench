# THE BENCH — CAPABILITY & CONNECTION BOUNDARY

This document replaces the pre-v0.3 execution plan. The desktop app is a
research workstation. It does not place trades.

## Hard boundary

- The Bench can read configured data, run v23, reconcile the local book, and
  create a Marquee draft.
- The Bench exposes no buy, sell, order, live-mode, paper-mode, cap, or kill-
  switch control.
- `server/api.js` exports no order function.
- `server/mcp.js` exposes only `run_v23`, `reconcile`, `run_marquee`, and
  `state`.
- `settings.status().canExecute` is retained only for older clients and is
  always `false`.
- Adam executes every order outside this application.

This is a product boundary, not a disabled feature. The UI must never suggest
that an order was routed, simulated, or accepted.

## Connections

| Provider | Kind | Role |
|---|---|---|
| Claude | model | v23 and Marquee analysis |
| OpenAI | model | v23 and Marquee analysis |
| Hermes Agents | agent | research task runner |
| Robinhood | data | optional read-only market/account reference |

Model keys are saved to the machine-local secrets file and are never returned
by the API. `db/connections.json` stores non-secret provider references only.
Both files are gitignored.

## Local API boundary

- The server binds to `127.0.0.1`, not every network interface.
- Read endpoints use GET: health, archive, challenge, report status, audit.
- Actions use POST: report runs, command runs, and settings updates.
- Wildcard CORS is not enabled.
- Responses carry no-store, no-sniff, frame-deny, and content-security headers.

## If automated execution is ever built

It belongs behind a separate, explicitly approved service with its own threat
model, broker authentication, idempotency, confirmation design, immutable order
ledger, and failure recovery. It must not be smuggled back into this workstation
as a settings toggle.

*Proof, not hype.*
