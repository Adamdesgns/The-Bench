#!/usr/bin/env node
// stack-ticket.mjs — the stack lane makes its own call for the agentic account.
// (Adam, 2026-11-10: "1/3 ea" NVDA / GOOGL / SPCX for the $200 account, then
// "No that needs to make its own call".)
//
// For each stack name it finds the first add level under the live price. When
// the price is within --near-pct of that level, and one whole share at the
// level fits the cash, the executor's per-order limit and any per-add dollars
// Adam named, it writes a real-order ticket: BUY 1 share, LIMIT at the level,
// placed only when the last trade is at or below the level, good until today's
// close, lane "accumulation". Nothing is armed. A ticket is a file until Adam
// sends its ARM line with one of his one-time codes
// (docs/superpowers/specs/2026-11-09-executor-phone-approval-design.md).
//
//   node scripts/stack-ticket.mjs --names NVDA,SPCX,GOOGL --cash 200 \
//     --prices '{"NVDA":169.3,"SPCX":141.8,"GOOGL":288}' [--near-pct 5] \
//     [--db db/stack.json] [--write] [--send]
//
// Without --write it only prints the plan. --send texts each written ticket
// (slot play) and does nothing without --write. Prices and cash come from the
// caller's live pull: this script is zero-dep and reads no broker.
//
// Why whole shares and one share per add: real-order mode refuses anything
// else (R22_REAL_WHOLE_SHARES), and at $200 a "third" ($66) is under the
// price of every name, so thirds cannot be honoured until the account grows.
// One share per add keeps one name from spending the cash meant for the others.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildTicket, writeTicket } from './executor-ticket.mjs';
import { REAL_ORDER_CEILING_USD, validateRealHandoff } from './executor-validate.mjs';
import { STATE_DIR } from '../executor/lib/ticket.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NEAR_PCT = 5;           // write a ticket only inside this distance to the level
export const NEAR_PCT_MAX = 10;      // a wider gate is refused, never silently accepted
export const DRIFT_PCT = 1;          // half the executor's 2% cap
export const FALLBACK_STOP_PCT = 15; // next-add line when no lower level exists
export const MIN_LEVEL = 1;          // under $1 a 1% drift rounds to nothing
export const BOUGHT_BAND_PCT = 1;    // a buy within 1% of a level used that level up
export const LANE = 'accumulation';

const round2 = (n) => Math.round(n * 100) / 100;

export function checkNearPct(n) {
  if (!(Number.isFinite(n) && n > 0 && n <= NEAR_PCT_MAX)) {
    throw new Error(`--near-pct must be a number above 0 and at most ${NEAR_PCT_MAX} (got ${n})`);
  }
  return n;
}

// Levels at cents, deduplicated, highest first, minus any level a recorded buy already used.
export function usableLevels(entry) {
  const bought = (entry?.buys ?? []).map((b) => Number(b.price)).filter((p) => p > 0);
  const used = (p) => bought.some((b) => Math.abs(b - p) <= (p * BOUGHT_BAND_PCT) / 100);
  const prices = (entry?.levels ?? []).map((l) => round2(Number(l.price))).filter((p) => p > 0);
  return [...new Set(prices)].sort((a, b) => b - a).filter((p) => !used(p));
}

// The add level a buy would use today: the highest usable level under the live price.
export function nextLevel(entry, live) {
  const below = usableLevels(entry).filter((p) => p < live);
  return below.length ? { level: below[0], lower: below[1] ?? null } : null;
}

// Unexpired tickets on disk, any lane: their notional is already spoken for.
export function readLiveTickets(dir = STATE_DIR, now = new Date()) {
  const out = {};
  const tdir = join(dir, 'tickets');
  if (!existsSync(tdir)) return out;
  for (const f of readdirSync(tdir).filter((x) => /^B-\d+\.json$/.test(x))) {
    const row = f.replace(/\.json$/, '');
    try {
      const h = JSON.parse(readFileSync(join(tdir, f), 'utf8'));
      if (Date.parse(h.expires_at) > now.getTime()) {
        out[row] = { ticker: h.ticker, notional: round2(Number(h.quantity_value) * Number(h.limit_price)) };
      }
    } catch {
      out[row] = { ticker: '?', notional: REAL_ORDER_CEILING_USD }; // unreadable: assume the most it could hold
    }
  }
  return out;
}

