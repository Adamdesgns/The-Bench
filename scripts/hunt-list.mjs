// hunt-list.mjs — the three hunter lists, on top of the watchlist we already have.
//
//   node scripts/hunt-list.mjs --list
//   node scripts/hunt-list.mjs --set COHR STALK [--discovered-price 267.51 --discovered-on 2026-09-02 --origin hunter --universe market --why "..."]
//   node scripts/hunt-list.mjs --clear COHR
//   node scripts/hunt-list.mjs --json
//   node scripts/hunt-list.mjs --file path/to/watchlist.json   (tests)
//
// WHY THIS EXISTS (v29, 2026-09-02)
// ---------------------------------
// The watchlist carries an execution status (ARMED, OPEN-POSITION, NO-TRADE...).
// The hunter needs a different axis: how far along the idea is.
//   DISCOVERY  interesting; maybe weeks away; no thesis yet
//   STALK      a thesis exists; waiting on the setup
//   READY      everything aligned; waiting on the exact trigger
// READY holds at most THREE names. Three outstanding opportunities beat 47
// "BUY" signals, and a cap is the only thing that keeps READY meaning READY.
//
// The hunt field never replaces status. A name can be STALK and NO-TRADE at the
// same time (the thesis is alive, today's setup was refused). It records
// discovered_price / discovered_on so the book can later measure whether the
// hunter found names BEFORE they became obvious, or after.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

export const HUNT_STATES = ["DISCOVERY", "STALK", "READY"];
export const READY_CAP = 3;
const ORIGINS = ["adam", "x-post", "routine", "hunter", "delta"];
const UNIVERSES = ["market", "ai-infra"];

export function lists(watchlist) {
  const out = { DISCOVERY: [], STALK: [], READY: [] };
  for (const e of watchlist) if (e.hunt && out[e.hunt]) out[e.hunt].push(e);
  return out;
}

// Pure: returns {watchlist, problems}. Never writes.
export function setHunt(watchlist, sym, state, meta = {}) {
  const problems = [];
  const S = String(sym ?? "").toUpperCase();
  const st = String(state ?? "").toUpperCase();
  if (!S) problems.push("symbol is missing");
  if (!HUNT_STATES.includes(st)) problems.push(`state must be one of ${HUNT_STATES.join(", ")} (got ${JSON.stringify(state)})`);
  if (meta.origin && !ORIGINS.includes(meta.origin)) problems.push(`origin must be one of ${ORIGINS.join(", ")}`);
  if (meta.universe && !UNIVERSES.includes(meta.universe)) problems.push(`universe must be one of ${UNIVERSES.join(", ")}`);
  if (meta.discovered_price !== undefined && !(Number.isFinite(meta.discovered_price) && meta.discovered_price > 0)) problems.push("discovered_price must be a positive number");
  if (meta.discovered_on !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(meta.discovered_on))) problems.push("discovered_on must be YYYY-MM-DD");
  if (problems.length) return { watchlist, problems };

  const ready = lists(watchlist).READY.filter((e) => e.sym !== S);
  if (st === "READY" && ready.length >= READY_CAP) {
    return {
      watchlist,
      problems: [`READY already holds ${READY_CAP} (${ready.map((e) => e.sym).join(", ")}) — demote one first. READY means READY.`],
    };
  }

  const next = watchlist.map((e) => ({ ...e }));
  let entry = next.find((e) => e.sym === S);
  if (!entry) {
    entry = { sym: S, status: "WATCH", note: "" };
    next.push(entry);
  }
  const prev = entry.hunt ?? null;
  entry.hunt = st;
  entry.hunt_history = [...(entry.hunt_history ?? []), { at: meta.now ?? new Date().toISOString().slice(0, 10), from: prev, to: st }];
  if (meta.discovered_price !== undefined && entry.discovered_price === undefined) entry.discovered_price = meta.discovered_price;
  if (meta.discovered_on !== undefined && entry.discovered_on === undefined) entry.discovered_on = meta.discovered_on;
  if (meta.origin) entry.origin = meta.origin;
  if (meta.universe) entry.universe = meta.universe;
  if (meta.why) entry.hunt_why = meta.why;
  return { watchlist: next, problems: [] };
}

export function clearHunt(watchlist, sym) {
  const S = String(sym ?? "").toUpperCase();
  const next = watchlist.map((e) => ({ ...e }));
  const entry = next.find((e) => e.sym === S);
  if (!entry || !entry.hunt) return { watchlist, problems: [`${S} carries no hunt state`] };
  entry.hunt_history = [...(entry.hunt_history ?? []), { at: new Date().toISOString().slice(0, 10), from: entry.hunt, to: null }];
  delete entry.hunt;
  return { watchlist: next, problems: [] };
}

function main() {
  const file = resolve(val("--file") ?? resolve(ROOT, "db/watchlist.json"));
  const watchlist = JSON.parse(readFileSync(file, "utf8"));

  if (has("--set")) {
    const i = argv.indexOf("--set");
    const sym = argv[i + 1];
    const state = argv[i + 2];
    const meta = {
      discovered_price: val("--discovered-price") !== undefined ? Number(val("--discovered-price")) : undefined,
      discovered_on: val("--discovered-on"),
      origin: val("--origin"),
      universe: val("--universe"),
      why: val("--why"),
    };
    const { watchlist: next, problems } = setHunt(watchlist, sym, state, meta);
    if (problems.length) {
      console.error("REFUSED — hunt state not changed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
      process.exit(1);
    }
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
    console.log(`${String(sym).toUpperCase()} -> ${String(state).toUpperCase()}`);
    return;
  }
  if (has("--clear")) {
    const { watchlist: next, problems } = clearHunt(watchlist, val("--clear"));
    if (problems.length) {
      console.error("REFUSED — " + problems.join("; "));
      process.exit(1);
    }
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
    console.log(`${String(val("--clear")).toUpperCase()} hunt state cleared`);
    return;
  }

  const L = lists(watchlist);
  if (has("--json")) {
    console.log(JSON.stringify(L, null, 2));
    return;
  }
  for (const s of HUNT_STATES) {
    const cap = s === "READY" ? ` (${L[s].length}/${READY_CAP})` : "";
    console.log(`${s}${cap}`);
    if (!L[s].length) console.log("  (none)");
    for (const e of L[s]) {
      const disc = e.discovered_price ? ` · found ${e.discovered_price} on ${e.discovered_on ?? "?"}` : "";
      console.log(`  ${e.sym.padEnd(6)} status ${e.status}${e.origin ? ` · origin ${e.origin}` : ""}${e.universe ? ` · ${e.universe}` : ""}${disc}${e.hunt_why ? `\n         ${e.hunt_why}` : ""}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
