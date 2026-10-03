// predict.mjs — the prediction ledger: every forward claim is scored against what happened, and
// each source's stated odds are put beside its record.
//
//   node scripts/predict.mjs add --source options-hunter --ticker HIMS --side long --made 2026-10-02 \
//        --price 29.74 --sessions 10 [--target 33.14] [--stop 28.11] [--p-dir 52.81] [--p-reach 31.46] \
//        [--claim "..."] [--row B-695] [--receipt fbc706f6]
//   node scripts/predict.mjs import --options db/hunts/options/2026-10-01.candidates.json [--write]
//   node scripts/predict.mjs check [--write] [--bars-file f.json] [--asof YYYY-MM-DD]
//   node scripts/predict.mjs report [--json]
//   node scripts/predict.mjs list [--open]
//   add --db f.json to any command for an offline test file
//
// WHY THIS EXISTS (2026-10-02, Adam: "Anytime there is a prediction log it and watch it")
// ----------------------------------------------------------------------------------------
// The options hunter called HIMS STALK long (29.74 -> 33.14, stop 28.11) and said 31.46% of past
// cases like it reached the target in 10 sessions. The desk said no trade (B-691/B-693). Nothing on
// this desk could say, a month later, whether the hunter's "31%" means 31%. A book row scores one
// call; it cannot tell you whether a source is honest. This file can: it records what each source
// said, scores it on the horizon the source itself used, and reports stated odds beside the record.
//
// SCORING (the hunter's own definitions, options-hunter.mjs baseRate):
//   horizon  the Nth settled session AFTER the made date (counted in bars, so holidays do not shorten it)
//   dir      long: horizon close > price · short: horizon close < price
//   reach    long: horizon close >= target · short: horizon close <= target (close-to-close, at the horizon)
//   path     the first settled close through the target or the stop on the way; neither = timeout
//   R        target first = the plan's R:R · stop first = -1 · timeout = R at the horizon close
//
// THE LINE IT DOES NOT CROSS: nothing here writes the book, grades a row, or is a signal. It writes
// only db/predictions.json. A prediction that cannot be scored (no horizon) is refused at entry.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const r2 = (x) => Math.round(x * 100) / 100;
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export function addWeekdays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  let k = 0;
  while (k < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) k++;
  }
  return d.toISOString().slice(0, 10);
}

const isShort = (p) => p.side === "short";

function hits(p, close) {
  const target = p.target == null ? false : isShort(p) ? close <= p.target : close >= p.target;
  const stop = p.stop == null ? false : isShort(p) ? close > p.stop : close < p.stop;
  return { target, stop };
}

function rAt(p, price) {
  if (p.stop == null) return null;
  const risk = Math.abs(p.price - p.stop);
  if (!risk) return null;
  return r2((isShort(p) ? p.price - price : price - p.price) / risk);
}

export function scorePrediction(p, bars) {
  const after = bars
    .filter((b) => b.date > p.made && b.close != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, p.sessions);
  let path = null;
  for (const b of after) {
    const h = hits(p, b.close);
    if (h.stop) { path = { outcome: "stop", date: b.date, close: b.close }; break; }
    if (h.target) { path = { outcome: "target", date: b.date, close: b.close }; break; }
  }
  if (after.length < p.sessions) return { status: "open", sessions_done: after.length, path };
  const last = after[after.length - 1];
  const dir = isShort(p) ? last.close < p.price : last.close > p.price;
  const reach = p.target == null ? null : isShort(p) ? last.close <= p.target : last.close >= p.target;
  if (!path) path = { outcome: "timeout", date: last.date, close: last.close };
  const r_path = path.outcome === "target" ? rAt(p, p.target) : path.outcome === "stop" ? -1 : rAt(p, last.close);
  return { status: "scored", sessions_done: after.length, horizon_date: last.date, horizon_close: last.close, dir, reach, path, r_path };
}

export function fromOptionsCandidates(file) {
  return (file.candidates || [])
    .filter((c) => c.ok && c.geometry?.target != null && c.evidence?.p_dir != null && c.evidence?.horizon)
    .map((c) => ({
      source: "options-hunter",
      ticker: c.sym,
      side: c.side,
      made: c.date,
      price: c.geometry.entry,
      target: c.geometry.target,
      stop: c.geometry.stop,
      sessions: c.evidence.horizon,
      horizon_est: addWeekdays(c.date, c.evidence.horizon),
      p_dir: c.evidence.p_dir,
      p_reach: c.evidence.p_reach,
      grade: c.evidence.grade ?? null,
      n: c.evidence.n ?? null,
      list: c.list ?? null,
      readiness: c.readiness ?? null,
      receipt: file.id ?? null,
      claim: `${c.side} ${c.sym} ${c.geometry.entry} -> ${c.geometry.target} (stop ${c.geometry.stop}) in ${c.evidence.horizon} sessions, ${c.list}`,
    }));
}

