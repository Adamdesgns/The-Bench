// scorecard.js — score the book's due checkpoints and write the results.
//
// Orchestration only. The verdict rule lives in scoring.js and the date maths
// in checkpoints.js, both pure and tested; this module fetches prices, applies
// them, and persists. Bars are injected so the whole flow is testable offline.
//
// Spec: docs/scorecard-spec.md

import { loadArchive, writeArchive } from "./reconcile.js";
import { getDatedCloses } from "./dataProviders.js";
import { nyDate } from "./nyDate.js";
import {
  classifyCall,
  benchmarkFor,
  normalizeTrigger,
  pctMove,
  scoreCall,
  triggerFiredIn,
  isInstrument,
  splitFactor,
  basisProblem
} from "./scoring.js";
import {
  CLOSING_HORIZON,
  HORIZON_DAYS,
  checkpointDate,
  closeOnOrBefore,
  dueCheckpoints,
  settledCheckpoints,
  reviewDay
} from "./checkpoints.js";

const OUTCOME_FOR = { right: "Win", wrong: "Loss", flat: "Flat", not_scorable: "Unscored" };

const DAY_MS = 24 * 60 * 60 * 1000;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// Fetch each symbol at most once per run — a 22-row book touches SPY and BTC
// on nearly every row.
function memoize(fetchBars) {
  const cache = new Map();
  return (ticker) => {
    if (!cache.has(ticker)) cache.set(ticker, fetchBars(ticker));
    return cache.get(ticker);
  };
}

function lastBarDate(bars) {
  return (bars ?? []).reduce((latest, b) => (b?.date > latest ? b.date : latest), "");
}

// A reference close older than this says nothing about the review day's basis
// (a halt, a new listing), so the basis check is skipped rather than guessed.
const REF_MAX_AGE_DAYS = 7;

// Where the asset leg starts, on the share basis of the price series.
//
// review_price is authoritative when it is a real number, but it is the RAW
// print of the review day and the series is split-adjusted all the way back.
// So the logged price is carried across every split that landed after the
// review, then checked against the series' own close for that day. Rows
// written by the runner can carry "unverified", in which case the close on the
// review day stands in and is already on the series' basis. Never invented.
//
// -> { day, logged, entry, factor, problem }
function entryBasis(row, assetBars, splits) {
  const day = reviewDay(row);
  if (typeof row.review_price !== "number") {
    return { day, logged: false, entry: closeOnOrBefore(assetBars, day)?.close ?? null, factor: 1, problem: null };
  }
  if ((splits ?? []).some((s) => s.date === day)) {
    const problem = `split on the review day (${day}) — the logged price ${row.review_price} could be on either share basis`;
    return { day, logged: true, entry: null, factor: 1, problem };
  }
  const factor = splitFactor(splits, day, lastBarDate(assetBars));
  const entry = factor === 1 ? row.review_price : round6(row.review_price * factor);
  const ref = closeOnOrBefore(assetBars, day);
  const refIsFresh = ref && (Date.parse(day) - Date.parse(ref.date)) / DAY_MS <= REF_MAX_AGE_DAYS;
  return { day, logged: true, entry, factor, problem: refIsFresh ? basisProblem(entry, ref) : null };
}

// The gate was logged raw, like the price, so it crosses the same splits.
function triggerOnBasis(row, factor) {
  const trigger = normalizeTrigger(row.trigger, row.review_price);
  if (!trigger || factor === 1 || typeof trigger.level !== "number") return trigger;
  return { ...trigger, level: trigger.level * factor };
}

