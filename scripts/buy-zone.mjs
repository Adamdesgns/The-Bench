// buy-zone.mjs — the accumulation list: names ALREADY validated at B or better,
// each with a declared zone and a structural floor.
//
//   node scripts/buy-zone.mjs              the table
//   node scripts/buy-zone.mjs --json       machine-readable, for the scheduled task
//   node scripts/buy-zone.mjs --stale-days 90
//   node scripts/buy-zone.mjs --all        include names that fail the gates, with the reason
//
// WHY THIS IS NOT A "BUY ANY LOW" LIST
//
// Adam, 2026-08-17: "we need a list of stocks that we should acquire at ANY low."
// The instinct is right and the framework already has the mechanism — the
// Accumulation Trigger — but "any low" is the one thing it forbids. Gate 2,
// verbatim: "If the thesis broke, the dip is not a discount, it is the market
// correctly repricing a changed story. Cheap is a price; changed is a thesis."
//
// The book already contains the proof. Two names would land on a naive list:
//   PENG carries B+ from B-019 (2026-07-06) — and its revenue is -6.2% YoY. The
//        business is SHRINKING. A six-week-old grade would have you buying every
//        low in a contracting company.
//   MU   carries A from B-004 (2026-06-30) — and B-004 SCORED A LOSS, -11.3%.
//        An A-graded name still lost money.
//
// So every entry carries the DATE its grade was earned, and a grade older than
// --stale-days drops off the armed list until the name is re-run. That staleness
// rule is the PENG guard, and it is the whole reason this file exists rather
// than a note somewhere.
//
// SOURCE OF TRUTH: grades come from db/archive.json (the book), never typed here.
// Zones and floors are declared in db/watchlist.json as `buy_zone` / `floor`,
// because a zone is live state and a grade is history.
//
// This script is PURE — no network. It emits the list and the levels; the
// scheduled task (bench-fastmover-watch) pulls live prices and does the
// comparison. That split keeps the levels auditable and the prices fresh.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../server/config.js";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : d;
};

const STALE_DAYS = Number(val("--stale-days", "60"));
const QUALIFYING = ["A+", "A", "A-", "B+", "B"];

const rows = JSON.parse(readFileSync(resolve(ROOT, "db/archive.json"), "utf8"));
const watch = JSON.parse(readFileSync(resolve(ROOT, "db/watchlist.json"), "utf8"));

const today = new Date(val("--today", new Date().toISOString().slice(0, 10)));
const ageDays = (d) => Math.round((today - new Date(d)) / 86400000);

// Most RECENT fundamental grade per ticker — a later re-run supersedes an
// earlier one, which is the point of re-validation.
const graded = new Map();
for (const r of rows) {
  const g = r?.grades?.fundamental;
  if (!g) continue;
  const prev = graded.get(r.ticker);
  if (!prev || r.date >= prev.date) {
    graded.set(r.ticker, { grade: g, date: r.date, id: r.id });
  }
}

const zoneOf = (sym) => watch.find((w) => w.sym === sym) ?? {};

const entries = [];
for (const [ticker, g] of graded) {
  const age = ageDays(g.date);
  const w = zoneOf(ticker);
  const qualifies = QUALIFYING.includes(g.grade);
  const stale = age > STALE_DAYS;

  let status, why;
  if (w.lane === 'momentum') {
    // MOMENTUM LANE - added 2026-08-21 at Adam's explicit direction:
    //   "I don't care if it fails a gate. Half the fkn AI names that ran 1,000s
    //    of %s failed the gate. The market doesn't always listen to fundamentals."
    // He is substantially right - momentum is a real and durable effect, and this
    // book carries its own receipt: B-169 refused HIMS at 1.29:1 on 8/20 and it
    // ran +7.69% the very next session.
    // So gate 1 (fundamental B or better) and the 2:1 R:R gate are BYPASSED here,
    // deliberately, and every printed line says so.
    // What is NOT bypassed: a name still needs a declared zone, and an open
    // position still never emits a buy signal (the GDS bug, 2026-08-18).
    // Standing caveat, recorded because it is the real risk: the names that ran
    // 1,000% are visible and the ones that went to zero are not, so this lane is
    // sized SMALLER than the accumulation lane, not larger.
    if (['HOLDING', 'HELD'].includes(w.status)) {
      status = 'HOLDING';
      why = 'open position - adds are a separate decision, not a re-trigger of this zone';
    } else if (w.buy_zone == null) {
      status = 'NO ZONE';
      why = 'momentum lane, but no buy_zone declared in watchlist.json';
    } else {
      why = 'buy at or below ' + w.buy_zone
          + (w.floor != null ? ', floor ' + w.floor : '')
          + ' - MOMENTUM LANE, bypasses gate 1 (fundamental ' + g.grade + '). '
          + (w.lane_why || 'no reason recorded');
      status = 'MOMENTUM';
    }
  } else if (!qualifies) {
    status = "REJECTED";
    why = `fundamental ${g.grade} — Accumulation gate 1 needs B or better`;
  } else if (w.thesis_flag) {
    // The PENG case, and the reason staleness alone is not enough. PENG's B+ is
    // only 42 days old — inside any sane staleness window — while its revenue is
    // -6.2% YoY. Gate 2 is about the thesis CHANGING, which has nothing to do
    // with how old the grade is. A flag here beats a shorter timer.
    status = "THESIS FLAG";
    why = `grade is fresh but contradicted — ${w.thesis_flag}`;
  } else if (w.status === "HOLDING") {
    // 2026-08-18: GDS filled at 8:49am CT and still read ARMED here, i.e. "buy at
    // or below 34.40" on 16 shares we already own. A name you HOLD is not a name
    // you are waiting to buy — the accumulation lane must not emit an entry
    // signal for an open position, or the fast-mover watch pings a buy on a
    // position whose own row says DO NOT ADD. Adding to a winner is a separate
    // decision with its own 2:1 test, not a re-fire of the original zone.
    status = "HOLDING";
    why = `open position — already filled; adds are a separate decision, not a re-trigger of this zone`;
  } else if (["AVOID", "PASS", "CLOSED"].includes(w.status)) {
    status = "EXCLUDED";
    why = `watchlist status is ${w.status} — a graded name we have already decided against`;
  } else if (stale) {
    status = "STALE";
    why = `graded ${age}d ago (${g.id}) — re-run before acting; this is the PENG guard`;
  } else if (w.buy_zone == null) {
    status = "NO ZONE";
    why = "qualifies on grade, but no buy_zone declared in watchlist.json";
  } else if (w.rr_target == null) {
    status = "NO TARGET";
    why = "zone and floor declared with no rr_target — the payoff leg was never checked";
  } else if ((w.rr_target - w.buy_zone) / (w.buy_zone - w.floor) < 2) {
    const rr = ((w.rr_target - w.buy_zone) / (w.buy_zone - w.floor)).toFixed(2);
    status = "FAILS R:R";
    why = `${rr}:1 to ${w.rr_target} — under the 2:1 minimum. A compliant stop is not a plan.`;
  } else if (w.floor == null) {
    status = "NO FLOOR";
    why = "zone declared without a structural floor — Accumulation gate 3 fails";
  } else {
    status = "ARMED";
    why = `buy at or below ${w.buy_zone}, floor ${w.floor}`;
  }

  entries.push({
    ticker,
    grade: g.grade,
    graded: g.date,
    age_days: age,
    row: g.id,
    buy_zone: w.buy_zone ?? null,
    floor: w.floor ?? null,
    rr_target: w.rr_target ?? null,
    status,
    why,
    note: w.note ? w.note.slice(0, 120) : null,
  });
}

