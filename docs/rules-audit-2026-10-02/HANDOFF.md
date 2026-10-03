# HANDOFF - full audit of how The Bench applies its rules

**From:** [Claude], 2026-10-02 ~23:45 CT, after the v35 change. **For:** a fresh chat (Claude or Codex).
**Asked for by Adam:** "a handoff for a full audit on how our rules are applied."
**Status:** scouting done, the audit itself has NOT started. Nothing in this folder changes a rule, a row or a routine.

**Model and chat:** start a **fresh chat** on **Opus 5.5** (this is review and hard planning). Ultracode workflows are fine for the sweeps. Set Sonnet on the mechanical counting agents, and Opus on the agents that verify findings and judge rules.

---

## 1. Why this audit exists

On 2026-10-02 the desk graded NVDA **C+** (B-713). The grade came from the Capital Competition Test, measured on the 20-session window alone, where NVDA was +2.4% against SOXX's +17.3%. The same `rs.mjs` print showed the 60-session window going the other way, with NVDA 14 points ahead. Adam challenged it ("how tf is nvda not graded an A+++?"). He was right on the facts: the rule named no window, so the desk could pass or fail the same name by choosing which window to read. B-714 regraded NVDA to B+, and v35 fixed that one rule.

That is one rule, applied once, in one chat. The question for this audit is whether the other rules are applied the same way on the same facts, by every desk (interactive chats, the 15 enabled bench routines, the scripts), or whether each run reads whichever rule is handy.

**The headline from scouting:** of the 85 rules in v35, **68 are enforced only by prose**. Nothing refuses or computes them. They hold when the chat remembers them, and the book shows they often do not.

## 2. How to start

1. Run the session-start ritual: `node scripts/inbox-check.mjs`, the vault's `Open Loops.md`, The Bench hub, and the last two Daily notes.
2. **Work in the main checkout `C:\Users\steam\Projects\apps\the-bench` on branch `v29-hunter-handoff`.** Do NOT work in `.claude/worktrees/practical-turing-8938e9`. That worktree sits at `214c6d0` (the v30 era), and its CLAUDE.md still says v29 is current. A chat that starts there reads the old rules, which is itself an application failure (finding F-1 below).
3. Read, in this order:
   - this file
   - `rule-inventory.md` (85 rules, each with a test and where its evidence lives)
   - `scout-results.json` (every scout's raw output and the skeptic's verdict on each lead)
   - then `prompts/trading-copilot-v35.md` itself
4. Claim the work in the worklog before starting: `Projects\docs\handoffs\worklog\YYYY-MM-DD.md`, CLAIMED: rules audit.

## 3. Ground rules for the audit

- **Read-only until Adam says otherwise.** The audit produces a report, a v36 proposal and a fix list. It does not edit the framework, the routines, the scripts or the book on its own.
- Never overwrite a prompt version: v36 is a new file. The book is append-only: a wrong past row is corrected by a new row that cites it, never by editing it.
- Adam places every order. No trades, no `netlify deploy`, and no pushes without his word.
- Code beats notes. When a note and the code disagree, the code is the fact, and the note gets fixed.
- **Bring decisions to Adam one at a time**, each with a recommendation (section 7). No option menus.

## 4. What scouting already found

Six read-only scouts each covered one surface: the rule inventory, the routines, the scripts, the book for 9/24-9/29, the book for 9/30-10/02, and the notes. One skeptic then tried to refute every lead.
- **31 leads: 29 confirmed, 2 refuted, 0 unclear.**
- Every confirmed lead below carries its evidence in `scout-results.json` (ids L1-L31).
- A second fact-checker then checked about 95 claims in this file against the files and corrected 14 of them before commit. **Where this file and `scout-results.json` disagree, this file is the corrected one.** For example, the scouts said "tripwire misses UBER" (it catches UBER through B-712, and misses NVDA) and counted "0" low-readiness tickets for 9/24-9/29 (at least 7).
- Severity: **high** = could change a trade or money; **medium** = record or grading integrity; **low** = stale prose.

### A. Today's own misses (Claude, B-711 to B-714). Start here, because they prove the problem is live.

