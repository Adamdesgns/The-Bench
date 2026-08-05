# THE BENCH — changelog

Every shipped update gets an entry here, a short post from **@TheBenchTrades**, and a quote-share draft in Adam's voice for **@adamdesgns**.

Adam's rule, 2026-08-04: *"every time we update I say you create an update version with what was improved and then we create a quote share in my voice so I can quote share the post with my account."*

**The ritual, in order:**

1. Add an entry here — version, date, what improved, and *why it needed to*.
2. Draft the Bench post to `apps/x-poster/approved/<date>-update.txt`. Short, per `prompts/bench-daily-v1.md` §0 — a system update is not a market update and not a data dump.
3. Draft the hype quote-share to `apps/x-poster/queue-adamdesgns/<date>-update-hype.txt`, per `prompts/hype-v1.md` and the `adams-voice` skill.
4. Publish the Bench post. Adam quote-shares it.

**The rule for what goes in a post:** the update has to be legible to someone who does not know the codebase. "We added `validateCall`" is not a post. "The book now refuses a trade we can't grade later" is.

---

## 2026-08-04 — The Book Integrity update

**What broke.** 17 of 26 scored checkpoints in the trade book could not be graded. Not because the calls were wrong — because of how they were written down. Conditionals logged with no trigger level, so the gate could never be judged. Hedges logged with no position size, so there was nothing to score. Four energy names ran 13–18% and the book cannot claim a dollar of any of them.

Worse, the pattern repeated outside the book: SPCX was called in conversation and never logged at all, and a GOOGL row referenced in the day's notes was never committed to any branch. The calls that go unrecorded are disproportionately the ones worth pointing at later.

**What shipped.**

- **`log-call`** — any chat logs a call in one command, and the command **refuses rows that cannot be scored**. A conditional without a trigger is rejected. A hedge without a size is rejected. A long without an invalidation, a BET without a stated max loss — all rejected. These stopped being things to remember and became things that cannot be written. *(20 tests, red-first.)*
- **`log-pattern`** — the observations layer. The book records calls; this records claims about how the tape behaves, with instances attached and a hit rate. **A pattern with no falsification test is refused** — "beats get sold" is a vibe, "the 2-day return is negative for names up 8%+ into the print" is a claim that can be wrong. Status is derived from the instances, never asserted, and a pattern needs three before it stops being a coincidence with a good story. *(16 tests.)*
- **Grades stay null unless the framework actually ran.** A guessed grade is worse than no grade, because it looks like work was done.
- **Rows record which chat logged them**, so the cross-chat rule leaves a trace.

**Seeded on day one, all instances verified:** four patterns from a single session — beats being sold after a big run into the print (AMD, SPCX), 7-day verdicts inverting by 30 days (LMT, MSFT), relative volume identifying the real repricing in a crowded tape (BRKR), and sub-10% float meaning supply sets the price rather than the business (SPCX).

**Why it matters beyond housekeeping:** v23's Self-Audit Loop already says to improve the framework from *"structural gaps or repeated patterns, never single outcomes"* — but nothing recorded repetition, so the loop had no data and could not fire. It can now.

**Still open:** the evening reconciler (pull real orders, flag anything not in the book) and the gap checker (find calls in notes and posts that were never logged). Until those land, the discipline only holds where someone remembers to run the command.
