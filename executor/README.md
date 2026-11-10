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
node executor/executor.mjs pin
node executor/executor.mjs codes --new
node executor/executor.mjs place --handoff <file> --live
node executor/executor.mjs watch --once --live
```

## Real-order mode (added 2026-11-09, UNTESTED)

Contract: `prompts/bench-executor-v2.md`. Adam's own steps: the checklist in
`docs/executor-test-protocol.md`, section 2026-11-09.

1. After a BUY call has a book row, the desk runs `scripts/executor-ticket.mjs`.
   It writes `~/.bench-executor/tickets/B-###.json` and texts Adam the order and
   the line to send back. It never arms.
2. Adam sends `ARM B-### <ticket code> <one-time code>` from his phone, ahead
   of time if he likes. It covers that one ticket.
3. The Windows task runs `watch --once --live` every minute. When the ticket's
   condition comes true, the program runs every guard and places it once.
4. Each step goes to his phone and to a receipt. The program follows the order
   until it fills or dies. It never cancels and never sells.

**To stop it:** send `HALT` from the phone, which stops every approved ticket
not yet placed. An order already at Robinhood has to be cancelled in the app.
To stop the watcher entirely, disable the Windows task "Bench Executor Watcher".

**What it locks on:** `REAL_ORDER_CEILING_USD` set to 0, three wrong codes, or
executor files that differ from the commit. Approved tickets wait while the
executor files differ from the version Adam pinned with `pin` (book commits do
not affect it). It refuses when the test gate fails. The gate
needs committed test receipts from a program version in this checkout's history,
and Robinhood itself must show test zero cancelled with nothing filled and test
one filled.
It also waits on weekends, holidays and after 12:45 on early-close days, from
the hand-written list in `lib/calendar.mjs` (check it against nyse.com).
A one-time code is spent the moment it appears in any message, even a
refused one. A new approval waits about 90 seconds before it can place, so a
HALT has time to land. If the phone channel went unread for over 11 hours, every
earlier approval is cancelled, because a HALT may have aged out unread. A new
ARM with the next code approves a cancelled or HALTed ticket again.
Once codes exist, `codes --new` and `codes --unlock` need one current code, and
both text the phone.

**The honest limit (open risk, see `docs/executor-test-protocol.md`):** the
one-time codes stop a stray or tricked AI session from approving an order. They
do not stop software running as Adam on this PC. Such software can write an
approval into the state file, replace the code hashes, or take the Robinhood
token from `~/.bench-executor/oauth.json` and skip this program altogether.
The per-order limit and the test gate bind this program only. **What limits
the damage is the cash kept in the trading account.**

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
Those two dollar limits govern the tests. Real orders use
`REAL_ORDER_CEILING_USD`, Adam's number: $200 (2026-11-09, "it's 200 idgaf if
it goes to 0").
