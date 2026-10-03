# v34 proposal: THE DATED-CATALYST RUN-UP LANE

**Status:** ADOPTED 2026-09-29 (Adam: "Fix it") as `prompts/trading-copilot-v34.md`. The lane is paper-only until 5 instances are reviewed.
**Evidence rows:** B-614 (CBRS miss), B-436 (the plan that fired), B-529 (META Muse, the v31 origin).

## The miss

CBRS had OpenAI DevDay (9/29) on the book from 9/17 (B-436), with a written run-up plan: close > 196.71, stop 181.88, target 222.50. The trigger fired on 9/18 (close 198.37 on 10.8M). The stop was never threatened (lowest low since then was 193.61). On DevDay it traded 211.96 (+7.7%) by 09:45 CT.

The desk passed because the plan failed 2:1. From 198.37 it was 1.46:1 (risk 16.49, reward 24.13), and 1.9:1 even with a 1-ATR stop. The 2:1 gate is built for undated breakouts, where the reward has no deadline. A dated catalyst is a different bet: the date does the work, and it limits how long the risk is open.

## The rule

A long qualifies for this lane when all of these hold:

1. **Dated, non-earnings catalyst on the book** at least 5 sessions before the trigger fires. Examples: a product event, a partner's developer day, an FDA date that is not a PDUFA binary, an index inclusion. **Earnings are excluded.** They stay under the existing rules.
2. **The logged trigger fired as written.** The trigger has to be one that was already on the book, not re-drawn after the fact.
3. **R:R at least 1.5:1** to a verified pivot, with the stop at least 1.0 ATR (the ATR Floor still applies). Below 1.5 it is still a pass.
4. **Half-band size.** Risk is at most 5% of equity, not 10%.
5. **Hard exit by the close of event day.** It is never held past the event. The trade is the approach and the day itself, not what comes after.
6. The v33 entry check still applies (the first 30-minute bar holds the trigger, and a no-trade answer stands for the session).

## Why the exit is event-day close, not the session before

Tested on the miss itself: entry at the 9/21 open ~200 and exit at the 9/28 close 196.74 (the session before DevDay) = about −0.2R. The gain came on the event day. An exit before the event would have taken the risk and missed the payoff.

## What it would have done on CBRS

Entry ~200 (9/21 first bar, above the 196.71 trigger), stop 181.88, half band ≈ 145 of risk ≈ 8 shares. Exit by the 9/29 close. At 211.96 that is about +0.66R (~+96). This is one instance. It proves nothing yet.

## The second gap: nobody watched the trigger

B-436 wrote the trigger and passed in the same row. When the trigger fired on 9/18, nothing flagged it. CBRS has no row between 9/17 and 9/29, because a *pass* does not go onto the plan-signal or mind-changer lists the close routine checks. **Proposed fix:** every passed row that carries both a trigger and a dated catalyst is registered so the close routine checks it (`scripts/mind-changer.mjs add` or the plan-signal list), and a fire produces a "trigger fired on a passed plan, re-judge" line in the close read. A re-judge is not an entry. It is a fresh look with the move already underway.

## Guardrails

- **Paper first.** The first 5 qualifying instances are logged as paper rows (`--type conditional` plus a note), scored at the event-day close, before any live money uses the lane.
- **Review after 5**, the same way v30's Option B was reviewed: win rate, average R, and the worst case, against the 0R the current rule produces by passing.
- If the run-ups sell off into the event (the "sell the news" case), it will show in those 5 and the lane dies.
