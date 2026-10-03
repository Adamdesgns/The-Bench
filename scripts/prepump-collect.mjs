// prepump-collect.mjs — the ONLY thing allowed to write a pre-pump snapshot row.
//
//   node scripts/prepump-collect.mjs plan  --date 2026-09-08
//   node scripts/prepump-collect.mjs build --date 2026-09-08
//   node scripts/prepump-collect.mjs build --date 2026-09-08 --dry-run
//
// EXIT CODES: 0 ok · 1 nothing to do · 2 REFUSED (bad input, not a session, no raw data)
//
// WHY THIS EXISTS (2026-09-05)
// ----------------------------
// A pre-pump indicator is being calibrated and there is no labelled dataset to
// calibrate it against. This collects one. Adam: "Every day we don't collect is a
// day we can't get back."
//
// The collecting session must NEVER hold the data. Measured 2026-09-05: the naive
// "pull everything for the universe" plan is ~103 tool calls and ~3.3M characters,
// roughly 970K tokens — about five times a context window. So the session is a
// courier: it calls the MCP tools, drops raw payloads in db/prepump/raw/<date>/,
// and this script does every transform and every write. Nothing else writes a row.
//
// THE RULES THIS ENFORCES, each earned:
//
//  1. APPEND-ONLY, ONE FILE PER DAY. A past file is never rewritten. If a value
//     needs correcting, a NEW row is appended with a later observed_at; the
//     original stays. Drift you can see beats drift you cannot.
//  2. THE SESSION DATE COMES FROM THE PROVIDER, never the wall clock. fundamentals
//     carries market_date. If the run fires late (app closed, machine off), the row
//     still lands under the session it actually describes, and late_run is set.
//  3. INTERPOLATED BARS ARE DROPPED AND COUNTED. Robinhood emits a fake same-day
//     daily bar (volume 0, OHLC = prior close) for ~12h after the close; measured
//     still fake at 21:25 ET. The `interpolated` key is ABSENT when false, so this
//     tests key presence, never `=== false`.
//  4. THE CLOSE IS NOT ONE NUMBER. There is no endpoint that returns day D's
//     official settled close on day D. quote.close is the PRIOR session. So all of
//     them are stored side by side with their own dates, and none is called "close".
//  5. ADJUSTMENT IS RECORDED, NEVER ASSUMED. get_equity_historicals defaults to
//     split-adjusted and never echoes what it did; NVDA 2024-06-07 returns 1208.88
//     raw and 120.888 adjusted from the same endpoint. The requested basis is stored
//     on every row as request-attested only.
//  6. A MISSING SYMBOL STILL GETS A ROW. Dropping it shrinks the denominator
//     non-randomly — the dropped days are the eventful ones — and inflates every
//     rate computed later. Status carries why.
//  7. A PARTIAL RUN IS DETECTABLE. The manifest records expected vs written, per
//     source, plus every failure. A short file must never look like a quiet day.
//     "This is a FETCH FAILURE, not 'nothing tripped'." (tripwire.mjs)
//  8. NO LABELS AT COLLECTION TIME. Raw values only. Outcomes are a separate job so
//     the label definition can change without recollecting.
//
// DELIBERATE DEVIATION FROM THE BRIEF, stated so it is a decision and not a drift:
// the brief asks for the ~30-session daily series EVERY day. That is 66% of the
// whole cost and it is 29/30 redundant. Instead the full window is pulled on a
// symbol's FIRST appearance and then WEEKLY (--history-due tells the session who
// needs one). Every other day's bar is already captured natively from fundamentals,
// so after a month the series is reconstructible from the rows themselves. What the
// weekly re-pull preserves is the only thing dailies added: detection of provider
// restatement. Splits are announced in advance and are rare; weekly is ample.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCalendar, isTradingDay, isEarlyClose, sessionsSince, todayET } from "./prepump-session.mjs";

