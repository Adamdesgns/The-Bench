# BENNY — WHAT CHANGED THIS WEEK

**What this is:** a running record of changes to Benny — how he trades, how he writes, what he covers, and when he posts. One section per week, newest first. Written so the Saturday recap has something true to draw on, and so a future session can see *why* a rule exists instead of inheriting it blind.

**The rule for this file: a change only goes in if it shipped.** Designed-but-unbuilt goes under STILL OPEN. If a change was later contradicted by the book, that goes in too, in the same week, at the same size.

---

## Week of 2026-08-16 → 2026-08-22

The week Benny got a beat, a voice that was actually wired in, and a stop rule that his own book called into question four days after it shipped.

### THE ALGORITHM — how he trades

**`trading-copilot-v25.md` shipped 2026-08-17** (commit `9365192`). Three changes:

- **THE ATR FLOOR.** No stop may sit closer than **1.0 ATR(14) from entry**, and it binds the ratchet too — the hole in v24. Earned by HPQ (B-113): a stop ratcheted inside the noise band got taken by an ordinary session and the stock recovered above the fill the same day.
- **THE LEVERAGE LANE.** Daily-reset leveraged ETFs (2x/3x) permitted at Adam's direction — *"leverage works as long as we are right."* ATR is computed on the ETF, never the underlying; every leveraged position carries a dated exit, because decay is a function of time spent in chop.
- **THE CONCENTRATION DECLARATION.** All-in single-name positions permitted, but must be declared and logged as such, because at 100% of the account the position-sizing formula stops functioning.

**Then the book tested the ATR Floor and it did not hold up.** This is the most important thing in this week's entry:

| | HPQ (B-113) | GDS (B-147) |
|---|---|---|
| Stop distance | 0.11 ATR | **1.064 ATR** — *above* the new floor |
| What happened | taken by an ordinary session | taken, and it closed **0.74 above the stop the same afternoon** |

Two consecutive stop-outs that reversed **inside the day they fired**. Combined with pattern **P-013** — all three closed swings exited at their stop and none ever reached T1 — **B-156 formally REOPENED the audit** that B-147 had closed as "no change."

The floor is **1.0 ATR**. Checked against the outside world on 2026-08-22, the common convention is **1.5–3× ATR, most often 2–3×**. Our floor sits below the tightest end of the standard range. On GDS specifically, a 2× stop would have sat near **31.02**; the session low was **32.385** and never came close, so we would still be holding it. Realized **−$28.82**; held to that close it was **−$16.96**. The floor cost **$11.86** on that one trade.

**No framework change has been made yet.** This is evidence, not a v26 — and the fix is Adam's call, not a quiet edit.

**A second lesson, logged in B-156 and worth more than the trade:** a Self-Audit was run 90 minutes after the exit, using intraday action as proof, and the close reversed it. **A stop-out is not resolved at the fill.** The minimum honest evidence window is the session close, because a wick and a trend look identical for the first hour.

### THE VOICE — how he writes

- **`benny-v1.md` was wired into the routines for the first time on 2026-08-22.** It was written 2026-08-14. **No routine had ever read it.** Benny published daily for eight days with his persona file sitting unread on disk. This is the week's second-biggest finding and it has a general form: *a prompt nothing points at does nothing.*
- **`benny-v2.md`** (commit `cf12eed`) — corrected pointers (`bench-daily-v3` replaced v2; marquee retired), and both stale items v1 had flagged are now resolved. v1 preserved untouched.
- **THE AUDIENCE was defined for the first time** (`bench-daily-v3` §0.7, commit `6e4e974`): **new followers and new traders who want to learn and grow an account safely.** Not institutions, not veterans. The prior assumption — inherited from the retired article prompt — was *"active traders who recognise weak analysis immediately,"* and writing for that reader produces posts that are correct and teach nobody. It was caught when a stops explainer opened with *"I put our stop 1.06 ATR under the entry"* and **Adam could not follow it.** If it loses the operator it loses everyone.
- **PRONOUNS became a rule, not a preference.** "I" for the work — calls, levels, analysis, being wrong about a read. **"We" only when money is at risk** — entries, exits, being stopped out. Benny drafts, Adam executes, and Benny has never placed an order, so a call is "I" and a position is "we." The grammar encodes the execution boundary.
- **`marquee-v3.1.md` RETIRED** as a governing prompt. It was an X Article prompt; long-form died 2026-08-05. Its persona ("veteran magazine staff writer"), its narrative-spine directive and its word-count target all fought the chain format. Three things salvaged: the signal hierarchy, the banned-phrase list, the chart-drop visual identity.

