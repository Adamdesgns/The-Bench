#!/usr/bin/env node
// readout-sweep.mjs — which companies have told the SEC a data event is coming?
//
//   node scripts/readout-sweep.mjs                  the report (8-Ks from the last 120 days)
//   node scripts/readout-sweep.mjs --days 60        change the window
//   node scripts/readout-sweep.mjs --only MRNA,CGEM restrict to tickers
//   node scripts/readout-sweep.mjs --json           machine-readable
//
// EXIT CODE: 0 = nothing new · 1 = new dated events a human should look at · 2 = fetch failure.
//
// WHY THIS EXISTS (2026-10-11)
// ----------------------------
// MRNA ran 154 -> 225 into its ESMO Presidential Symposium data (Sat 10/24). The
// slot was announced 9/21 and the board never heard about it: nothing swept for
// medical-meeting presentations or topline-data timing at all. pdufa-sweep.mjs
// covers FDA dates only. Adam, asked whether to track these and plan six weeks
// ahead: "yes".
//
// WHAT IT CAN AND CANNOT SEE. EDGAR full-text search reads 8-Ks and their
// exhibits. Many small and mid-cap biotechs furnish every conference notice as an
// 8-K. MRNA did NOT: its 9/21 announcement was a press release only. So this is
// half the net. The other half is the web check of db/medical-meetings.json in
// the Sunday routine (bench-weekly-catalyst). Neither half alone would have
// caught MRNA early enough.
//
// REPORT ONLY. It never writes the board. New items go to Adam / the routine, which
// logs the ones that matter with scripts/log-catalyst.mjs --type readout.

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "THE BENCH research tool (contact: steamercook@yahoo.com)";

// Searched as exact phrases. Each costs one EDGAR query.
export const PHRASES = [
  "topline data", "topline results", "late-breaking", "Presidential Symposium", "plenary session",
  "data readout", "pivotal data", "ESMO", "ASCO", "San Antonio Breast Cancer Symposium",
  "American Society of Hematology", "AACR", "AASLD", "American Heart Association",
  "World Conference on Lung Cancer", "SITC", "American Diabetes Association", "EASD", "ACC.27"
];

