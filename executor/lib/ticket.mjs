// ticket.mjs — the parts of a real-order ticket that both the desk's writer and
// the program must agree on. Pure, except for reading a ticket file.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Lives outside the repo so a ticket, a used code or an approval is the same
// thing no matter which checkout or worktree is looking at it.
export const STATE_DIR = join(homedir(), '.bench-executor');

// 32 characters with the look-alikes (0/O, 1/I) removed, for typing on a phone.
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Six characters tied to the exact order. Editing any term of the order after
// the text went out changes the code, and the approval stops matching.
export function ticketCode(h) {
  const when = h.place_when ?? {};
  const terms = [
    h.plan_id, h.row_id, h.account_alias, h.ticker, h.action, h.quantity_mode, h.quantity_value,
    h.limit_price, when.type, when.price ?? null, h.expires_at, h.executor_absolute_ceiling,
    h.maximum_price_drift, h.created_at,
  ];
  const digest = createHash('sha256').update(JSON.stringify(terms)).digest();
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[digest[i] % ALPHABET.length];
  return out;
}

// The full SHA-256 of the whole ticket, keys sorted, so the same ticket always
// gives the same digest. The approval stores this and the attempt compares it:
// six letters (30 bits) could be ground to collide, 256 bits cannot.
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));
export const ticketDigest = (h) => createHash('sha256').update(canonical(h)).digest('hex');

export const armLine =(h, code = '<your next code>') => `ARM ${h.row_id} ${ticketCode(h)} ${code}`;

export function conditionMet(when, last) {
  if (when?.type === 'NOW') return true;
  if (!Number.isFinite(last)) return false;
  if (when?.type === 'LAST_AT_OR_BELOW') return last <= when.price;
  if (when?.type === 'LAST_AT_OR_ABOVE') return last >= when.price;
  return false;
}

export function ticketPath(row, dir = STATE_DIR) {
  if (!/^B-\d+$/.test(String(row))) throw new Error(`not a row id: ${row}`);
  return join(dir, 'tickets', `${row}.json`);
}

// Missing returns null. An unreadable ticket throws: callers refuse.
export function loadTicket(row, dir = STATE_DIR) {
  const path = ticketPath(row, dir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}