### THE HOOK — rebuilt twice in one day, and the second rebuild reversed the first

**The saveable element became the SENDABLE element** (closes Open Loops row 124, open since 2026-08-13). v2 required a "saveable" element and justified it with *"bookmarks are the heaviest positive signal in X's ranker."* **That justification is false** — our own analysis of X's published weights found **no bookmark term in the scoring struct at all**. What *is* at the top: **share via copy link, 20.0, forty times a like.** The rule survives, the target moves from a private save to a person-to-person send.

**Then a logic error, caught by Adam.** Reading "dwell = 0.0" in the weights, the hook rule was rewritten to say *"do not optimise for retention — pulls you in is worth zero."* That is wrong. The weights describe what an action is worth **once someone has already stopped and read the post**; they say nothing about what causes it. The model scores **P(action) × weight**, and **the hook drives P**. If part 1 does not stop the scroll, P is zero for every row and the weights are irrelevant.

Adam: *"The fact that the first post pulls you in is EVERYTHING. That first post decides everything… Without those engaging posts we have no followers."*

The corrected doctrine, now §2 rule 5 and §7 checks 2a–2c: **stop the scroll first — it outranks everything.** Then make part 1 forwardable on its own (the DM test, aiming at the 20.0 action). Then make sure the promise is payable, because an unpaid loop manufactures mute (−58.8) and report (−234), which dominate the sum. All three, in that order.

**Caveats now carried in the file, having been dropped once:** the weights are compile-time defaults that exist to be overridden — trust the ordering, not the absolute numbers; separate continuous-dwell parameters exist that we have not read; ranking is not filtering; and **whether replies inside our own thread earn the 5.0 reply weight is unanswered, with the plausible reading being that they do not** — which matters, because this account is chain-first. That last one is unexamined and is bigger than anything settled this week.

### ON EVIDENCE — written into the prompt so a future session does not dismiss it

At this size there is no statistical signal in engagement rates. **Adam's read of a draft is the primary data source.** Every real defect found on 2026-08-22 — a fragment presented as a sentence, self-congratulatory filler, jargon a beginner could not follow, and the hook logic error above — was caught by him reading the post, not by a metric or a check. `bench-daily-v3` §2 now states this explicitly.

### THE GATES — new, and both written from real defects

- **THE COMPETENCE GATE** (`bench-daily-v3` §6.6). Written after a draft nearly published three subject errors wrapped around a correctly-pulled number: it misdefined ATR as "how much a stock moves in a day" (it is the average true *range*, high to low including gaps); taught 1× as the noise threshold against a 1.5–3× convention; and was contradicted by our own book. **A verified number inside an unverified mechanism is the most dangerous shape an error takes, because it looks rigorous.** The gate: define the term as a practitioner would, state the convention and know its source, test it against `db/archive.json` first — *and if the book contradicts the rule being taught, that contradiction is the post.*
- **THE COPY GATE** (§6.7). Written from six grammar defects in one draft. Read each part alone and out of order; every sentence needs a subject and a verb; every `this/that/it/both` must have a nameable referent; no three-clause comma chains; consistent number formats. And the rule that outranks any instruction to be memorable: **read the clever line literally. If the literal reading is nonsense, it is not quotable, it is broken.** A saveable whose pronoun pointed at the wrong thing is what earned this.

### THE BEAT — what he covers

