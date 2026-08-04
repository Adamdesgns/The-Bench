# THE BENCH — growth playbook

**What this is:** the evidence behind `prompts/bench-daily-v1.md`. That file is the rule set the daily routines follow. This file is why those rules exist, so a future session can argue with them from data instead of taste.

Source: two finance accounts profiled 2026-07-28 by pulling their real post history through The Bench's own X API keys. 1,709 posts. Full write-up in Adam's vault as `X Growth Recon — CMS Invests & The Assembly`.

**All figures are a 2026-07-23 → 07-28 snapshot.** Reach numbers age fast. The playbook is the durable part.

---

## Two models, and why we copy one of them

| | CMS Invests | The Assembly (@InTheAssembly) |
|---|---|---|
| Followers | 23,069 | **509,065** |
| Posts | 798 in 5 days | **911 total, ever** |
| Per active day | ~160 | **8.2** |
| Median original reach | 24,628 | **196,589** |
| Following | 1,156 | **4** |
| Lifetime likes given | 27,050 | **908** |

**CMS is a distribution engine.** 92.6% of his posts are replies into other people's comment sections — 338 different accounts in 5 days, median one like each. 6% of his posts carry 85% of his reach. It works, slowly: 23K followers in two years, and it costs a full-time day.

**The Assembly is pure broadcast.** It has replied to another human 33 times in four months. 398 of its 431 "replies" are replies to itself — thread continuations. It follows 4 accounts. 221 million impressions in four months.

**The Bench copies The Assembly.** We do not run a reply game. Not as a tactic we haven't got to yet — as a decision. The Bench is a research desk, and a research desk publishes.

## What produces The Assembly's reach

1. **Hook, then payoff.** *"A 25 year old just turned $225 million into $5.5 billion in 12 months. Here's exactly what he bought."* → 9.2M impressions, 23,138 bookmarks. A concrete number and an explicit open loop. Not a thesis.
2. **Threads, not one-liners.** Hook post, then a self-reply chain. That is what the 398 self-replies are.
3. **Built to be bookmarked.** Median 88 bookmarks per original, peaks near 30K. Bookmarks are the heaviest positive signal in X's ranker — heavier than likes. Saveable beats clever.
4. **Media on nearly every original.**
5. **A fixed posting window.** 02:00–18:00 ET, peak at noon, zero posts 7pm–1am on any day. That is a scheduler, and we already have one.
6. **The track-record recap as the conversion post.** *"In the last 2 weeks we covered: $FLY +60%, $OUST +46%, $TE +42%… Follow us with notifications on."* → 3.2M impressions. Their single highest-leverage recurring format.

## What we do not copy

- **Contradictory hot takes.** CMS posted *"This is why you don't invest into the S&P 500…"* at 6am and *"This is why you invest into the S&P 500…"* at 9pm on 2026-07-27. That is a format, not a thesis, and it is the exact opposite of proof-not-hype.
- **The reply grind.** Wrong shape for a research desk and unaffordable in hours.
- **Their numbers as a target.** They peaked in May and have been decaying since — more posts, a third of the reach:

  | Month | Originals | Median reach |
  |---|---|---|
  | April | 46 | 173,542 |
  | **May** | 90 | **411,416** |
  | June | 97 | 228,756 |
  | July | 101 | **134,462** |

  Copy the format, not the trajectory.

- **Unpaid curiosity.** Their hooks work because the post delivers. A hook whose promise the evidence cannot cover is a lie with better formatting, and it costs us the only asset we have.

## The one thing they cannot copy back

Their recap is a **marketing claim**. Ours is `db/archive.json` — one row per review, append-only, written before the outcome was known, with the misses recorded next to the wins. Their reader has to trust them. Ours can scroll back.

That asymmetry is the entire strategic position. Everything in `bench-daily-v1.md` exists to get more people to the point where they see it.

## Honest baseline

At the time of writing, @TheBenchTrades: **89 followers, 382 posts, following 35.** The data pipeline is not the problem — six scheduled routines already pull live Robinhood quotes, catalysts, volume and web sentiment, which is more than either account above has. The gap is packaging.

## Open question

Neither account's follower *growth* is measurable through the API — only post performance. Any claim about how fast either grew is unverifiable from here, including CMS's own.
