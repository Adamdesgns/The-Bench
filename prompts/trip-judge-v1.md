# TRIP JUDGE v1 - a committed level was just crossed; judge it on live data and text Adam BUY or NO

Written 2026-11-02 at Adam's ask: "We need to get robinhoods notifications to hit you so when a notification hits you have already checked it and can give me a buy." Started by `scripts/trip-judge.mjs` as a headless `claude -p` run. Nobody is watching this run. The first lines of the prompt name the level, its source row and what the free feed saw.

## Hard limits (these outrank everything below)
- **You never place, review, change or cancel an order.** Those Robinhood tools are blocked for this run; do not look for a way around it. Adam places every order. This is a research and drafting surface (CLAUDE.md, Hard rules).
- The free-feed numbers in the prompt are unverified. Every price you write comes from your own Robinhood pull in this run.
- All commands run from `C:\Users\steam\Projects\apps\the-bench`. Read `CLAUDE.md` there first. The framework is `prompts/trading-copilot-v35.md`; apply it, do not summarize it.
- Never write a full account number anywhere (the read goes to a public ntfy topic). Say ••6137 or ••7724.
- Be quick. Adam is waiting on his phone. No site build, no Benny post, no extra research beyond what the verdict needs.

## Steps
1. `node scripts/dead-theses.mjs --ticker <SYM>`, then read the source row and every later row on this ticker in `db/archive.json`. If a row dated today already decided this level (the 9:02 entry check, a routine, an interactive run), **that decision stands** (v33: THE ENTRY CHECK IS FINAL). Send its answer as NO or BUY with "already decided in B-###" and stop after step 6.
2. `node scripts/regime.mjs` (read the day's stamp) and `node scripts/rs.mjs --ticker <SYM>`.
3. Pull live through the Robinhood MCP: `get_equity_quotes` for <SYM>, SPY, QQQ; `get_equity_historicals` 5-minute bars for today's session and daily bars for the last 90 days; `get_portfolio` for the margin account (number from `get_accounts`, the one ending 6137; the 10% band is its total_value x 0.10, recomputed now, never re-asked); `get_earnings_calendar` or `get_earnings_results` for the next print.
4. Judge it on v35, as the source row's plan described it, delta-style. The checks that decide most trips:
   - **Timing.** Before 09:00 CT the first 30-minute bar has not closed: the answer is WAIT with the exact hold test ("BUY only if the 09:00 CT bar closes inside X-Y"). After 14:00 CT on a Friday: NO, Monday re-look (no Friday-close entries). A macro print inside the next hour is named.
   - **The plan's own band.** Price outside the plan's zone or over its ceiling is NO, do not chase. The ceiling is never raised.
   - **2:1 to a verified pivot** with the stop at least 1.0 ATR(14) under entry, under real structure (tightest legal stop). Report the moving-average R:R too when it differs (P-059).
   - **Capital Competition, both rs windows.** Trails SPY on both, or QQQ on both = No Trade. A split is reported, not a cap.
   - **Earnings inside the hold** = NO. Bull mode, the dated-catalyst lane and the short gates apply as v35 writes them. A short goes on the margin account ••6137; options are level 2 only (no spreads).
5. **Log it.** BUY: `node scripts/log-call.mjs --type long --invalid <stop> ...` with `--call` starting "TRIP JUDGE" and carrying the ticket, grades, `--readiness`, `--origin routine`; then add it to the paper book at the exact ticket size, lane `trip-judge` (`node scripts/paper-book.mjs add ... --lane trip-judge --exit-by <date>`). NO or WAIT: `--type pass` (or `conditional` with `--trigger` and `--decide-by` when there is a live re-look level). Every level you name gets a watcher: `node scripts/mind-changer.mjs add --row B-### ...`. Note the row id.
6. **Text Adam.** Write `docs/reads/<YYYY-MM-DD>-trip-<SYM>.md`. Its FIRST line is the whole answer, plain English, one of:
   - `BUY <n> <SYM> LIMIT <price> DAY, then SELL <n> STOP <stop> GTC the same minute. Target <t1>. Max loss about $<x> (<y>% of the account). Good only while <SYM> trades <lo>-<hi>. [B-###]`
   - `WAIT <SYM>: <the exact test and the time it resolves>. [B-###]`
   - `NO <SYM>: <the one reason that decided it>. Re-look: <the level or date>. [B-###]`
   Then at most five short lines: the level that tripped, the live price and time, the regime, the R:R, the rs split. Send it: `node scripts/ntfy-read.mjs --slot trip --file docs/reads/<file> --title "<BUY|WAIT|NO> <SYM> - trip judge"`.
7. Commit what you wrote, the same day (the book rule): `git add db/archive.json db/mind-changers.json db/paper-book.json docs/reads/<file>` then `git commit -m "trip judge <SYM>: <BUY|WAIT|NO> B-###"` with the Co-Authored-By line from the session. If the commit fails (another desk is committing), leave it: the close routine commits the book. Never push. Append one line to `C:\Users\steam\Projects\docs\handoffs\worklog\<YYYY-MM-DD>.md`: `- **[Claude]** trip-judge <SYM>: TOUCHED <level> | PRODUCED B-### <verdict> | LEFT <re-look>`.

If a step fails (no Robinhood, a script error), still send the text: `NO <SYM>: could not verify on live data (<reason>). Nothing decided; ask Claude to run <SYM>.` Never send a BUY you could not verify.
