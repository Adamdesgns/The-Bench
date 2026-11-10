#!/usr/bin/env node
// executor-ticket.mjs — the desk's half of a real order. After a BUY call has a
// book row, this writes the ticket file and texts Adam the order plus the exact
// line to send back. It NEVER arms: nothing here posts to the arm topic, and
// without Adam's one-time code the ticket is just a file.
//
//   node scripts/executor-ticket.mjs --row B-1386 --shares 2 --limit 180.50 --stop 174 \
//     --drift '$1.50' [--when now|below:180.50|above:182] [--expires <ISO>] [--no-send]
//
// Writes ~/.bench-executor/tickets/B-1386.json. --no-send prints the text and
// sends nothing.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  validateRealHandoff, REAL_ORDER_CEILING_USD, REAL_SCHEMA_VERSION, REAL_EXECUTOR_VERSION,
} from './executor-validate.mjs';
import { STATE_DIR, armLine, ticketPath } from '../executor/lib/ticket.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FRAMEWORK = 'v36';
export const ACCOUNT_ALIAS = 'AGENTIC-7724'; // the only account an agent client can trade

export function parseWhen(text = 'now') {
  if (text === 'now') return { type: 'NOW' };
  const m = String(text).match(/^(below|above):(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`--when must be now, below:<price> or above:<price> (got ${text})`);
  return { type: m[1] === 'below' ? 'LAST_AT_OR_BELOW' : 'LAST_AT_OR_ABOVE', price: Number(m[2]) };
}

// The next 16:00 New York time at or after `now`, on a weekday. Holidays are not
// known here; a ticket for a holiday simply never fires and expires.
export function nextCloseIso(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const read = (d) => Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  for (let days = 0; days < 8; days++) {
    const probe = new Date(now.getTime() + days * 86400000);
    const p = read(probe);
    if (p.weekday === 'Sat' || p.weekday === 'Sun') continue;
    // Find the UTC instant that reads 16:00:00 on that New York date.
    const guess = new Date(Date.UTC(+p.year, +p.month - 1, +p.day, 20, 0, 0));
    const g = read(guess);
    const close = new Date(guess.getTime() - ((+g.hour % 24) - 16) * 3600000);
    if (close.getTime() > now.getTime()) return close.toISOString();
  }
  throw new Error('could not find the next close');
}

export function buildTicket({ row, ticker, shares, limit, stop, drift, when = 'now', expires, now = new Date() }) {
  const created = now.toISOString();
  const notional = shares * limit;
  return {
    schema_version: REAL_SCHEMA_VERSION,
    plan_id: `${row}:${created}`,
    row_id: row,
    framework_version: FRAMEWORK,
    executor_version: REAL_EXECUTOR_VERSION,
    created_at: created,
    expires_at: expires ?? nextCloseIso(now),
    account_alias: ACCOUNT_ALIAS,
    asset_class: 'equity',
    ticker,
    action: 'BUY',
    lane: 'base_swing',
    structure: 'long_shares',
    quantity_mode: 'shares',
    quantity_value: shares,
    order_type: 'LIMIT',
    limit_price: limit,
    time_in_force: 'DAY',
    session: 'REGULAR_HOURS_ONLY',
    invalidation_price: stop,
    planned_dollar_risk: notional, // no stop is placed, so the whole position is at risk
    executor_absolute_ceiling: Math.ceil(notional * 100) / 100,
    maximum_price_drift: drift,
    exit_owner: 'MANUAL',
    concentrated: false,
    leveraged_product: false,
    conviction_bet: false,
    place_when: parseWhen(when),
  };
}

export function ticketText(h) {
  const w = h.place_when;
  const when = w.type === 'NOW' ? 'as soon as the market is open' : `when the last trade is ${w.type === 'LAST_AT_OR_BELOW' ? 'at or below' : 'at or above'} $${w.price}`;
  return [
    `REAL ORDER TICKET ${h.row_id}`,
    `Buy ${h.quantity_value} ${h.ticker}, limit $${h.limit_price}, about $${(h.quantity_value * h.limit_price).toFixed(2)}.`,
    `Places ${when}. Good until ${h.expires_at}.`,
    `Your stop level is $${h.invalidation_price}. The program will NOT place it or sell for you.`,
    '',
    'To approve, send this on your arm channel with your next unused code:',
    armLine(h),
    '',
    'Do nothing and it expires. Send HALT to stop anything already approved.',
  ].join('\n');
}

// Refuses without a real book row, a passing contract, or with a live ticket
// already on the row. Returns the path written. Never arms.
export function writeTicket(args, { book, dir = STATE_DIR, ceilingUsd = REAL_ORDER_CEILING_USD, receiptsDir = null, now = new Date() }) {
  const row = book.find((r) => r.id === args.row);
  if (!row) throw new Error(`${args.row} is not in the book. Log the call first.`);
  const h = buildTicket({ ...args, ticker: row.ticker, now });
  const check = validateRealHandoff(h, { now, ceilingUsd, receiptsDir });
  if (!check.ok) throw new Error(`ticket refused: ${check.refusals.map((r) => `${r.code}: ${r.message}`).join('; ')}`);
  const path = ticketPath(args.row, dir);
  if (existsSync(path)) {
    let old = null;
    try { old = JSON.parse(readFileSync(path, 'utf8')); } catch { /* an unreadable ticket is replaced below only if expired, so refuse */ }
    if (!old || Date.parse(old.expires_at) > now.getTime()) throw new Error(`${args.row} already has a live ticket.`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(h, null, 2));
  return { path, handoff: h, text: ticketText(h) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    const book = JSON.parse(readFileSync(join(ROOT, 'db', 'archive.json'), 'utf8'));
    const args = {
      row: val('--row'), shares: Number(val('--shares')), limit: Number(val('--limit')), stop: Number(val('--stop')),
      drift: val('--drift'), when: val('--when') ?? 'now', expires: val('--expires'),
    };
    const out = writeTicket(args, { book, receiptsDir: join(ROOT, 'executor-tests', 'receipts') });
    console.log(`Ticket written: ${out.path}\n\n${out.text}`);
    if (!argv.includes('--no-send')) {
      execFileSync(process.execPath, [join(ROOT, 'scripts', 'ntfy-read.mjs'), '--slot', 'play', '--title', `TICKET ${args.row}`, '--text', out.text], { stdio: 'inherit' });
    }
  } catch (err) {
    console.error(`REFUSED — ${err.message}`);
    process.exit(1);
  }
}
