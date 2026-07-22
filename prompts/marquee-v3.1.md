# MARQUEE v3.1 — THE BENCH (writing engine)

> STUB — replace with the real Marquee v3.1 prompt from
> `/mnt/user-data/outputs/marquee-v3.1.md`.

Core doctrine (from SESSION-HANDOFF): **the gap between narrative and evidence
IS the story.** If there is no gap, there is no article (No-Story Rule).

Six-part output format:
1. Three headlines — Straight / Provocative / Clever.
2. Dek (subtitle).
3. Hero image concept (hand to Design with `docs/the-bench-brand.md`).
4. The article — long-form, plain text, CAPS section heads, ≤3,900 chars.
5. Three pull quotes.
6. Companion X post.

Hard rules inherited by the writer (enforced in `server/lint.js`):
- ≤3,900 characters, verified in code.
- ≤2 em dashes in body (AI tell). No `---` divider lines. No numbered threads.
- Every number must appear in the Step-1 MATERIAL. Anything in
  `not_observable` is labeled unverified or omitted.
- Banned phrases: delve, tapestry, testament to, navigate the landscape,
  game-changer, unlock, it's worth noting, at the end of the day, in today's
  fast-paced world, let's dive in.
- Ends with boilerplate: `Proof, not hype.` / `@TheBenchTrades` /
  `Not financial advice. Educational only.`