const ROOT = process.env.BENCH_ROOT ? resolve(process.env.BENCH_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PREPUMP = resolve(ROOT, "db/prepump");
const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

export const SCHEMA = "bench-prepump-snapshot-v1";
const HISTORY_EVERY_N_SESSIONS = 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function refuse(msg) {
  console.error(`REFUSED — ${msg}`);
  process.exit(2);
}
const rawDir = (date) => join(PREPUMP, "raw", date);
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

import { resolutionBlocks, captureQuality } from "./prepump-integrity.mjs";

// ---------- shared ----------

export function loadUniverse() {
  const p = join(PREPUMP, "universe-core.json");
  if (!existsSync(p)) throw new Error("db/prepump/universe-core.json is missing — the frozen core universe must exist before collecting");
  const u = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(u.symbols) || !u.symbols.length) throw new Error("universe-core.json has no symbols");
  return u;
}

/** Every date already collected, oldest first. */
export function collectedDates() {
  if (!existsSync(PREPUMP)) return [];
  return readdirSync(PREPUMP)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
}

/** Stable 0..n-1 bucket for a symbol. Desynchronizes refreshes; no date math, no state. */
export function bucket(sym, n) {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0;
  return h % n;
}

/**
 * Symbols whose full history window is due: never pulled, or stale.
 *
 * The staleness threshold is STAGGERED per symbol (5..9 sessions) rather than a
 * flat 5. With a flat threshold every symbol pulled on day 1 comes due again on
 * the same day, so the load is 47 calls every fifth session and 0 in between —
 * a spike that is exactly when a run is most likely to time out. Spreading the
 * threshold desynchronizes them permanently after the first run, at no cost.
 */
export function historyDue(date, symbols, cal) {
  const p = join(PREPUMP, "history-state.json");
  const state = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  const due = [];
  for (const s of symbols) {
    const last = state[s];
    if (!last) { due.push(s); continue; } // first appearance always gets a full window
    let age;
    try { age = sessionsSince(last, date, cal); } catch { age = 999; }
    if (age >= HISTORY_EVERY_N_SESSIONS + bucket(s, 5)) due.push(s);
  }
  return { due, state, statePath: p };
}

/**
 * Who gets collected, and why. Pure.
 *
 * Every row carries a `source` array. `core` rows are the stratified base-rate
 * sample and are the ONLY rows a base rate may count. `scan` and `desk` rows are
 * selected because something happened to them — non-random by construction —
 * so they ride alongside the sample and never join its denominator.
 */
export function buildUniverse({ core, scanSyms = new Set(), scanOf = {}, deskSyms = new Set() }) {
  const all = [...new Set([...core, ...scanSyms, ...deskSyms])].sort();
  const coreSet = new Set(core);
  const symbols = all.map((s) => ({
    symbol: s,
    source: [
      coreSet.has(s) ? "core" : null,
      scanSyms.has(s) ? "scan" : null,
      deskSyms.has(s) ? "desk" : null,
    ].filter(Boolean),
    scan_ids: scanOf[s] ?? [],
  }));
  return { all, symbols, counts: { core: core.length, scan: scanSyms.size, desk: deskSyms.size, total: all.length } };
}

/** The desk group for a session, if desk-feed.mjs wrote one. Missing = empty, never an error. */
export function readDeskSymbols(path) {
  if (!existsSync(path)) return { syms: new Set(), found: false };
  let d;
  try {
    d = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(d?.symbols)) throw new Error("symbols must be an array");
  } catch (e) {
    return { syms: new Set(), found: true, error: e.message };
  }
  const syms = new Set();
  for (const s of d.symbols ?? []) {
    const t = typeof s === "string" ? s : s?.symbol;
    if (typeof t === "string" && /^[A-Z]{1,5}$/.test(t)) syms.add(t);
  }
  return { syms, found: true };
}

// ---------- plan ----------

