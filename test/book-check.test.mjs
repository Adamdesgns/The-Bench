// book-check scans the vault's Daily/ notes and x-poster's posted/ for calls
// that never reached the book. On a clone where neither surface exists it used
// to scan zero files and print "No gaps." with exit 0 - the book-is-complete
// answer, produced from nothing. Zero surfaces must be its own answer.
import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = "scripts/book-check.mjs";

// Filenames carry the date the mention was made; keep it inside the 30-day window.
const today = new Date().toISOString().slice(0, 10);

function run({ vault, posted, archive }, args = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      BENCH_VAULT_DAILY: vault,
      BENCH_POSTED_DIR: posted,
      BENCH_ARCHIVE: archive,
    },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

function fixture({ vault = null, posted = null, rows = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bench-book-"));
  const archive = join(dir, "archive.json");
  writeFileSync(archive, JSON.stringify(rows));
  const paths = { archive, vault: join(dir, "Daily"), posted: join(dir, "posted"), dir };
  if (vault) {
    mkdirSync(paths.vault);
    writeFileSync(join(paths.vault, `${today}.md`), vault);
  }
  if (posted) {
    mkdirSync(paths.posted);
    writeFileSync(join(paths.posted, `${today}-power-hour.txt`), posted);
  }
  return paths;
}

test("THE BUG: no surfaces mounted is 'surfaces not mounted', never 'No gaps' - exit 2", () => {
  const f = fixture({ rows: [{ ticker: "AMD", date: today }] });
  const r = run(f);
  assert.equal(r.code, 2, "zero surfaces must not share exit 0 with a clean book");
  assert.match(r.out, /surfaces not mounted/i);
  assert.match(r.out, /vault.*NOT MOUNTED/i);
  assert.match(r.out, /published.*NOT MOUNTED/i);
  assert.match(r.out, /BENCH_VAULT_DAILY|BENCH_POSTED_DIR/);
  assert.doesNotMatch(r.out, /No gaps/);
  rmSync(f.dir, { recursive: true, force: true });
});

test("both surfaces mounted, every mention covered - exit 0, no PARTIAL label", () => {
  const f = fixture({
    vault: "Passed on $AMD at the open.",
    posted: "$AMD held the level. Not advice.",
    rows: [{ ticker: "AMD", date: today }],
  });
  const r = run(f);
  assert.equal(r.code, 0);
  assert.match(r.out, /No gaps/);
  assert.match(r.out, /vault.*mounted/i);
  assert.match(r.out, /published.*mounted/i);
  assert.doesNotMatch(r.out, /PARTIAL/);
  rmSync(f.dir, { recursive: true, force: true });
});

test("both surfaces mounted, a published call with no row - exit 1", () => {
  const f = fixture({
    vault: "quiet day",
    posted: "$HIMS breaking down into the close.",
    rows: [{ ticker: "AMD", date: today }],
  });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /\$HIMS\s+on/);
  assert.match(r.out, /no \$HIMS row at all/);
  rmSync(f.dir, { recursive: true, force: true });
});

test("one surface missing still runs, but says PARTIAL and names the missing one", () => {
  const f = fixture({
    posted: "$AMD held. Not advice.",
    rows: [{ ticker: "AMD", date: today }],
  });
  const r = run(f);
  assert.equal(r.code, 0, "a covered mention on the mounted surface is still clean");
  assert.match(r.out, /PARTIAL/);
  assert.match(r.out, /vault.*NOT MOUNTED/i);
  assert.doesNotMatch(r.out, /Every ticker-day mentioned has a book row/);
  rmSync(f.dir, { recursive: true, force: true });
});

test("one surface missing does not hide a gap on the other - exit 1", () => {
  const f = fixture({
    vault: "Called $MU as a fade.",
    rows: [{ ticker: "AMD", date: today }],
  });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /\$MU\s+on/);
  assert.match(r.out, /PARTIAL/);
  rmSync(f.dir, { recursive: true, force: true });
});

test("surfaces mounted but empty in the window is an honest zero, not 'not mounted'", () => {
  const f = fixture({ rows: [] });
  mkdirSync(f.vault);
  mkdirSync(f.posted);
  const r = run(f);
  assert.equal(r.code, 0);
  assert.match(r.out, /0 ticker-days seen/);
  assert.doesNotMatch(r.out, /NOT MOUNTED/);
  rmSync(f.dir, { recursive: true, force: true });
});