// One horizon, start to finish. Nothing is written here.
function computeCheckpoint(row, horizon, { type, bench, assetBars, benchBars, assetSource, basis }) {
  const asof = checkpointDate(row, horizon);

  const end = closeOnOrBefore(assetBars, asof);
  // Both legs start on the session the logged price belongs to. For a row
  // logged the evening before row.date that is the prior close, not row.date's.
  const benchStart = closeOnOrBefore(benchBars, basis.day);
  const benchEnd = closeOnOrBefore(benchBars, asof);

  const assetPct = pctMove(basis.entry, end?.close ?? null);
  const benchPct = pctMove(benchStart?.close ?? null, benchEnd?.close ?? null);

  const triggerFired =
    type === "conditional" ? triggerFiredIn(assetBars, row.date, asof, triggerOnBasis(row, basis.factor)) : null;

  const { verdict, alpha, note } = scoreCall({ type, assetPct, benchPct, triggerFired, problem: basis.problem });

  const checkpoint = {
    asof,
    price: end?.close ?? null,
    // The start price actually used, on the series' basis. Its presence also
    // marks a checkpoint written by the split-aware scorer.
    entry: basis.entry,
    ...(basis.factor !== 1 ? { split_factor: basis.factor } : {}),
    asset_pct: assetPct,
    bench,
    bench_pct: benchPct,
    alpha,
    verdict,
    note,
    source: end ? assetSource : "none",
    scored_at: new Date().toISOString()
  };
  return { checkpoint, triggerFired };
}

function writeCheckpoint(row, horizon, checkpoint, supersedes = null) {
  row.checkpoints = row.checkpoints ?? {};
  row.checkpoints[horizon] = supersedes ? { ...checkpoint, supersedes } : checkpoint;

  // The 3-month checkpoint closes the row and fills the fields the schema
  // has always declared. `lesson` is deliberately never touched — it is the
  // one part of the record that has to be written by a human.
  if (horizon === CLOSING_HORIZON) {
    row.outcome = OUTCOME_FOR[checkpoint.verdict] ?? "Unscored";
    row.outcome_price = checkpoint.price;
    row.pct_move = checkpoint.asset_pct;
    row.grade_verdict = checkpoint.note;
  }
}

// What a superseded verdict said, kept inside the checkpoint that replaces it.
// A correction that erased the wrong number would be a second fault.
function supersededRecord(old, reason) {
  return {
    verdict: old.verdict,
    alpha: old.alpha ?? null,
    asset_pct: old.asset_pct ?? null,
    price: old.price ?? null,
    note: old.note ?? null,
    scored_at: old.scored_at ?? null,
    reason
  };
}

// Was this settled verdict computed across two share bases? Returns the reason
// as a sentence, or null.
//
// The test is what the series looked like ON THE DAY IT WAS SCORED: a split
// that landed between the review and that day was already in the series and
// had to be in the entry too. A split that came later was in neither, so the
// stored verdict was computed on one basis and stands.
function artifactReason(old, row, basis, splits) {
  if (!basis.logged) return null;
  const scoredDay = old.scored_at ? nyDate(new Date(old.scored_at)) : null;
  const expected = scoredDay ? splitFactor(splits, basis.day, scoredDay) : 1;
  const applied = old.split_factor ?? 1;
  if (Math.abs(expected / applied - 1) > 1e-9) {
    return `scored across a split: the series carried a x${round6(expected)} adjustment on ${scoredDay}, the logged price ${row.review_price} carried x${round6(applied)}`;
  }
  // Only for checkpoints written before the basis check existed.
  if (old.entry === undefined && basis.problem) return basis.problem;
  return null;
}

// Checkpoints that say "no price" on a row the SCORER closed as Unscored. A
// closed row is never due again, so once its price series can be fetched only
// --recheck can go back for it. A row a person closed carries their outcome,
// not "Unscored", and is never reopened.
function unobservedCheckpoints(row) {
  if (row?.outcome !== OUTCOME_FOR.not_scorable) return [];
  const stored = row.checkpoints ?? {};
  return Object.keys(HORIZON_DAYS).filter((key) => stored[key]?.verdict === "not_scorable" && stored[key].source === "none");
}

