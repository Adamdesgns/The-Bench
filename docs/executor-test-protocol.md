# EXECUTOR TEST PROTOCOL — bench-executor-v1

Governs how `prompts/bench-executor-v1.md` moves from `UNTESTED` toward `LIMITED LIVE — INTERACTIVE EQUITY ONLY`. Nothing in this file runs a live test; it defines the only path to one.

## The gate, in order

1. **Commit** the exact executor bytes to the PR branch as `UNTESTED — LIVE EXECUTION DISABLED`.
2. **Line-by-line review** of the committed artifact (Adam + one Claude session reading the committed bytes, not a description of them).
3. **Offline tests pass**: `npm test` runs `test/executor-contract.test.mjs` — every refusal case refuses, the valid control passes, unknown broker states normalize to `UNKNOWN_REQUIRES_RECONCILIATION`, timeouts never retry.
4. **Operator checklist signed off** (below) — external steps the repo cannot perform or verify.
5. **Test zero — cancellation path** (separately authorized, below).
6. **Test one — tiny live order** (separately authorized, below).
7. **Evidence attached** (below), then a status change **only through a later reviewed commit**.

Recorded per test: executor commit SHA · plan_id · full input plan · preflight lookups · review response · Adam's typed confirmation + timestamp · placement response · status responses · cancellation response (test zero) · final broker order ID/state · phone-notification timestamp · final receipt row.

## Authorizations (typed by Adam, in-session, verbatim)

- Test zero: `AUTHORIZE TEST-ZERO <executor-commit-short-sha> ceiling $5`
- Test queued (after-hours): `AUTHORIZE TEST-QUEUED <executor-commit-short-sha> ceiling $5`
- Test one: `AUTHORIZE TEST-ONE <executor-commit-short-sha> ceiling $5`

An authorization is single-session, single-test, and names the committed SHA it applies to. While the executor file says `UNTESTED`, broker tools may be touched **only** under one of these lines. No authorization, no tool calls — including reads.

## Operator checklist — external, signed off before any authorization

- [ ] Dedicated, otherwise **empty** Robinhood Agentic account exists; **no positions, no open orders.**
- [ ] Funded with **≤ $10.00** available buying power — the funded balance is the strongest ceiling; the executor's hardcoded $5/order sits under it.
- [ ] Robinhood app open on the phone, push notifications on, for the whole session (the out-of-band channel).
- [ ] Executor surface prepared: an interactive session with the agentic-trading connector mounted and **this repo's committed bytes** as the executor prompt. Not a scheduled task. Not a research session.
- [ ] Research surfaces verified clean: no agentic-trading connector mounted in any research/drafting session or scheduled routine. If research needs live quotes, it uses a genuinely read-only source; if the only connector bundles read and write tools, it is **not mounted** in research. (Open loop: read-only market-data replacement, if needed.)
- [ ] Platform-level tool restriction attempted on the executor surface (permission config denying non-equity tools). If the surface cannot enforce it, record **`TOOL ALLOWLIST IS PROMPT-ONLY`** — a known blocker Adam must explicitly accept in writing before authorizing.
- [ ] Durable-receipt gap accepted in writing (claude.ai surface has no mid-session durable write — see executor §8), **or** the executor is moved to a surface with a durable writable store.
- [ ] Kill sequence rehearsed from the executor §9 — Adam knows the cancel tool, the status check, and where the connector disconnect lives, *before* anything is live.

## Offline test matrix (implemented now — `test/executor-contract.test.mjs`)

1. Missing required field → refuse. 2. `Pending Archive ID` → refuse. 3. Duplicate `plan_id` in the durable registry → refuse. 4. Stale `expires_at` → refuse. 5. Planned risk above ceiling → refuse. 6. Notional above the hardcoded $5 test ceiling → refuse. 7. Both quantity modes → refuse. 8. Neither quantity mode → refuse. 9. `side` supplied instead of `action` → refuse. 10. Action other than `BUY`/`SELL_TO_CLOSE` → refuse. 11. Non-equity asset class → refuse. 12. Options / crypto / short / leveraged / concentrated / BET → refuse. 13. Market order, GTC, or extended hours → refuse. 14. Missing `exit_owner` → refuse. 15. Unknown broker response fixture → `UNKNOWN_REQUIRES_RECONCILIATION`, never success. 16. Ambiguous placement-timeout fixture → no retry.

Fixtures live in `executor-tests/redacted-fixtures/` and are **synthetic until real captures replace them** — normalization built from them is provisional by definition.

## Test zero — cancellation path (LATER, authorized, not run by this task)

Low-fill-risk, **never called zero-fill-risk**: an unmarketable limit can still fill on a fast move, and the broker may reject an unreasonable price.

Committed executor SHA · ring-fenced account per checklist · one unmarketable `DAY` equity limit, regular hours, within the $5 ceiling · confirm the order appears in the Robinhood app · cancel **through the executor** · query and verify `CANCELED` · confirm the phone notification fired · archive every raw response + receipt transition. If Robinhood rejects the limit as unreasonable: record a successful **rejection-path** observation and do **not** claim the cancellation path was tested.

## Test queued — after-hours cancellation path (LATER, authorized, not run by this task)

