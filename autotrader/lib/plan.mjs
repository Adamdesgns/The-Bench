// plan.mjs — what a loadable plan is, and the rules a plan must pass before
// the autotrader will hold it. A plan is a ticket: it carries no opinion, so
// every check here is arithmetic or a hard limit, never a market judgment.
import { createHash } from 'node:crypto';
import { exitByProblem } from './session.mjs';

export const PLAN_SCHEMA = 'autotrader-plan-v1';
export const MAX_CHASE_PCT = 2; // the ceiling may sit at most 2% over the trigger
export const MAX_WINDOW_DAYS = 7; // a plan is good for a week at most

const ROW = /^B-\d+$/;
const SYM = /^[A-Z][A-Z.]{0,5}$/;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const time = (s) => (typeof s === 'string' && ISO_WITH_OFFSET.test(s) ? Date.parse(s) : NaN);
const r2 = (n) => Math.round(n * 100) / 100;

/** Dollars lost if the buy fills at the ceiling and the stop fills at the stop. */
export function planRisk(p) {
  return r2(p.quantity * (p.entry.limit - p.stop));
}

// Keys sorted, so the same plan always gives the same fingerprint.
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));

/** Full SHA-256 of the plan. */
export function planSha(p) {
  return createHash('sha256').update(canonical(p)).digest('hex');
}

// No 0/O or 1/I: easy to read on a phone. Same idea as the executor's ticket code (PR #53).
const TICKET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Six letters tied to the exact plan. LOAD must carry them, so a plan file
 * edited after Adam read its ticket does not load.
 */
export function planCode(p) {
  const d = createHash('sha256').update(canonical(p)).digest();
  let out = '';
  for (let i = 0; i < 6; i++) out += TICKET_ALPHABET[d[i] % TICKET_ALPHABET.length];
  return out;
}

const cents = (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;

/**
 * Validate a plan. `now` matters only for the time window; `calendar`
 * (holidays, half days) for the sell-by time. Returns { ok, errs, risk } and
 * never throws on bad input.
 */
export function validatePlan(p, { now = new Date(), calendar = null } = {}) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };
  if (!p || typeof p !== 'object') return { ok: false, errs: ['the plan is not an object'], risk: null };
  const e = p.entry && typeof p.entry === 'object' ? p.entry : {};

  need(p.schema === PLAN_SCHEMA, `schema must be "${PLAN_SCHEMA}"`);
  need(ROW.test(String(p.id ?? '')), 'id must be a book row like B-1460');
  need(SYM.test(String(p.symbol ?? '')), 'symbol must be an uppercase ticker');
  need(p.side === 'long', 'side must be "long" (the agent account is a cash account: no shorts)');
  need(e.when === 'above' || e.when === 'below', 'entry.when must be "above" (breakout) or "below" (pullback)');
  need(pos(e.trigger), 'entry.trigger must be a positive price');
  need(pos(e.limit), 'entry.limit (the most it pays) must be a positive price');
  need(Number.isInteger(p.quantity) && p.quantity > 0, 'quantity must be whole shares, more than 0');
  need(pos(p.stop), 'stop must be a positive price');
  need(pos(p.target), 'target must be a positive price');
  need(pos(p.max_loss), 'max_loss must be the plan\'s stated dollars at risk');
  for (const [name, v] of [['entry.trigger', e.trigger], ['entry.limit', e.limit], ['stop', p.stop], ['target', p.target]]) {
    if (pos(v)) {
      need(v >= 1, `${name} under $1: the trader only runs stocks priced $1 or more`);
      need(cents(v), `${name} has more than 2 decimals; Robinhood takes whole cents`);
    }
  }

  if (pos(e.trigger) && pos(e.limit)) {
    need(e.limit >= e.trigger, 'entry.limit must be at or above entry.trigger');
    need(e.limit <= e.trigger * (1 + MAX_CHASE_PCT / 100) + 1e-9, `entry.limit more than ${MAX_CHASE_PCT}% over the trigger is a chase`);
  }
  if (pos(p.stop) && pos(e.trigger)) need(p.stop < e.trigger, 'stop must be under the trigger');
  if (pos(p.target) && pos(e.limit)) need(p.target > e.limit, 'target must be over the entry limit');
  // Robinhood's take-profit/stop-loss order needs its two prices at least $0.10 apart.
  if (pos(p.stop) && pos(p.target)) need(p.target - p.stop >= 0.1, 'target and stop must be at least $0.10 apart');

  const vu = time(p.valid_until);
  need(Number.isFinite(vu), 'valid_until must be a time with its offset, like 2026-11-13T14:30:00-06:00');
  if (Number.isFinite(vu)) {
    need(vu > now.getTime(), 'valid_until is already past');
    need(vu <= now.getTime() + MAX_WINDOW_DAYS * 86400000, `valid_until is more than ${MAX_WINDOW_DAYS} days out`);
  }
  if (p.not_before !== undefined && p.not_before !== null) {
    const nb = time(p.not_before);
    need(Number.isFinite(nb), 'not_before must be a time with its offset');
    if (Number.isFinite(nb) && Number.isFinite(vu)) need(nb < vu, 'not_before must come before valid_until');
  }
  if (p.exit_by !== undefined && p.exit_by !== null) {
    const xb = time(p.exit_by);
    need(Number.isFinite(xb), 'exit_by must be a time with its offset');
    if (Number.isFinite(xb)) {
      need(xb > now.getTime(), 'exit_by is already past');
      const why = exitByProblem(xb, calendar);
      need(!why, `exit_by must leave the sale time to fill: ${why}`);
    }
    const nb = time(p.not_before);
    if (Number.isFinite(xb) && Number.isFinite(nb)) need(xb > nb, 'exit_by must come after not_before');
  }

  let risk = null;
  if (pos(e.limit) && pos(p.stop) && Number.isInteger(p.quantity) && p.quantity > 0 && e.limit > p.stop) {
    risk = planRisk(p);
    if (pos(p.max_loss)) {
      need(Math.abs(risk - p.max_loss) <= risk * 0.1 + 0.01,
        `max_loss ${p.max_loss} does not match shares x (limit - stop) = ${risk} (a typo somewhere)`);
    }
  }
  return { ok: errs.length === 0, errs, risk };
}

const fmtCT = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return `${s.replace(',', '')} CT`;
};

/** One plain-English line Adam can read on his phone. */
export function ticket(p) {
  const how = p.entry.when === 'above'
    ? `when it trades at or over ${p.entry.trigger}`
    : `when it pulls back to ${p.entry.trigger} or lower`;
  const parts = [
    `BUY ${p.quantity} ${p.symbol} ${how} (pays at most ${p.entry.limit})`,
    p.not_before ? `not before ${fmtCT(p.not_before)}` : null,
    `good until ${fmtCT(p.valid_until)}`,
    `stop ${p.stop}, target ${p.target}`,
    `max loss about $${planRisk(p).toFixed(2)}`,
    p.exit_by ? `sells by ${fmtCT(p.exit_by)}` : null,
  ].filter(Boolean);
  return `${parts.join('. ')}. [${p.id}]`;
}

/** The line Adam sends to load it: he only adds his next code. */
export function loadLine(p) {
  return `LOAD ${p.id} ${planCode(p)}`;
}
