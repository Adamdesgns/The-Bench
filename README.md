# THE BENCH

## ⬇ DOWNLOAD THE APP (no coding needed)

1. Go to **[Releases](https://github.com/Adamdesgns/The-Bench/releases)** (right side of this page).
2. Download **`The-Bench-Setup-0.1.0.exe`**.
3. Double-click it. If Windows shows a blue "protected your PC" box: click **More info → Run anyway** (it appears because the app isn't code-signed yet).
4. The Bench opens as its own program. Put your Claude/OpenAI key in **Settings** — it saves to your PC only.

Everything below this line is for developers.

---

Source of truth for **@TheBenchTrades** — the daily market-research system.
This repo holds the canonical prompts, the trade book, and the specs. The
system will be built into an app; this is the material that app is built from.

**Two engines, chained:**
1. **THE BENCH v17** — analysis. Decides *what is true*.
2. **MARQUEE v3.1** — writing. Decides *how it is told*.

**The system drafts. A human publishes.** That line is a hard requirement.
No brokerage or X credentials live in this repo, ever.

> **Keep this repo PRIVATE.** It holds an open trading book, position triggers,
> and prompt IP.

## What's here

```
prompts/
  trading-copilot-v17.md   the operating analysis engine (feature-frozen)
  marquee-v3.1.md          the writing engine
  archive/                 v1-v16 history (rollback only)
db/
  archive.json             the book — 22 rows, source of truth
  archive-v4.xlsx          human/dashboard export
docs/
  SESSION-HANDOFF.md       full context restore — read this first
  daily-open-chain-spec.md the pipeline blueprint
  the-bench-brand.md       colors, type, voice, devices, boilerplate
  REPO-HANDOFF.md          repo + security notes
  HANDOFF-code.md          build notes + known issues
  HANDOFF-robinhood-automation.md  trigger-monitor spec (alerts only, no orders)
public/
  index.html               Bench OS — the report-first app window
  console.html             v17 run console, 6 panels
  desk.html                market desk, catalyst countdowns
  archive-mobile.html      phone ledger, card per call
```

## The book (`db/archive.json`)

One row per review. Append-only. 22 rows, 1 closed (B-004 MU). Every row carries
an `engine` tag (`claude` / `gpt-runner` / `manual`) and a `not_observable`
field so calibration stays honest. `archive-v4.xlsx` is the authoritative
export; `archive.json` mirrors it.

*Proof, not hype.*
