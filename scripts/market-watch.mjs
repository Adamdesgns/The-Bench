#!/usr/bin/env node
// market-watch.mjs - the level-hit nag that stops at a selfie.
//
//   node scripts/market-watch.mjs --init                 create the local config (prints the ack topic ONCE)
//   node scripts/market-watch.mjs --link <url>           set the chat link the card opens
//   node scripts/market-watch.mjs --halt | --resume      stop / restart nagging without killing the loop
//   node scripts/market-watch.mjs --status               open alarms, schedule position, config state (no network)
//   node scripts/market-watch.mjs --test-card            send one card to the phone to test Click and the ack path
//   node scripts/market-watch.mjs --ack [--from chat|pc] [--note "..."]   clear every open alarm from this PC
//   node scripts/market-watch.mjs --once [--dry]         one tick
//   node scripts/market-watch.mjs --carry                send the UNANSWERED card for alarms left open on an earlier day
//   node scripts/market-watch.mjs --loop                 the daemon: weekdays 08:25-15:05 CT, a tick every 3 minutes
//   node scripts/market-watch.mjs --reset                clear the alarm state
//   --dir <path>  where config, state and the book live (default db/; env MARKET_WATCH_DIR). Tests use a temp dir.
//
// WHAT IT IS: the tripwire (scripts/tripwire.mjs) that does not stop. Same levels, same
// free feed, same day-range trick. When a buy or sell level is hit it opens an ALARM and
// sends an urgent card to the phone, then again at 2, 5, 10 minutes and every 15 after,
// until a PHOTO lands on a private ack topic or --ack is run here. Text never clears it.
// The photo means Adam saw it, nothing more: nothing in this file knows how to trade.
//
// The ack topic name lives only in db/market-watch.local.json (gitignored). It is
// printed exactly once, by --init, so Adam can subscribe his phone. --status hides it.
//
// Spec: docs/superpowers/specs/2026-10-07-market-watch-design.md

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "../server/config.js";
import { nyDate } from "../server/nyDate.js";
import { loadTargets } from "./position-target.mjs";
import { deriveLevels, fetchQuotes, checkLevels, recordFired } from "../server/tripwire.js";
import * as MW from "../server/marketWatch.js";

export const NTFY = "https://ntfy.sh/bench-adam-7x3";
export const TICK_MS = 3 * 60 * 1000;

export const paths = (dir) => ({
  dir,
  config: resolve(dir, "market-watch.local.json"),
  state: resolve(dir, "market-watch-state.json"),
  tripState: resolve(dir, "tripwire-state.json"),
  archive: resolve(dir, "archive.json"),
  watchlist: resolve(dir, "watchlist.json"),
  targets: resolve(dir, "position-targets.json"),
});
export const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
export const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n", "utf8");
export function loadConfig(dir) {
  const cfg = readJson(paths(dir).config, null);
  if (!cfg) throw new Error("no local config - run --init first");
  return cfg;
}
const log = (...a) => console.log(new Date().toISOString(), ...a);

function init(dir) {
  const P = paths(dir);
  if (existsSync(P.config)) throw new Error(`${P.config} already exists - refusing to overwrite the ack topic`);
  const cfg = { ack_topic: MW.newAckTopic(), chat_link: "", halt: false };
  writeJson(P.config, cfg);
  console.log(`created ${P.config}`);
  console.log(`ack topic (subscribe the ntfy app to this, it is printed only now): ${cfg.ack_topic}`);
}

function setConfig(dir, patch) {
  const P = paths(dir);
  const cfg = loadConfig(dir);
  writeJson(P.config, { ...cfg, ...patch });
  console.log(`config updated: ${Object.keys(patch).join(", ")}`);
}

function status(dir) {
  const P = paths(dir);
  const cfg = loadConfig(dir);
  const state = readJson(P.state, { alarms: [] });
  const open = MW.openAlarms(state);
  console.log(`MARKET WATCH - ${cfg.halt ? "HALTED (config halt: true)" : "running state: ok"}`);
  console.log(`chat link: ${cfg.chat_link || "(not set - use --link)"}`);
  console.log(`ack topic: set (hidden)`);
  console.log(`open alarms: ${open.length}`);
  for (const a of open) {
    console.log(`  ${a.id}  sent ${a.sent.length}x  next in ${Math.max(0, MW.nextNagOffset(a.sent.length) - (Date.now() - Date.parse(a.opened)) / 60000).toFixed(1)} min`);
    for (const l of a.levels) console.log(`    ${l.side} ${MW.fmtLevel(l)}`);
  }
  const acked = state.alarms.filter((a) => a.acked).slice(-3);
  if (acked.length) console.log(`last acked: ${acked.map((a) => `${a.id} by ${a.acked.from} at ${a.acked.at}`).join("; ")}`);
}

async function testCard(dir, fetchFn = globalThis.fetch) {
  const cfg = loadConfig(dir);
  const alarm = { id: "test", opened: new Date().toISOString(), sent: [], acked: null, levels: [{ ticker: "TEST", kind: "TRIGGER", side: "BUY", price: 1, dir: "above", touched: 1, src: "test-card", key: "TEST|TRIGGER|1|above" }] };
  const card = MW.buildCard(alarm, cfg.chat_link);
  card.headers.Title = "THE BENCH - MARKET WATCH TEST CARD";
  await MW.sendCard(fetchFn, NTFY, card);
  console.log("test card sent. Tap it on the phone (it should open the chat), then send a photo to the ack topic.");
  console.log("Then run: node scripts/market-watch.mjs --once --dry  and read the acks line.");
}

export async function main(argv = process.argv.slice(2)) {
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = resolve(val("--dir") ?? process.env.MARKET_WATCH_DIR ?? resolve(ROOT, "db"));

  if (has("--init")) return init(dir);
  if (has("--link")) return setConfig(dir, { chat_link: val("--link") });
  if (has("--halt")) return setConfig(dir, { halt: true });
  if (has("--resume")) return setConfig(dir, { halt: false });
  if (has("--status")) return status(dir);
  if (has("--test-card")) return testCard(dir);
  if (has("--reset")) { writeJson(paths(dir).state, { alarms: [] }); return console.log("alarm state cleared"); }
  throw new Error("no mode given - see the header of scripts/market-watch.mjs");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
