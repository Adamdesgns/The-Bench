#!/usr/bin/env node
// ntfy-read.mjs - send a private Bench read to Adam's phone.
//
//   node scripts/ntfy-read.mjs --slot premarket --file docs/reads/2026-09-08-premarket.md [--dry-run]
//
// Added 2026-09-05 when @TheBenchTrades was retired and every routine went
// private. The routine writes the read to docs/reads/ and this script is the
// ONLY delivery step: it POSTs the file body to the standing ntfy topic and
// prints exactly what it sent. Zero dependencies.
//
// Why a script and not a one-liner: bash swallows "$" inside dollar amounts,
// the scheduled-task console is cp1252, and HTTP headers must be ASCII. Reading
// the file as UTF-8 here sidesteps all three.
//
// Priority is 'urgent' (5) on every send, and every scheduled-task card was
// changed to match on 2026-09-11 at Adam's instruction: "I want all of them
// always as urgent." Reads were going out at ntfy's DEFAULT priority, which
// Android and iOS are free to batch, delay and silence, so the cards that
// actually ask for a decision (the 9:02a entry check, a fired trigger) looked
// and sounded exactly like the ones that only narrated the tape. Urgent is the
// only level that rings through. This only works if the phone lets it: the
// ntfy app must be exempt from battery optimization and allowed past Do Not
// Disturb.

// ntfy caps a message body at 4096 bytes; anything larger is silently turned
// into an attachment, which is unreadable on the lock screen. Reads longer than
// that are split on paragraph boundaries and sent as numbered parts, first part
// first, so the phone shows them in order.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const TOPIC = 'https://ntfy.sh/bench-adam-7x3';
const MAX_BYTES = 3800; // headroom under ntfy's 4096-byte body limit

function parseArgs(argv) {
  const out = { dryRun: false, priority: 'urgent' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--slot') out.slot = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--title') out.title = argv[++i];
    else if (a === '--priority') out.priority = argv[++i];
    else if (a === '--text') out.text = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.slot) throw new Error('--slot is required (premarket, sotm, midday, powerhour, close, snapshot-HHMM, week-recap, weekly-catalyst, challenge)');
  if (!out.file && !out.text) throw new Error('--file <path> or --text "<body>" is required');
  return out;
}

function asciiOnly(s) {
  // HTTP headers are ASCII; the body is not. Strip anything else from the title.
  return s.replace(/[^\x20-\x7E]/g, '').trim() || 'THE BENCH read';
}

export function splitBody(body, maxBytes = MAX_BYTES) {
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  if (bytes(body) <= maxBytes) return [body];
  const paras = body.split(/\n{2,}/);
  const parts = [];
  let cur = '';
  for (const p of paras) {
    const candidate = cur ? `${cur}\n\n${p}` : p;
    if (bytes(candidate) <= maxBytes) { cur = candidate; continue; }
    if (cur) parts.push(cur);
    if (bytes(p) <= maxBytes) { cur = p; continue; }
    // one paragraph bigger than the cap: hard-split it on line breaks, then on length
    let chunk = '';
    for (const line of p.split('\n')) {
      const c2 = chunk ? `${chunk}\n${line}` : line;
      if (bytes(c2) <= maxBytes) { chunk = c2; continue; }
      if (chunk) parts.push(chunk);
      chunk = line;
      while (bytes(chunk) > maxBytes) {
        let cut = chunk.length;
        while (bytes(chunk.slice(0, cut)) > maxBytes) cut = Math.floor(cut * 0.9);
        parts.push(chunk.slice(0, cut));
        chunk = chunk.slice(cut);
      }
    }
    cur = chunk;
  }
  if (cur) parts.push(cur);
  return parts;
}

async function send(title, body, priority, fetchImpl = fetch) {
  const res = await fetchImpl(TOPIC, {
    method: 'POST',
    headers: { Title: title, Priority: priority, Markdown: 'yes' },
    body,
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const body = (args.text ?? readFileSync(resolve(args.file), 'utf8')).replace(/\r\n/g, '\n').trim();
  if (!body) throw new Error('empty read - nothing sent');

  const today = new Date().toISOString().slice(0, 10);
  const baseTitle = asciiOnly(args.title ?? `THE BENCH - ${args.slot} read ${today}`);
  const parts = splitBody(body);

  for (let i = 0; i < parts.length; i++) {
    const title = parts.length > 1 ? `${baseTitle} (${i + 1}/${parts.length})` : baseTitle;
    if (args.dryRun) {
      console.log(`[dry-run] would send "${title}" (${Buffer.byteLength(parts[i], 'utf8')} bytes)`);
    } else {
      await send(title, parts[i], args.priority);
      console.log(`[ntfy] sent "${title}" (${Buffer.byteLength(parts[i], 'utf8')} bytes)`);
    }
  }
  console.log('---');
  console.log(body);
  return parts.length;
}

const invokedDirectly = typeof process.argv[1] === 'string' && /ntfy-read\.mjs$/i.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => { console.error(`[ntfy-read] ${err.message}`); process.exit(1); });
}
