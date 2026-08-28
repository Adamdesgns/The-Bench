# THE BENCH — the AI-infrastructure beat

**Status:** design approved by Adam 2026-08-21. Not implemented. Build session scheduled Sunday 2026-08-23 10:30a CT (`bench-ai-infra-newsletter-setup`).

**What this replaces:** whole-market coverage. Everything in `prompts/bench-daily-v2.md` about *what* we cover is superseded. The hook rules and the saveable requirement survive; the six-mandatory-sections structure does not.

---

## 1. The problem this solves

Adam, 2026-08-21: *"I think we're trying to cram too much information into some of them."*

He is right, and it is measurable. The last 25 published posts were counted:

| | Measured |
|---|---|
| Posts that are exactly 6 parts | **24 of 25** |
| Character range | 1,320 – 1,575 |
| Typical part length | 230 – 260 of the 280 cap |

`bench-daily-v2.md` says "three to six parts" and "under 280 characters." The routines collapsed that into **always six, always full**. A day with one real thing to say produces the same brick as a day with five.

**Two causes, both structural — this is a prompt-file defect, not a writing problem:**

1. **Six mandatory sections → six parts, every time:** setup / who is in control / the names / THE LEVEL / SENTIMENT / THE READ. The SENTIMENT part (`bench-daily-v2.md` section 0.5) is required in *every* post whether or not sentiment is that day's story.
2. **No format variety.** Every post is the same size and shape, so the timeline has no rhythm — six identical bricks a day.

**Correction on the record, so it is not repeated:** an earlier version of this analysis argued for cutting to 2 posts/day by counting *thread parts* as posts (6 posts × 6 parts = "36 posts"). That is wrong — it is 6 posts. Adam rejected the cut and he was right to. **Post count was never the problem. Uniformity was.**

---

## 2. The beat

**AI infrastructure, full stack.** Adam's reasoning: *"I mean you're ai. Might as well!"*

Not silicon only. Silicon is the most crowded corner of finance X; we would be the ten-thousand-and-first NVDA account. The full stack includes the physical buildout — power, cooling, networking — which is where the actual bottleneck is and which almost nobody covers with numbers.

**The spine a reader can follow: money starts at the hyperscaler capex line and flows down.** Every story sits somewhere on that chain, which gives posts a shape instead of a list of tickers that moved.

### The board — every ticker verified against live Robinhood fundamentals 2026-08-21

| Layer | Tickers |
|---|---|
| **The buyers** | MSFT, GOOGL, AMZN, META — the capex line that funds everything below |
| **Silicon** | NVDA, AMD, MU, AVGO |
| **The box** | SMCI, DELL, ANET |
| **Power & cooling** | VRT, ETN, GEV, PWR, CEG, VST, TLN |
| **The crypto bridge** | CORZ, IREN, APLD, WULF |

**`LTH` is removed from the board.** It is Life Time Group Holdings — gyms and spas, Consumer Services, 44,000 employees, founded 1992. It had been on the "AI board" and nobody had checked. The old board was never designed; it accreted. **Verify a ticker's actual business before adding it.**

**The crypto bridge is not a stretch — it is from the companies' own filings.** Core Scientific runs Mining *and* Hosting segments. Applied Digital splits "Data Center Hosting" from "HPC Hosting." TeraWulf is "Digital Asset Mining and HPC Leasing." IREN is a vertically integrated data centre business "powering the future of Bitcoin, AI and beyond."

This answers Adam's standing ask — *"we'll rotate into crypto when it starts jumping off"* — with **no format change and no beat change.** When crypto moves, these names move, and they are already on the board.

---

## 3. The angle: divergence

**The recurring story is the gap between the layers, not whichever layer is green.**

Adam initially framed it as *"let's always watch the bull markets, it's where the money is made."* The tension: as of 2026-08-21 **not one name on this board is at a 52-week high.** Distance from 52-week highs at Friday's close, all verified:

```
WULF  -47.6%    VST  -38.0%  (and 2.68% above its 52-week low)
APLD  -46.4%    TLN  -30.4%  (and ~4% above its 52-week low)
IREN  -45.5%    CEG  -33.9%
CORZ  -41.5%    VRT  -31.0%
MU    -23.0%    GEV  -20.0%
AMD   -19.3%    ETN  -12.3%    NVDA  -9.2%
```

Only ETN (Aug 12), DELL (Aug 13) and ANET (Aug 5) printed highs this month.

**Adam chose divergence over chasing strength**, and the reasoning holds: chasing whatever is green inside the beat is the same instinct that produced the six-part bricks, just in a smaller universe. The divergence is the thing only a desk watching all five layers every week can see.

