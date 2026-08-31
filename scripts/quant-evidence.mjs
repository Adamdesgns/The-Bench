#!/usr/bin/env node
// quant-evidence.mjs — setup base rates for one ticker, graded and logged.
//
//   node scripts/quant-evidence.mjs --ticker CEG --setup move --threshold -5 --window 5 --horizon 21
//   node scripts/quant-evidence.mjs --ticker NVDA --setup breakout --lookback 20 --horizon 10
//
//   --setup       move | breakout | breakdown            (required)
//   --ticker      symbol                                  (required)
//   --horizon     forward window in trading bars          (required, >= 1)
//   --threshold   % move, sign = direction                (required for move)
//   --window      bars the move is measured over          (move only, default 5)
//   --lookback    prior bars for breakout/breakdown       (default 20)
//   --range       history to pull (default 5y)
//   --benchmark   default: benchmarkFor(ticker)
//   --row B-###   link the run to a book row
//   --note "..."  free text
//   --dry-run     compute and print, write nothing
//   --bars-file / --bench-file   JSON [{date,close}] fixtures (offline/testing)
//
// Counts what actually happened the last N times; refuses to pretend a thin
// sample is knowledge (the grade is the point). Appends every run to
// db/quant-runs.json — a run is not finished until a QR id has been echoed.
// Framework: prompts/trading-copilot-v28.md §QUANT EVIDENCE.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectEvents, independentCount, forwardReturns, summarize, gradeEvidence, barsSpanYears
} from "../server/evidence.js";
import { benchmarkFor } from "../server/scoring.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS_PATH = resolve(ROOT, "db", "quant-runs.json");
const ARCHIVE_PATH = resolve(ROOT, "db", "archive.json");

// ---- args ----
const argv = process.argv.slice(2);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : null;
};
const has = (f) => argv.includes(f);
const refuse = (msg) => {
  console.error(`REFUSED: ${msg}`);
  process.exit(1);
};

const ticker = (valueOf("--ticker") ?? refuse("--ticker is required")).toUpperCase();
const setupKind = valueOf("--setup") ?? refuse("--setup is required (move | breakout | breakdown)");
const horizon = Number(valueOf("--horizon"));
if (!Number.isInteger(horizon) || horizon < 1) refuse("--horizon must be a whole number of bars >= 1");

let setup;
if (setupKind === "move") {
  const rawThreshold = valueOf("--threshold");
  if (rawThreshold === null) refuse("move needs --threshold (a % move; sign = direction)");
  const thresholdPct = Number(rawThreshold);
  if (!Number.isFinite(thresholdPct)) refuse("--threshold must be a number (a % move; sign = direction)");
  const windowDays = Number(valueOf("--window") ?? 5);
  if (!Number.isInteger(windowDays) || windowDays < 1) refuse("--window must be a whole number of bars >= 1");
  setup = { kind: "move", windowDays, thresholdPct };
} else if (setupKind === "breakout" || setupKind === "breakdown") {
  const lookback = Number(valueOf("--lookback") ?? 20);
  if (!Number.isInteger(lookback) || lookback < 1) refuse("--lookback must be a whole number of bars >= 1");
  setup = { kind: setupKind, lookback };
} else {
  refuse(`unknown --setup "${setupKind}" (move | breakout | breakdown)`);
}

const range = valueOf("--range") ?? "5y";
const rowRef = valueOf("--row");
const note = valueOf("--note");
const dryRun = has("--dry-run");
const barsFile = valueOf("--bars-file");
const benchFile = valueOf("--bench-file");
const benchmark = (valueOf("--benchmark") ?? benchmarkFor(ticker)).toUpperCase();

// A quant run that claims to support a book row must point at a row that
// exists — same spirit as executor-arm refusing rows not in the book.
if (rowRef) {
  const archive = existsSync(ARCHIVE_PATH) ? JSON.parse(readFileSync(ARCHIVE_PATH, "utf8")) : [];
  if (!archive.some((r) => r.id === rowRef)) refuse(`--row ${rowRef} is not in db/archive.json`);
}

// ---- bars ----
// Fixtures are for tests and offline work; the live path is the same
// Yahoo -> Stooq chain the checkpoint scorer uses. With a bars fixture and no
// bench fixture the benchmark leg is skipped rather than silently fetched.
function readBarsFile(path) {
  const bars = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(bars) || !bars.length) refuse(`${path} holds no bars`);
  return { bars, source: `file:${path}` };
}

