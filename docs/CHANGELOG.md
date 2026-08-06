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

## 2026-08-06 — The X Viral Engine update

**What broke.** Nothing checked a post before it went public, and the one checker we had would have rejected a correct one.

The `--auto` publish gates came off on 2026-08-04. Since then the drafting step has been the only thing standing between a draft and 89 followers' timelines. That check was `server/lint.js`, and it had **zero tests** — in a repo that shipped `log-call` with twenty.

Worse, it was wrong. On 2026-08-05 we made a line of exactly three dashes the thread separator, because chains outreach single posts by 4x on our own numbers. But `lint.js` was written when `---` meant a stray divider, and still flagged it as one. **A correctly-formed chain failed the lint.** Nobody noticed, because nobody was running it.

Underneath that, four prompt files were quietly disagreeing about the same 280 characters — one said long-form, one said chains only, one banned em dashes, one allowed two.

**What shipped.**

- **`prompts/x-viral-engine-v1.md`** — Adam's engine, written from the published X recommendation-system architecture, covering hooks, dwell, saveables, conversation triggers, media, and originality. It opens with a precedence block that settles all nine collisions with the prompts already here, in writing, with dates. No more guessing which file wins.
- **`lintChain`** — the checker that understands what we actually publish. Part count, per-part length with URLs counted at 23 characters the way X counts them, zero em dashes, a checkable number in the hook, no question as a hook, banned phrases, banned generic openers, engagement bait, hashtag cap, disclaimer on the last part. *(39 tests.)*
- **Fuzzy rules warn instead of blocking.** "Is there something worth bookmarking here?" is a real rule but only approximable by regex, so it reports and never fails a post. **A brittle pattern must not be able to kill a real draft** — with the gates off, a false failure has nowhere to appeal to.
- **The engine's self-score does not gate anything.** Adam's draft scored itself 0–50 and revised below 42. That is useful drafting pressure and a terrible safety mechanism, because it is the model marking its own homework. The rubric stayed, as private discipline; everything countable in it moved into code. Same rule as the grades: *count it, or don't claim it.*
- **`lint_chain` as an MCP tool**, because the six routines that write the daily posts live in another repo and could not otherwise reach the checker.

**The bug the tests found while being written:** the hook rule is *"open on a number, not a verdict"*, and the first version checked for a digit. That rejects `bench-daily-v1`'s own worked example — *"Three of the five biggest companies in America are red before the bell"* — where the numbers are spelled out. The rule was right and the regex was too literal. Spelled numerals count now, and the canonical example is pinned as a test so it cannot regress.

**Why it matters beyond housekeeping:** we removed the safety rails on publishing and replaced them with a promise to be careful. This puts something countable back in front of the account, without putting a gate back in Adam's way.

**Still open:** `bench-daily-v2` to delete a stale section that contradicts the same file's own rule, and confirming the chain-posting behavior against the x-poster repo directly rather than from its description.

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
