import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { historyRequest } from '../scripts/prepump-outcomes.mjs';
import { loadCalendar, shiftSessions } from '../scripts/prepump-session.mjs';
const script=fileURLToPath(new URL('../scripts/prepump-outcomes.mjs',import.meta.url));
const cal=loadCalendar();
function run(root,args,status=0){const r=spawnSync(process.execPath,[script,...args],{env:{...process.env,BENCH_ROOT:root},encoding:'utf8'});assert.equal(r.status,status,r.stderr+'\n'+r.stdout);return JSON.parse(r.stdout);}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'bench-outcome-boundary-'));const base=join(root,'db/prepump');mkdirSync(base,{recursive:true});
 writeFileSync(join(base,'2026-09-14.ndjson'),JSON.stringify({symbol:'AAPL',date:'2026-09-14',status:'ok',source:['core']})+'\n');
 return {root,base};
}
function history(base,anchor,age,{omitSymbol=false,omitSpy=false,name='hist-01.json'}={}){
 const days=Array.from({length:age+1},(_,i)=>shiftSessions('2026-09-14',i,cal));
 const results=['AAPL','SPY'].map(symbol=>({symbol,bars:days.filter((_,i)=>!(i===age&&((symbol==='AAPL'&&omitSymbol)||(symbol==='SPY'&&omitSpy)))).map(d=>({begins_at:d+'T00:00:00Z',close_price:'100',high_price:'101',low_price:'99'}))}));
 writeFileSync(join(base,'raw-outcomes',anchor,name),JSON.stringify({adjustment_type:'split',response:{results}}));
}
test('request includes the anchor with an explicit next-calendar-day UTC endpoint',()=>{
 for(const [day,next]of [['2026-10-02','2026-10-03'],['2026-09-30','2026-10-01'],['2026-12-31','2027-01-01']]){
  const request=historyRequest('2026-09-03',day);assert.equal(request.start_time,'2026-08-29T00:00:00.000Z');assert.equal(request.end_time,next+'T00:00:00.000Z');assert.equal(request.adjustment_type,'split');
 }
 assert.throws(()=>historyRequest('2026-02-30','2026-10-02'),/bad date/);
});
test('partial successful revision remains incomplete, retry appends and preserves original receipt',()=>{
 const {root,base}=fixture();const anchor='2026-10-02';const plan=run(root,['plan','--asof',anchor]);assert.equal(plan.history_request.end_time,'2026-10-03T00:00:00.000Z');
 history(base,anchor,14,{omitSymbol:true,omitSpy:true});
 const coverage=run(root,['verify-history','--asof',anchor],1);assert.equal(coverage.incomplete_pairs,1);assert.deepEqual(coverage.missing[0].symbol_dates,[anchor]);assert.deepEqual(coverage.missing[0].benchmark_dates,[anchor]);
 const first=run(root,['build','--asof',anchor],1);assert.equal(first.scored,1);assert.equal(first.skipped,0);assert.equal(first.complete,false);assert.equal(first.pending,1);assert.deepEqual(first.pending_detail[0].pending_horizons,[14]);
 const output=join(base,'outcomes',anchor+'.ndjson'),before=readFileSync(output,'utf8');const manifestPath=join(base,'runs','outcomes-'+anchor+'.json'),receipt=readFileSync(manifestPath,'utf8');
 const fileList=()=>readdirSync(join(base,'runs')).sort();const beforeFiles=fileList();run(root,['build','--asof',anchor,'--dry-run'],1);assert.deepEqual(fileList(),beforeFiles);assert.equal(readFileSync(output,'utf8'),before);
 history(base,anchor,14,{name:'hist-zz-retry.json'});assert.equal(run(root,['verify-history','--asof',anchor]).complete,true);
 const second=run(root,['build','--asof',anchor]);assert.equal(second.pending,0);assert.equal(second.complete,true);
 const after=readFileSync(output,'utf8');assert.ok(after.startsWith(before));const rows=after.trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert.equal(rows[1].revision,2);assert.ok(rows[1].completed_horizons.includes(14));
 const previous=fileList().filter(f=>f.endsWith('.previous'));assert.equal(previous.length,1);assert.equal(readFileSync(join(base,'runs',previous[0]),'utf8'),receipt);
 assert.equal(readFileSync(join(base,'2026-09-14.ndjson'),'utf8'),JSON.stringify({symbol:'AAPL',date:'2026-09-14',status:'ok',source:['core']})+'\n');
});
test('benchmark alone missing final day fails coverage and replanning preserves old plan',()=>{
 const {root,base}=fixture();const anchor='2026-09-28';run(root,['plan','--asof',anchor]);const raw=join(base,'raw-outcomes',anchor),original=readFileSync(join(raw,'plan.json'),'utf8');history(base,anchor,10,{omitSpy:true});
 const report=run(root,['verify-history','--asof',anchor],1);assert.deepEqual(report.missing[0].symbol_dates,[]);assert.deepEqual(report.missing[0].benchmark_dates,[anchor]);
 run(root,['plan','--asof',anchor]);const prior=readdirSync(raw).find(f=>f.endsWith('.previous'));assert.ok(prior);assert.equal(readFileSync(join(raw,prior),'utf8'),original);
});
