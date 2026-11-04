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
    else if (a === '--asked') out.asked = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.slot) throw new Error('--slot is required (plan, play, trip or pump; anything else is written to disk and not sent unless --asked)');
  if (!out.file && !out.text) throw new Error('--file <path> or --text "<body>" is required');
  return out;
}

function asciiOnly(s) {
  // HTTP headers are ASCII; the body is not. Strip anything else from the title.
  return s.replace(/[^\x20-\x7E]/g, '').trim() || 'THE BENCH read';
}

// measure defaults to UTF-8 bytes (ntfy's limit); benny-post.mjs passes a character count (Discord's).
export function splitBody(body, maxBytes = MAX_BYTES, measure = (s) => Buffer.byteLength(s, 'utf8')) {
  const bytes = measure;
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

// PAPER TRADES NEVER REACH THE PHONE (Adam, 2026-11-04: "The ONLY PAPER trades are vans and I do not want
// to see them in my ntfy. ONLY TRADES WE ARE MAKING NEEDS TO COME TO MY NTFY."). Vans Thesis P-001 keeps
// running exactly as before; it is just silent. Routines were told the same in a standing order, but this is
// the one door every read goes through, so the rule is enforced here: any line that talks about a paper trade
// is dropped before sending, and the P-001 card is not sent at all. Reads in this repo keep one paragraph per
// line, so a dropped line is a dropped paragraph or a dropped standings row.
export const PAPER_SLOTS = /^(p001|paper|vans)/i;

// PLANS AND PLAYS ONLY (Adam, 2026-11-04: "From now on nothing comes to my phone except our plans and plays.").
// Only two slots reach the phone: `plan` (a new or changed desk trade plan: entry, stop, target, size, row) and
// `play` (an armed plan's ENTER / NO TRADE, a fill, a trigger firing, a stop or target hit on a real position, an
// order to place or cancel). Every other slot (market reads, snapshots, recaps, calendars, hunt lists, drafts)
// is still written to disk by its routine and is NOT sent. `--asked` sends anything Adam asked for in so many words.
export const PHONE_SLOTS = /^(plan|play|trip|pump)$/i; // trip = the Trip Judge BUY/WAIT/NO; pump = a pump-watch call
const PAPER_LINE = /\bpaper\b|\bPB-\d{3}\b|\bP-001\b|vans thesis|scanner short|\[hunt:[0-9a-f]+\]|\| (desk buy|event run-up)\b|\bPQ[SWN]?-\d{3}\b|\b(wide|near|shape|quant) twins?\b|^\s*best % first/i;

// A real ticket line is never dropped, only scrubbed. The desk copies every real ticket into the paper book
// at the same price before the card goes out (entry check, Trip Judge), so a card can carry a PB id or a
// "paper book" clause; those words come out and the ticket stays (review finding 1, 2026-11-04).
const TICKET = /^\s*(?:[-*\d.)\s]*)(?:\*\*)?(BUY|SELL|SHORT|COVER|ENTER|NO TRADE|NO|WAIT|PLACE|CANCEL|STOP|TARGET|FILLED)\b/;
function scrub(line) {
  const sentences = line.replace(/\s*[([]?\bPB-\d{3}\b[)\]]?/g, '').split(/(?<=[.;])\s+/);
  return sentences.filter((x, i) => i === 0 || !PAPER_LINE.test(x)).join(' ').replace(/\s{2,}/g, ' ').trimEnd();
}

export function stripPaper(body) {
  const kept = [];
  let dropped = 0;
  for (const line of body.split('\n')) {
    if (!PAPER_LINE.test(line)) { kept.push(line); continue; }
    if (TICKET.test(line)) { kept.push(scrub(line)); continue; }
    dropped++;
  }
  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { body: out, dropped };
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
  // --asked: Adam asked for this read in so many words, paper trades included ("unless I ask"): no refusal, no strip.
  if (!args.asked && PAPER_SLOTS.test(args.slot)) {
    console.log(`[ntfy-read] slot "${args.slot}" is a paper-trade card; paper trades are not sent to the phone (Adam, 2026-11-04). Nothing sent.`);
    return 0;
  }
  if (!PHONE_SLOTS.test(args.slot) && !args.asked) {
    console.log(`[ntfy-read] slot "${args.slot}" is not a plan or a play; the phone gets plans and plays only (Adam, 2026-11-04). The read stays on disk. Nothing sent.`);
    return 0;
  }
  const raw = (args.text ?? readFileSync(resolve(args.file), 'utf8')).replace(/\r\n/g, '\n').trim();
  if (!raw) throw new Error('empty read - nothing sent');
  const { body, dropped } = args.asked ? { body: raw, dropped: 0 } : stripPaper(raw);
  if (dropped) console.log(`[ntfy-read] dropped ${dropped} paper-trade line(s) before sending (paper trades stay off the phone).`);
  // A plan or play card that was all paper is a mistake upstream, not a send: exit 4 so the caller sees it.
  if (!body) { console.log('[ntfy-read] the card was all paper trades; NOTHING SENT.'); return -4; }

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
  main().then((n) => { if (n < 0) process.exitCode = -n; }).catch((err) => { console.error(`[ntfy-read] ${err.message}`); process.exit(1); });
}
