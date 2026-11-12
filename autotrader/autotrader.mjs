#!/usr/bin/env node
// autotrader.mjs — THE AUTOTRADER (docs/autotrader.md). Adam loads a plan from
// his phone with a one-time code; this program buys when the trigger trades,
// sets the stop and target the moment it fills, and pings him.
//
//   node autotrader/autotrader.mjs plan --row B-1460 --symbol NVDA --when above --trigger 166 --limit 167 \
//        --qty 6 --stop 156.10 --target 186.60 --valid-until 2026-11-13T14:30:00-06:00 --max-loss 65.40 \
//        [--not-before 2026-11-13T09:00:00-06:00] [--exit-by 2026-11-17T14:50:00-06:00]
//   node autotrader/autotrader.mjs check B-1460            validate a plan file, print its ticket
//   node autotrader/autotrader.mjs status                  plans, codes left, lock, last tick (no secrets)
//   node autotrader/autotrader.mjs journal [--date YYYY-MM-DD]
//   node autotrader/autotrader.mjs run [--dry] [--once]    the daemon (08:20-15:05 CT)
//   node autotrader/autotrader.mjs setup | codes | unlock  KEYBOARD ONLY (a real terminal)
//
// Who decides a trade: Adam, by sending LOAD with a code only he holds. The
// desk (Claude, routines, the trip judge) may write plan files; nothing here
// lets it load one. setup/codes/unlock refuse without a real terminal, so the
// codes are never printed into an AI's output.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, appendFileSync, rmSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

import { validatePlan, ticket, planCode, loadLine, PLAN_SCHEMA } from './lib/plan.mjs';
import { makeCodeSet, useCode, burnCode, codesLeft } from './lib/codes.mjs';
import { parseCommand, codeCandidates, redact } from './lib/msgs.mjs';
import { DEFAULTS, newState, loadPlan, killPlan, sellPlan, statusLines, tick, endOfDay, isLive } from './lib/engine.mjs';
import { FakeBroker } from './lib/fake.mjs';
import { alert } from '../executor/lib/ntfy.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PLANS_DIR = process.env.BENCH_AUTOTRADER_PLANS ?? join(ROOT, 'db', 'autotrader', 'plans');
export const RUNTIME = process.env.BENCH_AUTOTRADER_HOME ?? join(homedir(), '.bench-autotrader');
const CONFIG = join(RUNTIME, 'config.json');
const LOCK = join(RUNTIME, 'run.lock');
const CALENDAR = join(ROOT, 'db', 'prepump', 'nyse-calendar-2026-2028.json');
const BOT_STATUS = resolve(process.env.USERPROFILE || 'C:/Users/steam', 'OneDrive/Documents/Bot Status');
const STOP_AT_CT = '15:05';
const MAX_MSG_AGE_SEC = 120;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const mask = (acct) => `••${String(acct ?? '').slice(-4)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- files ---------------------------------------------------------------------

/**
 * A missing file is `fallback`. Anything else (a damaged file, a file locked
 * by antivirus) throws: live plans are never silently forgotten and then
 * overwritten with an empty state.
 */
export function readJson(path, fallback) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`could not read ${path} (${e.code ?? e.message})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error(`${path} is damaged (not valid JSON); fix or move it by hand, nothing was overwritten`);
    err.damaged = true; // read fine, but not JSON (a half-written lock, say): callers may treat this apart
    throw err;
  }
}
function writeJsonAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, path);
}
const loadConfig = () => readJson(CONFIG, null);
/** Keyboard commands (setup, codes, unlock): always win, and bump the version. */
const saveConfig = (c) => { c.rev = (c.rev ?? 0) + 1; writeJsonAtomic(CONFIG, c); };
/**
 * The daemon's save: only if nobody changed the file since it was read (codes
 * or unlock at the PC). Otherwise it refuses, so an old set of codes is never
 * written back over a new one.
 */
