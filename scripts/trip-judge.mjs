// trip-judge.mjs - a level is crossed, Claude has already judged it by the time the phone buzzes.
//
//   node scripts/trip-judge.mjs              one tick: check the levels, judge any fresh buy-side cross
//   node scripts/trip-judge.mjs --dry        show what would be judged; no Claude run, no state, no push
//   node scripts/trip-judge.mjs --force      run outside the weekday window (testing). The window is 08:00-15:05 CT:
//                                            pump watch only before 08:31, book levels from 08:31 (2026-11-12)
//   node scripts/trip-judge.mjs --status     today's judged levels and the lock, no network
//
// EXIT CODE: 0 = ran (judged or nothing to judge) · 2 = quote fetch failure · 3 = another tick holds the lock.
//
// WHY (Adam, 2026-11-02): "We need to get robinhoods notifications to hit you so when a notification
// hits you have already checked it and can give me a buy." Robinhood's alerts reach only the
// Robinhood app. This watches the Bench's own committed levels instead (server/tripwire.js, the
// free feed, the day-range trick), and on a FRESH BUY-SIDE cross starts one headless Claude run
// (`claude -p`) that follows prompts/trip-judge-v1.md: live Robinhood pull, the v36 framework, a
// book row, and a BUY ticket or a NO sent to the phone. Adam places every order.
//
// The judge run cannot place an order. It gets ONE MCP server, robinhood-trading, through
// --strict-mcp-config (scripts/trip-judge.mcp.json; claude.ai connectors are switched off too), and
// every Robinhood order, review and cancel tool is passed to --disallowedTools (BLOCKED_TOOLS).
// It is a research surface. Verified headless 2026-11-02: the order tools are not in its tool list.
// Cost guard: one judge per tick (one at a time, lock), one per ticker per day, at most
// MAX_JUDGES_PER_DAY a day, only on a level that is still the book's live plan (TJ.stillLive).
// A fresh-context review on 2026-11-02 found ten issues in the first version; all are fixed here.
// Run by the Windows task "Bench Trip Judge" every 5 minutes on weekdays (scripts/register-trip-judge-task.ps1).
// Pure logic in server/tripJudge.js; tests in test/trip-judge.test.mjs.

import { readFileSync, writeFileSync, existsSync, rmSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT } from "../server/config.js";
import { nyDate } from "../server/nyDate.js";
import { loadTargets } from "./position-target.mjs";
import { deriveLevels, fetchQuotes, checkLevels } from "../server/tripwire.js";
import { ct, WINDOW } from "../server/marketWatch.js";
import * as TJ from "../server/tripJudge.js";
import * as PUMP from "../server/pumpWatch.js";
import * as PW from "./pump-watch.mjs";

const NTFY = "https://ntfy.sh/bench-adam-7x3";
const STATE = resolve(ROOT, "db/trip-judge-state.json");
const LOCK = resolve(ROOT, "db/trip-judge.lock");
const LOG = resolve(ROOT, "logs/trip-judge.log");

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const log = (line) => { try { mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG,`${new Date().toISOString()} ${line}\n`); } catch {} console.log(line); };
// 2026-11-04 (Adam: "nothing comes to my phone except our plans and plays"): pings go through ntfy-read's
// play slot like every other card. NTFY stays exported-by-name for the history; nothing posts to it directly.
const ping = async (title, body) => sendCard("play", title, body);

// The CLI's own exe, run with no shell, so the timeout kills the Claude run itself and not a cmd.exe
// wrapped around it (review finding 3). The npm `claude.cmd` shim points at the same file.
const CLAUDE = process.env.TRIP_JUDGE_CLAUDE
  || resolve(process.env.APPDATA || "", "npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe");

