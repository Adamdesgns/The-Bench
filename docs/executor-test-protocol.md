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

---

## 2026-11-09 — REAL ORDERS, PRE-APPROVED FROM THE PHONE

**Status: built and tested offline only. The live path has never run.** Contract: `prompts/bench-executor-v2.md`. Adam, 2026-11-09: approval from the phone, no second tap in the Robinhood app ("No", "Just my approval"), and "I want to pre approve and forget about it".

**What changed from the 2026-08-26 design:** that design enforced Adam's approval by requiring typed lines at a real keyboard. Real-order mode replaces the keyboard, for real orders only, with a one-time code Adam holds on his phone. The typed tests below are unchanged and still have to pass first. Those tests must leave committed receipts, or real orders stay locked in code.

**What is tested offline:** every refusal and the one valid path, in `test/executor-real-order.test.mjs`, with a fake broker and a fake phone.

**What is NOT proven until real runs happen:**
- The real shapes of Robinhood's quote time, `order_checks` and place responses. The code refuses whatever it does not recognise, so a wrong guess blocks orders rather than sending a bad one. The terminal tests capture real responses in `executor-tests/raw/`; check those against the code before the first real order.
- That the Windows task starts and runs hidden on this PC.
- The NYSE holiday list in `executor/lib/calendar.mjs`, written by hand and to be checked against nyse.com. After 2027 every day reads as closed until it is extended.

**Reviewed 2026-11-09** by a fresh reviewer agent working only from the code. Its two blockers and seven other findings were all fixed before the pull request:
- **The blockers:** a refused ARM left its code usable on the open channel, and `place` and the watcher could act on the same approval at once.
- **The rest:** holidays, the lock not holding earlier approvals, a silent broker outage, a code echoed in an alert, exit codes, leveraged tickers, and a crash-prone `status`.

