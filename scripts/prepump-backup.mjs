// Local, content-addressed backup. No deletion, network, or writes to the source.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const ROOT = process.env.BENCH_ROOT ? resolve(process.env.BENCH_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_BACKUP = 'C:/Users/steam/Projects/backups/bench-prepump';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function inside(parent, child) { const rel = relative(resolve(parent), resolve(child)); return !rel || (!rel.startsWith('..') && !isAbsolute(rel)); }
function files(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap(name => {
    const rel = join(prefix, name), full = join(dir, name), stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`Backup refuses link: ${full}`);
    return stat.isDirectory() ? files(full, rel) : [{ rel, full }];
  });
}
export function createBackup(source, destination) {
  source = resolve(source); destination = resolve(destination);
  if (inside(source, destination) || inside(destination, source)) throw new Error('Backup and source must be separate directories');
  if (/onedrive|dropbox|google drive/i.test(destination) || /^\\\\|^\/\//.test(destination)) throw new Error('Broker rows must stay outside sync/network folders');
  const records = [];
  mkdirSync(join(destination, 'objects'), { recursive: true });
  mkdirSync(join(destination, 'manifests'), { recursive: true });
  for (const { rel, full } of files(source)) {
    const before = lstatSync(full), bytes = readFileSync(full), after = lstatSync(full);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Source changed during backup: ${full}`);
    const hash = digest(bytes), object = join(destination, 'objects', hash);
    if (!existsSync(object)) writeFileSync(object, bytes, { flag: 'wx' });
    if (digest(readFileSync(object)) !== hash) throw new Error(`Backup object failed verification: ${hash}`);
    records.push({ path: rel.replaceAll('\\', '/'), sha256: hash, bytes: bytes.length });
  }
  const manifest = { schema: 'bench-local-backup-v1', created_at: new Date().toISOString(), source, files: records };
  const name = `${manifest.created_at.replaceAll(':', '-')}-${randomUUID()}.json`;
  const manifestPath = join(destination, 'manifests', name);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { manifestPath, files: records.length, bytes: records.reduce((s, r) => s + r.bytes, 0) };
}
export function verifyBackup(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schema !== 'bench-local-backup-v1') throw new Error('Unknown backup manifest');
  const root = resolve(dirname(manifestPath), '..');
  for (const r of manifest.files) {
    if (!/^[a-f0-9]{64}$/.test(r.sha256)) throw new Error('Invalid object hash');
    const bytes = readFileSync(join(root, 'objects', r.sha256));
    if (bytes.length !== r.bytes || digest(bytes) !== r.sha256) throw new Error(`Corrupt backup: ${r.path}`);
  }
  return manifest;
}
export function backupDifferences(source, manifest) {
  const recorded = new Map(manifest.files.map(r => [r.path, r.sha256]));
  return files(resolve(source)).filter(({rel, full}) => recorded.get(rel.replaceAll('\\', '/')) !== digest(readFileSync(full))).map(({rel}) => rel);
}
// Restore to a NEW directory only. Tests exercise byte-for-byte recovery.
export function restoreBackup(manifestPath, destination) {
  const manifest = verifyBackup(manifestPath), root = resolve(dirname(manifestPath), '..');
  destination = resolve(destination);
  if (/onedrive|dropbox|google drive/i.test(destination) || /^\\\\|^\/\//.test(destination)) throw new Error('Restore must stay outside sync/network folders');
  if (existsSync(destination)) throw new Error('Restore destination must not exist');
  if (inside(manifest.source, destination) || inside(destination, manifest.source) || inside(root, destination)) throw new Error('Restore must be separate from source and backup');
  for (const r of manifest.files) {
    const target = resolve(destination, r.path);
    if (!inside(destination, target) || target === destination) throw new Error('Unsafe manifest path');
  }
  mkdirSync(destination, { recursive: true });
  for (const r of manifest.files) {
    const target = resolve(destination, r.path); mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(root, 'objects', r.sha256)), { flag: 'wx' });
  }
  return manifest.files.length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, argument] = process.argv.slice(2);
    if (command === 'create') console.log(JSON.stringify(createBackup(join(ROOT, 'db/prepump'), argument ?? DEFAULT_BACKUP), null, 2));
    else if (command === 'verify' && argument) console.log(JSON.stringify({ verified_files: verifyBackup(argument).files.length }, null, 2));
    else throw new Error('Use create [local-directory] | verify manifest-path');
  } catch (e) { console.error(`REFUSED: ${e.message}`); process.exitCode = 2; }
}
