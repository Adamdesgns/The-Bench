# The Bench data trove - Codex implementation handback

**[Codex]** 2026-09-12. Repository: C:/Users/steam/Projects/apps/the-bench. Branch: v29-hunter-handoff. Code HEAD: 56c0e87. Local implementation complete for Tasks 1-4 and 7-11. Task 12 verified, report only. Task 5 remains UNAPPROVED and unapplied. Task 6 awaits Monday 2026-09-14 after 16:30 CT. No predictive model has been built.

## Request and decisions

Adam supplied Claude's 2026-09-12 handoff to implement a desk collection lane, preserve the frozen sample, and read the scored book back into statistics. Implemented in the canonical checkout because the existing snapshot routine executes scripts there. Unrelated dirty files were preserved and excluded from every commit. No push, merge, deployment, broker/MCP request, order, post, ntfy message, process launch/termination or routine change occurred. No row data was copied or committed.

The desk lane remains separate from the 460-name core. Manual screen names are dated 2026-09-12 explicitly so the provenance matches the source chat and Monday's window includes them. Friday's desk JSON is a derived file created for the comparison, not a rewritten historical snapshot.

## Local commits and tests

- 458a3ed: Task 1, existing capture code, ignore rules and definitions committed unchanged. Baseline before code changes: 282/282.
- 5616c5c: Tasks 2-4, desk lane, aliases, stoplist and non-writing plan preview. Focused tests 18/18; full suite 300/300.
- 56c0e87: Tasks 7-11 plus review fixes. Verbatim plan implementation passed 318/318; final suite passed 322/322.

Three implementation commits are local only. Claude's three earlier documentation commits are also absent from the local origin/v29-hunter-handoff reference; no fetch or push was performed. A following documentation-only commit records this report.

## Verification

- Friday before a desk file: 593 total, core 460, scan 145, desk 0.
- Friday derived desk feed: 30 symbols, all 13 required target names, none of B/S/T/ET/HP/FAST/AI/CPI.
- Friday collector preview with desk file: 612 total, core 460, scan 145, desk 30; 18 first appearances and two historicals batches. This is a preview, not newly collected rows.
- Registered all 17 chat-screen names. Monday desk preview grew from 5 to 20, with 17 manual names. Monday's feed was NOT built or collected.
- Scorecard JSON returns 367 book rows; default tables contain 367 checkpoint entries after excluding two shadow entries. Unfiltered reconciliation: 369 entries, 159 right / 155 wrong / 33 flat / 22 unscorable. Latest real verdict per call: 269 calls, 126 right / 115 wrong / 28 flat.
- Invalid/missing/fractional/nonpositive --min-n exits 2. Desk weekend, malformed date, missing command, invalid ticker and absent stoplist refuse. A future collector dry run leaves no directory behind.
- Pattern --row B-360 dry run exits 0; --row 360 exits 1. AGE appears in --list.
- score-book.js passes node --check. Its sole draft-file write is guarded by draftDecision and requires explicit --draft. The scorer itself was not run.
- SHA256 unchanged: archive.json, patterns.json, universe-core.json, history-state.json, Friday raw plan.json, and all four 2026-09-08..11 NDJSON snapshots.
- Both stale scorecard commits match their equivalents: c1f746e/a5124a7 patch-id 71c1c8d401079389c9f5b93946a199fdf3780f64; 0e94cc5/44d6b2f patch-id 814dc779e29281fd9a167a3120afbefaebb6d0d8. No branch deleted.
- Read-only vault-check --quiet completed with exit 0.

## Review fixes beyond the pasted code

1. Moved directory creation below the plan dry-run return.
2. Malformed desk JSON produces an explicit warning and desk_error in a written plan, while core/scan collection remains available.
3. Missing --min-n now refuses instead of silently using 8.
4. Mean alpha excludes unscorable entries, hides mixed/unknown call types, and requires enough finite alpha values. This prevents nonsense averages for the old prose-classified bucket.
5. Impossible calendar dates return null in pattern age calculation.
6. Added the ticker grouping requested by the spec but omitted from its implementation block.
7. CLAUDE.md states that automatic desk integration is pending Task 5, rather than claiming it is already scheduled. Original plan apply markers remain untouched.

## Exact remaining steps

