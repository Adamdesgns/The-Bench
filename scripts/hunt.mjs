// hunt.mjs — HUNTER MODE: run Adam's Hunter on a bars file the desk captured, print the read in
// Bench terms, and (with --log) put every fired name on the hunt list. Nothing else is written.
//
//   node scripts/hunt.mjs --bars <bars.json> IREN CBRS MU [--log] [--universe market|ai-infra]
//   node scripts/hunt.mjs --bars <bars.json> --json X          raw Hunter JSON, pass-through
//   node scripts/hunt.mjs --bars <bars.json> --no-earnings X   skip the calendar qualifier
//   --hunter-root <dir>   where Hunter lives (default $HUNTER_ROOT, else ../hunter beside this repo)
//   --file <watchlist>    (tests) which watchlist --log writes
//
// WHY THIS EXISTS (2026-09-10)
// ----------------------------
// Until tonight the bridge between Hunter and this desk was Claude reading Hunter's page and
// retyping it into rows. Adam: "can we add hunter as a 'mode' on the bench?" - and then, when
// Codex usage ran out and took Hunter's Robinhood pipe with it: "we need to be independent of
// codex." So the desk pulls the bars itself (hunt-bars.mjs), Hunter reads the file (--bars), and
// this script speaks Hunter's result in the framework's words.
//
// THE LINE THIS SCRIPT DOES NOT CROSS
// -----------------------------------
// The hunter finds; the framework judges (v29 §HUNTER HANDOFF, §HUNTER MODE). --log records that
// a name fired: DISCOVERY, origin hunter, the discovery print and date, the receipt id. It never
// writes a verdict, a grade, a readiness, a plan or a list above DISCOVERY, and it never demotes a
// name that already sits on STALK or READY. A fired name still runs every gate by hand.
//
// Hunter saves nothing and holds no permission to redistribute its numbers. The book keeps the
// flag and the discovery print, not the bars.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { setHunt } from "./hunt-list.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Frozen on Hunter's side (forward-gate-shipped.json, 2026-09-07). Restated here so the Bench
// page can say what a firing has historically meant without re-deriving anything. If Hunter's
// gate is ever re-scored these change there first, then here.
export const EXPOSURE_ODDS = { dd20: 3.95, pump: 9.55, crash: 16.82, lookback: 78 };
// Hunter's earnings qualifier (EARNINGS_QUALIFIER in src/watchlist/earnings-proximity.ts).
export const EARNINGS_QUALIFIER = { preWindowDays: 5, postMinDays: 1, postMaxDays: 10, postClearAheadDays: 20, preCrashMultiple: 2.6, preCases: 332, postCases: 1621 };

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const TAKES_VALUE = new Set(["--bars", "--universe", "--hunter-root", "--file"]);

export function parseHuntArguments(args) {
  const symbols = [];
  const out = { bars: null, log: false, json: false, earnings: true, universe: "market", hunterRoot: null, file: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--log") { out.log = true; continue; }
    if (a === "--json") { out.json = true; continue; }
    if (a === "--no-earnings") { out.earnings = false; continue; }
    if (TAKES_VALUE.has(a)) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      if (a === "--bars") out.bars = v;
      else if (a === "--universe") out.universe = v;
      else if (a === "--hunter-root") out.hunterRoot = v;
      else out.file = v;
      i++;
      continue;
    }
    if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    symbols.push(a.toUpperCase());
  }
  if (!out.bars) throw new Error("--bars <bars.json> is required: Hunter Mode reads the desk's own capture, never Codex");
  if (symbols.length === 0) throw new Error("name at least one symbol");
  if (!["market", "ai-infra"].includes(out.universe)) throw new Error("--universe must be market or ai-infra");
  return { ...out, symbols };
}

export function resolveHunterRoot(explicit, env = process.env) {
  const root = explicit ?? env.HUNTER_ROOT ?? resolve(ROOT, "..", "hunter");
  if (!existsSync(resolve(root, "src", "watchlist", "main.ts"))) {
    throw new Error(`Hunter not found at ${root} (src/watchlist/main.ts missing) - pass --hunter-root or set HUNTER_ROOT`);
  }
  return root;
}

