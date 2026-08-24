# BENCH DAILY v4 — hooks, saveables, and the sentiment read

> *Changelog v3 → v4 (draft shape only — 2026-08-24):*
> - **STANDALONE IS THE DEFAULT.** Section 0 no longer says "everything is a chain." Default draft is one post, one idea, shareable with zero context. Prefer 1 post.
> - **`---` THREADS ARE OPTIONAL.** Use them only if each part would stand alone as its own post (no "see above," no reply-dependence). Part 2+ of a chain is a reply; replies hide reach.
> - **Sunday catalyst** = one post, not a 5-part reply chain. **Morning reminder** = a quote-RT or a new standalone, not a reply to yesterday.
> - Voice, openings, saveable-element, sentiment-read, numbers-first, banned words, and the disclaimer are unchanged from v3.

> *Changelog v2 → v3 (two corrections Benny-v1 already flagged — 2026-08-24):*
> - **THREADS ARE LIVE.** Section 3 no longer says "NOT YET ENABLED." `post_next.py` chains on a line of exactly three dashes (`---`) alone on its line. Section 0 already mandated chains; section 3 now matches the poster.
> - **BOOKMARKS ARE NOT THE HEAVIEST RANKER SIGNAL.** The saveable element stays required. The ranker claim is dropped — The Bench's 2026-08-13 algorithm article records that the open-sourced ranker has no bookmark term in the scoring sum.
> - *Everything else from v2 is intact* — the Sentiment Read, the hook rules, the opening/saveable ownership, auto-publish via `post_next.py --auto`.

> *Changelog v1 → v2 (one addition — THE SENTIMENT READ, Adam 2026-08-12: "can we add a sentiment read to the daily runs"): every scheduled post now carries a required sentiment element — section 0.5 below. Everything else from v1 is intact.*

**Who follows this:** all six scheduled routines in `~/.claude/scheduled-tasks/bench-*` — pre-market, state of the market, midday pulse, power hour, closing bell, trending snapshot. Plus any future daily routine.

**Why it exists:** the routines already pull excellent data. What they lose is the reader, in the first two lines. See `docs/growth-playbook.md` for the evidence.

---

## 0.5 THE SENTIMENT READ — required element in every daily post

**Every scheduled post carries one SENTIMENT READ, as its own thread part** (like the saveable — it must stand alone in a screenshot, under 280 chars). It answers one question: *what does the crowd already believe, and what breaks if they're wrong?*

**The three inputs (all live-pulled, never invented — label anything unverifiable "unverified"):**
1. **The fear price:** VIX level + direction (Robinhood index quote) and CNN Fear & Greed number + label (read via Jina: `curl -sSL "https://r.jina.ai/https://www.cnn.com/markets/fear-and-greed"`). One word on what it prices: complacent / braced / panicked. VIX under ~15 = no hedges on, fragile to surprise; over ~30 = braced, bad news lands on shock absorbers.
2. **The reaction test:** the session's most-watched print or headline vs how the tape actually took it — name the gap in one line. Good news sold = distribution. Bad news bought = sellers exhausted. A beat that can't hold its bounce = supply in charge (P-001/P-006/P-008 are the receipts — cite the pattern ID when one applies).
3. **The crowd's position:** the hottest board name's FOMO stage, phrased as *who is left to act* — "everyone who was going to buy already has" beats "Late FOMO" for a reader.

**Format (one thread part, this shape):**
```
SENTIMENT: VIX 14.6 (no hedges on) · Fear&Greed 61 Greed.
Reaction test: SMCI missed revenue and rallied 19% — the guide outranked the print (P-008).
Crowd: SPCX buyers are now people who heard a rumor. Fragile, not bearish.
```

**The hard rules:** sentiment is a *fragility* gauge, never a timing signal — the read says how cushioned the market is, not which way it goes next; extremes can run for months, so no "top is in / bottom is in" calls from sentiment alone. Never paste a sentiment number without its consequence.

---

## 0. ONE STANDALONE POST — this outranks everything below

**Default: one post, one idea, shareable with zero context.** No `---` line. The reader who sees only this post gets the number, the saveable, and the payoff.

A chain's part 2+ is a **reply**. Replies hide reach. That is why v3's "everything is a chain" / "three to six parts" rule is retired. Prefer 1 post.