const MEETINGS = [
  ["ESMO", /\bESMO\b/i], ["ASCO", /\bASCO\b/i], ["ASH", /\bASH\b|American Society of Hematology/],
  ["AACR", /\bAACR\b/], ["SABCS", /SABCS|San Antonio Breast/i], ["AASLD", /\bAASLD\b|Liver Meeting/],
  ["AHA", /American Heart Association|\bAHA\b/], ["WCLC", /WCLC|World Conference on Lung/i],
  ["SITC", /\bSITC\b/], ["ADA", /American Diabetes Association/], ["EASD", /\bEASD\b/], ["ACC", /\bACC\.?\d{2}\b|American College of Cardiology/]
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const pad = (n) => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

// Pure: every date or window mentioned in a piece of text.
// Returns [{start, end, kind: "date"|"range"|"quarter"|"half", text}].
export function extractWhen(text) {
  const out = [];
  const md = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*(?:-|–|through|to)\s*(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(\d{1,2}))?,?\s+(20\d{2})/gi;
  for (const m of text.matchAll(md)) {
    const y = Number(m[5]), mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    const start = `${y}-${pad(mo)}-${pad(m[2])}`;
    if (m[4]) {
      const mo2 = m[3] ? MONTHS.indexOf(m[3].toLowerCase()) + 1 : mo;
      out.push({ start, end: `${y}-${pad(mo2)}-${pad(m[4])}`, kind: "range", text: m[0] });
    } else out.push({ start, end: start, kind: "date", text: m[0] });
  }
  const ord = { first: 1, second: 2, third: 3, fourth: 4 };
  const quarter = (q, y, t) => out.push({ start: `${y}-${pad(q * 3 - 2)}-01`, end: `${y}-${pad(q * 3)}-${lastDay(y, q * 3)}`, kind: "quarter", text: t });
  for (const m of text.matchAll(/\b(first|second|third|fourth)\s+quarter\s+(?:of\s+)?(20\d{2})/gi)) quarter(ord[m[1].toLowerCase()], Number(m[2]), m[0]);
  for (const m of text.matchAll(/\b(?:Q([1-4])\s*[-']?\s*(20\d{2})|([1-4])Q\s*(20\d{2}))/g)) quarter(Number(m[1] ?? m[3]), Number(m[2] ?? m[4]), m[0]);
  for (const m of text.matchAll(/\b(?:year-end|end of)\s+(20\d{2})/gi)) quarter(4, Number(m[1]), m[0]);
  const half = (h, y, t) => out.push({ start: `${y}-${h === 1 ? "01" : "07"}-01`, end: `${y}-${h === 1 ? "06-30" : "12-31"}`, kind: "half", text: t });
  for (const m of text.matchAll(/\b(first|second)\s+half\s+(?:of\s+)?(20\d{2})/gi)) half(m[1].toLowerCase() === "first" ? 1 : 2, Number(m[2]), m[0]);
  for (const m of text.matchAll(/\b(?:([12])H|H([12]))\s*(20\d{2})/g)) half(Number(m[1] ?? m[2]), Number(m[3]), m[0]);
  return out;
}

// Pure: the data events inside one filing's text. Only windows around an event
// word count, so a fiscal-year date in a financial table never becomes a "readout".
export function findEvents(text, today) {
  const events = [];
  const seen = new Set();
  const re = /topline|top-line|late-breaking|Presidential Symposium|plenary|data readout|pivotal|oral presentation|will present|to be presented|ESMO|ASCO|ASH\b|American Society of Hematology|AACR|SABCS|AASLD|American Heart Association|WCLC|SITC|American Diabetes Association|EASD/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    // The regex is case-insensitive for prose cues; the hematology meeting must
    // be the capitalised acronym, or every "cash" in a 10-Q reads as ASH.
    if (/^ash$/i.test(m[0]) && m[0] !== "ASH") continue;
    const win = text.slice(Math.max(0, m.index - 250), m.index + 350);
    const meeting = (MEETINGS.find(([, r]) => r.test(win)) || [])[0] || null;
    for (const w of extractWhen(win)) {
      if (w.end < today) continue;
      // A bare quarter-end date is a balance-sheet column ("June 30, December 31,
      // 2026"), not an event. Losing the rare real one is cheaper than the noise.
      if (w.kind === "date" && /-(03-31|06-30|09-30|12-31)$/.test(w.start)) continue;
      if (Date.parse(w.start) - Date.parse(today) > 400 * 86400000) continue;
      const key = `${w.start}|${w.end}|${meeting}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ...w, meeting, cue: m[0], snippet: win.slice(150, 450).trim() });
    }
  }
  // A dated event beats a quarter beats a half for the same meeting; keep all, sorted precise-first.
  const rank = { date: 0, range: 1, quarter: 2, half: 3 };
  return events.sort((a, b) => rank[a.kind] - rank[b.kind] || a.start.localeCompare(b.start));
}

// ---- run ---------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const DAYS = Number(val("--days") ?? 120);
  const ONLY = val("--only")?.split(",").map((t) => t.trim().toUpperCase());
  const iso = (d) => d.toISOString().slice(0, 10);
  const now = new Date();
  const today = iso(new Date(now.getTime() - 5 * 3600000));
  const since = iso(new Date(now.getTime() - DAYS * 86400000));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = async (url, json) => {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: json ? "application/json" : "text/html" } });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return json ? res.json() : res.text();
  };

  // Names we care about first: the base-rate universe, the board, the watchlist.
  const watched = new Set();
  const tryJson = (p) => { try { return JSON.parse(readFileSync(resolve(ROOT, p), "utf8")); } catch { return null; } };
  const uni = tryJson("db/prepump/universe-core.json");
  for (const s of (uni?.symbols || [])) watched.add(s.symbol);
  for (const w of (tryJson("db/watchlist.json") || [])) watched.add(w.sym);
  const boardJ = tryJson("db/board.json");
  for (const t of JSON.stringify(boardJ || {}).match(/"([A-Z]{1,5})"/g) || []) watched.add(t.replace(/"/g, ""));

  // 1. Who mentioned a data event, by filing.
  const filings = new Map();
  for (const p of PHRASES) {
    try {
      const j = await get(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${p}"`)}&forms=8-K&startdt=${since}&enddt=${today}`, true);
      for (const h of j.hits.hits) {
        const src = h._source;
        const ticker = (((src.display_names || [])[0] || "").match(/\(([A-Z.\-]{1,6})\)/) || [])[1];
        if (!ticker || (ONLY && !ONLY.includes(ticker))) continue;
        const prev = filings.get(h._id);
        if (prev) prev.phrases.push(p);
        else filings.set(h._id, { id: h._id, ticker, cik: String(Number(src.ciks[0])), filed: src.file_date, phrases: [p] });
      }
    } catch (e) {
      console.error(`EDGAR search failed on "${p}": ${e.message}\nThis is a fetch failure, not a finding - do not treat it as "nothing new".`);
      process.exit(2);
    }
    await sleep(150);
  }

  // 2. Read each filing once, newest first, and pull the dated events out.
  const byTicker = new Map();
  const list = [...filings.values()].sort((a, b) => b.filed.localeCompare(a.filed));
  for (const f of list) {
    const [accession, file] = f.id.split(":");
    const url = `https://www.sec.gov/Archives/edgar/data/${f.cik}/${accession.replace(/-/g, "")}/${file}`;
    let text;
    try {
      text = (await get(url)).replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#8211;|&ndash;/g, "-").replace(/\s+/g, " ");
    } catch { await sleep(120); continue; }
    const events = findEvents(text, today);
    await sleep(120);
    if (!events.length) continue;
    const t = byTicker.get(f.ticker) || { ticker: f.ticker, watched: watched.has(f.ticker), events: [], filings: [] };
    t.filings.push({ filed: f.filed, url });
    for (const e of events) if (!t.events.some((x) => x.start === e.start && x.end === e.end)) t.events.push({ ...e, filed: f.filed, url });
    byTicker.set(f.ticker, t);
  }

  // 3. Against the board: is there already a readout row for this ticker in the window?
  const board = existsSync(resolve(ROOT, "db/catalysts.json")) ? JSON.parse(readFileSync(resolve(ROOT, "db/catalysts.json"), "utf8")) : [];
  const onBoard = (tk, e) => board.some((c) => c.ticker === tk && ["readout", "adcomm", "pdufa"].includes(c.type) && c.date <= e.end && (c.window_end || c.date) >= e.start);
  const NEW = [], KNOWN = [];
  for (const t of byTicker.values()) {
    for (const e of t.events) (onBoard(t.ticker, e) ? KNOWN : NEW).push({ ticker: t.ticker, watched: t.watched, ...e });
  }
  const precision = { date: 0, range: 0, quarter: 1, half: 2 };
  const order = (a, b) => (b.watched - a.watched) || (precision[a.kind] - precision[b.kind]) || a.start.localeCompare(b.start);
  NEW.sort(order); KNOWN.sort(order);

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ today, window_days: DAYS, filings_read: list.length, NEW, KNOWN }, null, 2));
    process.exit(NEW.length ? 1 : 0);
  }

  const line = (e) => `  ${e.start}${e.end !== e.start ? ".." + e.end : ""}`.padEnd(26) + ` ${e.ticker.padEnd(6)} ${(e.meeting || e.cue).slice(0, 18).padEnd(18)} [${e.kind}] filed ${e.filed}\n      "${e.snippet.slice(0, 160)}"\n      ${e.url}`;
  console.log(`\nREADOUT SWEEP - ${today}, 8-Ks from the last ${DAYS} days, ${list.length} filings read\n${"=".repeat(64)}`);
  const w = NEW.filter((e) => e.watched), o = NEW.filter((e) => !e.watched);
  console.log(`\nNEW ON NAMES WE WATCH (universe, board, watchlist): ${w.length}`);
  for (const e of w) console.log(line(e));
  console.log(`\nNEW ON OTHER NAMES: ${o.length}${o.length > 25 ? " (first 25 shown; --json for all)" : ""}`);
  for (const e of o.slice(0, 25)) console.log(line(e));
  console.log(`\nALREADY ON THE BOARD: ${KNOWN.length}`);
  for (const e of KNOWN) console.log(`  ${e.start} ${e.ticker} ${e.meeting || e.cue}`);
  console.log(`\nThese are PROPOSALS from the companies' own filings, never written automatically.
A quarter or half is a window, not a date: log it --confidence window --window-end.
Big companies often announce by press release only (MRNA 9/21 did), so an empty
sweep is not an empty calendar - run the db/medical-meetings.json web check too.\n`);
  process.exit(NEW.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
