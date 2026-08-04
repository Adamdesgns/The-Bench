# THE BENCH — the account challenge

**$746.69 → $10,000, documented in public, start to finish.**

Explicitly against the "I turned $500 into $50k in a week" genre. Adam's words: *"no bullshit I did it in 7 day scam vibe."*

**There is no fixed method.** The framework in this repo (`prompts/trading-copilot-v22.md`) is the default — mechanics, gates, consistent gains — but it is not a cage. Adam's terms, 2026-08-04: *"there are no real rules to how we get to 10,000 we might even place a gamble on the way but it will all be documented and nothing too irresponsible. but no risk no rari."*

So the promise is **not** "we followed a system." The promise is **"you saw every call before it resolved."** That is the only thing being claimed, and it is the only thing that has to hold.

This document is both the internal spec and the public rules. That is deliberate: the rules are the product, so there is no private version.

## The starting line

Pulled live from Robinhood on **2026-08-04**. The challenge capital sits in **two** accounts — the same money, split so options are reachable:

| Account | Type | Holds | Value |
|---|---|---|---|
| **Agentic ••••7724** | cash, level 2 | 1 GOOGL @ $332.38 cost + $168.72 cash | $545.81 |
| **Margin ••••6137** | margin, **level 3** | $200.88 cash, allocated for options | $200.88 |
| | | **Total** | **$746.69** |

| | |
|---|---|
| Account value | **$746.69** |
| Equity | $377.09 |
| Cash | $369.60 |
| Options | $0 |

Recorded as row 1 of `db/challenge.json`, `accounts: ["769507724", "929016137"]`.

**This corrected an earlier error.** Row 1 was first written as $545.81 — Agentic only — before the $200.88 in the margin account was identified as challenge money already moved across for options. Tracking one account would have made that $200 look like a loss the moment it left, and made it invisible where it landed. The arithmetic that caught it: Agentic buying power went $65.97 → $368.72 after the LTH cancel, then read $168.72, and exactly $200 turned up in an otherwise-empty options account.

## The honest math, stated up front

**$746.69 → $10,000 is 13.39x. That is +1,239%.** Not 10x. Say the real number.

Steady compounding is the only version of that anyone can actually plan:

| Weekly gain | Weeks to $10,000 | Roughly |
|---|---|---|
| 2% | ~131 | 2.5 years |
| 5% | ~53 | 12 months |
| 10% | ~27 | 6 months |
| "7 days" | — | not arithmetic, a lie |

Sustained 10%/week is exceptional, not a plan. Publishing this table in post one is the strongest anti-scam signal available and no competitor will copy it, because it makes the timeline sound slow. It is slow. That is the honest part.

### Two structural constraints

- **The larger account is a cash account.** Agentic ••••7724 settles T+1, so there is no same-day recycling of proceeds there. Fewer swings per month than a margin account allows.
- **Options run out of the smaller account.** Level 3 is on margin ••••6137, which is why $200.88 was allocated there. So the options budget is bounded by what sits in that account, not by the whole balance — moving more across is a decision, and one that gets logged.

## Risk posture — stated intent, not yet a rule

Adam, 2026-08-04: *"We'll keep a diverse portfolio and try not to risk more than our profit per week. or more than a $200 loss no real set rules on it yet though. we'll figure it as we go."*

Recorded as **intent**, deliberately not hardened into an enforced rule, because he did not commit to one and inventing a threshold he never agreed to would be worse than having none:

- keep the portfolio diversified rather than concentrated in one name
- prefer risking accumulated profit over principal
- a rough ceiling around **$200** on a single loss

**One thing to know about the profit rule: it cannot bind yet.** Week 1 profit is $0, so "risk no more than the week's profit" would mean risking nothing at all. Until there is realised profit to risk, the **$200 ceiling is the only one of the two that does any work** — and $200 is 27% of the account, which is a real number worth seeing written down.

The weekly routine **reports** against this posture without blocking anything: if a single position risked more than $200, the update says so. Drift is then visible in the record rather than argued about later. When Adam firms this up, it moves out of this section and into the rules above.

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

## How we get there — two call types, labelled at entry

The book already carries this distinction from the scout log (`docs/scout-log.md`), where SMCI was logged as *"BET (defined-risk)"*. The challenge formalises it.

**SETUP** — the default. A framework call: thesis, trigger, invalidation, benchmark. Graded the normal way at 30 days.

**BET** — a deliberate high-risk swing taken because the risk/reward looked worth it, not because a gate fired. Earnings reactions, defined-risk option positions, an asymmetric crypto entry. Allowed, expected, and **not** something to be embarrassed about — *no risk no rari*.

The rules that make a BET honest rather than reckless:

