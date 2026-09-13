// Read-only audit: missed sessions, actual row coverage, label backlog, local backup.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCalendar, sessionsInRange, lastSessionOnOrBefore, shiftSessions, isTradingDay, toUTC } from './prepump-session.mjs';
import { readRows, resolutionBlocks } from './prepump-integrity.mjs';
import { duePairs } from './prepump-outcomes.mjs';
import { DEFAULT_BACKUP, verifyBackup, backupDifferences } from './prepump-backup.mjs';
const ROOT = process.env.BENCH_ROOT ? resolve(process.env.BENCH_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), val = f => argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined;
export function expectedThrough(now, cal) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type,p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  let through = lastSessionOnOrBefore(date, cal);
  // Capture starts 16:30 CT. Give it 90 minutes before declaring today's run missed.
  if (isTradingDay(date, cal) && Number(parts.hour) < 18) through = shiftSessions(date, -1, cal);
  return through;
}
export function auditCapture(root, through, cal) {
  const issues = [], warnings = [];
  const core = JSON.parse(readFileSync(join(root, 'db/prepump/universe-core.json'), 'utf8')).symbols.map(s => s.symbol);
  const dates = sessionsInRange('2026-09-08', through, cal);
  for (const date of dates) {
    const p = join(root,'db/prepump',`${date}.ndjson`), m = join(root,'db/prepump/runs',`${date}.json`);
    if (!existsSync(p) || !existsSync(m)) { issues.push(`${date}: capture or manifest missing`); continue; }
    const manifest = JSON.parse(readFileSync(m,'utf8'));
    const rows = [...new Map(readRows(p).map(r => [r.symbol,r])).values()];
    if (!manifest.complete) issues.push(`${date}: manifest incomplete`);
    if (rows.length !== manifest.expected.total || rows.some(r=>r.date!==date)) issues.push(`${date}: actual row/session coverage differs from manifest`);
    const actualCore = new Set(rows.filter(r=>r.source?.includes('core')).map(r=>r.symbol));
    if (actualCore.size!==core.length || core.some(s=>!actualCore.has(s))) issues.push(`${date}: frozen core membership missing or changed`);
    if (rows.some(r=>!['ok','resolution_blocked'].includes(r.status))) issues.push(`${date}: unresolved partial or missing data`);
    if (date >= '2026-09-14') {
      if (!existsSync(join(root,'db/prepump/desk',`${date}.json`))) issues.push(`${date}: desk feed missing`);
      if (!manifest.quality_version) issues.push(`${date}: obsolete quality checks`);
      if (manifest.quality?.issues?.length) issues.push(`${date}: ${manifest.quality.issues.length} quality failures`);
    } else if (!manifest.quality_version) warnings.push(`${date}: legacy capture predates stricter checks and split-history capture`);
  }
  for (const [symbol, block] of resolutionBlocks(root)) issues.push(`${symbol}: resolution blocked since ${block.since}; identity review needed`);
  return { through, sessions_checked: dates.length, issues, warnings };
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const cal=loadCalendar(),through=val('--through')??expectedThrough(new Date(),cal); toUTC(through);
    const report=auditCapture(ROOT,through,cal);
    // The most recent Saturday's settled Friday is the label deadline, avoiding
    // false alarms for horizons that matured after the weekly scorer last ran.
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});
    const t=new Date(`${today}T00:00:00Z`);const dow=t.getUTCDay();
    let back=(dow+1)%7; if(dow===6 && Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',hourCycle:'h23'}).format(new Date()))<14)back=7;
    t.setUTCDate(t.getUTCDate()-back);const labelThrough=lastSessionOnOrBefore(t.toISOString().slice(0,10),cal);
    const overdue=duePairs(labelThrough,cal);
    if(overdue.length)report.issues.push(`${overdue.length} symbol-dates have overdue outcome horizons at weekly deadline ${labelThrough}`);
    const backup=val('--backup')??DEFAULT_BACKUP,md=join(backup,'manifests');
    const names=existsSync(md)?readdirSync(md).filter(f=>f.endsWith('.json')).sort():[];
    if(!names.length)report.issues.push('No verified local backup manifest');
    else {
      const mp=join(md,names.at(-1)),manifest=verifyBackup(mp);report.backup_manifest=mp;
      const changed=backupDifferences(join(ROOT,'db/prepump'),manifest);
      if(changed.length)report.issues.push(`${changed.length} source files are missing or different in the latest backup: ${changed.slice(0,10).join(', ')}`);
    }
    console.log(JSON.stringify(report,null,2));process.exitCode=report.issues.length?1:0;
  }catch(e){console.error(`REFUSED: ${e.message}`);process.exitCode=2;}
}