function saveConfigChecked(c) {
  const disk = loadConfig();
  if ((disk?.rev ?? 0) !== (c.rev ?? 0)) throw new Error('the trader settings changed at the PC while this command was handled; send it again');
  saveConfig(c);
}
const statePath = (dry) => join(RUNTIME, dry ? 'state-dry.json' : 'state.json');
const journalPath = (dry) => join(RUNTIME, dry ? 'journal-dry.jsonl' : 'journal.jsonl');

export function planPath(id) { return join(PLANS_DIR, `${id}.json`); }

export function loadCalendar(path = CALENDAR) {
  const c = JSON.parse(readFileSync(path, 'utf8'));
  return { closed: new Set(c.closed_dates ?? []), early: c.early_closes ?? {}, end: c._supported_range?.end ?? null };
}

function ctNow(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}

function requireTTY(cmd) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`REFUSED: "${cmd}" only runs in a real terminal, typed by Adam. (No AI, script or scheduler has one, by design.)`);
    process.exit(2);
  }
}

// ---- notifications ----------------------------------------------------------

/** Relay to Morgan's chat. Resolves when the relay script ends (never rejects). */
function pingMorgan(text, log) {
  const script = resolve(BOT_STATUS, 'bot-webhook.mjs');
  if (!existsSync(script)) { log('morgan: bot-webhook.mjs not found'); return Promise.resolve(false); }
  const msg = `ALERT FOR ADAM - text him now. Relay only: do not place, change or suggest any order. ${text}`.slice(0, 3000);
  return new Promise((done) => {
    const child = spawn(process.execPath, [script, 'Morgan', msg], { cwd: BOT_STATUS, stdio: 'ignore', windowsHide: true });
    child.on('exit', (code) => { log(`morgan ping ${code === 0 ? 'accepted' : `FAILED (exit ${code})`}`); done(code === 0); });
    child.on('error', (e) => { log(`morgan ping FAILED (${e.message})`); done(false); });
  });
}

/**
 * The last words of a trader that is stopping or cannot start: phone AND
 * Morgan (so an ntfy outage still gets through), waited for, at most 10 s.
 */
async function lastWords(text, { dry = false, phone = true, log = console.error } = {}) {
  const line = dry ? `[DRY RUN] ${text}` : text;
  log(`[alarm] ${line}`);
  if (!phone) return;
  const sends = [alert(line, { title: TITLES.alarm, priority: 'urgent' })];
  if (!dry) sends.push(pingMorgan(line, log));
  await Promise.race([Promise.allSettled(sends), sleep(10000)]);
}

const TITLES = { info: 'AUTOTRADER', fill: 'AUTOTRADER - BOUGHT', closed: 'AUTOTRADER - SOLD', alarm: 'AUTOTRADER - ALARM' };
const PRIORITY = { info: 'default', fill: 'high', closed: 'high', alarm: 'urgent' };

function makeNotify({ dry, phone, log }) {
  return (kind, text) => {
    const line = dry ? `[DRY RUN, no real order] ${text}` : text;
    log(`[${kind}] ${line}`);
    if (!phone) return;
    alert(line, { title: TITLES[kind] ?? 'AUTOTRADER', priority: PRIORITY[kind] ?? 'default' }); // never blocks
    if (!dry && (kind === 'fill' || kind === 'closed' || kind === 'alarm')) pingMorgan(line, log);
  };
}

// ---- phone commands ---------------------------------------------------------

const defaultIO = { readPlan: (id) => readJson(planPath(id), null), loadCfg: loadConfig, saveCfg: saveConfigChecked };

/**
 * Burn every code-shaped word in a message the trader will not act on. It
 * reads the settings itself and tries twice, so a `codes` or `unlock` at the
 * PC in the same moment does not leave a seen code alive.
 */