// Momentum-lane names carrying NO fundamental grade never enter the graded map
// above, so they would be silently invisible here - the exact class of failure
// this lane exists to fix. Sweep them in explicitly.
for (const w of watch) {
  if (w.lane !== 'momentum') continue;
  if (entries.some((e) => e.ticker === w.sym)) continue;
  entries.push({
    ticker: w.sym, grade: 'n/a', graded: '-', age_days: 0, row: '-',
    buy_zone: w.buy_zone ?? null, floor: w.floor ?? null, rr_target: w.rr_target ?? null,
    status: w.buy_zone == null ? 'NO ZONE' : 'MOMENTUM',
    why: w.buy_zone == null
      ? 'momentum lane, no buy_zone declared'
      : 'buy at or below ' + w.buy_zone + ' - MOMENTUM LANE, ungraded. ' + (w.lane_why || 'no reason recorded'),
    note: w.note ? w.note.slice(0, 120) : null,
  });
}

const rank = { ARMED: 0, MOMENTUM: 0.5, HOLDING: 1, "FAILS R:R": 2, "NO TARGET": 3, "NO ZONE": 4, "NO FLOOR": 5, "THESIS FLAG": 6, EXCLUDED: 7, STALE: 8, REJECTED: 9 };
entries.sort((a, b) => rank[a.status] - rank[b.status] || a.age_days - b.age_days);

const shown = has("--all") ? entries : entries.filter((e) => e.status !== "REJECTED");

if (has("--json")) {
  console.log(JSON.stringify({ stale_days: STALE_DAYS, generated: today.toISOString().slice(0, 10), entries: shown }, null, 2));
  process.exit(0);
}

console.log(`\nTHE BUY ZONE — Accumulation gate 1 (fundamental B or better), stale after ${STALE_DAYS}d\n`);
console.log("TICKER  GRADE  GRADED      AGE    ZONE       FLOOR    TARGET    STATUS       WHY");
console.log("-".repeat(108));
for (const e of shown) {
  console.log(
    e.ticker.padEnd(7) +
      e.grade.padEnd(7) +
      e.graded.padEnd(12) +
      `${e.age_days}d`.padEnd(7) +
      String(e.buy_zone ?? "-").padEnd(11) +
      String(e.floor ?? "-").padEnd(9) +
      String(e.rr_target ?? "-").padEnd(10) +
      e.status.padEnd(13) +
      e.why
  );
}

const armed = shown.filter((e) => e.status === "ARMED").length;
const holding = shown.filter((e) => e.status === "HOLDING").length;
const needZone = shown.filter((e) => e.status === "NO ZONE" || e.status === "NO FLOOR").length;
const stale = shown.filter((e) => e.status === "STALE").length;
console.log("-".repeat(108));
console.log(`${armed} armed · ${holding} held · ${needZone} qualify but need a zone/floor · ${stale} stale`);
console.log(
  `\n${graded.size} of ${new Set(rows.map((r) => r.ticker)).size} tickers in the book carry a fundamental grade.` +
    `\nGrade in the FIELD (log-call.mjs --fundamental), not the prose, or the name is invisible here.\n`
);
