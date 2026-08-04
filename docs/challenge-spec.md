# THE BENCH — the account challenge

**$545.81 → $10,000, documented in public, start to finish.**

Explicitly against the "I turned $500 into $50k in a week" genre. The method is the framework already in this repo (`prompts/trading-copilot-v22.md`) — mechanics, gates, and consistent gains. Adam's words: *"no bullshit I did it in 7 day scam vibe."*

This document is both the internal spec and the public rules. That is deliberate: the rules are the product, so there is no private version.

## The starting line

Pulled live from Robinhood on **2026-08-04**, account **Agentic ••••7724** (cash, option level 2):

| | |
|---|---|
| Account value | **$545.81** |
| Equity | $377.09 — 1 GOOGL @ $332.38 cost |
| Cash | $168.72 |
| Options | $0 |

Recorded as row 1 of `db/challenge.json`.

## The honest math, stated up front

**$545.81 → $10,000 is 18.32x. That is +1,732%.** Not 10x. Say the real number.

If the gains are *consistent*, which is the entire premise:

| Weekly gain | Weeks to $10,000 | Roughly |
|---|---|---|
| 2% | ~147 | 2.8 years |
| 5% | ~60 | 14 months |
| 10% | ~31 | 7 months |
| "7 days" | — | not arithmetic, a lie |

Sustained 10%/week is exceptional, not a plan. Publishing this table in post one is the strongest anti-scam signal available and no competitor will copy it, because it makes the timeline sound slow. It is slow. That is the honest part.

### Two structural constraints

- **It is a cash account.** Settlement is T+1, so there is no same-day recycling of proceeds. Fewer swings per month than a margin account.
- **Options level 3 is on the wrong account** — it landed on the margin account ••••6137, not Agentic. Spreads are unavailable here until support moves it, so the challenge starts with shares and level-2 options only.

## The rules

1. **Every entry is posted before the outcome is known**, with the level and the invalidation. A trade not posted in advance is not part of the challenge.
2. **Losses post identically to wins** — same format, same prominence, same week.
3. **Nothing is deleted or edited after the fact.** Corrections are new posts.
4. **The balance comes from the broker, never typed by hand.** Enforced in code: `validateSnapshot` refuses any row where `total_value` does not reconcile with equity + cash + options within two cents.
5. **"No trade" is not a failure.** v22 already holds that a forced trade is worse than no trade. A flat week gets a flat-week post.
6. **Drawdowns get their own posts.** If the account halves, that is content.
7. **Nothing is sold.** No paid group, no affiliate links, no "DM me." The benchmarked account funnels to a paid community and a bot; that is the specific thing not to copy (`docs/growth-playbook.md`).
8. **Claude never places a trade.** Adam executes every order. The system reads, drafts, and documents.
9. **No public deadline.** A date creates pressure to force trades, which breaks rule 5 and is the mechanism that turns these challenges into blowups.

## The ledger

`db/challenge.json` — append-only, one row per snapshot:

```json
{
  "date": "2026-08-04",
  "total_value": 545.81,
  "equity_value": 377.09,
  "cash": 168.72,
  "options_value": 0,
  "source": "robinhood-mcp",
  "note": "Starting line. Agentic cash account 7724.",
  "pct_from_start": 0,
  "multiple_to_target": 18.32,
  "pct_of_target": 5.5
}
```

Written only by `scripts/snapshot-challenge.js`, which refuses to overwrite a date, refuses a date earlier than the last row, refuses a non-reconciling total, and refuses a missing `source`. A move of ±30% or more since the previous row prints a warning to confirm it is trading P&L and not a deposit — a deposit that reads as a gain would be the single most damaging error this format can make.

Rules live in `server/challenge.js` (pure, 16 tests in `server/challenge.test.js`).

## How calls are graded

The challenge reuses the book, not a parallel system. Every challenge trade gets a row in `db/archive.json` and is scored by `scripts/score-book.js`.

**Verdicts publish at the 30-day checkpoint, never at 7 days.** This is not a preference. Scoring the book on 2026-08-04 showed $LMT scored **wrong** at 1 week (−0.72%) and **right** at 30 days (+11.64%, alpha +11.34); MSFT went +4.7% at a week to +21.5% at a month. Publishing 7-day verdicts would mean publishing losses that were wins. The 7-day mark is still recorded — it is just not a receipt.

### The credibility trap to avoid

The 30-day scoreboard currently reads **8 right, 0 wrong, 1 flat — with 17 of 26 not scorable.** Zero losses is what nobody believes, and posting it as a headline reads exactly like the accounts we are distinguishing ourselves from.

**Lead with the weakness.** 17 unscorable rows is the real story: 8 hedges with no recorded entry, 5 conditionals whose trigger levels were never written down, and HYPE unpriceable. And lead with $LMT — the call our own scorer got wrong at 7 days. "Here is what our scorecard got wrong, and here is what we changed" is a stronger opening than eight checkmarks, and it is true.

## Cadence

- **Weekly** — `bench-challenge-weekly` scheduled routine: snapshot the balance, read the week's closed rows, draft the update, publish through the existing `x-poster` path.
- **Per trade** — entries and exits post through the existing six daily routines, under the rules above.
- **On a drawdown** — its own post, same week it happens.

## If it fails

$545.81 to $10,000 on a cash account without spreads is genuinely unlikely. The rules are written so a failed challenge is still true and still worth reading: every call timestamped, every loss posted, the arithmetic stated at the start. **Say that out loud in post one.** A documented failure is a better asset than an undocumented success, and it is the only version of this that cannot be faked.