// Pure: decides, writes nothing. Returns one line per name, nearest-to-level first.
// `validate(args, line)` (optional) returns the executor's refusals for the ticket the
// line would write; a refused line keeps its cash for the names after it.
export function planStackTickets({
  db, names, prices, cash, ceiling = REAL_ORDER_CEILING_USD, nearPct = NEAR_PCT, liveTickets = {}, validate = null,
}) {
  checkNearPct(nearPct);
  const held = Object.values(liveTickets).reduce((s, t) => s + (Number(t.notional) || 0), 0);
  const lines = names.map((raw) => {
    const sym = String(raw).toUpperCase();
    const entry = db?.names?.[sym];
    const live = Number(prices?.[sym]);
    if (!entry) return { sym, status: 'NOT_ON_LANE' };
    if (!entry.row) return { sym, status: 'NO_ROW', note: 'stack entry has no book row' };
    if (liveTickets[entry.row]) return { sym, row: entry.row, status: 'LIVE_TICKET', note: `${entry.row} already has a live ticket` };
    if (!(live > 0)) return { sym, status: 'NO_PRICE' };
    const next = nextLevel(entry, live);
    if (!next) return { sym, status: 'NO_LEVEL', live };
    const distPct = round2(((live - next.level) / live) * 100);
    return { sym, row: entry.row, live, level: next.level, lower: next.lower, distPct, tranche: entry.tranche_dollars ?? null };
  });

  const candidates = lines.filter((l) => l.level).sort((a, b) => a.distPct - b.distPct);
  let left = round2(Number(cash) - held);
  for (const l of candidates) {
    if (l.distPct > nearPct) { l.status = 'FAR'; continue; }
    if (l.level < MIN_LEVEL) { l.status = 'NO_FIT'; l.note = `level $${l.level} is under $${MIN_LEVEL}`; continue; }
    if (l.level > ceiling) { l.status = 'NO_FIT'; l.note = `one share is $${l.level}, over the $${ceiling} per-order limit`; continue; }
    if (l.tranche > 0 && l.level > l.tranche) { l.status = 'OVER_TRANCHE'; l.note = `one share is $${l.level}, over your $${l.tranche} per add`; continue; }
    if (l.level > left) { l.status = 'NO_CASH'; l.note = `one share is $${l.level}, $${Math.max(0, left)} cash left`; continue; }
    const args = {
      row: l.row, shares: 1, limit: l.level, when: `below:${l.level}`, lane: LANE,
      stop: l.lower ?? round2(l.level * (1 - FALLBACK_STOP_PCT / 100)),
      drift: `$${Math.max(0.01, round2((l.level * DRIFT_PCT) / 100)).toFixed(2)}`,
    };
    const refusals = validate ? validate(args, l) : [];
    if (refusals.length) {
      l.status = 'REFUSED';
      l.note = refusals.map((r) => `${r.code}: ${r.message}`).join('; ');
      continue;
    }
    Object.assign(l, args, { status: 'TICKET' });
    left = round2(left - l.level);
  }
  return { lines: [...candidates, ...lines.filter((l) => !l.level)], cashLeft: Math.max(0, left), held: round2(held) };
}

export function planText(plan, { nearPct = NEAR_PCT } = {}) {
  const out = [];
  for (const l of plan.lines) {
    const head = `${l.sym.padEnd(6)} ${String(l.status).padEnd(12)}`;
    if (l.status === 'TICKET') out.push(`${head} buy 1 at ${l.level} when the last trade is at or below it (live ${l.live}, ${l.distPct}% away) [${l.row}]`);
    else if (l.status === 'FAR') out.push(`${head} level ${l.level} is ${l.distPct}% under live ${l.live}; tickets start inside ${nearPct}%`);
    else out.push(`${head} ${l.note ?? ''}${l.live ? ` (live ${l.live})` : ''}`.trimEnd());
  }
  if (plan.held) out.push(`held by live tickets: $${plan.held}`);
  out.push(`cash left after tickets: $${plan.cashLeft}`);
  return out.join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    const names = (val('--names') ?? '').split(',').filter(Boolean);
    const cash = Number(val('--cash'));
    if (!names.length) throw new Error('--names is required');
    if (!(Number.isFinite(cash) && cash >= 0)) throw new Error('--cash is required (the account\'s live buying power)');
    const prices = JSON.parse(val('--prices') ?? '{}');
    const nearPct = checkNearPct(val('--near-pct') !== undefined ? Number(val('--near-pct')) : NEAR_PCT);
    const db = JSON.parse(readFileSync(val('--db') ?? join(ROOT, 'db', 'stack.json'), 'utf8'));
    const now = new Date();
    const receiptsDir = join(ROOT, 'executor-tests', 'receipts');
    const validate = (args, l) => validateRealHandoff(buildTicket({ ...args, ticker: l.sym, now }), { now, receiptsDir }).refusals;
    const plan = planStackTickets({ db, names, prices, cash, nearPct, liveTickets: readLiveTickets(STATE_DIR, now), validate });
    console.log(planText(plan, { nearPct }));
    if (argv.includes('--write')) {
      const book = JSON.parse(readFileSync(join(ROOT, 'db', 'archive.json'), 'utf8'));
      for (const l of plan.lines.filter((x) => x.status === 'TICKET')) {
        let out;
        try {
          out = writeTicket(
            { row: l.row, shares: l.shares, limit: l.limit, stop: l.stop, drift: l.drift, when: l.when, lane: l.lane },
            { book, receiptsDir, now },
          );
        } catch (err) {
          console.log(`\n${l.sym} REFUSED at write — ${err.message}`);
          continue;
        }
        const text = `STACK LANE ${l.sym}: first add level ${l.level}, one whole share.\n\n${out.text}`;
        console.log(`\nTicket written: ${out.path}\n${text}`);
        if (argv.includes('--send')) {
          try {
            execFileSync(process.execPath, [join(ROOT, 'scripts', 'ntfy-read.mjs'), '--slot', 'play', '--title', `STACK TICKET ${l.sym}`, '--text', text], { stdio: 'inherit' });
          } catch (err) {
            console.log(`${l.sym}: ticket WRITTEN but the text to the phone FAILED — ${err.message}`);
          }
        }
      }
    }
  } catch (err) {
    console.error(`REFUSED — ${err.message}`);
    process.exit(1);
  }
}
