#!/usr/bin/env node
// stack-ticket.mjs — the stack lane makes its own call for the agentic account.
// (Adam, 2026-11-10: "1/3 ea" NVDA / GOOGL / SPCX for the $200 account, then
// "No that needs to make its own call".)
//
// For each stack name it finds the first add level under the live price. When
// the price is within --near-pct of that level, and one whole share at the
// level fits both the cash and the executor's per-order limit, it writes a
// real-order ticket: BUY 1 share, LIMIT at the level, placed only when the last
// trade is at or below the level, good until today's close. Nothing is armed.
// A ticket is a file until Adam sends its ARM line with one of his one-time
// codes (docs/superpowers/specs/2026-11-09-executor-phone-approval-design.md).
//
//   node scripts/stack-ticket.mjs --names NVDA,SPCX,GOOGL --cash 200 \
//     --prices '{"NVDA":169.3,"SPCX":141.8,"GOOGL":288}' [--near-pct 5] \
//     [--db db/stack.json] [--write] [--send]
//
// Without --write it only prints the plan. --send texts each written ticket
// (slot play). Prices and cash come from the caller's live pull: this script
// is zero-dep and reads no broker.
//
// Why whole shares and one share per add: real-order mode refuses anything
// else (R22_REAL_WHOLE_SHARES), and at $200 a "third" ($66) is under the
// price of every name, so thirds cannot be honoured until the account grows.
// One share per add keeps one name from spending the cash meant for the others.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { writeTicket } from './executor-ticket.mjs';
import { REAL_ORDER_CEILING_USD } from './executor-validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NEAR_PCT = 5;          // write a ticket only inside this distance to the level
export const DRIFT_PCT = 1;         // half the executor's 2% cap
export const FALLBACK_STOP_PCT = 15; // thesis-check line when no lower level exists

const round2 = (n) => Math.round(n * 100) / 100;

// The add level a buy would use today: the highest stored level under the live price.
export function nextLevel(entry, live) {
  const below = (entry?.levels ?? []).map((l) => l.price).filter((p) => p > 0 && p < live).sort((a, b) => b - a);
  return below.length ? { level: below[0], lower: below[1] ?? null } : null;
}

// Pure: decides, writes nothing. Returns one line per name, nearest-to-level first.
export function planStackTickets({ db, names, prices, cash, ceiling = REAL_ORDER_CEILING_USD, nearPct = NEAR_PCT }) {
  const lines = names.map((raw) => {
    const sym = String(raw).toUpperCase();
    const entry = db?.names?.[sym];
    const live = Number(prices?.[sym]);
    if (!entry) return { sym, status: 'NOT_ON_LANE' };
    if (!entry.row) return { sym, status: 'NO_ROW', note: 'stack entry has no book row' };
    if (!(live > 0)) return { sym, status: 'NO_PRICE' };
    const next = nextLevel(entry, live);
    if (!next) return { sym, status: 'NO_LEVEL', live };
    const distPct = round2(((live - next.level) / live) * 100);
    return { sym, row: entry.row, live, level: next.level, lower: next.lower, distPct };
  });

  const candidates = lines.filter((l) => l.level).sort((a, b) => a.distPct - b.distPct);
  let left = Number(cash);
  for (const l of candidates) {
    if (l.distPct > nearPct) { l.status = 'FAR'; continue; }
    const cap = Math.min(ceiling, left);
    if (l.level > ceiling) { l.status = 'NO_FIT'; l.note = `one share is $${l.level}, over the $${ceiling} per-order limit`; continue; }
    if (l.level > cap) { l.status = 'NO_CASH'; l.note = `one share is $${l.level}, $${round2(left)} cash left`; continue; }
    l.status = 'TICKET';
    l.shares = 1;
    l.limit = l.level;
    l.when = `below:${l.level}`;
    l.stop = l.lower ?? round2(l.level * (1 - FALLBACK_STOP_PCT / 100));
    l.drift = `$${(l.level * DRIFT_PCT / 100).toFixed(2)}`;
    left = round2(left - l.level);
  }
  return { lines: [...candidates, ...lines.filter((l) => !l.level)], cashLeft: round2(left) };
}

export function planText(plan, { nearPct = NEAR_PCT } = {}) {
  const out = [];
  for (const l of plan.lines) {
    const head = `${l.sym.padEnd(6)} ${String(l.status).padEnd(11)}`;
    if (l.status === 'TICKET') out.push(`${head} buy 1 at ${l.level} when the last trade is at or below it (live ${l.live}, ${l.distPct}% away) [${l.row}]`);
    else if (l.status === 'FAR') out.push(`${head} level ${l.level} is ${l.distPct}% under live ${l.live}; tickets start inside ${nearPct}%`);
    else out.push(`${head} ${l.note ?? ''}${l.live ? ` (live ${l.live})` : ''}`.trimEnd());
  }
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
    if (!(cash >= 0)) throw new Error('--cash is required (the account\'s live buying power)');
    const prices = JSON.parse(val('--prices') ?? '{}');
    const nearPct = val('--near-pct') ? Number(val('--near-pct')) : NEAR_PCT;
    const db = JSON.parse(readFileSync(val('--db') ?? join(ROOT, 'db', 'stack.json'), 'utf8'));
    const plan = planStackTickets({ db, names, prices, cash, nearPct });
    console.log(planText(plan, { nearPct }));
    if (argv.includes('--write')) {
      const book = JSON.parse(readFileSync(join(ROOT, 'db', 'archive.json'), 'utf8'));
      for (const l of plan.lines.filter((x) => x.status === 'TICKET')) {
        try {
          const out = writeTicket(
            { row: l.row, shares: l.shares, limit: l.limit, stop: l.stop, drift: l.drift, when: l.when },
            { book, receiptsDir: join(ROOT, 'executor-tests', 'receipts') },
          );
          const text = `STACK LANE ${l.sym}: first add level ${l.level}. The ${l.stop} line is the next level down, a thesis check, never an order.\n\n${out.text}`;
          console.log(`\nTicket written: ${out.path}\n${text}`);
          if (argv.includes('--send')) {
            execFileSync(process.execPath, [join(ROOT, 'scripts', 'ntfy-read.mjs'), '--slot', 'play', '--title', `STACK TICKET ${l.sym}`, '--text', text], { stdio: 'inherit' });
          }
        } catch (err) {
          console.log(`\n${l.sym} REFUSED — ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.error(`REFUSED — ${err.message}`);
    process.exit(1);
  }
}
