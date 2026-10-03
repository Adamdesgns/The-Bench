# Entry audit - 2026-09-24 (Adam: "Yes" to "find exactly how we're picking bad entry points")

Realized on account 6137 since 9/1: -$116.57 over four exits (ASPN -64.32, UBER -38.22 and -11.76, GOOGL -2.27). Holding with no stop would be $9.48 worse on the two stop-outs as of 10:02 CT 9/24, so the exits were not the leak. The entries were.

## Every entry signal since 9/1, with what happened

| Event | What the rule did | Result from signal/entry |
|---|---|---|
| GOOGL 9/1 zone (B-231) | Taken, 5 sh at 335.255 | +1.1% (338.92) |
| UBER 9/11 close signal (B-362) | Taken 9/14, 27 sh at 71.84 | -4.1%, stopped at 68.90 |
| ORCL 9/11 close signal (B-361) | Void, 9/14 gapped down | -3.8% avoided |
| ETN 9/11 trigger (B-363) | Not enterable, 9/14 gapped down | -7.6% avoided |
| LITE 9/15 close signal (B-406) | No chase, 9/16 opened above zone | +11.7% missed |
| IREN 9/16 close signal (B-430) | No chase, 9/17 opened above zone | +10.4% missed |
| ASPN 9/22 zone (B-524) | Rule said NO at 9:02 (B-531/B-533); we re-planned and bought 5.665 midday | -5.9%, stopped at 5.33 |
| ETN 9/23 close signal (B-546) | Void, first bar closed under 438.26 | -0.7% avoided so far |

## What it shows

1. **The biggest single loss came from overriding the rule.** The 9:02 entry check said no trade on ASPN on 9/23 because the first bar closed above the zone. The desk rewrote the plan with a higher ceiling after Adam's challenge and the fill came midday at 5.665. -$64.32 of the -$116.57 is that override.
2. **The void-on-gap-down rule is 3 for 3.** ORCL, ETN 9/11 and ETN 9/23 all opened under their zones and all kept falling.
3. **The no-chase-on-gap-up rule is where the money was left.** LITE and IREN both opened above their zones the morning after the signal and ran about 10-12%. The one gap-up we did buy (ASPN) was bought late near the high, not at the open, and failed.
4. **The rule-following loss was UBER:** a support-zone buy in a stock down 9% in two weeks with lower highs every week. Close location and short trend did not separate winners from losers in this sample (LITE won from a 0.29 close location and a -6.3% trend; ETN lost from 0.87 and +5.6%).

## What it does not show

Eight events is a small sample. P-064 (open direction after a zone signal) is logged at 4 of 5 holding and stays a pattern until it has a real record. Nothing here justifies a rule change on live money yet.

## Proposal (awaiting Adam)

1. **No overrides.** When the 9:02 check says no, the answer is no for that day, including when the desk is the one rewriting the plan.
2. **Paper-test the gap-up entry for the next 10 zone signals:** entry at the first 30-minute bar close when it opens above the zone, stop under the signal day's low (or 1 ATR, whichever is wider), tracked beside the current rule. After 10, the better record becomes the rule. No money at risk during the test.
