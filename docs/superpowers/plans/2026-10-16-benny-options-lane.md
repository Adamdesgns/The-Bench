# Benny Options Lane: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans. Executed inline in the session that wrote it on 2026-10-16. The full code is in the commits named at each task, so this plan holds the contracts and the test list, not a second copy of the code.

**Goal:** Benny's paper book can hold defined-risk options at real fill prices, score them every night, and report against SPY.

**Architecture:** `scripts/benny-options.mjs` holds the pure functions and a CLI. Options trades live in `db/benny-book.json` `trades[]` with `kind: "option"`. `scripts/paper-book.mjs` learns three things: skip options in `score`, count their open profit in `summarize`, and print them, the open risk and VS S&P in `report`.

**Tech stack:** Node ESM, zero dependencies, node:test.

## Global constraints

- Paper only: no broker order tool is ever called.
- Fills: buy at the ask, sell at the bid. A spread's value is long bid - short ask, floored at 0 and capped at the width.
- `options_risk_pct` 2, `options_max_open_pct` 6, `options_pause_drawdown_pct` 15 (in `db/benny-config.json`). `risk_pct` stays 1.
- Never write `db/paper-book.json` from the options CLI; refuse that path.
- Tests run as `node --test test/<file>.test.mjs`, never on a directory.
- `git add <named paths>` only. Commit and push the same day.

---

### Task 1: Pure option math and the entry gate

**Files:** create `scripts/benny-options.mjs` and `test/benny-options.test.mjs`.

**Produces:**
- `entryDebit(q)`: `q = { long:{ask}, short?:{bid} }` → long.ask - short.bid, 2 decimals.
- `exitValue(q, width)`: long.bid - short.ask, floored at 0, capped at the width (null width means a single option, so no cap). Returns null when a needed quote field is missing.
- `intrinsic(structure, longK, shortK, close)`: the per-share value at expiry.
- `evAtFill({ debit, width, pDir, pReach })`: dollars per contract, with p as a fraction.
- `openOption(book, cfg, f)` → `{ trade } | { refused }`.
  - `f = { sym, row, lane, structure, expiry, longStrike, shortStrike, debit, target, exitBy, earnings, date, pDir, pReach, requireEv, note }`.
  - The gates, in order: structure, Friday, earnings not checked, earnings on or before expiry, strikes on the wrong side, debit <= 0, spread debit >= width, EV <= 0 (when requireEv or p's are given), ticker already open, drawdown pause, one contract over the cap, open-risk cap full, exit before entry. exit_by is capped at expiry.

**Tests:**
- Fill math on the 10/16 ANET 170/165 quotes: debit 1.74.
- UNH 400/402.5 is refused because the debit is 2.60 against a 2.50 width.
- EV gate: the 10/16 NI spread is refused at any fill.
- Sizing: $10,000 at 2% with a debit of 1.74 gives 1 contract; a debit of 0.76 gives 2.
- A $215 debit is refused over the cap, with the reason.
- With 5.5% already open, a new trade is cut down, or refused when nothing fits.
- Drawdown pause: equity 8,400 against a peak of 10,000 is refused.
- Earnings missing, earnings on expiry, and a Friday date are refused. A second open trade on the same ticker is refused.

### Task 2: Nightly step

**Produces:** `stepOption(t, q, date)`.
- `q = { close, long:{bid,ask}, short?:{bid,ask} }`.
- It only marks on the entry day. On or after expiry the value is intrinsic. Then TARGET (the close is at or through the target), then EXIT-BY. Otherwise it marks last_value.
- Closing sets realized = (value - entry_debit) x 100 x contracts, r = realized / cost, exit_reason, exit_date and exit_value.
- A missing quote before expiry returns the trade unchanged.

**Tests:**
- A put spread hits its target and sells at the bid.
- EXIT-BY sells at the bid.
- Expiry with the stock past the long strike pays out capped at the width; expiry out of the money pays 0.
- The entry day only marks; a missing quote leaves the trade untouched.

### Task 3: The paper-book integration

**Files:** modify `scripts/paper-book.mjs` and add tests to `test/benny-options.test.mjs`.

**Produces:**
- `summarize` counts an option's open profit.
- `score` skips options trades.
- `vsSpy(book)` → `{ from, to, book_pct, spy_pct, gap_pts, pace_pct } | null`.
- `report` prints OPTION lines, OPTIONS OPEN RISK, REVIEW DUE at 10/20/30 closed, and VS S&P.

**Tests:**
- `summarize` with one open option: unrealized = (last_value - entry_debit) x 100 x contracts.
- The `paper-book score` CLI on a temp book leaves the options trade untouched.
- `vsSpy`: start 763.30, a row with spy 770 and equity 10,150 gives book +1.5%, SPY +0.88%, and the 15%-a-year pace for that number of days.
- `report` prints REVIEW DUE at 10 closed.
- The existing `test/paper-book.test.mjs` and `test/benny-book.test.mjs` still pass.

### Task 4: CLI commands

**Produces:**
- `spy-start`, `add`, `hunt-add`, `need [--json]` and `score --quotes --spy --write`, each with `--db` and `--config`.
- The paper-book.json path is refused.
- Skips are recorded in `book.skipped` with `{ kind:"option", sym, date, lane, why }`.

**Tests:**
- `hunt-add` on a temp ranked file: a positive-EV READY spread is added, a negative one is skipped with the reason, and a STALK row is ignored.
- A narrower short strike is accepted when it sits between the long strike and the hunter's short; a different expiry is refused.
- `score --write` writes a history row with the spy value.
- `--db .../paper-book.json` is refused.

### Task 5: Config, baseline, commit

- `db/benny-config.json`: add the three option settings (Adam's words, 2026-10-16, relayed by the Benny design session).
- `node scripts/benny-options.mjs spy-start --close 763.30 --date 2026-10-16`.
- Run all three test files, commit the named paths, push.

### Task 6: Routines (Adam's gate)

- Show the exact new B2 text for bench-hunt-close and bench-plan-check-close and the B3 line for bench-week-recap.
- After his yes: back up each `SKILL.md.bak-2026-10-16-options`, then edit.

### Task 7: Vault

- A Daily note bullet, a The Bench Dev Log line and an Open Loops row (the lane review at 10 closed, and the routine edits if they are still pending).
