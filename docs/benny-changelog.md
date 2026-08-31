# BENNY — WHAT CHANGED THIS WEEK

**What this is:** a running record of changes to Benny — how he trades, how he writes, what he covers, and when he posts. One section per week, newest first. Written so the Saturday recap has something true to draw on, and so a future session can see *why* a rule exists instead of inheriting it blind.

**The rule for this file: a change only goes in if it shipped.** Designed-but-unbuilt goes under STILL OPEN. If a change was later contradicted by the book, that goes in too, in the same week, at the same size.

---

## Week of 2026-08-23 → 2026-08-29

The week the risk band stopped being a dollar figure, the execution leg got a name and a test harness, and the book named the same execution hole for the third and fourth time without fixing it.

### THE ALGORITHM — how he trades

**`trading-copilot-v26.md` shipped 2026-08-25** (commit `6645d75`). Two changes, neither of them a new gate:

- **The short-side section is reconciled with v23.** For three versions the file said two opposite things about naked shorting: the v23 changelog lifted v22's permanent ban at Adam's direction, while §THE SHORT-SIDE still carried v19's *"NAKED SHORTING IS BANNED. PERMANENTLY."* verbatim. A run reading that section literally would have refused a structure the changelog permits. Put to Adam 2026-08-25; he ruled for the changelog. Defined-risk (long put / put spread) is the **default** expression of a bearish read; short shares and naked options are **available**, with the unbounded-loss arithmetic stated at the point of choice rather than enforced as a ban. **No gate changed.**
- **The execution leg has a name:** `prompts/bench-executor-v1.md`, committed 2026-08-26 (`ac134bd`) marked `UNTESTED — LIVE EXECUTION DISABLED`, with its exact bytes committed **before** any test so the tested SHA is provable.

**`trading-copilot-v27.md` shipped 2026-08-28** (commit `dda9559`, merged in `aaef039`). One change, and it is the one worth a post:

**THE RISK BAND BECAME A PERCENTAGE.** Adam, 2026-08-28: *"It's 10% no reason to adjust it ever."*

| | when set (2026-08-17) | 2026-08-28 |
|---|---|---|
| Band | $100 | $100 |
| Account | ~$1,020.87 | $2,511.72 |
| **Band as % of account** | **9.8%** | **4.0%** |

The band was set as a fixed dollar figure and the account grew underneath it, so risk per trade **halved as a share of the account with nobody deciding to**. Nothing went wrong because of it — but the 2026-08-28 run had to stop and re-ask a question that was already settled, which is the tell. v27 states it as **10% of current account value, recomputed from the live balance every run** ($251 at the 8/28 balance). §POSITION SIZING is the only section that changed; every gate, floor, lane and grade in v26 is untouched.

**What is recorded alongside it, in the file, so it does not read as an upgrade:** 10% per trade is roughly **6.7× the Aggressive tier** of the framework's own table for a $1k–$5k account (1.5%). Seven consecutive losers takes the account down **~52%** (0.9⁷ = 0.478), and recovering from −52% requires **+109%**. The one thing the percentage form genuinely buys over a fixed dollar is that **it de-risks itself on the way down** — 10% of a shrinking account is fewer dollars every time, so a losing streak tightens the band with nobody deciding to.

### WHAT THE BOOK CONTRADICTED — the same hole, third and fourth instance

**A level living in a logged plan with no resting order at the broker is not a plan, and this is now a pattern rather than an incident.**

| Row | Date | Name | What happened |
|---|---|---|---|
| **B-116** | 2026-08-17 | GDS | *"ZONE TRIGGERED AND WENT UNBOUGHT, twice."* Zone live ~10 min on 8/17; no order resting, no fill. |
| **B-205** | 2026-08-27 | BE | Trigger 205.10 armed 8/24 (B-194). Fired and never came back. *"+8.72pct past the trigger with nothing bought."* B-205 names it explicitly as *"THE B-116 FAILURE REPEATING."* |
| **B-212 / B-217 / B-219** | 2026-08-27/28 | HIMS | The 31.50 zone went live and filled nothing on **three separate sessions**, then closed above it once and below it twice. |

**And the cost of the BE miss is not one number, which is the finding worth carrying.** B-205 measured it at **+8.72%** on 8/27. Measured at the intraday high (227.99, 8/27) it is **+11.2%, $22.89 a share**. Measured at Friday's close (210.67) it is **+2.7%, $5.57 a share**. All three are true; the trade is identical in all three. **A missed-trade cost quoted without its measurement date is not evidence of anything** — which is exactly the shape of the competitor track-record posts in `docs/growth-playbook.md`. This became the Saturday recap published 2026-08-29.

