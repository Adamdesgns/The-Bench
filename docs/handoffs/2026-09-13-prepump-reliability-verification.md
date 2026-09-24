# Bench year-one collection reliability — 2026-09-13

**[Codex]** Adam asked what existing data can establish, whether a year would be enough, and whether all necessary information is being recorded. After the audit identified reliability gaps, Adam said **"Do it"**, authorizing the proposed reliability fixes, live desk routine update, local backup and independent health monitor. This supersedes Task 5 pending approval in the September 12 handoffs.

## Result and decisions

Canonical checkout: C:/Users/steam/Projects/apps/the-bench, branch v29-hunter-handoff. Implementation commit: **0675098**. Earlier desk/scorecard commits: 458a3ed, 5616c5c, 56c0e87; initial verification: 44e1fc6. No push, merge, deployment, broker request, order or ntfy message was performed. Existing unrelated dirty files were preserved and excluded from commits.

- Outcome v2 now revisits 10/14/30-session horizons as they mature, stores append-only revisions, and calculates extrema over exactly the requested window. Missing symbol/SPY bars leave that horizon unscored. Settled split-adjusted prices are mandatory; provisional raw prices are separate. Results are price returns, excluding dividends and costs, not executable trading returns.
- Daily plans preserve the frozen 460-name core and keep core/scan/desk populations explicit. Prior resolution failures remain visible as blocked placeholders and are excluded from provider requests. This does not establish delisting or a stable security identity.
- Capture quality now checks required fields, dates, source times, lane counts, raw and split-adjusted history, and earnings envelopes. Optional-field coverage is reported. Desk build failure skips stale desk input and makes the defect visible.
- Both historical price bases are retained. This adds one historical request per due batch (two total); other provider legs are unchanged. Adjustment basis is request-attested. No new provider was connected.
- SHA256 content-addressed backups preserve local versions and verify all saved bytes; restores refuse existing destinations. Daily read-only health checks detect missed sessions, lane/quality problems, overdue weekly outcomes and backup damage or missing coverage.

## Files changed

All paths below are relative to C:/Users/steam/Projects/apps/the-bench:

- .gitignore — excludes private raw outcomes, health/manual/dated desk records.
- CLAUDE.md — desk routine now enabled; year-one contract linked.
- docs/PREPUMP-YEAR-ONE-CONTRACT.md — implemented scope, field gaps and operating commands.
- scripts/prepump-backup.mjs — local backup, verification and safe restore functions.
- scripts/prepump-collect.mjs — strict capture, price bases, additional available fields and resolution blocks.
- scripts/prepump-health.mjs — read-only calendar/data/outcome/backup audit.
- scripts/prepump-integrity.mjs — strict readers, population selection and capture integrity.
- scripts/prepump-outcomes.mjs — outcome v2 and horizon maturation.
- scripts/prepump-session.mjs — impossible-date rejection.
- test/prepump-reliability.test.mjs — 15 substantive regression tests.
- docs/handoffs/2026-09-13-prepump-reliability-verification.md — this verification report.

External configuration changed:

- C:/Users/steam/.claude/scheduled-tasks/bench-prepump-snapshot/SKILL.md
- C:/Users/steam/.claude/scheduled-tasks/bench-prepump-outcomes/SKILL.md
- C:/Users/steam/.codex/automations/bench-dataset-health/automation.toml (created through the Codex automation API).

Claude routine application: **2026-09-13T05:34:12.089Z**, 00:34 Central. Existing snapshot/outcome schedules unchanged. Snapshot now builds desk, requests both history bases, checks quality, backs up even incomplete captures, and audits. Outcomes request split-adjusted data, append matured revisions and back up even with nothing due. No live collection/scoring was triggered to test this.

Installed routine SHA256:
- C:/Users/steam/.claude/scheduled-tasks/bench-prepump-snapshot/SKILL.md: c41e5ba22953d712300401e81d2813fb31f12009f5c8afa4e5e52d4136d39ec5
- C:/Users/steam/.claude/scheduled-tasks/bench-prepump-outcomes/SKILL.md: 7bebf64f981981c292e54631039f891f804999b9113bc3fe75f6605d4a04f68f

