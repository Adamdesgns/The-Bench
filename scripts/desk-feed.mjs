// desk-feed.mjs — the names the desk touched, for the pre-pump capture's `desk` group.
//
//   node scripts/desk-feed.mjs build --date 2026-09-14 [--dry-run]
//   node scripts/desk-feed.mjs add   --date 2026-09-14 --symbols MRVL,COHR --note "screen from chat"
//
// EXIT CODES: 0 ok · 2 REFUSED (bad input, not a session, missing definition file)
//
// WHY THIS EXISTS (2026-09-12)
// ----------------------------
// The capture's 460-name core is a stratified statistical sample — the
// DENOMINATOR for a pre-pump base rate — so the names the desk actually watches
// mostly are not in it. Of 17 names on a 2026-09-11 screen, 3 were captured.
// This builds a third group, tagged `desk`, that rides beside the sample.
//
// THE RULE THAT MATTERS: desk names are chosen BECAUSE something happened to
// them. Non-random inclusion. A `desk` row never counts toward a base rate.
//
// WHAT IT REFUSES TO DO:
//  - It calls no broker tool. A token outside the known set is rejected, never
//    looked up. A chat screen that never touched disk comes in through `add`.
//  - It never writes db/archive.json. It reads tickers from the book.
//  - It does not decide instrument class. Collection stays label-free.
//
// MEASURED 2026-09-12 on 46 read files: `B` was the most frequent "ticker" at
// 135 hits, all of them book ids like B-360, so ids are stripped first. Reads
// name companies more often than tickers for 10 of 20 board names (Oracle 47,
// ORCL 9), so aliases are required. Against 2026-09-11 this catches HPE, ANET,
// SNDK, STX, WDC, SOXL, DELL, NVDA, MU, ORCL, CEG, VRT and SMCI.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCalendar, isTradingDay, shiftSessions, todayET } from "./prepump-session.mjs";

// BENCH_ROOT exists so tests and dry runs can point at a copy of the inputs.
const ROOT = process.env.BENCH_ROOT
  ? resolve(process.env.BENCH_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESK = join(ROOT, "db", "prepump", "desk");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TICK = /^[A-Z]{1,5}$/;
export const SCHEMA = "bench-desk-feed-v1";

const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

function refuse(msg) {
  console.error(`REFUSED — ${msg}`);
  process.exit(2);
}

// ---------- pure ----------

/** Book, pattern, quant and read ids look like tickers to a regex. Remove them first. */
export function stripIds(text) {
  return String(text ?? "").replace(/\b(?:B|P|QR|R)-\d+\b/g, " ");
}

/** Every ticker-shaped value under a sym/symbol/ticker key, or inside a symbols/tickers array. */
export function collectKnown(values) {
  const known = new Set();
  const note = (t) => {
    if (typeof t === "string" && TICK.test(t)) known.add(t);
  };
  const walk = (v, key = "") => {
    if (Array.isArray(v)) {
      for (const x of v) {
        if (typeof x === "string" && /^(symbols|tickers)$/i.test(key)) note(x);
        else walk(x, key);
      }
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (/^(sym|symbol|ticker)$/i.test(k)) note(x);
        walk(x, k);
      }
    }
  };
  for (const v of values) walk(v);
  return known;
}