**No framework change has been made for the resting-order gap.** It is an execution gap, not an arithmetic one, and the executor (below) is the intended fix — but it is untested, so as of this week the hole is open and has cost real basis points three times in twelve days.

### THE REFUSAL THAT WORKED — logged the same week, and it is the control case

NVDA, B-200 → B-208 → B-215 → B-218. B-200 wrote the rule **in advance of the print**: re-derive the stop and the 2:1 test off the *post*-print ATR at the actual entry price, and if the arithmetic fails, no trade. NVDA beat, gapped to 222.30 pre-market on 8/27, and B-208 solved for the ceiling: any entry above **217.01** fails 2:1 to T2. It refused. The plan then died unfilled at its 8/28 deadline, and NVDA closed 217.54 that day, **−4.58%**, having crossed all three of its own triggers **from above**.

**The pair is the lesson.** BE and NVDA are the same event — a published level the tape reached and no position taken — and they came out opposite ways for one reason: NVDA's plan specified what happens *at the price you would actually pay*, and BE's specified only a number. B-218 also records the general form: **a reclaim trigger crossed downward is not a fill**; it is the premise being overtaken.

### THE EXECUTOR — the program surface

- **`bench-executor-v1` committed UNTESTED** with live execution disabled (`ac134bd`, 2026-08-26), plus the canonical EXECUTION HANDOFF contract, offline refusal tests, a durable receipt registry and a kill sequence.
- **Blocker #7 CLEARED** (`093ca6d`): the Robinhood endpoint accepts a non-Claude OAuth client. The surface limit was corrected in the docs from "a hard Anthropic limit" to what it actually is — **Bench policy plus configuration**.
- **`87402b8`** gave it a local CLI; **`834f717`** a read-only preflight probe; **`fe1f1f6`** an after-hours `test-queued` mode — a near-zero-fill-risk cancel test.
- Go-live is gated by `docs/executor-test-protocol.md`, **not by one order and a word**.

### THE BUS — Adam stopped being the message bus

`inbox-check.mjs` (`dc3dd78`) and the canonical worklog beside it (`4c8ccfa`). Written after 2026-08-28, when Morgan Sterling wrote a full seat map into `docs/handoffs/to-claude/` at 14:31 and this desk did not know until Adam said "check it now." **Two systems were writing to the same disk and a human was carrying the messages between them.** The bus is now step zero of every session and exits 1 when a drop is unread.

### THE POSTING — what a reader would feel

