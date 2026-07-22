// seed-archive.js — one-time / idempotent seed of db/archive.json.
//
// Source of truth for the SEED is db/archive-v3.xlsx (B-001..B-022).
// The committed db/archive.json is a PROVISIONAL hand-seed from the session
// handoff; run this against the real xlsx to replace it authoritatively.
//
// Rules honored (HANDOFF-code.md / REPO-HANDOFF.md):
//   - Never invent a Trade ID. If the sequence isn't visible, mark it
//     `Pending Archive ID`.
//   - Every seeded row is engine:"claude" (the existing book was all claude).
//   - not_observable is a required field on every row (default []).
//
// Usage:
//   node scripts/seed-archive.js            # validate current archive.json
//   node scripts/seed-archive.js --from-xlsx db/archive-v3.xlsx
//
// The xlsx path needs a parser (`npm i xlsx`). Kept out of dependencies so a
// fresh clone installs nothing it doesn't need; the script explains if missing.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARCHIVE = resolve(__dirname, "../db/archive.json");

const REQUIRED_ROW_FIELDS = [
  "id", "ticker", "engine", "not_observable"
];

function validate(rows) {
  if (!Array.isArray(rows)) throw new Error("archive.json must be an array of rows");
  const ids = new Set();
  const problems = [];
  for (const [i, row] of rows.entries()) {
    for (const f of REQUIRED_ROW_FIELDS) {
      if (!(f in row)) problems.push(`row ${i} (${row.id ?? "?"}) missing required field: ${f}`);
    }
    if (!Array.isArray(row.not_observable)) {
      problems.push(`row ${i} (${row.id ?? "?"}) not_observable must be an array`);
    }
    if (row.id) {
      if (ids.has(row.id)) problems.push(`duplicate id: ${row.id}`);
      ids.add(row.id);
    }
  }
  return problems;
}

async function fromXlsx(path) {
  if (!existsSync(path)) throw new Error(`xlsx not found: ${path}`);
  let xlsx;
  try {
    xlsx = await import("xlsx");
  } catch {
    throw new Error("xlsx parser not installed. Run `npm i xlsx` first, then re-run with --from-xlsx.");
  }
  const wb = xlsx.readFile(path);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(sheet, { defval: null });
  // Map spreadsheet columns -> archive row shape. Adjust header names to match
  // the real xlsx once it's in place. Unknown/blank ID -> "Pending Archive ID".
  return raw.map((r) => ({
    id: r.id || r.ID || r["Trade ID"] || "Pending Archive ID",
    date: r.date || r.Date || null,
    ticker: r.ticker || r.Ticker || null,
    review_price: r.review_price ?? r["Review Price"] ?? null,
    review_time: r.review_time ?? r["Review Time"] ?? null,
    opportunity_score: r.opportunity_score ?? r.Score ?? null,
    confidence_pct: r.confidence_pct ?? r["Confidence %"] ?? null,
    outcome: r.outcome ?? r.Outcome ?? null,
    outcome_price: r.outcome_price ?? null,
    pct_move: r.pct_move ?? null,
    lesson: r.lesson ?? null,
    grade_verdict: r.grade_verdict ?? null,
    engine: r.engine || "claude",
    not_observable: []
  }));
}

const args = process.argv.slice(2);
const xlsxIdx = args.indexOf("--from-xlsx");

if (xlsxIdx !== -1) {
  const path = args[xlsxIdx + 1];
  const rows = await fromXlsx(path);
  const problems = validate(rows);
  if (problems.length) {
    console.error("Seed FAILED validation:");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  if (existsSync(ARCHIVE)) copyFileSync(ARCHIVE, ARCHIVE.replace(/\.json$/, ".backup.json"));
  writeFileSync(ARCHIVE, JSON.stringify(rows, null, 2) + "\n");
  console.log(`Seeded ${rows.length} rows from ${path} -> db/archive.json (previous backed up).`);
} else {
  const rows = JSON.parse(readFileSync(ARCHIVE, "utf8"));
  const problems = validate(rows);
  if (problems.length) {
    console.error(`archive.json INVALID (${problems.length}):`);
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  const provisional = rows.filter((r) => r.provisional).length;
  console.log(`archive.json OK — ${rows.length} rows, ${rows.filter(r => r.outcome).length} closed, ${provisional} provisional.`);
}
