// scorecard.js — score the book's due checkpoints and write the results.
//
// Orchestration only. The verdict rule lives in scoring.js and the date maths
// in checkpoints.js, both pure and tested; this module fetches prices, applies
// them, and persists. Bars are injected so the whole flow is testable offline.
//
// Spec: docs/scorecard-spec.md

import { loadArchive, writeArchive } from "./reconcile.js";
import { getDatedCloses } from "./dataProviders.js";
import { classifyCall, benchmarkFor, pctMove, scoreCall, triggerFiredIn } from "./scoring.js";
import { CLOSING_HORIZON, checkpointDate, closeOnOrBefore, dueCheckpoints } from "./checkpoints.js";

const OUTCOME_FOR = { right: "Win", wrong: "Loss", flat: "Flat", not_scorable: "Unscored" };

// Fetch each symbol at most once per run — a 22-row book touches SPY and BTC
// on nearly every row.
function memoize(fetchBars) {
  const cache = new Map();
  return (ticker) => {
    if (!cache.has(ticker)) cache.set(ticker, fetchBars(ticker));
    return cache.get(ticker);
  };
}

// The price the call was made at. review_price is authoritative when it is a
// real number; rows written by the runner can carry "unverified", in which case
// the close on the review date stands in. Never invented.
function entryPrice(row, assetBars) {
  if (typeof row.review_price === "number") return row.review_price;
  return closeOnOrBefore(assetBars, row.date)?.close ?? null;
}

// rows -> { rows, scored }. Mutates rows in place (the archive is the record).
export async function scoreRows(rows, { today, fetchBars }) {
  const bars = memoize(fetchBars);
  const scored = [];

  for (const row of rows) {
    const due = dueCheckpoints(row, today);
    if (!due.length) continue;

    const type = classifyCall(row);
    const bench = benchmarkFor(row.ticker);
    const { bars: assetBars, source: assetSource } = await bars(row.ticker);
    const { bars: benchBars } = await bars(bench);

    for (const horizon of due) {
      const asof = checkpointDate(row, horizon);

      const start = entryPrice(row, assetBars);
      const end = closeOnOrBefore(assetBars, asof);
      const benchStart = closeOnOrBefore(benchBars, row.date);
      const benchEnd = closeOnOrBefore(benchBars, asof);

      const assetPct = pctMove(start, end?.close ?? null);
      const benchPct = pctMove(benchStart?.close ?? null, benchEnd?.close ?? null);

      const triggerFired =
        type === "conditional" ? triggerFiredIn(assetBars, row.date, asof, row.trigger) : null;

      const { verdict, alpha, note } = scoreCall({ type, assetPct, benchPct, triggerFired });

      row.checkpoints = row.checkpoints ?? {};
      row.checkpoints[horizon] = {
        asof,
        price: end?.close ?? null,
        asset_pct: assetPct,
        bench,
        bench_pct: benchPct,
        alpha,
        verdict,
        note,
        source: end ? assetSource : "none",
        scored_at: new Date().toISOString()
      };

      // The 3-month checkpoint closes the row and fills the fields the schema
      // has always declared. `lesson` is deliberately never touched — it is the
      // one part of the record that has to be written by a human.
      if (horizon === CLOSING_HORIZON) {
        row.outcome = OUTCOME_FOR[verdict] ?? "Unscored";
        row.outcome_price = end?.close ?? null;
        row.pct_move = assetPct;
        row.grade_verdict = note;
      }

      scored.push({
        id: row.id,
        ticker: row.ticker,
        type,
        call: row.final_call,
        score: row.opportunity_score,
        horizon,
        verdict,
        alpha,
        assetPct,
        benchPct,
        bench,
        note,
        triggerFired
      });
    }
  }

  return { rows, scored };
}

// Disk-facing wrapper: load, score everything due, persist under the archive
// lock. Returns the scored results for the post generator.
export async function scoreBook({ today = new Date().toISOString().slice(0, 10) } = {}) {
  const archive = loadArchive();
  const { rows, scored } = await scoreRows(archive, {
    today,
    fetchBars: (ticker) => getDatedCloses(ticker)
  });
  if (scored.length) writeArchive(rows);
  return { rows, scored };
}
