# BENCH EXECUTOR v2 — REAL ORDERS, PRE-APPROVED FROM THE PHONE

```text
STATUS: UNTESTED
LIVE EXECUTION: LOCKED until REAL_ORDER_CEILING_USD is set and clean, committed test-zero and test-one receipts exist
ALLOWED MODE: OFFLINE TESTS ONLY
```

v1 (`prompts/bench-executor-v1.md`) stays the contract for the typed terminal tests and is unchanged. This file is the contract for `node executor/executor.mjs place` and `watch`. Everything v1 refuses, v2 refuses, except where this file says otherwise.

## 1. WHO APPROVES

Adam, one specific ticket at a time, ahead of time if he wants. He sends this from his phone:

```text
ARM B-### <ticket code> <one-time code>
```

- No AI session arms, confirms or places. `insideAiSession()` refuses `place`, `watch` and `codes` when an AI session's markers are set. That is a trip wire against mistakes, not a wall.
- There is no blanket approval. One approval covers one ticket.
- Adam ruled out a second tap in the Robinhood app (2026-11-09: "No" and "Just my approval"). If Robinhood's own approval setting is on anyway, the program reports the order as waiting on his tap.

## 2. WHAT PROVES THE APPROVAL IS HIS

The arm channel has no login and its name is in the repo, so an `ARM` line alone proves nothing. Each line carries a one-time code Adam alone holds.

- `codes --new` runs only at a real keyboard, shows the codes once, and stores only salted hashes outside the repo.
- Each code works once, and is spent the moment it appears in any message, before anything else is checked. A refused ARM (a typo, a locked gate, an expired ticket) therefore never leaves a working code readable on the open channel. Messages are handled oldest first, so a copy posted after Adam's message finds the code already used.
- `WRONG_CODES_BEFORE_LOCK` wrong or reused codes lock real orders until `codes --unlock` at the keyboard. The lock also holds tickets approved before it.
- `place`, `watch` and `codes` share one lock in `~/.bench-executor/` and read the state fresh under it, so two of them can never act on the same approval.
- The ticket code ties the approval to the exact order. Changing any term voids it.

**What this does not stop:** software that can rewrite the program or the stored hashes on this PC, or someone holding Adam's unlocked phone. With no tap, the per-order limit is the main cap on damage.

## 3. THE CONTRACT — `bench-execution-handoff-v2`

The v1 schema (`prompts/bench-executor-v1.md` §3), with these changes:

```yaml
schema_version: bench-execution-handoff-v2
executor_version: bench-executor-v2
framework_version: v36 or later
action: BUY                          # selling stays manual
quantity_mode: shares                # whole shares only
exit_owner: MANUAL                   # no stop is placed; the whole position is at risk
planned_dollar_risk: <shares × limit>
expires_at: <at most 16:00 New York on its day, at most 30 hours after created_at>
place_when:                          # new, required
  type: NOW | LAST_AT_OR_BELOW | LAST_AT_OR_ABOVE
  price: <required unless NOW>
```

## 4. CEILINGS — CHANGE ONLY BY REVIEWED COMMIT

`REAL_ORDER_CEILING_USD` in `scripts/executor-validate.mjs` is Adam's number. At zero every real order refuses. No flag, environment variable or ticket field can raise it. Effective ceiling = min(that constant, the ticket's `executor_absolute_ceiling`, live buying power). The v1 $5 and $10 test limits are unchanged and still govern the tests.

## 5. ORDER OF EVENTS

1. The phone's messages are read. If they cannot be read, nothing happens this tick, because a HALT could be waiting.
2. `HALT` stops every approval made before it. It does not cancel an order already at Robinhood.
3. An ARM becomes an approval only if real orders are unlocked, the ticket exists, its code matches, the ARM is newer than the ticket, the ticket passes its contract, and the one-time code is good.
4. Until the condition is true: no receipt, nothing spent, checked again next tick.
5. When it is true, the approval is spent first. Then the attempt: contract, book row, test gate, committed bytes, account, buying power, fresh quote (`QUOTE_MAX_AGE_SEC`), drift, position and open-order conflicts, broker review with no alerts, then **place exactly once.**
6. Any refusal ends the ticket. Any unclear result after placing reads `UNKNOWN_REQUIRES_RECONCILIATION`, tells Adam to check the app, and is never retried.
7. A working order is followed until it fills or dies, and each change is texted. The program never cancels and never sells.

## 6. WHEN ORDERS MAY GO IN

09:30 New York until 15 minutes before the close, from the hand-written NYSE list in `executor/lib/calendar.mjs`. Holidays wait, and early-close days end at 12:45. Every day after `CALENDAR_KNOWN_THROUGH` reads as closed. The list must be checked against nyse.com, and extended before it runs out. Where an early close was uncertain, the day is listed as a half day on purpose.

## 7. KNOWN OVERLAP WITH THE TEST SWITCH

The typed tests read the same arm channel, so `executor-arm.mjs --status` shows a real-order ARM as "ARMED" for that row. That changes nothing: a test still needs Adam's typed lines. A test's own HALT after placing stops every real approval not yet placed. That is the safe direction.

## 8. NOT IN v2

Selling · stops · options · crypto · shorting · leveraged products (refused from `LEVERAGED_OR_INVERSE_TICKERS`, a partial list, so a fund missing from it is not proof it is plain) · market orders · GTC · extended hours · blanket approvals · retries.

*Proof, not hype.*