function burnAll(text, ctx, io) {
  for (let attempt = 0; ; attempt += 1) {
    const cfg = io.loadCfg();
    if (!cfg) return 0;
    let n = 0;
    for (const c of codeCandidates(text)) if (burnCode(cfg.codes, c, ctx.now.toISOString())) n += 1;
    if (!n) return 0;
    try {
      io.saveCfg(cfg);
      return n;
    } catch (e) {
      if (attempt >= 1) throw e;
    }
  }
}

/**
 * One message from the phone. The settings are read fresh for every message,
 * so `codes` and `unlock` at the PC take effect while the trader runs.
 */
export async function handleCommand(text, st, ctx, io = defaultIO) {
  const cfg = io.loadCfg();
  if (!cfg) throw new Error('the trader settings are missing');
  const c = parseCommand(text);
  if (!c) {
    const burned = burnAll(text, ctx, io);
    ctx.journal('ignored', { text: redact(text), burned });
    if (burned) ctx.notify('alarm', `A message on the load topic was not a valid command but held ${burned} of your codes; ${burned === 1 ? 'that code is' : 'those codes are'} now dead. Nothing was done.`);
    return;
  }
  ctx.journal('command', { text: redact(text) });
  if (c.cmd === 'STATUS') {
    ctx.notify('info', `${statusLines(st).join('\n')}\nCodes left: ${codesLeft(cfg.codes)}.${cfg.locked ? ' LOADING IS LOCKED.' : ''}`);
    return;
  }
  if (c.cmd === 'KILL') { killPlan(st, c.id, ctx); return; }
  // LOAD and SELL are trades: they need a one-time code.
  if (cfg.locked) {
    burnAll(text, ctx, io); // seen on the topic: dead even though nothing acts on it
    ctx.notify('alarm', `${c.cmd} ${c.id} ignored: LOAD and SELL are LOCKED after 3 wrong codes. Run unlock at the PC.`);
    return;
  }
  const r = useCode(cfg.codes, c.code, ctx.now.toISOString());
  if (r === 'wrong') {
    cfg.failures = (cfg.failures ?? 0) + 1;
    if (cfg.failures >= 3) cfg.locked = true;
    io.saveCfg(cfg);
    ctx.notify('alarm', `Wrong code: ${c.cmd} ${c.id} ignored (${cfg.failures} of 3).${cfg.locked ? ' LOAD and SELL are NOW LOCKED until you run unlock at the PC.' : ''}`);
    return;
  }
  if (r === 'used') { ctx.notify('alarm', `That code was already used: ${c.cmd} ${c.id} ignored. Use the next code on your list.`); return; }
  cfg.failures = 0;
  try {
    io.saveCfg(cfg); // the code is burned on disk before anything acts on it
  } catch (e) {
    // The settings changed at the PC in the same moment. Nothing acts; the code still dies.
    burnAll(text, ctx, io);
    ctx.journal('command_conflict', { text: redact(text), message: e.message });
    ctx.notify('alarm', `${c.cmd} ${c.id} not done: the trader settings changed at the PC while it was handled. That code is now dead; send it again with your next code.`);
    return;
  }
  if (c.cmd === 'SELL') { sellPlan(st, c.id, ctx); return; }
  const plan = io.readPlan(c.id);
  if (!plan) { ctx.notify('info', `NOT LOADED ${c.id}: there is no plan file for it (db/autotrader/plans/${c.id}.json).`); return; }
  const now = planCode(plan);
  if (now !== c.ticket) {
    ctx.journal('ticket_mismatch', { id: c.id, sent: c.ticket, file: now });
    ctx.notify('alarm', `NOT LOADED ${c.id}: the plan is not the one on your ticket (you sent ${c.ticket}, the file now reads ${now}). It changed after the ticket was written. Nothing loaded; that code is used up.`);
    return;
  }
  await loadPlan(st, plan, ctx);
}

