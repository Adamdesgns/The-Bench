// inbox-check is the session-start honesty tool. On a GitHub / cloud clone the
// handoff bus (Projects/docs/handoffs, local disk only by Adam's ruling) is not
// there, and the old script said "nothing to check" and exited 0 - the same
// exit as "the other desk is quiet". That is how two desks double-ran MU/MUU
// and HIMS on 2026-08-28. Absent bus must be a distinct, loud answer.
import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = "scripts/inbox-check.mjs";

function run(bus, args = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, BENCH_HANDOFF_BUS: bus },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

const tmp = () => mkdtempSync(join(tmpdir(), "bench-inbox-"));

const drop = (handback) =>
  [
    "# Drop",
    "- From: Morgan Sterling",
    "- Topic: seat map",
    "- Date: 2026-08-28",
    "",
    "body",
    "",
    "## HANDBACK",
    handback,
    "",
  ].join("\n");

test("THE BUG: an absent bus is 'this clone has no bus', not 'nothing waiting' - exit 2", () => {
  const dir = tmp();
  const r = run(join(dir, "does-not-exist", "handoffs"));
  assert.equal(r.code, 2, "absent bus must not share exit 0 with 'desk is quiet'");
  assert.match(r.out, /NO HANDOFF BUS/i);
  assert.match(r.out, /BENCH_HANDOFF_BUS/);
  assert.doesNotMatch(r.out, /nothing to check/i);
  assert.doesNotMatch(r.out, /Nothing on this bus is waiting on you/i);
  rmSync(dir, { recursive: true, force: true });
});

test("a bus root without to-claude/ is not a quiet desk either - exit 2", () => {
  const bus = tmp();
  mkdirSync(join(bus, "to-grok"));
  const r = run(bus);
  assert.equal(r.code, 2);
  assert.match(r.out, /to-claude/);
  assert.doesNotMatch(r.out, /No unread drops/i);
  rmSync(bus, { recursive: true, force: true });
});

test("an unread drop still exits 1 and names the file", () => {
  const bus = tmp();
  mkdirSync(join(bus, "to-claude"));
  writeFileSync(join(bus, "to-claude", "2026-08-28-seat-map.md"), drop("- Done:"));
  const r = run(bus);
  assert.equal(r.code, 1);
  assert.match(r.out, /\[ UNREAD \]\s+2026-08-28-seat-map\.md/);
  assert.match(r.out, /ACTION: 1 unread drop/);
  rmSync(bus, { recursive: true, force: true });
});

test("a drop signed [Claude] in its HANDBACK is read - exit 0, and the bus path is printed", () => {
  const bus = tmp();
  mkdirSync(join(bus, "to-claude"));
  writeFileSync(
    join(bus, "to-claude", "2026-08-28-seat-map.md"),
    drop("**[Claude]** Done: acted on it.")
  );
  const r = run(bus);
  assert.equal(r.code, 0);
  assert.match(r.out, /\[answered\]/);
  assert.match(r.out, /No unread drops/);
  assert.ok(r.out.includes(bus), "the bus actually read must be visible in the report");
  rmSync(bus, { recursive: true, force: true });
});

test("a mounted, empty to-claude/ is an honest quiet - exit 0", () => {
  const bus = tmp();
  mkdirSync(join(bus, "to-claude"));
  const r = run(bus);
  assert.equal(r.code, 0);
  assert.match(r.out, /nothing in the last 14 days/);
  rmSync(bus, { recursive: true, force: true });
});

test("read-only: the script never creates the bus, a folder, or a worklog", () => {
  const dir = tmp();
  const missing = join(dir, "handoffs");
  run(missing);
  assert.deepEqual(readdirSync(dir), [], "absent bus must stay absent");

  const bus = tmp();
  mkdirSync(join(bus, "to-claude"));
  run(bus);
  assert.deepEqual(readdirSync(bus).sort(), ["to-claude"], "no worklog/ or to-grok/ invented");
  rmSync(dir, { recursive: true, force: true });
  rmSync(bus, { recursive: true, force: true });
});
