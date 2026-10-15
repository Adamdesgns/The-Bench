# How the full suite works

**What runs when Adam says "run the full suite including the hunters" on a ticker, and how each piece produces its answer.**

Written 2026-10-15 under framework v35 (`prompts/trading-copilot-v35.md`). The worked example throughout is the BTC-USD run that day (row B-911, review `site/reviews/2026-10-15-btc.md`). The six-agent workflow from that run is saved beside this file as `docs/full-suite/btc-full-suite-2026-10-15.js`.

**The short version:** a full-suite run has seven stages. Only stage 5 uses AI judgment. Every other stage is a plain script that does the same math every time, so its answer can be checked and re-run.

---

## 1. Memory and safety checks

| Step | What it does | BTC, 2026-10-15 |
|---|---|---|
| `node scripts/inbox-check.mjs` | Checks the handoff folder (`Projects\docs\handoffs\to-claude\`) for a note from Morgan or the Grok side. Exit 1 means a note is waiting and gets read first. | Nothing waiting |
| Worklog claim | Writes `**[Claude]** CLAIMED: <ticker>` in `Projects\docs\handoffs\worklog\<date>.md` after checking no other desk already claimed the ticker that day. The first claim owns the ticker. | Claimed |
| `node scripts/regime.mjs --write` | One market-mood stamp per day, computed from SPY, QQQ, IWM, VIX and the 10-year yield. Labels: TRENDING, RISK-ON, CHOP, RISK-OFF, EVENT or NEUTRAL, turned into a Market Risk score from 1 (defense only) to 5 (aggressive). Every run that day uses the same stamp instead of guessing its own. | NEUTRAL, 3 of 5 |
| `node scripts/dead-theses.mjs --ticker X` | Reads the book back for the ticker: every old row and how it ended, every trigger that expired, every lesson already paid for, every pattern instance, and which rows are still open. An open row turns the run into an update ("delta") on that row instead of a fresh call. | B-800 was open, so the run was a delta on it |
| Catalyst board (`db/catalysts.json`, `scripts/catalyst-watch.mjs`) | The dated events ahead: Fed meetings, inflation reports, earnings, FDA dates. | The 10/29 GDP and PCE release was missing and got added |

## 2. Live data

- **Robinhood, read-only.** The live quote with bid and ask, and the account balance. The balance sets the 10% risk band. Research sessions never load broker order tools.
- **Yahoo daily bars.** Five years of free price history. Every script below works from these bars. Bitcoin's daily bars are UTC days, which settle at 7 PM Central.

## 3. The hunters: plain code, no AI

The hunters look for setups on their own rules and write a receipt with an ID. **Their scores are hidden from the judge in stage 5 on purpose.** The desk grades first and compares after, so a hunter's confidence can't sway the verdict (v29).

### `scripts/hunt-short.mjs` — looks for breakdowns on purpose

A short has to pass three gates:

1. **Breakdown:** the last settled close is under the 50-day average and at or under the lowest point of the prior 20 sessions, on at least 1.5× the 30-day average volume.
2. **Laggard:** the stock is behind SPY over both the last 20 sessions and the last 5.
3. **Catalyst:** a script can't read news, so this gate is printed as OWED, and the desk must confirm a real reason (news, a filing, a guidance cut, insider selling).

Then:

- **Verified floor.** The nearest past low below the price where the price turned. A low counts only if it was lower than the 5 bars on each side, searched across up to 5 years. No floor below means no verified target, and the trade can't show 2 to 1.
- **Stop.** Whichever is higher: one average daily move (ATR, the 14-day average true range) above the price, or the high of the last two sessions.
- **READY** only if the trade pays at least 2 to 1 down to the floor. Readiness is capped at 60 within 2 sessions of a big economic release, and no more than 3 names can be READY at once.
- **Structure for stocks:** a put spread whose maximum loss fits inside the 10% band, with a 5-session deadline.

**BTC:** STALK, not READY. Volume was 1.35× (it needed 1.5×), and the price was not at its 20-day low (80,336.91). Stop 84,049.06, target 74,436.68: 2.11 to 1 before Robinhood's spread, 1.09 to 1 after it. Readiness 60, capped because that day's PPI release was on the board. Receipt `b776e4e5`.

### `scripts/options-hunter.mjs` — both sides, with odds from history

It runs a long search and a short search on the same bars.

- **The long search:** a breakout above the prior 20-session high on at least 1.5× volume, while ahead of SPY over 20 and 5 sessions. The stop goes one average daily move below the price or under the last two sessions' low, whichever is lower. The target is the first verified level above that pays 2 to 1. Nothing more than 6 average daily moves away counts.
- **The short search:** the same gates as `hunt-short.mjs`.
- **Labels:**
  - **READY:** every gate passes and it pays 2 to 1.
  - **STALK:** partly there, with a target that pays.
  - **DISCOVERY:** only ahead of the market so far.
- **Readiness:** the average of four scores from 0 to 100: volume, payoff, strength against SPY, and distance to the target. It is capped near a big economic release.
- **The odds (base rates).** For each hit it goes back through that stock's own 5 years of history (`server/evidence.js`), finds every time the same pattern appeared, and counts two things:
  - **p_dir:** how often the price moved the right way within 10 sessions;
  - **p_reach:** how often it actually reached the target.

  Then it grades how much to trust that count:
  - **A:** 30 or more separate cases over 5+ years.
  - **B:** fewer cases or fewer years.
  - **C:** a thin sample or a single market regime.
  - **D:** under 5 cases.
  - **F:** none.

  Overlapping cases are counted once, so the grade can't be inflated by the same move seen twice.
- **Options (stocks only).** The evening routine pulls 1-to-2-week option prices, and the script ranks defined-risk spreads by expected value. EV = p_reach × max gain − (1 − p_dir) × cost. It drops any spread whose cost is above the band and prints the gap between the desk's odds and the broker's "chance of profit."

**BTC:** the same short, STALK. In the past this pattern fell within 10 sessions 43.69% of the time and reached the target 12.62% of the time, across 103 cases, grade A. Robinhood has no BTC options, so no spread was priced. Receipt `95e7fa1c`, logged as prediction PR-130.

**Known flaw (2026-10-15):** bitcoin trades on weekends, so for BTC the hunters' "20 days" is 20 calendar days, not 20 trading sessions. A fix was proposed as a separate task.

**A probability here is a count of the past, never a buy signal.**

## 4. The evidence scripts

- **`scripts/quant-evidence.mjs`** tests the specific claim the trade idea makes against the ticker's history, graded the same A to F way, and logs a QR id in `db/quant-runs.json`. It is run on demand, only when a thesis makes a testable historical claim.
  - BTC QR-042: after a 5% drop in 5 days, BTC was higher 10 days later 53.4% of the time (grade A, 70 cases). Buying that kind of dip is close to a coin flip.
  - BTC QR-043: after BTC broke its prior 20-day low, a short won only 43.7% of the time (grade A, 59 cases).
- **`scripts/rs.mjs`** compares the ticker with SPY, QQQ and its sector over 1, 5, 20 and 60 sessions and calls it LEADER, LAGGARD or MIXED. This feeds the **Capital Competition Test**: a name's grade gets capped only when it trails on both the 20- and the 60-session windows (v35). A split is reported but never caps. BTC led on both.
- **`scripts/insider-check.mjs`** reads SEC Form 4 filings for insider buying (open-market purchases) and selling. Routine grants, option exercises and tax withholding are counted but never treated as a signal. Repeated same-size sales usually mean a pre-scheduled selling plan. **For crypto, money flows replace this check:** spot-ETF inflows and outflows, funding rates, exchange reserves and stablecoin supply.

## 5. The AI desk: six agents in a workflow

The AI part runs as a workflow script (the BTC one is saved at `docs/full-suite/btc-full-suite-2026-10-15.js`). Every agent gets the same house rules: no invented numbers (every number comes from a file, a shown calculation or a cited source, or it is marked UNVERIFIED), never place or suggest an order, never substitute a ticker, plain English.

**Gather** (two Sonnet agents at the same time):

- **News, flows and catalysts desk.** Web searches with a source URL for every number. It covers what moved the name in the last week, money flows, derivatives positioning, the macro link (e.g. the Fed meeting odds), dated catalysts in the next 30 days, and how the broker handles the order types the plan needs.
- **Chart and levels desk.** It writes its own small script over the bars and computes:
  - the ATR (14-day, Wilder smoothing) through the last settled bar, showing its working;
  - the 20-, 50- and 200-day averages and their slopes, RSI, and volume against normal;
  - verified levels: a turn with at least 3 bars lower or higher on each side, within 6 average daily moves;
  - a re-check of every level the old row relied on.

  Then it tests candidate trades against the house rules, marking each legal or not. For BTC there were five: the old plan as written, the old plan repaired, buy now, short now, and short after a breakdown.

**Judge** (one Opus agent). It reads the framework sections in full, the old rows on the ticker and both desks' reports, but **not** the hunters. It rules on the long side and the short side separately, and on what changes in any open row. It produces:

- the four grades (chart, fundamentals or flows, execution, overall);
- readiness, the opportunity score and confidence;
- the bull case and the bear case;
- a watcher for every level;
- the forward prediction;
- the report card.

**Verify** (three Opus agents at the same time). Each one tries to prove the judge wrong, defaulting to skepticism:

- **Math and levels:** recomputes everything from the bars. It is the first agent allowed to read the hunters' receipts, and it reports where the hunters and the judge disagree and who is right.
- **Framework compliance:** checks the verdict rule by rule against v35.
- **Data and news:** reopens every source and checks dates, numbers and missed catalysts.

Each problem is rated **blocker** (changes a verdict or a level Adam would act on), **material** (a wrong number or missed rule to fix in the record) or **minor** (wording).

**What the checkers caught on BTC:**

- The judge's buy-now and short-now stops were within one normal day's move, which breaks the rule that a stop sits at least one average daily move away. The legal stops made both trades worse, but the verdicts held.
- The prediction odds were written in the wrong units.
- Readiness read 59 on the desk's reading and 49 if that morning's PPI release counted as an event the way the hunters count it.
- The weekend-stop logic didn't hold together, so the whole plan stays paper until Robinhood's weekend stop behavior is confirmed.

## 6. Reconcile and log

Claude applies the checkers' fixes, re-pulls the live price, and writes the record. Nothing counts until a row ID has been echoed (LOG IT).

| Script | Writes | BTC |
|---|---|---|
| `scripts/log-call.mjs` | the book row in `db/archive.json`. It refuses incomplete rows: a conditional with no trigger or decide-by, a long with no stop, a hedge with no size, a bet with no max loss. | B-911 (supersedes B-800) |
| `scripts/mind-changer.mjs add` | a watcher on every level in `db/mind-changers.json`, checked against official closes by the close routine | MC-168 to MC-176 |
| `scripts/predict.mjs add` | each forward claim in `db/predictions.json`, scored on that source's own deadline, with its stated odds shown next to its real hit rate | PR-130 (hunter), PR-131 (desk) |
| `scripts/quant-evidence.mjs` | QR ids, logged by the script itself | QR-042, QR-043 |
| `db/watchlist.json`, `db/tape.json`, `db/catalysts.json` | the board, the price strip, the event calendar | BTC-USD added as CONDITIONAL-PAPER |
| `scripts/paper-book.mjs hunt-add` | a paper short for any hunter READY short the desk passes on | not owed: both hunters said STALK |

## 7. The record

- The full review is saved as `site/reviews/<date>-<ticker>.md`, and `node site/build.mjs` rebuilds the private dashboard in `site/dist/`.
- A worklog line, a bullet in the vault's daily note, and an Open Loops row for anything left hanging.
- A commit and push the same day. A cloud run on a stale book reuses row IDs, which happened on 2026-10-01.
- The report card at the end: verdict, grade, the number, the plan, what opens it, what kills it, the next date, Adam's call, and the row ID.

## What keeps running after the run

| When (CT) | Routine | What it does with the run's output |
|---|---|---|
| 3:29 PM weekdays | `bench-plan-check-close` | tests every watcher and buy zone against the close, scores the paper books |
| 3:35 PM weekdays | `bench-hunt-close` | runs both hunters across the whole board, prices spreads, judges the top three, scores every open prediction |
| 9:11 AM weekdays | `bench-entry-check-open` | tests yesterday's signals on the first 30-minute bar and sends ENTER (the exact ticket and stop) or NO TRADE |
| 6:39 AM weekdays | `bench-calendar-order-nag` | events inside two days, decide-by dates coming due, and any armed order not resting at the broker |

**Gap as of 2026-10-15:** no routine checks BTC's watchers against its settled UTC daily closes, weekends included. The fix was proposed as a separate task.

## The rules every answer has to pass

| Rule | In plain English |
|---|---|
| The ATR floor | A stop sits at least one average daily move (1.0 ATR) from every price you could fill at. Closer than that, normal noise stops you out. |
| 2 to 1 at the worst fill | The trade must pay at least twice what it risks, measured from the worst price in the buy zone, after the broker's spread. |
| Verified targets | A target must be a real past turning point within 6 average daily moves, never a moving average or a round number. |
| The tightest legal stop | Use the closest stop that sits beyond a real level and clears the ATR floor. A wider stop makes the payoff look worse than it is. |
| Readiness | Under 50 means watchlist only. No ticket, no live trigger. |
| The 10% band | Size comes from 10% of the account, recomputed every run. Buying power never ranks or gates a call. |
| Both sides | The short side is checked on every run. Acting on it needs all three short gates. |
| Grade first | The desk grades before reading the hunters, then logs where they disagree. |
| Log and watch | Every call gets a row, every level gets a watcher, every prediction gets a deadline and a score. |
| No invented numbers | A number is pulled live, computed with the working shown, or cited. Otherwise it is marked UNVERIFIED. |