It also sets up the trade that matters — **when the power leg turns, that is the tell that the buildout re-accelerated**, and we will have been on it for months with receipts.

---

## 4. Two lanes

Adam: *"the only other issue is sometimes you find me gems like zyme that we're in too lol"*

A strict beat would discard those. So there are two lanes, with different promises:

| | THE BEAT | THE BOOK |
|---|---|---|
| Trigger | Scheduled | Event-driven only |
| Content | AI infrastructure, the divergence | Anything we hold a logged call in, or a dated catalyst inside a week |
| Promise | "Here is what the buildout is doing" | "Here is what our book is doing" |
| Example | The Vistra/Nvidia divergence | ZYME — position + 8/25 PDUFA |

A name Adam is actually in is **more** on-brand as a position note than as a random ticker post, because the book is append-only and public. Off-beat names do not dilute the beat when they run in a different format with a different promise.

---

## 5. Cadence and the format menu

**6–8 posts per day. Adam's call, stated directly:** *"no chance we're doing 2 posts bud... I think about 6-8 posts a day good. Every post doesn't need to be a 6 part thread."*

The fix is **size variety**, not fewer posts. Six posts drawn from this menu is roughly 12–15 tweets instead of 36, and no two look alike.

| Format | Parts | Notes |
|---|---|---|
| **The one-liner** | 1 | A single number with a consequence. Post it and stop. **NEW — never done** |
| **The chart drop** | 1 + image | **NEW — never done.** The playbook flags media on nearly every Assembly original; we ship almost none |
| **The short read** | 2–3 | One layer, one idea |
| **The divergence** | 4–5 | The flagship. Worked example in §7 |
| **The receipt** | 1–2 | A graded call from the book with its original timestamp |
| **The position note** | 2–3 | The BOOK lane |
| **The explainer** | 3–5 | How one piece of the buildout actually works, anchored to a live number. **NEW** |
| **The ownership math** | 3–4 | What N shares costs and what it pays. **NEW — UNSCHEDULED, opportunistic only** |

### The ownership math — the CMS hook, inverted

Adam, 2026-08-21: *"I do like the way CMS does his posts — 'you mean if you buy 4000 shares of this you'll make this much per year by doing nothing!' Let's work those in just not scheduled yet. If you see something let me know and we'll work it out."*

**This format is NOT on a schedule.** It fires only when a number is genuinely striking. Claude flags a candidate, Adam decides. No routine may generate one unprompted.

**The straight version does not work on this board, and the arithmetic says so.** Every AI-infrastructure name is a low or near-zero yielder, because the capital is going into capacity rather than to shareholders. At Friday 2026-08-21 closes:

