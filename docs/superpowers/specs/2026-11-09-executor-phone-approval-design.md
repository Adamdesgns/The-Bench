# Executor real orders with phone approval: design

**Status: DRAFT, nothing built yet.** Adam answered "No" to requiring the Robinhood tap (relayed 2026-11-09 from the session that started this one). The remaining decisions below are his.

## What Adam gets

1. The desk makes a BUY call and logs its row. It writes a ticket file and texts Adam the exact order plus the line to send back, such as `ARM B-1386 K7F2QX <code>`.
2. Adam pastes the next unused one-time code from his phone in place of `<code>` and sends the line from the ntfy app.
3. He can do that ahead of time, for example the night before or before work. The approval holds until the ticket's own expiry, at most that day's close, so he does not have to answer during the day.
4. The program waits for the ticket's condition, checks the code, runs every guard, and places the order. No further tap.
5. Every step reaches his phone and is written to a receipt. The arm and the code are used up after one attempt.

## Pre-approval (Adam, 2026-11-09: "I want to pre approve and forget about it")

One approval covers one specific ticket: ticker, side, maximum dollars, limit price, the condition that fires it, and an expiry no later than that day's close. A ticket with no condition is placed once the market is open. A ticket with a condition is checked once a minute and placed the first time the condition is true. If the condition never comes true, the ticket expires and nothing happens.

**Not built: a blanket approval** such as "the desk may buy anything up to $X". That would have an AI choosing and placing real orders with nobody approving them, which is the line this project's fixed rule draws. A ticket that arrives during the workday still needs its own approval to run.

**Buys only.** Selling at a target or stop is not automated in this version. Protective stops have never been tested on this program, so exits stay manual until that is built and proven.

## The two findings that shaped this

**A phone ARM cannot prove it came from Adam.** The arm channel is an ntfy topic (a public message board with a hard-to-guess name), with no login. Its name sits in the repo, in `executor/lib/arm.mjs` and `scripts/executor-arm.mjs`. Any program on this PC, an AI session included, could post `ARM B-###` and the executor could not tell the difference. So with the Robinhood tap out, the ARM has to carry its own proof.

**A fixed passcode would not work.** The topic keeps messages readable, and the program itself reads the last 12 hours of it. Anything that can see the topic could copy a fixed code after its first use.

**If the Robinhood approval setting is ever ON,** "place" only creates a request for Adam to tap, and the place call returns an approval instead of an order. The tap is not required, but the program must not misread that response. It reports "waiting on your tap in Robinhood" and treats anything it cannot identify as unknown.

## Approach

| Option | Result |
|---|---|
| **One-time codes (recommended)** | Free, one paste on the phone. A used code is worthless to anyone who reads it |
| Login-protected arm channel, posting password only on the phone | Stronger, because nothing on this PC could post at all. Needs a new account, possibly a fee, and more setup |
| Plain ARM with no code | Simplest, but an AI or bad script could trigger a real order. Breaks the rule that the yes must come from Adam |

**How the codes work:** Adam runs a small setup command at his own terminal, outside any AI session. It shows about 20 codes once, and he photographs them or saves them on his phone. The PC keeps only salted hashes (scrambled fingerprints that cannot be turned back into the codes), outside the repo in `~/.bench-executor/`. Each code works once. Three wrong codes lock real-order mode and alert his phone until he resets it at the terminal.

## What gets built

- **`place --handoff <file>`** in `executor/executor.mjs`, separate from the test flow. The typed-line tests stay as they are.
- **New contract file** `prompts/bench-executor-v2.md` with a v2 handoff schema. v1 stays untouched.
- **Ticket code:** six characters computed from the row, plan, ticker, action, shares, limit and account. Editing the order after the text went out stops the code matching, so the program refuses.
- **Handoff writer** `scripts/executor-ticket.mjs`: writes the file and sends the text. It never arms.
- **Code setup** `scripts/executor-codes.mjs`: terminal only, refuses without a real keyboard and inside an AI session.
- **Approval tools** added as a separate binding used only by real-order mode, to read and report the state.
- **Offline tests** with fake broker responses for every refusal and the one valid path.

## Refusals, all with no retry

- No clean, committed `test-zero` and `test-one` receipts. A hand-written receipt that is not committed does not count.
- No live arm for this exact row and ticket code, an arm older than the ticket, a ticket past its expiry or past that day's close, or an arm message already used. The arm text the old `executor-arm.mjs` script writes has no ticket code or one-time code, so it cannot arm a real order.
- One-time code missing, wrong, already used, or the code file unreadable.
- Any `order_checks` alert on the review.
- Over the per-order limit, or the account, buying power, drift, position, open-order or risk checks fail.
- Quote too old or its time unreadable. The current preflight does not check this, so real-order mode adds it.
- Market closed, plan expired, duplicate `plan_id`, or any broker response it does not recognise.
- Started from inside a Claude or Codex session. This is a trip wire against mistakes, not a wall, and the docs will say so.

## Decisions for Adam, one at a time

1. ~~Require the Robinhood tap on every real order?~~ **Adam: No.**
2. How the ARM proves it came from Adam. **Recommended: one-time codes.**
3. The most one real order may cost, in dollars. His number.
4. How the program starts with no terminal open. **Recommended:** a small watcher that checks for an ARM once a minute during market hours, registered as a Windows task by Adam, with no AI in the loop. A `HALT` from the phone or switching off the task stops it.

## Honest limits

- One-time codes are weaker than the Robinhood tap. Software with write access to this PC could replace the stored hashes with its own, or change the program, and then nothing stands between it and an order. The codes stop a stray or tricked AI session from posting an ARM. They do not stop a deliberate attack on this PC.
- Anyone holding Adam's unlocked phone has the codes.
- With no tap, the per-order dollar limit is the main cap on damage from any mistake.
- Everything here is tested offline only until Adam's terminal tests leave receipts.
