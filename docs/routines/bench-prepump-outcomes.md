---
name: bench-prepump-outcomes
description: Saturdays 12:00 CT. Scores forward outcomes for snapshot rows that are now at least 10 completed sessions old, into db/prepump/outcomes/. Read-only market data. Posts nothing, sends nothing.
---

PRE-PUMP OUTCOMES SCORER for THE BENCH. Fresh session, no memory — everything you need is here.

This puts forward outcomes on snapshot rows collected by bench-prepump-snapshot, so the pre-pump indicator in Projects\apps\hunter can eventually be calibrated against real hit rates. Collection is unrepeatable; scoring is cheap and repeatable, which is exactly why they are separate jobs.

Working directory: C:\Users\steam\Projects\apps\the-bench

=== HARD RULES — absolute ===
1. READ-ONLY MARKET DATA. The only broker tool you may call is
   get_equity_historicals. NEVER call any order, account, portfolio, position,
   watchlist, alert or scan-mutation tool.
2. POST NOTHING. SEND NOTHING. Do not run scripts/ntfy-read.mjs. No summary.
3. Never edit a snapshot file. Outcomes are their own append-only files.
4. Never re-query a symbol that previously came back not_found. The planner excludes resolution-blocked symbols; their existing snapshots remain. They require an identity review, not an automatic retry or a zero outcome. Delisted tickers
   get RECYCLED — FB now resolves to a buffer ETF, not Meta — so a fresh lookup
   on a dead symbol silently collects a different company under the same name.

Load the tool first:
ToolSearch({query: "select:mcp__robinhood-trading__get_equity_historicals", max_results: 1})

5. Retain all raw payloads and outcome revisions. Only db/prepump and the approved local backup directory C:\Users\steam\Projects\backups\bench-prepump may be written. No Git, OneDrive or off-machine data copies.

=== STEP 1 — WHAT IS DUE ===
  node scripts/prepump-outcomes.mjs plan
Exit 1 means nothing is due yet (normal in the first two weeks of collection — a row needs 10 completed sessions before it can be scored). If so, run `node scripts/prepump-backup.mjs create` and `node scripts/prepump-health.mjs`, report any issues, then finish.
Otherwise it writes db\prepump\raw-outcomes\<ANCHOR>\plan.json. Read it. Note ANCHOR, `bars_from`, `bars_to`, and `batches` (groups of <=10 symbols; SPY is already included and is NOT optional — without the benchmark a market-wide up week reads as hundreds of correct predictions).

=== STEP 2 — PULL THE BARS, VIA SUBAGENTS ===
Do not hold this data yourself. Use the Agent tool (subagent_type "general-purpose"), no more than ~8 batches per agent, run in parallel.

Give each subagent verbatim, with its own batch list:
---
Working directory C:\Users\steam\Projects\apps\the-bench. READ-ONLY: you may call ONLY get_equity_historicals. Never call any order, account, position, portfolio or watchlist tool. Load it with ToolSearch first.
For each batch, call get_equity_historicals with exactly those symbols, interval="day", bounds="regular", start_time = <plan.history_request.start_time>, end_time = <plan.history_request.end_time> (copy these exact UTC strings; end_time is midnight AFTER the anchor date, not midnight or end-of-day on bars_to), and adjustment_type="split" — you MUST pass it explicitly, because the provider never echoes which adjustment it applied and an unrecorded basis makes the series unusable.
If the result is inline, save with Write to db\prepump\raw-outcomes\<ANCHOR>\hist-<NN>.json as:
  {"tool":"get_equity_historicals","observed_at":"<UTC ISO now>","adjustment_type":"split","response": <entire tool result verbatim>}
If the harness spilled it to a file, do NOT read or paste it:
  node scripts/prepump-collect.mjs wrap --date <ANCHOR> --tool get_equity_historicals --as hist-<NN> --from "<spill path>" --adjustment split
  then MOVE db\prepump\raw\<ANCHOR>\hist-<NN>.json to db\prepump\raw-outcomes\<ANCHOR>\hist-<NN>.json
Return ONLY a short line: batches succeeded, batches failed, any error text. Return no market data.
---
Number files uniquely so agents never collide.

=== STEP 2B — VERIFY ACTUAL COVERAGE ===
  node scripts/prepump-outcomes.mjs verify-history --asof <ANCHOR>
This must exit 0 before scoring. It checks genuine contiguous symbol AND SPY bars for every currently due horizon, including the final session. A successful tool call is not proof of coverage. If it exits 1, make at most one retry of the affected symbols plus SPY with the exact plan.history_request bounds. Save retries under fresh hist-zz-retry-<unique>.json names; never overwrite any raw payload. If coverage still fails, back up, run health, report the missing dates, and stop without claiming completion. Never fabricate bars or substitute quotes or another adjustment basis.
For every initial batch also use unique hist-<run-id>-<NN>.json names; retain all earlier payloads.

=== STEP 3 — SCORE ===
  node scripts/prepump-outcomes.mjs build --asof <ANCHOR>
It computes, per symbol-date, the max close gain at 1/3/5/7/10/14/30 sessions, the max intraday high over the window, the 10-session close, and the identical figures for SPY over the SAME session dates. Outcome v2 stores a separate result for every fully complete horizon and appends revisions when 14/30-session windows mature. Both the symbol and SPY must have contiguous settled bars. Ten-day extrema use exactly ten sessions. Entry prices are settled and split-adjusted; the original raw provisional price is preserved separately but not subtracted across unlike adjustment bases. These are price-study outcomes, not executable trading returns; dividends and costs are excluded. No provisional fallback or zero-filled bars are allowed.

Results append to db\prepump\outcomes\<ANCHOR>.ndjson with a manifest at db\prepump\runs\outcomes-<ANCHOR>.json.

=== STEP 4 — VERIFY, THEN STOP ===
Read the manifest. Report in at most three lines: scored, skipped, file path. The manifest complete flag, pending count and command exit code are authoritative; scored counts can include partial horizon revisions. A nonzero pending count is a failed completion even if skipped=0. "Skipped" does NOT mean zero outcome — it means not measurable yet, and those rows stay pending on purpose.

Never fabricate a bar or an outcome to close a gap. A missing window that stays missing is honest; a filled-in one silently biases every statistic computed from this dataset.

After scoring (including partial or failed results), run `node scripts/prepump-backup.mjs create` and `node scripts/prepump-health.mjs`. Report backup or health failures. KEEP raw-outcomes/<ANCHOR> and every revision; automatic deletion is not approved.

Do not post, do not ntfy, do not summarize the market.