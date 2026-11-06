# What the US open did after a KOSPI breaker and after a QQQ crash day

2026-11-05 night, interactive, Adam: "research historically what's happened at market open for the us markets". Prompted by KOSPI tripping its 8% circuit breaker at the 2026-11-06 open (9:03 KST, 4,923.47, -8.55%), one session after QQQ fell -6.49% (691.95 -> 647.05), SMH -11.2%, MU -17.5% and EWY -13.5% on Thursday 11/5.

Script: `docs/research/scripts/2026-11-05-us-open-after-crash.mjs` (zero-dep, Yahoo daily bars from period1=0; `range=max` silently returns MONTHLY bars, do not use it for daily work). Read-only. No rule changed.

**This is a graded count of the past, never a buy signal (v28).** Grade: **C**. The samples are small, overlap heavily (2000-01 and 2008 are most of them) and early-2000s QQQ opens from Yahoo look unreliable (2000-04-17 shows QQQ +11.5% on a day the Nasdaq rose about 6.6%).

## A. US session on the same date as a KOSPI breaker-size drop

Korea's session ends before the US opens on the same calendar date, so the US session dated D is the first one to trade after a KOSPI crash on D. "Breaker-size" = KOSPI traded 8%+ under its prior close. 27 US sessions (1997-2026; 11/6 not yet traded).

| | gap at open | open -> close | whole day | 5 sessions |
|---|---|---|---|---|
| SPY median | -0.39% (33% up) | +0.51% (59% up) | -0.48% (44% up) | +0.57% (63% up) |
| QQQ median | -0.86% (32% up) | 0.00% (44% up) | -0.97% (32% up) | +0.37% (60% up) |
| SMH median | -1.02% (33% up) | +0.20% (54% up) | -1.59% (33% up) | -0.99% (42% up) |

Two in three times the US opened lower. After that it was a coin flip. A KOSPI crash by itself tells you about the gap and little about the day.

**12 of the 28 Korea days are in 2026** (3/4, 3/9, 6/8, 6/23, 6/26, 7/2, 7/7, 7/13, 7/28, 7/29, 10/15, 11/6). That matches Korea JoongAng Daily calling 11/6 the 11th first-level breaker this year. Most 2026 Korea crashes came after a quiet US day (QQQ between -2% and +1.4%), so Korea was moving on its own and the US shrugged it off (QQQ day moves -3.3% to +1.6%).

**11/6 is different: Korea is following a US crash, not leading one.** The closest past cases are KOSPI breaker days where QQQ had fallen 4.5%+ the session before:

| Korea date | QQQ day before | QQQ that US day | QQQ gap | QQQ open->close |
|---|---|---|---|---|
| 2000-04-17 | -8.66% | +11.51% | -2.94% | +14.88% (suspect data) |
| 2008-10-16 | -8.96% | +5.42% | +0.69% | +4.71% |
| 2008-10-22 | -5.18% | -2.76% | -0.35% | -2.42% |
| 2008-11-06 | -5.21% | -4.47% | -1.56% | -2.95% |
| 2011-08-09 | -6.02% | +4.82% | +1.50% | +3.27% |
| 2020-03-13 | -9.17% | +8.47% | +5.50% | +2.82% |
| 2026-06-08 | -4.80% | +1.56% | +1.81% | -0.24% |

5 of 7 up days. Both down days were inside the 2008 crash.

## B. The session after QQQ itself closed down 6%+ (the better analog)

29 sessions, 1999-2025 (20 of them in 2000-01, 4 in 2008, 3 in March 2020, 1 in 2011, 1 in April 2025). Baseline over every QQQ session: open->close up 52%, median +0.06%.

| | median | up |
|---|---|---|
| gap at open | +0.14% | 15/29 (52%) |
| open -> close | **+1.93%** | **20/29 (69%)** |
| whole day | +2.71% | 17/29 (59%) |
| 5 sessions | +2.94% | 22/29 (76%) |
| gap filled during the day | | 22/29 |

- The gap is a coin flip. What happens AFTER the open leans up.
- Gapped up: closed above the open 11 of 15. Gapped down: 9 of 14.
- Since 2010 at the looser -5% line (10 sessions): gapped up, closed above the open **5 of 5** (+0.39% to +3.80%). Gapped down, 2 of 5. Five cases each is an anecdote, not a rule.
- SMH closed down 10%+ only twice before 11/5 (2020-03-12, 2020-03-16). Both next sessions gapped up and closed higher (+9.7%, +8.1%). n=2.
- The worst next-day cases: 2001-03-12 (-6.2%), 2000-12-20 (-5.7%) and 2008-11-06 (-4.5%). All three were inside bear markets that kept going.

## What it says about Friday 11/6

At ~8:10pm CT on 11/5, after-hours quotes had QQQ 652.94 (+0.9%), SMH 454.15 (+1.4%), MU 678.00 (+3.3%) and EWY 133.43 (+1.4%), with Korea at -7.8% (live Yahoo, after the halt). History says the first US session after a -6% QQQ day leans up from its open, more so after a gap up. It also says the bad exceptions were in bear markets, and SMH's 200-day switch went OFF on 11/5 (`db/bull-watch.json`). No call is made and no row is logged. Pattern **P-070** records the claim with its falsification test, and 11/6 is its first forward instance (score it after the close: did QQQ close above its open?).

## Data notes

- Yahoo's in-progress KOSPI daily bar for 11/6 showed low -13.59% / close -12.58%. The live 5-minute chart at the same moment showed 4,963.22 (-7.81%), day low 4,911.28. **Never trust Yahoo's in-progress daily bar for KOSPI.**
- Yahoo's US daily bars ended at 11/4 that night. The 11/5 closes above come from the Robinhood MCP's official closes.
