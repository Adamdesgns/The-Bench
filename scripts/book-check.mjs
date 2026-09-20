// book-check.mjs — find calls that were made somewhere and never logged.
//
//   node scripts/book-check.mjs
//   node scripts/book-check.mjs --days 14 --window 1
//
// The two surfaces default to Adam's machine (Windows Obsidian vault, sibling
// x-poster clone). Anywhere else, point at them:
//   BENCH_VAULT_DAILY=/path/to/Daily  BENCH_POSTED_DIR=/path/to/x-poster/posted
//   BENCH_ARCHIVE=/path/to/archive.json   (tests only; the book is db/archive.json)
//
// EXIT CODES
//   0  clean - every mention scanned has a row near its date
//   1  gaps - calls were made somewhere and never logged
//   2  SURFACES NOT MOUNTED - neither directory exists, nothing was scanned
//
// WHY EXIT 2 EXISTS (2026-09-10 survey, Task 3): on a GitHub / cloud clone
// neither surface is present. The script scanned zero files, found zero
// mentions, and printed "No gaps." with exit 0 - the book-is-complete answer,
// produced from nothing. Zero surfaces is its own answer now, and a single
// missing surface is labelled PARTIAL so "clean" is never read as "complete".
//
// Sibling of tools/vault-check. Read-only, zero-dep. vault-check verifies the
// vault's git claims against real repos; this verifies the book against every
// place a call actually gets made:
//
//   - the Obsidian vault's Daily/ notes
//   - x-poster's posted/ (a published call with no book row is the worst case,
//     because it is public and unrecorded)
//
// PER-CALL, not per-ticker. v1 asked only whether a ticker appeared anywhere in
// the book, which gave false confidence: AMD was passed on 2026-08-04 and never
// logged, but the next morning's routine wrote an AMD row for 08-05 and the
// ticker read as covered. A mention now has to match a row NEAR ITS OWN DATE.
//
// Exit 1 when gaps are found, so it can gate a session-start ritual.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";

import { ROOT } from "../server/config.js";
import { cashtags, findGaps } from "../server/bookCheck.js";

const envPath = (name, fallback) => {
  const v = (process.env[name] || "").trim();
  return v ? resolve(v) : fallback;
};
const ARCHIVE = envPath("BENCH_ARCHIVE", resolve(ROOT, "db/archive.json"));
const POSTED = envPath("BENCH_POSTED_DIR", resolve(ROOT, "../x-poster/posted"));
const DAILY = envPath("BENCH_VAULT_DAILY", "C:\\Users\\steam\\Documents\\kepano-obsidian\\Daily");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};
const DAYS = flag("--days", 30);
const WINDOW = flag("--window", 1);

const dateOf = (path) => {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(basename(path));
  return m ? m[1] : null;
};

function recentFiles(dir, days) {
  if (!existsSync(dir)) return [];
  const cutoff = Date.now() - days * 86400000;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
    .map((f) => join(dir, f))
    .filter((p) => {
      const d = dateOf(p);
      return d ? new Date(d).getTime() >= cutoff : false;
    });
}

const rows = JSON.parse(readFileSync(ARCHIVE, "utf8"));

const SURFACES = [
  ["vault", DAILY, "BENCH_VAULT_DAILY"],
  ["published", POSTED, "BENCH_POSTED_DIR"],
];
const mounted = SURFACES.filter(([, dir]) => existsSync(dir));
const missing = SURFACES.filter(([, dir]) => !existsSync(dir));

console.log(`book-check — surfaces:`);
for (const [label, dir] of mounted) console.log(`  ${label.padEnd(9)} mounted      ${dir}`);
for (const [label, dir, env] of missing) {
  console.log(`  ${label.padEnd(9)} NOT MOUNTED  ${dir}   (set ${env} to point at it)`);
}
console.log("");

if (mounted.length === 0) {
  console.log("SURFACES NOT MOUNTED. Nothing was scanned, so nothing can be said about gaps.");
  console.log("This is not a clean book - it is a clone that cannot see where calls are made.");
  console.log("Run this where the vault and x-poster live, or set the env paths above.");
  process.exit(2);
}

const partial = missing.length > 0;
if (partial) {
  console.log(
    `PARTIAL: ${missing.map(([l]) => l).join(", ")} not mounted - ` +
      `a clean result below covers ${mounted.map(([l]) => l).join(", ")} only.\n`
  );
}

// Every ticker-day a call could have been made on.
const mentions = [];
for (const [label, dir] of mounted) {
  for (const file of recentFiles(dir, DAYS)) {
    const date = dateOf(file);
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const ticker of cashtags(text)) {
      mentions.push({ ticker, date, where: `${label}: ${basename(file)}` });
    }
  }
}

const gaps = findGaps(mentions, rows, WINDOW);

console.log(
  `book-check — ${rows.length} rows, ${mentions.length} ticker-days seen ` +
    `over the last ${DAYS} days (±${WINDOW}d window)\n`
);

if (gaps.length === 0) {
  console.log(
    partial
      ? `No gaps on the ${mounted.map(([l]) => l).join(", ")} surface(s) - PARTIAL, ` +
          `${missing.map(([l]) => l).join(", ")} was not scanned.`
      : "No gaps. Every ticker-day mentioned has a book row near that date."
  );
  process.exit(0);
}

console.log(`${gaps.length} call(s) mentioned but not logged near that date:\n`);
for (const g of gaps) {
  const nearest = g.nearest
    ? `nearest row for $${g.ticker} is ${g.nearest} — logged, but not for this day`
    : `no $${g.ticker} row at all`;
  console.log(`  $${g.ticker}  on ${g.date}`);
  console.log(`      ${nearest}`);
  for (const w of [...new Set(g.where)].slice(0, 3)) console.log(`      ${w}`);
  console.log("");
}

console.log(
  "A mention is not always a call — benchmarks and placeholders are filtered, but a\n" +
    "name discussed in passing will still appear. Log the ones that were calls:\n\n" +
    "  node scripts/log-call.mjs --ticker XXXX --type pass --date YYYY-MM-DD --price 0 --call \"...\"\n"
);
process.exit(1);