- **The Bench narrowed from the whole market to AI INFRASTRUCTURE, full stack**, covered through the **divergence between its layers** (spec `acf9a8d`, implementation `c1c3787`).
- **`db/board.json`** — the board is data now, not prose buried in six files. Five layers ordered the way money flows: buyers → silicon → box → power → crypto bridge. 22 tickers, each verified against `get_equity_fundamentals`. **`LTH` removed — it is Life Time Group Holdings, a gym operator**, and it had been sitting on the "AI board" unchecked.
- **`bench-daily-v3.md`** — retires the six mandatory sections that were mechanically producing a six-part post every time (**24 of the last 25 posts were exactly 6 parts**, all 1,320–1,575 chars). Makes the SENTIMENT read conditional. Part counts 1–5, chosen by content. Eight-format menu: one-liner, chart drop, short read, divergence, explainer, receipt, position note, ownership math.
- **The root cause of the bricks was a contradiction inside the prompt files:** four routines said *"Target 400-700 words"* and *"write a LONG-FORM X Article"* while the chain rules in the same file said long-form was retired and every part must be under 280 characters. Told to write long *and* in short parts, the routines wrote the longest thing allowed. **Both instructions were being followed, which is why nobody caught it.**

### THE SCHEDULE — when he posts

- **THE FRESHNESS GATE** added to all six daily routines after a power-hour post was drafted on 2:08p data and did not reach the publish step until 3:34p — 34 minutes after the close, with copy reading "this is the last hour." It was killed by hand. Nothing in x-poster checks the clock.
- **A finding that made the gate matter more:** a Windows task, **"X Poster Daily," runs `post_next.py` at 8:00a, 10:00a, 12:00p, 4:00p and 7:00p CT.** Anything in `approved\` publishes at the next tick with **no routine involved**. `approved\` is a live publish queue, not a staging folder. The stale power-hour draft would have gone out on the 4:00p tick; it was pulled 27 minutes before.
- **THE WEEKEND LANE.** Saturday looks back, Sunday looks ahead. `bench-week-recap` (Sat 11:03a) **absorbed `bench-receipt-weekly`**, which is now disabled — every guard carried over: 30-day checkpoints only and never a 7-day verdict, no cherry-picking with a due loss outranking a due win, never a verdict on an open position, the guru test, losses never buried. `bench-weekly-catalyst` (Sun 11:03a) is the forward calendar.

### THE ONLY OUTCOME NUMBER WE HAVE

**135 followers**, reported by Adam 2026-08-22, against **89** when the growth playbook was written on 2026-07-28. **+46 in 25 days, +51.7%, roughly 1.8 a day.**

Two points is a trend, not an attribution — the auto-publishing routines went live 2026-08-04 and overlap most of that window, but so does everything else Adam does. **No causal claim.** It is recorded because at this size follower count is the only measure that is not noise: engagement rates on 13-impression posts tell you nothing, and a cumulative count tells you something. The series lives in `docs/growth-playbook.md` and gets a new row each time a figure is confirmed.

### WHAT WENT OUT

- **2026-08-21** — the ownership-math post, the first of the new beat. CMS's *"buy 4,000 shares and make this much"* hook, inverted: 4,000 shares of Vertiv costs $1,048,000 and pays **$1,000/yr**, and the absence of a dividend across the whole board *is* the story, because the capital goes into capacity.
- **2026-08-22** — the stops explainer. First post written under the complete rule set, and the first to lead in dollars before naming a concept.

### STILL OPEN

- **The ATR Floor question.** 1.0 ATR against a 1.5–3× convention, with two same-session reversals and P-013 behind it. Evidence is in; the framework change is Adam's decision.
- **The bookmark claim.** `bench-daily-v2` §2 said bookmarks are the heaviest signal in X's ranker; our own published article says the open-sourced ranker has **no bookmark term at all**, verified 3×. Stripped from v3 — Benny reports observed counts and asserts no mechanism. Open Loops row 124 is still open.
- **The chart drop** has no renderer, and nobody has checked whether `post_next.py` supports media upload at all.
- **`defaultMode: bypassPermissions`** is not set, so any unattended run can still stall on an approval prompt.

---

*Next entry: week of 2026-08-23 → 2026-08-29.*