function judge(trip, today) {
  // The prompt goes in on stdin, so no argument carries free text.
  const args = ["-p", "--strict-mcp-config", "--mcp-config", resolve(ROOT, "scripts/trip-judge.mcp.json"),
    "--permission-mode", "bypassPermissions", "--disallowedTools", ...TJ.BLOCKED_TOOLS];
  const env = { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: "false" };
  const r = spawnSync(existsSync(CLAUDE) ? CLAUDE : "claude", args, { cwd: ROOT, env, input: TJ.judgePrompt(trip, today), encoding: "utf8", timeout: TJ.JUDGE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  const tail = `${r.stdout || ""}`.trim().split("\n").slice(-3).join(" | ").slice(0, 300);
  if (r.error || r.status !== 0) return { ok: false, detail: r.error ? r.error.message : `exit ${r.status}: ${`${r.stderr || ""}`.trim().slice(0, 200)}` };
  return { ok: true, detail: tail };
}

async function main(argv = process.argv.slice(2)) {
  const has = (f) => argv.includes(f);
  const today = nyDate();
  const state = readJson(STATE, { judged: [] });

  if (has("--status")) {
    const todays = (state.judged || []).filter((j) => j.date === today);
    console.log(`TRIP JUDGE ${today}: ${todays.length} of ${TJ.MAX_JUDGES_PER_DAY} judged today; lock ${TJ.lockIsLive(readJson(LOCK, null)) ? "HELD" : "free"}`);
    for (const j of todays) console.log(`  ${j.at} ${j.ticker} ${j.kind} ${j.price} [${j.src}] -> ${j.result}`);
    return 0;
  }
  if (!has("--force")) {
    // From 08:00 CT the pump watch is awake (Adam, 2026-11-12: "Watch starts at 8am catches the pre market through
    // the open from now on"). Book levels still wait for FIRST_TICK: before the open the free feed's day range and
    // prior close can still describe yesterday (review finding 5).
    const { hhmm, weekday } = ct();
    if (weekday === "Sat" || weekday === "Sun" || hhmm < PUMP.PUMP_FIRST_TICK || hhmm >= WINDOW.close) return 0;
    if (hhmm < TJ.FIRST_TICK) {
      const held = TJ.lockIsLive(readJson(LOCK, null));
      await pumpTick(today, has("--dry"), { canJudge: !held });
      const mine = readJson(LOCK, null);
      if (mine && mine.pid === process.pid) rmSync(LOCK); // only a lock this run wrote
      return held ? 3 : 0;
    }
  }

  const lock = readJson(LOCK, null);
  if (TJ.lockIsLive(lock)) { console.log(`another tick is judging (${lock.ticker}, since ${lock.at})`); await pumpTick(today, has("--dry"), { canJudge: false }); return 3; }
  // Until the opening range closes, the pump watch's cards go out before any book-level judge can hold this tick
  // for minutes (review 2026-11-12, finding 2). The full pump pass at the end does the judging.
  if (ct().hhmm < "09:00") await pumpTick(today, has("--dry"), { cardsOnly: true });

  const wl = readJson(resolve(ROOT, "db/watchlist.json"), []);
  const arch = readJson(resolve(ROOT, "db/archive.json"), []);
  const rows = Array.isArray(arch) ? arch : (arch.rows || arch.archive);
  const { watching } = deriveLevels({ rows, watchlist: wl, targets: loadTargets(), today });
  const buy = watching.filter((l) => (l.kind === "TRIGGER" || l.kind === "BUY ZONE") && TJ.stillLive(l, rows, wl));
  const { quotes, failed } = await fetchQuotes([...new Set(buy.map((l) => l.ticker))]);
  if (buy.length && !Object.keys(quotes).length) { log(`FETCH FAILURE: ${failed.join(", ")}`); await pumpTick(today, has("--dry")); return 2; }

  // checkLevels de-dupes against the tripwire's own fired list; the judge keeps its own, so pass an empty one.
  const crosses = TJ.freshBuyCrosses(checkLevels(buy, quotes, { fired: [] }, today), quotes)
    .map((t) => ({ ...t, prev: quotes[t.ticker].prev }));
  const { pick, skipped } = TJ.pickToJudge(crosses, state, today);

  if (has("--dry")) {
    console.log(`TRIP JUDGE --dry ${today}: ${buy.length} buy-side level(s), ${crosses.length} fresh cross(es)`);
    for (const t of pick) console.log(`  WOULD JUDGE ${t.ticker} ${t.kind} ${t.dir === "below" ? "<=" : ">="} ${t.price} [${t.src}] touched ${t.touched}, prev ${t.prev}`);
    for (const t of skipped) console.log(`  OVER CAP ${t.ticker} ${t.kind} ${t.price} [${t.src}]`);
    await pumpTick(today, true);
    return 0;
  }
  let current = state;
  const tell = TJ.newCapAlerts(skipped, current, today);
  if (tell.length) {
    await ping("THE BENCH - level crossed, judge cap reached", tell.map((t) => `${t.ticker} ${t.kind} ${t.price} [${t.src}]`).join(" | ") + ` -- not judged today (cap of ${TJ.MAX_JUDGES_PER_DAY}). Ask Claude to run it.`);
    current = TJ.recordCapAlerts(current, tell, today);
    writeFileSync(STATE, JSON.stringify(current, null, 2) + "\n");
  }
  for (const trip of pick) {
    writeFileSync(LOCK, JSON.stringify({ ticker: trip.ticker, at: new Date().toISOString(), pid: process.pid }));
    // The "judging now" heads-up was a status ping; removed 2026-11-04. The BUY / WAIT / NO card is the play.
    // Record before running, so a crash or timeout never re-judges the same level all day.
    current = TJ.recordJudged(current, trip, today, "started");
    writeFileSync(STATE, JSON.stringify(current, null, 2) + "\n");
    const r = judge(trip, today);
    log(`${trip.ticker} ${trip.kind} ${trip.price} [${trip.src}] -> ${r.ok ? "done" : "FAILED"}: ${r.detail}`);
    current = { ...current, judged: current.judged.map((j) => (j.key === trip.key && j.date === today ? { ...j, result: r.ok ? "done" : `failed: ${r.detail}` } : j)) };
    writeFileSync(STATE, JSON.stringify(current, null, 2) + "\n");
    if (!r.ok) await ping(`THE BENCH - ${trip.ticker} judge FAILED`, `The judge run for ${trip.ticker} ${trip.kind} ${trip.price} did not finish (${r.detail}). Nothing was decided. Ask Claude to run ${trip.ticker}.`);
  }
  await pumpTick(today, has("--dry"));
  if (existsSync(LOCK)) rmSync(LOCK);
  if (!pick.length) console.log(`nothing to judge (${buy.length} buy-side levels, ${crosses.length} fresh crosses)`);
  return 0;
}

// PUMP WATCH (Adam, 2026-11-04: "If I say watch a ticker like amazon for the pump ... set a 5 min check until
// lunch time and find out which direction it's likely heading."). Each tick reads every live watch; the first
// UP or DOWN of the day starts the same judge with a PUMP trip; the first tick past lunch sends the wrap-up.
// Review fixes 2026-11-04: every save reloads the registry first (a judge can block for 20 minutes while a
// routine adds a watch), reads still run when another tick holds the lock (canJudge false: no call is
// recorded, the next tick makes it), pump judges have their own daily cap, and a failed read after lunch
// still sends the wrap-up.
// 2026-11-12 (Adam: "Watch starts at 8am catches the pre market through the open from now on"): ticks from 08:00 CT.
// TWO PASSES (review 2026-11-12, finding 2: a judge runs up to 20 minutes and the task never overlaps ticks):
//   1. CARDS: read every live watch and send what cannot wait: the pre-market card (one for all watches, before
//      08:30), one PRE-MARKET MOVE card per watch on a 2%+ move after it, and an early read's levels (earlyCard).
//      Each is marked on the watch only when ntfy really sent it, so a failed send is retried next tick.
//   2. JUDGE (skipped with cardsOnly): calls, caps, judges and the lunch wrap-up, as before. Early reads have
//      their own slot and cap (MAX_EARLY_JUDGES_PER_DAY); a capped early read says so on its one card.
// main() runs a cards-only pass before any book-level judge until 09:00 CT, so a book judge never delays a FLUSH card.
async function pumpTick(today, dry = false, { canJudge = true, cardsOnly = false } = {}) {
  const hhmm = ct().hhmm;
  const todays = () => PW.loadWatches().watches.filter((x) => x.date === today);
  const freshOf = (t) => todays().find((x) => x.ticker === t);
  const usedCalls = (early) => todays().reduce((n, x) => n + (x.calls || []).filter((c) => PUMP.EARLY_READS.has(c.read) === early).length, 0);
  const live = todays().filter((w) => !w.ended);

  // PASS 1: read everything, send the cards that cannot wait.
  const reads = [];
  const preItems = [], moveItems = [];
  let promised = usedCalls(true); // early judges already spent today, plus the ones this pass promises
  for (const w of live) {
    let read = null;
    try { read = await PW.readNow(w.ticker); } catch (e) { log(`pump-watch ${w.ticker}: read failed (${e.message})`); }
    reads.push({ ticker: w.ticker, read });
    const fresh = freshOf(w.ticker);
    if (!read || !fresh || fresh.ended) continue;
    if (read.pre && hhmm < PUMP.OPEN_CT) {
      if (!fresh.pre_card) preItems.push({ ticker: w.ticker, pre: read.pre });
      else if (!fresh.pre_move) {
        const pct = PUMP.preMove(fresh.pre_card, read.pre);
        if (pct != null) moveItems.push({ ticker: w.ticker, pre: read.pre, card: fresh.pre_card, pct });
      }
    }
    if (PUMP.isEarly(read) && !fresh.early_card && PUMP.nextAction(fresh, read, today, hhmm).act === "call") {
      const judged = promised < PUMP.MAX_EARLY_JUDGES_PER_DAY;
      if (judged) promised += 1;
      const text = PUMP.earlyCard(fresh, read, hhmm, { judged });
      if (dry) console.log(`EARLY CARD would send: ${text}`);
      else if (sendCard("pump", `${read.read} ${w.ticker} - pump watch`, text)) PW.updateWatch(w.ticker, today, (x) => ({ ...x, early_card: hhmm }));
    }
  }
  if (dry) {
    if (preItems.length) console.log(`PRE-MARKET CARD would send: ${PUMP.preMarketCard(preItems, hhmm)}`);
    if (moveItems.length) console.log(`PRE-MARKET MOVE CARD would send: ${PUMP.preMoveCard(moveItems, hhmm)}`);
  } else {
    if (preItems.length && sendCard("pump", "PUMP WATCH - pre-market", PUMP.preMarketCard(preItems, hhmm))) {
      for (const { ticker, pre } of preItems) PW.updateWatch(ticker, today, (x) => ({ ...x, pre_card: { at: hhmm, last: pre.last } }));
    }
    if (moveItems.length && sendCard("pump", "PRE-MARKET MOVE - pump watch", PUMP.preMoveCard(moveItems, hhmm))) {
      for (const { ticker } of moveItems) PW.updateWatch(ticker, today, (x) => ({ ...x, pre_move: hhmm }));
    }
  }
  if (cardsOnly) return;

  // PASS 2: calls, judges, caps, lunch wrap-ups.
  for (const { ticker, read } of reads) {
    const fresh = freshOf(ticker);
    if (!fresh || fresh.ended) continue; // removed or ended by someone else meanwhile
    if (!read) {
      if (!dry && hhmm > (fresh.until || PUMP.DEFAULT_UNTIL)) {
        PW.updateWatch(ticker, today, (x) => ({ ...x, ended: true }));
        sendCard("pump", `${ticker} pump watch - lunch wrap`, PUMP.endCard(fresh, null));
      }
      continue;
    }
    const { act } = PUMP.nextAction(fresh, read, today, hhmm);
    const last_read = { at_ct: hhmm, read: read.read, last: read.last, why: read.why };
    if (dry) { console.log(`PUMP ${ticker} ${hhmm} ${read.read} ${read.last} (${read.why}) -> ${act}`); continue; }
    if (act === "end") {
      const done = PW.updateWatch(ticker, today, (x) => ({ ...x, last_read, ended: true }));
      sendCard("pump", `${ticker} pump watch - lunch wrap`, PUMP.endCard(done, read));
      continue;
    }
    if (act === "call" && canJudge) {
      const early = PUMP.isEarly(read);
      const cap = early ? PUMP.MAX_EARLY_JUDGES_PER_DAY : PUMP.MAX_PUMP_JUDGES_PER_DAY;
      if (usedCalls(early) < cap) {
        // Record before judging, so a crash never re-calls the same direction.
        const rec = PW.updateWatch(ticker, today, (x) => ({ ...x, last_read, calls: [...(x.calls || []), { read: read.read, at_ct: hhmm, last: read.last }] }));
        writeFileSync(LOCK, JSON.stringify({ ticker, at: new Date().toISOString(), pid: process.pid }));
        const r = judge(PUMP.judgeTrip(rec, read), today);
        log(`PUMP ${ticker} ${read.read} at ${read.last} -> ${r.ok ? "done" : "FAILED"}: ${r.detail}`);
        if (!r.ok) sendCard("pump", `${ticker} pump call - judge FAILED`, `${ticker} turned ${read.read} at ${read.last} (${read.why}), but the judge run did not finish (${r.detail}). Nothing decided. Ask Claude to run ${ticker}.`);
        continue;
      }
      PW.updateWatch(ticker, today, (x) => ({ ...x, last_read, calls: [...(x.calls || []), { read: read.read, at_ct: hhmm, last: read.last, capped: true }] }));
      // A capped early read already said so on its one card (pass 1); only a capped UP/DOWN gets a card here.
      if (!early) sendCard("pump", `${ticker} turned ${read.read} - not judged (cap)`, `${ticker} turned ${read.read} at ${read.last}: ${read.why}. Pump-judge cap of ${cap} a day reached, so no BUY/NO was run. Ask Claude to run ${ticker}.`);
      continue;
    }
    PW.updateWatch(ticker, today, (x) => ({ ...x, last_read }));
  }
}

// Every card from this tick goes through ntfy-read.mjs, the one phone door (plans and plays only).
// "Sent" is logged only when ntfy-read printed a send, never on a refusal or an all-paper strip. Returns whether it sent.
function sendCard(slot, title, text) {
  const r = spawnSync(process.execPath, [resolve(ROOT, "scripts/ntfy-read.mjs"), "--slot", slot, "--title", title, "--text", text], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
  const sent = r.status === 0 && /\[ntfy\] sent/.test(r.stdout || "");
  log(`card "${title}": ${sent ? "sent" : `NOT SENT (exit ${r.status}) ${`${r.stdout || ""}${r.stderr || ""}`.trim().slice(0, 200)}`}`);
  return sent;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code ?? 0)).catch((e) => { console.error(e.message); try { rmSync(LOCK, { force: true }); } catch {} process.exit(1); });
}