**Long form is still retired.** Not reduced, not reserved for market updates — retired. A standalone daily is a single post, not a 600-word article and not a reply chain.

**One cashtag (`$TICKER`) max** on a standalone post. Same platform limit as before: X 403s two or more. Dollar *amounts* are not cashtags and are unlimited.

### How to write the default

No separator. Same material, one surface:

```
Three of the five biggest companies in America are red before the bell.
The S&P is green anyway.
SOXX is up 4.2%. MU +4.4%, AMD +4.0%, NVDA +1.6%.
THE LEVEL: SPY 760. Hold it and 765 is the next air pocket.

Proof, not hype. @TheBenchTrades. Not financial advice.
```

### `---` threads — optional, gated

`post_next.py` still splits on a line of **exactly three dashes**, alone on its line, and posts a chain (part 1, then each following part as a reply). **It refuses the whole thread if any part would truncate.** Do not change the poster. Do not write `---` unless **every part would work as its own post** — no "see above," no "as I just said," no payoff that only exists in part 1. If a part needs the one before it, it is not a thread. It is one post. Cut, don't chain.

The separator must be alone on its line, so a dash inside prose never splits a post by accident.

### Two recurring drafts

- **Sunday catalyst:** one post. Not a 5-part reply chain.
- **Morning reminder:** a quote-RT of the prior post, or a new standalone. Not a reply to yesterday.

### Why

Reach is the entire reason and it is not a matter of taste. A reply is not a timeline surface. The hook post is. Write that post so it can travel alone.

**This rule wins over any structural advice further down this file, and over the routines' own instructions.** Where a section below still says "its own thread part," "three to six parts," or "write the chain," it is describing the v3 shape. Write one post.

## SCOPE AND PRECEDENCE

This file owns exactly two things:

1. **The opening** — the first ~280 characters, the part that appears in a timeline before anyone clicks.
2. **The saveable element** — the thing in the post a trader would want to find again at 3pm.

`prompts/marquee-v3.1.md` still owns the **body** of every long-form article: the signal hierarchy, the narrative spine, the craft directives, the kicker. Nothing here overrides it below the opening.

**Where they conflict on the opening, this file wins.** Marquee says "land the nut graf early" — still true, but the nut graf is not the first line any more. It moves down.

Everything else in the routine is unchanged: same data pulls, same threshold gates, same `queue/` + `approved/` split, same `post_next.py --auto` publish, same push. **The disclaimer line stays exactly as it is** — the auto-publish gate rejects any draft without it.

---

## 1. THE HOOK

The old opening states the conclusion. The reader now knows the answer and has no reason to continue.

> ❌ The Market Just Decided Who Pays for AI — and Who Gets Paid
> SOXX is up 4% before the bell while Microsoft, Amazon and Alphabet all trade lower. That is not noise. That is the AI trade finally learning to tell a customer from a supplier.

The new opening states a **fact strange enough to need explaining**, then promises the explanation.

> ✅ Three of the five biggest companies in America are red before the bell. The S&P is green anyway.
> Here's who's paying for AI, and who's getting paid.

The thesis is not deleted. It moves to the second paragraph, where it now reads as the payoff instead of the premise.

### The four rules

1. **Open on a number, not a verdict.** A price, a percentage, a volume multiple, a count. Something checkable in the first sentence.
2. **Make the number strange.** The hook is the gap between two facts that should not both be true. "Red before the bell / S&P green anyway." If there is no tension, there is no hook — and per marquee, probably no article either.
3. **End the opening on an open loop.** An explicit promise of what comes next: *Here's who's paying. Here's what broke. Here's the level that decides it.*
4. **Verdict last, never first.** The Bench read, the trade call, the confirm/invalidate — those close the post. They never open it.

### The hard limit on rule 3

**The open loop must be paid off in the same post, by evidence we actually pulled.**

A promise the post cannot keep is clickbait no matter how well it is written, and it costs us the only thing we have. If the data does not support a payoff, write a smaller hook — or, on a gated routine, write nothing. A quiet tape still does not need a post.

This is the line that separates us from the accounts we are studying. Hold it.

### Worked examples, from real posts

| Was | Becomes |
|---|---|
| *The Market Didn't Sort AI Into Winners and Losers. It Just Bought All of It.* | *Nine minutes in, semis are up 4.7%. We called that at 6am. The other half of the call just broke.* |
| *$BRKR — $51.29, -20.2% on the day.* | *$BRKR is down 20.2% today. It printed a 52-week high on Friday. Here's what broke.* |

