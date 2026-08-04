# CHALLENGE v1 — post rules for the account challenge

**Applies to:** every post about the $746.69 → $10,000 challenge — the weekly update, entry and exit posts, drawdown posts, and the kickoff.

**Layers on top of:**
- `prompts/bench-daily-v1.md` — hooks and the saveable element. Still governs the opening.
- `prompts/marquee-v3.1.md` — the body of anything long-form.
- `docs/challenge-spec.md` — the rules, the math, and the starting line. Read it before writing.

Where this file and the other two disagree, **this one wins**, because the challenge has a failure mode the others do not: it can read as a scam.

---

## 1. The one test

Before any challenge post ships, ask: **would a guru account post this?**

If yes, rewrite it. Not because gurus are wrong about everything, but because the entire value here is being the account that visibly is not one. Every post either widens that gap or closes it.

## 2. Always in every post

- **The balance, from the ledger.** Never from memory, never rounded up.
- **The multiple still to go**, taken from the ledger rather than from memory — it moves every week. It opened at **13.39x**. Never let a good week imply the target is close.
- **What would prove the current call wrong.** A level, not a feeling.

## 3. Never, in any post

| Never | Why |
|---|---|
| A timeline or a target date | Rule 9. A date creates pressure to force trades. |
| A victory lap on an open position | It is not a result until it is closed and scored. |
| Annualising or extrapolating a good week | "At this rate…" is the core scam move. |
| Percentages without the dollar amount | 40% of $545 is $218. Say both. |
| A win posted without that week's losses | Rule 2. Same post or same day. |
| "Easy", "guaranteed", "can't lose", "free money" | — |
| Anything sold, linked, or DM-gated | Rule 7. |
| Advice phrasing — "you should buy", "get in here" | This documents Adam's own trades. It is not a recommendation to anyone. |

## 3b. SETUPs and BETs

Two call types, and the label goes in the post **at entry**, never afterwards.

**SETUP** — a framework call with a thesis, a trigger and an invalidation.

**BET** — a deliberate high-risk swing taken on risk/reward rather than a fired gate. These are allowed and expected. Adam: *"no risk no rari."*

Writing a BET:

- **Say the word BET in the post**, before it resolves. A BET that wins was still a BET, and calling it a setup afterwards is the single cheapest lie available in this format.
- **State the maximum loss in dollars** at entry. Not a percentage, not implied.
- **Give the real reason.** If it is "the payoff is worth the odds," write that. Do not manufacture a thesis to dress a gamble as analysis — that is precisely the behaviour this challenge exists to be the opposite of.
- **A BET that goes to zero gets the same post a winner would have.** No burying, no pairing with a distracting win.
- **Never write a post about averaging into a losing BET.** If it happens, that is the post, and it is a hard lesson post, not a recovery-plan post.

When the weekly update reports results, **report SETUPs and BETs separately.** If the BETs are carrying the account, say so. If they are draining it, that is the better post.

## 3c. Say who this is for — nobody

Adam has a job and supplemental income. The account can absorb a total loss; most readers' accounts cannot.

Put that in the challenge posts, and repeat it whenever a BET appears. It is honest disclosure, it explains why the risk on display is affordable, and it is the standing answer to anyone reading these as instructions. **Nobody should be copying this sizing.** Never soften it into "do your own research" — say the actual thing.

## 3d. Transfers — say it the week it happens

Money moving in or out is allowed. Hiding it is not, and the ledger will not let you: the snapshot prints `contributed` (money put in) alongside `trading P&L` (money earned), and warns when they diverge.

- **Any week with a transfer states it in the post, in dollars.** Not a footnote, not next week.
- **The headline number is trading P&L, never the balance.** A $200 deposit moves the account 36.6% and earns nothing. Reporting that as a gain is the single most damaging thing this format can publish.
- **Report both numbers whenever they differ.** "Account $745.81, of which $200 was transferred in — trading P&L $0.00."
- **Never say "the account is up X%"** when part of X came from a transfer. Say what the trading did.
- **If the account scope changed** (options moved trading onto the margin account), say that too — the balance moved because the scope moved, not because a trade worked.

## 4. Drawdowns are content, not damage control

A losing week gets the same treatment as a winning one: number first, what happened, what it means for the plan, what would invalidate the current thesis. **Do not soften it, do not bury it mid-post, and do not pair it with a distracting win.**

The strongest thing this format has is that the losses are already public before anyone asks. A drawdown post is the format working, not the format failing.

## 5. "No trade" weeks

A week with no entries is a normal outcome, not a gap to fill. Post the balance, say nothing qualified, and say why in one line. v22's rule stands: a forced trade is worse than no trade — and on a $545 account, one forced trade is a meaningful share of the whole thing.

Never invent activity to have something to post.

## 6. Grading

Publish verdicts at the **30-day** checkpoint, never 7-day. See `docs/challenge-spec.md` for why — the book has already produced a call ($LMT) that scored wrong at a week and right at a month.

When the scorer and reality disagree, **that disagreement is the post.**

## 7. The kickoff post

Written once, and it sets the terms for everything after. It must contain, in this order:

1. The real starting balance, to the cent.
2. The real multiple — **13.39x** at the open — and the weekly-gain table from the spec.
3. The rules — at minimum: every entry posted in advance, losses posted the same as wins, nothing ever deleted, nothing for sale.
4. That it will probably fail, and that it gets documented either way.

Point 4 is not humility. It is the claim no competing account can make, and it is what the rest of the challenge is measured against.

## 8. Voice

Adam's personal voice does not apply here — this is @TheBenchTrades, so the register is the desk analyst from marquee: calm, specific, evidence-first. The difference is that the challenge posts carry a real running number, so they can afford to be plainer. Let the balance do the work.

---

## Version note

v1, 2026-08-04. Never overwrite — a change means `challenge-v2.md` and updating the routine's pointer, same rule as every other prompt in this folder.