export function runHunter({ hunterRoot, bars, symbols, earnings }) {
  const args = ["--import", "tsx", resolve(hunterRoot, "src", "watchlist", "main.ts"), ...symbols, "--bars", resolve(bars), "--json"];
  if (earnings) args.push("--earnings");
  let stdout;
  try {
    stdout = execFileSync(process.execPath, args, { cwd: hunterRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // Hunter prints its failure as JSON on stdout and exits 1; keep that, it names the code.
    stdout = e.stdout ?? "";
    if (!stdout.trim()) throw new Error(`Hunter did not answer: ${(e.stderr ?? e.message ?? "").toString().trim().slice(0, 400)}`);
  }
  const report = JSON.parse(stdout);
  if (report.status === "FAILED") {
    throw new Error(`Hunter refused the run: ${report.code}${report.detail ? ` (${report.detail})` : ""}`);
  }
  return report;
}

// --- pure: what fired -------------------------------------------------------------------

export function fired(report) {
  const stirring = new Map((report.stirring ?? []).map((c) => [c.symbol, c]));
  const exposure = new Map((report.exposures ?? []).filter((e) => e.status === "TRIGGERED").map((e) => [e.symbol, e]));
  const names = [...new Set([...stirring.keys(), ...exposure.keys()])].sort();
  return names.map((symbol) => ({
    symbol,
    detectors: [
      ...(stirring.has(symbol) ? stirring.get(symbol).dimensions.map((d) => d.detector) : []),
      ...(exposure.has(symbol) ? ["DRAWDOWN_EXPOSURE"] : []),
    ],
  }));
}

function unreadable(report) {
  const bad = new Map();
  for (const c of report.coverage ?? []) if (c.symbol !== "SPY" && c.deliveryStatus !== "COMPLETE") bad.set(c.symbol, `${c.deliveryStatus}: ${c.acceptedSessionCount} of ${c.expectedSessionCount} sessions`);
  for (const h of report.health ?? []) if (h.symbol !== "SPY" && h.status !== "HEALTHY") bad.set(h.symbol, `${h.status}${h.issueCodes?.length ? ` (${h.issueCodes.join(", ")})` : ""}`);
  return bad;
}

function pct(x) { return `${(x * 100).toFixed(1)}`; }
function measurement(dimension, name) { return dimension.measurements.find((m) => m.name === name)?.value; }

export function earningsLine(row) {
  if (!row) return null;
  const q = EARNINGS_QUALIFIER;
  if (row.daysUntil !== null && row.daysUntil !== undefined && row.daysUntil >= 1 && row.daysUntil <= q.preWindowDays) {
    return `Reports in ${row.daysUntil} day${row.daysUntil === 1 ? "" : "s"}${row.nextVerified === false ? " (date unverified)" : ""} - firings inside ${q.preWindowDays} days of a print crashed ${q.preCrashMultiple}x as often (${q.preCases} cases). Decide before the print or not at all.`;
  }
  const clearAhead = row.daysUntil === null || row.daysUntil === undefined || row.daysUntil > q.postClearAheadDays;
  if (row.daysSince !== null && row.daysSince !== undefined && row.daysSince >= q.postMinDays && row.daysSince <= q.postMaxDays && clearAhead) {
    return `Reported ${row.daysSince} day${row.daysSince === 1 ? "" : "s"} ago, nothing inside ${q.postClearAheadDays} - post-print firings: 0 crashes in ${q.postCases}. None observed, not none possible.`;
  }
  return null;
}

// --- pure: the page ---------------------------------------------------------------------

export function renderHunt(report, { symbols }) {
  const lines = [];
  const through = (report.market?.dataThrough ?? "").slice(0, 10) || "unknown";
  const f = fired(report);
  const firedSet = new Set(f.map((x) => x.symbol));
  const bad = unreadable(report);
  const quiet = symbols.filter((s) => !firedSet.has(s) && !bad.has(s));
  const earningsBy = new Map((report.earnings ?? []).map((e) => [e.symbol, e]));
  const exposureBy = new Map((report.exposures ?? []).map((e) => [e.symbol, e]));

  lines.push(`HUNTER MODE - ${symbols.length} name${symbols.length === 1 ? "" : "s"}, data through ${through} (${report.market?.sessionsRead ?? "?"} sessions), backdrop ${report.market?.regime ?? "?"}, scan ${report.market?.scanStatus ?? "?"}`);
  lines.push(`Source: ${report.receipt?.barsSource === "OPERATOR_BARS_FILE" ? `the desk's own capture at ${report.receipt?.barsFile?.capturedAt ?? "?"}` : "Codex bridge"}. Hunter saved nothing.`);
  lines.push("");

  const stirring = report.stirring ?? [];
  lines.push(stirring.length ? `STIRRING - ${stirring.length} crossed a declared threshold` : "STIRRING - none");
  for (const c of stirring) {
    for (const d of c.dimensions) {
      if (d.detector === "RELATIVE_STRENGTH_ACCELERATION") {
        const cur = measurement(d, "currentExcessReturn"), prev = measurement(d, "previousExcessReturn"), acc = measurement(d, "acceleration"), thr = measurement(d, "threshold");
        lines.push(`  ${c.symbol.padEnd(6)} ${cur >= 0 ? "ahead of" : "behind"} SPY by ${pct(Math.abs(cur))} pts over 5 sessions after ${prev >= 0 ? "leading" : "trailing"} by ${pct(Math.abs(prev))} the 5 before; swing ${pct(acc)} vs a ${pct(thr)} threshold. The move already started - the desk looks for the pullback, not the chase.`);
      } else {
        lines.push(`  ${c.symbol.padEnd(6)} ${d.detector} (${d.detectorVersion})`);
      }
    }
  }
  lines.push("");

  const exposures = [...exposureBy.values()].filter((e) => e.status === "TRIGGERED");
  lines.push(exposures.length ? `EXPOSURE - ${exposures.length} beaten down and trading heavy` : "EXPOSURE - none");
  for (const e of exposures) {
    lines.push(`  ${e.symbol.padEnd(6)} ${e.drawdownFromHigh.toFixed(2)} of its ${e.highLookbackSessions}-session high on ${e.dollarVolumeRatio.toFixed(2)}x usual dollar volume.`);
    lines.push(`         Frozen odds for this shape: ${EXPOSURE_ODDS.dd20}x a further -20% in 20 sessions, ${EXPOSURE_ODDS.pump}x a +30% move, ${EXPOSURE_ODDS.crash}x a -30% move. Direction: not knowable from this.`);
    const el = earningsLine(earningsBy.get(e.symbol));
    if (el) lines.push(`         ${el}`);
  }
  lines.push("");

  lines.push(quiet.length ? `QUIET - ${quiet.join(", ")}` : "QUIET - none");
  if (bad.size) {
    lines.push(`COULDN'T READ - ${[...bad.keys()].join(", ")}`);
    for (const [s, why] of bad) lines.push(`  ${s.padEnd(6)} ${why}`);
  }
  lines.push("");
  lines.push(f.length
    ? `FOR THE DESK: ${f.map((x) => x.symbol).join(", ")} fired. Each runs every gate with --origin hunter. No Hunter number touches a gate.`
    : "FOR THE DESK: nothing fired. Nothing to judge unless Adam names a symbol.");
  lines.push(`Receipt ${String(report.receipt?.id ?? "").slice(0, 8)}  input ${String(report.receipt?.normalizedInputHash ?? "").slice(0, 8)}  ${report.receipt?.totalProviderCalls ?? "?"} reads (${report.receipt?.barsSource ?? "?"}), 0 account calls, 0 order calls.`);
  return lines.join("\n");
}

// --- pure: discovery prints out of the bars file -----------------------------------------

export function discoveryPrints(barsFile, throughDate) {
  const prints = new Map();
  for (const h of barsFile.historicals ?? []) {
    const payload = h.response?.structuredContent ?? h.response?.structured_content ?? h.response;
    for (const r of payload?.data?.results ?? []) {
      if (!r || typeof r.symbol !== "string" || !Array.isArray(r.bars)) continue;
      const bar = r.bars.find((b) => b && typeof b.begins_at === "string" && b.begins_at.slice(0, 10) === throughDate && b.interpolated !== true);
      if (bar && !prints.has(r.symbol)) prints.set(r.symbol, Number(bar.close_price));
    }
  }
  return prints;
}

// --- pure: the log ----------------------------------------------------------------------

export function logFired(watchlist, report, { prints, universe }) {
  const through = (report.market?.dataThrough ?? "").slice(0, 10);
  const receipt = String(report.receipt?.id ?? "").slice(0, 8);
  const notes = [];
  let next = watchlist;
  for (const { symbol, detectors } of fired(report)) {
    const existing = next.find((e) => e.sym === symbol);
    if (existing?.hunt && existing.hunt !== "DISCOVERY") {
      notes.push(`${symbol}: already ${existing.hunt}, left alone (Hunter fired ${detectors.join("+")}, receipt ${receipt})`);
      continue;
    }
    const price = prints.get(symbol);
    const meta = {
      origin: "hunter", universe,
      ...(Number.isFinite(price) && price > 0 ? { discovered_price: price } : {}),
      ...(through ? { discovered_on: through } : {}),
      why: `Hunter fired ${detectors.join(" + ")} on the ${through || "?"} bar (receipt ${receipt}). Not judged yet - runs every gate with --origin hunter.`,
    };
    const { watchlist: after, problems } = setHunt(next, symbol, "DISCOVERY", meta);
    if (problems.length) { notes.push(`${symbol}: not logged - ${problems.join("; ")}`); continue; }
    next = after;
    notes.push(`${symbol} -> DISCOVERY (origin hunter${price ? `, ${price} on ${through}` : ""})`);
  }
  return { watchlist: next, notes };
}

function main() {
  const args = parseHuntArguments(argv);
  const hunterRoot = resolveHunterRoot(args.hunterRoot);
  const report = runHunter({ hunterRoot, bars: args.bars, symbols: args.symbols, earnings: args.earnings });
  if (args.json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(renderHunt(report, { symbols: args.symbols }));
  if (!args.log) return;
  const file = resolve(args.file ?? resolve(ROOT, "db/watchlist.json"));
  const watchlist = JSON.parse(readFileSync(file, "utf8"));
  const barsFile = JSON.parse(readFileSync(resolve(args.bars), "utf8"));
  const prints = discoveryPrints(barsFile, (report.market?.dataThrough ?? "").slice(0, 10));
  const { watchlist: next, notes } = logFired(watchlist, report, { prints, universe: args.universe });
  if (next !== watchlist) writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log("");
  console.log(notes.length ? `LOGGED:\n  ${notes.join("\n  ")}` : "LOGGED: nothing fired, nothing written.");
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try { main(); } catch (e) { console.error(`hunt.mjs: ${e.message}`); process.exit(1); }
}
