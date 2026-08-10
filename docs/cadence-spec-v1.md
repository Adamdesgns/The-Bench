# CADENCE SPEC v1 — what posts, when, and why that number

**Status:** approved 2026-08-10. Supersedes nothing; this is the first written
cadence. Until now the schedule lived only in `~/.claude/scheduled-tasks/bench-*`
on Adam's machine, which meant it could not be argued with from data.

**What this file owns:** how many times a day The Bench posts, on which days,
and the test each slot has to keep passing to stay on the schedule.

**What it does not own:** how a post is written. That is
`prompts/bench-daily-v1.md` (opening + saveable), `prompts/marquee-v3.1.md`
(body), and the routine's own prompt for what data it pulls.

---

## 0. THE RULE THAT COMES FIRST

**More posts is not the goal. More posts that carry evidence is the goal.**

This is not a hedge, it is the finding in our own research. From
`docs/growth-playbook.md`, the account we copy, measured against itself:

| Month | Originals | Median reach |
|---|---|---|
| April | 46 | 173,542 |
| **May** | 90 | **411,416** |
| June | 97 | 228,756 |
| July | 101 | **134,462** |

They **doubled** their originals between April and July and **lost 22% of their
median reach**. The other account in that study posts ~160 times a day for a
median of 24,628. Volume is not the variable. Volume with nothing new in it is
actively negative, because every post that says nothing trains the ranker and
the reader that our posts can be skipped.

So every slot below has to answer one question:

> **What does this slot know that the slot before it did not?**

A slot that cannot answer gets cut, not kept. §4 is the review that enforces it.

---

## 1. WHAT WAS RUNNING (before this spec)

Six routines, seven slots, **Monday to Friday only.** All times Central.

| Slot | Time | Gated? |
|---|---|---|
| Pre-Market | 5:40a | no |
| State of the Market | ~8:38a | no |
| Trending snapshot scan | 10:00a | yes |
| Midday | ~11:34a | no |
| Trending snapshot scan | ~1:00p | yes |
| Power Hour | ~2:07p | no |
| Closing Bell | ~3:10p | no |

**Roughly 7 posting opportunities across 5 days. Two days a week produce
nothing at all.**

### The three holes

1. **Saturday and Sunday are dark.** 2 of 7 days, 0 posts. The account we copy
   posts on a fixed window every active day; ours simply stops. The
   `daily-open-chain-spec.md` has contemplated a weekend variant since v1
   ("Weekend variant (optional)") and it was never built.

2. **Nothing runs after the close.** Last slot is 3:10p CT (4:10p ET). The
   playbook's observed productive window runs to 18:00 ET. The hour after the
   close is when the day is actually explicable, and we are silent in it.

3. **The recap does not exist as a post.** `docs/growth-playbook.md` §6 names
   the track-record recap as *"their single highest-leverage recurring
   format"* — 3.2M impressions on one post. We have the better version of it,
   because `db/archive.json` is append-only and written before outcomes, and
   theirs is a marketing claim. **The generator has existed the whole time**
   (`server/scorecardPost.js`, spec'd 2026-07-28) and drafts into
   `x-poster/queue/`. `post_next.py` reads `approved/` only. **So it has never
   published, not once.** That is the single largest gap on this list and it
   is a one-flag fix, not a build.

---

## 2. WHAT GETS ADDED

Three slots. **5 posting days → 7. 7 slots/week → 10.**

| # | Slot | When (Central) | Source | Gated? |
|---|---|---|---|---|
| 8 | **The Scorecard** | Fri 3:35p | `npm run score -- --approve` | yes — no due checkpoints, no post |
| 9 | **Week-Wrap** | Sat 9:00a | `prompts/bench-weekend-v1.md` §2 | yes — No-Story Rule |
| 10 | **Week-Ahead** | Sun 4:00p | `prompts/bench-weekend-v1.md` §3 | yes — No-Story Rule |

Each answers §0's question:

- **The Scorecard** knows the week's *outcomes*. No intraday slot does; they
  all run before the checkpoints elapse. It is the only slot whose material is
  the book rather than the tape.
- **Week-Wrap** knows the *full week's* shape. Every weekday slot sees one day.
- **Week-Ahead** knows *next week's calendar*. Nothing else on the schedule
  looks forward past the session it runs in.

### Why nothing was added inside the trading day

The weekday grid already covers open, midday, power hour and close. A new
intraday slot would be reporting on the same tape the slot 90 minutes earlier
reported on, which is exactly the failure in §0's table. **The dark days were
free capacity; the trading day was not.**

### Why the Scorecard is Friday and not Saturday

It fills hole #2 — the post-close silence — and the week's outcomes are final
at the Friday close. Saturday already has the Wrap; two Saturday posts would
compete with each other for the same audience on the quietest day of the week.

---

## 3. WHAT DOES NOT CHANGE

- **The No-Story Rule holds on every new slot.** A quiet weekend does not need
  a post. `daily-open-chain-spec.md` §4: *"A daily cadence that manufactures a
  narrative on quiet days will destroy the brand faster than skipping a day
  ever could."* Three added slots are three more chances to break that, so all
  three are gated by default.
- **Everything is a chain.** `bench-daily-v1.md` §0 outranks this file and the
  routines. The Scorecard now renders as a chain
  (`renderWeeklyChain`); `renderWeeklyPost` stays for any caller that wants a
  single surface.
- **The disclaimer rides the last part.** Unchanged.
- **`log-call.mjs` still gates.** A weekend post that makes a call logs a row
  like any other. The Week-Ahead is the highest-risk slot for this: it names
  levels for Monday, and a level with no row is an ungradeable call.

---

## 4. THE REVIEW THAT KEEPS THIS HONEST

**At 30 days (2026-09-09), each new slot is judged on the same evidence
standard the book uses.**

For each of slots 8–10, record:

1. Posts actually published vs. slots elapsed (the gates should suppress some —
   a slot that fires 100% of the time is a slot that is not gated).
2. Median reach, against the weekday slot median over the same window.
3. Whether weekday median reach **fell** after the additions. This is the §0
   failure mode and it is the one that matters most; it will not show up in the
   new slots' own numbers.

**A slot below the weekday median with no upward trend gets cut.** Write the
verdict into `docs/scout-log.md` next to the scan calls — same discipline,
"data tells all." A cadence that is never reviewed is a cadence that only ever
grows.

---

## 5. IMPLEMENTATION

The routines live on Adam's machine at `~/.claude/scheduled-tasks/bench-*`, not
in this repo. This spec is the source; **the three tasks still have to be
created there**, one per slot, in the same shape as the existing six.

**Slot 8 — The Scorecard.** Deterministic, no model call needed:

```bash
node scripts/score-book.js --approve
```

Renders a chain from due checkpoints and writes it to `x-poster/approved/`.
Returns no draft when nothing was due, which is the correct outcome. Add
`--link <url>` only if a **public** destination exists — this repo is private
and must never be linked from a post.

**Slots 9 and 10** attach two prompt files, in order: `bench-weekend-v1.md`
(what to pull and say) then `bench-daily-v1.md` (how to open and what to make
saveable), and publish the same way the weekday routines do.

**Holiday behavior:** the Scorecard is a book operation, not a tape operation,
so it runs on market holidays that fall on a Friday. The weekend slots are
unaffected by market holidays by definition.

---

*Proof, not hype.*