let assetData;
let benchData = null;
if (barsFile) {
  assetData = readBarsFile(barsFile);
  if (benchFile) benchData = readBarsFile(benchFile);
} else {
  const { getDatedCloses } = await import("../server/dataProviders.js");
  assetData = await getDatedCloses(ticker, { range });
  benchData = await getDatedCloses(benchmark, { range });
  if (benchData.source === "none") benchData = null;
}

const { bars, source } = assetData;
if (!bars.length || source === "none") {
  // No bars is a graded F, not a crash — but there is nothing worth logging.
  console.log(`QUANT EVIDENCE — ${ticker} ${describeSetup(setup)} -> ${horizon} bars forward`);
  console.log(`DATA    none — no history observable for ${ticker} (range ${range})`);
  console.log(`GRADE   F — no observable events — nothing to grade`);
  console.log(dryRun ? "(--dry-run: nothing logged)" : "(nothing logged — no data is not evidence)");
  process.exit(0);
}

// ---- compute ----
const events = detectEvents(bars, setup);
const independent = independentCount(events, horizon);
const { instances, pending } = forwardReturns(bars, events, horizon, benchData?.bars ?? null);
const stats = summarize(instances);
const spanYears = barsSpanYears(bars);
const { grade, why } = gradeEvidence({ events: events.length, independent, spanYears, source });

// ---- report ----
function describeSetup(s) {
  if (s.kind === "move") {
    return `${s.thresholdPct > 0 ? "+" : ""}${s.thresholdPct}% in ${s.windowDays} bars`;
  }
  return `${s.kind} of the prior ${s.lookback}-bar ${s.kind === "breakout" ? "high" : "low"}`;
}
const pct = (n, signed = true) =>
  typeof n === "number" ? `${signed && n > 0 ? "+" : ""}${n}%` : "n/a";

console.log(`QUANT EVIDENCE — ${ticker} ${describeSetup(setup)} -> ${horizon} bars forward`);
console.log(`DATA    ${source}, ${bars[0].date} .. ${bars[bars.length - 1].date} (${spanYears}y, ${bars.length} bars)`);
console.log(`EVENTS  ${events.length} raw, ${independent} independent at this horizon, ${pending} pending (excluded)`);
if (stats.n) {
  console.log(`FORWARD win ${stats.win_rate}% · avg ${pct(stats.avg_pct)} · median ${pct(stats.median_pct)} · best ${pct(stats.best_pct)} · worst ${pct(stats.worst_pct)}`);
  console.log(
    stats.avg_alpha === null
      ? `VS ${benchmark}  n/a — no benchmark data on this run`
      : `VS ${benchmark}  avg alpha ${stats.avg_alpha > 0 ? "+" : ""}${stats.avg_alpha} · alpha win ${stats.alpha_win_rate}%`
  );
}
console.log(`GRADE   ${grade} — ${why}`);

// ---- persist ----
if (dryRun) {
  console.log("(--dry-run: nothing logged)");
  process.exit(0);
}

const runs = existsSync(RUNS_PATH) ? JSON.parse(readFileSync(RUNS_PATH, "utf8")) : [];
const nextN = runs.reduce((m, r) => Math.max(m, Number(/^QR-(\d+)$/.exec(r.id)?.[1] ?? 0)), 0) + 1;
const id = `QR-${String(nextN).padStart(3, "0")}`;

runs.push({
  id,
  date: new Date().toISOString().slice(0, 10),
  ticker,
  benchmark: benchData ? benchmark : null,
  setup,
  horizon_bars: horizon,
  range: barsFile ? null : range,
  source,
  bars_span: { first: bars[0].date, last: bars[bars.length - 1].date, years: spanYears, bars: bars.length },
  events: events.length,
  independent,
  pending,
  stats,
  instances,
  grade,
  grade_why: why,
  row_ref: rowRef ?? null,
  note: note ?? null,
  engine: "bench-native",
  created_at: new Date().toISOString()
});

writeFileSync(RUNS_PATH, JSON.stringify(runs, null, 2) + "\n", "utf8");
console.log(`${id} logged -> db/quant-runs.json${rowRef ? ` (row ${rowRef})` : ""}`);
