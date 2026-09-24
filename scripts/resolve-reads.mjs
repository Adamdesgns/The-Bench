// resolve-reads.mjs — close the loop on published reads, and report the bias.
//
//   node scripts/resolve-reads.mjs --due                 what needs grading now (exit 1 if any)
//   node scripts/resolve-reads.mjs --resolve R-003 --outcome wrong --actual 492.18
//   node scripts/resolve-reads.mjs --bias                the directional tally
//   node scripts/resolve-reads.mjs --list [--open|--all] the ledger
//
// Exit codes: 0 = nothing owed / ok   1 = reads are due   2 = bad input
//
// WHY THIS SCRIPT DOES NOT FETCH PRICES.
// The Robinhood MCP is available to the assistant, not to a CLI process. So the
// split is the same one the rest of this repo already uses: the SCRIPT owns the
// ledger, the arithmetic and the tally; the ASSISTANT owns the live pull. The
// script tells you exactly which reads are due and what number settles each one;
// you pull it and hand the verdict back. No script here has ever invented a
// price and this one does not start.
//
// WHAT --bias IS FOR (2026-09-02).
// On 2026-09-02 three published reads missed in the same direction — all three
// under-priced how far a bid would run. Whether that is a real bias or one bad
// Wednesday was unanswerable, because nothing aggregated it. This is the
// answer-shaped hole that command fills.
//
// Read it honestly. A run of misses in one direction is evidence, not proof, and
// the sample is small for a long time. The failure mode this invites is
// over-correcting off six rows and building the OPPOSITE bias with the same
// confidence — which is why --bias prints the sample size next to every rate and
// says nothing at all under 10 resolved rows.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = pathResolve(HERE, "../db/reads.json");
const MIN_SAMPLE = 10;   // below this, refuse to call anything a bias

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

function die(msg) {
  console.error(`resolve-reads: ${msg}`);
  process.exit(2);
}

if (!existsSync(LEDGER)) die(`no ledger at ${LEDGER} — log a read first with log-read.mjs`);
const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
if (!Array.isArray(ledger.rows)) die("db/reads.json is malformed: rows is not an array");
const rows = ledger.rows;

function todayCT() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date());
}

// A wrong FADE means the move kept going: the bid was bigger than the read said.
// A wrong CONTINUATION means the move stopped: the bid was smaller than it said.
function errorDirection(direction) {
  if (direction === "fade") return "under-priced-the-bid";
  if (direction === "continuation") return "over-priced-the-bid";
  return "neutral-read-missed";
}