// rows -> { rows, scored, failures }. Mutates rows in place (the archive is the
// record).
//
// recheck: also audit every SETTLED checkpoint for the two faults that make a
// stored verdict an artifact rather than a call — a book label priced as a
// symbol, and a logged price scored against a series on another share basis.
// An artifact is recomputed and the old verdict is kept under `supersedes`.
// It also goes back for rows closed as Unscored for want of a price. Without
// recheck a settled verdict and a closed row are never touched.
export async function scoreRows(rows, { today, fetchBars, recheck = false }) {
  const failures = new Map();
  const bars = memoize(async (ticker) => {
    const got = (await fetchBars(ticker)) ?? {};
    if (!got.bars?.length) failures.set(ticker, got.error ?? "no price series");
    return got;
  });
  const scored = [];

  for (const row of rows) {
    const due = dueCheckpoints(row, today);
    const settled = recheck ? settledCheckpoints(row) : [];
    const unobserved = recheck ? unobservedCheckpoints(row) : [];
    if (!due.length && !settled.length && !unobserved.length) continue;

    const type = classifyCall(row);
    const bench = benchmarkFor(row.ticker);

    const report = (horizon, checkpoint, extra = {}) =>
      scored.push({
        id: row.id,
        ticker: row.ticker,
        type,
        call: row.final_call,
        score: row.opportunity_score,
        horizon,
        verdict: checkpoint.verdict,
        alpha: checkpoint.alpha,
        assetPct: checkpoint.asset_pct,
        benchPct: checkpoint.bench_pct,
        bench,
        note: checkpoint.note,
        triggerFired: null,
        ...extra
      });
    const correction = (old) => ({ corrected: true, was: { verdict: old.verdict, alpha: old.alpha ?? null } });

    // A book label is refused before any price is fetched: "CASH" resolves to
    // a real company, and a series for it would look like a valid answer.
    if (!isInstrument(row.ticker)) {
      const note = `not an instrument — "${row.ticker}" is a book label, there is nothing to price`;
      for (const horizon of [...due, ...settled]) {
        const old = row.checkpoints?.[horizon];
        // Already says so. Rewriting it every run would only churn scored_at.
        if (old?.verdict === "not_scorable" && old.note === note) continue;
        const checkpoint = {
          asof: checkpointDate(row, horizon),
          price: null,
          entry: null,
          asset_pct: null,
          bench,
          bench_pct: null,
          alpha: null,
          verdict: "not_scorable",
          note,
          source: "none",
          scored_at: new Date().toISOString()
        };
        const wasSettled = settled.includes(horizon);
        writeCheckpoint(row, horizon, checkpoint, wasSettled ? supersededRecord(old, note) : null);
        report(horizon, checkpoint, wasSettled ? correction(old) : {});
      }
      continue;
    }

    const asset = await bars(row.ticker);
    const benchData = await bars(bench);
    const assetBars = asset.bars ?? [];
    const splits = asset.splits ?? [];
    const basis = entryBasis(row, assetBars, splits);
    const ctx = { type, bench, assetBars, benchBars: benchData.bars ?? [], assetSource: asset.source, basis };

    for (const horizon of due) {
      const { checkpoint, triggerFired } = computeCheckpoint(row, horizon, ctx);
      writeCheckpoint(row, horizon, checkpoint);
      report(horizon, checkpoint, { triggerFired });
    }

    for (const horizon of settled) {
      const old = row.checkpoints[horizon];
      const reason = artifactReason(old, row, basis, splits);
      if (!reason) continue;
      const { checkpoint, triggerFired } = computeCheckpoint(row, horizon, ctx);
      // A real verdict is never traded for "price not observable". If the
      // prices needed to redo it are missing, it waits for a run that has them.
      if (!basis.problem && (checkpoint.asset_pct === null || checkpoint.bench_pct === null)) continue;
      writeCheckpoint(row, horizon, checkpoint, supersededRecord(old, reason));
      report(horizon, checkpoint, { triggerFired, ...correction(old) });
    }

    for (const horizon of unobserved) {
      const { checkpoint, triggerFired } = computeCheckpoint(row, horizon, ctx);
      // Still no series: the placeholder already says so.
      if (checkpoint.price === null) continue;
      writeCheckpoint(row, horizon, checkpoint);
      report(horizon, checkpoint, { triggerFired });
    }
  }

  return { rows, scored, failures: [...failures].map(([ticker, error]) => ({ ticker, error })) };
}

// Disk-facing wrapper: load, score everything due, persist under the archive
// lock. Returns the scored results for the post generator.
export async function scoreBook({ today = new Date().toISOString().slice(0, 10), recheck = false } = {}) {
  const archive = loadArchive();
  const { rows, scored, failures } = await scoreRows(archive, {
    today,
    recheck,
    fetchBars: (ticker) => getDatedCloses(ticker)
  });
  if (scored.length) writeArchive(rows);
  return { rows, scored, failures };
}