- **`bench-daily-v4` shipped 2026-08-23** (`2e64f99`): teaching is the purpose of the posting, and **every part of a chain is its own post**. Both rules came from Adam reading a published chain and deleting it — *"it just didn't make a lick of sense"* — on a chain whose every date was correct.
- **The Saturday recap absorbed the Monday receipt routine** at Adam's direction 2026-08-22 (*"We're not waiting 2 weeks to fold it in. Everything starts Monday."*). The Monday task is disabled; every hard rule it carried moved into the Saturday file.
- **The `approved\` folder is a live queue, and composing into it early publishes out of order.** Rule added 2026-08-25 after a stale-snapshot publish: nothing reaches `approved\` until the instant of publishing, and the move and the send are **one motion**. The fixed-clock drainer was disabled 2026-08-27, so each routine is now the only thing that publishes its own post.

### STILL OPEN

- **The resting-order gap.** Three named instances (GDS, BE, HIMS) in twelve days, no fix shipped. The executor is the intended answer and is untested.
- **The 2026-08-29 recap ran at 17:28 CT against an 11:03a slot** — six and a half hours late, publishing under the Saturday carve-out. Same shape as the 2026-08-22 miss recorded in the section below. **An unattended run is still stalling somewhere and nothing has diagnosed it.**
- **Only nine rows in the whole archive carry a 30-day checkpoint, and all nine score "not scorable."** The Saturday format is built around a 30-day verdict it currently cannot produce, and has fallen back to a process receipt. That is a data-shape problem in `db/archive.json`, not a writing problem, and it will recur every week until the checkpoints are seeded.

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

**THE MEASUREMENT, CORRECTED 2026-08-22.** The figure quoted all day was "24 of the last 25 posts were exactly 6 parts." True, but it is the weak version and it implies the posts were always like this. **They were not — they degraded, and the curve is sharp.** Measured across all 106 published posts:

| period | avg parts | avg chars |
|---|---|---|
| Aug 3–4 | **1.0** | ~2,100 |
| **Aug 5** — the day chains were mandated | **2.8** | 1,899 |
| Aug 6 | **6.0** | 1,399 |
| Aug 6 → Aug 22 | **6.0 every single day** | ~1,450 |

**73 of the 80 posts in those 17 days were exactly six parts.** It converged on the maximum the day *after* the format changed and never came back down. And the posts got **shorter** as they got more uniform (2,400 → 1,450 chars) — so it was never a length problem. **Every post became the same shape.** Adam: *"It wasn't always like that, between our updates it got worse."*

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

### ADDENDUM — appended 2026-08-23 (Sunday) by the week-recap run

Appended, not edited: nothing above this line was changed.

**The ATR Floor cost has two numbers, not one, and the section above prints only the flattering one.** The $11.86 figure is measured at the 8/19 close (GDS 33.34). Measured at Friday's settled close of **32.85**, holding would have been **−$24.80** against the realized **−$28.82** — so the floor cost **$4.02**, not $11.86. Both are correct; they differ only in where the measuring window is cut, and the window was chosen *after* the outcome was visible. Arithmetic: 16 × 32.85 = 525.60 vs the 550.40 cost. Verified against a live `get_equity_historicals` daily pull on 2026-08-23.

The general lesson, which is bigger than the trade: B-156 already established that **a stop-out is not resolved at the fill.** This adds that it is **not resolved at that day's close either.** Pick the evidence window before looking at it, or the window becomes the argument. This strengthens rather than weakens the STILL OPEN item above — the case for a v26 is now built on an even thinner cost basis than the section claims.

**The Saturday recap did not run.** The 2026-08-22 slot never fired; the miss was caught on Sunday 2026-08-23 at 10:32a CT and the routine's own occasion gate stood the post down rather than publishing a "week just gone" post into Sunday, 31 minutes ahead of the weekly-catalyst slot. Draft preserved at `apps/x-poster/queue/2026-08-23-week-recap-NOT-POSTED.txt`. The most likely cause is the last STILL OPEN item directly above — an unattended run stalling on an approval prompt.

---

*Next entry: week of 2026-08-23 → 2026-08-29.*

### CORRECTION — appended 2026-08-23 (Sunday) ~10:45a CT by the newsletter-setup run

Appended, not edited: nothing above this line was changed. This corrects one claim in the addendum directly above.

**The Saturday recap did not fire because the task was switched OFF, not because it stalled on an approval prompt.** `bench-week-recap` was deliberately paused on 2026-08-22 — Adam killed that week's recap and the stops explainer took the weekend teaching slot — and the pause was recorded in the task's own description, which read *"PAUSED FOR 2026-08-22 ONLY ... RE-ENABLE for Sat 2026-08-29."* `list_scheduled_tasks` showed `enabled: false` with **no `lastRunAt` at all**, which is what a task that never dispatched looks like; a run that stalled on a prompt would have left one.

**The proof is that re-enabling it made it run.** `enabled` was set back to `true` at 10:31a CT today, the overdue Saturday occurrence dispatched **immediately and unattended**, and it completed on its own — pulling live quotes, writing the draft, and standing itself down on the occasion gate — with no approval prompt anywhere in it. A routine that runs to completion unattended is not a routine blocked by `defaultMode`.

So the addendum's "most likely cause" is wrong. **To be precise about what that does and does not overturn:** `defaultMode` HAS cost a post — the 2026-08-21 power-hour run stalled ~87 minutes on a permission dialog and had to be killed, which is documented in Open Loops row 337 and is real. What is wrong is attributing **Saturday** to it. The Saturday slot never dispatched at all, so it is not a second instance and it must not be counted as one. The risk is unchanged, not upgraded: still demonstrated once, on 8/21, and still unset. The recap draft the run produced is still valid and still waiting at `apps/x-poster/queue/2026-08-23-week-recap-NOT-POSTED.txt`.

**Side effect worth knowing for next time:** re-enabling a cron task whose slot has already passed fires the missed occurrence on the spot. That is safe here only because the routine's occasion gate caught it. Re-enable a *publishing* routine expecting it to run within the minute, not next week.