**Reviewed again 2026-11-09 (PR #53, 20 findings).** A second, independent review found 20 issues. Every one checked out against the code, and none was wrong. Code fixed 18 of them:
- **The tick lock** now holds a token. A tick only releases its own lock. A stale lock is moved aside before it is taken over, so only one process can win. Every live command is killed after 4 minutes, well before a lock counts as stale (10 minutes). Every network call has a timeout. The state file carries a revision number, so a tick that outlived its lock cannot write old state back over a newer HALT.
- **A missed HALT.** The phone channel only reaches back 12 hours. If the last good read is more than 11 hours old (the PC slept, the task stopped), every approval made before the gap is cancelled, and the phone is told.
- **The test gate** now needs three things. The receipts must be committed. The program version that made them must be in this checkout's history. Robinhood itself must show test zero as cancelled with nothing filled and test one as filled. A receipt file alone proves nothing.
- **The ticket check** is the full SHA-256 of the ticket's contents. A ticket swapped after approval is refused.
- **A fresh approval waits about 90 seconds** before it can place. That leaves time to send HALT.
- **The quote's age** comes from the last-trade time only, and is checked before the buy condition. A stale or missing time means WAITING, never a decision.
- **The watcher runs one pinned executor version.** `node executor/executor.mjs pin`, at your terminal, records a fingerprint of the executor files as you approved them. The book routines commit many times a day; those commits do not touch the pin. Any change to an executor file does, and approved tickets then wait (they are not used up) until you pin again.
- **New codes or lifting the lock** now needs one of your current codes once codes exist, and both send a text to your phone.
- **Drift is capped at 2% of the limit.** The ticket text shows it. A ticket's expiry must fall inside its first trading session, by that day's close, half days included.
- **Approving again:** after a HALT or a cancellation (a phone gap, a missing or changed ticket), a new ARM with your next code approves the same ticket again. A ticket that reached an attempt can never be approved again.
- **The quote** is judged at the moment it was read, both before the attempt and in the final checks, and the account and test-order checks happen before it is read, so slow broker calls cannot turn a fresh quote into a refusal.
- **Following an order:** an order it cannot read is reported once. After its trading day it is no longer followed.
- **The Windows task** calls node and cmd by full path. The launcher scripts are under the same provenance check as the program.
- **Tests** were added for each of these, including forged receipts committed in a real git repo, a HALT older than the window, two ticks at once, `codes --new` without a keyboard, and a crash right after the place call. That last one now ends in `placed_unknown` with one alert and no second send.

**A fresh reviewer then checked those fixes** and found 7 more. The most serious: the first pin was tied to the whole checkout's commit, which the book routines move about 20 times a day, so real orders would have refused almost every morning. Fixed: the pin is now a fingerprint of the executor files, and an unpinned version waits instead of using up the approval. Also fixed: "send a new ARM" did not work after a HALT or a gap; slow account calls could age a fresh quote into a refusal; a refused `codes` left the lock file behind; a stale-lock takeover could take a fresh lock; the test orders were not tied to their receipts' stock. The seventh (no proof possible once every code is spent) and two small leftovers are listed under the open risk below. Its check of those fixes found two more, both fixed: the test orders are now checked at Robinhood once per approval rather than every minute a ticket waits, and an order is refused if more than 60 seconds pass between reading the quote and sending it.

### OPEN RISK, ACCEPTED BY ADAM 2026-11-09 — software on this PC can approve its own order

**Adam's decision, 2026-11-09, in his words: "No, accept risk".** He was asked whether to turn Robinhood's in-app approval tap back on for real orders, given this finding. He was told the damage is capped by the $200 per-order limit and the cash kept in the small account, and that nothing on the PC can prove an approval came from his phone. So there is no Robinhood tap requirement. Do not raise it with him again; it reopens only if he raises it.

**What the accepted risk allows:** a process on this PC can approve tickets through this program without Adam, up to the $200 per-order limit on each ticket, with no limit on how many tickets. A process that skips this program and uses the stored Robinhood token directly is not bound by the $200 limit at all. Its only cap is the cash in the account.

**What caps it:** the cash kept in the trading account ending 7724 (the real ceiling for everything), the $200 per-order limit for anything routed through this program, and the texts to his phone, which give him a chance to send HALT.

**Stated plainly, because it is the real limit of this design.** Anything that runs as you on this PC (malware, a hijacked script, or an AI tool with shell access that goes wrong) can:
- write an approval straight into `~/.bench-executor/real-order-state.json`, or replace the stored code hashes with its own, so the phone is never involved;
- read the Robinhood login token in `~/.bench-executor/oauth.json` and call Robinhood directly, skipping this program and every check in it;
- forge the raw broker captures in `executor-tests/raw/`, which are not committed (that is why the gate now asks Robinhood about the test orders rather than trusting files).

The one-time codes prove an approval came from your phone **only against someone who cannot run code on this PC.** The fix that holds against a local attacker is Robinhood's own "approve trades in the app" tap, which a process on this PC cannot press. You decided against that tap on 2026-11-09 and accepted this risk. What actually limits the damage is:
1. **The cash in the trading account (ending 7724).** Nothing on this PC can spend more than is there. **This is the real ceiling.** Keep only what you are willing to lose in it.
2. **The per-order limit, $200** (`REAL_ORDER_CEILING_USD`). It binds this program, not a process that calls Robinhood with the stolen token.
3. **The test gate.** Same: it binds this program only.
4. **The texts to your phone.** New codes, a lifted lock, a pin, every approval, start and fill all send one. A text you did not cause is your signal to send HALT and check the PC. Once every code is spent, `codes --new` cannot ask for one, so that text is the only guard on new codes.

**Smaller known limits (LOW, left as they are):** the state file save is a read-compare-rename, not one atomic step, so two processes saving in the same instant could both pass the revision check. The tick lock is what keeps two processes from working at once, and the check is a second line. The broker check of the test orders matches them to their receipts by order id and stock; it does not match quantity or time.

### Adam's checklist, in order

Each step is yours because it touches money, your broker login or the running PC.

1. **Merge the pull request** into the checkout at `Projects\apps\the-bench`. The watcher only runs from there.
2. **The most one real order may cost: $200.** Done 2026-11-09, from your words "it's 200 idgaf if it goes to 0". It is `REAL_ORDER_CEILING_USD` in the code, and changes only by a reviewed commit.
3. **Shrink the trading account for the tests.** Move money out of the account ending 7724 until no more than $10 can be spent. It holds about $200 today, and the tests refuse above $10.
4. **Keep Robinhood's "human must approve trades" setting OFF** for now. The tests do not understand approvals.
5. **At your own terminal, on a weekend or after hours, optionally run the queued test.** It places and cancels an order that cannot fill, and it captures real broker responses at almost no risk. It does not unlock anything.
6. **At your own terminal, during market hours, run test zero.** It places an unfillable order and cancels it. You type the two lines it asks for.
7. **At your own terminal, during market hours, run test one.** A real order of $5 or less. You pick the stock.
8. **Have Claude commit the receipts**, and check the captured responses against the code. The gate also asks Robinhood for both test orders by their ids before every real order, so the orders must still be visible in your order history.
9. **Put the money back** in the account, but only what you are willing to lose. See the open risk above: the cash in that account is the real limit.
10. **Pin the executor version, at your own terminal:** `node executor/executor.mjs pin`. It shows the last commit that changed the executor files and asks you to type its first 7 characters. Do it again only after a change to the executor itself; book and routine commits do not need it. Until then approved tickets wait.
11. **Make your codes, at your own terminal and not in a Claude window:** `node executor/executor.mjs codes --new`. The first time it just makes them. After that it asks for one of your current codes first. Save them on your phone; they are shown once.
12. **Register the watcher, at your own terminal:** run `scripts\register-executor-watcher.ps1`. It finds node once and stores its full path in the task. Run it again if you reinstall node.
13. **First real order:** keep it small. When the ticket text arrives, send the ARM line with your next unused code. It places no sooner than about 2 minutes later, and only if the last trade is within the ticket's drift of the limit.

Stop anything not yet placed by sending `HALT` from your phone. Cancel an order already at Robinhood in the Robinhood app. Selling is always yours. If the PC was off or asleep for more than 11 hours, every approval from before is cancelled; send a new ARM with your next code to approve it again. The same works after a HALT.

### Blockers for this mode

- No clean, committed test-zero and test-one receipts exist yet.
- No executor version has been pinned.
- **Accepted by Adam 2026-11-09 ("No, accept risk"), not a blocker:** with no Robinhood tap, the one-time codes are the only proof of approval, and they do not hold against software running on this PC. See the accepted risk above.

*Proof, not hype.*
