// dead-theses.mjs — read the book back BEFORE judging a ticker.
//
//   node scripts/dead-theses.mjs --ticker AVAV            prior rows, lessons, dead triggers
//   node scripts/dead-theses.mjs --ticker AVAV --json
//   node scripts/dead-theses.mjs --ticker AVAV --all      include rows still open
//   node scripts/dead-theses.mjs --ticker X --book f.json --patterns p.json   offline test
//
// WHY THIS EXISTS (2026-09-16)
// ----------------------------
// The book already records every pass, every lesson and every falsified
// pattern. Nothing read them back. A delta run cited the prior row only when a
// human remembered it. This prints, for one ticker, every hypothesis that has
// already been tested and how it died, so the next run does not start blind.
// It is the "killed-hypothesis memory" piece kept from the Ant Palkin PASS card
// (2026-09-15); the rest of that thread was a funnel.
//
// Read-only. Never writes. Zero-dep.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");

const loadJson = (p) => JSON.parse(readFileSync(p, "utf8"));

export function classify(row) {
  // How did this hypothesis end?
  const fc = String(row.final_call || "").toUpperCase();
  const outcome = row.outcome ? String(row.outcome).toUpperCase() : "";
  if (outcome) {
    if (/STOP|INVALID|FAIL|LOSS|MISS|WRONG|EXPIRED|DEAD|KILL/.test(outcome)) return "DIED";
    if (/WIN|HIT|TARGET|RIGHT|CORRECT/.test(outcome)) return "PLAYED OUT";
    return "RESOLVED";
  }
  if (row.grade_verdict) {
    const g = String(row.grade_verdict).toUpperCase();
    if (/WRONG|MISS|FAIL/.test(g)) return "DIED";
    if (/RIGHT|CORRECT|HIT/.test(g)) return "PLAYED OUT";
    return "RESOLVED";
  }
  if (row.decide_by && row.decide_by < today()) return "EXPIRED";
  // A conditional with a live deadline is still a hypothesis under test, even
  // when the row says NO ORDER (that is the entry, not the verdict).
  if (row.decide_by && row.decide_by >= today() && row.trigger != null) return "OPEN";
  if (/NO TICKET|NO ORDER|PASS\b|WATCHLIST ONLY|NOT RECOMMENDED|NO TRADE/.test(fc)) return "PASSED";
  return "OPEN";
}

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function firstSentence(s, max = 220) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{20,}?[.!?])\s/);
  const out = m ? m[1] : t;
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}

export function deadTheses({ ticker, book, patterns, all = false }) {
  const T = ticker.toUpperCase();
  const rows = (Array.isArray(book) ? book : book.rows || []).filter(
    (r) => String(r.ticker || "").toUpperCase() === T
  );
  const history = rows.map((r) => ({
    id: r.id,
    date: r.date,
    status: classify(r),
    call_type: r.call_type,
    price: r.review_price,
    trigger: r.trigger ?? null,
    invalidation: r.invalidation ?? null,
    decide_by: r.decide_by ?? null,
    overall: r.grades?.overall ?? null,
    readiness: r.readiness ?? null,
    outcome: r.outcome ?? null,
    pct_move: r.pct_move ?? null,
    lesson: r.lesson || null,
    thesis: firstSentence(r.final_call),
  }));
  const dead = history.filter((h) => h.status !== "OPEN");
  const open = history.filter((h) => h.status === "OPEN");
  const deadTriggers = dead
    .filter((h) => h.trigger != null && (h.status === "DIED" || h.status === "EXPIRED"))
    .map((h) => ({ id: h.id, trigger: h.trigger, status: h.status, date: h.date }));
  const lessons = history.filter((h) => h.lesson).map((h) => ({ id: h.id, date: h.date, lesson: h.lesson }));

  const pats = Array.isArray(patterns) ? patterns : patterns?.patterns || [];
  const patternHits = [];
  for (const p of pats) {
    for (const inst of p.instances || []) {
      if (String(inst.ticker || "").toUpperCase() === T) {
        patternHits.push({
          id: p.id,
          claim: p.claim,
          status: p.status,
          date: inst.date,
          holds: inst.holds,
          detail: firstSentence(inst.detail, 160),
        });
      }
    }
  }
  return { ticker: T, rows: history.length, dead, open: all ? open : open.length, deadTriggers, lessons, patternHits };
}

function print(r) {
  const L = [];
  L.push(`DEAD THESES — ${r.ticker}   (${r.rows} prior row${r.rows === 1 ? "" : "s"} in the book)`);
  L.push("=".repeat(72));
  if (!r.rows) {
    L.push("Never reviewed. Nothing has died here yet — this run starts the record.");
    console.log(L.join("\n"));
    return;
  }
  L.push("");
  L.push("TESTED AND CLOSED");
  if (!r.dead.length) L.push("  none");
  for (const h of r.dead) {
    const bits = [`${h.id}`, h.date, h.status, h.call_type || "?"];
    if (h.trigger != null) bits.push(`trigger ${h.trigger}`);
    if (h.invalidation != null) bits.push(`invalid ${h.invalidation}`);
    if (h.overall) bits.push(`grade ${h.overall}`);
    if (h.pct_move != null) bits.push(`${h.pct_move > 0 ? "+" : ""}${h.pct_move}%`);
    L.push(`  ${bits.join(" | ")}`);
    if (h.thesis) L.push(`      ${h.thesis}`);
    if (h.outcome) L.push(`      outcome: ${h.outcome}`);
  }
  L.push("");
  L.push("DEAD TRIGGERS (do not re-arm without saying why this time is different)");
  if (!r.deadTriggers.length) L.push("  none");
  for (const t of r.deadTriggers) L.push(`  ${t.trigger}  ${t.status}  ${t.id} ${t.date}`);
  L.push("");
  L.push("LESSONS ALREADY PAID FOR");
  if (!r.lessons.length) L.push("  none");
  for (const l of r.lessons) L.push(`  ${l.id} ${l.date}: ${l.lesson}`);
  L.push("");
  L.push("PATTERN INSTANCES");
  if (!r.patternHits.length) L.push("  none");
  for (const p of r.patternHits) {
    L.push(`  ${p.id} [${p.status}] ${p.date} holds=${p.holds}: ${p.claim}`);
    if (p.detail) L.push(`      ${p.detail}`);
  }
  L.push("");
  const openN = Array.isArray(r.open) ? r.open.length : r.open;
  L.push(`STILL OPEN: ${openN} row${openN === 1 ? "" : "s"}${openN ? " — delta those, do not re-run them" : ""}`);
  if (Array.isArray(r.open)) {
    for (const h of r.open) {
      const bits = [h.id, h.date, h.call_type || "?"];
      if (h.trigger != null) bits.push(`trigger ${h.trigger}`);
      if (h.decide_by) bits.push(`decide-by ${h.decide_by}`);
      L.push(`  ${bits.join(" | ")}`);
    }
  }
  console.log(L.join("\n"));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ticker = val("--ticker");
  if (!ticker) {
    console.error("usage: node scripts/dead-theses.mjs --ticker X [--all] [--json] [--book f] [--patterns f]");
    process.exit(2);
  }
  const book = loadJson(val("--book") || resolve(ROOT, "db/archive.json"));
  let patterns = [];
  try {
    patterns = loadJson(val("--patterns") || resolve(ROOT, "db/patterns.json"));
  } catch {}
  const r = deadTheses({ ticker, book, patterns, all: has("--all") });
  if (has("--json")) console.log(JSON.stringify(r, null, 2));
  else print(r);
}
