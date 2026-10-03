// Append-only forward price outcomes. Revisit incomplete horizons; never place orders.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCalendar, isTradingDay, sessionsSince, shiftSessions, todayET, lastSessionOnOrBefore, toUTC } from './prepump-session.mjs';
import { readRows, resolutionBlocks } from './prepump-integrity.mjs';
const ROOT = process.env.BENCH_ROOT ? resolve(process.env.BENCH_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREPUMP = join(ROOT, 'db/prepump'), OUT = join(PREPUMP, 'outcomes');
export const SCHEMA = 'bench-prepump-outcome-v2';
export const HORIZONS = [1, 3, 5, 7, 10, 14, 30];
export const REQUIRED_HORIZON = 10;
const argv = process.argv.slice(2), has = f => argv.includes(f), val = f => has(f) ? argv[argv.indexOf(f) + 1] : undefined;
const rawDir = d => join(PREPUMP, 'raw-outcomes', d);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const num = x => x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x);
const pct = (v, e) => finite(v) && finite(e) && e > 0 ? +((v / e - 1) * 100).toFixed(4) : null;
export function snapshotDates() { return existsSync(PREPUMP) ? readdirSync(PREPUMP).filter(f => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).sort().map(f => f.slice(0,10)) : []; }
export function loadSnapshots(dates) {
  const latest = new Map();
  for (const d of dates) for (const r of readRows(join(PREPUMP, `${d}.ndjson`))) {
    if (!r.symbol || !r.date) throw new Error('Snapshot missing symbol/date');
    latest.set(`${r.symbol}|${r.date}`, r);
  }
  return latest;
}
export function latestOutcomes() {
  const latest = new Map();
  if (existsSync(OUT)) for (const f of readdirSync(OUT).filter(f => f.endsWith('.ndjson')).sort()) {
    for (const r of readRows(join(OUT, f))) latest.set(`${r.symbol}|${r.entry_date}`, r);
  }
  return latest;
}
export function pendingHorizons(previous, age) {
  if (age < 10) return [];
  const done = new Set(previous?.schema === SCHEMA ? previous.completed_horizons ?? [] : []);
  return HORIZONS.filter(h => h <= age && !done.has(h));
}
// Compatibility: only a fully mature v2 row is finished.
export function scoredKeys() { return new Set([...latestOutcomes()].filter(([,r]) => r.schema === SCHEMA && HORIZONS.every(h => r.completed_horizons?.includes(h))).map(([k]) => k)); }
export function duePairs(asof, cal) {
  const prior = latestOutcomes(), blocked = resolutionBlocks(ROOT), due = [];
  for (const [key, snapshot] of loadSnapshots(snapshotDates())) {
    if (blocked.has(snapshot.symbol) || !['ok','partial'].includes(snapshot.status)) continue;
    const age = sessionsSince(snapshot.date, asof, cal), pending = pendingHorizons(prior.get(key), age);
    if (pending.length) due.push({symbol:snapshot.symbol, entry_date:snapshot.date, snapshot, age, pending_horizons:pending, previous:prior.get(key)});
  }
  return due.sort((a,b) => a.entry_date.localeCompare(b.entry_date) || a.symbol.localeCompare(b.symbol));
}
export const chunk = (items,n) => Array.from({length:Math.ceil(items.length/n)}, (_,i) => items.slice(i*n,(i+1)*n));
export function forwardDates(entry,n,cal) {
  const dates=[]; for(let d=entry,i=0;i<n;i++) { d=shiftSessions(d,1,cal); dates.push(d); } return dates;
}
export function indexBars(dir) {
  const by={}, meta={};
  if (existsSync(dir)) for(const file of readdirSync(dir).filter(f => /^hist-.*\.json$/.test(f)).sort()) {
    const env=JSON.parse(readFileSync(join(dir,file),'utf8'));
    if(env.adjustment_type !== 'split') throw new Error(`${file}: v2 outcomes require explicit split-adjusted history`);
    const data=env.response?.data ?? env.response ?? env.data ?? env;
    for(const r of data.results ?? []) {
      const indexed=by[r.symbol] ||= {};
      for(const b of r.bars ?? []) {
        if(b.interpolated) continue;
        const d=String(b.begins_at).slice(0,10); toUTC(d);
        indexed[d]={o:num(b.open_price),h:num(b.high_price),l:num(b.low_price),c:num(b.close_price),v:num(b.volume)};
      }
      meta[r.symbol]={adjustment_basis:'split', observed_at:env.observed_at ?? null};
    }
  }
  return {by,meta};
}
export function computeOutcome(entry,dates,bars) {
  const horizons={};
  for(const h of HORIZONS) {
    const window=dates.slice(0,h).map(d => bars[d]);
    if(!finite(entry) || entry<=0 || window.length<h || window.some(b => !b || ![b.c,b.h,b.l].every(finite) || b.c<=0 || b.h<b.l)) { horizons[h]=null; continue; }
    const closes=window.map(b=>b.c), high=Math.max(...window.map(b=>b.h)), low=Math.min(...window.map(b=>b.l));
    horizons[h]={max_close_gain_pct:pct(Math.max(...closes),entry),worst_close_pct:pct(Math.min(...closes),entry),close_at_h_pct:pct(closes.at(-1),entry),close_at_h:closes.at(-1),max_intraday_high:high,max_intraday_high_gain_pct:pct(high,entry),min_intraday_low:low,min_intraday_low_pct:pct(low,entry)};
  }
  return {horizons,max_intraday_high:horizons[10]?.max_intraday_high ?? null,max_intraday_high_gain_pct:horizons[10]?.max_intraday_high_gain_pct ?? null,min_intraday_low:horizons[10]?.min_intraday_low ?? null,min_intraday_low_pct:horizons[10]?.min_intraday_low_pct ?? null,missing_sessions:dates.filter(d=>!bars[d] || ![bars[d].c,bars[d].h,bars[d].l].every(finite)).length};
}
function context() {
  const asof=val('--asof') ?? todayET(); toUTC(asof);
  const cal=loadCalendar(),anchor=isTradingDay(asof,cal)?asof:lastSessionOnOrBefore(asof,cal);
  return {asof,cal,anchor};
}
function cmdPlan() {
  const {asof,cal,anchor}=context(), due=duePairs(anchor,cal);
  if(!due.length) { console.log(`nothing due as of ${asof}; resolution-blocked: ${resolutionBlocks(ROOT).size}`); process.exitCode=1; return; }
  const symbols=[...new Set([...due.map(d=>d.symbol),'SPY'])].sort();
  const plan={schema:'bench-prepump-outcome-plan-v2',asof,anchor_session:anchor,planned_at:new Date().toISOString(),pairs_due:due.length,symbols_needed:symbols.length,benchmark:'SPY',adjustment_type:'split',bars_from:shiftSessions(due[0].entry_date,-2,cal),bars_to:anchor,batches:chunk(symbols,10),entry_dates:[...new Set(due.map(d=>d.entry_date))],blocked_symbols:Object.fromEntries(resolutionBlocks(ROOT))};
  console.log(JSON.stringify(plan,null,2));
  if(has('--dry-run'))return;
  mkdirSync(rawDir(anchor),{recursive:true});writeFileSync(join(rawDir(anchor),'plan.json'),JSON.stringify(plan,null,2)+'\n');
}
function cmdBuild() {
  const {asof,cal,anchor}=context();
  const plan=JSON.parse(readFileSync(join(rawDir(anchor),'plan.json'),'utf8'));
  if(plan.schema!=='bench-prepump-outcome-plan-v2'||plan.anchor_session!==anchor)throw new Error('Wrong outcome plan version/session');
  const {by,meta}=indexBars(rawDir(anchor)); if(!by.SPY)throw new Error('SPY history is mandatory');
  const due=duePairs(anchor,cal),rows=[],skipped=[];
  for(const d of due) {
    const skip=reason=>skipped.push({symbol:d.symbol,entry_date:d.entry_date,reason});
    const bars=by[d.symbol],entry=bars?.[d.entry_date]?.c,spyEntry=by.SPY[d.entry_date]?.c;
    if(!finite(entry)||entry<=0||!finite(spyEntry)||spyEntry<=0) {skip('settled split-adjusted symbol/benchmark entry missing; no provisional fallback');continue;}
    const dates=forwardDates(d.entry_date,Math.min(30,d.age),cal), sym=computeOutcome(entry,dates,bars),bench=computeOutcome(spyEntry,dates,by.SPY);
    const completed=HORIZONS.filter(h=>sym.horizons[h]&&bench.horizons[h]);
    const old=d.previous?.schema===SCHEMA?d.previous.completed_horizons??[]:[];
    if(old.some(h=>!completed.includes(h))) {skip('pull would regress a completed horizon; retry full bars');continue;}
    if(!completed.includes(10)||!d.pending_horizons.some(h=>completed.includes(h))) {skip('contiguous symbol/benchmark window missing or no newly completed horizon');continue;}
    const horizons=Object.fromEntries(HORIZONS.map(h=>[h,completed.includes(h)?sym.horizons[h]:null]));
    const benchmark=Object.fromEntries(HORIZONS.map(h=>[h,completed.includes(h)?bench.horizons[h]:null]));
    const row={schema:SCHEMA,symbol:d.symbol,entry_date:d.entry_date,asof_session:anchor,scored_at:new Date().toISOString(),revision:(d.previous?.revision??0)+1,completed_horizons:completed,fully_mature:completed.length===HORIZONS.length,horizons,benchmark_horizons:benchmark,source:d.snapshot.source,universe_version:d.snapshot.universe_version,core_band:d.snapshot.core_band,snapshot_observed_at:d.snapshot.observed_at,identity_status:d.snapshot.identity_status??'stable_provider_id_unavailable',adjustment_basis:'split',adjustment_attestation:'REQUEST_PARAMETER_ATTESTATION_ONLY',outcome_observed_at:meta[d.symbol]?.observed_at,return_kind:'split-adjusted price return; excludes dividends and trading costs',entry_close:entry,entry_close_source:'settled split-adjusted daily bar',spy_entry_close:spyEntry,entry_close_provisional_at_snapshot:d.snapshot.q_last_trade_price??null,entry_close_delta:null,entry_close_delta_note:'Raw provisional and later split-adjusted values may have different bases; not subtracted',executable_trade_return:false,forward_sessions:dates,missing_sessions:sym.missing_sessions,max_intraday_high_10d:horizons[10].max_intraday_high,max_intraday_high_gain_10d_pct:horizons[10].max_intraday_high_gain_pct,min_intraday_low_10d:horizons[10].min_intraday_low,min_intraday_low_10d_pct:horizons[10].min_intraday_low_pct,close_10d:horizons[10].close_at_h,close_10d_pct:horizons[10].close_at_h_pct,spy_close_10d_pct:benchmark[10].close_at_h_pct,spy_worst_close_pct_10d:benchmark[10].worst_close_pct};
    for(const h of HORIZONS) {row[`max_close_gain_${h}d`]=horizons[h]?.max_close_gain_pct??null;row[`worst_close_pct_${h}d`]=horizons[h]?.worst_close_pct??null;row[`spy_max_close_gain_${h}d`]=benchmark[h]?.max_close_gain_pct??null;}
    rows.push(row);
  }
  const manifest={schema:'bench-prepump-outcome-manifest-v2',asof,anchor_session:anchor,built_at:new Date().toISOString(),due:due.length,scored:rows.length,skipped:skipped.length,complete:skipped.length===0,horizons:HORIZONS,required_horizon:10,benchmark:'SPY',skipped_detail:skipped,fully_mature:rows.filter(r=>r.fully_mature).length,revisions:rows.filter(r=>r.revision>1).length};
  console.log(JSON.stringify(manifest,null,2)); if(has('--dry-run'))return;
  mkdirSync(join(PREPUMP,'runs'),{recursive:true});
  if(rows.length) {mkdirSync(OUT,{recursive:true});appendFileSync(join(OUT,`${anchor}.ndjson`),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');}
  writeFileSync(join(PREPUMP,'runs',`outcomes-${anchor}.json`),JSON.stringify(manifest,null,2)+'\n');
  if(!rows.length)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {if(argv[0]==='plan')cmdPlan();else if(argv[0]==='build')cmdBuild();else throw new Error('Use plan | build');}
  catch(e){console.error(`REFUSED: ${e.message}`);process.exitCode=2;}
}