| # | What happened | Rule it broke | Severity |
|---|---|---|---|
| T-1 | B-713 capped NVDA's Overall grade on the 20-session window only. | Capital Competition Test (now fixed in v35) | high |
| T-2 | B-713 graded **C+**, but the watchlist leg caps at **C** (v35 l.871). It also did not apply the market leg: NVDA trailed QQQ by 2.0 over 20 sessions, which the text at the time made a No Trade. | Relative Opportunity caps | high |
| T-3 | B-711 (UBER, readiness 37) and B-713/B-714 (NVDA, readiness 40) are pass rows with a written trigger, entry band, stop and target. B-712 is a `conditional` with trigger 71.90 at readiness 37. Both names were set to `ARMED-CONDITIONAL` on the watchlist. | v35 l.421 (born at v29 l.382): "Readiness < 50 can only produce WATCHLIST ONLY. Never a triggered plan, never a conditional with a live trigger." This collides with v34's "passed triggers are watched" (conflict C-1). | high |
| T-4 | B-711 says "CAPITAL CAP BINDS: buying power 207.30 = 2 shares", and B-713 says "CAPITAL CAP: buying power 207.30 buys ZERO shares". | Adam's 2026-09-03 ruling (memory `no-affordability-cap`): never cap at buying power, and never say "capital cap binds." **But v35 l.705 still instructs it** ("say so when it happens"). Its worked example is AVGO B-214, the first of the run of capped plans (B-214 to B-254) that the ruling stopped (F-3). | medium |

### B. Rules that contradict each other or leave a choice open (decide these, then write v36)

- **C-1. Readiness under 50 versus passed triggers watched.**
  - l.421 says a readiness-under-50 name gets no live trigger.
  - v34 says any pass that carries a trigger registers a mind-changer.
  - The book does both: B-691 (HIMS, readiness 30) is stored as `conditional` with trigger 31.81 while its own text says "WATCHLIST ONLY - NO TRADE" (L6).
  - B-635/B-636 (readiness 40) and B-673 (45) carry full executable tickets with no watchlist language at all (L18).
  - B-674 (GOOGL, readiness 40) sits on a live, filled 8-share position with resting stops (L20).
- **C-2. Options level.**
  - v35 l.156 and CLAUDE.md l.70 say margin ••6137 is **level 3 (spreads)**.
  - Memory `options-level-2-not-3` says both accounts are **level 2**, and `get_accounts` confirmed it again on 10/02.
  - v35 also contradicts itself: l.669 says "The options lane at level 2 is the cash-secured put."
  - A run that trusts l.156 plans spreads that cannot be placed (L28).
- **C-3. The capital cap.** v35 l.699-705 says to report it, and Adam's 9/3 ruling says never (L29).
- **C-4. The risk budget.** Four rules can size the same trade:
  - Accumulation (l.133) and Short-Side (l.262) cite the old 1.25-1.5% per-trade table.
  - Conviction Tier (l.302) sizes at "up to 2-3% of account."
  - The old table itself was never removed. It still sits inside §POSITION SIZING (l.696-697, l.709-711), beside the v27 10% band (l.699).
  - So two runs can size the same trade at about 1.5%, 2-3% or 10%, depending on which line they read.
- **C-5. Readiness caps don't say how they combine.** The macro cap is 60, the earnings cap 40, the no-floor cap 30. When two apply, does the lowest win?
- **C-6. Which earnings date counts.** Two desks treat the same print differently:
  - The interactive rubric caps readiness at 40 when the stock's print falls inside the 2-8 week window.
  - `options-hunter.mjs` has no earnings term in its readiness at all; it is the mean of four scores, capped only by macro (l.106-107).
  - The routine `bench-hunt-close` (SKILL.md:36, STEP 7b) checks earnings only against the option's expiry.
  - Examples:
  - UBER: B-638 (9/30, routine) "outside expiry - clear", readiness 60; B-711 (10/02, Adam) capped by the same 11/03 date, readiness 37 (L21).
  - HIMS: B-637 versus B-691, the same split (L22).
  - Same ticker, same date, opposite treatment.
- **C-7. Unclear thresholds.**
  - Pre-FOMO's "minimum 2:1" (l.680) versus the Dated-Catalyst lane's 1.5:1 (l.790): which wins for a dated-catalyst setup?
  - Accumulation gate 1 still says "graded B or better in a prior **v17/v18** run" (l.121).
- **C-8. Unscriptable legs.** The Capital Competition watchlist leg lets each run pick the alternative (sector ETF, a watchlist name, SMH). The cash and swap legs are pure judgment with no logged field. Two runs can cap the same name differently without either breaking the text.

### C. Rules the code does not enforce, although the book shows they break