Note the second one: the original was already number-first, which is right. It only needed the loop.

Note the first one: it opens by **marking our own earlier call half-wrong**. That is the strongest hook The Bench has and almost nobody else can use it. Reach for it whenever the tape has actually contradicted us.

---

## 2. THE SAVEABLE ELEMENT

**Every post still gets one thing a trader would want to find again at 3pm.** That is a product rule, not a ranker claim.

Do **not** treat bookmarks as the heaviest positive signal in X's ranker. The Bench's own 2026-08-13 article (`docs/articles/2026-08-13-what-the-algorithm-threads-missed.md`) records that the open-sourced ranker has **no bookmark term** in the scoring sum. `bookmark_count` is hydrated as a feature; it is not a weighted action in the For You formula. Write something worth *sending*, not something written to farm a save. The Assembly's originals still ran a median of 88 bookmarks — useful as a reader habit, not as a ranking weight.

Qualifies:

- A **level with a consequence**: "760 is the gate. Hold it and 765 is the next air pocket; lose 757.67 in the first hour and the gap is a fade."
- A **named invalidation**: the specific thing that would prove this post wrong.
- A **short checklist** the reader can run themselves tomorrow.
- A **volume or breadth test** with the threshold stated.

Does not qualify: a clever line, a prediction with no level, a summary of what already happened.

You are almost certainly writing this already — `THE LEVELS` and the confirm/invalidate pair both count. The change is that it is now **required**, and it should be visually findable rather than buried mid-paragraph.

---

## 3. THREAD SHAPE — OPTIONAL, NOT THE DEFAULT

**Do not write `---` by default.** The default shape is section 0: one standalone post.

Threads are still **enabled** in the poster — this file does not change `post_next.py`. It splits a draft on a line of **exactly three dashes** (`---`) and posts a chain: part 1 first, then each following part as a reply to the one before.

It **refuses the whole thread before posting anything** if a part would truncate, because half a thread cannot be unsent. Hard limits that matter if you do split:

- **280 characters per part.**
- **One cashtag (`$TICKER`) per part.** X 403s a post with two or more cashtags. That is not theoretical: on 2026-08-05 a five-part power-hour chain sent parts 1–2 and died on a part carrying both `$NVDA` and `$GOOGL`. Listing N tickers means N separate parts, or spelling all but one out ("Coherent", not `$COHR`). Dollar *amounts* are not cashtags and are unlimited.

**Gate:** use `---` only if each part stands alone as its own post. No "see above." No reply-dependence. Sunday catalyst is one post, not a 5-part chain. A morning reminder is a quote-RT or a new standalone, not a reply to yesterday.

Do not write a single long-form file and hope the poster will split it. If you are not splitting, write no `---` lines.

---

## 4. BANNED IN THE OPENING

On top of everything marquee already bans:

| Banned | Why |
|---|---|
| Opening with the thesis | It is the payoff. Spending it first is the whole problem. |
| A headline that is a verdict | "The Market Just Decided…" tells them the answer. |
| Vague scale — "surging", "plunging", "massive" | Use the number. We always have the number. |
| An open loop the post does not pay off | Clickbait. Costs us the only asset we have. |
| Hedged first lines — "It's worth noting", "Interestingly" | Throat-clearing before the fact. |
| A question as the hook | Reads as engagement bait and invites a scroll-past. |

---

## 5. BEFORE PUBLISHING

1. Does the first sentence contain a **checkable number**? If no, rewrite.
2. Does the opening **promise something specific**? If no, rewrite.
3. Can the post **deliver on that promise from data actually pulled**? If no, shrink the hook.
4. Is the **verdict at the end**, not the top? If no, move it.
5. Is there **one clearly saveable thing**? If no, add a level or an invalidation.
6. Would a trader **screenshot this or send it**? If no, it is a summary, not a post.
7. Disclaimer line intact?
8. One cashtag. Prefer no `---`. If you used `---`: each part stands alone, the separator is alone on its line, every part under 280?

---

## Version note

v4, 2026-08-24. Copied from v3; shape sections only. Never overwrite this file — a change means `bench-daily-v5.md` and updating the pointer line in `CLAUDE.md` and each routine, same rule as the copilot and marquee prompts.
