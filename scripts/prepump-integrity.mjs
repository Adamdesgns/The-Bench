// Shared data-integrity checks. No broker access and no writes.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function readRows(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).flatMap((line, i) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; }
    catch { throw new Error(`Corrupt JSON at ${path}:${i + 1}; refusing to silently discard a record`); }
  });
}

export function snapshotFiles(root) {
  const dir = join(root, 'db/prepump');
  return existsSync(dir) ? readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).sort().map(f => join(dir, f)) : [];
}

// not_found is a resolution problem, NOT proof of delisting. Keep its denominator
// row but stop automatic provider requests until identity is explicitly reviewed.
export function resolutionBlocks(root) {
  const blocked = new Map();
  for (const path of snapshotFiles(root)) for (const row of readRows(path)) {
    if (['not_found', 'resolution_blocked', 'identity_changed'].includes(row.status)) {
      if (!blocked.has(row.symbol)) blocked.set(row.symbol, { since: row.date, reason: row.status });
    }
  }
  return blocked;
}

export function captureQuality(rows, plan, rawErrors = []) {
  const issues = [...rawErrors];
  if (rows.length !== plan.counts.total) issues.push('row count differs from plan');
  if (new Set(rows.map(r => r.symbol)).size !== rows.length) issues.push('duplicate symbols in capture');
  for (const lane of ['core', 'scan', 'desk']) {
    if (rows.filter(r => r.source?.includes(lane)).length !== (plan.counts[lane] ?? 0)) issues.push(`${lane} count differs from plan`);
  }
  for (const r of rows) {
    if (r.status === 'resolution_blocked') continue; // explicit placeholder, never treated as a measured outcome
    if (r.status !== 'ok') issues.push(`${r.symbol}: ${r.status}`);
    if (r.date !== plan.date) issues.push(`${r.symbol}: stale or mixed session ${r.date}`);
    if (r.market_date_reported !== plan.date) issues.push(`${r.symbol}: provider has not confirmed the session date`);
    const required = ['f_open', 'f_high', 'f_low', 'f_volume', 'q_last_trade_price'];
    if (required.some(k => !Number.isFinite(r[k]))) issues.push(`${r.symbol}: required price/volume missing`);
    if (![r.q_last_trade_time, r.observed_at].every(t => typeof t === 'string' && Number.isFinite(Date.parse(t)))) issues.push(`${r.symbol}: timestamp missing or invalid`);
    if (plan.symbols.find(s => s.symbol === r.symbol)?.history_due) {
      if (!r.h_bar_count || r.h_adjustment_basis !== 'none') issues.push(`${r.symbol}: required raw history missing`);
      if (plan.quality_version >= 2 && (!r.h_split_bar_count || r.h_split_adjustment_basis !== 'split')) issues.push(`${r.symbol}: required split-adjusted history missing`);
    }
  }
  if (plan.desk_error) issues.push(`desk feed rejected: ${plan.desk_error}`);
  const blocked = rows.filter(r => r.status === 'resolution_blocked').map(r => r.symbol);
  const fields = ['f_float', 'f_shares_outstanding', 'f_market_cap', 'f_avg_volume_2_weeks', 'f_avg_volume_30_days', 'f_sector', 'e_next_date', 'e_timing', 'q_bid_price', 'q_ask_price'];
  const field_coverage = Object.fromEntries(fields.map(key => [key, { present: rows.filter(r => r[key] !== null && r[key] !== undefined).length, missing: rows.filter(r => r[key] === null || r[key] === undefined).length }]));
  return { complete: issues.length === 0, research_ready: issues.length === 0 && blocked.length === 0, issues, resolution_blocked: blocked, field_coverage };
}

// Callers must name the population; a desk-selected sample has no implicit base rate.
export function selectPopulation(rows, population) {
  if (!['core', 'scan', 'desk'].includes(population)) throw new Error('population must explicitly be core, scan or desk');
  return rows.filter(r => r.source?.includes(population));
}