1. Adam explicitly approves Task 5. Review [TASK-5-review.md](<C:\Users\steam\OneDrive\Documents\ChatGPT\Trading Prediction\TASK-5-review.md>); full proposed file: [TASK-5-snapshot-routine.proposed.md](<C:\Users\steam\OneDrive\Documents\ChatGPT\Trading Prediction\TASK-5-snapshot-routine.proposed.md>). Recheck the saved source SHA256 against C:/Users/steam/.claude/scheduled-tasks/bench-prepump-snapshot/SKILL.md before applying only the two additions. Record the approval time. No approval received during this implementation.
2. After Monday 2026-09-14 16:30 CT, read db/prepump/runs/2026-09-14.json. Record written.core, written.desk, complete and expected/written total. Check actual NDJSON source tags: core 460, desk >0. No Monday manifest exists yet, so all Monday results are UNVERIFIED. No new reminder or automation was created in Codex.
3. If incomplete, report actual failures; retries require the existing routine's permitted workflow, never fabricated rows. This implementation did not call a broker.
4. Adam still decides any local second copy of row data, push/merge destination, and origin/scorecard deletion.
5. scripts/log-read.mjs, scripts/resolve-reads.mjs and docs/reads-ledger-spec.md remain pre-existing untracked work belonging to the reads ledger.

No dataset base-rate calculator or predictive model was added. Core/scan/desk tags and preservation tests are implemented; the spec's required-population argument remains a requirement for a future dataset aggregation API. Company aliases are heuristic and can miss or misclassify new prose; reasons and rejections are retained. Historical options checkpoints were not rewritten.

## Commands run

