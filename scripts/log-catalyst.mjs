// log-catalyst.mjs — put a dated catalyst on the board, with a type and a provenance.
//
//   node scripts/log-catalyst.mjs --ticker ZYME --type pdufa --date 2026-08-25 \
//     --what "Supplemental approval decision; milestone = 12% of cap" \
//     --confidence confirmed --source "https://www.fda.gov/..." \
//     --action "post-decision only; a rejection gaps through any stop"
//
//   node scripts/log-catalyst.mjs --list
//   node scripts/log-catalyst.mjs --list --type readout
//   node scripts/log-catalyst.mjs --dry-run ...        validate, write nothing
//
// WHY THIS EXISTS
// --------------
// On 2026-08-19 MRNA rose +120% in one session on its first positive Phase 3
// readout. The book never had a chance: db/catalysts.json held twelve earnings
// dates and one PDUFA, and nothing was watching for clinical readouts at all
// (B-150). log-call.mjs refuses a call it cannot score later. Nothing played
// that role for catalysts, so the board drifted into being an earnings calendar.
//
// This refuses what it cannot act on later:
//   - a catalyst with no --type                    (the MRNA hole: no category, no coverage)
//   - readout / pdufa / adcomm with no --source    (clinical dates are the ones we would
//                                                   otherwise half-remember and get wrong)
//   - any catalyst with no --confidence
//   - confidence=window with no --window-end       (a "window" with no end is a rumour)
//   - a past date without --backfill               (so the board stays forward-looking)
//
// A refusal is the guard working, not an error to route around.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../server/config.js";

const FILE = resolve(ROOT, "db/catalysts.json");

const TYPES = {
  earnings: "scheduled earnings report",
  readout:  "clinical trial topline / data readout",
  pdufa:    "FDA decision date (PDUFA)",
  adcomm:   "FDA advisory committee meeting",
  macro:    "scheduled macro release (FOMC, CPI, PCE, payrolls...)",
  lockup:   "IPO lockup expiry / float expansion",
  index:    "index inclusion, deletion or rebalance",
  product:  "product launch, keynote, delivery or sales number",
  legal:    "court verdict, regulatory or antitrust decision",
  guidance: "investor day, analyst day or guidance update",
  other:    "anything else — say what in --what",
};
const CONFIDENCE = ["confirmed", "expected", "window"];
// These move most violently and are the ones a book invents dates for.
const SOURCE_REQUIRED = ["readout", "pdufa", "adcomm"];

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []);
const save = (rows) => writeFileSync(FILE, JSON.stringify(rows, null, 2) + "\n", "utf8");
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const today = () => new Date().toISOString().slice(0, 10);

// ---- --list ------------------------------------------------------------------
if (has("--list")) {
  const filter = val("--type");
  let rows = load();
  if (filter) rows = rows.filter((r) => r.type === filter);
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));

  const upcoming = rows.filter((r) => r.date >= today());
  console.log(`${rows.length} catalyst(s)${filter ? ` of type ${filter}` : ""}, ${upcoming.length} upcoming\n`);
  console.log("DATE        TYPE      CONF       TICKER  WHAT");
  for (const r of rows) {
    const past = r.date < today() ? " " : "*";
    console.log(
      past +
        r.date.padEnd(11) +
        (r.type ?? "—").padEnd(10) +
        (r.confidence ?? "—").padEnd(11) +
        (r.ticker ?? "—").padEnd(8) +
        (r.what ?? r.label ?? "").slice(0, 70),
    );
  }
  console.log("\n* = upcoming.  Untyped rows predate log-catalyst.mjs and should be backfilled.");

  const byType = {};
  for (const r of rows) byType[r.type ?? "UNTYPED"] = (byType[r.type ?? "UNTYPED"] ?? 0) + 1;
  console.log("\ncoverage:", Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(" · "));
  const missing = Object.keys(TYPES).filter((t) => !byType[t]);
  if (missing.length) console.log("NO COVERAGE AT ALL:", missing.join(", "));
  process.exit(0);
}

// ---- validate ----------------------------------------------------------------
const type = val("--type");
const date = val("--date");
const what = val("--what");
const confidence = val("--confidence");
const ticker = val("--ticker");
const source = val("--source");
const windowEnd = val("--window-end");
const action = val("--action");

const problems = [];
if (!type) problems.push(`--type is missing. One of: ${Object.keys(TYPES).join(", ")}`);
else if (!TYPES[type]) problems.push(`--type "${type}" is not a known type. One of: ${Object.keys(TYPES).join(", ")}`);
if (!isDate(date)) problems.push(`--date is missing or not YYYY-MM-DD (got ${date ?? "nothing"})`);
if (!what) problems.push("--what is missing — say what actually happens on the date");
if (!confidence) problems.push(`--confidence is missing. One of: ${CONFIDENCE.join(", ")}`);
else if (!CONFIDENCE.includes(confidence)) problems.push(`--confidence "${confidence}" is not one of: ${CONFIDENCE.join(", ")}`);
if (confidence === "window" && !isDate(windowEnd))
  problems.push("--window-end is REQUIRED when --confidence is window. A window with no end is a rumour, not a catalyst");
if (type && SOURCE_REQUIRED.includes(type) && !source)
  problems.push(`--source is REQUIRED for type "${type}" — these are the dates a book invents by accident. Give the URL or filing it came from`);
if (type && type !== "macro" && type !== "index" && !ticker)
  problems.push("--ticker is missing (only macro and index catalysts may omit it)");
if (isDate(date) && date < today() && !has("--backfill"))
  problems.push(`--date ${date} is in the past. Use --backfill if you are deliberately recording history`);

if (problems.length) {
  console.error("\nREFUSED — this catalyst cannot go on the board as written:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`
  This is the guard working, not an error to route around. The board became an
  earnings calendar because nothing enforced a type, and a +120% readout went
  unwatched as a result (B-150).
`);
  process.exit(1);
}

// ---- build -------------------------------------------------------------------
const label =
  (ticker ? `${ticker} ` : "") +
  what +
  (confidence === "window" ? ` — WINDOW ${date} to ${windowEnd}` : "") +
  (confidence === "expected" ? " — date EXPECTED, not confirmed" : "") +
  (action ? ` · ${action}` : "");

const row = { date, type, confidence, label };
if (ticker) row.ticker = ticker;
row.what = what;
if (windowEnd) row.window_end = windowEnd;
if (source) row.source = source;
if (action) row.action = action;
row.logged = today();

if (has("--dry-run")) {
  console.log("DRY RUN — nothing written:\n");
  console.log(JSON.stringify(row, null, 2));
  process.exit(0);
}

const rows = load();
const dupe = rows.find((r) => r.date === date && r.ticker === ticker && r.type === type);
if (dupe) {
  console.error(`\nREFUSED — already on the board: ${date} ${ticker ?? ""} ${type}.\n  ${dupe.label}\n`);
  process.exit(1);
}
rows.push(row);
save(rows);

console.log(`\n${date}  ${type.toUpperCase()}  ${ticker ?? "(market)"}  [${confidence}]`);
console.log(`  ${what}`);
if (source) console.log(`  source: ${source}`);
if (action) console.log(`  action: ${action}`);
console.log(`\nON THE BOARD -> ${rows.length} catalyst(s).`);
