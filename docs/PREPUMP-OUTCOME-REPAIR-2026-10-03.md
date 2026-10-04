# Outcome final-session repair - 2026-10-03

Adam authorized this repair with "Fix it" after the October 3 audit.

## Verified problem

The October 3 weekly run wrote 4,885 revisions from 5,506 due symbol-dates, with 621 skipped. However, 1,243 records remained overdue: 622 September 14 records missing the 14-session horizon and 621 September 18 records missing their 10-session windows. Saved split-adjusted histories for the affected symbols and SPY lack October 2. The raw plan ended on October 2; envelopes do not retain exact request arguments, so provider behavior versus caller date conversion is not yet proven.

A second, independently reproduced defect: a build can score a shorter horizon and report skipped=0/complete=true while a longer, already-due horizon remains missing.

## Changes applied locally

- `scripts/prepump-outcomes.mjs`: emits exact UTC `history_request` arguments, with the exclusive end at midnight after the anchor date. Adds read-only `verify-history`, checking the actual contiguous symbol and SPY windows. Reports all remaining due horizons as `pending` and exits nonzero when incomplete. Prior plans and manifests are retained in unique `.previous` files before replacement. Snapshot and outcome row history remains untouched/append-only.
- `test/prepump-outcome-boundary.test.mjs`: regression coverage for month/year endpoint boundaries, missing final benchmark bar, partial-horizon false completion, recovery revisions, dry-run behavior, and preserved receipts.
- `docs/routines/bench-prepump-outcomes.md`: versioned copy of the updated live routine at `C:/Users/steam/.claude/scheduled-tasks/bench-prepump-outcomes/SKILL.md`. The routine must copy exact request bounds, verify actual coverage before scoring, retry missing history at most once with new filenames, and report unresolved coverage honestly.

## Verification and limits

All 390 repository tests passed (including 40 targeted capture/outcome/backup/calendar tests). The new read-only coverage check correctly rejects the actual incomplete saved history: 1,243 records. Every previously backed-up source file was verified unchanged except the intentionally replaced plan, whose old bytes were retained. No prices fabricated, no snapshot rows or sealed core membership changed, no trades, posting, push or deployment.

LIVE RECOVERY IS NOT COMPLETE. This chat has no callable Robinhood history connector. The existing Hunter read-only bridge supports Codex CLI 0.152/0.153; installed CLI is 0.159.2. Its compatibility check was not overridden. No fresh provider request was made, so neither endpoint behavior nor recovered results are live-verified. SOL/ZEC remain identity-blocked; historical September 14 quality failures are retained.

## Exact recovery continuation

Use a session with the authenticated `get_equity_historicals` tool. The prepared plan is `C:/Users/steam/Projects/apps/the-bench/db/prepump/raw-outcomes/2026-10-02/plan.json` (1,243 pairs, 654 symbols including SPY, 66 batches). Use its exact `history_request`: day/regular/split, start 2026-09-05T00:00:00.000Z, end 2026-10-03T00:00:00.000Z. Do not request SOL or ZEC, account data, or any order tool.

Save each complete response verbatim in a fresh envelope under `raw-outcomes/2026-10-02/hist-zz-repair-<unique>-<batch>.json`, with `tool`, `observed_at`, `adjustment_type: split`, exact `request` arguments, and `response`. Keep all previous payloads. If the October 2 bar is still absent, report that evidence and investigate provider semantics; never fill it from a quote or change the adjustment basis.

Then, from the canonical Bench root:

1. `node scripts/prepump-outcomes.mjs verify-history --asof 2026-10-02` must exit 0.
2. `node scripts/prepump-outcomes.mjs build --asof 2026-10-02` must report pending=0/complete=true; revisions append.
3. `node scripts/prepump-backup.mjs create` then `node scripts/prepump-health.mjs`.
4. The overdue outcome issue must disappear; historical September 14/SOL/ZEC failures may still make overall health exit 1. Report them separately; do not erase past failures.