function save() {
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

function fmtRow(r) {
  const tag = r.ticker ? `${r.ticker} ` : "";
  return `  ${r.id}  ${r.date} ${r.slot}  ${r.direction.toUpperCase().padEnd(12)} ${tag}${r.claim}`;
}

/* ---------------------------------------------------------------- resolve -- */
if (has("--resolve")) {
  const id = val("--resolve");
  const outcome = (val("--outcome") || "").toLowerCase();
  const row = rows.find((r) => r.id === id);
  if (!row) die(`no such read: ${id}`);
  if (!["right", "wrong", "unresolvable"].includes(outcome)) {
    die("--outcome must be: right | wrong | unresolvable");
  }
  if (row.status === "resolved" && !has("--force")) {
    die(`${id} is already resolved (${row.outcome}). Pass --force to overwrite — ` +
        "but a verdict that gets rewritten after the fact is not a verdict.");
  }

  const actualRaw = val("--actual");
  if (outcome !== "unresolvable" && actualRaw === undefined) {
    die("--actual is required — the number that settles it. Pull it live, do not recall it.");
  }
  const actual = actualRaw === undefined ? null : Number(actualRaw);
  if (actual !== null && Number.isNaN(actual)) die(`--actual is not a number: ${actualRaw}`);

  row.status = outcome === "unresolvable" ? "unresolvable" : "resolved";
  row.outcome = outcome === "unresolvable" ? null : outcome;
  row.actual = actual;
  row.error_direction = outcome === "wrong" ? errorDirection(row.direction) : null;
  row.resolved_at = new Date().toISOString();
  if (val("--note")) row.note = (row.note ? row.note + " | " : "") + val("--note");
  save();

  console.log(`${row.id} -> ${outcome.toUpperCase()}${actual !== null ? ` (actual ${actual})` : ""}`);
  console.log(`  claim: ${row.claim}`);
  if (row.error_direction) console.log(`  error direction: ${row.error_direction}`);
  process.exit(0);
}

/* -------------------------------------------------------------------- due -- */
if (has("--due")) {
  const today = todayCT();
  const due = rows.filter((r) => r.status === "open" && r.resolve_by <= today);
  const later = rows.filter((r) => r.status === "open" && r.resolve_by > today);

  console.log("PUBLISHED READS AWAITING A GRADE");
  console.log("=".repeat(62));
  if (due.length === 0) {
    console.log("Nothing due. Nothing owed.");
  } else {
    for (const r of due) {
      console.log(fmtRow(r));
      console.log(`        settles on: ${r.invalidation}${r.ref !== null ? `   ref ${r.ref}` : ""}`);
      console.log(`        due ${r.resolve_by}${r.post ? `   ${r.post}` : ""}`);
    }
    console.log(`\n${due.length} read(s) due. Pull the settling number LIVE, then:`);
    console.log(`  node scripts/resolve-reads.mjs --resolve <id> --outcome right|wrong --actual <n>`);
  }
  if (later.length) console.log(`\n(${later.length} open read(s) not due yet.)`);
  process.exit(due.length ? 1 : 0);
}

/* ------------------------------------------------------------------- bias -- */
if (has("--bias")) {
  const resolved = rows.filter((r) => r.status === "resolved");
  const wrong = resolved.filter((r) => r.outcome === "wrong");

  console.log("READ ACCURACY — DIRECTION OF ERROR");
  console.log("=".repeat(62));
  console.log(`logged ${rows.length}   resolved ${resolved.length}   open ${rows.filter(r=>r.status==="open").length}`);

  if (resolved.length === 0) {
    console.log("\nNothing resolved yet. No claim available.");
    process.exit(0);
  }

  const pct = (n, d) => (d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(0).padStart(3)}%`);
  console.log(`\noverall right: ${resolved.length - wrong.length}/${resolved.length}  (${pct(resolved.length - wrong.length, resolved.length)})`);

  console.log("\nBY READ DIRECTION");
  for (const d of ["fade", "continuation", "neutral"]) {
    const sub = resolved.filter((r) => r.direction === d);
    if (!sub.length) continue;
    const bad = sub.filter((r) => r.outcome === "wrong").length;
    console.log(`  ${d.padEnd(13)} ${sub.length - bad}/${sub.length} right  (${pct(sub.length - bad, sub.length)})`);
  }

  console.log("\nWHEN WRONG, WHICH WAY");
  const buckets = {};
  for (const r of wrong) buckets[r.error_direction] = (buckets[r.error_direction] || 0) + 1;
  if (!wrong.length) console.log("  no misses on record");
  for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${String(v).padStart(3)}  (${pct(v, wrong.length)} of misses)`);
  }

  console.log("\n" + "-".repeat(62));
  if (resolved.length < MIN_SAMPLE) {
    console.log(`SAMPLE TOO SMALL. ${resolved.length} resolved, ${MIN_SAMPLE} needed before this`);
    console.log("means anything. Do NOT correct off these numbers — over-correcting");
    console.log("off a handful of rows just builds the opposite bias just as blind.");
  } else {
    const top = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / wrong.length >= 0.65) {
      console.log(`LEAN: ${top[1]} of ${wrong.length} misses are "${top[0]}".`);
      console.log("That is a direction worth testing against the tape, not a rule yet.");
    } else {
      console.log("No dominant direction of error. Misses look scattered, which is");
      console.log("what an unbiased read process is supposed to look like.");
    }
  }
  process.exit(0);
}

/* ------------------------------------------------------------------- list -- */
const all = has("--all");
const show = all ? rows : rows.filter((r) => r.status === "open");
console.log(all ? "ALL READS" : "OPEN READS  (--all for everything)");
console.log("=".repeat(62));
if (!show.length) console.log("  (none)");
for (const r of show) {
  console.log(fmtRow(r));
  if (r.status === "resolved") {
    console.log(`        ${r.outcome.toUpperCase()}${r.actual !== null ? ` at ${r.actual}` : ""}${r.error_direction ? ` — ${r.error_direction}` : ""}`);
  }
}
process.exit(0);