- **S-1 (high).** `tripwire.mjs:88-92` keeps only the latest `conditional` or `long` row per ticker, and drops it after 14 days. **The 11 pass rows that carry a trigger are skipped.**
  - UBER 71.90 is still caught, through B-712 (a conditional at the same level).
  - **NVDA 237.88 is not watched by tripwire at all.** Its latest conditional is B-352 (9/11), which is dropped as stale. Only mind-changer MC-047 watches it.
  - Every pass-with-trigger row since 9/29 has a mind-changer. The three without one are August rows (B-028, B-031, B-155). (L7)
- **S-2 (medium). Conditional rows with a trigger and no mind-changer citing their own row.**
  - v35 l.799 applies the watch rule to rows that **pass**. The routines' V34 block widens it to "PASSES (or is conditional)", so the routines are stricter than the framework.
  - On 9/29, B-615, B-616 and B-621 have no mind-changer of their own. Their levels are watched under sibling rows: IREN 42 by MC-009 (B-619), ETN 428 by MC-010 (B-620). So these are row-attribution gaps (L15).
  - From 9/30 to 10/02, four levels have no watch at all: B-627 (NKE 36.39), B-675 and B-686 (ASPN 5.54, two days running), and B-678 (PWR 653.87) (L24).
  - `log-call.mjs` could register the watch automatically and does not.
- **S-3 (high).** `server/bookLog.js:102-108` checks readiness only for being an integer from 0 to 100. Nothing cross-checks it against `call_type` or a live trigger. B-712 went in at readiness 37 as a conditional with no warning (L8).
- **S-4 (high).** No script checks the ATR Floor against a logged book row. Where ATR does appear (L9):
  - `hunt-short.mjs:57-65` computes a true ATR(14) from bars, but only for its own screen candidates' stops; `options-hunter.mjs:84,94` uses it the same way.
  - `paper-gapup.mjs:41-42` uses a hand-typed `--atr`. One real miss: B-675's stop was 0.91 ATR from its planned fill. It was caught a session later (B-686), and the fix itself then cost the fill (B-690/B-692, L27).
- **S-5 (medium).** Nothing flags a Friday-close entry (L10). The book honored the rule every time in the sample (B-577, B-578, B-580, B-711), so this is a guard for the day memory slips, not a fix for a known break.
- **S-6 (medium).** `buy-zone.mjs:193` hides only REJECTED. NO ZONE, NO TARGET and NO FLOOR rows print beside the armed ones as noise (L11).
- **S-7 (medium).** `insider-check.mjs`'s VERDICT line counts trades in other issuers. UBER on 10/02 read "net selling $640M", which was Uber selling shares of a different company. The memory note `insider-check-counts-other-issuers` exists, and the script is unfixed.
- **S-8 (low).** `mind-changer.mjs` and `predict.mjs` carry their own ROOT helper, and `mind-changer.mjs` its own `nyDate`, instead of the shared `server/config.js` and `server/nyDate.js`, so a fix to the shared date logic will miss them (L12).

### D. Routines out of step with v35

- **R-0 (low). The routine count.** 15 bench routines are enabled. The V34 block is in 13 SKILL.md files, and two of those are disabled (`bench-ai-infra-next-pump-prep`, one-time; `bench-queue-daily-check`, retired). The four enabled routines without the block (`quote-tweet-nightly`, `prepump-snapshot`, `prepump-outcomes`, `calendar-order-nag`) do not load the framework. "13 active routines repointed" in CLAUDE.md and in v35's changelog means 13 files, 11 of them running.
- **R-1 (medium).** The **V34 STANDING ORDER block** in all 13 files still ends "Nothing else changes". The v35 repoint changed only the file path. **No routine runs `rs.mjs`**, so v35's one change is not applied by any routine that grades (L2).
- **R-2 (medium).** The `bench-entry-check-open` log command has no `--readiness` (SKILL.md:21). Every entry-check row lands `readiness: null`, e.g. B-689 and B-690 (L1). Live tickets with null readiness: B-612, B-613, B-615, B-616 (L17) and B-643, a sized 36-share IREN ticket (L19).
- **R-3 (low).**
  - `bench-week-recap/SKILL.md:121` still says the retired `challenge-v1.md` "WINS" over everything (L3).
  - Line 87 still describes `bench-weekly-catalyst` running Sundays (L4).
- **R-4 (medium).** The REPORT CARD (memory `end-runs-with-report-card`) is written into one routine only (`bench-hunt-close`) and not into v35 (L30). The STRUCTURE MENU (memory `structure-plays-wanted`) is in neither (L31). Both apply only when a chat remembers them.

### E. Book consistency (sample: 158 of 714 rows, B-557 to B-714, 9/24 to 10/02)

