// macro-sync.mjs — pull the BLS release calendar straight from the agency.
//
//   node scripts/macro-sync.mjs                 show what would change
//   node scripts/macro-sync.mjs --write         upsert into db/catalysts.json
//   node scripts/macro-sync.mjs --all           every BLS release, not just the movers
//   node scripts/macro-sync.mjs --json          machine-readable
//
// EXIT CODE: 0 = board already matches the agency · 1 = drift found.
//
// WHY THIS EXISTS
// ---------------
// Before 2026-08-19 the catalyst board had ZERO macro rows on a book concentrated
// in semis and China ADRs — no CPI, no FOMC, no payrolls, no quarter-end. The
// dates were added by hand that day, which is fine once and unmaintainable forever.
//
// BLS publishes its whole schedule as an .ics: exact dates, exact release times,
// through the end of the year, in one fetch. It is deterministic agency data, so
// unlike a PDUFA date there is no judgement to apply — which is why this one is
// allowed to --write directly, where pdufa-sweep only proposes.
//
// LIMITS, stated because the gap matters:
//   - BLS ONLY. CPI, PPI, payrolls, JOLTS, ECI, productivity. That is it.
//   - NOT covered here: FOMC (Federal Reserve), PCE and GDP (BEA), retail sales
//     and housing (Census), ISM. Those were hand-added and stay hand-maintained
//     until someone wires their feeds too.
//   - BLS 403s a direct fetch, so this goes through Jina Reader, which means an
//     upstream dependency and a rate limit that is not ours.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../server/config.js";

const FILE = resolve(ROOT, "db/catalysts.json");
const ICS = "https://r.jina.ai/https://www.bls.gov/schedule/news_release/bls.ics";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

// The releases that actually move a tape. Everything else is noise for this book.
// `re` matches the BLS calendar's own wording. `alias` matches the short form a
// human types into a hand-written row ("CPI (August)"), which is what the board
// was seeded with on 2026-08-19 — without it, every sync would duplicate them.
const MOVERS = [
  { re: /consumer price index/i,            alias: /\bCPI\b/i,                        name: "CPI" },
  { re: /producer price index/i,            alias: /\bPPI\b/i,                        name: "PPI" },
  { re: /employment situation/i,            alias: /payroll|employment situation|\bNFP\b/i, name: "EMPLOYMENT SITUATION (non-farm payrolls)" },
  { re: /job openings and labor turnover/i, alias: /\bJOLTS\b/i,                      name: "JOLTS" },
  { re: /employment cost index/i,           alias: /\bECI\b/i,                        name: "ECI" },
  { re: /^real earnings/i,                  alias: /real earnings/i,                   name: "Real Earnings" },
];

const today = new Date().toISOString().slice(0, 10);

let raw;
try {
  const res = await fetch(ICS, { headers: { "User-Agent": "THE BENCH research tool" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  raw = await res.text();
} catch (e) {
  console.error(`\nBLS calendar fetch failed: ${e.message}`);
  console.error("Nothing written. A fetch failure is NOT 'no releases scheduled' — do not read it that way.\n");
  process.exit(2);
}

// ICS folds long lines with a leading space or tab. Unfold before parsing.
const unfolded = raw.replace(/\r?\n[ \t]/g, "");
const events = [];
for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
  const summary = (block.match(/^SUMMARY:(.*)$/m) || [])[1]?.trim();
  const dt = (block.match(/^DTSTART[^:]*:(\d{8})T?(\d{2})?(\d{2})?/m) || []);
  if (!summary || !dt[1]) continue;
  const date = `${dt[1].slice(0, 4)}-${dt[1].slice(4, 6)}-${dt[1].slice(6, 8)}`;
  const time = dt[2] ? `${dt[2]}:${dt[3] ?? "00"} ET` : null;
  events.push({ date, time, summary });
}

const wanted = events
  .filter((e) => e.date >= today)
  .filter((e) => has("--all") || MOVERS.some((m) => m.re.test(e.summary)))
  .sort((a, b) => (a.date < b.date ? -1 : 1));

const board = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
const label = (e) => {
  const hit = MOVERS.find((m) => m.re.test(e.summary));
  return `${hit ? hit.name + " — " : ""}${e.summary}${e.time ? `, ${e.time}` : ""}`;
};

// Dedupe two ways: against our own provenance stamp, AND against hand-added rows
// that describe the same release in prose. The macro spine was typed in by hand on
// 2026-08-19 before this script existed, so a stamp-only check would duplicate every
// one of those rows the first time this ran.
const macroRows = board.filter((c) => c.type === "macro");
const alreadyThere = (e) => {
  const hit = MOVERS.find((m) => m.re.test(e.summary));
  return macroRows.some((c) => {
    if (c.date !== e.date) return false;
    if (c.bls_release && hit && c.bls_release === hit.name) return true;
    const text = `${c.what ?? ""} ${c.label ?? ""}`;
    if (!hit) return false;
    return hit.re.test(text) || hit.alias.test(text);
  });
};
const toAdd = wanted.filter((e) => !alreadyThere(e));

if (has("--json")) {
  console.log(JSON.stringify({ parsed: events.length, in_scope: wanted.length, new: toAdd.map((e) => ({ ...e, label: label(e) })) }, null, 2));
  process.exit(toAdd.length ? 1 : 0);
}

console.log(`\nMACRO SYNC — BLS release calendar\n${"=".repeat(58)}`);
console.log(`${events.length} events parsed · ${wanted.length} upcoming in scope · ${toAdd.length} not on the board\n`);

for (const e of toAdd.slice(0, 40)) console.log(`  ${e.date}  ${label(e)}`);
if (toAdd.length > 40) console.log(`  ... and ${toAdd.length - 40} more`);

if (has("--write") && toAdd.length) {
  for (const e of toAdd) {
    const hit = MOVERS.find((m) => m.re.test(e.summary));
    board.push({
      date: e.date, type: "macro", confidence: "confirmed",
      what: label(e),
      label: label(e),
      source: "US Bureau of Labor Statistics official release calendar (bls.gov/schedule/news_release/bls.ics), synced automatically by scripts/macro-sync.mjs. BLS 403s a direct fetch so this is read through Jina Reader.",
      bls_release: hit?.name ?? e.summary,
      verified_by: `macro-sync.mjs ${today}`,
      logged: today,
    });
  }
  writeFileSync(FILE, JSON.stringify(board, null, 2) + "\n", "utf8");
  console.log(`\nWROTE ${toAdd.length} macro row(s).`);
} else if (toAdd.length) {
  console.log("\nNothing written. Re-run with --write to add them.");
}

console.log("\nNOT COVERED by this feed — still hand-maintained: FOMC (Federal Reserve), PCE and GDP (BEA), retail sales and housing (Census), ISM.\n");
process.exit(toAdd.length ? 1 : 0);