async function pollPhone(cfg, st, ctx, io = defaultIO) {
  const since = st.lastMsgId ?? 'all'; // first run: read everything cached so old codes get burned
  const res = await fetch(`https://ntfy.sh/${cfg.load_topic}/json?poll=1&since=${encodeURIComponent(since)}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`load topic read failed: HTTP ${res.status}`);
  const msgs = (await res.text()).trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((m) => m && m.event === 'message');
  for (const m of msgs) {
    st.lastMsgId = m.id;
    if (ctx.now.getTime() / 1000 - m.time > MAX_MSG_AGE_SEC) {
      try {
        const burned = burnAll(m.message, ctx, io);
        ctx.journal('stale_command', { text: redact(m.message), burned }); // never act on an old message
      } catch (e) {
        ctx.journal('command_error', { text: redact(m.message), message: e.message });
        ctx.notify('alarm', `An old message on the load topic could not have its codes burned (${e.message}). Run codes at the PC to be safe.`);
      }
      continue;
    }
    try {
      await handleCommand(m.message, st, ctx, io);
    } catch (e) {
      ctx.journal('command_error', { text: redact(m.message), message: e.message });
      ctx.notify('alarm', `${redact(m.message)} was not handled (${e.message}).`);
    }
  }
}

// ---- the daemon ---------------------------------------------------------------

function provenance() {
  const paths = ['autotrader', 'executor/lib', 'scripts/executor-validate.mjs', 'db/prepump/nyse-calendar-2026-2028.json'];
  const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', ...paths], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`the trader's code has uncommitted changes, and a live run only uses committed code:\n${dirty}`);
  return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/**
 * One trader at a time: the lock file is created all-or-nothing, never read-then-written.
 * The options exist for the tests (a temp lock file, a reader that fails); the daemon passes none.
 */
export function takeLock({ lock = LOCK, read = readJson, alive = pidAlive, pid = process.pid, onExit = (f) => process.on('exit', f) } = {}) {
  mkdirSync(dirname(lock), { recursive: true });
  const body = JSON.stringify({ pid, at: new Date().toISOString() });
  for (let i = 0; ; i += 1) {
    try {
      writeFileSync(lock, body, { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let held = null;
      try {
        held = read(lock, null);
      } catch (re) {
        // A file that cannot be read at all (antivirus holding it, no permission) is not a stale lock: stop.
        if (!re.damaged) throw re;
        // Half-written: a trader writing it right now, or one that died mid-write. Only an old one is stale.
        let age = Infinity;
        try { age = Date.now() - statSync(lock).mtimeMs; } catch { /* gone already: retry */ }
        if (age < 30_000) throw new Error('another autotrader may be starting (its lock file is brand new)');
        held = null;
      }
      if (held?.pid && alive(held.pid)) throw new Error(`another autotrader is running (pid ${held.pid})`);
      if (i >= 1) throw new Error('could not take the run lock');
      rmSync(lock, { force: true }); // left by a trader that died
    }
  }
  const release = () => {
    try { if (read(lock, null)?.pid === pid) rmSync(lock, { force: true }); } catch { /* leave it: the next start sees a dead pid */ }
  };
  onExit(release);
}

async function run({ dry, once, phone }) {
  const log = (s) => console.log(`${new Date().toISOString()} ${s}`);
  let st = null;
  let halting = false; // once set, the loop starts no new tick and the engine sends no new buy
  let bye = null;
  let current = null; // the tick running now, if any
  // Any way the trader stops other than the daily stop says so, with what it leaves behind. Once only.
  const goodbye = (why) => {
    halting = true;
    bye ??= (async () => {
      // Let a tick already running finish (at most 4 s), so the text says what it just did.
      if (current) await Promise.race([current.catch(() => {}), sleep(4000)]);
      const left = st ? statusLines(st).filter((l) => l !== 'Nothing live.') : [];
      await lastWords(`The autotrader ${why}.${left.length ? ` Live plans it is NOT watching now:\n${left.join('\n')}` : ''}`, { dry, phone, log });
    })();
    return bye;
  };
  // SIGHUP = the console window was closed (Windows gives about 10 s); SIGBREAK = Ctrl+Break.
  // Task Scheduler's End and a forced kill cannot be caught: the next start's RESUMED text covers those.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(sig, () => { goodbye(`was stopped at the PC (${sig})`).finally(() => process.exit(130)); });
  }
  process.on('uncaughtException', (e) => { goodbye(`crashed (${e.message})`).finally(() => process.exit(1)); });
  process.on('unhandledRejection', (e) => { goodbye(`crashed (${e?.message ?? e})`).finally(() => process.exit(1)); });
  try {
    await runLoop({ dry, once, phone, log, setState: (s) => { st = s; }, halted: () => halting, onTick: (t) => { current = t; } });
  } catch (e) {
    await goodbye(st ? `stopped on an error (${e.message})` : `did NOT start (${e.message})`);
    throw e;
  }
}

async function runLoop({ dry, once, phone, log, setState, halted = () => false, onTick = () => {} }) {
  const cfg = loadConfig();
  if (!cfg) throw new Error('not set up yet: Adam runs `node autotrader/autotrader.mjs setup` at the PC first');
  const sha = dry ? 'dry' : provenance();
  takeLock();
  const { LiveBroker } = await import('./lib/live.mjs');
  const live = new LiveBroker({ accountNumber: cfg.account_number, readOnly: dry });
  await live.connect();
  const agents = await live.agentAccounts();
  if (!agents.some((a) => String(a.account_number) === String(cfg.account_number))) {
    throw new Error(`account ${mask(cfg.account_number)} is not agent-tradable for this login any more`);
  }
  if (!dry && (await live.approvalsOn())) {
    throw new Error('"approve trades" is ON for the agent account, so every order would wait for a tap. Turn it off in the Robinhood app, or run --dry.');
  }
  const broker = dry ? new FakeBroker({ quoteSource: (s) => live.quotes(s), accountSource: () => live.account() }) : live;
  const st = readJson(statePath(dry), null) ?? newState(); // a damaged state file throws: never start empty over it
  setState(st);
  const ctx = {
    broker,
    now: new Date(),
    clock: () => Date.now(),
    cfg: { ...DEFAULTS, ...(cfg.limits ?? {}) },
    calendar: loadCalendar(),
    notify: makeNotify({ dry, phone, log }),
    // The journal is a record, never a reason to stop trading: a failed write is logged and skipped.
    journal: (evt, data = {}) => {
      try {
        appendFileSync(journalPath(dry), `${JSON.stringify({ at: new Date().toISOString(), evt, ...data })}\n`);
      } catch (e) {
        log(`journal write failed (${e.message}): ${evt}`);
      }
    },
    save: () => writeJsonAtomic(statePath(dry), st),
    newRef: () => randomUUID(),
    halted, // the engine checks it right before a buy
  };
  ctx.journal('start', { sha, dry, account: mask(cfg.account_number) });
  log(`autotrader ${dry ? 'DRY RUN' : 'LIVE'} on ${mask(cfg.account_number)} at ${sha}. ${statusLines(st).join(' ')}`);
  // Every plan it picks back up is said out loud, so a plan nobody loaded cannot run quietly.
  if (Object.values(st.plans).some(isLive)) ctx.notify('info', `RESUMED (${sha}):\n${statusLines(st).join('\n')}`);
  // The phone and the trading are checked separately: a phone outage never stops stop-management.
  const fails = { phone: 0, tick: 0 };
  const failed = (what, e, limit, text) => {
    fails[what] += 1;
    ctx.journal(`${what}_error`, { message: e.message });
    log(`${what} error: ${e.message}`);
    if (fails[what] >= limit && (fails[what] - limit) % 120 === 0) ctx.notify('alarm', text); // then every ~10 minutes
  };
  for (;;) {
    if (halted()) break;
    ctx.now = new Date();
    try {
      await pollPhone(cfg, st, ctx);
      fails.phone = 0;
    } catch (e) {
      failed('phone', e, 6, `The autotrader cannot read your load topic (${e.message}). LOAD, SELL and KILL are not reaching it; open plans are still being managed.`);
    }
    if (halted()) break;
    try {
      const running = tick(st, ctx);
      onTick(running);
      await running;
      fails.tick = 0;
    } catch (e) {
      failed('tick', e, 6, `The autotrader has failed for 30 seconds straight (${e.message}). Live plans may not be watched. Check the PC.`);
    }
    onTick(null);
    try {
      ctx.save();
    } catch (e) {
      log(`state save failed (${e.message})`); // the tick already alarmed about it
    }
    if (once || halted() || ctNow() >= STOP_AT_CT) break;
    await sleep(ctx.cfg.tickMs);
  }
  if (!once && !halted()) endOfDay(st, ctx);
  log(`autotrader stopping. ${statusLines(st).join(' ')}`);
}

// ---- keyboard-only setup ------------------------------------------------------

async function setup() {
  requireTTY('setup');
  if (loadConfig()) {
    console.error('Already set up. To get new codes run `codes`; to start over delete the config folder yourself.');
    process.exit(1);
  }
  const { LiveBroker } = await import('./lib/live.mjs');
  const live = new LiveBroker({ readOnly: true });
  await live.connect();
  const agents = await live.agentAccounts();
  if (agents.length !== 1) throw new Error(`expected exactly one agent-tradable account, found ${agents.length}`);
  const { codes, store } = makeCodeSet(40);
  const cfg = {
    version: 1,
    account_number: String(agents[0].account_number),
    load_topic: `bench-load-${randomBytes(12).toString('hex')}`,
    codes: store,
    failures: 0,
    locked: false,
    limits: { maxLossPct: Number(val('--max-loss-pct') ?? DEFAULTS.maxLossPct), maxPlans: DEFAULTS.maxPlans },
    created_at: new Date().toISOString(),
  };
  saveConfig(cfg);
  printCodes(cfg, codes);
}

function printCodes(cfg, codes) {
  console.log('\nAUTOTRADER SET UP');
  console.log(`  Account: ${mask(cfg.account_number)} (the agent-tradable one)`);
  console.log(`  Max loss per plan: ${cfg.limits.maxLossPct}% of that account`);
  console.log(`\n  Your private load topic (subscribe to it in the ntfy app):\n\n      ${cfg.load_topic}\n`);
  console.log('  Your one-time codes. PHOTOGRAPH THIS SCREEN NOW. They are not saved anywhere:\n');
  for (let i = 0; i < codes.length; i += 4) console.log(`      ${codes.slice(i, i + 4).map((c, j) => `${String(i + j + 1).padStart(2)}. ${c}`).join('    ')}`);
  console.log('\n  To buy a plan, send on the load topic the LOAD line from its ticket plus your next code:');
  console.log('      LOAD B-1460 ABC234 <next code>');
  console.log('  Each code works once. Three wrong codes lock loading until `unlock`.\n');
}

function regenCodes() {
  requireTTY('codes');
  const cfg = loadConfig();
  if (!cfg) throw new Error('not set up yet');
  const { codes, store } = makeCodeSet(40);
  cfg.codes = store;
  cfg.failures = 0;
  cfg.locked = false;
  saveConfig(cfg);
  printCodes(cfg, codes);
  console.log('  Every old code is now dead.');
}

function unlock() {
  requireTTY('unlock');
  const cfg = loadConfig();
  if (!cfg) throw new Error('not set up yet');
  cfg.failures = 0;
  cfg.locked = false;
  saveConfig(cfg);
  console.log(`Unlocked. ${codesLeft(cfg.codes)} codes left.`);
}

// ---- desk-side commands (no secrets) ------------------------------------------

function numArg(f) {
  const v = val(f);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${f} must be a number`);
  return n;
}

function writePlan() {
  const p = {
    schema: PLAN_SCHEMA,
    id: val('--row'),
    symbol: String(val('--symbol') ?? '').toUpperCase(),
    side: 'long',
    entry: { when: val('--when'), trigger: numArg('--trigger'), limit: numArg('--limit') },
    quantity: numArg('--qty'),
    stop: numArg('--stop'),
    target: numArg('--target'),
    valid_until: val('--valid-until'),
    max_loss: numArg('--max-loss'),
    written_at: new Date().toISOString(),
  };
  if (val('--not-before')) p.not_before = val('--not-before');
  if (val('--exit-by')) p.exit_by = val('--exit-by');
  if (val('--note')) p.note = val('--note');
  const v = validatePlan(p, { calendar: loadCalendar() });
  if (!v.ok) {
    console.error(`REFUSED, plan not written:\n  - ${v.errs.join('\n  - ')}`);
    process.exit(1);
  }
  if (existsSync(planPath(p.id)) && !has('--overwrite')) {
    console.error(`REFUSED: ${planPath(p.id)} exists. A new plan gets a new row; --overwrite only before Adam loads it.`);
    process.exit(1);
  }
  writeJsonAtomic(planPath(p.id), p);
  console.log(`PLAN WRITTEN ${p.id}: ${ticket(p)}`);
  console.log(`Adam loads it from his phone with:  ${loadLine(p)} <next code>`);
}

function check() {
  const arg = argv[1];
  const plan = readJson(/^B-\d+$/.test(arg ?? '') ? planPath(arg) : arg, null);
  if (!plan) { console.error(`no plan at ${arg}`); process.exit(1); }
  const v = validatePlan(plan, { calendar: loadCalendar() });
  console.log(v.ok ? `VALID ${plan.id}: ${ticket(plan)}\n  ${loadLine(plan)} <next code>` : `REFUSED ${plan.id ?? ''}:\n  - ${v.errs.join('\n  - ')}`);
  process.exit(v.ok ? 0 : 1);
}

function status() {
  const cfg = loadConfig();
  if (!cfg) { console.log('Not set up yet (Adam runs setup at the PC).'); return; }
  const st = readJson(statePath(false), newState());
  console.log(`Account ${mask(cfg.account_number)} | codes left ${codesLeft(cfg.codes)} | ${cfg.locked ? 'LOCKED' : 'unlocked'} | max loss ${cfg.limits?.maxLossPct}% | last tick ${st.lastTickAt ?? 'never'}`);
  for (const l of statusLines(st)) console.log(`  ${l}`);
}

function journal() {
  const date = val('--date') ?? new Date().toISOString().slice(0, 10);
  const path = journalPath(has('--dry'));
  if (!existsSync(path)) { console.log('No journal yet.'); return; }
  for (const l of readFileSync(path, 'utf8').split('\n')) if (l.includes(`"at":"${date}`)) console.log(l);
}

// ---- main -------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = argv[0];
  const go = async () => {
    if (cmd === 'plan') return writePlan();
    if (cmd === 'check') return check();
    if (cmd === 'status') return status();
    if (cmd === 'journal') return journal();
    if (cmd === 'setup') return setup();
    if (cmd === 'codes') return regenCodes();
    if (cmd === 'unlock') return unlock();
    if (cmd === 'run') return run({ dry: has('--dry'), once: has('--once'), phone: !has('--dry') || has('--phone') });
    console.error('usage: autotrader.mjs plan|check|status|journal|run [--dry] [--once]|setup|codes|unlock (see the header)');
    return process.exit(2);
  };
  go().catch((e) => { console.error(`autotrader: ${e.message}`); process.exit(1); });
}
