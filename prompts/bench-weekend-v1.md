# BENCH WEEKEND v1 — the Saturday wrap and the Sunday week-ahead

**Who follows this:** the two weekend routines added by
`docs/cadence-spec-v1.md` — Week-Wrap (Sat 9:00a CT) and Week-Ahead
(Sun 4:00p CT).

**Why it exists:** the schedule ran Monday to Friday and produced nothing on
two of seven days. These two slots fill that, and they are the only slots on
the schedule that see a whole week instead of a single session.

---

## 0. PRECEDENCE — read this before anything below

1. **`prompts/bench-daily-v1.md` §0 outranks this file.** Everything is a
   chain, each part under 280, split on a line of exactly three dashes. There
   is no long-form weekend post.
2. **`bench-daily-v1.md` §1 and §2 own the opening and the saveable.** Number
   first, open loop, verdict last, one clearly bookmarkable thing. This file
   does not restate those rules; it says what to pull and what the post is
   *about*. Where they touch, bench-daily wins.
3. **This file owns the material and the gate.** What data, what angle, and
   when to write nothing.

## 1. THE GATE — both slots are gated by default

**A quiet weekend does not need a post.** The weekday grid is unconditional
because the tape moves every session. The weekend has no tape. That makes these
two slots the easiest place on the schedule to manufacture a narrative, which
is the one thing `daily-open-chain-spec.md` §4 says will cost us more than
skipping ever could.

**Do not post if:**

- The week had no move worth a number. If the index closed the week inside 1%
  and no board row changed state, there is no wrap.
- Every catalyst next week is routine. A calendar with no dated event that
  could resolve an open row is not a week-ahead, it is a list.
- The angle repeats last weekend's. Compare against the last two weekend posts
  in `posted/` before writing. Restating is not advancing.

**Skipping is a normal outcome and gets logged as one.** Say why in the run
output so a future session can see the slot was considered and declined, not
that it silently failed.

## 2. SATURDAY — THE WEEK-WRAP

**The question it answers:** what actually happened this week, and what did it
do to our board?

### Pull

- Weekly closes and the week's % move: SPY, QQQ, IWM, plus the two strongest
  and two weakest S&P sectors by weekly performance.
- VIX weekly close and direction.
- **Every open row in `db/archive.json`, priced.** Same discipline as the daily
  reconcile: a row with no fresh print is marked `unverified`, never carried on
  a stale number.
- Any row whose trigger fired or invalidation broke this week. **These are
  events. They close or open a row this run** — not "we'll log it later."

### The angle, in priority order

1. **A board row that resolved this week.** Our own money first, win or loss.
2. **A row whose invalidation broke.** A week we were wrong is the strongest
   weekend post we can write and almost nobody else can write it. Lead with it.
3. **A gap between what the week's narrative was and what the tape did.**
4. If none of the three: **do not post.** See §1.

### Shape

Hook (the week's strangest number) → what moved → what it did to the board,
including anything that went against us → the saveable → signoff.

**The saveable on Saturday is the board state.** The open rows with their
triggers and invalidations, in one part, screenshot-able. That is the thing a
trader wants to find again on Monday morning.

## 3. SUNDAY — THE WEEK-AHEAD

**The question it answers:** what could actually resolve something next week?

### Pull

- Earnings inside the next 5 sessions for anything on the board or anything
  above ~$50B that moves an index.
- Dated macro events: CPI, PPI, PCE, FOMC, jobs, Treasury auctions.
- Open board rows whose trigger or invalidation sits within reach of Friday's
  close — those are the rows next week can actually decide.
- Futures if they have opened by run time; **if they have not, say so** rather
  than reaching for a stale Friday number.

### The rule that makes this slot safe

**A level named in this post is a call, and a call gets logged.**

This slot names levels for Monday. That is exactly what `CLAUDE.md`'s logging
rule exists for, and the Week-Ahead is the slot most likely to break it,
because the levels feel like context rather than calls. They are calls.

```bash
node scripts/log-call.mjs --ticker XYZ --type conditional --price <last> \
  --trigger <level> --call "Week-ahead: ..."
```

**The post is not finished until the row IDs are echoed.** If a level cannot be
logged — no trigger, no invalidation, nothing scoreable — then it does not go
in the post. A level nobody can grade later is the thing the book exists to
prevent.

### Shape

Hook (the one dated event that decides the most) → the calendar, one idea per
part → the levels that resolve open rows → the saveable → signoff.

**The saveable on Sunday is the dated calendar with the consequence attached.**
Not "CPI Wednesday" — *"CPI Wednesday; a hot print puts the B-041 reclaim out of
reach and the row dies under 90.39."* The date plus what it decides.

## 4. WHAT NEITHER SLOT DOES

- **No predictions without a level.** "We think it goes higher" is not a call,
  it is a mood, and it cannot be graded. Every forward statement carries a
  number and an invalidation or it is cut.
- **No recap of our own wins.** That is the Scorecard's job (Friday 3:35p,
  generated from the book by `scripts/score-book.js`). A weekend post that
  drifts into a highlight reel is duplicating a slot that has receipts, without
  the receipts.
- **No filler because it is the weekend.** The gate in §1 is the point of this
  file.

---

## Version note

v1, 2026-08-10. Never overwrite this file — a change means
`bench-weekend-v2.md` and updating the pointer in each weekend routine. Same
rule as the copilot, marquee and bench-daily prompts.

*Proof, not hype.*
