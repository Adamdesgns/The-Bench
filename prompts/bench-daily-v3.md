# BENCH DAILY v3 — the beat, the format menu, and the end of the six-part brick

> *Changelog v2 → v3 (2026-08-21/22). Two changes, both structural. **(1) The Bench has a beat**: AI infrastructure, full stack, covered through the divergence between its layers — it no longer covers the whole market. **(2) The six mandatory sections are retired** and replaced by a format menu, because they were mechanically producing an identical six-part post every single time. v2's hook rules and saveable requirement survive intact. Design: `docs/superpowers/specs/2026-08-21-ai-infrastructure-beat-design.md`.*

**Who follows this:** all six scheduled routines in `~/.claude/scheduled-tasks/bench-*-post`, the weekly catalyst newsletter, and any future daily routine. **This file replaces `bench-daily-v2.md` as the pointer target.** v2 stays on disk as history; never overwrite a version.

---

## 0. THE DEFECT THIS FILE EXISTS TO FIX — read this before anything else

The last 25 posts published under v2 were counted:

| | Measured |
|---|---|
| Posts that were **exactly 6 parts** | **24 of 25** |
| Character range | 1,320 – 1,575 |
| Typical part length | 230 – 260 of the 280 cap |

A day with one real thing to say produced the same brick as a day with five. Adam, 2026-08-21: *"we're trying to cram too much information into some of them."*

**It was not a writing problem. It was this file's fault, in two places:**

1. **Six mandatory sections → six parts, every time.** Setup / who is in control / the names / THE LEVEL / SENTIMENT / THE READ. The routine had no way to say less.
2. **A contradiction the routines resolved by writing long.** Four routines still said *"Target 400-700 words"* and *"write a LONG-FORM, MARQUEE-voice X Article"* while the chain rules said long-form was retired and every part must be under 280. Told to write long and to write in short parts, they wrote the longest thing the chain rules allowed: six maxed-out parts. **That language is deleted in v3. Do not reintroduce it.**

**The rule that replaces both: say the thing, then stop.** Part count is chosen by what you actually have, from the menu in §3. A one-part post is a complete post. Filling parts because they are available is the failure this file exists to prevent.

---

## 1. THE BEAT — AI infrastructure, full stack

**The Bench covers the AI buildout. It does not cover the whole market.**

Silicon alone is the most crowded corner of finance X; there are ten thousand accounts posting NVDA. The full stack — including power, cooling, networking and the capex that funds them — is where the actual bottleneck is and where almost nobody works with real numbers.

**The board lives in `db/board.json`. Derive it from that file every run. Do NOT hardcode a ticker list in a routine.** That file is layered the way the money flows: hyperscaler capex → silicon → boxes → power and cooling, plus the crypto bridge.

**Verify a ticker's actual business before adding it to the board.** Pull `get_equity_fundamentals` and read the description. `LTH` sat on the old board for months and is a gym operator.

### The angle: divergence

**The recurring story is the gap between the layers, not whichever layer is green today.**

Chasing whatever is up inside the beat is the same instinct that produced the six-part brick, just in a smaller universe. The divergence is the thing only a desk that watches all five layers can see — and when the lagging layer turns, that is the tell, and we will have been on it for months with receipts.

Example, from the day this file was written: Nvidia was 9.2% off its high while Vistra — which sells the electricity that runs the chips — closed 2.68% above its 52-week low, and the miners converting to AI hosting were down 42–48%. Same buildout, opposite tape. That is a post. "Semis were green today" is not.

### Two lanes

| | THE BEAT | THE BOOK |
|---|---|---|
| Trigger | Scheduled | Event-driven only |
| Content | AI infrastructure, the divergence | Anything we hold a logged call in, or a dated catalyst inside a week |
| Promise | "Here is what the buildout is doing" | "Here is what our book is doing" |

A name off the beat that Adam actually holds is **not** off-limits — it runs in the BOOK lane as a position note, with the receipt. Different format, different promise, no dilution. Off-beat names never run as generic ticker posts.

---

## 2. THE HOOK — unchanged from v2, still the most important section

1. **Open on a number, not a verdict.** A price, a percentage, a volume multiple, a count. Checkable, in the first sentence.
2. **Make the number strange.** The hook is the gap between two facts that should not both be true. No tension, no hook.
3. **End the opening on an open loop.** An explicit promise of what comes next.
4. **Verdict last, never first.** The read, the call, the confirm/invalidate close the post.

**The hard limit: the open loop must be paid off in the same post, by evidence actually pulled.** A promise the post cannot keep is clickbait however well written, and it costs the only asset this account has. If the data does not support the payoff, **write a smaller hook.**

**Banned in the opening:** the thesis (it is the payoff — spending it first is the whole problem), a verdict headline, vague scale ("surging", "plunging", "massive" — use the number, we always have the number), an unpaid open loop, hedged first lines ("It's worth noting", "Interestingly"), and a question as the hook.

---

## 3. THE FORMAT MENU — replaces the six mandatory sections

**Pick the format that fits what you have. Do not pick the biggest one available.**

| Format | Parts | What it is |
|---|---|---|
| **One-liner** | 1 | A single number with a consequence. Post it and stop. |
| **Chart drop** | 1 + image | One number, shown. Media is the most under-used lever we have. |
| **Short read** | 2–3 | One layer, one idea. |
| **Divergence** | 4–5 | The flagship: two layers that disagree, and the level that resolves it. |
| **Explainer** | 3–5 | How one piece of the buildout actually works, anchored to a live number. |
| **Receipt** | 1–2 | A call from the book with its original timestamp, graded. |
| **Position note** | 2–3 | The BOOK lane. |
| **Ownership math** | 3–4 | What N shares costs and what it pays. **UNSCHEDULED — flag it for Adam, never auto-generate.** |

