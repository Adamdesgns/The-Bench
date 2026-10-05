# THE XECUTOR — Stage 1

**Status: SIMULATION ONLY. LIVE BROKER ROUTE ABSENT.**

The Xecutor is The Bench's guarded order-proposal inbox. ChatGPT, Claude, Grok,
or another authenticated client can submit a complete, immutable execution
handoff. Adam reviews the frozen details in a separate local owner window. An
approval creates a durable **simulation receipt only**; Stage 1 contains no
broker endpoint, OAuth flow, placement tool, or live-order route.

This is intentionally separate from both the research MCP in `server/mcp.js`
and the untested prompt executor in `prompts/bench-executor-v1.md`.

## What it guarantees

- Bots expose only `propose_order`, `get_order_status`, and
  `withdraw_proposal`.
- Source identity comes from a separate client credential, never request JSON.
- Every proposal is validated against `bench-execution-handoff-v1`, frozen,
  SHA-256 fingerprinted, and stored outside the repo.
- Unknown fields, stale or malformed plans, unsupported structures, duplicate
  plan IDs, and orders above the committed $5 Stage 1 ceiling are refused.
- Owner mutations are POST-only, loopback-only, same-origin, and require a
  15-minute owner session plus a per-launch CSRF proof. The owner code is
  scrypt-hashed on disk. The high-entropy session proof exists only in the
  owner page's JavaScript memory and travels in a custom header, so it is never
  ambiently sent to unrelated localhost ports; reloading the page logs out.
- Approval text is bound to the plan ID, server review reference, and computed
  maximum notional. Approval proof also signs the exact order fingerprint with
  a one-use nonce and a 90-second validity window.
- Every process launch resets the gateway to `BLOCK ALL`, even if simulations
  were unlocked before the prior shutdown.
- One process lock owns the runtime folder. A second Xecutor process refuses to
  start instead of racing proposal, receipt, or audit writes.
- A second approval cannot create a second receipt. A transport ambiguity will
  never be retried automatically when a live adapter is eventually designed.
- The audit chain is append-only and hash-linked. State mutations carry a
  durable audit outbox, so startup completes an interrupted audit write without
  duplicating it. An integrity mismatch makes the service refuse to start.

This controls authorization and duplication. It does not decide whether a
trade is wise, guarantee a fill, protect against price gaps, or replace Adam's
review.

## One-time owner and bot setup

Run this from the repo before opening the owner desk or the locally built app,
with nobody watching or recording the terminal:

```powershell
npm run xecutor:setup
```

It creates one owner approval code plus separate ChatGPT, Claude, and Grok
credentials. Save the owner code in your password manager. The program stores
only its scrypt verifier; it cannot display the code again. Each raw bot token
is also printed once, while only its SHA-256 hash is stored.

The setup command never overwrites an existing owner or bot registry.

## Run the local owner desk

```powershell
npm run xecutor
```

Open `http://127.0.0.1:8140`. The first launch is blocked. Adam must deliberately
unlock simulations in the local window before any proposal can enter the
approval queue. The **Create safe demo** control submits a synthetic `$4.50`
`TEST` proposal and never contacts a market-data or broker service.

For the Electron window during development:

```powershell
npm run xecutor:app
```

Runtime state lives at `%LOCALAPPDATA%\The Xecutor` by default. Tests override
that location with `XECUTOR_DATA_DIR`. The runtime folder holds local proposals,
sanitized receipts, the approval key, the owner-code verifier, client-token
hashes, the process lock, and the audit chain. It must never be committed.

## Connect a local bot client

The local stdio adapter is:

```powershell
$env:XECUTOR_CLIENT_TOKEN='<one bot-specific token>'
npm run xecutor:mcp
```

Configure a different token for each bot. Never paste a token into a prompt,
repo file, screenshot, receipt, or chat transcript.

## HTTP and MCP surfaces

Owner-only routes are available only through the loopback UI:

- `GET /api/owner/status`
- `POST /api/owner/login`
- `POST /api/owner/logout`
- `GET /api/session`
- `GET /api/proposals`
- `GET /api/proposals/:id`
- `GET /api/audit`
- `POST /api/demo`
- `POST /api/kill-switch`
- `POST /api/proposals/:id/approve`
- `POST /api/proposals/:id/reject`

Authenticated bot routes:

- `POST /api/bot/proposals`
- `GET /api/bot/proposals/:id`
- `POST /api/bot/proposals/:id/withdraw`
- `POST /mcp` — stateless Streamable HTTP JSON-RPC surface

The server binds to `127.0.0.1` by default. The HTTP MCP shape is ready for a
later private HTTPS ingress, but **Stage 1 does not claim ChatGPT web, Claude
web, or Grok cloud are connected**. A reviewed private ingress, deployment
authentication, rate limiting, connector registration, and end-to-end tests
are separate work. Do not expose the local port directly to the internet.

## State model

```text
PROPOSAL_RECEIVED
  -> PREFLIGHT_REFUSED
  -> AWAITING_APPROVAL
       -> REJECTED | WITHDRAWN | EXPIRED
       -> APPROVED
            -> SIMULATION_COMPLETE | SIMULATION_INTERRUPTED
```

`SIMULATION_INTERRUPTED` is fail-closed: it means the durable proposal and
receipt could not be reconciled, and startup leaves `BLOCK ALL` enabled for
manual inspection.

The terminal receipt statement is exact:

> SIMULATION COMPLETE — NO BROKER ORDER WAS CREATED.

Never describe that state as filled, bought, placed, or executed.

## Verification

```powershell
npm test
```

The Xecutor tests cover the contract, idempotency, source isolation, exact
confirmation, single-receipt behavior, restart persistence, MCP tool boundary,
loopback/origin/CSRF enforcement, owner sessions, process locking, crash-replayed
audit outboxes, receipt-tamper recovery, body limits, and simulation-only
labeling.

The optional Windows installer build is local only:

```powershell
npm run dist:xecutor:win
```

Building is not installation, publishing, deployment, broker authorization, or
permission to run the existing live executor draft.

## Live boundary

Stage 2 cannot be enabled by configuration. It requires a later reviewed code
change, its own broker adapter, protected credential storage, live quote and
account revalidation, a broker review/preview step, crash-safe outbox and
reconciliation for broker placement, Windows Hello or passkey approval, the existing cancellation
test, the existing tiny-order test, and explicit Adam authorization. Stops are
the first tested expansion after the narrow equity route; options remain later.
