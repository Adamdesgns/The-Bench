# Year-one dataset contract

Approved reliability work: Adam, 2026-09-13, "Do it". No new market-data provider, trading, public publishing or Git push is part of this change.

## Implemented now

- Frozen 460-name core is unchanged. Core, scan and desk populations stay separate. `selectPopulation` requires an explicit population argument; rates are conditional on the frozen population, not automatically the whole market.
- Daily snapshot routine builds the desk feed before its final plan. Failure excludes any stale desk file and records a quality problem without preventing core collection.
- Plan retains resolution-blocked symbols as placeholders but excludes them from provider batches. A previous not_found means unresolved identity, not a verified delisting. No automatic resume or zero-return outcome.
- Required historical windows have distinct raw and split-adjusted views. The historical leg makes two calls per batch; fundamentals/quotes/earnings call counts are unchanged. Both settings are explicitly recorded and are request-attested, not independently verified by the provider.
- Snapshots preserve available bid/ask prices and their timestamps, per-source observation timestamps, business description, financial-status fields and dividend fields. Bid/ask at capture time is not an execution-price guarantee.
- Missing active rows, required prices/volume, source-confirmed session date, timestamps, history or earnings envelopes make capture incomplete. Field coverage is reported separately; a null earnings date is not automatically a provider failure.
- A resolution-blocked placeholder preserves population size and can be structurally complete, but research_ready remains false. That flag is a completeness indicator, not proof of predictive validity or verified instrument identity.
- Outcome v2 appends revisions as 14- and 30-session windows mature. Each window requires contiguous symbol and SPY data. Ten-session extrema use exactly ten sessions. Both directions, closing returns, highs/lows and benchmark outcomes are retained per horizon.
- Outcome v2 uses settled split-adjusted price returns, never a provisional price fallback. Original raw provisional prices remain separate; unlike bases are not subtracted. Returns exclude dividends and trading costs and are explicitly not executable-trade results.
- Corrupt JSON refuses instead of silently disappearing. Raw outcome payloads and private records are excluded from Git. Raw inputs and outcome revisions are retained, with no automatic deletion.
- Local content-addressed backup stores every version under `C:/Users/steam/Projects/backups/bench-prepump`. Each saved object is SHA256-verified. Earlier manifests remain restorable; restoration never overwrites source/existing destinations. This is on the same PC and does not protect against losing that PC or drive.
- Daily Codex health audit is scheduled for 18:15 Central (`bench-dataset-health`). It checks calendar sessions, actual core membership, quality, desk coverage, overdue weekly outcome horizons and backup hashes/coverage. Healthy/unchanged results remain quiet. A powered-off or disconnected host cannot run an audit; the next successful run detects earlier gaps.

## Field requirements before claiming a complete predictive system

| Area | Required information | Current state |
|---|---|---|
| Instrument identity | Stable provider/security identifier, listing/delisting and symbol-change events with effective and observed times | Stable IDs are absent from the inspected payloads. Resolution failures are blocked; silent ticker reuse without a failure cannot yet be ruled out. Description is retained as evidence, not a stable ID. |
| Corporate actions | Split/merger/spinoff/dividend event ledger and adjustment provenance | Both historical price bases and available dividend fields are retained. A full event ledger is not available yet; price-only outcomes are explicitly labeled. |
| Catalysts | Original filing/news/earnings source, event timestamp, publication timestamp, first observation, revision and category | Private reads contain some evidence. No complete structured event feed has been connected. |
| Prediction ledger | Immutable ID, model/rule version, observation cutoff, feature snapshot reference, population, predicted direction/magnitude/probability, horizon and invalidation | Book rows exist. No prediction model or complete immutable prediction ledger has been added. |
| Trade simulation | Entry available after the prediction, exit rule, bid/ask or liquidity assumptions, costs and ordering of stops/targets | Daily quote/history data supports bounded studies; daily highs/lows cannot establish intraday event order. No profit claim or live execution. |
| Market context | Contemporaneous SPY/sector factors, rates/volatility and timestamps | SPY is mandatory for outcomes. A complete same-time macro/sector feature panel is not installed. |
| Validation | Frozen hypotheses and thresholds, chronological holdout, overlap-aware observations, missingness accounting and untouched future test periods | Required for future research. A year of rows is not proof of an edge; repeated dates/symbols are not independent trials. |

Do not fill historical features with later information. Preserve failed hypotheses. Define and version the prediction target before evaluating it. Keep the existing snapshots unchanged; any recoverable additional historical fields belong in a separate backfill product with its true observation provenance.

## Operating commands

```
node scripts/desk-feed.mjs build --date YYYY-MM-DD
node scripts/prepump-collect.mjs plan --date YYYY-MM-DD --dry-run
node scripts/prepump-outcomes.mjs plan --asof YYYY-MM-DD --dry-run
node scripts/prepump-health.mjs
node scripts/prepump-backup.mjs create
node scripts/prepump-backup.mjs verify ABSOLUTE_MANIFEST_PATH
node --test test/*.test.mjs server/*.test.js
```

Collection/build commands are used by the existing approved routines. The independent monitor is read-only and must not run broker requests, repairs, trades or notifications outside Codex.