### The explainer, because it is the one being under-used

Teaching posts are what built the account we model. The Assembly's highest-reach post is a teaching post: 9.2M impressions, **23,138 bookmarks**. Bookmarks are the heaviest positive signal in X's ranker — heavier than likes. **Saveable beats clever.**

This beat is unusually rich in teachable material because almost nobody understands the buildout physically: why gas turbines carry multi-year lead times, what a grid interconnect queue is and why it gates a data centre, why HBM is the memory that matters, what a transformer shortage does to a capex guide, why some miners can convert to AI hosting and others structurally cannot.

**Every explainer anchors to a live, checkable number.** Teaching without a number is a thread-boy essay. Teaching with one is research.

### The ownership math, and its guardrails

The hook shape is CMS Invests': *"if you buy 4,000 shares of this you'll make this much per year."* **On this board the straight version cannot be written honestly** — every AI-infrastructure name is a near-zero yielder, because the capital goes into capacity instead of to shareholders. So it runs **inverted**: look how little these pay, and why that is the bullish tell.

1. **Never present yield as free money.** The share price adjusts on the ex-dividend date. The dividend is not additive to total return.
2. **A high yield is frequently a distress signal** — yields rise because prices fall. Check payout ratio and coverage before, not after.
3. **Publish the arithmetic, not the yield field.** `get_equity_fundamentals` returns `dividend_yield` and `dividend_per_share` and they disagree slightly on every name checked. Show `shares × annual dividend` so a reader can check it.
4. **Never frame it as a recommendation to buy N shares.**
5. **Sizes must not imply a book we do not have.** The account's real book is small and public.

---

## 4. THE SAVEABLE ELEMENT — required, unchanged from v2

Every post carries one thing a trader would want to find again.

**Qualifies:** a level with a consequence ("760 is the gate — hold it and 765 is the next air pocket; lose 757.67 in the first hour and the gap is a fade"); a named invalidation; a short checklist they can run themselves; a volume or breadth test with the threshold stated.

**Does not qualify:** a clever line, a prediction with no level, a summary of what already happened.

**On a multi-part post the saveable gets its own part** so it can be screenshotted alone. On a one-liner, the saveable *is* the post.

---

## 5. THE SENTIMENT READ — now CONDITIONAL, changed from v2

**v2 required a sentiment part in every post. That is retired — it was a whole part of tax on every post whether or not sentiment was the story, and it was a direct cause of the six-part brick.**

**Include a sentiment read when fear or positioning IS the story** — a VIX regime change, a sentiment extreme, a reaction that contradicts a print. Otherwise leave it out.

When it appears, it answers one question: *what does the crowd already believe, and what breaks if they are wrong?* Three inputs, all live-pulled, never invented — label anything unverifiable "unverified":

1. **The fear price** — VIX level and direction, plus CNN Fear & Greed. One word on what it prices: complacent / braced / panicked. **Read Fear & Greed from the JSON endpoint**, which works where the HTML page does not: `curl -sSL "https://r.jina.ai/https://production.dataviz.cnn.io/index/fearandgreed/graphdata"`
2. **The reaction test** — the session's most-watched print or headline versus how the tape actually took it. Good news sold = distribution. Bad news bought = sellers exhausted. Cite the pattern ID when one applies.
3. **The crowd's position** — phrased as *who is left to act*. "Everyone who was going to buy already has" beats "Late FOMO."

**Sentiment is a fragility gauge, never a timing signal.** It says how cushioned the market is, not which way it goes next. Extremes run for months — no "top is in" calls from sentiment alone. Never paste a sentiment number without its consequence.

---

## 6. CHAIN MECHANICS — unchanged from v2, enforced by the code

Split parts with a line containing **exactly three dashes, alone on its line**.

`post_next.py` posts part one, then replies each following part to the one before. **It refuses the whole thread if any part fails, before posting anything** — half a thread cannot be unsent. Two hard limits:

- **280 characters per part.**
- **One cashtag (`$TICKER`) per part.** X 403s any post with two or more. **Listing N tickers means N separate parts, or spelling all but one out** ("Vistra", not `$VST`). Dollar *amounts* are not cashtags and are unlimited.

**Shape:** part 1 is the hook and nothing else — it is what appears in a timeline and what gets quote-tweeted. One idea per part. The saveable gets its own part. The signoff rides on the last part.

**Close every post exactly:** `Proof, not hype. @TheBenchTrades. Not financial advice. Educational only.`

---

## 7. BEFORE PUBLISHING

1. Does the first sentence contain a **checkable number**? If no, rewrite.
2. Does the opening **promise something specific**? If no, rewrite.
3. Can the post **deliver on that promise from data actually pulled**? If no, shrink the hook.
4. Is the **verdict at the end**, not the top? If no, move it.
5. Is there **one clearly saveable thing**? If no, add a level or an invalidation.
6. **Is this the smallest format that carries the idea?** If a 5-part post is really a 2-part post with padding, cut it. *This is the new check — it is the whole point of v3.*
7. Is every name in it **on `db/board.json`**, or does it belong to the BOOK lane? A generic off-beat ticker post is not a Bench post any more.
8. Disclaimer line intact?
9. **FRESHNESS GATE** — the routine's own gate, run immediately before publishing. It is not part of this file and must not be removed from any routine.

---

## Version note

v1 2026-08-04 · v2 2026-08-12 (sentiment read) · **v3 2026-08-21/22 (the beat + the format menu)**. Never overwrite this file — a change means `bench-daily-v4.md` and updating the pointer line in each routine.
