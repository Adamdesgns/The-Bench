import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { computeOutcome, pendingHorizons, SCHEMA } from '../scripts/prepump-outcomes.mjs';
import { captureQuality, selectPopulation, readRows, resolutionBlocks } from '../scripts/prepump-integrity.mjs';
import { createBackup, verifyBackup, restoreBackup, backupDifferences } from '../scripts/prepump-backup.mjs';
import { expectedThrough, auditCapture } from '../scripts/prepump-health.mjs';
import { loadCalendar, shiftSessions, toUTC } from '../scripts/prepump-session.mjs';
import { indexHistoricals } from '../scripts/prepump-collect.mjs';
const cal=loadCalendar();
const scripts=fileURLToPath(new URL('../scripts/',import.meta.url));
const temp=()=>mkdtempSync(join(tmpdir(),'bench-reliability-'));
function put(root,p,value){const file=join(root,p);mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));}
function cli(root,name,args,status=0){const r=spawnSync(process.execPath,[join(scripts,name),...args],{env:{...process.env,BENCH_ROOT:root},encoding:'utf8'});assert.equal(r.status,status,r.stdout+'\n'+r.stderr);return r;}
const dates=Array.from({length:30},(_,i)=>shiftSessions('2026-09-08',i+1,cal));
const bars=()=>Object.fromEntries(dates.map((d,i)=>[d,{o:100,c:100,h:i===13?200:101,l:i===13?50:99,v:100}]));
test('10-session extremes cannot include a session-14 spike or crash',()=>{
  const r=computeOutcome(100,dates,bars());assert.equal(r.max_intraday_high,101);assert.equal(r.min_intraday_low,99);assert.equal(r.horizons[14].max_intraday_high,200);assert.equal(r.horizons[14].min_intraday_low,50);
});
test('a missing or null price keeps affected windows unscored',()=>{
  const b=bars();delete b[dates[4]];const r=computeOutcome(100,dates,b);assert.ok(r.horizons[3]);assert.equal(r.horizons[5],null);assert.equal(r.horizons[30],null);
  b[dates[4]]={c:null,h:100,l:90};assert.equal(computeOutcome(100,dates,b).horizons[10],null);
});
test('long horizons become due even when the initial ten-session result exists',()=>{
  const prior={schema:SCHEMA,completed_horizons:[1,3,5,7,10]};assert.deepEqual(pendingHorizons(prior,13),[]);assert.deepEqual(pendingHorizons(prior,14),[14]);assert.deepEqual(pendingHorizons(prior,30),[14,30]);assert.equal(pendingHorizons({schema:'bench-prepump-outcome-v1'},30).length,7);
});
const goodRow={symbol:'AAPL',date:'2026-09-08',market_date_reported:'2026-09-08',source:['core'],status:'ok',f_open:100,f_high:101,f_low:99,f_volume:1000,q_last_trade_price:100,q_last_trade_time:'2026-09-08T20:00:00Z',observed_at:'2026-09-08T21:30:00Z',h_bar_count:30,h_adjustment_basis:'none',h_split_bar_count:30,h_split_adjustment_basis:'split'};
const plan={date:'2026-09-08',quality_version:2,counts:{total:1,core:1,scan:0,desk:0},symbols:[{symbol:'AAPL',history_due:true}]};
test('capture requires every active row, both history bases and correct session',()=>{
  assert.equal(captureQuality([goodRow],plan).complete,true);
  for(const change of [{status:'partial'},{h_bar_count:0},{h_split_bar_count:0},{date:'2026-09-04'},{q_last_trade_time:null}])assert.equal(captureQuality([{...goodRow,...change}],plan).complete,false);
  assert.equal(captureQuality([goodRow],plan,['broken envelope']).complete,false);
});
test('blocked symbols retain core membership and remain explicitly unready for research',()=>{
  const r=captureQuality([{...goodRow,status:'resolution_blocked'}],plan);assert.equal(r.complete,true);assert.equal(r.research_ready,false);
  const root=temp();put(root,'db/prepump/2026-09-08.ndjson',JSON.stringify({...goodRow,status:'not_found'})+'\n');assert.ok(resolutionBlocks(root).has('AAPL'));
});
test('population must be named and corruption is never silently dropped',()=>{
  assert.throws(()=>selectPopulation([goodRow]),/population/);assert.equal(selectPopulation([goodRow,{source:['desk']}],'core').length,1);
  const root=temp();put(root,'bad.ndjson','{bad}\n');assert.throws(()=>readRows(join(root,'bad.ndjson')),/Corrupt JSON/);
});
test('raw and split-adjusted histories cannot overwrite one another',()=>{
  const env=basis=>({env:{adjustment_type:basis,response:{results:[{symbol:'X',bars:[{begins_at:'2026-09-08',close_price:basis==='none'?100:10}]}]}}});
  const input=[env('split'),env('none')];assert.equal(indexHistoricals(input).X.bars[0].c,100);assert.equal(indexHistoricals(input,'split').X.bars[0].c,10);
});
test('missed-run deadline uses Central time and survives DST/weekends',()=>{
  assert.equal(expectedThrough(new Date('2026-09-14T22:59:00Z'),cal),'2026-09-11');
  assert.equal(expectedThrough(new Date('2026-09-14T23:01:00Z'),cal),'2026-09-14');
  assert.equal(expectedThrough(new Date('2026-11-03T00:01:00Z'),cal),'2026-11-02');
  assert.equal(expectedThrough(new Date('2026-09-13T23:01:00Z'),cal),'2026-09-11');
});
test('health detects a missing file despite the calendar day having passed',()=>{
  const root=temp();put(root,'db/prepump/universe-core.json',{symbols:[{symbol:'AAPL'}]});assert.ok(auditCapture(root,'2026-09-08',cal).issues.some(x=>x.includes('missing')));
});
test('impossible dates refuse instead of rolling into the next month',()=>{assert.throws(()=>toUTC('2026-02-30'),/bad date/);});
test('local backup restores exact bytes, retains history and detects damage',()=>{
  const root=temp(),source=join(root,'source'),backup=join(root,'backup');put(root,'source/day.ndjson','{"x":1}\n');put(root,'source/nested/state.json','{"x":2}\n');
  const first=createBackup(source,backup);assert.equal(verifyBackup(first.manifestPath).files.length,2);
  put(root,'source/day.ndjson','{"x":1}\n{"x":3}\n');assert.deepEqual(backupDifferences(source,verifyBackup(first.manifestPath)),['day.ndjson']);createBackup(source,backup);
  assert.equal(restoreBackup(first.manifestPath,join(root,'restored')),2);assert.equal(readFileSync(join(root,'restored/day.ndjson'),'utf8'),'{"x":1}\n');
  assert.throws(()=>restoreBackup(first.manifestPath,source),/must not exist/);
  const hash=verifyBackup(first.manifestPath).files[0].sha256;writeFileSync(join(backup,'objects',hash),'damaged');assert.throws(()=>verifyBackup(first.manifestPath),/Corrupt backup/);
});
test('backup refuses nesting and sync destinations',()=>{
  const root=temp();put(root,'source/file','x');assert.throws(()=>createBackup(join(root,'source'),join(root,'source/backup')),/separate/);assert.throws(()=>createBackup(join(root,'source'),join(root,'OneDrive/backup')),/sync/);
});
function outcomeFixture(){
  const root=temp();put(root,'db/prepump/2026-09-08.ndjson',JSON.stringify({...goodRow,q_last_trade_price:100})+'\n');return root;
}
function rawOutcome(root,age,{missingSpy=false,basis='split'}={}){
  const anchor=shiftSessions('2026-09-08',age,cal);cli(root,'prepump-outcomes.mjs',['plan','--asof',anchor]);
  const ds=['2026-09-08',...dates.slice(0,age)];
  const results=['AAPL','SPY'].map(symbol=>({symbol,bars:ds.filter((_,i)=>!(missingSpy&&symbol==='SPY'&&i===5)).map(d=>({begins_at:d+'T00:00:00Z',open_price:100,close_price:100,high_price:d===dates[13]?200:101,low_price:99,volume:1000}))}));
  put(root,`db/prepump/raw-outcomes/${anchor}/hist-01.json`,{adjustment_type:basis,observed_at:anchor+'T23:00:00Z',response:{results}});return anchor;
}
test('CLI lifecycle appends 10/14/30-session revisions and stops when fully mature',()=>{
  const root=outcomeFixture(),original=readFileSync(join(root,'db/prepump/2026-09-08.ndjson'));
  let firstBytes,firstPath;
  for(const [revision,age]of [10,14,30].entries()){
    const anchor=rawOutcome(root,age);cli(root,'prepump-outcomes.mjs',['build','--asof',anchor]);
    const p=join(root,`db/prepump/outcomes/${anchor}.ndjson`),r=readRows(p)[0];assert.equal(r.revision,revision+1);assert.equal(r.max_intraday_high_10d,101);assert.equal(r.fully_mature,age===30);
    if(age===10){assert.equal(r.max_close_gain_30d,null);firstPath=p;firstBytes=readFileSync(p);}
  }
  cli(root,'prepump-outcomes.mjs',['plan','--asof',dates[29]],1);assert.deepEqual(readFileSync(firstPath),firstBytes);assert.deepEqual(readFileSync(join(root,'db/prepump/2026-09-08.ndjson')),original);
});
test('missing benchmark bars leave the pair pending; raw price bases refuse',()=>{
  const root=outcomeFixture(),anchor=rawOutcome(root,10,{missingSpy:true});cli(root,'prepump-outcomes.mjs',['build','--asof',anchor],1);assert.equal(existsSync(join(root,'db/prepump/outcomes')),false);cli(root,'prepump-outcomes.mjs',['plan','--asof',anchor]);
  rawOutcome(root,10,{basis:'none'});cli(root,'prepump-outcomes.mjs',['build','--asof',anchor],2);
});
test('collector keeps a blocked core placeholder but excludes it from provider batches',()=>{
  const root=temp();put(root,'db/prepump/universe-core.json',{_version:'test',symbols:[{symbol:'AAPL'},{symbol:'MSFT'}]});put(root,'db/prepump/2026-09-08.ndjson',JSON.stringify({...goodRow,status:'not_found'})+'\n');
  cli(root,'prepump-collect.mjs',['plan','--date','2026-09-09']);const p=JSON.parse(readFileSync(join(root,'db/prepump/raw/2026-09-09/plan.json')));assert.equal(p.counts.core,2);assert.deepEqual(p.batches.fundamentals,[['MSFT']]);assert.ok(p.symbols.find(s=>s.symbol==='AAPL').resolution_blocked);
});
