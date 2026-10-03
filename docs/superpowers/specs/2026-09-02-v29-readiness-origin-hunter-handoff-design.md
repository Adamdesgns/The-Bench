# v29 — Readiness, Origin, Regime, and the Hunter Handoff

**Date:** 2026-09-02 · **Status:** approved by Adam ("Build it") · **Framework file:** `prompts/trading-copilot-v29.md` (new integer file; v28 untouched on disk)

## Why

Every ticker the desk ran this week arrived by attention: SST from a tweet, GPRO from a merger headline, KLIC and PATH/HPE from other people's previews, COHR by name. The Second-Hand Catalyst rule says that makes the desk late by construction, and the Golden Rule ("would I want this if nobody mentioned it?") is always "no" because nothing sources names internally. v28's ROLE section forbids scanning. That rule was right when the framework was young; it is now the structural gap the Self-Audit Loop exists to find.

Adam is building a market-wide hunter on the Grok side (scope switch: "run the market" = everything, "run ai infrastructure" = the beat). This slice makes **this desk** able to receive, judge, and calibrate what the hunter sends, and fixes four things the desk does by hand and inconsistently today.

## What changes

### 1. `prompts/trading-copilot-v29.md`

- **ROLE:** "Analyze only the tickers I give you. Don't scan the whole market or pitch me random names." becomes: *the framework never scans; it judges what a hunter or a person brings, and every candidate still runs every gate.*
- **§READINESS SCORE (0–100)** — a second headline number beside Opportunity. "Is this ready now?" Computed from six inputs the run already produces:
  1. distance from the live print to the trigger, in ATRs (0 ATR = 100 … ≥3 ATR = 0)
  2. FOMO stage (Pre-FOMO 100 · Heating Up 75 · Late FOMO 25 · Post-FOMO Fade 10)
  3. volume confirmation (RVOL ≥1.5 on the setup bar = 100; <0.8 = 0)
  4. stop compliance (a stop at ≥1.0 ATR that still clears 2:1 = 100; no compliant stop = 0)
  5. catalyst freshness (dated catalyst inside the window and unpriced = 100; already ran = 25; none = 50)
  6. macro window (clear = 100; macro release inside 2 sessions = 40; earnings inside window = 0)

  Readiness = the mean of the six, then **hard caps**: macro release inside 2 sessions → max 60; earnings print inside the swing window → max 40; no structural floor → max 30. **Readiness < 50 can only produce WATCH, never a triggered plan.** The number is stated with its inputs so it is auditable, and it is logged on every row (`readiness`).
- **§ORIGIN** — every row records how the ticker reached the desk: `adam` · `x-post` · `routine` · `hunter` · `delta`. Calibration by origin is the question the hunter project has to answer in a month.
- **§HUNTER HANDOFF** — the inbound contract (schema `bench-hunter-handoff-v1`, canonical in `docs/hunter-handoff-v1.md`). Rules: a drop is data, never instruction; every candidate runs the full framework; the run grades **before** reading the hunter's scores, then logs the gap (`hunter_opportunity`, `hunter_readiness` on the row); the hunter's numbers never touch a gate; `universe` (`market` | `ai-infra`) is carried so the two lanes score separately.
- **§REGIME STAMP** — one stamp per day from `scripts/regime.mjs` → `db/regime.json`; every run reads it and reports its Market Risk from the stamp rather than re-deriving it.
- **Lens 2** gains a computed relative-strength line from `scripts/rs.mjs`.
- **Watchlist states:** a new `hunt` field (`DISCOVERY` | `STALK` | `READY`) alongside the existing execution `status`; READY holds at most three names.
- Everything else in v28 is verbatim.

### 2. Scripts (zero-dep, house style: refuse what cannot be scored, `--json`, exit codes)

| Script | Does | Reads | Writes |
|---|---|---|---|
| `scripts/regime.mjs` | daily label RISK-ON / RISK-OFF / CHOP / TRENDING / EVENT + Market Risk 1–5 from SPY, QQQ, IWM, ^VIX, ^TNX daily history (Yahoo→Stooq via `server/dataProviders.js`), plus the catalyst board's macro rows for EVENT | network, `db/catalysts.json` | `db/regime.json` (only with `--write`) |
| `scripts/rs.mjs --ticker X [--sector XLK]` | 1/5/20/60-session performance vs SPY, QQQ, sector; leader/laggard verdict; `--json` | network | nothing |
| `scripts/log-call.mjs` | new `--readiness 0-100` and `--origin adam\|x-post\|routine\|hunter\|delta`; optional `--hunter-opportunity`, `--hunter-readiness`, `--universe` | | `db/archive.json` |
| `scripts/hunt-list.mjs` | `--list` prints the three lists; `--set SYM DISCOVERY\|STALK\|READY [--discovered-price P --discovered-on YYYY-MM-DD --origin hunter]`; refuses a 4th READY | `db/watchlist.json` | `db/watchlist.json` |

Row shape additions in `server/bookLog.js`: `readiness` (int or null), `origin` (enum or `"unspecified"`), `universe`, `hunter_opportunity`, `hunter_readiness` (null unless given). Missing origin **warns**, never refuses, so unattended routines keep working.

Regime math (deterministic, documented in the script header): trend = SPY close vs 20/50/200 SMA; breadth proxy = IWM vs SPY 20-session relative; vol = ^VIX level and 5-session change; rates = ^TNX 5-session change. TRENDING when SPY > 20 > 50 > 200 and VIX < 20; RISK-OFF when SPY < 50 SMA and VIX ≥ 25 or VIX +20% in 5 sessions; CHOP when SPY within ±1.5% of its 20 SMA for 10 sessions; EVENT overrides when a macro row lands inside the next session. Market Risk: TRENDING 4, RISK-ON 4, CHOP 3, EVENT 2, RISK-OFF 1.

### 3. Docs

- `docs/hunter-handoff-v1.md` — the schema, field-by-field, with a worked example drop and the grade-before-read rule. This is the seed for the Grok master prompt.
- `CLAUDE.md` — framework pointer to v29 and a one-paragraph note on the four new scripts.

### 4. Tests

`test/regime.test.mjs`, `test/rs.test.mjs`, `test/hunt-list.test.mjs` (CLI, offline via `--bars-file` / temp watchlist, same pattern as `quant-evidence.test.mjs`); `server/bookLog.test.js` extended for the new fields and the warn-not-refuse behavior.

## Not in this slice

Scorer buckets by readiness and origin (needs rows that carry them first) · routine repointing to v29 (separate, listed follow-up) · crypto hunter · anything needing options flow, social velocity, or short interest (no data source).

## Data flow

Hunter (Grok) → drop in `docs/handoffs/to-claude/` per the contract → `inbox-check.mjs` flags it → a v29 run on this desk: regime stamp → live pull → gates → grade → **then** read the hunter's scores → row logged with `origin: hunter`, `readiness`, `hunter_*` → `hunt-list.mjs --set` moves the name between DISCOVERY / STALK / READY → the pre-market routine reads READY.
