# Benny's options lane: design (2026-10-16)

**Status:** approved in direction by Adam on 2026-10-16. The yes came through the Benny design session: "options my boy", then "we can open a new acct for options robinhood is where we get information from we can trade anywhere. this is just paper anyway", then on the risk setting, "increase the risk to a sensible amount deep dive into what the risks really on with a good trader". The sizing research is in `docs/research/2026-10-16-options-risk-sizing.md`.

**Goal:** Benny's $10,000 paper book beats the S&P 500 by reaching about 15% a year. Options magnify an edge; they never create one. So the lane only enters structures that still have positive expected value at real fill prices, and it is measured against SPY from day one.

## Rules

1. **Paper only.** Nothing here places, previews or reviews a real order. Robinhood is the data source only: chains, quotes and the broker's chance of profit. The level-2 options limit on Adam's real accounts does not apply to a paper book.
2. **Structures:** single calls, single puts, call debit spreads and put debit spreads. The most a trade can lose is the debit. A put or put spread is how Benny bets on a drop; there is no short stock and no naked short option.
3. **Fills are conservative: buy at the ask, sell at the bid.** For a spread that means:
   - Entry debit = long ask - short bid.
   - The value tonight = long bid - short ask, floored at 0 and capped at the width.

   The 2026-10-16 chain test showed the mid flatters narrow spreads by about 2x.
4. **Size: `options_risk_pct` = 2.** Contracts = floor(2% of equity / (debit x 100)). If one contract costs more than that, the trade is skipped and the reason recorded.
5. **Open-risk cap: `options_max_open_pct` = 6.** The debits of every open options trade together are at most 6% of equity. A new trade is cut to the contracts that fit, or skipped.
6. **Drawdown pause: `options_pause_drawdown_pct` = 15.** When equity is 15% or more below its highest recorded value, new options entries are skipped until Adam says go.
7. **The shares lane stays at `risk_pct` = 1.** It is unchanged.
8. **No entry when earnings fall on or before expiry.** An entry with no earnings date checked is skipped too; the routine passes the date or `none`.
9. **No Friday-close entries.**
10. **One open options trade per ticker.**
11. **The hunter lane only enters at positive EV at the fill.**
    - EV per contract = p_reach x (width - debit) x 100 - (1 - p_dir) x debit x 100, using the hunter's own p_dir and p_reach.
    - If the hunter's spread costs more than the cap, the routine may quote a narrower spread: the same expiry and long strike, with the short strike moved toward the long one. The same EV test applies. p_reach is for reaching the hunter's target, which is past the narrower short strike, so the test is conservative.
    - READY names only.
12. **Exits, checked every night on the closing quotes:**
    - **TARGET:** the stock's close reaches the hunter's or desk's target. Sell at the bid.
    - **EXIT-BY:** the decide-by date is reached (the entry date plus 5 sessions, the hunter's own clock, or the date the desk sets). Sell at the bid.
    - **EXPIRED:** on expiry, the trade is worth its intrinsic value at the stock's close.
    - There is no stock-price stop. The debit is the stop.
13. **R = realized dollars / debit paid.**

## Where it lives

- `scripts/benny-options.mjs` is new. It holds the pure functions (fill math, EV, sizing, the nightly step) and a CLI:
  - `hunt-add --ranked db/hunts/options/<date>.ranked.json --quotes '<json>' --earnings '<json>' [--date D]`: lane `options-hunter`.
  - `add --sym X --row B-### --structure call|put|call-spread|put-spread --expiry D --long-strike K --long-ask A [--short-strike K --short-bid B] --target T --exit-by D --earnings D|none [--p-dir --p-reach]`: lane `options-desk`.
  - `need [--json]`: the contracts the routine must quote tonight for open options trades.
  - `score --quotes '<json>' [--spy SPY_CLOSE] --date D [--write]`: scores open options trades and records SPY's close in the day's history row.
  - `spy-start --close X --date D`: a one-time baseline. Run on 2026-10-16 with SPY 763.30, the last regular-session print; the official close field had not rolled.
  - Every command takes `--db` (default `db/benny-book.json`) and `--config` (default `db/benny-config.json`). It refuses `db/paper-book.json`, because options never go in Adam's book.
- Options trades live in `db/benny-book.json` `trades[]` with `kind: "option"`, sharing the `PB-###` counter. Each one carries: structure, expiry, legs, contracts, entry_debit, cost, width, target, exit_by, earnings, p_dir, p_reach, ev_at_fill, last_value, and on close realized, r, exit_reason and exit_date.
- `scripts/paper-book.mjs` has three small changes:
  - `score` skips `kind: "option"` trades.
  - `summarize` counts an option's open profit as (last_value - entry_debit) x 100 x contracts.
  - `report` prints the options trades, the options open risk against its cap, a REVIEW DUE flag on any lane at 10/20/30 closed, and a **VS S&P** line: Benny's return against SPY's from `account.spy_start` to the latest history row carrying `spy`, plus where 15% a year would have the book by that date.
- `db/benny-config.json` gains `options_risk_pct: 2`, `options_max_open_pct: 6` and `options_pause_drawdown_pct: 15`. Like `risk_pct`, these are Adam's settings: no routine and no Benny answer changes them.

## Routines (edits shown to Adam first, backed up as `SKILL.md.bak-2026-10-16-options`)

- **bench-hunt-close BENNY STEP B2:** after `benny-book.mjs mirror`, pull bid and ask for each READY ranked spread's two legs (`get_option_instruments` + `get_option_quotes`), plus earnings, then run `benny-options.mjs hunt-add`. Monday to Thursday only.
- **bench-plan-check-close B2:** after the shares score, run `benny-options.mjs need --json`, quote those legs, get each stock's close and SPY's close, then run `benny-options.mjs score --quotes ... --spy ... --write`. It runs every weekday, including Fridays, so SPY is recorded even with no options open.
- **bench-week-recap B3:** the scorecard post includes the lanes and the VS S&P line from `paper-book.mjs report --db db/benny-book.json`.

## Tests (node:test, zero-dep): `test/benny-options.test.mjs`

- Fill math, single and spread. A spread whose ask/bid debit is at or above its width is refused.
- EV at the fill, and the positive-EV gate (the 10/16 negative-EV spreads are refused).
- Sizing: the 1-contract floor, a skip with the reason recorded, the open-risk cap cutting contracts, and the drawdown pause.
- Earnings on or before expiry and a missing earnings date are refused. A Friday entry is refused. A second open trade on the same ticker is refused.
- Narrower-spread rules: the long strike and expiry must match the hunter's, and the short strike must sit between them.
- The nightly step: TARGET and EXIT-BY sell at the bid; on expiry the value is intrinsic, OTM to 0 and ITM capped at the width; a missing quote leaves the trade untouched.
- `summarize` includes the options' open profit. `paper-book score` leaves options trades alone. The VS S&P line and pace arithmetic are correct. The `--db db/paper-book.json` refusal works.
