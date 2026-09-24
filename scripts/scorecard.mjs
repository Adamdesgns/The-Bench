// scorecard.mjs — the book, read back as per-setup statistics. READ-ONLY.
//
//   node scripts/scorecard.mjs                  # tables
//   node scripts/scorecard.mjs --json           # machine-readable
//   node scripts/scorecard.mjs --min-n 12       # stricter suppression
//   node scripts/scorecard.mjs --include-shadow # count shadow tests too
//
// Reads db/archive.json. Writes nothing, anywhere. Spec:
// docs/superpowers/specs/2026-09-12-attention-lane-and-scorecard-design.md

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { entries, groupStats, recordCounts, firstClosingDate, MIN_N } from "../server/scorecardStats.js";

const ROOT = process.env.BENCH_ROOT
  ? resolve(process.env.BENCH_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const minN = has("--min-n") ? Number(val("--min-n")) : MIN_N;
if (!Number.isInteger(minN) || minN < 1) {
  console.error("REFUSED — --min-n must be a whole number of at least 1");
  process.exit(2);
}

const rows = JSON.parse(readFileSync(join(ROOT, "db/archive.json"), "utf8"));
const includeShadow = has("--include-shadow");
const list = entries(rows, { includeShadow });
// The session date in New York, the repo convention (prepump-session todayET). toISOString is UTC and reads tomorrow every evening.
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const closing = firstClosingDate(rows);

// "conditional — never triggered and it ran without us" -> "never triggered and it ran without us"
const outcome = (note) => String(note ?? "(no note)").replace(/^[a-z]+ — /, "");

// withAlpha is false for every grouping that mixes call types: a right pass has
// negative alpha and a right long has positive alpha, so a pooled mean means nothing.
// Inside one call type and one outcome, alpha is the size of what that outcome cost or earned.
const DIMENSIONS = [
  { name: "call type x horizon", key: (e) => `${e.call_type ?? "(none)"} ${e.horizon}`, withAlpha: true },
  { name: "conditional calls by outcome", key: (e) => `${e.horizon} ${outcome(e.note)}`, withAlpha: true, only: (e) => e.call_type === "conditional" },
  { name: "passes by outcome", key: (e) => `${e.horizon} ${outcome(e.note)}`, withAlpha: true, only: (e) => e.call_type === "pass" },
  { name: "provenance", key: (e) => e.provenance, withAlpha: false },
  { name: "origin", key: (e) => e.origin, withAlpha: false },
  { name: "engine", key: (e) => e.engine, withAlpha: false },
  { name: "confidence band", key: (e) => e.confidence_band, withAlpha: false },
  { name: "fomo (case-normalised)", key: (e) => e.fomo, withAlpha: false },
  { name: "ticker", key: (e) => e.ticker, withAlpha: false },
  { name: "market risk", key: (e) => e.market_risk, withAlpha: false },
];

const report = {
  as_of: today,
  rows: rows.length,
  entries: list.length,
  include_shadow: includeShadow,
  min_n: minN,
  first_closing_checkpoint: closing,
  short_horizon_only: Boolean(closing) && today < closing,
  record: recordCounts(rows),
  groups: Object.fromEntries(
    DIMENSIONS.map((d) => [d.name, groupStats(d.only ? list.filter(d.only) : list, d.key, { minN, withAlpha: d.withAlpha })])
  ),
};

if (has("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const pct = (v) => (v === null ? "     -" : `${v.toFixed(1)}%`.padStart(6));
const alp = (v) => (v === null ? "      -" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`.padStart(7));

console.log(`THE BENCH SCORECARD — as of ${today}. Read-only.`);
console.log(`${rows.length} rows, ${list.length} scored checkpoint entries, shadow tests ${includeShadow ? "INCLUDED" : "excluded"}. Rates hidden below ${minN} right/wrong/flat entries.`);
if (report.short_horizon_only) {
  console.log(`HORIZON WARNING: no closing (3m) checkpoint can exist before ${closing}. Every number below is a 1-week or 1-month statistic.`);
}
console.log("");
console.log("THE RECORD, THREE WAYS - each answers a different question:");
for (const [k, v] of Object.entries(report.record)) {
  console.log(`  ${k.padEnd(34)} n=${String(v.n).padStart(4)}  ${v.right}-${v.wrong}-${v.flat}  not scorable ${v.not_scorable}  (${v.note})`);
}
for (const d of DIMENSIONS) {
  const groups = report.groups[d.name];
  const w = Math.max(22, ...groups.map((g) => g.key.length + 2));
  console.log("");
  console.log(d.name.toUpperCase() + (d.withAlpha ? "" : "  (alpha hidden: this grouping mixes call types)"));
  console.log(`  ${"group".padEnd(w)}${"real".padStart(5)}${"R".padStart(5)}${"W".padStart(5)}${"F".padStart(5)}${"NS".padStart(5)}${"win".padStart(8)}${"alpha".padStart(9)}`);
  for (const g of groups) {
    console.log(
      `  ${g.key.padEnd(w)}${String(g.real).padStart(5)}${String(g.right).padStart(5)}${String(g.wrong).padStart(5)}` +
        `${String(g.flat).padStart(5)}${String(g.not_scorable).padStart(5)}  ${pct(g.win_rate)}  ${alp(g.mean_alpha)}${g.suppressed ? "  too few" : ""}`
    );
  }
}
