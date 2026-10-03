# HUNT SHORT - design note (2026-09-16)

**Origin.** Adam, 2026-09-16 ~02:00 CT, after the LITE short-gate answer: *"we need to start eyeing quicker plays like this puts or what shorts."* Then: *"build it."*

**Gap it closes.** v23 evaluates the short side on every scan, but nothing hunts for it. The Grok-side hunter fires on relative-strength acceleration (long-only). Shorts reached the desk only as longs that failed. GRAB (B-415) passed all three short gates with no verified target because nobody was looking for the setup on purpose.

**What ships.** `scripts/hunt-short.mjs` (zero-dep, read-only unless `--write`), `test/hunt-short.test.mjs` (7 tests, offline), receipts in `db/hunts/short/YYYY-MM-DD.json`.

**Screen (last settled bar, Yahoo daily, 5y):**
- G1 breakdown: close < SMA50, close <= prior 20-session low, volume >= 1.5x 30-day average.
- G2 laggard: 20- and 5-session return both behind SPY.
- G3 catalyst: NOT computable; printed OWED, the desk verifies before READY means anything.
- Verified floor: nearest pivot low below price (pivot = lower than 5 bars each side), plus the next shelf down. No pivot below = NO VERIFIED FLOOR = cannot show 2:1 (the GRAB gap).
- Geometry: entry close, stop = max(close + 1.0 ATR, 2-session high), target floor, R:R >= 2 or not READY.
- Readiness 0-100 from volume, R:R, relative weakness and floor distance; capped 60 inside 2 sessions of a macro row on `db/catalysts.json`.
- Lists: READY (cap 3) / STALK / DISCOVERY / NO_FLOOR.

**Structure.** Defined-risk put spread, long strike near the close, short strike near the floor, 1-2 week expiry, MAX LOSS <= the 10 pct band. The script does not price options; the desk prices at the open. Decide-by 5 sessions.

**Rules that outrank it.** Every READY name runs the full v29 framework and gets a `log-call.mjs` row. Nothing here is a ticket. Not before a macro print. Cash account ••7724 cannot short; margin ••6137 can (options level 3). No base rate is a buy signal (v28 §QUANT EVIDENCE).

**First live preview (2026-09-15 bars, Fed cap on):** READY 0/3. GRAB G1+G2 but floors 2.90 (2024-01) and 2.85 (2023-05) sit 0.08 ATR under price = R:R 0.06 / 0.34, not a short. KLIC, AVGO, CRWV, AAOI, VST, CEG, ORCL all STALK (laggards under the 50-day, no volume break yet).

**Next: the options hunter (Adam, same night: "you have the ability to watch 100 different set ups at once and generate probabilities... bring me the best probabilities and faster payout").** Pipeline, all from equipment already on the desk:
1. Universe ~100 names (board + watchlist + Robinhood scanner `run_scan` for the long and short shapes).
2. Both hunts (RS acceleration long, HUNT SHORT) produce hits with geometry.
3. `quant-evidence.mjs --setup breakout|breakdown|move --horizon N` gives each hit a graded base rate (A-F by sample size and regime span) = the desk's p.
4. Robinhood option chains, 1-2 week expiries: for each hit, candidate debit spreads; cost, max gain, break-even, broker chance_of_profit and delta = the market's p.
5. Expected value = p_desk x max gain - (1 - p_desk) x max loss; rank by EV per session, filter max loss <= the band, flag where p_desk and the market's p disagree by more than 15 points (the edge, or the error).
6. Top 3 to the phone at the close as a card; the desk judges each before any ticket; rows via log-call.mjs, QR ids cited.
Honesty limits: p is an estimate with a grade, never a signal; C/D/F evidence never outranks primary evidence; the account (BP 62.41 on 9/16) caps what can be funded regardless of EV.

---

## ADDENDUM 2026-09-16 ~03:30 CT - the options hunter shipped, routine at the close

Adam: *"routine at the close, and yes build it."*

**Shipped.** `scripts/options-hunter.mjs` (+ `test/options-hunter.test.mjs`, 6 tests; suite 13/13 with hunt-short). Scheduled task `bench-hunt-close`, weekdays 3:25p CT (cron `25 15 * * 1-5`), first run 2026-09-16 after the Fed.

**Design change found in the first preview.** "Nearest pivot" targets were often one cent away (GRAB 2.90, CEG 259.09, ORCL 139.72), which produced a 2.91/2.90 put spread. Both screens now walk the verified pivots outward until one PAYS 2:1 against the stop (`payingFloor` / `payingCeiling`); the first shelf is reported separately; anything beyond 6 ATR is "none inside 6 ATR" because it is not a 5-session play. Second preview (9/15 bars, Fed cap on): READY 1 (GRAB short, target 2.51, R:R 2.29, p_reach 2.5%), STALK 10, DISCOVERY 3. The tiny p_reach values are the honest answer: the payoff a 2:1 target needs is rare in 10 sessions, and EV ranking will say so.

**Pipeline (all in the repo, no new dependencies):** screens -> paying targets -> base rates (server/evidence.js, graded) -> candidates.json -> routine pulls 7-14 day marks via Robinhood MCP -> `--ev-file` ranks by EV per session inside the band -> desk judges the top three (catalyst, earnings inside expiry, dead-theses) -> rows + QR ids -> read + ntfy.
