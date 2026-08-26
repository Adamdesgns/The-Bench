# receipts/ — the durable idempotency registry

One JSON file per plan: `<sanitized-plan-id>.json` (sanitize via `sanitizePlanId` — `:` becomes `-`). Session memory is not an idempotency store; this directory plus broker order history is.

Fields (sanitized — no full account numbers, no credentials, no signed URLs): `plan_id`, `row_id`, `executor_commit_sha`, `framework_version`, `account_alias`, `ticker`, `action`, `quantity_mode`, `quantity_value`, `order_type`, `limit_price`, `time_in_force`, `session`, `planned_dollar_risk`, `executor_absolute_ceiling`, `tool_binding`, `review_reference`, `broker_order_id`, `state` (one of the states in `scripts/executor-validate.mjs`), `transitions` (append-only `[{state, at}]`), `filled_quantity`, `average_fill`, `refusal_or_failure_reason`, `raw_pointer` (path under `executor-tests/raw/`, local only).

Any receipt whose `plan_id` matches an incoming handoff **blocks placement** — including `PREFLIGHT_REFUSED` ones (fix the plan → new `created_at` → new `plan_id`). An unreadable receipt also blocks, fail-closed, until a human resolves it.
