# Self-audit — META and AMD refusals (2026-09-23)
Asked by Adam after the pass audit (docs/pass-audit-2026-09-23.json) showed META +31%
and AMD +28–30% above rows where the desk said no. Judged on the price PATH after each
refusal, not on today's price.

## AMD — variance, not a rule failure. No change.
| row | date | said no at | what happened next |
|---|---|---|---|
| B-029 | 8/4 | 523 (pre-print bet) | fell to 482 the next day, 440.50 low. **Right.** |
| B-028 / B-031 | 8/5 | 473 / 480 (margin miss) | traded 440–521 for six weeks; closed 559.82 on 9/18. |
| B-493 / B-501 | 9/21 | 609 / 615 | ~615 now. Flat. **Not a miss.** |

AMD didn't clear 560 until 9/21, on a brand-new catalyst (the OpenAI 6GW / Oracle
MI450 news). Any August plan with a sane stop would have been stopped out on the way
to 440.50. The August no's were right for six weeks, and the +30% came from news
those rows could not see. Under the Self-Audit Loop, a loss that broke no assumption
is variance. **No rule candidate.**

## META — five refusals, three different outcomes
| row | date | said no at | reason | outcome |
|---|---|---|---|---|
| B-061 / B-066 | 8/11 | 595 / 605 | 1.35:1 to the 200-day and 646 | fell to 537 by 8/19. **Right.** |
| B-201 | 8/26 | 568 (buy at 548) | dip-buy level | 548 never came after 8/26. Unfilled. |
| B-230 | 9/1 | 565 | 1.07:1 to the 20 EMA, 1.76:1 to the 50-day | cleared both by 9/2, hit 690 on 9/18, never near the 523 stop. **Miss.** |
| B-296 / B-300 | 9/9 | 636 / 648 | "no chase" on the Muse gap; the chain didn't follow | held above 642, reached 741. **Miss.** |

Two mechanisms produced the misses:

**1. Moving average as the target (P-059, proposed).** When a stock sits under its
averages, the desk set its target at the nearest one. With the ATR floor holding the
stop at least one day's range away, that makes 2:1 impossible by construction. In a
trending market META went through every average like it wasn't there. A target at the
next real price pivot (690) would have read 2.98:1 on B-230.
**The counter-case, and it matters:** the same fix would also have armed B-061 at
2.95:1, and that one got stopped out for −27.50. So far it's **one win, one loss**:
+~125 points blocked vs −27.50 saved. That's why it's a pattern to track, not a rule.

**2. The news-gap chase rule (P-060, proposed).** v24's Guide Rule already says a
post-earnings move on a new guide is a reaction to trade, not a chase. Nothing covers
a non-earnings company headline. On Muse day the desk refused because the supply chain
didn't follow (P-020), but P-020 was **right**, and "only the shipper reprices" is a
reason to own the shipper. **One instance, held.**

## What changes now
Nothing, by rule. The Self-Audit Loop forbids auto-applying a change, and patterns need
three instances before promotion. Both candidates are on the board with falsification
tests. P-059 is 1-for-2 and P-060 is 1-for-1. Until they earn promotion, every review
where a moving-average target is the only reason R:R fails will also report the R:R to
the next pivot, so the book collects the evidence instead of arguing about it.
