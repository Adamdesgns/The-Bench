#!/usr/bin/env node
// executor-arm.mjs — the ON/OFF switch for the BENCH EXECUTOR (prompts/bench-executor-v1.md).
//
// The executor is OFF by default and stays off. Arming is PER-ROW and SELF-EXPIRING:
// you arm it for one book row, for a few hours, and it disarms itself after one
// placement (the executor publishes HALT back to this topic after acting).
// "We only need the executor when we are making buys" — Adam, 2026-08-25.
//
// State lives on ntfy (same pattern as the alert channel bench-adam-7x3, but a
// separate secret topic, because this one is a control, not a notification).
// The claude.ai executor reads it with a plain GET; Adam can flip it from the
// ntfy app on his phone by publishing "ARM B-###" or "HALT" to the topic.
//
//   node scripts/executor-arm.mjs --row B-200 [--hours 4]   arm for ONE row (default 4h window)
//   node scripts/executor-arm.mjs --off                     disarm now (publishes HALT)
//   node scripts/executor-arm.mjs --status                  read the switch
//
// Refusals are the guard working: arming without a row, or for a row not in the
// book, is refused — the switch is per-plan, never a master ON.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOPIC = "https://ntfy.sh/bench-exec-arm-v7q2m9k4x1";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

async function publish(body, title) {
  const res = await fetch(TOPIC, { method: "POST", headers: { Title: title, Priority: "high" }, body });
  if (!res.ok) throw new Error(`ntfy publish failed: HTTP ${res.status}`);
}

async function latest() {
  const res = await fetch(`${TOPIC}/json?poll=1&since=12h`);
  if (!res.ok) throw new Error(`ntfy poll failed: HTTP ${res.status}`);
  const msgs = (await res.text()).trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l)).filter((m) => m.event === "message");
  return msgs.length ? msgs[msgs.length - 1] : null;
}

function stateOf(msg) {
  if (!msg) return { state: "OFF", why: "no messages on the arm topic" };
  const ageMin = (Date.now() / 1000 - msg.time) / 60;
  const arm = msg.message.match(/^ARM (B-\d+)/);
  if (!arm) return { state: "OFF", why: `latest message is "${msg.message}" (${ageMin.toFixed(0)} min ago)` };
  const win = parseFloat((msg.message.match(/window (\d+(?:\.\d+)?)h/) || [])[1] ?? "4");
  if (ageMin > win * 60) return { state: "OFF", why: `ARM ${arm[1]} expired ${(ageMin - win * 60).toFixed(0)} min ago` };
  return { state: `ARMED for ${arm[1]}`, why: `${(win * 60 - ageMin).toFixed(0)} min left in the ${win}h window` };
}

if (has("--status")) {
  const s = stateOf(await latest());
  console.log(`executor switch: ${s.state} — ${s.why}`);
  process.exit(0);
}

if (has("--off")) {
  await publish("HALT", "BENCH EXECUTOR - DISARMED");
  console.log("executor DISARMED — HALT published. Default state restored.");
  process.exit(0);
}

const row = val("--row");
if (!row) {
  console.log(`REFUSED — the switch is per-plan, never a master ON.

  Arm it for exactly one book row:
    node scripts/executor-arm.mjs --row B-200 [--hours 4]
  Turn it off:
    node scripts/executor-arm.mjs --off
  Read it:
    node scripts/executor-arm.mjs --status`);
  process.exit(1);
}

const book = JSON.parse(readFileSync(resolve(ROOT, "db/archive.json"), "utf8"));
if (!book.some((r) => r.id === row)) {
  console.log(`REFUSED — ${row} is not in the book (db/archive.json). An arm for a row that does not exist is exactly the spoofed-plan shape the executor's provenance gate refuses; the switch refuses it too. Log the call first (LOG IT), then arm.`);
  process.exit(1);
}

const hours = parseFloat(val("--hours") ?? "4");
if (!(hours > 0 && hours <= 12)) {
  console.log(`REFUSED — window must be 0-12h (got ${val("--hours")}). A switch armed longer than a session is not a switch.`);
  process.exit(1);
}

await publish(`ARM ${row} window ${hours}h - one placement only, plan must carry this row ID`, "BENCH EXECUTOR - ARMED");
console.log(`executor ARMED for ${row} — ${hours}h window, one placement, then it disarms itself.`);
console.log(`verify: node scripts/executor-arm.mjs --status`);
