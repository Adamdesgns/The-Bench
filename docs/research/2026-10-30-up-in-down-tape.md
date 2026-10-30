# Up 10% in a down market: short it, buy it, or neither? (2026-10-30)

**The question (Adam, after passing on REGN B-1188):** REGN rose 11.9% on its Q3 beat while SPY fell 1.4% and QQQ 2.9%. "So historically a short is probably the right call on a stock up in a crashed market?"

**Short answer: no.** Across 530 cases the short is a coin flip that loses on average. When the jump is an earnings reaction, the stock leaned *up* over the next month. The one group where fading the jump worked was low-priced stocks.

Script: `scripts/up-in-down-tape.mjs` (tests `test/up-in-down-tape.test.mjs`). Full output: `2026-10-30-up-in-down-tape.json`. A base rate is a count of the past, never a buy or sell signal.

## Method

- **Event:** a stock closes up 10% or more on a day SPY closes down 1% or more. 428 names from the prepump universe, October 2017 to October 2026. One event per name per 10 sessions.
- **Returns:** measured from the event close to the close 1, 5, 10 and 20 sessions later. A short at that close makes minus that, before borrow costs.
- **Excess:** the return minus beta × SPY over the same days.
- **Survivorship:** the universe is today's list, so every number leans up. That works against the short.
- **Clustering:** t is clustered by date and again by month. Down days bunch together and the 20-session windows overlap, so the month t is the honest one at 10 and 20 sessions.

## Results

| | n | 10 sessions: mean / median / ended lower | 20 sessions: mean / median / ended lower | 20-session t (month) |
|---|---|---|---|---|
| All cases | 530 | +2.4% / 0.0% / 50% | +7.7% / +2.0% / 46% | 1.19 |
| Earnings reaction | 132 | +2.9% / +2.3% / 45% | +8.2% / +6.1% / 36% | 2.13 (excess 1.31) |
| Not earnings | 398 | +2.2% / −0.8% / 52% | +7.5% / +0.2% / 50% | 1.11 |
| Excluding 2020 | 406 | +1.1% / −0.6% / 52% | +4.6% / +0.8% / 48% | 0.56 |
| Same jump, SPY up | 5,906 | +1.8% / −0.3% / 51% | +4.4% / +0.2% / 49% | 1.99 |

- **For a short, it's a coin flip with a bad tail.** About half end lower at 10 sessions, and the median is zero. But the mean is positive: the ones that keep going run hard (ALTO +337%, LODE +288% in 20 sessions). A short meets that tail.
- **Earnings jumps lean up.** 64% were higher 20 sessions later, with a median of +6.1%. This is the post-earnings drift the desk cited on REGN. It is a lean, not proof: the t is 2.13 on raw returns and 1.31 after the market move is removed.
- **Down market vs. up market:** there's no real difference. The same jump on an up day behaves about the same. "Up in a crash" is not its own signal in this data.

### By size (down-market jumps)

| Group | n | 10 sessions: mean / median / ended lower | 20 sessions: mean / median / ended lower |
|---|---|---|---|
| Low-priced, not earnings | 129 | −1.7% / −6.1% / 63% | +2.3% / −7.7% / 60% |
| Low-priced, earnings | 8 | −3.7% / −9.6% / 75% | −0.7% / −8.1% / 63% |
| Micro, earnings | 26 | +9.8% / +5.0% / 27% | +16.4% / +9.3% / 27% |
| Small, earnings | 64 | +2.5% / +1.9% / 48% | +8.7% / +6.1% / 34% |
| Mid, earnings | 31 | +0.5% / +1.7% / 45% | +3.6% / +2.4% / 39% |
| Large and mega, earnings | 3 | CTSH +4.0, DDOG −16.4, MCK −1.1 | CTSH +11.6, DDOG −20.7, MCK −3.9 |

- **The one place a fade worked: low-priced stocks.** About 60% of those were lower afterwards, with medians around −6% to −8%. Even there, the mean at 20 sessions is positive, because a few squeezed hard.
- **Large caps like REGN: no usable evidence.** There are three cases, and two of them fell. This universe is mostly small and micro caps, so it says little about a $90 billion company.

## What this means for the desk

- **No new rule.** Adam's pass on REGN is reasonable on our long record (longs win about 34%). Shorting REGN would have been the weaker bet: it fights the earnings drift, and the data gives large caps nothing either way.
- **The bet is already logged and scored:** B-1188 (desk long) vs. B-1190 (Adam's pass). 973.99 first means the desk was right; 895.40 first means Adam was.
- **Worth a forward look, not a rule:** fading low-priced stocks that jump in a down market. That would be a new hunter screen, which is a separate job and Adam's call.

## A bug found on the way (fixed)

- **The bug:** `earnings-runup.mjs` read EDGAR's `acceptanceDateTime` as New York time. It is UTC: filings peak at 20–21Z, which is 4–5pm New York, and none land at 08–09Z, when EDGAR is shut.
- **The effect:** after-close earnings filed in the evening were tagged to the wrong day. That moved 42 of this study's earnings events and mis-tagged 3.
- **The fix:** `nyTime()` converts to New York time and uses the New York date. `filingDate` is not used, because it rolls an evening filing to the next business day.
- **Re-check:** a fresh-context reviewer found the bug, and the fix reproduces the corrected numbers it computed independently.
- **The October study was re-run** (`2026-10-30-earnings-runup-rerun.json`): 12,403 events. Its conclusion is unchanged: there is no reliable run-up into a print at any window (best t 1.33, was 1.28). The reaction-day move is now 6.7% absolute against 5.5% before, because more reactions land on the right session.
