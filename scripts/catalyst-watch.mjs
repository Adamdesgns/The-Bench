// catalyst-watch.mjs — read the board and say what is coming, before it arrives.
//
//   node scripts/catalyst-watch.mjs                 the briefing
//   node scripts/catalyst-watch.mjs --json          machine-readable, for a scheduled task
//   node scripts/catalyst-watch.mjs --days 14       change the horizon (default 10)
//   node scripts/catalyst-watch.mjs --quiet         print only if something needs attention
//
// EXIT CODE: 0 = nothing needs attention · 1 = something does.
// That makes it gateable from a scheduled task without parsing the output.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-19, in one session, three dated events were discovered by accident:
//   - SPCX released 319.0M shares the NEXT DAY. The board had the wrong date and
//     nothing warned anyone (B-152).
//   - The ZYME PDUFA was 6 days out on a date never checked against a filing (B-151).
//   - Jackson Hole was on the board six days early.
// The data for the first two was already in db/catalysts.json. Nothing read it.
//
// The repo's answer so far has been a hand-built scheduled task per event
// (mu-precatalyst-deadline-sep18, hpq-precatalyst-deadline-aug25,
// plab-print-reaction-aug26). Those are well maintained — the dead ones are
// properly disabled with RETIRED descriptions — but it is one hand-built task
// per event, which does not scale past a board of a few rows.
//
// This is PURE — no network, exactly like buy-zone.mjs. It reads the board and
// emits what is due. Anything that needs a live price belongs in the scheduled
// task, not here, so the levels stay auditable and the prices stay fresh.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../server/config.js";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const HORIZON = Number(val("--days") ?? 10);
const board = JSON.parse(readFileSync(resolve(ROOT, "db/catalysts.json"), "utf8"));

// Central time, deliberately. toISOString() is UTC, so an evening run after 7pm CT
// rolled the date forward and labelled tomorrow "TODAY" — caught 2026-08-19.
const today = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Types whose date is a legal/contractual fact — being wrong about these is expensive.
const HARD_TYPES = new Set(["pdufa", "lockup", "adcomm", "macro", "index"]);

const flags = [];
const upcoming = board
  .filter((c) => c.date >= today)
  .map((c) => ({ ...c, tminus: daysBetween(today, c.date) }))
  .filter((c) => c.tminus <= HORIZON)
  .sort((a, b) => a.tminus - b.tminus);

for (const c of upcoming) {
  const who = c.ticker ?? "(market)";

  // 1. Imminent, and the date was never confirmed. This is the SVRA failure mode:
  //    an unconfirmed date that nobody re-checks becomes a wrong date you act on.
  if (c.tminus <= 7 && c.confidence !== "confirmed") {
    flags.push({
      level: "VERIFY",
      msg: `${who} ${c.type} in ${c.tminus}d and the date is "${c.confidence}", not confirmed. Re-check the primary source before acting on it.`,
      catalyst: c,
    });
  }

  // 2. A hard-type event landing inside 2 days, confirmed or not.
  if (c.tminus <= 2 && HARD_TYPES.has(c.type)) {
    flags.push({
      level: "IMMINENT",
      msg: `${who} ${c.type.toUpperCase()} ${c.tminus === 0 ? "TODAY" : c.tminus === 1 ? "TOMORROW" : `in ${c.tminus}d`}.`,
      catalyst: c,
    });
  }

  // 3. A hard-type event with no source at all.
  if (HARD_TYPES.has(c.type) && !c.source) {
    flags.push({
      level: "UNSOURCED",
      msg: `${who} ${c.type} on ${c.date} has NO source recorded. It is being trusted, not verified.`,
      catalyst: c,
    });
  }
}

// 3b. OUR OWN DEADLINES. The catalyst board tracks what the WORLD is doing;
// this tracks what WE have to decide. Adam, 2026-08-20: "me asking about it
// every day if we just need to watch it for a week will get repetitive." A plan
// with no expiry has to be asked about; a plan with one announces itself.
const archPath = resolve(ROOT, "db/archive.json");
const arch = JSON.parse(readFileSync(archPath, "utf8"));
const archRows = Array.isArray(arch) ? arch : (arch.rows || arch.archive);
const wlRows = JSON.parse(readFileSync(resolve(ROOT, "db/watchlist.json"), "utf8"));
const deadStatus = new Set(wlRows.filter((w) => ["CLOSED", "PASS", "AVOID"].includes(w.status)).map((w) => w.sym));

const livePlans = new Map();
for (const r of archRows) {
  if (r.outcome) { livePlans.delete(r.ticker); continue; }
  if (r.call_type === "conditional") livePlans.set(r.ticker, r);
}
const decisions = [...livePlans.values()]
  .filter((r) => !deadStatus.has(r.ticker) && r.decide_by)
  .map((r) => ({ ...r, dleft: daysBetween(today, r.decide_by) }))
  .sort((a, b) => a.dleft - b.dleft);

const expired = decisions.filter((d) => d.dleft < 0);
const dueSoon = decisions.filter((d) => d.dleft >= 0 && d.dleft <= HORIZON);

