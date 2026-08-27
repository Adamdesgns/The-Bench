// pdufa-sweep.mjs — ask the companies themselves what their FDA dates are.
//
//   node scripts/pdufa-sweep.mjs                  the report (last 45 days of 8-Ks)
//   node scripts/pdufa-sweep.mjs --days 90        widen the window
//   node scripts/pdufa-sweep.mjs --json           machine-readable, for a scheduled task
//   node scripts/pdufa-sweep.mjs --write          append NEW dates to db/catalysts.json
//   node scripts/pdufa-sweep.mjs --only ZYME,INO  restrict to specific tickers
//
// EXIT CODE: 0 = nothing new or changed · 1 = something needs a human.
//
// WHY THIS EXISTS
// ---------------
// There is no government PDUFA calendar. FDA confidentiality rules bar it from
// confirming an application even exists until the sponsor discloses, so EVERY
// PDUFA date in the world is company-disclosed — and lands in an 8-K first.
// EDGAR full-text search is therefore not "a" source, it is THE source.
//
// It is also the staleness detector, which is the half that actually pays.
// Checked on 2026-08-19, two of eighteen aggregator dates had slipped by three
// months (SVRA Aug 22 -> Nov 22; PRAX Sep 27 -> Dec 27) and the aggregators
// still showed the old ones. Aggregators fail in the direction that hurts: they
// keep the stale date and never retract. The company does not.
//
// This WRITES NOTHING unless --write is passed, and even then it only appends
// rows it could not find on the board. It never silently edits an existing date:
// a disagreement between the board and a filing is reported for a human, because
// deciding which one is right is judgement, not parsing.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../server/config.js";

const FILE = resolve(ROOT, "db/catalysts.json");
// SEC requires a descriptive User-Agent on every request or it returns 403.
const UA = "THE BENCH research tool (contact: steamercook@yahoo.com)";
const PHRASE = "PDUFA target action date";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const DAYS = Number(val("--days") ?? 45);
const ONLY = val("--only")?.split(",").map((t) => t.trim().toUpperCase());