/** Ticker mentions in prose, with line numbers. Unknown and stoplisted tokens are reported, never kept. */
export function extractTickers(text, { known, stoplist }) {
  const hits = [];
  const unknown = new Set();
  const stoplisted = new Set();
  String(text ?? "").split(/\r?\n/).forEach((raw, i) => {
    for (const m of stripIds(raw).matchAll(/\b[A-Z]{2,5}\b/g)) {
      const t = m[0];
      if (stoplist.has(t)) stoplisted.add(t);
      else if (!known.has(t)) unknown.add(t);
      else hits.push({ symbol: t, line: i + 1 });
    }
  });
  return { hits, unknown, stoplisted };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Company names -> tickers. Case-sensitive, and a name inside a longer word does not count. */
export function matchAliases(text, aliases) {
  const compiled = Object.entries(aliases).map(([name, symbol]) => [
    name,
    symbol,
    new RegExp(`(^|[^A-Za-z])${escapeRe(name)}(?![A-Za-z])`),
  ]);
  const hits = [];
  String(text ?? "").split(/\r?\n/).forEach((line, i) => {
    for (const [name, symbol, re] of compiled) if (re.test(line)) hits.push({ symbol, name, line: i + 1 });
  });
  return hits;
}

/** after < date <= through. `after` is the previous session, so a weekend feeds Monday. */
export function inWindow(date, { after, through }) {
  return typeof date === "string" && date > after && date <= through;
}

export function buildDeskFeed({ date, window, archiveRows = [], reads = [], manual = [], known, stoplist, aliases }) {
  const why = new Map();
  const add = (symbol, w) => {
    if (!why.has(symbol)) why.set(symbol, []);
    why.get(symbol).push(w);
  };

  for (const r of archiveRows) {
    if (!inWindow(r?.date, window)) continue;
    const t = String(r.ticker ?? "").trim().toUpperCase();
    if (TICK.test(t)) add(t, { source: "book", row: r.id ?? null, date: r.date });
  }

  const unknown = new Set();
  const stoplisted = new Set();
  for (const { file, text } of reads) {
    const x = extractTickers(text, { known, stoplist });
    for (const h of x.hits) add(h.symbol, { source: "read", file, line: h.line, via: "ticker" });
    for (const h of matchAliases(text, aliases)) add(h.symbol, { source: "read", file, line: h.line, via: "alias", name: h.name });
    x.unknown.forEach((t) => unknown.add(t));
    x.stoplisted.forEach((t) => stoplisted.add(t));
  }

  // A manual add is a person or a chat saying "we looked at this". It is trusted
  // past the known set; a bad symbol comes back not_found from the collector.
  for (const m of manual) {
    const t = String(m?.symbol ?? "").trim().toUpperCase();
    if (TICK.test(t)) add(t, { source: "manual", note: m.note ?? null, date: m.date ?? null });
  }

  const symbols = [...why.keys()].sort().map((symbol) => ({ symbol, why: why.get(symbol) }));
  const bySource = (s) => symbols.filter((x) => x.why.some((w) => w.source === s)).length;
  return {
    schema: SCHEMA,
    date,
    window,
    counts: { symbols: symbols.length, book: bySource("book"), read: bySource("read"), manual: bySource("manual") },
    symbols,
    rejected: { unknown: [...unknown].sort(), stoplisted: [...stoplisted].sort() },
  };
}

/** Append-only. Returns the document as written. Throws on anything that is not a ticker. */
export function appendManual(path, { date, symbols, note, addedAt }) {
  const clean = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
  if (!clean.length) throw new Error("no symbols given");
  const bad = clean.filter((s) => !TICK.test(s));
  if (bad.length) throw new Error(`not tickers: ${bad.join(", ")}`);
  const doc = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { schema: "bench-desk-manual-v1", date, adds: [] };
  for (const symbol of clean) doc.adds.push({ symbol, note: note ?? null, added_at: addedAt });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
  return doc;
}

// ---------- io ----------

function readJson(p, fallback) {
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback;
}

function requireJson(p, what) {
  if (!existsSync(p)) refuse(`${p} is missing — ${what}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function loadInputs(date, cal) {
  const window = { after: shiftSessions(date, -1, cal), through: date };
  const u = requireJson(join(ROOT, "db/prepump/universe-core.json"), "the frozen core universe");
  const archiveRows = readJson(join(ROOT, "db/archive.json"), []);
  const known = collectKnown([
    { symbols: u.symbols }, // NOT the whole file: _dropped lists names deliberately excluded from the sample
    archiveRows,
    readJson(join(ROOT, "db/watchlist.json"), []),
    readJson(join(ROOT, "db/board.json"), {}),
    readJson(join(ROOT, "db/tape.json"), {}),
    readJson(join(ROOT, "db/catalysts.json"), []),
  ]);
  const stoplist = new Set(requireJson(join(DESK, "stoplist.json"), "without it prose words become tickers").symbols);
  const aliases = requireJson(join(DESK, "aliases.json"), "without it SanDisk, Seagate and Western Digital are missed").aliases;

  const readsDir = join(ROOT, "docs/reads");
  const reads = existsSync(readsDir)
    ? readdirSync(readsDir)
        .filter((f) => f.endsWith(".md") && inWindow(f.slice(0, 10), window))
        .sort()
        .map((file) => ({ file, text: readFileSync(join(readsDir, file), "utf8") }))
    : [];

  const manual = [];
  const manualDir = join(DESK, "manual");
  if (existsSync(manualDir)) {
    for (const f of readdirSync(manualDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && inWindow(f.slice(0, 10), window)).sort()) {
      for (const a of readJson(join(manualDir, f), { adds: [] }).adds ?? []) manual.push({ ...a, date: f.slice(0, 10) });
    }
  }
  return { window, known, stoplist, aliases, archiveRows, reads, manual };
}

function cmdBuild() {
  const date = val("--date") ?? todayET();
  if (!DATE_RE.test(date)) refuse(`--date must be YYYY-MM-DD, got "${date}"`);
  const cal = loadCalendar();
  let session;
  try {
    session = isTradingDay(date, cal);
  } catch (e) {
    refuse(e.message);
  }
  if (!session) refuse(`${date} is not a trading session.`);

  const inputs = loadInputs(date, cal);
  const feed = buildDeskFeed({ date, ...inputs });
  console.log(
    `desk ${date} (window ${inputs.window.after} < d <= ${date}): ${feed.counts.symbols} symbols ` +
      `(book ${feed.counts.book}, read ${feed.counts.read}, manual ${feed.counts.manual}) from ${inputs.reads.length} read file(s), known set ${inputs.known.size}`
  );
  console.log(`  ${feed.symbols.map((s) => s.symbol).join(" ")}`);
  console.log(`  rejected: ${feed.rejected.unknown.length} unknown · stoplisted ${feed.rejected.stoplisted.join(" ") || "none"}`);
  if (has("--dry-run")) {
    console.log("  --dry-run: nothing written.");
    return;
  }
  mkdirSync(DESK, { recursive: true });
  const path = join(DESK, `${date}.json`);
  // Derived, not collected: a re-run regenerates it. The capture rows record `desk` in their own source tag.
  writeFileSync(path, JSON.stringify({ ...feed, built_at: new Date().toISOString() }, null, 2) + "\n");
  console.log(`  -> ${path}`);
}

function cmdAdd() {
  const date = val("--date") ?? todayET();
  if (!DATE_RE.test(date)) refuse(`--date must be YYYY-MM-DD, got "${date}"`);
  const raw = val("--symbols");
  if (!raw) refuse("--symbols is required, comma-separated");
  try {
    const doc = appendManual(join(DESK, "manual", `${date}.json`), {
      date,
      symbols: raw.split(","),
      note: val("--note"),
      addedAt: new Date().toISOString(),
    });
    console.log(`manual ${date}: ${doc.adds.length} add(s) on file -> ${join(DESK, "manual", `${date}.json`)}`);
  } catch (e) {
    refuse(e.message);
  }
}

function main() {
  if (cmd === "build") return cmdBuild();
  if (cmd === "add") return cmdAdd();
  refuse(`unknown command "${cmd ?? ""}". Use: build | add`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