Added 2026-08-27, at Adam's point: an order that *cannot fill* is lower-risk than one that can. A regular-hours limit placed while the market is CLOSED **queues for the next open** instead of filling — so placing it and cancelling it entirely after hours, before it can ever go live, exercises almost the whole path (real `place` and `cancel` API calls, the receipt trail, the arm switch, and — the payoff — the **real broker response schemas**, blocker #5) at near-zero fill risk. And it runs in the evening, off the clock, so it does not need a market-hours window.

`node executor/executor.mjs test-queued --handoff F --live`. Same gates as test zero (TTY, typed `AUTHORIZE TEST-QUEUED` + `CONFIRM`, arm switch, ceilings, receipts) with the market-session gate **inverted**: it refuses unless the market is closed with a buffer (`safeAfterHoursWindow()` — weekend, or before 07:00 / after 16:15 ET, so the run is never near a live session). The limit must still be unmarketable — belt-and-suspenders: if the cancel ever failed and the order reached the open, it sits far from fillable.

**What it does NOT establish:** it proves the cancel path on a **queued** order, not a live working one, so it does **not** substitute for the market-hours test zero and **does not unlock test one** (`hasCompletedTestZero()` counts only a clean `test-zero` receipt). The one residual risk: if the cancel fails and is left uncancelled, a queued order becomes live at the next open — the executor verifies the cancel and alarms loudly if it did not land, and the order is a $5, ring-fenced, unmarketable one, but the operator must confirm nothing is left queued.

## Test one — tiny live order (LATER, authorized, not run by this task)

Interactive session only · one fractionally tradable long equity **selected by Adam** · no existing position or open order in the ticker · regular hours · `DAY` limit · notional within the $5 hardcoded ceiling (target $1–5) · review/preview required · executor displays alias, ticker, action, quantity, limit, max notional, planned risk, exit owner · fresh typed confirmation bound to the review (`CONFIRM <plan_id> <review_ref_or_NONE> $<max_notional>`) · **one placement call** · no blind retry · capture broker order ID + final state · receipt attached durably (committed immediately after) · **replay the same `plan_id` and verify refusal.**

One passed order validates only this narrow route. It does not validate protective stops, sell-to-close, partial fills, rejections beyond what was observed, closed-market behavior, scheduled execution, options, crypto, or autonomous anything.

## Standing go-live blockers (open until individually cleared)

1. Line-by-line review of the **committed** executor bytes not yet done.
2. `TOOL ALLOWLIST IS PROMPT-ONLY` until platform-level enforcement is configured and verified on the executor surface.
3. No durable mid-session receipt write on a claude.ai executor surface — accept in writing or relocate the surface.
4. Two execution designs exist in this repo (this lane, and the app's `executeOrder` path in `docs/EXECUTION.md`, unwired). Only this lane is sanctioned for the first test; consolidation is an open decision.
5. Broker response schemas unverified until captured during the authorized tests.
6. The framework's `Pending Archive ID` remains valid for research logging — every handoff must carry a real Row ID.

---

## 2026-08-26 — SURFACE CORRECTION: the executor is a program now

**What happened:** Adam typed the valid test-zero authorization and BOTH chat
surfaces refused it — the claude.ai executor session refused and pointed at
Claude Code; Claude Code refused and held that the assistant's
no-trade-execution rule travels with the assistant on every surface. The
"claude.ai connector surface is where the executor runs" claim is **retired,
disproven live.** No Claude chat session will call `place_equity_order`; do
not send anyone back across that wall.

**The replacement, greenlit by Adam the same day ("yes build it"):**
`executor/executor.mjs` — the committed contract implemented as a local
program that speaks MCP directly to `https://agent.robinhood.com/mcp/trading`.
Any AI may draft handoffs and run `validate`/`status`; the live path refuses
without a TTY and without Adam personally typing the AUTHORIZE line (bound to
the running commit SHA) and the CONFIRM line (bound to the broker's review).
Adam's approval of every order is enforced in code, not convention.

**Blocker status after the move:**

- #2 (`TOOL ALLOWLIST IS PROMPT-ONLY`) — **closed by construction**: the
  allowlist is code (`executor/lib/broker.mjs`); unbound tools are unreachable.
- #3 (no durable receipt store) — **closed by construction**: synchronous
  receipt writes to `executor-tests/receipts/` at every transition.
- #1 (line-by-line review) — still open, now covering the program too.
- #5 (uncaptured broker schemas) — still open; the program fails closed
  wherever a response shape is unrecognized.
- **New blocker #7:** whether Robinhood's agentic endpoint accepts a
  non-Claude OAuth client (discovery → dynamic registration → PKCE) is
  unverified until `node executor/executor.mjs login` succeeds once. If it
  refuses, record the captured responses here — no endpoint guessing.
  **CLEARED 2026-08-26, evening:** Adam ran `login` at his own terminal.
  Discovery, dynamic client registration, the Robinhood consent page, the
  127.0.0.1:8917 loopback callback, and the token exchange all completed;
  `status` reports the token on file in `~/.bench-executor/oauth.json`.
  The endpoint accepts a standards-compliant non-Claude OAuth client.
- The §Authorizations rule now reads on the program: the typed line goes to
  the program's own prompt, in a terminal, bound to the commit SHA it prints.

*Proof, not hype.*
