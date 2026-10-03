// log-read.mjs — append a PUBLISHED READ to db/reads.json, at the moment it is published.
//
//   node scripts/log-read.mjs --date 2026-09-02 --slot 14:07 \
//        --claim "Not chasing DELL at 467.04" \
//        --direction fade --invalidation "close above 467.04" \
//        --resolve-by 2026-09-02 --ref 467.04 --ticker DELL --scope name \
//        --post https://x.com/i/status/2095228531055743127
//
// Exit codes: 0 = written   2 = bad input
//
// WHY THIS EXISTS (2026-09-02).
// The book (db/archive.json) tracks POSITION calls — B-rows on tickers. It does
// not track the READS the daily posts actually make: "the tape is treating
// Dell's backlog as Dell's revenue", "I am not chasing 467", "the move has to
// beat the price of the move". Those are the claims that go on the timeline six
// times a day, and until today nothing recorded them anywhere gradeable.
//
// The consequence, measured on 2026-09-02: 251 book rows, 251 carrying a grade
// made BEFORE the call, and FIVE carrying a resolved outcome. Two percent. The
// system is excellent at scoring a call in advance and almost never scores one
// afterwards. Reads did worse than that — they had no ledger at all, so the only
// way a miss ever got graded was a later routine hand-reading the previous
// slot's .txt file out of queue\. That works exactly as long as someone
// remembers to look, and it never accumulates.
//
// On 2026-09-02 three published reads all missed in the same direction. Nobody
// could say whether that was a bias or one bad Wednesday, because there was no
// table to ask. The closing-bell thread that day told readers to "grade the
// direction your misses share, not each miss alone" — advice the pipeline that
// published it could not follow.
//
// THE POINT OF THE direction FIELD. Every read is a bet that a move stops or a
// bet that it continues. Record which, and a wrong read tells you WHICH WAY you
// were wrong, not just that you were. Fifty rows in, "am I systematically
// fading strength?" is a number instead of an anecdote. That is the whole
// design; everything else here is bookkeeping.
//
// A read is not logged until this echoes a row id. Same standing rule as
// log-call.mjs (Adam, 2026-08-04): if a run mentions it, a script records it.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = resolve(HERE, "../db/reads.json");

const DIRECTIONS = ["fade", "continuation", "neutral"];
const SCOPES = ["name", "layer", "market"];

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

function die(msg) {
  console.error(`log-read: ${msg}`);
  process.exit(2);
}

function isDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(s));
}

if (has("--help") || argv.length === 0) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
    .split("\n").filter((l) => l.startsWith("//")).slice(0, 9).join("\n"));
  process.exit(0);
}

const date = val("--date");
const slot = val("--slot");
const claim = val("--claim");
const direction = (val("--direction") || "").toLowerCase();
const invalidation = val("--invalidation");
const resolveBy = val("--resolve-by");
const scope = (val("--scope") || "name").toLowerCase();

if (!isDate(date)) die("--date is required, YYYY-MM-DD");
if (!slot || !/^\d{1,2}:\d{2}$/.test(slot)) die("--slot is required, HH:MM CT");
if (!claim || claim.trim().length < 8) die("--claim is required and must be a real sentence");
if (!DIRECTIONS.includes(direction)) die(`--direction must be one of: ${DIRECTIONS.join(" | ")}`);
if (!SCOPES.includes(scope)) die(`--scope must be one of: ${SCOPES.join(" | ")}`);
if (!invalidation || invalidation.trim().length < 4) {
  die("--invalidation is required. A read with no stated invalidation cannot be graded, " +
      "which is the exact defect this ledger exists to stop. Name the condition.");
}
if (!isDate(resolveBy)) die("--resolve-by is required, YYYY-MM-DD — when this becomes gradeable");
if (resolveBy < date) die(`--resolve-by ${resolveBy} is before --date ${date}`);

const ledger = existsSync(LEDGER)
  ? JSON.parse(readFileSync(LEDGER, "utf8"))
  : { schema: 1, rows: [] };
if (!Array.isArray(ledger.rows)) die("db/reads.json is malformed: rows is not an array");

const nextId = `R-${String(ledger.rows.length + 1).padStart(3, "0")}`;

const refRaw = val("--ref");
const row = {
  id: nextId,
  date,
  slot,
  scope,
  ticker: (val("--ticker") || "").toUpperCase() || null,
  claim: claim.trim(),
  direction,
  invalidation: invalidation.trim(),
  resolve_by: resolveBy,
  ref: refRaw === undefined ? null : Number(refRaw),
  post: val("--post") || null,
  source: val("--source") || "claude",
  status: "open",
  outcome: null,
  error_direction: null,
  actual: null,
  note: val("--note") || "",
  logged_at: new Date().toISOString(),
  resolved_at: null,
};

if (row.ref !== null && Number.isNaN(row.ref)) die(`--ref is not a number: ${refRaw}`);

if (has("--dry-run")) {
  console.log(JSON.stringify(row, null, 2));
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

ledger.rows.push(row);
writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n", "utf8");

console.log(`${row.id} logged — ${row.direction.toUpperCase()} read, resolves ${row.resolve_by}`);
console.log(`  claim:        ${row.claim}`);
console.log(`  invalidation: ${row.invalidation}`);
console.log(`\nGrade it with:  node scripts/resolve-reads.mjs --resolve ${row.id} --outcome right|wrong --actual <price>`);