| Check | 9/24-9/29 (71 rows) | 9/30-10/02 (87 rows) |
|---|---|---|
| Readiness under 50 with a live entry plan | **at least 7** conditionals with entry, stop and target written at readiness 35-45 (B-557, B-583, B-586, B-605, B-606, B-620, B-621), plus **null readiness on the live entry-check tickets** (B-612, B-613, B-615, B-616) | **4** scored (B-635, B-636, B-673, B-674), plus B-643 (a sized 36-share ticket, readiness null). B-691 is the C-1 storage mismatch. |
| Conditional with a trigger and no mind-changer of its own | 3 (levels watched under sibling rows) | **4 with no watch at all** |
| Stop under 1.0 ATR | 0 | 1 (B-675, self-caught) |
| Plan below 2:1 outside the paper lane | 0 (every sub-2:1 case was declined) | 0 |
| Friday-close entry | 0 (rule honored 3 times) | 0 |
| Re-plan after a 9:02 NO TRADE | 0 | 0 |
| Grades on a status ping / partial grades | 2 (B-576, B-617) | 2 (B-675, B-677) |
| `origin: unspecified` | 6 (8.5%) | **22 (25%)** |
| Unverified fact stated as fact | 4 (e.g. B-609 dropped the "unverified" label B-580 had on the same earnings date) | not checked |
| Single-window capital competition | n/a (before v35) | 1 (B-713) |
| Forward claim with no watch | not checked | 0 |

**What held:** 2:1, the Friday rule and the final 9:02 entry check were applied every time in the sample. Those are the rules the desk has been burned on and wrote down loudly.

**What did not hold:** readiness, origin and the trigger watches. Those are the newer fields, which no guard enforces.

### F. Notes that say something the framework or code does not

- **F-1.** The worktree `practical-turing-8938e9` is at v30 era with a v29 CLAUDE.md (section 2).
- **F-2.** CLAUDE.md l.56 still presents `prompts/trading-copilot-v28.md` as "the Framework" for both the interactive path and the daily machine. The v35 note at l.151 is right, so the file contradicts itself.
- **F-3.** v35 l.699-705 (capital cap) and l.156 (level 3) contradict standing memory rules (C-2, C-3).
- **F-4.** `db/tape.json` was last stamped `2026-09-28 06:01 CT pre-market`. The 2026-08-12 standing rule says every framework run refreshes it. None has for five sessions, from the rest of 9/28 through 10/02.
- **F-5.** `main` is still at v28 until PR #41 merges. Anyone who checks out `main` gets no v29-v35 file at all.

### Refuted by the skeptic (do not chase)
- **L5:** "closing-bell never mentions mind-changer" is wrong. The block is there. Only the `check` verb lives in plan-check-close, which is by design.
- **L13:** "the desk stopped labeling earnings dates unverified after 9/28" is wrong. B-637 and B-691 still carry the label. B-609 is a real single slip and stays in table E.

## 5. What scouting did NOT cover (the audit's job)

- **556 of 714 book rows** (everything before 9/24). At minimum, sweep from **B-240**, the first 9/02 (v29) row. The readiness and origin fields first appear at B-248, and the first scored readiness is B-249.
- **The routines' actual output.** Scouting read the SKILL.md text, not what the routines produced. Read the last 10 weekdays of `docs/reads/` and the rows each routine logged.
- **Rule-by-rule application rates.** Scouting tested about 15 of the 85 rules against the book. The other 70 have a test in `rule-inventory.md` and no count.
- **Line numbers in the inventory are approximate.** Confirm each one.
- Not looked at:
  - `db/patterns.json` (are instances logged with `--holds false` as often as true?)
  - prediction scoring (`predict.mjs` counts weekdays, not trading sessions, so a holiday shifts the horizon; confirm against the 11/26 Thanksgiving closure in `db/prepump/nyse-calendar-2026-2028.json`; no current prediction spans it yet)
  - `paper-gapup.json` and the 10-trade review clock
  - the dated-catalyst lane's 5-instance paper count
  - the hunter handoff contract (`docs/hunter-handoff-v1.md`): are hunter scores read AFTER the desk grades?
  - the executor gate
  - `score-book.js` checkpoint grading
- **Memory rules missing from the framework, or only partly in it,** need a full list.
  - Not in v35 at all: the report card, the structure menu, log and watch every prediction, no affordability cap (v35 says the opposite), and insider-check counting other issuers.
  - Written only inside one lane: no Friday-close entries (Option B condition 3, l.817) and the tightest legal stop (bull-mode rule 5, l.668).
  - Already in: the MA-target pivot line (l.654).
  - For each one, decide whether it belongs in v36, in a routine, or in a script.