const keyOf = (p) => `${p.source}|${p.ticker}|${p.side}`;

export function mergeNew(db, preds) {
  db.predictions ||= [];
  const open = new Set(db.predictions.filter((p) => p.status === "open").map(keyOf));
  let n = db.predictions.reduce((m, p) => Math.max(m, Number(String(p.id).replace(/\D/g, "")) || 0), 0);
  const added = [];
  for (const p of preds) {
    if (open.has(keyOf(p))) continue;
    const rec = { ...p, id: `PR-${String(++n).padStart(3, "0")}`, status: "open", score: null, logged: new Date().toISOString() };
    db.predictions.push(rec);
    open.add(keyOf(p));
    added.push(rec);
  }
  return added;
}

export function calibration(preds) {
  const acc = {};
  for (const p of preds) {
    const s = (acc[p.source] ||= { scored: 0, open: 0, pd: [], pr: [], dir: [], reach: [], r: [], paths: { target: 0, stop: 0, timeout: 0 } });
    if (p.status !== "scored") { s.open++; continue; }
    s.scored++;
    if (p.p_dir != null) s.pd.push(p.p_dir);
    if (p.p_reach != null) s.pr.push(p.p_reach);
    s.dir.push(p.score.dir ? 1 : 0);
    if (p.score.reach != null) s.reach.push(p.score.reach ? 1 : 0);
    s.paths[p.score.path.outcome]++;
    if (p.score.r_path != null) s.r.push(p.score.r_path);
  }
  const out = {};
  for (const [src, s] of Object.entries(acc)) {
    const pct = (a) => (a.length ? r2(avg(a) * 100) : null);
    out[src] = {
      scored: s.scored, open: s.open,
      stated_p_dir: s.pd.length ? r2(avg(s.pd)) : null, actual_dir: pct(s.dir),
      stated_p_reach: s.pr.length ? r2(avg(s.pr)) : null, actual_reach: pct(s.reach),
      paths: s.paths, avg_r: s.r.length ? r2(avg(s.r)) : null,
    };
  }
  return out;
}

