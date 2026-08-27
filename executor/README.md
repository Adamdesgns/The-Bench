# bench-executor — the program surface

**Status: UNTESTED — live path never run.** Same meaning as the prompt's header:
nothing here is trusted until the protocol's authorized tests produce receipts.

This directory is `prompts/bench-executor-v1.md` implemented as a **local
program**, after 2026-08-26 proved the chat-surface design could not run: a
valid test-zero authorization was refused on both Claude surfaces, because the
assistant's no-trade-execution rule travels with the assistant, not the
surface. The program keeps every gate and moves the button to the only hands
that were ever going to press it: Adam's.

## Who does what

- **Any AI (Claude, Codex)** may draft handoffs, run `validate` and `status`,
  and read receipts. These are offline/read-only.
- **Only Adam** can drive `login`, `test-zero`, `test-one`: the program
  refuses without an interactive terminal, refuses without the typed
  `AUTHORIZE …` line for the exact commit running, and refuses without a
  fresh typed `CONFIRM <plan_id> <review_ref> $<notional>` after the broker's
  review is displayed. A scheduler or an AI-driven shell has no TTY and no
  keyboard, so the live path is structurally out of its reach.

## Commands

```bash
node executor/executor.mjs validate <handoff.json>
node executor/executor.mjs status
node executor/executor.mjs login
node executor/executor.mjs test-zero --handoff <file> --live
node executor/executor.mjs test-one  --handoff <file> --live
```

`test-one` is sequenced behind `test-zero` in code: it refuses until a receipt
shows a CLEAN test-zero run — cancellation verified AND nothing filled. A
cancel that raced a partial fill proves the cancel path but does not unlock
test one.

## How it connects

Direct MCP client (zero-dep, `executor/lib/mcp.mjs`) to Robinhood's agentic
endpoint `https://agent.robinhood.com/mcp/trading` — the same server the chat
connectors mount, driven by this program instead of an assistant. Auth is
OAuth 2.1 (discovery → dynamic client registration → PKCE in Adam's own
browser); tokens land in `~/.bench-executor/oauth.json`. The program never
sees a Robinhood password.

**First-run unknown:** whether this endpoint accepts non-Claude OAuth clients
is unverified until `login` succeeds once. If discovery or registration
refuses, that result gets recorded in `docs/executor-test-protocol.md` as a
blocker — no endpoint guessing.

## What moved from prompt to code

- §5 tool allowlist → `lib/broker.mjs` binds observed names; every other tool
  is unreachable. Blocker #2 (`TOOL ALLOWLIST IS PROMPT-ONLY`) closes here.
- §8 durable receipts → `lib/receipts.mjs` writes to
  `executor-tests/receipts/` synchronously at every transition. Blocker #3
  (no durable mid-session store) closes here.
- §7.5 no-retry → `lib/mcp.mjs` has no retry path at all; ambiguity reads as
  `UNKNOWN_REQUIRES_RECONCILIATION` and stops.
- Arm switch → `lib/arm.mjs` reads the same ntfy topic
  `scripts/executor-arm.mjs` writes; one placement attempt burns the arm.
- Broker states the validator's fixtures never saw (`new`, `confirmed`,
  `unconfirmed`) map to PENDING with the tool schema as provenance;
  `voided` deliberately stays fail-closed until a real capture explains it.

## Hard ceilings (change only by reviewed commit)

`$5.00` notional per order (`HARD_TEST_CEILING_USD`) · `$10.00` funded
ring-fence (`MAX_FUNDED_TEST_BALANCE_USD`) · LIMIT + DAY + regular hours ·
whole shares · one placement per plan_id, ever, enforced by the receipts dir.