## 6. Method

1. **Confirm the inventory.** Walk v35 against `rule-inventory.md`: fix line numbers, add missing rules, and mark each rule *testable from row fields*, *needs the row text read*, or *not auditable as kept*.
2. **Sweep the book from B-240.** For every rule:
   - count applied, broken, not-applicable and unauditable
   - split by origin (adam / routine / hunter / delta / unspecified) and by surface (interactive chat versus each routine)
   - The question is "is the same rule applied the same way by every desk", so the split matters more than the total.
3. **Sweep the routines' output** (`docs/reads/`, the rows each routine logs) against the rules each routine is supposed to apply.
4. **Same facts, different answers.** Find same-ticker pairs within 5 sessions where a grade, readiness or verdict moved with no stated reason (UBER B-638→B-711, HIMS B-637→B-691 and NVDA B-713→B-714 are the first three). Each one is either a missing rule or a rule applied two ways.
5. **Adversarial verify** every finding before it goes in the report. One skeptic per finding, told to refute it. Kill it if refuted.
6. **Propose, do not apply:** the v36 text, the script guards with tests, the routine edits, and any correction rows.

## 7. Decisions only Adam can make (bring them one at a time, each with a recommendation)

1. **C-1: readiness under 50 with a passed trigger.** Recommendation:
   - the watch stays (mind-changer plus tripwire), and the row says WATCHLIST ONLY
   - no entry band, stop or ticket is written until the trigger fires and a fresh run scores readiness 50 or higher
   - `ARMED-CONDITIONAL` is renamed or reserved for readiness 50 and up
   - This would retro-flag B-711 to B-714 and the rows in table E, row 1.
2. **C-3: the capital cap.** Recommendation: v36 deletes l.705 per his 9/3 ruling, and the review states the full band size only.
3. **Hard refusal or warning in `log-call.mjs`.** Recommendation:
   - **refuse** a `long` at readiness under 50 or with a null readiness
   - **warn** on a `conditional` at readiness under 50
   - **refuse** `origin` unspecified
   - **auto-register** a mind-changer for any pass or conditional that carries a trigger
4. **C-4: the old 1.25-1.5% table.** Recommendation: replace it with the 10% band everywhere, half-band where a lane already says so.
5. **C-6: the earnings cap.** Recommendation: it keys on the **stock's** print date inside the trade's hold window, for every desk, and options expiry is a separate line.

## 8. Deliverables

1. `docs/rules-audit-2026-10-02/REPORT.md`:
   - a per-rule scorecard (applied / broken / unauditable, by desk)
   - every confirmed finding with row ids
   - the refuted list
2. `docs/proposals/<date>-v36-rules-consistency.md`: the v36 text changes, one per decision above, each with its earning row.
3. A fix list with tests:
   - `tripwire.mjs` reads pass rows with a trigger
   - `log-call.mjs` and `bookLog.js` guards (decision 3)
   - an ATR Floor check computed from bars
   - a Friday-entry warning
   - the `buy-zone.mjs` filter
   - an `insider-check.mjs` issuer filter
   - `--readiness` in the entry-check routine
   - `rs.mjs` in the grading routines
   - the stale routine lines
4. The notes fixes: CLAUDE.md l.56 and l.70, the stale worktree (remove or re-sync it, Adam's call), and `db/tape.json`.
5. The session-end ritual: Daily bullets, the hub `next`, an Open Loops row, and a HANDBACK on the bus pointer file.

## 9. Files

- This folder: `HANDOFF.md`, `rule-inventory.md` (85 rules), `scout-results.json` (raw scout output, leads L1-L31 with verdicts).
- Framework: `prompts/trading-copilot-v35.md`. Routines: `C:\Users\steam\.claude\scheduled-tasks\bench-*\SKILL.md` (15 enabled; 13 files carry the V34 block).
- Book and registries: `db/archive.json`, `db/mind-changers.json`, `db/predictions.json`, `db/watchlist.json`, `db/patterns.json`.
- Standing rules outside the framework: `C:\Users\steam\.claude\projects\C--Users-steam-Projects-apps-the-bench\memory\`.
- Prior audits worth reading first: `docs/framework-audit-2026-08-12.md`, `docs/self-audit-2026-09-24-entries.md`, `docs/pass-audit-2026-09-23.json`.
- Bus pointer: `Projects\docs\handoffs\2026-10-02-bench-rules-application-audit.md`.