// ---------- data ----------
async function yahooBars(symbol, range = "6mo") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TheBench predict.mjs)" } });
  if (!res.ok) throw new Error(`yahoo ${symbol}: ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp ?? [], q = r?.indicators?.quote?.[0] ?? {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null) continue;
    out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: q.close[i] });
  }
  return out;
}

// The last session whose close is settled: today only after 16:30 New York time.
function settledThrough(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const afterClose = Number(parts.hour) * 60 + Number(parts.minute) >= 16 * 60 + 30;
  return { today, inclusive: afterClose };
}

// ---------- cli ----------
function refuse(msg) { console.error(`predict: REFUSED - ${msg}`); process.exit(1); }

function line(p) {
  const lv = [p.target != null ? `target ${p.target}` : null, p.stop != null ? `stop ${p.stop}` : null].filter(Boolean).join(" ");
  const odds = [p.p_dir != null ? `p_dir ${p.p_dir}%` : null, p.p_reach != null ? `p_reach ${p.p_reach}%` : null].filter(Boolean).join(" ");
  return `${p.id} ${p.ticker} ${p.side} (${p.source}) from ${p.price} on ${p.made} -> ${p.sessions} sessions (~${p.horizon_est})${lv ? ` | ${lv}` : ""}${odds ? ` | stated ${odds}` : ""}${p.row ? ` | ${p.row}` : ""}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : null; };
  const num = (n) => (val(n) === null ? null : Number(val(n)));
  const flag = (n) => argv.includes(n);
  const DB = resolve(val("--db") || resolve(ROOT, "db/predictions.json"));
  const db = existsSync(DB) ? JSON.parse(readFileSync(DB, "utf8")) : { predictions: [] };
  const save = () => writeFileSync(DB, JSON.stringify(db, null, 2) + "\n");

  if (cmd === "add") {
    for (const req of ["--source", "--ticker", "--side", "--made", "--price", "--sessions"]) {
      if (val(req) === null) refuse(`${req} is required${req === "--sessions" ? " (the horizon in sessions - without it the prediction can never be scored)" : ""}`);
    }
    const side = val("--side");
    if (side !== "long" && side !== "short") refuse("--side must be long or short");
    const p = {
      source: val("--source"), ticker: val("--ticker").toUpperCase(), side, made: val("--made"), price: num("--price"),
      target: num("--target"), stop: num("--stop"), sessions: num("--sessions"),
      horizon_est: addWeekdays(val("--made"), num("--sessions")),
      p_dir: num("--p-dir"), p_reach: num("--p-reach"), claim: val("--claim"), row: val("--row"), receipt: val("--receipt"),
    };
    const added = mergeNew(db, [p]);
    if (!added.length) { console.log(`SKIPPED - an open ${p.source} ${p.side} prediction on ${p.ticker} already exists`); return; }
    save();
    console.log(`LOGGED ${line(added[0])}`);
    return;
  }

  if (cmd === "import") {
    const f = val("--options");
    if (!f) refuse("import needs --options <candidates.json>");
    const added = mergeNew(db, fromOptionsCandidates(JSON.parse(readFileSync(resolve(f), "utf8"))));
    for (const p of added) console.log(`  ${line(p)}`);
    if (flag("--write")) { save(); console.log(`IMPORTED ${added.length} prediction(s) -> ${DB}`); }
    else console.log(`DRY RUN - ${added.length} prediction(s) would be added (pass --write)`);
    return;
  }

  if (cmd === "check") {
    const open = db.predictions.filter((p) => p.status === "open");
    const file = val("--bars-file") ? JSON.parse(readFileSync(resolve(val("--bars-file")), "utf8")) : null;
    const asof = val("--asof");
    const { today, inclusive } = settledThrough();
    let scored = 0;
    for (const p of open) {
      let bars;
      try { bars = file ? file[p.ticker] || [] : await yahooBars(p.ticker); }
      catch (e) { console.log(`${p.id} ${p.ticker} NO DATA - ${e.message}`); continue; }
      if (asof) bars = bars.filter((b) => b.date <= asof);
      else if (!file) bars = bars.filter((b) => (inclusive ? b.date <= today : b.date < today));
      const s = scorePrediction(p, bars);
      if (s.status === "scored") {
        scored++;
        console.log(`${p.id} ${p.ticker} ${p.side} (${p.source}) SCORED ${s.horizon_date} close ${r2(s.horizon_close)} | dir ${s.dir ? "HIT" : "MISS"} reach ${s.reach == null ? "-" : s.reach ? "HIT" : "MISS"} | path ${s.path.outcome.toUpperCase()} ${s.path.date} | R ${s.r_path ?? "-"}`);
        if (flag("--write")) { p.status = "scored"; p.score = s; delete p.progress; }
      } else {
        console.log(`${p.id} ${p.ticker} ${p.side} (${p.source}) OPEN ${s.sessions_done}/${p.sessions} sessions${s.path ? ` | path so far ${s.path.outcome.toUpperCase()} ${s.path.date}` : ""}`);
        if (flag("--write")) p.progress = s;
      }
    }
    if (flag("--write")) save();
    console.log(`${open.length} open checked, ${scored} scored${flag("--write") ? "" : " (dry run - pass --write to save)"}`);
    return;
  }

  if (cmd === "report") {
    const c = calibration(db.predictions);
    if (flag("--json")) { console.log(JSON.stringify(c, null, 2)); return; }
    const total = db.predictions.length, done = db.predictions.filter((p) => p.status === "scored").length;
    console.log(`PREDICTION LEDGER - ${done} scored, ${total - done} open`);
    for (const [src, s] of Object.entries(c)) {
      console.log(`${src}  scored ${s.scored}  open ${s.open}${s.scored && s.scored < 20 ? "  (under 20 scored - too few to judge the odds)" : ""}`);
      if (!s.scored) continue;
      const pc = (x) => (x == null ? "-" : `${x}%`);
      console.log(`  dir    stated ${pc(s.stated_p_dir)}  actual ${pc(s.actual_dir)}`);
      console.log(`  reach  stated ${pc(s.stated_p_reach)}  actual ${pc(s.actual_reach)}`);
      console.log(`  path   target ${s.paths.target} · stop ${s.paths.stop} · timeout ${s.paths.timeout} · avg R ${s.avg_r ?? "-"}`);
    }
    return;
  }

  if (cmd === "list") {
    for (const p of db.predictions.filter((x) => !flag("--open") || x.status === "open")) console.log(`${p.status.toUpperCase().padEnd(6)} ${line(p)}`);
    return;
  }

  refuse("usage: predict.mjs add|import|check|report|list (see header)");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
