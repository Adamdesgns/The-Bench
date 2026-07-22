# THE BENCH — AUDIT LOG

Every play the system **calls** (analysis) and **makes** (execution) is written to
a raw, append-only, tamper-evident trail. This is separate from the archive.

| | Archive (`db/archive.json` / xlsx) | Audit log (`db/audit/*.jsonl`) |
|---|---|---|
| Shape | one row per **setup** | one line per **event** |
| Mutable? | yes (rows close/update) | **no — append-only** |
| Purpose | curated ledger, grades + outcomes | forensic proof of what ran |
| Scope | reviewed calls | every call **+ every order attempt (incl. refused)** |

## Record shape (JSONL)

```json
{ "seq": 42, "ts": "2026-07-22T18:40:00.000Z", "actor": "hermes",
  "kind": "execute", "target": "PENG",
  "input": { "order": { "ticker": "PENG", "side": "buy", "usd": 100 } },
  "output": { "ok": false, "reason": "execution blocked" },
  "decision": "refused", "reason": "paper mode",
  "engine": null, "provider": null, "source": null, "mode": "paper",
  "latency_ms": 1, "prev_hash": "…", "hash": "…" }
```

- **actor** — `hermes` (agent) · `manual` (you, via the app) · `runner` (scheduled).
- **kind** — `run_v17 · reconcile · run_marquee · execute · run · state`.
- **decision** — `allowed · refused · n/a`. Every `execute` attempt is logged,
  **including refusals** (the record of *not* trading is as important as trading).
- Secret-looking fields are redacted before write; oversized payloads truncated.

## Integrity — two independent layers

1. **Hash chain.** `hash = sha256(canonical(record − hash) + prev_hash)`. Edit or
   delete any line and `verifyChain()` reports the exact `brokenAtSeq`. A tip
   file (`db/audit/chain-tip.json`) carries `prev_hash` across daily files so the
   chain is continuous.
2. **Git history.** The trail is committed, so the repo's history is a second,
   external tamper record.

## Where it's written / read

- Written by **one path only**: `appendAudit()` / `audited()` in
  `server/audit.js`. Nothing edits or deletes lines.
- Hooked at the boundaries: the **MCP server** (`server/mcp.js`) audits every
  tool call Hermes makes; the **backend** (`server/index.js`) audits app runs.
- Read-only surfaces: `GET /api/audit` · `GET /api/audit/verify` ·
  `GET /api/audit/export.csv`, and the **Audit Log** window in the app (stream,
  filters, chain-verify pill, CSV export).

## Files

- `db/audit/audit-YYYY-MM-DD.jsonl` — the daily event log (committed).
- `db/audit/chain-tip.json` — `{seq, hash}` of the last record (committed).

*Proof, not hype.*
