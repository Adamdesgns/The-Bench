// log-call.mjs — append a call to the book, from any chat, the moment it is made.
//
//   node scripts/log-call.mjs --ticker SPCX --type pass \
//        --call "No Trade - failed reclaim into a lockup cliff" --price 125.90
//
//   --type      pass | long | conditional | hedge | bet
//   --trigger   REQUIRED for conditional   (the level the gate needs)
//   --invalid   REQUIRED for long          (where the thesis is wrong)
//   --size      REQUIRED for hedge         (shares/contracts, or it cannot be scored)
//   --max-loss  REQUIRED for bet           (dollars at risk, stated at entry)
//   --hodl      long-term lens, e.g. "Accumulate"
//   --lesson    free text
//   --source    which chat/assistant logged it (default: claude)
//   --dry-run   validate and print, write nothing
//
//   GRADES — the four-part scorecard, as FIELDS not prose:
//   --fundamental  A+..F   the business. FEEDS THE BUY ZONE (see below).
//   --technical    A+..F   the chart
//   --execution    A+..F   the trade
//   --overall      A+..F   the final call
//   --score        0-100   Opportunity Score
//   --confidence   0-100   stated directional confidence
//   --fomo         Pre-FOMO | Heating Up | Late FOMO | Post-FOMO Fade
//
// WHY THE GRADE FLAGS EXIST (added 2026-08-17): the row schema has always had a
// grades object, but this script never populated it, so every grade the
// framework produced lived only in the prose of --call. Result: 21 of 72 tickers
// carry a fundamental grade and NONE later than 2026-07-20. That made
// scripts/buy-zone.mjs impossible to build, because Accumulation gate 1 ("already
// graded B or better") could not be queried. Grade in the field or the
// accumulation lane cannot see it.
//
// Adam's standing rule, 2026-08-04: "any time we mention and run something it
// needs to be logged no matter what chat runs it." An analysis is not finished
// until this has echoed a row id.
//
// Spec: docs/book-integrity-spec.md

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROOT } from "../server/config.js";
import { buildRow, validateCall, requiredFields } from "../server/bookLog.js";

const ARCHIVE = resolve(ROOT, "db/archive.json");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f) => {
  const raw = val(f);
  return raw === undefined ? undefined : Number(raw);
};

const GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];
const grade = (f) => {
  const raw = val(f);
  if (raw === undefined) return undefined;
  const g = raw.trim().toUpperCase();
  if (!GRADES.includes(g)) {
    console.error(`REFUSED — ${f} must be one of ${GRADES.join(", ")} (got ${JSON.stringify(raw)})`);
    console.error("  A grade the scorecard cannot read is the same as no grade.");
    process.exit(1);
  }
  return g;
};

const input = {
  ticker: val("--ticker"),
  type: val("--type"),
  call: val("--call"),
  price: num("--price"),
  date: val("--date") ?? new Date().toISOString().slice(0, 10),
  review_time: val("--review-time"),
  trigger: num("--trigger"),
  invalidation: num("--invalid"),
  size: val("--size"),
  max_loss: num("--max-loss"),
  hodl: val("--hodl"),
  lesson: val("--lesson"),
  source: val("--source") ?? "claude",
  grades: {
    fundamental: grade("--fundamental"),
    technical: grade("--technical"),
    execution: grade("--execution"),
    overall: grade("--overall"),
  },
  score: num("--score"),
  confidence: num("--confidence"),
  fomo: val("--fomo"),
  now: new Date().toISOString(),
};

const problems = validateCall(input);
if (problems.length) {
  console.error("REFUSED — this call cannot be logged as written:\n");
  for (const p of problems) console.error(`  - ${p}`);
  const need = requiredFields(input.type);
  if (need.length) {
    console.error(`\n  a '${input.type}' call requires: ${need.join(", ")}`);
  }
  console.error(
    "\n  This is the guard working, not an error to route around. The book has 17\n" +
      "  unscorable checkpoints because rows like this got written anyway."
  );
  process.exit(1);
}

const rows = JSON.parse(readFileSync(ARCHIVE, "utf8"));
const row = buildRow(input, rows);

console.log(`${row.id}  ${row.ticker}  $${row.review_price}  [${row.call_type}]`);
console.log(`  call:   ${row.final_call}`);
if (row.trigger !== null) console.log(`  trigger:      ${row.trigger}`);
if (row.invalidation !== null) console.log(`  invalidation: ${row.invalidation}`);
if (row.size !== null) console.log(`  size:         ${row.size}`);
if (row.max_loss !== null) console.log(`  max loss:     $${row.max_loss}`);
if (row.hodl) console.log(`  hodl:   ${row.hodl}`);
const g = row.grades;
if (g.fundamental || g.technical || g.execution || g.overall) {
  const parts = [];
  if (g.technical) parts.push(`tech ${g.technical}`);
  if (g.fundamental) parts.push(`FUND ${g.fundamental}`);
  if (g.execution) parts.push(`exec ${g.execution}`);
  if (g.overall) parts.push(`overall ${g.overall}`);
  console.log(`  grades:       ${parts.join(" · ")}`);
}
if (row.opportunity_score !== null) console.log(`  opportunity:  ${row.opportunity_score}/100`);
if (row.confidence_pct !== null) console.log(`  confidence:   ${row.confidence_pct}%`);
if (row.fomo) console.log(`  fomo:         ${row.fomo}`);
console.log(`  logged by:    ${row.logged_by}`);

// Nudge, not a refusal: a missing fundamental grade is legitimate (a chart-only
// read, a No Trade on structure) but it silently keeps the name out of the
// accumulation lane, and that has cost this book before.
if (!g.fundamental && input.type !== "pass") {
  console.log(
    `\n  note: no --fundamental grade, so ${row.ticker} stays invisible to\n` +
      `        scripts/buy-zone.mjs and can never clear Accumulation gate 1.`
  );
}

if (has("--dry-run")) {
  console.log("\n--dry-run: book NOT written.");
  process.exit(0);
}

rows.push(row);
writeFileSync(ARCHIVE, JSON.stringify(rows, null, 2) + "\n", "utf8");
console.log(`\nLOGGED ${row.id} -> ${rows.length} rows in the book.`);
