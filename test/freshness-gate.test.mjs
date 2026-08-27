// The gate that replaced ~25 lines of prose duplicated across six routine files.
// Every case below is a clock value the old prose could answer two ways.
import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";

const GATE = "scripts/freshness-gate.mjs";

// CT is UTC-5 in August (CDT). 13:30 CT = 18:30Z.
const ct = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `2026-08-27T${String(h + 5).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
};

function gate(args) {
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("THE BUG: 13:30 on a 13:00 slot is a stand-down, not a re-pull", () => {
  // The 2026-08-27 screenshots: one run said "automatic stand-down", the same
  // run said "not a stand-down, re-pull and rewrite". Both read the old prose
  // correctly. Exactly one answer is now reachable.
  const r = gate(["--slot", "13:00", "--pulled", "10:58", "--now", ct("13:30")]);
  assert.equal(r.code, 20);
  assert.match(r.out, /STAND-DOWN/);
});

test("the window boundary is inclusive — 13:29 still repairs, 13:30 does not", () => {
  assert.equal(gate(["--slot", "13:00", "--pulled", "10:58", "--now", ct("13:29")]).code, 10);
  assert.equal(gate(["--slot", "13:00", "--pulled", "10:58", "--now", ct("13:30")]).code, 20);
});

test("re-stamping cannot buy more window — the slot is the anchor", () => {
  // The old rule said the window "follows the stamp", so a repair at 13:20
  // re-stamped to 13:20 and bought until 13:50, forever. The slot is fixed now:
  // even with data pulled one minute ago, 13:30 is closed.
  const r = gate(["--slot", "13:00", "--pulled", "13:29", "--now", ct("13:30")]);
  assert.equal(r.code, 20, "fresh data must NOT reopen a closed slot");
});

test("fresh data inside the window publishes", () => {
  const r = gate(["--slot", "13:00", "--pulled", "13:05", "--now", ct("13:10")]);
  assert.equal(r.code, 0);
  assert.match(r.out, /PUBLISH/);
});

test("stale data inside the window repairs rather than standing down", () => {
  // The 8/24 pre-market save this carve-out exists for: a 34-min gap repaired
  // by re-pulling, published with a sub-minute gap. Still allowed.
  const r = gate(["--slot", "13:00", "--pulled", "12:40", "--now", ct("13:14")]);
  assert.equal(r.code, 10);
  assert.match(r.out, /RE-PULL/);
});

test("the freshness boundary is inclusive at 15 minutes", () => {
  assert.equal(gate(["--slot", "13:00", "--pulled", "13:00", "--now", ct("13:14")]).code, 0);
  assert.equal(gate(["--slot", "13:00", "--pulled", "13:00", "--now", ct("13:15")]).code, 10);
});

test("the hard close outranks an open slot window when asked for", () => {
  // The roving snapshot: a 14:50 slot's window would run to 15:20. The bell kills it.
  const r = gate(["--slot", "14:50", "--pulled", "14:59", "--now", ct("15:00"), "--hard-close", "15:00"]);
  assert.equal(r.code, 20);
  assert.match(r.out, /hard close/);
});

test("--window-end drives the five fixed-deadline routines", () => {
  // power hour: slot 14:07, window ends at the 15:00 bell.
  assert.equal(gate(["--slot", "14:07", "--window-end", "15:00", "--pulled", "14:55", "--now", ct("14:59")]).code, 0);
  assert.equal(gate(["--slot", "14:07", "--window-end", "15:00", "--pulled", "14:55", "--now", ct("15:00")]).code, 20);
  // premarket: slot 05:40, window ends at the 08:30 open.
  assert.equal(gate(["--slot", "05:40", "--window-end", "08:30", "--pulled", "08:20", "--now", ct("08:25")]).code, 0);
  assert.equal(gate(["--slot", "05:40", "--window-end", "08:30", "--pulled", "08:20", "--now", ct("08:30")]).code, 20);
});

test("closing bell legitimately runs past 15:00 — no implicit bell ceiling", () => {
  // Regression: the hard close used to default to 15:00, which would have killed
  // every closing-bell post. It is opt-in now.
  const r = gate(["--slot", "15:10", "--window-end", "23:59", "--pulled", "15:12", "--now", ct("15:15")]);
  assert.equal(r.code, 0);
});

test("two conflicting deadlines are refused, not silently resolved", () => {
  const r = gate(["--slot", "13:00", "--window-end", "14:00", "--window", "30", "--pulled", "13:00"]);
  assert.equal(r.code, 2);
});

test("a window that shuts before its own slot is refused", () => {
  assert.equal(gate(["--slot", "13:00", "--window-end", "12:00", "--pulled", "13:00"]).code, 2);
});

test("an explicitly closed session stands down regardless of the clock", () => {
  const r = gate(["--slot", "13:00", "--pulled", "13:00", "--now", ct("13:01"), "--session-closed"]);
  assert.equal(r.code, 20);
});

test("a pull timestamp in the future is caught, not treated as fresh", () => {
  const r = gate(["--slot", "13:00", "--pulled", "13:20", "--now", ct("13:10")]);
  assert.equal(r.code, 10);
  assert.match(r.out, /FUTURE/);
});

test("missing or malformed input refuses with exit 2, never a verdict", () => {
  assert.equal(gate(["--pulled", "10:58"]).code, 2);              // no slot
  assert.equal(gate(["--slot", "13:00"]).code, 2);                 // no pull time
  assert.equal(gate(["--slot", "1pm", "--pulled", "10:58"]).code, 2);
  assert.equal(gate(["--slot", "25:00", "--pulled", "10:58"]).code, 2);
  assert.equal(gate(["--slot", "13:00", "--pulled", "banana"]).code, 2);
});
