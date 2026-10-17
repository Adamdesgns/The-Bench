# Benny's options lane: design (2026-10-16)

**Status:** approved in direction by Adam on 2026-10-16. The yes came through the Benny design session: "options my boy", then "we can open a new acct for options robinhood is where we get information from we can trade anywhere. this is just paper anyway", then on the risk setting, "increase the risk to a sensible amount deep dive into what the risks really on with a good trader". The sizing research is in `docs/research/2026-10-16-options-risk-sizing.md`.

**Update the same evening (Adam's answers, relayed by the Benny design session):** "per swing", "per trade", "I mean 5% is acceptable at lower risk", then "makes 1k on 10k is optimal" and "swing the whole damn thing man". **Reading:** the target is about **$1,000 of profit per winning trade on the $10,000 book** (10% of the account), with about **$500 (5%) acceptable for lower risk**. It is a size for winners, not a promise. The risk numbers below were raised to fit it (2% / 6% became **3% / 9%**), and a **weekly refill** was added (section at the end). If "until it's 10k per week" meant a goal of $10k income a week, that is not built; Adam says so and it becomes a tracked target.

**Goal:** Benny's $10,000 paper book beats the S&P 500 by reaching about 15% a year. Options magnify an edge; they never create one. So the lane only enters structures that still have positive expected value at real fill prices, and it is measured against SPY from day one.

## Rules

1. **Paper only.** Nothing here places, previews or reviews a real order. Robinhood is the data source only: chains, quotes and the broker's chance of profit. The level-2 options limit on Adam's real accounts does not apply to a paper book.
2. **Structures:** single calls, single puts, call debit spreads and put debit spreads. The most a trade can lose is the debit. A put or put spread is how Benny bets on a drop; there is no short stock and no naked short option.
3. **Fills are conservative: buy at the ask, sell at the bid.** For a spread that means:
   - Entry debit = long ask - short bid.
   - The value tonight = long bid - short ask, floored at 0 and capped at the width.

   The 2026-10-16 chain test showed the mid flatters narrow spreads by about 2x.
4. **Size: `options_risk_pct` = 3.** Contracts = floor(3% of equity / (debit x 100)). At $10,000 that is $300 at risk, so a spread paying 1.6-3x its cost makes $480-900, the $500-1,000 winner Adam asked for. If one contract costs more than that, the trade is skipped and the reason recorded.
5. **Open-risk cap: `options_max_open_pct` = 9.** That is three full-size trades. The debits of every open options trade together are at most 9% of equity. A new trade is cut to the contracts that fit, or skipped.
6. **Drawdown pause: `options_pause_drawdown_pct` = 15.** When trading equity (equity minus refill deposits) is 15% or more below its highest recorded value, new options entries are skipped until Adam says go.
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
- `db/benny-config.json` gains `options_risk_pct: 3`, `options_max_open_pct: 9`, `options_pause_drawdown_pct: 15`, `refill_trigger: 9000`, `refill_target: 10000` and `refill_amount: 500`. Like `risk_pct`, these are Adam's settings: no routine and no Benny answer changes them.

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

## The weekly refill (added 2026-10-16, applies to the whole book: shares and options)

Adam: "we take a loss we wait for a $500 income per week. $500 gets added back to the bank until it's 10k per week as if it was me working. i'm testing this for my 10k bag in the future", then "correct refill until 10k. ideally this never happens. I probably wouldn't kick that in until it's below 9k".

- **When:** `node scripts/benny-book.mjs refill` runs at every weekday close. It acts only on the week's first trading day, meaning the first close of the week with no earlier history row that week.
- **Start:** that day, if equity is under `refill_trigger` ($9,000), the refill turns on.
- **While on:** it deposits min(`refill_amount` $500, `refill_target` $10,000 - equity) once a week. It keeps going even after equity climbs back above $9,000.
- **Stop:** it turns off at $10,000 and turns on again only when equity drops below $9,000 again.
- **Deposits are not gains.** They live in `book.deposits` [{date, amount, equity_before, total}]. `summarize` puts them in equity (sizing uses the cash that is in the bag) but never in trading P/L or the return. `vsSpy` and the options drawdown pause use trading equity, which is equity minus deposits.
- **Report:** `TRADING P/L ... ; refill deposits ...; equity ...`, plus `REFILL off (equity above 9000)` or `REFILL ON: X left to 10000`.
- **Tests:** `test/benny-book.test.mjs` (refill) and `test/benny-options.test.mjs`.