const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const since = new Date(today.getTime() - DAYS * 86400000);

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const toIso = (monthName, day, year) => {
  const m = MONTHS.indexOf(monthName.toLowerCase());
  if (m < 0) return null;
  return `${year}-${String(m + 1).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, asJson = false) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: asJson ? "application/json" : "text/html" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return asJson ? res.json() : res.text();
}

// ---- 1. who disclosed a PDUFA date recently ----------------------------------
const q = encodeURIComponent(`"${PHRASE}"`);
const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=${q}&forms=8-K&startdt=${iso(since)}&enddt=${iso(today)}`;

let hits;
try {
  const j = await get(searchUrl, true);
  hits = j.hits.hits;
} catch (e) {
  console.error(`\nEDGAR search failed: ${e.message}`);
  console.error("Nothing was written. This is a fetch failure, not a finding — do not treat it as 'no new dates'.\n");
  process.exit(2);
}

// ---- 2. read each filing and pull the date out of the company's own words ----
const findings = [];
for (const h of hits) {
  const src = h._source;
  const nameField = (src.display_names || [])[0] || "";
  const ticker = (nameField.match(/\(([A-Z.\-]{1,6})\)/) || [])[1];
  if (!ticker) continue;
  if (ONLY && !ONLY.includes(ticker)) continue;

  const [accession, filename] = h._id.split(":");
  const cik = String(Number(src.ciks[0]));
  const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${filename}`;

  let text;
  try {
    const html = await get(url);
    text = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  } catch (e) {
    findings.push({ ticker, filed: src.file_date, url, error: e.message });
    await sleep(120);
    continue;
  }

  // The phrase shows up both ways: "PDUFA target action date of September 30, 2026"
  // and "August 25, 2026 U.S. PDUFA target action date". Scan a window around each hit.
  const dates = new Set();
  const re = /PDUFA|target action date/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const window = text.slice(Math.max(0, m.index - 300), m.index + 300);
    const dm = window.matchAll(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})/gi);
    for (const d of dm) { const v = toIso(d[1], d[2], d[3]); if (v) dates.add(v); }
  }

  findings.push({ ticker, filed: src.file_date, url, dates: [...dates].sort() });
  await sleep(120); // be polite to SEC
}

// ---- 3. compare against the board -------------------------------------------
const board = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
const boardPdufa = board.filter((c) => c.type === "pdufa");
const todayIso = iso(today);

const NEW = [], CHANGED = [], CONFIRMS = [], NODATE = [];
for (const f of findings) {
  if (f.error) { NODATE.push({ ...f, why: `fetch failed: ${f.error}` }); continue; }
  const future = f.dates.filter((d) => d >= todayIso);
  if (!future.length) { NODATE.push({ ...f, why: f.dates.length ? "only past dates in the filing" : "no date parsed near the phrase" }); continue; }

  // A company can run several programmes at once — BBIO carries BBP-418 (Nov 27
  // 2026) and encaleret (May 8 2027) in the SAME filing, IONS carries two. So
  // "the board's date for this ticker" is not a single value, and comparing
  // against the first row found would report a real second programme as a
  // changed date. Compare against the SET.
  const boardDates = boardPdufa.filter((c) => c.ticker === f.ticker).map((c) => c.date);
  for (const d of future) {
    if (boardDates.includes(d)) { CONFIRMS.push({ ...f, date: d, boardDate: d }); continue; }
    if (!boardDates.length) { NEW.push({ ...f, date: d }); continue; }
    // The ticker is on the board but not with THIS date. Two readings, and the
    // script must not pick one: either the date moved, or it is another
    // programme. Only a single-date-both-sides mismatch is unambiguous.
    if (boardDates.length === 1 && future.length === 1) {
      CHANGED.push({ ...f, date: d, boardDate: boardDates[0], ambiguous: false });
    } else {
      CHANGED.push({ ...f, date: d, boardDate: boardDates.join(" / "), ambiguous: true });
    }
  }
}

// ---- 4. report ---------------------------------------------------------------
const needsHuman = NEW.length + CHANGED.length;

if (has("--json")) {
  console.log(JSON.stringify({ window_days: DAYS, filings_read: findings.length, NEW, CHANGED, CONFIRMS, NODATE }, null, 2));
  process.exit(needsHuman ? 1 : 0);
}

console.log(`\nPDUFA SWEEP — 8-Ks filed ${iso(since)} to ${iso(today)}\n${"=".repeat(60)}`);
console.log(`${findings.length} filing(s) matched "${PHRASE}"\n`);

if (CHANGED.length) {
  console.log(`*** DISAGREES WITH THE BOARD (${CHANGED.length}) — this is the staleness catch ***`);
  for (const c of CHANGED) console.log(
    `  ${c.ticker}: board says ${c.boardDate}, the company's 8-K (filed ${c.filed}) says ${c.date}` +
    (c.ambiguous ? "\n    AMBIGUOUS — this ticker has multiple PDUFA dates, so this may be a SECOND PROGRAMME rather than a moved date. Read the filing." : "\n    UNAMBIGUOUS — one date each side. This is a date that moved.") +
    `\n    ${c.url}`);
  console.log("  NOT auto-corrected. Read the filing and decide — then use scripts/log-catalyst.mjs.\n");
}
if (NEW.length) {
  console.log(`NEW — disclosed but not on our board (${NEW.length}):`);
  for (const n of NEW) console.log(`  ${n.ticker}  ${n.date}   filed ${n.filed}\n    ${n.url}`);
  console.log("");
}
if (CONFIRMS.length) {
  console.log(`CONFIRMED against the filing (${CONFIRMS.length}): ${CONFIRMS.map((c) => `${c.ticker} ${c.date}`).join(" · ")}\n`);
}
if (NODATE.length) {
  console.log(`No usable date (${NODATE.length}): ${NODATE.map((n) => `${n.ticker} (${n.why})`).join(" · ")}\n`);
}

// ---- 5. optional write -------------------------------------------------------
if (has("--write") && NEW.length) {
  // The SAME date is often disclosed in several exhibits of the same filing (AXSM
  // filed one date across three), and NEW carries one entry per filing. Collapse
  // to one row per ticker+date before writing, or the board grows duplicates.
  const already = new Set(board.filter((c) => c.type === "pdufa").map((c) => `${c.ticker}|${c.date}`));
  const unique = NEW.filter((n) => {
    const k = `${n.ticker}|${n.date}`;
    if (already.has(k)) return false;
    already.add(k);
    return true;
  });
  for (const n of unique) {
    board.push({
      date: n.date, type: "pdufa", ticker: n.ticker, confidence: "confirmed",
      what: `PDUFA target action date, disclosed by the company in an 8-K filed ${n.filed}. Auto-added by pdufa-sweep.mjs — the DATE is primary-sourced; the drug, indication and payoff are NOT, and must be read from the filing before this is traded.`,
      label: `${n.ticker} PDUFA ${n.date} — auto-swept from the company's own 8-K. Detail not yet reviewed.`,
      source: `SEC EDGAR full-text search for "${PHRASE}". Company 8-K: ${n.url}`,
      action: "CALENDAR ONLY. No framework review, no grade, not a recommendation.",
      verified_by: `pdufa-sweep.mjs ${todayIso}`,
      logged: todayIso,
    });
  }
  writeFileSync(FILE, JSON.stringify(board, null, 2) + "\n", "utf8");
  console.log(`WROTE ${unique.length} new pdufa row(s) to db/catalysts.json (${NEW.length - unique.length} duplicate disclosure(s) collapsed).`);
} else if (NEW.length) {
  console.log("Nothing written. Re-run with --write to add the NEW rows.");
}

console.log("");
process.exit(needsHuman ? 1 : 0);
