# TRADING COPILOT v17 — THE BENCH (analysis engine)

> STUB — replace with the real, feature-frozen v17 prompt from
> `/mnt/user-data/outputs/trading-copilot-v17.md`. This file is the ONLY
> version the runner loads. v1–v16 live in `prompts/archive/`, rollback only.
> Never overwrite a version file; every framework change is a new integer.

Until the real prompt is dropped in, this stub records what v17 must contain
(from SESSION-HANDOFF section 4) so nothing is lost:

- Two-Lens Method: Chart (trend, structure, MAs, momentum, volume, Trend
  Strength 0–10) + Mood (regime, Market Risk 1–5, sector, catalysts, Earnings
  Quality, Institutional Lens, insider check).
- Four-part grading: Technical / Fundamental / Execution / Overall. Overall
  capped by the Capital Competition Test.
- Opportunity Score 0–100, grade-bounded: A→100, B→89, C→69, D→49, F→29.
- Capital Competition Test: must beat cash, the market (SPY/QQQ), the
  watchlist, and be worth a swap. Loses to cash/market → No Trade.
- FOMO Clock: Pre-FOMO / Heating Up / Late FOMO / Post-FOMO Fade.
- HODL Call (separate from swing verdict): durable business, real
  fundamentals, secular tailwind, survivability.
- Confidence vs Conviction stated separately every time.
- Global Peer Check: memory→Samsung/SK Hynix · foundry→TSMC · equipment→ASML
  · luxury→LVMH · autos→Toyota/BYD · miners→BHP/Rio.
- Position lifecycle: Watching → Triggered → Working → T1/Trailing → Closed.
- Re-run trigger: a broken *logged assumption* is the ONLY justification for a
  mid-trade Delta re-run.
- Default swing window 2–8 weeks; crypto compresses to hours/days.
- Options gated: flow analysis fires ONLY on explicit "Run options $TICKER".
- Research/Battle-Test Mode: skips account-size questions, marks sizing
  "research-only".
- Multi-Ticker Batch Rule: 3+ tickers compress narrative; Verdict/Plan/Capital
  Competition/Assumptions/Archive row always survive.
- Calibration is aggregate-only. Never judge a single call by its outcome.
- Data Integrity: every number live-looked-up or labeled "not observable".

Output contract: the structured JSON in `server/reviewSchema.js`.