- node scripts/inbox-check.mjs
- node C:/Users/steam/Projects/tools/vault-check/check.mjs --quiet
- git status/branch/log/diff/check-ignore and path-limited add --dry-run, add, commit
- node --test test/*.test.mjs server/*.test.js (reporters dot/spec; totals above)
- node scripts/prepump-collect.mjs plan --date 2026-09-11 --dry-run
- node scripts/desk-feed.mjs build --date 2026-09-11 [--dry-run]
- node scripts/desk-feed.mjs add --date 2026-09-12 --symbols MRVL,KEEL,COHR,AIP,VNET,HPE,AMAT,PENG,IREN,SNDG,ORCL,META,AMBA,SPCX,AVAV,SST,UBER --note "17-name volume screen from a Claude chat, 2026-09-12"
- node scripts/desk-feed.mjs build --date 2026-09-14 --dry-run
- node --check scripts/score-book.js; node scripts/scorecard.mjs [--json | --min-n ...]
- node scripts/log-pattern.mjs --list; --instance P-032 --ticker DELL --date 2026-09-18 --holds true --detail "dry run" --row B-360 [or 360] --dry-run
- git show COMMIT | git patch-id --stable (four commits listed above)
- Local apply-desk-plan.cjs phases snapshot, desk, score, quality, docs, docs-finish, verify-hashes; verify-and-prepare.cjs. Two ambiguous text anchors stopped safely and were corrected before continuing.

## Created or changed repo files

- [.gitignore](<C:/Users/steam/Projects/apps/the-bench/.gitignore>)
- [CLAUDE.md](<C:/Users/steam/Projects/apps/the-bench/CLAUDE.md>)
- [aliases.json](<C:/Users/steam/Projects/apps/the-bench/db/prepump/desk/aliases.json>)
- [stoplist.json](<C:/Users/steam/Projects/apps/the-bench/db/prepump/desk/stoplist.json>)
- [nyse-calendar-2026-2028.json](<C:/Users/steam/Projects/apps/the-bench/db/prepump/nyse-calendar-2026-2028.json>)
- [2026-09-08.json](<C:/Users/steam/Projects/apps/the-bench/db/prepump/runs/2026-09-08.json>)
- [2026-09-09.json](<C:/Users/steam/Projects/apps/the-bench/db/prepump/runs/2026-09-09.json>)
- [2026-09-10.json](<C:/Users/steam/Projects/apps/the-bench/db/prepump/runs/2026-09-10.json>)
- [2026-09-11.json](<C:/Users/steam/Projects/apps/the-bench/db/prepump/runs/2026-09-11.json>)
- [universe-core.json](<C:/Users/steam/Projects/apps/the-bench/db/prepump/universe-core.json>)
- [prepump-dataset-findings.md](<C:/Users/steam/Projects/apps/the-bench/docs/prepump-dataset-findings.md>)
- [scorecard-spec.md](<C:/Users/steam/Projects/apps/the-bench/docs/scorecard-spec.md>)
- [desk-feed.mjs](<C:/Users/steam/Projects/apps/the-bench/scripts/desk-feed.mjs>)
- [log-pattern.mjs](<C:/Users/steam/Projects/apps/the-bench/scripts/log-pattern.mjs>)
- [prepump-collect.mjs](<C:/Users/steam/Projects/apps/the-bench/scripts/prepump-collect.mjs>)
- [prepump-outcomes.mjs](<C:/Users/steam/Projects/apps/the-bench/scripts/prepump-outcomes.mjs>)
- [prepump-session.mjs](<C:/Users/steam/Projects/apps/the-bench/scripts/prepump-session.mjs>)
- [score-book.js](<C:/Users/steam/Projects/apps/the-bench/scripts/score-book.js>)
- [scorecard.mjs](<C:/Users/steam/Projects/apps/the-bench/scripts/scorecard.mjs>)
- [patternLog.js](<C:/Users/steam/Projects/apps/the-bench/server/patternLog.js>)
- [patternLog.test.js](<C:/Users/steam/Projects/apps/the-bench/server/patternLog.test.js>)
- [scorecardPost.js](<C:/Users/steam/Projects/apps/the-bench/server/scorecardPost.js>)
- [scorecardPost.test.js](<C:/Users/steam/Projects/apps/the-bench/server/scorecardPost.test.js>)
- [scorecardStats.js](<C:/Users/steam/Projects/apps/the-bench/server/scorecardStats.js>)
- [scorecardStats.test.js](<C:/Users/steam/Projects/apps/the-bench/server/scorecardStats.test.js>)
- [scoring.js](<C:/Users/steam/Projects/apps/the-bench/server/scoring.js>)
- [scoring.test.js](<C:/Users/steam/Projects/apps/the-bench/server/scoring.test.js>)
- [desk-feed.test.mjs](<C:/Users/steam/Projects/apps/the-bench/test/desk-feed.test.mjs>)
- [prepump-collect.test.mjs](<C:/Users/steam/Projects/apps/the-bench/test/prepump-collect.test.mjs>)
- [prepump-session.test.mjs](<C:/Users/steam/Projects/apps/the-bench/test/prepump-session.test.mjs>)

## Other files and records

- [2026-09-11.json](<C:/Users/steam/Projects/apps/the-bench/db/prepump/desk/2026-09-11.json>) - derived Friday feed, deliberately untracked.
- [2026-09-12.json](<C:/Users/steam/Projects/apps/the-bench/db/prepump/desk/manual/2026-09-12.json>) - all 17 manual registrations, deliberately untracked data.
- [apply-desk-plan.cjs](<C:\Users\steam\OneDrive\Documents\ChatGPT\Trading Prediction\apply-desk-plan.cjs>)
- [verify-and-prepare.cjs](<C:\Users\steam\OneDrive\Documents\ChatGPT\Trading Prediction\verify-and-prepare.cjs>)
- [finish-handback.cjs](<C:\Users\steam\OneDrive\Documents\ChatGPT\Trading Prediction\finish-handback.cjs>)
- [protected-hashes.json](<C:\Users\steam\OneDrive\Documents\ChatGPT\Trading Prediction\protected-hashes.json>)
- [offline-verification.txt](<C:\Users\steam\OneDrive\Documents\ChatGPT\Trading Prediction\offline-verification.txt>)
- [TASK-5-review.md](<C:\Users\steam\OneDrive\Documents\ChatGPT\Trading Prediction\TASK-5-review.md>)
- [TASK-5-snapshot-routine.proposed.md](<C:\Users\steam\OneDrive\Documents\ChatGPT\Trading Prediction\TASK-5-snapshot-routine.proposed.md>)
- [2026-09-12-bench-data-trove-codex-handoff.md](<C:/Users/steam/Projects/docs/handoffs/2026-09-12-bench-data-trove-codex-handoff.md>) - this external handoff.
- [2026-09-12-desk-lane-verification.md](<C:/Users/steam/Projects/apps/the-bench/docs/handoffs/2026-09-12-desk-lane-verification.md>) - same verification in the repo.
- [2026-09-12.md](<C:/Users/steam/Documents/kepano-obsidian/Daily/2026-09-12.md>)
- [The Bench.md](<C:/Users/steam/Documents/kepano-obsidian/The Bench.md>)
- [The Bench Dev Log.md](<C:/Users/steam/Documents/kepano-obsidian/The Bench Dev Log.md>)
- [Open Loops.md](<C:/Users/steam/Documents/kepano-obsidian/Open Loops.md>)
- [2026-09-12-bench-data-trove-handoff.md](<C:/Users/steam/Projects/docs/handoffs/2026-09-12-bench-data-trove-handoff.md>) - appended Codex handback.
- [2026-09-12-BENCH-DATA-TROVE.md](<C:/Users/steam/Projects/docs/handoffs/to-codex/2026-09-12-BENCH-DATA-TROVE.md>) - appended same Codex handback.
