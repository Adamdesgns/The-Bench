# Is pump watch's 1.5x volume test too easy in the morning? (2026-11-09)

**Answer: yes, until about 11:00 CT.** The test divides today's volume by the 20-day average times the share of the session gone by, as if volume came in evenly. It does not. By 09:00 CT, 7.7% of the session has passed and a normal day has done 17.1% of its volume, so a perfectly average day reads 2.2x at the first read the watch can make.

**Fixed the same day, on Adam's word ("Yes, fix it").** Pace is now today's volume against what a normal day has done by this minute. The 1.5x bar is unchanged. See "The fix" at the bottom.

## What was measured

27 names (every ticker ever on pump watch plus the liquid board), 59 sessions from 2026-08-17 to 2026-11-06, 1,593 full name-days. Yahoo 5-minute bars with junk volume trimmed to the official day total by `trimToDayVolume`. The normal-day curve was learned on the 783 name-days before 2026-09-28 and tested on the 810 after it, so it could not flatter itself. Half days are excluded. "Ordinary" means the day finished within 0.8x to 1.2x of its prior 20-day average. "Really heavy" means it finished at 1.5x or more, which 16% of test days did.

| Time CT | Session gone | Normal day's volume done | An average day reads | Ordinary days clearing 1.5x | All days clearing: today's test / real curve | Of those, really heavy: today's test / real curve |
|---|---|---|---|---|---|---|
| 09:00 | 7.7% | 17.1% | 2.22x | 82% | 77% / 19% | 21% / 59% |
| 09:30 | 15.4% | 25.5% | 1.65x | 56% | 53% / 18% | 29% / 66% |
| 10:00 | 23.1% | 32.1% | 1.39x | 30% | 36% / 18% | 41% / 68% |
| 10:30 | 30.8% | 38.2% | 1.24x | 16% | 28% / 18% | 51% / 69% |
| 11:00 | 38.5% | 43.6% | 1.13x | 6% | 22% / 18% | 63% / 73% |
| 11:30 | 46.2% | 48.1% | 1.04x | 2% | 19% / 17% | 71% / 77% |
| 12:00 | 53.8% | 52.1% | 0.97x | 0% | 16% / 17% | 83% / 80% |

At 09:00 CT, clearing today's test says almost nothing: 21% of those days finished really heavy, against 16% of all days. The same 1.5x bar measured against a normal day picks out days that are 59% likely to finish heavy.

## What it has cost so far

All 19 pump-watch calls recorded from 2026-11-04 to 2026-11-09, on real volume at the minute each fired: 18 clear 1.5x on today's test and 16 on the normal-day curve. The watched names mostly had real volume, so the clock let only two through.

| Call | Today's test | Against a normal day | Day finished |
|---|---|---|---|
| AMAT DOWN, 11/05 09:01 CT | 2.95x | 1.38x | 2.24x |
| AMZN DOWN, 11/09 09:55 CT | 1.90x | 1.33x | 0.61x as of 12:51 CT |

AMZN's call took the last of the day's four judge slots. At 10:35 CT NVDA's DOWN, about 6x against a normal day, was recorded with no judge because the cap was used up. AMAT cuts the other way: its day really was heavy, and at 09:01 the curve would not have made that call.

## Limits

Nineteen calls is a small sample. This measures whether the volume test means what it says, not whether the calls made money. The 2026-11-09 day totals are as of 12:51 CT. The 59 sessions are one market stretch.

## The fix

`server/pumpWatch.js` now holds `NORMAL_DAY_SHARE`: the share of a day's volume normally done by each 5-minute mark, the median of all 1,593 name-days (27 names, 59 sessions, 2026-08-17 to 2026-11-06). Pace = today's volume / (20-day average x that share at this minute). An average day now reads about 1.0x at every mark from 09:00 to 12:00 CT, where the even clock read 2.22x at 09:00.

`node scripts/volume-curve.mjs` rebuilds the curve from fresh bars and prints how far it has moved from the shipped table. It only prints. The table changes by hand, with Adam's word.

**Replay of all 19 recorded calls on final day totals:** 17 clear 1.5x on the even clock, 14 on the curve. (The counts above, 18 and 16, used mid-day totals for 11/09 and the learn/test half of the curve.) Three calls would not have fired:

| Call | Even clock | Normal-day curve |
|---|---|---|
| AMAT DOWN, 11/05 09:01 CT | 2.95x | 1.34x |
| AMD UP, 11/09 09:00 CT | 2.99x | 1.34x |
| IREN UP, 11/09 09:20 CT | 2.10x | 1.18x |

AMZN and GOOGL on 11/09 are under 1.5x on both clocks; they fired live only because of the junk-bar volume fixed earlier that day (a88f2a9). On 11/09 the three would have left judge slots for NVDA's 10:35 DOWN, about 4.9x, which was capped.

Three fresh reviewers checked the code, the curve and the tests: no defects, and a fresh generator run reproduced the shipped table exactly.

**More limits.** Half days are read at the same clock minute, unscaled, and no half day has been measured (next: Friday 2026-11-27). The 5-minute bars add up to about 85% of the official day; the rest is the closing auction, so the curve jumps to 100% at the close. The curve is pooled across names, not per name. The replay is rebuilt from trimmed bars, so each figure is close, not exact. Past calls in `db/pump-watch.json` are the record and were not rewritten.

**The crowd log, fixed later the same day (Adam: "Yes, fix it"):** `scripts/crowd.mjs` had its own even-clock volume pace feeding the FOMO score. It now divides by the same curve (its average is still the prior 30 daily bars). New records carry `pace_clock: "normal-day"`. Records without that tag used the even clock, so their morning pace and FOMO volume input read high; they are the record and were not rewritten. A `report` that ranks by FOMO score mixes the two clocks. Half days carry the same limit as pump watch: during a half-day session the pace reads high, because the curve is for a full day.

**Not changed, Adam's call:** the framework's Company Catalyst Lane (v36) asks for 2x volume "at full-session pace".
