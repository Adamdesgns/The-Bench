// receipts.mjs — durable, sanitized, load-bearing (bench-executor-v1 §8).
// Every transition is a synchronous write to disk BEFORE the next action, so
// a crash mid-run still leaves a truthful record. This is the durable store
// the claude.ai surface never had; go-live blocker #3 closes here.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizePlanId } from '../../scripts/executor-validate.mjs';

export class Receipt {
  constructor(dir, handoff, meta) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, `${sanitizePlanId(handoff.plan_id)}.json`);
    if (existsSync(this.path)) {
      throw new Error(`receipt already exists for ${handoff.plan_id} — a second attempt under the same plan_id is refused`);
    }
    this.data = {
      plan_id: handoff.plan_id,
      row_id: handoff.row_id,
      mode: meta.mode,
      executor_commit: meta.commit,
      framework_version: handoff.framework_version,
      account_alias: handoff.account_alias, // alias + last four ONLY, per contract
      ticker: handoff.ticker,
      action: handoff.action,
      quantity_mode: handoff.quantity_mode,
      quantity_value: handoff.quantity_value,
      order: {
        type: handoff.order_type,
        limit_price: handoff.limit_price,
        time_in_force: handoff.time_in_force,
        session: handoff.session,
      },
      planned_dollar_risk: handoff.planned_dollar_risk,
      executor_absolute_ceiling: handoff.executor_absolute_ceiling,
      exit_owner: handoff.exit_owner,
      tool_binding: null,
      review_ref: null,
      ref_id: null,
      broker_order_id: null,
      final_filled_quantity: null,
      average_fill_price: null,
      state: null,
      transitions: [],
      raw_archive: [],
    };
    this.transition('RECEIVED', 'handoff accepted for processing');
  }

  set(key, value) {
    this.data[key] = value;
    this.flush();
  }

  transition(state, detail) {
    this.data.state = state;
    this.data.transitions.push({ state, at: new Date().toISOString(), detail });
    this.flush();
  }

  addRaw(name) {
    this.data.raw_archive.push(name);
    this.flush();
  }

  flush() {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}

// Raw broker payloads: unredacted, local only, gitignored (executor §8).
export function archiveRaw(rawDir, planId, label, payload) {
  mkdirSync(rawDir, { recursive: true });
  const name = `${sanitizePlanId(planId)}-${Date.now()}-${label}.json`;
  writeFileSync(join(rawDir, name), JSON.stringify(payload, null, 2));
  return name;
}