Codex automation **bench-dataset-health** is ACTIVE in this task, daily **18:15 Central**. It runs only the read-only health command, stays quiet on healthy/unchanged findings, and reports new actionable failures/recoveries and the first actual Monday capture once. It does not collect or repair. The PC must be available to run it.

## Verification

- Final command: node --test --test-reporter=spec test/*.test.mjs server/*.test.js — **337 passed, 0 failed**.
- Synthetic tests cover exact window boundaries, missing data/SPY and wrong-basis refusal, successive horizon revisions without duplicate writes, original-byte preservation, quality failures, blocked-symbol denominator preservation, impossible dates, Central grace/DST/weekends, backup restore/hash damage and nesting/sync refusal.
- Read-only Friday build using the original raw plan: 593 total rows, core 460, scan 145, desk 0; complete true. These overlapping source counts do not sum to total. This was a preview, not an appended replacement. Expanded desk preview: 612 total/core 460/scan 145/desk 30. Monday desk preview: 20 names including 17 manually registered names. Monday actual capture remains unverified.
- Protected hashes unchanged: db/archive.json, db/patterns.json, db/prepump/universe-core.json, history-state.json, raw/2026-09-11/plan.json and the September 8–11 snapshot NDJSON files. Existing rows and book were not rewritten.
- Real backup created and every object hash verified: **465 files, 18,323,103 bytes**. Manifest: C:/Users/steam/Projects/backups/bench-prepump/manifests/2026-09-13T05-30-14.049Z-5a0d7a0c-94be-4803-8967-b2c5ef11c46d.json. Restore was tested on synthetic fixtures, not a full production restore. This same-PC backup does not protect loss of the PC/drive. Broker rows stay out of Git and OneDrive.
- Read-only health audit through September 11: no actionable issues; four legacy-capture warnings because old records predate stricter quality/split-history requirements. Old records were preserved.
- git diff --check passed; licensed raw-outcome paths ignored; installed routine hashes match approved proposals. Code commit used only the ten specified implementation paths; index was empty afterward.

Other commands used during verification: node scripts/prepump-health.mjs; node scripts/prepump-backup.mjs create; node scripts/prepump-backup.mjs verify <manifest>; collector/outcome plan and fixture CLI calls; protected-hash verification via workspace apply-desk-plan.cjs verify-hashes. No broker tool was called.

## Limits and exact next steps

1. After Monday September 14's 16:30 Central collection, verify actual written.core=460, written.desk>0, complete=true, row totals and complete backup coverage. The 18:15 monitor is tasked to report this. A dry run is not this evidence.
2. Verify the next weekly outcome run appends newly mature horizons from actual split-adjusted data. Current v2 evidence is synthetic/offline.
3. Before claiming full predictive coverage, address stable security IDs and corporate-action event history, a timestamped catalyst/news/filing feed, an immutable prediction/rule-version ledger, and complete contemporaneous market context. None was silently invented or connected by this change.
4. Before judging an edge, freeze prediction targets and chronological holdouts, account for overlapping observations and missing data, and define realistic costs/execution separately. A year supplies more observations, not a guaranteed independent or representative sample.
5. Push/merge remain unapproved. Do not stage unrelated working-tree changes. Do not rerun old task-phase application helpers or overwrite existing raw rows to retrofit current requirements.

Raw folders are retained, but this change does not guarantee immutable filenames for every repeated provider request. Backup versions exist when a backup was taken. Resolution blocking cannot detect silent ticker reuse without a failure. No full corporate-action ledger, intraday ordering, new prediction model or profitability claim is provided.

## Shared record

This document is also saved at C:/Users/steam/Projects/docs/handoffs/2026-09-13-bench-year-one-reliability-handoff.md. Daily/2026-09-13.md, The Bench.md frontmatter, The Bench Dev Log.md and Open Loops.md are updated with Codex attribution. September 12 Claude handoff copies receive an append-only superseding note. Workspace C:/Users/steam/OneDrive/Documents/ChatGPT/Trading Prediction contains implementation staging/helper scripts and routine hash receipts, never a copy of broker row data.
