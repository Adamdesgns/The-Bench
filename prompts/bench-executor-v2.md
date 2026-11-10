# BENCH EXECUTOR v2 — REAL ORDERS, PRE-APPROVED FROM THE PHONE

```text
STATUS: UNTESTED
LIVE EXECUTION: LOCKED until clean, committed test-zero and test-one receipts exist (REAL_ORDER_CEILING_USD set to $200 by Adam, 2026-11-09)
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

- `codes --new` runs only at a real keyboard, shows the codes once, and stores only salted hashes outside the repo. Once codes exist, replacing them or `codes --unlock` needs one current code, and both send a text to the phone.
- An approval waits `MIN_APPROVAL_AGE_SEC` (90 seconds) after it is read before it can place, so a HALT sent right after has time to land.
- The approval records the full SHA-256 digest of the ticket. A ticket changed after approval, in any field, is refused.
- The phone channel only reaches back 12 hours. If the last good read is more than `PHONE_GAP_LIMIT_SEC` (11 hours) old, every approval made before the gap is cancelled, because a HALT could have aged out unread.
- A HALTed or cancelled approval (never attempted) can be approved again by a new ARM with a fresh code. An approval that reached an attempt never can.
- Each code works once, and is spent the moment it appears in any message, before anything else is checked. A refused ARM (a typo, a locked gate, an expired ticket) therefore never leaves a working code readable on the open channel. Messages are handled oldest first, so a copy posted after Adam's message finds the code already used.
- `WRONG_CODES_BEFORE_LOCK` wrong or reused codes lock real orders until `codes --unlock` at the keyboard. The lock also holds tickets approved before it.
- `place`, `watch` and `codes` share one lock in `~/.bench-executor/` and read the state fresh under it, so two of them can never act on the same approval.
- The ticket code ties the approval to the exact order. Changing any term voids it.

**OPEN RISK — what this does not stop:** software running as Adam on this PC, or someone holding his unlocked phone. Local software can write an approval into `~/.bench-executor/real-order-state.json`, replace the code hashes, or take the Robinhood token from `~/.bench-executor/oauth.json` and call Robinhood without this program. The only fix that holds is Robinhood's own in-app approval tap. Adam declined it and accepted this risk on 2026-11-09 ("No, accept risk"). The per-order limit and the test gate bind this program only. **The real limit on damage is the cash kept in the trading account.** Details: `docs/executor-test-protocol.md`, "OPEN RISK".

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
expires_at: <on the date of the first trading session after created_at, no later than that session's close (13:00 on half days)>
maximum_price_drift: <at most REAL_MAX_DRIFT_PCT (2%) of the limit, as $ or %; shown in the ticket text>
place_when:                          # new, required
  type: NOW | LAST_AT_OR_BELOW | LAST_AT_OR_ABOVE
  price: <required unless NOW>
```

## 4. CEILINGS — CHANGE ONLY BY REVIEWED COMMIT

`REAL_ORDER_CEILING_USD` in `scripts/executor-validate.mjs` is Adam's number: $200, set 2026-11-09 ("it's 200 idgaf if it goes to 0"). At zero every real order refuses. It is a limit **per order**, not per day: several approved tickets can each place up to it, held back only by the account's buying power. That is fine while the account ending 7724 holds about $200; funding it higher raises the day's total exposure without any code change. No flag, environment variable or ticket field can raise it. Effective ceiling = min(that constant, the ticket's `executor_absolute_ceiling`, live buying power). The v1 $5 and $10 test limits are unchanged and still govern the tests.

## 5. ORDER OF EVENTS

1. The phone's messages are read. If they cannot be read, nothing happens this tick, because a HALT could be waiting.
2. `HALT` stops every approval made before it. It does not cancel an order already at Robinhood.
3. An ARM becomes an approval only if real orders are unlocked, the ticket exists, its code matches, the ARM is newer than the ticket, the ticket passes its contract, and the one-time code is good.
4. Until the condition is true: no receipt, nothing spent, checked again next tick.
5. Before the quote is read, and without spending anything: the approval must be 90 seconds old, the market open, the executor files must be the version Adam pinned (`executor pin`, typed at the keyboard; a fingerprint of the executor files, so book commits do not affect it), and Robinhood must show the two test orders (test zero cancelled unfilled, test one filled, each for the stock its receipt names; checked once per approval). An unpinned version, or test orders that cannot be read, means WAITING; test orders that do not match end the ticket.
6. The quote's age is read from its last-trade time only, at the moment it was read, before the condition is judged. A quote with no last-trade time, or older than `QUOTE_MAX_AGE_SEC`, means WAITING.
7. When the condition is true, the approval is spent first. Then the attempt: contract, book row, test gate (committed receipts from a version in this checkout's history), the pin again, committed bytes, account, buying power, the same quote's age at its read time, drift, position and open-order conflicts, broker review with no alerts, no more than `QUOTE_TO_PLACE_MAX_SEC` (60 s) since the quote was read, then **place exactly once.**
8. Any refusal ends the ticket. Any unclear result after placing reads `UNKNOWN_REQUIRES_RECONCILIATION`, tells Adam to check the app, and is never retried.
9. A working order is followed through its trading day, and each change is texted. An order it cannot read is reported once. A tick that stopped right after calling place is reported as unknown and never sent again. The program never cancels and never sells.

## 6. WHEN ORDERS MAY GO IN

09:30 New York until 15 minutes before the close, from the hand-written NYSE list in `executor/lib/calendar.mjs`. Holidays wait, and early-close days end at 12:45. Every day after `CALENDAR_KNOWN_THROUGH` reads as closed. The list must be checked against nyse.com, and extended before it runs out. Where an early close was uncertain, the day is listed as a half day on purpose.

## 7. KNOWN OVERLAP WITH THE TEST SWITCH

The typed tests read the same arm channel, so `executor-arm.mjs --status` shows a real-order ARM as "ARMED" for that row. That changes nothing: a test still needs Adam's typed lines. A test's own HALT after placing stops every real approval not yet placed. That is the safe direction.

## 8. NOT IN v2

Selling · stops · options · crypto · shorting · leveraged products (refused from `LEVERAGED_OR_INVERSE_TICKERS`, a partial list, so a fund missing from it is not proof it is plain) · market orders · GTC · extended hours · blanket approvals · retries.

*Proof, not hype.*