1. **It is called a BET in the post, at entry, before it resolves.** Never reclassified afterwards. A BET that wins was still a BET.
2. **The maximum loss is stated in dollars at entry**, not as a percentage and not implied.
3. **It is never dressed as analysis.** If the honest reason is "the payoff is worth the odds," that is what the post says. Manufacturing a thesis for a gamble is the exact dishonesty this challenge exists to avoid.
4. **A BET that goes to zero gets the same post a winner would have got.** Rule 2 applies with no exceptions.
5. **A losing BET never gets averaged into.** Doubling down to rescue a bad bet is the mechanism that turns "aggressive" into "irresponsible."

`hodl`/`final_call` in `db/archive.json` carries the label, so the scorer can report SETUPs and BETs separately. **Their records are published separately too** — if the BETs are carrying the account, the reader deserves to know that, and if they are draining it, that is the more interesting post.

### Why the risk is affordable, stated publicly

Adam has a job and supplemental income. This account is **not** rent money, and that is worth saying out loud in the challenge, twice over:

- It is the honest disclosure — the reader deserves to know the risk tolerance on display is funded by a paycheque, not desperation.
- It is also the answer to *"why would you gamble part of it?"* The account can absorb a total loss. Most people watching cannot say that about theirs, and they should not copy the sizing.

**Nobody should be following these trades.** Say it plainly and often. Rule 8 already forbids advice phrasing; this is the reason behind it.

## Transfers and options — both allowed, both documented

Adam, 2026-08-04: *"we can still transfer funds and use options. just document it."*

### Two different things, and only one of them is a deposit

**Internal transfer — the normal case.** Adam moves challenge money between his own accounts, usually Agentic ••••7724 → margin ••••6137 to reach option level 3. *"still the agentic acct money."* This creates no new capital, so `contributed` does not move and `deposit` is 0. **The ledger must cover both accounts**, otherwise money leaving 7724 reads as a loss and the same money arriving in 6137 is invisible. That is what the `accounts` field is for.

**External deposit — new money from outside.** Allowed, but **deposited dollars can never be counted as earned ones** — that is the specific dishonesty every account-challenge scam runs on, and it is why this needs a rule rather than a ban.

The distinction matters in the arithmetic: an internal transfer between two tracked accounts nets to zero and needs no adjustment; an external deposit raises `contributed` and earns nothing.

So the ledger tracks two numbers and **both publish every week**:

| | |
|---|---|
| **contributed** | the starting balance plus every deposit, minus every withdrawal — money *put in* |
| **trading P&L** | account value minus contributed — money *earned* |

Worked example: on a $545.81 balance, a $200 external deposit lands it at $745.81, which naively reads as +36.6%. The ledger reports **trading P&L $0.00**, prints `NOTE: $200.00 of this account was transferred in, not earned`, and states that the headline for any post is trading P&L, not the balance. Enforced in `server/challenge.js`; the arithmetic refuses a deposit that arrives as a string, because a skipped deposit would silently become profit.

**The challenge is scored on trading P&L, not account value.** Account value is always reported — it is the real number in the real account — but "how far to $10,000" measured against a balance you can top up means nothing. If a transfer is ever large enough that the two numbers tell different stories, the post leads with trading P&L.

Every week with a transfer says so in the post, in dollars, the week it happens. Not in a footnote.

### Options

Options are in. That may mean trading the **margin account ••••6137**, which is where option level 3 actually landed — the challenge account ••••7724 is cash at level 2.

So every ledger row records an `accounts` list of what it covers, and `scopeChanged()` flags any change between rows. Widening from one account to two moves the balance **without a trade happening**, and an unexplained jump is exactly what would make the record look cooked. The script prints:

```
!! account scope changed: [769507724] -> [769507724, 929016137].
   The balance moved because the scope moved. Say so in the post.
```

A defined-risk options position is normally a **BET** under the rules above: label it at entry, state the maximum loss in dollars, and never reclassify it afterwards.

## The ledger

`db/challenge.json` — append-only, one row per snapshot:

```json
{
  "date": "2026-08-04",
  "total_value": 746.69,
  "equity_value": 377.09,
  "cash": 369.6,
  "options_value": 0,
  "deposit": 0,
  "accounts": ["769507724", "929016137"],
  "source": "robinhood-mcp",
  "note": "Starting line. Agentic 7724 ($545.81) + margin 6137 ($200.88, allocated for options at level 3). Same money, two accounts.",
  "pct_from_start": 0,
  "multiple_to_target": 13.39,
  "pct_of_target": 7.5,
  "contributed": 746.69,
  "trading_pnl": 0,
  "pct_return_on_contributed": 0
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

$746.69 to $10,000 on an account this size is genuinely unlikely. The rules are written so a failed challenge is still true and still worth reading: every call timestamped, every loss posted, the arithmetic stated at the start. **Say that out loud in post one.** A documented failure is a better asset than an undocumented success, and it is the only version of this that cannot be faked.
