# executor-tests/ — evidence layout for bench-executor-v1

- `raw/` — **unredacted broker payloads. Gitignored. NEVER committed.** Populated only during authorized tests; the directory appears locally on first use.
- `redacted-fixtures/` — safe, reviewed fixtures suitable for Git. **Synthetic (`"_synthetic": true`) until real captures replace them** — normalization built from them is provisional by definition.
- `receipts/` — sanitized durable execution receipts. **Load-bearing, not bookkeeping:** the duplicate check reads this directory. Committing new receipts immediately after an executor session is a mandatory operator step.

Contract + refusal codes: `scripts/executor-validate.mjs`. Tests: `npm test`. Protocol: `docs/executor-test-protocol.md`.
