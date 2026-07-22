// seed-archive.js — one-time / idempotent seed of db/archive.json.
//
// Source of truth for the SEED is db/archive-v4.xlsx (B-001..B-022).
// db/archive.json was seeded from that xlsx; re-run against it to regenerate.
//
// Rules honored (HANDOFF-code.md / REPO-HANDOFF.md):
//   - Never invent a Trade ID. If the sequence isn't visible, mark it
//     `Pending Archive ID`.
//   - Every seeded row is engine:"claude" (the existing book was all claude).
//   - not_observable is a required field on every row (default []).
//
// Usage:
//   node scripts/seed-archive.js            # validate current archive.json
//   node scripts/seed-archive.js --from-xlsx db/archive-v4.xlsx
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
    const mod = await import("xlsx");
    xlsx = mod.default ?? mod;
  } catch {
    throw new Error("xlsx parser not installed. Run `npm i xlsx` first, then re-run with --from-xlsx.");
  }
  const wb = xlsx.read(readFileSync(path), { type: "buffer", cellDates: true });
  const sheet = wb.Sheets["Bench Archive"] || wb.Sheets[wb.SheetNames[0]];
  // Row 1 is the title banner; the real header is on row 2 -> range: 1 (0-based).
  const raw = xlsx.utils.sheet_to_json(sheet, { defval: null, range: 1 });
  const clean = (v) => (typeof v === "string" ? (v.trim() || null) : v ?? null);
  const num = (v) => {
    const c = clean(v);
    if (c === null || c === "") return null;
    const n = Number(c);
    return Number.isFinite(n) ? n : null;
  };
  const isoDate = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return raw
    .filter((r) => clean(r["Trade ID"]))
    .map((r) => {
      let pct = num(r["% Move"]);
      if (pct !== null && Math.abs(pct) <= 1) pct = Math.round(pct * 10000) / 100; // fraction -> percent
      let date = clean(r["Date"]);
      if (date instanceof Date) date = isoDate(date);
      return {
        id: clean(r["Trade ID"]) || "Pending Archive ID",
        date,
        ticker: clean(r["Ticker"]),
        review_price: num(r["Review Price ($)"]),
        review_time: clean(r["Review Time"]),
        opportunity_score: num(r["Opportunity Score"]),
        confidence_pct: num(r["Confidence %"]),
        grades: {
          technical: clean(r["Technical"]),
          fundamental: clean(r["Fundamental"]),
          execution: clean(r["Execution"]),
          overall: clean(r["Overall"])
        },
        fomo: clean(r["FOMO Clock"]),
        market_risk: num(r["Market Risk"]),
        hodl: clean(r["HODL Status"]),
        final_call: clean(r["Final Call / Trigger"]),
        trigger: null,
        invalidation: null,
        engine: clean(r["Engine"]) || "claude",
        outcome: clean(r["Outcome"]),
        outcome_price: num(r["Outcome Price ($)"]),
        pct_move: pct,
        lesson: clean(r["Lessons Learned"]),
        grade_verdict: null,
        not_observable: []
      };
    });
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
