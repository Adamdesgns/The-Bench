// book-check.mjs — find calls that were made somewhere and never logged.
//
//   node scripts/book-check.mjs
//   node scripts/book-check.mjs --days 14
//
// Sibling of tools/vault-check. Read-only, zero-dep. vault-check verifies the
// vault's git claims against real repos; this verifies the book against every
// place a call actually gets made:
//
//   - the Obsidian vault's Daily/ notes
//   - x-poster's posted/ (a published call with no book row is the worst case,
//     because it is public and unrecorded)
//
// Exit 1 when gaps are found, so it can gate a session-start ritual.
//
// WHY: four separate calls went unlogged in one week, and every one of them was
// written down somewhere else first. The information was never missing. Only
// the row was.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

import { ROOT } from "../server/config.js";

const ARCHIVE = resolve(ROOT, "db/archive.json");
const POSTED = resolve(ROOT, "../x-poster/posted");
const DAILY = "C:\\Users\\steam\\Documents\\kepano-obsidian\\Daily";

const argv = process.argv.slice(2);
const daysArg = argv.indexOf("--days");
const DAYS = daysArg >= 0 ? Number(argv[daysArg + 1]) : 30;

// $TICKER is the reliable signal. A bare uppercase word is not — "AI", "CEO"
// and "THE" would all read as tickers and bury the real findings in noise.
const CASHTAG = /\$([A-Z]{1,5})\b/g;

// Tickers that appear constantly as market context rather than as calls.
const BENCHMARKS = new Set(["SPY", "QQQ", "DIA", "VIX", "SPX", "NDX", "IWM", "TLT", "HYG", "GLD", "USO", "BTC", "ETH"]);

// $X is a real ticker (US Steel) but in our own notes it is nearly always a
// placeholder — "$X was transferred in", "$X.XX". Ignoring it trades a rare
// true positive for a guaranteed recurring false one. If US Steel is ever
// actually called, log it by hand and this filter stops mattering.
const PLACEHOLDERS = new Set(["X", "XX", "XXX", "XXXX"]);

function cashtags(text) {
  const found = new Set();
  for (const m of text.matchAll(CASHTAG)) {
    const t = m[1];
    if (!BENCHMARKS.has(t) && !PLACEHOLDERS.has(t)) found.add(t);
  }
  return found;
}

function recentFiles(dir, days) {
  if (!existsSync(dir)) return [];
  const cutoff = Date.now() - days * 86400000;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
    .map((f) => join(dir, f))
    .filter((p) => {
      const m = /(\d{4}-\d{2}-\d{2})/.exec(p);
      return m ? new Date(m[1]).getTime() >= cutoff : false;
    });
}

const rows = JSON.parse(readFileSync(ARCHIVE, "utf8"));
const logged = new Set(rows.map((r) => String(r.ticker).toUpperCase()));

const sources = [
  ["vault daily note", recentFiles(DAILY, DAYS)],
  ["published post", recentFiles(POSTED, DAYS)],
];

const gaps = new Map(); // ticker -> Set of "where"

for (const [label, files] of sources) {
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const t of cashtags(text)) {
      if (logged.has(t)) continue;
      if (!gaps.has(t)) gaps.set(t, new Set());
      gaps.get(t).add(`${label}: ${file.split(/[\\/]/).pop()}`);
    }
  }
}

console.log(`book-check — ${rows.length} rows in the book, scanning the last ${DAYS} days\n`);

if (gaps.size === 0) {
  console.log("No gaps. Every ticker mentioned in the vault or in published posts has a book row.");
  process.exit(0);
}

console.log(`${gaps.size} ticker(s) mentioned but never logged:\n`);
for (const [ticker, where] of [...gaps].sort()) {
  console.log(`  $${ticker}`);
  for (const w of [...where].slice(0, 3)) console.log(`      ${w}`);
  if (where.size > 3) console.log(`      ...and ${where.size - 3} more`);
}

console.log(
  "\nA mention is not always a call — context and benchmarks are filtered, but a\n" +
    "name discussed in passing will still show up here. Log the ones that were\n" +
    "actually calls:\n\n" +
    "  node scripts/log-call.mjs --ticker XXXX --type pass --price 0 --call \"...\"\n"
);
process.exit(1);
