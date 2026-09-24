// log-pattern.mjs — record an observed market pattern, or attach an instance.
//
//   New pattern (must be falsifiable):
//     node scripts/log-pattern.mjs --new \
//       --claim "A beat after a big run into the print gets sold" \
//       --test  "2-day post-earnings return on names up 8%+ in the prior 5 sessions"
//
//   Attach an instance (this is the part that turns a story into evidence):
//     node scripts/log-pattern.mjs --instance P-001 \
//       --ticker AMD --date 2026-08-04 --holds true \
//       --detail "+8% into the print, beat, -8% after hours" \
//       --row B-004   (optional: the book row this instance tested)
//
//   --holds false is just as important as true. A pattern that only records
//   its wins is the thing this whole system exists to not be.
//
//   --list        print every pattern with its hit rate
//   --dry-run     validate and print, write nothing
//
// Spec: docs/book-integrity-spec.md

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROOT } from "../server/config.js";
import { nyDate } from "../server/nyDate.js";
import { buildPattern, addInstance, summarise, daysSince } from "../server/patternLog.js";

const PATTERNS = resolve(ROOT, "db/patterns.json");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const load = () => (existsSync(PATTERNS) ? JSON.parse(readFileSync(PATTERNS, "utf8")) : []);
const save = (rows) => writeFileSync(PATTERNS, JSON.stringify(rows, null, 2) + "\n", "utf8");

const line = (p) => {
  const s = summarise(p);
  const rate = s.rate === null ? "  --  " : `${String(s.rate).padStart(5)}%`;
  const age = daysSince(p.first_seen, new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  return `${p.id}  ${s.status.padEnd(9)} ${rate}  ${s.held}/${s.total}  ${age === null ? "  -" : String(age).padStart(3)}d  ${p.claim.slice(0, 72)}`;
};

let patterns = load();

if (has("--list") || argv.length === 0) {
  if (!patterns.length) {
    console.log("No patterns logged yet.");
    process.exit(0);
  }
  console.log(`${patterns.length} pattern(s)\n`);
  console.log("ID     STATUS     RATE   HIT   AGE   CLAIM");
  for (const p of patterns) console.log(line(p));
  console.log("\n'proposed' means fewer than 3 instances — a coincidence with a story.");
  process.exit(0);
}

if (has("--new")) {
  const p = buildPattern(
    {
      claim: val("--claim"),
      test: val("--test"),
      why: val("--why"),
      first_seen: val("--date") ?? nyDate(),
      source: val("--source") ?? "claude",
    },
    patterns
  );
  console.log(`${p.id}  ${p.claim}`);
  console.log(`  falsified by: ${p.test}`);
  if (has("--dry-run")) {
    console.log("\n--dry-run: nothing written.");
    process.exit(0);
  }
  patterns.push(p);
  save(patterns);
  console.log(`\nLOGGED ${p.id} -> ${patterns.length} pattern(s).`);
  process.exit(0);
}

const targetId = val("--instance");
if (targetId) {
  const idx = patterns.findIndex((p) => p.id === targetId);
  if (idx < 0) {
    console.error(`No pattern ${targetId}. Run --list to see what exists.`);
    process.exit(1);
  }
  const holdsRaw = val("--holds");
  const updated = addInstance(patterns[idx], {
    ticker: val("--ticker"),
    date: val("--date") ?? nyDate(),
    detail: val("--detail"),
    row_ref: val("--row"),
    holds: holdsRaw === "true" ? true : holdsRaw === "false" ? false : undefined,
  });
  const before = patterns[idx].status;
  patterns[idx] = updated;
  const s = summarise(updated);
  console.log(`${updated.id}  ${s.held}/${s.total} held (${s.rate}%)  status: ${s.status}`);
  if (before !== s.status) console.log(`  STATUS CHANGED: ${before} -> ${s.status}`);
  if (has("--dry-run")) {
    console.log("\n--dry-run: nothing written.");
    process.exit(0);
  }
  save(patterns);
  console.log(`\nATTACHED to ${updated.id}.`);
  process.exit(0);
}

console.error("Nothing to do. Use --new, --instance <ID>, or --list.");
process.exit(1);
