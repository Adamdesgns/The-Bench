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

*Proof, not hype.*
