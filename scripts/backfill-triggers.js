// backfill-triggers.js — propose structured trigger/invalidation levels for
// rows whose levels v17 wrote as prose.
//
//   node scripts/backfill-triggers.js            # propose only, writes nothing
//   node scripts/backfill-triggers.js --apply    # write the proposals
//
// Parsing prose blind would silently corrupt every conditional verdict, so this
// prints and stops by default. Read the table, then re-run with --apply.
//
// Spec: docs/scorecard-spec.md

import { loadArchive, writeArchive } from "../server/reconcile.js";
import { parseLevels } from "../server/triggerParse.js";
import { classifyCall } from "../server/scoring.js";

const apply = process.argv.includes("--apply");
const archive = loadArchive();

const proposals = [];
for (const row of archive) {
  if (row.trigger || row.invalidation) continue; // never overwrite what exists
  const { trigger, invalidation } = parseLevels(row.final_call);
  if (!trigger && !invalidation) continue;
  proposals.push({ row, trigger, invalidation });
}

if (!proposals.length) {
  console.log("No levels found in prose that aren't already structured.");
  process.exit(0);
}

const fmt = (t) => (t ? `${t.direction} ${t.level}` : "—");

console.log(`\n${proposals.length} proposal(s):\n`);
console.log("ID      TICK    TYPE         TRIGGER        INVALIDATION   FROM");
for (const p of proposals) {
  console.log(
    [
      String(p.row.id).padEnd(7),
      String(p.row.ticker).padEnd(7),
      classifyCall(p.row).padEnd(12),
      fmt(p.trigger).padEnd(14),
      fmt(p.invalidation).padEnd(14),
      p.row.final_call
    ].join(" ")
  );
}

if (!apply) {
  console.log(
    "\nNothing written. Check every level against the call text above, then re-run with --apply."
  );
  console.log("Conditional rows stay not_scorable until their trigger is structured — that is the honest state.");
  process.exit(0);
}

for (const p of proposals) {
  if (p.trigger) p.row.trigger = p.trigger;
  if (p.invalidation) p.row.invalidation = p.invalidation;
}
writeArchive(archive);
console.log(`\nWrote ${proposals.length} row(s). A backup of the previous archive sits beside it.`);
