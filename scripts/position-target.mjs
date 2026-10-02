// position-target.mjs — the target on a position you already own gets watched too.
//
//   node scripts/position-target.mjs add --ticker GOOGL --target 364.13 --row B-594 [--qty 3] [--note "..."]
//   node scripts/position-target.mjs list [--json]
//   node scripts/position-target.mjs remove --ticker GOOGL        (position closed or target retired)
//   add --db f.json to any command for an offline test file
//
// WHY THIS EXISTS (2026-09-28)
// ----------------------------
// GOOGL's written target was 364.13 (B-228, restated B-293: "react at the stop or
// the target, not in between"). On 2026-09-22 GOOGL printed 364.17 and nothing
// acted (B-594). The 326 stop held all 3 shares, so no sell limit could rest
// beside it, and tripwire.mjs watched triggers, floors and buy zones but never an
// open position's target. A level that lives only in a row's prose is the
// week-recap lesson again: every stop that was resting filled where written;
// every level that lived only in a row missed.
//
// tripwire.mjs reads db/position-targets.json and watches each entry as a TARGET
// (session high >= target). A target is not a ticket: it is the framework's T1
// decision point (trim 25 / 50 pct or hold, stop to breakeven). Adam places every
// order. Targets do not age out like conditionals do; they leave when the
// position closes (remove) or the watchlist marks the name CLOSED/PASS/AVOID.
// Zero-dep. Writes only the targets file.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
export const DEFAULT_DB = resolve(ROOT, "db/position-targets.json");

export function loadTargets(file = DEFAULT_DB) {
  if (!existsSync(file)) return [];
  const j = JSON.parse(readFileSync(file, "utf8"));
  return (Array.isArray(j) ? j : j.targets || []).filter((t) => t && t.sym && Number(t.target) > 0);
}

function save(file, targets) {
  writeFileSync(file, JSON.stringify({ targets }, null, 2) + "\n", "utf8");
}

function nyDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const file = val("--db") ? resolve(val("--db")) : DEFAULT_DB;
  const targets = loadTargets(file);

  if (cmd === "add") {
    const sym = (val("--ticker") || "").toUpperCase();
    const target = Number(val("--target"));
    const row = val("--row");
    const problems = [];
    if (!sym) problems.push("--ticker is missing");
    if (!(target > 0)) problems.push("--target must be a positive number");
    if (!row || !/^B-\d+$/.test(row)) problems.push("--row must be the book row the target comes from (B-###)");
    if (problems.length) {
      console.error(`REFUSED:\n  - ${problems.join("\n  - ")}`);
      process.exit(1);
    }
    const entry = { sym, target, row, qty: val("--qty") ? Number(val("--qty")) : null, note: val("--note") || "", added: nyDate() };
    const next = [...targets.filter((t) => t.sym !== sym), entry];
    save(file, next);
    console.log(`TARGET ${sym} >= ${target} (${row})${targets.some((t) => t.sym === sym) ? " - replaced the previous target" : ""}`);
  } else if (cmd === "remove") {
    const sym = (val("--ticker") || "").toUpperCase();
    if (!targets.some((t) => t.sym === sym)) { console.error(`no target on file for ${sym}`); process.exit(1); }
    save(file, targets.filter((t) => t.sym !== sym));
    console.log(`removed ${sym}`);
  } else if (cmd === "list") {
    if (argv.includes("--json")) { console.log(JSON.stringify(targets, null, 2)); process.exit(0); }
    console.log(`POSITION TARGETS (${targets.length})`);
    for (const t of targets) console.log(`  ${t.sym.padEnd(6)} >= ${String(t.target).padStart(9)}  ${t.row}${t.qty ? `  ${t.qty} sh` : ""}  ${t.note}`);
  } else {
    console.error("usage: position-target.mjs add|list|remove  (see header)");
    process.exit(1);
  }
}