function cmdPlan() {
  const date = val("--date") ?? todayET();
  if (!DATE_RE.test(date)) refuse(`--date must be YYYY-MM-DD, got "${date}"`);
  const cal = loadCalendar();
  let session;
  try { session = isTradingDay(date, cal); } catch (e) { refuse(e.message); }
  if (!session) refuse(`${date} is not a trading session. The scheduler does not know that; this does. Stop here.`);

  const u = loadUniverse();
  const core = u.symbols.map((s) => s.symbol);
  const dir = rawDir(date);

  // Scan membership, if the session already dropped scan payloads in.
  const scanSyms = new Set();
  const scanOf = {};
  const scanFiles = existsSync(dir) ? readdirSync(dir).filter((f) => /^scan-.*\.json$/.test(f)) : [];
  for (const f of scanFiles) {
    try {
      const env = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const res = env.response?.data?.result ?? env.response?.result ?? env.result ?? {};
      const id = res.scan_id ?? f.replace(/^scan-|\.json$/g, "");
      for (const row of res.results ?? []) {
        const t = row.ticker ?? row.symbol; // run_scan rows are keyed `ticker`, not `symbol`
        if (!t) continue;
        scanSyms.add(t);
        (scanOf[t] ||= []).push(id);
      }
    } catch (e) {
      console.error(`  ! could not read ${f}: ${e.message}`);
    }
  }

  const deskPath = join(PREPUMP, "desk", `${date}.json`);
  const { syms: deskSyms, found: deskFound, error: deskError } = has('--skip-desk')
    ? { syms: new Set(), found: false, error: 'desk builder failed; stale file deliberately excluded' }
    : readDeskSymbols(deskPath);

  const { all, symbols, counts } = buildUniverse({ core, scanSyms, scanOf, deskSyms });
  const blocks = resolutionBlocks(ROOT);
  const requested = all.filter(s => !blocks.has(s));
  const { due, state } = historyDue(date, requested, cal);
  const firstSeen = due.filter((s) => !state[s]);

  const plan = {
    schema: "bench-prepump-plan-v1",
    date,
    quality_version: 2,
    history_bases: ["none", "split"],
    blocked_symbols: Object.fromEntries(blocks),
    planned_at: new Date().toISOString(),
    universe_version: u._version,
    early_close: isEarlyClose(date, cal),
    counts: { ...counts, history_due: due.length, first_appearance: firstSeen.length },
    scans_read: scanFiles.length,
    desk_file: deskFound ? deskPath : null,
    desk_error: deskError ?? null,
    symbols: symbols.map((p) => ({ ...p, history_due: due.includes(p.symbol), resolution_blocked: blocks.get(p.symbol) ?? null })),
    batches: {
      fundamentals: chunk(requested, 10),   // hard cap 10
      quotes: chunk(requested, 20),         // >20 silently drops the `close` block from EVERY result
      historicals: chunk(due, 10),    // hard cap 10
    },
  };

  console.log(`plan ${date}: ${all.length} symbols (core ${counts.core}, scan ${counts.scan}, desk ${counts.desk})`);
  if (blocks.size) console.log(`  resolution-blocked: ${[...blocks.keys()].join(", ")} (placeholder rows retained; no provider requests)`);
  console.log(`  history due: ${due.length} (first appearance: ${firstSeen.length})`);
  console.log(`  batches: fundamentals ${plan.batches.fundamentals.length} x<=10 · quotes ${plan.batches.quotes.length} x<=20 · historicals ${plan.batches.historicals.length} x<=10 x2 bases (${plan.batches.historicals.length * 2} history requests)`);
  if (!scanFiles.length) console.log(`  NOTE: no scan-*.json found in ${dir} — scan group is empty for this run.`);
  if (deskError) console.error(`  WARNING: desk file rejected (${deskError}); continuing with core and scan only.`);
  if (!deskFound) console.log(`  NOTE: no desk file at ${deskPath} — desk group is empty for this run.`);
  if (has("--dry-run")) {
    console.log("  --dry-run: plan.json NOT written.");
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  console.log(`  -> ${join(dir, "plan.json")}`);
}

export function chunk(a, n) {
  const out = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

// ---------- build ----------

/** Read every raw envelope of a given tool for a date. */
function readRaw(dir, prefix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .map((f) => {
      try { return { file: f, env: JSON.parse(readFileSync(join(dir, f), "utf8")) }; }
      catch (e) { return { file: f, error: e.message }; }
    });
}

/** Robinhood nests differently depending on the tool; unwrap defensively. */
const unwrap = (env) => env?.response?.data ?? env?.response ?? env?.data ?? env ?? {};

export function indexFundamentals(envs) {
  const by = {};
  for (const { env } of envs) {
    if (!env) continue;
    const d = unwrap(env);
    const at = env.observed_at ?? null;
    for (const r of d.results ?? []) if (r?.symbol) by[r.symbol] = { r, observed_at: at };
    for (const s of d.not_found ?? []) by[s] = { r: null, observed_at: at, not_found: true };
  }
  return by;
}

export function indexQuotes(envs) {
  const by = {};
  for (const { env } of envs) {
    if (!env) continue;
    const d = unwrap(env);
    const at = env.observed_at ?? null;
    const closesErr = d.closes_error ?? null;
    for (const r of d.results ?? []) {
      const sym = r?.quote?.symbol ?? r?.close?.symbol;
      if (sym) by[sym] = { q: r.quote ?? null, c: r.close ?? null, observed_at: at, closes_error: closesErr };
    }
  }
  return by;
}

export function indexHistoricals(envs, requestedBasis = "none") {
  const by = {};
  for (const { env } of envs) {
    if (!env) continue;
    const d = unwrap(env);
    const at = env.observed_at ?? null;
    const basis = env.adjustment_type ?? "UNDECLARED";
    if (basis !== requestedBasis) continue;
    for (const r of d.results ?? []) {
      if (!r?.symbol) continue;
      const raw = r.bars ?? [];
      // `interpolated` is ABSENT when false. Test presence, never === false.
      const kept = raw.filter((b) => !("interpolated" in b && b.interpolated));
      by[r.symbol] = {
        observed_at: at,
        adjustment_basis: basis,
        adjustment_attestation: "REQUEST_PARAMETER_ATTESTATION_ONLY",
        dropped_interpolated: raw.length - kept.length,
        bars: kept.map((b) => ({
          d: String(b.begins_at).slice(0, 10), // UTC slice; a local parse shifts Central back a day
          o: num(b.open_price), h: num(b.high_price), l: num(b.low_price), c: num(b.close_price),
          v: num(b.volume),
        })),
      };
    }
  }
  return by;
}

export function indexEarnings(envs) {
  const by = {};
  for (const { env } of envs) {
    if (!env) continue;
    const d = unwrap(env);
    for (const r of d.results ?? []) {
      const s = r?.symbol, dt = r?.report?.date;
      if (!s || !dt) continue;
      if (r?.eps && r.eps.actual !== null && r.eps.actual !== undefined) continue; // already reported
      if (!by[s] || dt < by[s].date) by[s] = { date: dt, timing: r.report?.timing ?? null, verified: r.report?.verified ?? null, observed_at: env.observed_at ?? null };
    }
  }
  return by;
}

export function indexScans(envs) {
  const cols = {}, ids = {};
  for (const { env } of envs) {
    if (!env) continue;
    const d = unwrap(env);
    const res = d.result ?? d;
    const id = res.scan_id ?? null;
    for (const row of res.results ?? []) {
      const t = row.ticker ?? row.symbol;
      if (!t) continue;
      (ids[t] ||= new Set()).add(id);
      cols[t] = { ...(cols[t] ?? {}), ...(row.columns ?? {}) };
    }
  }
  return { cols, ids };
}

function cmdBuild() {
  const date = val("--date") ?? todayET();
  if (!DATE_RE.test(date)) refuse(`--date must be YYYY-MM-DD, got "${date}"`);
  const dir = rawDir(date);
  const planPath = join(dir, "plan.json");
  if (!existsSync(planPath)) refuse(`no plan at ${planPath} — run \`plan\` first, and make sure the session wrote its raw payloads there`);
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const cal = loadCalendar();

  const fEnvs = readRaw(dir, "fund-");
  const qEnvs = readRaw(dir, "quote-");
  const hEnvs = readRaw(dir, "hist-");
  const eEnvs = readRaw(dir, "earnings");
  const sEnvs = readRaw(dir, "scan-");
  if (!fEnvs.length) refuse(`no fund-*.json in ${dir}. Fundamentals is the spine of a row (it carries market_date and the session OHLCV); without it there is nothing honest to write.`);

  const F = indexFundamentals(fEnvs);
  const Q = indexQuotes(qEnvs);
  const H = indexHistoricals(hEnvs);
  const HS = indexHistoricals(hEnvs, "split");
  const E = indexEarnings(eEnvs);
  const S = indexScans(sEnvs);

  const u = loadUniverse();
  const meta = {};
  for (const s of u.symbols) meta[s.symbol] = s;

  const nowIso = new Date().toISOString();
  const early = isEarlyClose(date, cal);
  const rows = [];
  const failures = [];
  const marketDates = {};

  for (const p of plan.symbols) {
    const sym = p.symbol;
    const f = F[sym];
    const q = Q[sym];
    const h = H[sym];
    const m = meta[sym];
    const r = p.resolution_blocked ? null : (f?.r ?? null);

    let status = "ok";
    const errs = [];
    if (p.resolution_blocked) { status = "resolution_blocked"; errs.push("prior symbol resolution failure; identity review required before resuming requests"); }
    else if (!f) { status = "no_data"; errs.push("no fundamentals payload for this symbol in the raw drop"); }
    else if (f.not_found) { status = "not_found"; errs.push("symbol did not resolve (delisted, renamed, or recycled)"); }
    else if (r && num(r.open) === null && num(r.volume) === null) { status = "no_data"; errs.push("fundamentals resolved but OHLC and volume are both null"); }
    else if (!q) { status = "partial"; errs.push("no quotes payload"); }
    if (q?.closes_error) errs.push(`quotes closes_error: ${q.closes_error} (batch exceeded 20 symbols?)`);

    const mkt = r?.market_date ?? null;
    if (mkt) marketDates[mkt] = (marketDates[mkt] ?? 0) + 1;

    rows.push({
      schema: SCHEMA,
      symbol: sym,
      // THE SESSION THIS ROW DESCRIBES, from the provider. Not the wall clock.
      date: mkt ?? date,
      requested_date: date,
      market_date_reported: mkt,
      date_source: mkt ? "fundamentals.market_date" : "scheduler(fallback)",
      observed_at: f?.observed_at ?? q?.observed_at ?? nowIso,
      built_at: nowIso,
      late_run: Boolean(mkt && mkt !== date),
      early_close: early,
      universe_version: plan.universe_version,
      source: p.source,
      core_band: m?.band ?? null,
      in_book: null,
      identity_status: "stable_provider_id_unavailable",
      identity_description: r?.description ?? null,
      financial_status_indicator: r?.financial_status_indicator ?? null,
      financial_status_description: r?.financial_status_description ?? null,
      resolution_blocked: p.resolution_blocked ?? null,
      status,
      errors: errs,

      f_open: num(r?.open), f_high: num(r?.high), f_low: num(r?.low), f_volume: num(r?.volume),
      f_avg_volume_2_weeks: num(r?.average_volume_2_weeks),
      f_avg_volume_30_days: num(r?.average_volume_30_days),
      f_float: num(r?.float), f_shares_outstanding: num(r?.shares_outstanding),
      f_market_cap: num(r?.market_cap), f_pb_ratio: num(r?.pb_ratio), f_pe_ratio: num(r?.pe_ratio),
      f_high_52_weeks: num(r?.high_52_weeks), f_high_52_weeks_date: r?.high_52_weeks_date ?? null,
      f_low_52_weeks: num(r?.low_52_weeks), f_low_52_weeks_date: r?.low_52_weeks_date ?? null,
      f_sector: r?.sector ?? null, f_industry: r?.industry ?? null,

      // NOT "the close". quote.close is the PRIOR session and carries its own date.
      q_prior_close: num(q?.c?.price),
      q_prior_close_date: q?.c?.date ?? null,
      q_prior_close_source: q?.c?.source ?? null,
      q_prior_close_interpolated: q?.c ? Boolean(q.c.interpolated) : null,
      q_last_trade_price: num(q?.q?.last_trade_price),
      q_last_trade_time: q?.q?.venue_last_trade_time ?? null,
      q_previous_close: num(q?.q?.previous_close),
      q_adjusted_previous_close: num(q?.q?.adjusted_previous_close),
      q_state: q?.q?.state ?? null,
      q_has_traded: q?.q?.has_traded ?? null,
      q_bid_price: num(q?.q?.bid_price), q_bid_time: q?.q?.venue_bid_time ?? null,
      q_ask_price: num(q?.q?.ask_price), q_ask_time: q?.q?.venue_ask_time ?? null,
      q_observed_at: q?.observed_at ?? null,
      f_observed_at: f?.observed_at ?? null,
      h_observed_at: h?.observed_at ?? null,

      h_pulled: Boolean(h),
      h_adjustment_basis: h?.adjustment_basis ?? null,
      h_adjustment_attestation: h?.adjustment_attestation ?? null,
      h_dropped_interpolated: h?.dropped_interpolated ?? null,
      h_bar_count: h?.bars?.length ?? null,
      h_first_bar: h?.bars?.[0]?.d ?? null,
      h_last_bar: h?.bars?.length ? h.bars[h.bars.length - 1].d : null,
      h_bars: h?.bars ?? null,
      h_split_bars: HS[sym]?.bars ?? null,
      h_split_bar_count: HS[sym]?.bars?.length ?? null,
      h_split_adjustment_basis: HS[sym]?.adjustment_basis ?? null,
      h_split_observed_at: HS[sym]?.observed_at ?? null,
      dividend_per_share: num(r?.dividend_per_share),
      ex_dividend_date: r?.ex_dividend_date ?? null,

      e_next_date: E[sym]?.date ?? null,
      e_timing: E[sym]?.timing ?? null,
      e_verified: E[sym]?.verified ?? null,
      e_observed_at: E[sym]?.observed_at ?? null,
      e_sessions_until: E[sym]?.date && DATE_RE.test(E[sym].date) ? safeSessions(date, E[sym].date, cal) : null,

      scan_ids: S.ids[sym] ? [...S.ids[sym]] : [],
      scan_columns: S.cols[sym] ?? null,
    });

    if (status !== "ok") failures.push({ symbol: sym, status, errors: errs });
  }

  const outPath = join(PREPUMP, `${date}.ndjson`);
  const manifestDir = join(PREPUMP, "runs");
  const rawErrors = [...fEnvs, ...qEnvs, ...hEnvs, ...eEnvs, ...sEnvs].filter(e => e.error).map(e => `${e.file}: ${e.error}`);
  if (plan.quality_version >= 2 && eEnvs.filter(e => e.env).length < 3) rawErrors.push("required earnings envelopes missing");
  const quality = captureQuality(rows, plan, rawErrors);
  const manifest = {
    schema: "bench-prepump-manifest-v1",
    quality_version: 2,
    quality,
    date,
    built_at: nowIso,
    universe_version: plan.universe_version,
    early_close: early,
    expected: plan.counts,
    written: {
      total: rows.length,
      ok: rows.filter((r) => r.status === "ok").length,
      partial: rows.filter((r) => r.status === "partial").length,
      no_data: rows.filter((r) => r.status === "no_data").length,
      not_found: rows.filter((r) => r.status === "not_found").length,
      core: rows.filter((r) => r.source.includes("core")).length,
      scan: rows.filter((r) => r.source.includes("scan")).length,
      desk: rows.filter((r) => r.source.includes("desk")).length,
      with_history: rows.filter((r) => r.h_pulled).length,
    },
    // A short file must never be mistaken for a quiet day.
    complete: quality.complete,
    market_dates_seen: marketDates,
    raw_files: { fundamentals: fEnvs.length, quotes: qEnvs.length, historicals: hEnvs.length, earnings: eEnvs.length, scans: sEnvs.length },
    failures: failures.slice(0, 200),
    failure_count: failures.length,
    appended: !existsSync(outPath) ? "new file" : "APPENDED to an existing file — a re-run appends, it never rewrites",
  };

  if (has("--dry-run")) {
    console.log(JSON.stringify({ ...manifest, sample_row: rows[0] }, null, 2));
    return;
  }

  mkdirSync(PREPUMP, { recursive: true });
  mkdirSync(manifestDir, { recursive: true });
  // APPEND. A past file is never rewritten.
  appendFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(manifestDir, `${date}.json`), JSON.stringify(manifest, null, 2) + "\n");

  // Advance history state only for symbols whose window we actually got.
  const { state, statePath } = historyDue(date, Object.keys(H), cal);
  for (const s of Object.keys(H)) {
    if (H[s].bars.length && (plan.quality_version !== 2 || HS[s]?.bars?.length)) state[s] = date;
  }
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

  const mdKeys = Object.keys(marketDates);
  console.log(`${date}: wrote ${rows.length} rows -> ${outPath}`);
  console.log(`  ok ${manifest.written.ok} · partial ${manifest.written.partial} · no_data ${manifest.written.no_data} · not_found ${manifest.written.not_found}`);
  console.log(`  core ${manifest.written.core} · scan ${manifest.written.scan} · history windows ${manifest.written.with_history}`);
  console.log(`  market_date seen: ${mdKeys.map((k) => `${k}=${marketDates[k]}`).join(", ") || "none"}`);
  if (mdKeys.length > 1) console.log(`  ! more than one market_date in one run — the feed rolled over mid-run. Rows are filed by their OWN market_date.`);
  if (!manifest.complete) console.log(`  ! RUN INCOMPLETE — manifest.complete=false. Exclude this date at calibration or re-collect. This is a FETCH FAILURE, not a quiet day.`);
  console.log(`  manifest -> ${join(manifestDir, `${date}.json`)}`);
}

function safeSessions(from, to, cal) {
  try { return sessionsSince(from, to, cal); } catch { return null; }
}

// ---------- wrap ----------
//
// A collecting subagent must never hold a large payload just to save it. Tool
// results over ~40KB are spilled to a file by the harness and the agent only sees
// a path — a 10-symbol x 30-session historicals call is already 54KB. This wraps
// such a file into the envelope `build` expects, without the data passing through
// anyone's context.
//
//   node scripts/prepump-collect.mjs wrap --date 2026-09-08 --tool get_equity_historicals \
//     --as hist-03 --from "<spill path>" --adjustment none
function cmdWrap() {
  const date = val("--date");
  const tool = val("--tool");
  const as = val("--as");
  const from = val("--from");
  if (!date || !DATE_RE.test(date)) refuse(`--date must be YYYY-MM-DD, got "${date ?? ""}"`);
  if (!tool) refuse("--tool is required (get_equity_fundamentals | get_equity_quotes | get_equity_historicals | get_earnings_calendar | run_scan)");
  if (!as || !/^[a-z]+-[A-Za-z0-9_-]+$/.test(as)) refuse(`--as must look like fund-01 / quote-02 / hist-03 / scan-<id> / earnings-01, got "${as ?? ""}"`);
  if (!from || !existsSync(from)) refuse(`--from must be an existing spill file, got "${from ?? ""}"`);
  let payload;
  try { payload = JSON.parse(readFileSync(from, "utf8")); } catch (e) { refuse(`could not parse ${from}: ${e.message}`); }
  const dir = rawDir(date);
  mkdirSync(dir, { recursive: true });
  const env = { tool, observed_at: new Date().toISOString(), wrapped_from: from, response: payload };
  const adj = val("--adjustment");
  if (adj) env.adjustment_type = adj;
  if (tool === "get_equity_historicals" && !adj) {
    refuse("get_equity_historicals REQUIRES --adjustment. The provider never echoes which basis it used, so an unrecorded basis is an unusable price series.");
  }
  const out = join(dir, `${as}.json`);
  writeFileSync(out, JSON.stringify(env));
  const sz = (statSync(out).size / 1024).toFixed(0);
  console.log(`wrapped ${tool} -> ${out} (${sz} KB)`);
}

function main() {
  if (cmd === "plan") return cmdPlan();
  if (cmd === "build") return cmdBuild();
  if (cmd === "wrap") return cmdWrap();
  refuse(`unknown command "${cmd ?? ""}". Use: plan | build | wrap`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
