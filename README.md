# THE BENCH

Source of truth for **@TheBenchTrades** — the daily market-research system.
This repo holds the canonical prompts, the trade book, and the specs.

**Keep this repo PRIVATE.** It holds an open trading book, position triggers,
and prompt IP.

No brokerage or X credentials live in this repo, ever.

---

## What actually runs (not the installer)

The live analysis engine is a **prompt**, not the Electron app.

1. **THE BENCH v25** — `prompts/trading-copilot-v25.md`. Decides *what is true*. Same file for an interactive "run the market" chat and for the weekday daily machine.
2. **MARQUEE v3.1** — `prompts/marquee-v3.1.md`. Decides *how a long-form piece is told*.
3. **BENCH DAILY v4** — `prompts/bench-daily-v4.md`. Owns the opening, the saveable element, and the required sentiment read on scheduled posts. Default shape is one standalone post.
4. **BENNY v2** — `prompts/benny-v2.md`. Who is speaking. Mentions (Benny §6) are spec only — not wired.

**Weekday dailies auto-publish** through the separate repo Adamdesgns/x-poster (`post_next.py --auto`). Adam is the fail-safe after the fact (phone push + the `HALT` file). Interactive market runs still draft; Adam executes every trade himself. Nothing here places an order today: the one execution artifact in the repo (`prompts/bench-executor-v1.md`) is UNTESTED with live execution disabled, and research surfaces never mount broker order tools — `docs/executor-test-protocol.md` is the only path that changes this.

The operating manual for agents is `CLAUDE.md`. Read that first.

## ⬇ Desktop app (optional, not the live engine)

GitHub [Releases](https://github.com/Adamdesgns/The-Bench/releases) has **v0.1.0** and **v0.2.0** (latest installer: `The-Bench-Setup-0.2.0.exe`). That Electron console is still in development. Downloading it is not "running v25." Put a Claude/OpenAI key in Settings only if you are using the app — it saves to your PC only.

If Windows shows a blue "protected your PC" box: **More info → Run anyway** (the app is not code-signed yet).

---

## What's here

```
CLAUDE.md                  how to operate this repo (read first)
prompts/
  trading-copilot-v25.md   current analysis engine
  bench-daily-v4.md        weekday daily hooks / standalone default
  benny-v2.md              account persona (mentions still spec-only)
  marquee-v3.1.md          writing engine
  archive/                 v1–v16 history (rollback only)
db/
  archive.json             the book — 137 rows through B-137, source of truth
docs/
  growth-playbook.md       evidence behind the daily hooks
  the-bench-brand.md       colors, type, voice, boilerplate
site/                      public scoreboard build (HTML only goes public)
```

## The book (`db/archive.json`)

One row per review. Append-only. **137 rows** on this branch (B-001 through B-137).
Every row carries an `engine` tag and a `not_observable` field so calibration
stays honest.

*Proof, not hype.*