| 4,000 shares of | Costs | Pays per year |
|---|---|---|
| Vertiv | $1,048,000 | **$1,000** |
| Micron | $3,866,872 | $2,400 |
| Quanta | $2,560,000 | $1,760 |
| GE Vernova | $3,826,560 | $8,000 |
| Eaton (the board's best) | $1,677,040 | $17,600 |

To earn $50,000/year in dividends you would need ~$4.8M of Eaton or ~$7.4M of Vistra.

**So we run it inverted, and it is a better post than the original.** CMS's version says *look how much free money*. Ours says *look how little these pay, and here is why that is the bullish tell* — a company still building does not hand cash back. That turns an income post into a teaching post about capital allocation, and it lands on the beat instead of beside it.

**Guardrails, non-negotiable:**

1. **Never present yield as free money.** The share price adjusts on the ex-dividend date; the dividend is not additive to total return. A post implying otherwise is the exact hype this desk exists not to produce.
2. **A high yield is frequently a distress signal** — yields rise because prices fall. Any high-yield name gets its payout ratio and dividend coverage checked before it appears in a post, not after.
3. **Publish the arithmetic, not the yield field.** `get_equity_fundamentals` returns `dividend_yield` and `dividend_per_share`, and on 2026-08-21 they disagreed slightly on every name checked (ETN: 1.031% reported vs 1.049% computed from 1.10 × 4 ÷ 419.26). Show `shares × annual dividend` so a reader can check it themselves; do not quote a yield figure whose derivation we cannot reproduce.
4. **Never frame it as a recommendation to buy N shares.** The framing is "here is what this costs and what it returns," not "buy this and collect."
5. **Sizes must not imply a book we do not have.** The account's real book is small and public. A 4,000-share illustration is a thought experiment about the business, and the post must read that way.

### The explainer — why it matters more than it looks

Adam, 2026-08-21: *"remember in the assembly... let's get more like that. people love to learn too."*

He is pointing at the format that made The Assembly. Their highest-reach post — *"A 25 year old just turned $225 million into $5.5 billion in 12 months. Here's exactly what he bought"* — is **a teaching post**: 9.2M impressions and **23,138 bookmarks**. Per the playbook, bookmarks are the heaviest positive signal in X's ranker, heavier than likes, and saveable beats clever. A post someone saves to re-read is worth more than a post they agree with.

This fits the AI-infrastructure beat better than any other format we have, because **almost nobody understands the buildout physically.** Why gas turbines carry multi-year lead times. What a grid interconnect queue is and why it gates a data centre. Why HBM is the memory that matters. What a transformer shortage actually means for a capex guide. Why a bitcoin miner can convert to AI hosting at all — and why some can't.

That material is evergreen, genuinely useful, and it is the single strongest differentiator available: every other account posts *that* NVDA moved. A desk that explains *how the machine works* is a desk worth following between the moves.

**Rule that keeps it honest: every explainer anchors to a live, checkable number** — a real lead time, a real capex figure, a real price. Teaching without a number is a thread-boy essay; teaching with one is research.

**Sunday build priority, approved by Adam: the one-liner and the chart drop first.** They are the two formats the account has literally never produced, and they are the ones that make the timeline feel varied between the bigger threads.

### Cadence context, recorded honestly

Adam cited an account posting ~160×/day. That is **CMS Invests, already in our own research**: 798 posts in 5 days, 23,069 followers — and **92.6% of those posts are replies into other people's comment sections** (338 different accounts in 5 days). It is a distribution grind, not broadcast, and **6% of his posts carry 85% of his reach.** The Assembly, by contrast: 8.2 posts/day (including thread continuations, so ~4 originals), 509,065 followers, median original reach 196,589.

Volume is not the variable — 160/day gets 23K, 8/day gets 509K. **At 6–8 posts/day we run roughly double The Assembly's cadence.** That is a deliberate choice by Adam, made with these numbers in front of him, on the reasoning that the account still needs to be seen. Recorded so a future session does not "discover" the discrepancy and quietly cut it.

---

## 6. Prompt-file changes

**New file `prompts/bench-daily-v3.md`. Never overwrite a version** — new integer file, and update the pointer line in every routine that references v2.

Changes from v2:

- **Section 0.5 SENTIMENT stops being mandatory.** It appears when fear or positioning *is* the story, not as a tax on every post. This is the single biggest driver of the six-part brick.
- **The six mandatory sections are retired** and replaced by the format menu in §5. Part counts run **1–5**, chosen by what the post has to say.
- **The beat is defined** (§2 board) and the routines stop covering the whole market.
- **Survives from v2 unchanged:** the hook rules (§1 — open on a checkable number, make it strange, open loop, verdict last), the saveable-element requirement, the chain mechanics (three-dash separator, 280/part, 1 cashtag/part), and the disclaimer line.

**Also to change on Sunday:** the six `bench-*-post` SKILL.md files get repointed at the beat and the format menu. The FRESHNESS GATE added to all six on 2026-08-21 stays exactly as written.

---

## 7. Worked example — the divergence format

Written and validated 2026-08-21 on Friday's verified closes. **4 parts, 979 characters** against a recent average of 6 parts / ~1,450. Never published; this is the reference implementation.

```
Nvidia is 9% off its high.

The company that sells the electricity to run Nvidia's chips closed Friday 2.7% above its 52-week low.

Same buildout. Opposite tape.

Here is what that gap is telling you.
---
Priced like the boom is on:
$NVDA -9.2% from its high. Eaton -12.3%.

Priced like it is already over:
Vistra -38%. Constellation -34%. Talen -30%.

The market is paying for the chips. It is not paying for the power to run them.
---
It is worse for the companies converting bitcoin mines into AI data centers.

From their 52-week highs: TeraWulf -48%. Applied Digital -46%. IREN -45%. Core Scientific -42%.

That is the seam where AI meets crypto, and it is the most discounted link in the chain.
---
THE LEVEL: Vistra 132.66 - the 52-week low from May 19.

Holds, and this gap is a rubber band.

Loses it and the power leg is in a fresh downtrend - the thesis is on hold no matter what Nvidia does.

Proof, not hype. @TheBenchTrades. Not financial advice. Educational only.
```

Part lengths 200 / 227 / 263 / 273. One cashtag total (`$NVDA`, part 2); every other company spelled out, which is how you list five names under the one-cashtag rule.

**Why it works where the current format does not:** it has **one idea**, and every part serves it. No "who's in control," no sentiment tax, no roll-call of eight tickers that moved. Part 3 is the second-read moment — it turns "power stocks are down" into the AI/crypto seam.

---

## 8. The Sunday newsletter

**Decided:** a weekly catalyst newsletter ships every Sunday. **Not yet designed** — this is the main work of the 2026-08-23 session.

Open questions, none of them decided:

- **What is it made of?** A forward catalyst calendar for the board is the obvious spine — earnings dates, capex guides, product launches, supply agreements. `db/catalysts.json` and `scripts/insider-check.mjs` already exist and feed it.
- **What format?** X chain, long-form X Article, or off-platform. **The chain format is currently mandatory per `bench-daily-v2.md` section 0**, so choosing anything else is a deliberate rule change that must be written into v3, not assumed.
- **Does it collide with the existing weeklies?** `bench-challenge-weekly` runs Sundays 9:01a CT and `bench-receipt-weekly` Mondays 11:03a CT. Three weekly formats may be one or two too many.

---

## 8b. The weekend — added 2026-08-22

Adam: *"We look behind on Saturday and look ahead on Sunday?"* Yes, and it resolves the three-weeklies problem in §8 rather than adding to it.

| | **Saturday 11:03a — `bench-week-recap`** | **Sunday 11:03a — `bench-weekly-catalyst`** |
|---|---|---|
| Looks | back, with receipts | ahead, with dates |
| Content | levels we published in advance, and what the tape did to them + the 30-day receipt | the forward catalyst calendar for the board |

**The Saturday recap absorbed `bench-receipt-weekly`, which is now DISABLED** (paused, not deleted — SKILL.md kept, same as `bench-queue-daily-check`). Every guard from it was carried over verbatim and none are optional: 30-day checkpoints only and **never a 7-day verdict** ($LMT scored WRONG at a week and RIGHT at a month); **no cherry-picking** — take the most recently due, and if any due call is a loss or an expensive pass you must take one of those; never a verdict on an open position; `db/receipt-posted.json` tracking so nothing posts twice; the **guru test**; and losses given identical prominence to wins.

**This recap is deliberately NOT The Assembly's recap.** Theirs is a highlight reel — *"we covered $FLY +60%, $OUST +46%"* — a marketing claim the reader must take on trust. Ours is what we published **before** the outcome was known, misses included, from an append-only timestamped book. That asymmetry is the whole strategic position (§"The one thing they cannot copy back" in the growth playbook).

**The evidence that this is the right call, from the week of 2026-08-17:** 71 book rows, **only 3 with a graded outcome, and all 3 losses.** A highlight reel was not available. But the material is outstanding — GDS entered at 34.40 on the published buy zone, stopped at 32.60, realized **−$28.82 against a planned risk of $28.80; the two-cent difference is the SEC fee.** Held 24 hours and 52 seconds, filled at exactly the named level with zero slippage, and the stock then traded *below* the exit. Next to it in the same book, HPQ stopped at 0.11 ATR — inside the noise band — and recovered above its fill. That is the v25 ATR Floor tested live in both directions in one week. **A loss landing within two cents of its own forecast proves the process in a way no win can**, because a win can be luck.

Expect most weeks to look like this: the majority of rows are passes or untriggered conditionals and are not gradeable. That is normal, not a failure, and the format is built for it.

## 9. Explicitly not decided

- ~~Which of the six daily routines survive, merge, or retire.~~ **SETTLED 2026-08-22.** All six keep their schedules — Adam's 6–8 posts/day stands and nothing was cut on the daily side. A proposed two-week deferral on *weekly* consolidation was **reversed by him the same night**: *"We're not waiting 2 weeks to fold it in. Everything starts Monday."* The full lineup goes live Monday 2026-08-24 with no phased rollout. The only consolidation made was folding the Monday receipt into the Saturday recap (§8b).
- Whether the chart drop needs a chart-generation script, and what renders it.
- Whether the reply game (the CMS model) is ever revisited. Declined in July, unchanged here.
- ~~How the beat handles a day when nothing on the board moves.~~ **RESOLVED by the explainer format** (§5). A quiet tape is exactly when you teach: the explainer needs no catalyst, only a live number to anchor to. This replaces the old answer — "a quiet tape does not need a post" — which was correct when every format required a market event, and is now unnecessarily restrictive. The gate that survives: **never force a market read out of a tape that did not give one.** Teaching instead of manufacturing a move is the point.