// 3c. PLAN DUE (2026-10-11). MRNA's 10/24 data was on this board for two months
// and the stock went 154 -> 225 without a plan ever being written, because
// nothing asked for one. Adam, asked whether every non-earnings dated event should
// get a written plan six weeks out: "yes". So: a company-specific event that is
// not an earnings print, inside 42 days, with no book row on that ticker in the 60
// days before the event, is PLAN DUE. A pass counts as a plan - it is written,
// dated and scored. Earnings are left out on purpose: the 2026-10-11 study found
// no reliable run-up into a print (docs/research/2026-10-11-earnings-runup.md).
const PLAN_TYPES = new Set(["readout", "pdufa", "adcomm", "product", "legal", "guidance", "other"]);
const PLAN_LEAD_DAYS = 42;
const minusDays = (d, n) => new Date(Date.parse(d) - n * 86400000).toISOString().slice(0, 10);
const planDue = [];
for (const c of board) {
  if (!c.ticker || !PLAN_TYPES.has(c.type) || c.date < today) continue;
  const tminus = daysBetween(today, c.date);
  if (tminus > PLAN_LEAD_DAYS) continue;
  if (planDue.some((p) => p.ticker === c.ticker && p.date === c.date)) continue;
  const since = minusDays(c.date, 60);
  if (archRows.some((r) => r.ticker === c.ticker && r.date >= since)) continue;
  planDue.push({ ...c, tminus, plan_by: minusDays(c.date, PLAN_LEAD_DAYS) });
}
planDue.sort((a, b) => a.tminus - b.tminus);

// 4. Coverage — the gap that cost MRNA. Name the categories with zero rows, always.
const ALL_TYPES = ["earnings", "readout", "pdufa", "adcomm", "macro", "lockup", "index", "product", "legal", "guidance"];
const counts = {};
for (const c of board) counts[c.type ?? "UNTYPED"] = (counts[c.type ?? "UNTYPED"] ?? 0) + 1;
const blind = ALL_TYPES.filter((t) => !counts[t]);

if (has("--json")) {
  console.log(JSON.stringify({ today, horizon: HORIZON, upcoming, flags, plan_due: planDue, blind_spots: blind }, null, 2));
  process.exit(flags.length || expired.length || planDue.length ? 1 : 0);
}

if (has("--quiet") && !flags.length && !planDue.length) process.exit(0);

console.log(`\nCATALYST WATCH — ${today}, next ${HORIZON} days\n${"=".repeat(58)}`);

if (!upcoming.length) {
  console.log("\nNothing dated inside the horizon.");
} else {
  for (const c of upcoming) {
    const when = c.tminus === 0 ? "TODAY" : c.tminus === 1 ? "TOMORROW" : `T-${c.tminus}`;
    const conf = c.confidence === "confirmed" ? "" : `  [${c.confidence}]`;
    console.log(`\n${when.padEnd(9)} ${c.date}  ${(c.ticker ?? "(market)").padEnd(7)} ${c.type.toUpperCase()}${conf}`);
    console.log(`          ${(c.what ?? c.label ?? "").slice(0, 150)}`);
    if (c.action) console.log(`          -> ${c.action.slice(0, 150)}`);
  }
}

if (flags.length) {
  console.log(`\n${"=".repeat(58)}\nNEEDS ATTENTION (${flags.length})\n`);
  for (const f of flags) console.log(`  [${f.level}] ${f.msg}`);
}

if (expired.length) {
  console.log(`\n${"=".repeat(58)}\nEXPIRED — past their own deadline, still sitting on the board (${expired.length})\n`);
  for (const d of expired) console.log(`  ${d.ticker.padEnd(6)} ${d.id.padEnd(7)} due ${d.decide_by} (${-d.dleft}d ago)  trigger ${d.trigger}`);
  console.log("  These are not live plans. Re-run them or kill them.");
}

if (dueSoon.length) {
  console.log(`\n${"=".repeat(58)}\nDECISIONS DUE (${dueSoon.length})\n`);
  for (const d of dueSoon) {
    const when = d.dleft === 0 ? "TODAY" : d.dleft === 1 ? "TOMORROW" : `${d.dleft}d`;
    console.log(`  ${when.padEnd(9)} ${d.ticker.padEnd(6)} ${d.id.padEnd(7)} trigger ${String(d.trigger).padEnd(9)} ${d.decide_by}`);
  }
} else if (!expired.length) {
  const next = decisions.find((d) => d.dleft > HORIZON);
  console.log(`\nNO DECISIONS DUE in the next ${HORIZON} days.` + (next ? ` Next is ${next.ticker} on ${next.decide_by} (${next.dleft}d).` : ""));
  console.log("  Nothing to check. The tripwire will ping if a level moves.");
}

if (planDue.length) {
  console.log(`\n${"=".repeat(58)}\nPLAN DUE - dated event inside 6 weeks, no plan in the book (${planDue.length})\n`);
  for (const p of planDue) {
    console.log(`  T-${String(p.tminus).padEnd(4)} ${p.date}  ${p.ticker.padEnd(6)} ${p.type.toUpperCase().padEnd(8)} plan was due ${p.plan_by}`);
    console.log(`         ${(p.what ?? p.label ?? "").slice(0, 120)}`);
  }
  console.log("  Write one: dead-theses, live pull, then log-call (a pass counts). Exit by the last close before the event.");
}

if (blind.length) {
  console.log(`\nBLIND SPOTS — catalyst types with ZERO rows on the board:\n  ${blind.join(", ")}`);
  console.log("  (This line is why MRNA was missed. It prints every run, on purpose.)");
}

console.log("");
process.exit(flags.length || planDue.length ? 1 : 0);
