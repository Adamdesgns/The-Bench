// freshness-gate.mjs — the publish/stand-down decision, computed instead of argued.
//
//   node scripts/freshness-gate.mjs --slot 13:00 --pulled 2026-08-27T15:58:00Z
//   node scripts/freshness-gate.mjs --slot 13:00 --pulled 10:58
//
// Exit codes:  0 = PUBLISH   10 = REPULL   20 = STAND-DOWN   2 = bad input
//
// WHY THIS IS A SCRIPT AND NOT A PARAGRAPH (2026-08-27).
// The gate lived as ~25 lines of prose duplicated across six routine files, and
// it contained a loop that let one run reach two opposite verdicts off the same
// clock. The window was defined as "30 minutes after the time in the filename",
// and the repair branch re-stamped the filename "so the window follows the
// stamp" — so repairing renewed the window, forever, and the only branch that
// could ever stand down became unreachable. A 13:30 run argued itself into
// "automatic stand-down" and "not a stand-down, re-pull and rewrite" in the same
// session. Both readings were faithful to the text.
//
// THE FIX: the window is anchored to the SCHEDULED SLOT, which nothing in the
// repair path can rewrite. The filename stamp describes the DATA; the slot
// defines the DEADLINE. Re-stamping never buys time. Boundaries are inclusive
// so the endpoint belongs to exactly one branch.
//
// This gate answers ONE question: may this post go out right now. It does not
// know or care what the file is called.

const DEFAULT_WINDOW_MIN = 30;   // how long a slot stays postable
const FRESH_MIN = 15;            // data older than this must be re-pulled first

function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function ctMinutes(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour12: false, hour: "2-digit", minute: "2-digit",
  });
  const p = Object.fromEntries(
    fmt.formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, x.value])
  );
  const h = Number(p.hour) % 24; // some ICU builds emit "24" for midnight
  return h * 60 + Number(p.minute);
}

function ctStamp(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour12: false, hour: "2-digit", minute: "2-digit",
  });
  const p = Object.fromEntries(
    fmt.formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, x.value])
  );
  return `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`;
}

function parseClock(s, label) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) die(`${label} is not a real time of day: ${s}`);
  return h * 60 + min;
}

function die(msg) {
  console.error(`REFUSED — the freshness gate cannot decide as asked:\n  - ${msg}\n\n  This is the guard working, not an error to route around.`);
  process.exit(2);
}

// --- inputs -----------------------------------------------------------------
const slotRaw = argOf("slot");
const pulledRaw = argOf("pulled");
if (!slotRaw) die("--slot HH:MM is required (the SCHEDULED slot time, in CT — never the filename stamp)");
if (!pulledRaw) die("--pulled is required (ISO timestamp, or HH:MM CT, of your LAST live quote pull)");

const now = argOf("now") ? new Date(argOf("now")) : new Date();
if (Number.isNaN(now.getTime())) die(`--now is not a parseable date: ${argOf("now")}`);

const slotMin = parseClock(slotRaw, "--slot");
if (slotMin === null) die(`--slot must be HH:MM in CT (got ${JSON.stringify(slotRaw)})`);

let pulledMin = parseClock(pulledRaw, "--pulled");
if (pulledMin === null) {
  const d = new Date(pulledRaw);
  if (Number.isNaN(d.getTime())) die(`--pulled must be an ISO timestamp or HH:MM CT (got ${JSON.stringify(pulledRaw)})`);
  pulledMin = ctMinutes(d);
}

// A slot's window ends either at an ABSOLUTE clock time (--window-end, used by
// the five fixed-deadline routines: the open, 10:00, 13:00, the bell, midnight)
// or slot + N minutes (--window, used by the roving intraday snapshot). Either
// way it is anchored to the SCHEDULE, never to the filename.
const windowEndArg = argOf("window-end");
const windowMin = argOf("window") ? Number(argOf("window")) : DEFAULT_WINDOW_MIN;
if (!Number.isFinite(windowMin) || windowMin <= 0) die(`--window must be a positive number of minutes (got ${argOf("window")})`);
if (windowEndArg && argOf("window")) die("pass --window-end OR --window, not both — two different deadlines is how the old prose gate ended up with two answers.");

// The hard close is a SECOND, independent ceiling (the bell). It only applies
// when asked for: a routine whose window already ends at a fixed time does not
// need it, and the closing-bell post legitimately runs past 15:00.
const hardCloseArg = argOf("hard-close");
const hardCloseMin = hardCloseArg ? parseClock(hardCloseArg, "--hard-close") : null;
if (hardCloseArg && hardCloseMin === null) die(`--hard-close must be HH:MM in CT (got ${JSON.stringify(hardCloseArg)})`);
const sessionClosed = process.argv.includes("--session-closed");

const nowMin = ctMinutes(now);
const gap = nowMin - pulledMin;
let windowEnd;
if (windowEndArg) {
  windowEnd = parseClock(windowEndArg, "--window-end");
  if (windowEnd === null) die(`--window-end must be HH:MM in CT (got ${JSON.stringify(windowEndArg)})`);
  if (windowEnd <= slotMin) die(`--window-end ${windowEndArg} is at or before the slot ${slotRaw} — that window is already shut before the routine runs`);
} else {
  windowEnd = slotMin + windowMin;
}

// --- the decision -----------------------------------------------------------
// Order matters. Hard stops first, then freshness. Every boundary is inclusive
// on the LATER branch, so no clock value can match two rules.
let verdict, code, why;

if (sessionClosed) {
  verdict = "STAND-DOWN"; code = 20;
  why = "the session closed while you were drafting — the numbers describe a market that is no longer trading.";
} else if (hardCloseMin !== null && nowMin >= hardCloseMin) {
  verdict = "STAND-DOWN"; code = 20;
  why = `it is ${ctStamp(now)} CT, at or past the ${hardCloseArg} CT hard close. An intraday slot does not survive the bell.`;
} else if (nowMin >= windowEnd) {
  verdict = "STAND-DOWN"; code = 20;
  why = `it is ${ctStamp(now)} CT and the ${slotRaw} slot's window closed at ${String(Math.floor(windowEnd / 60)).padStart(2, "0")}:${String(windowEnd % 60).padStart(2, "0")} CT. `
      + `The window is anchored to the SCHEDULED SLOT and re-stamping the filename does not extend it — a post labelled for ${slotRaw} that lands now would lie about when it was written.`;
} else if (gap < 0) {
  verdict = "REPULL"; code = 10;
  why = `your pull timestamp (${ctStamp(new Date(now.getTime() - gap * 60000))} CT) is in the FUTURE relative to now — something is wrong with the clock or the timestamp. Re-pull and re-run this gate.`;
} else if (gap >= FRESH_MIN) {
  verdict = "REPULL"; code = 10;
  why = `the window is still open, but your data is ${gap} minutes old (limit ${FRESH_MIN}). RE-PULL every number that appears in the draft, correct anything that moved, rewrite both files, then RE-RUN THIS GATE. Repairing inside the window is the job.`;
} else {
  verdict = "PUBLISH"; code = 0;
  why = `data is ${gap} minute(s) old and it is ${ctStamp(now)} CT, inside the ${slotRaw} window. Go.`;
}

const left = windowEnd - nowMin;
console.log(`${verdict}`);
console.log(`  slot ${slotRaw} CT | window closes ${String(Math.floor(windowEnd / 60)).padStart(2, "0")}:${String(windowEnd % 60).padStart(2, "0")} CT | now ${ctStamp(now)} CT | data ${gap} min old`);
if (verdict !== "STAND-DOWN") console.log(`  ${left} minute(s) of window left.`);
console.log(`  ${why}`);
if (verdict === "STAND-DOWN") {
  console.log(`\n  STAND-DOWN is a COMPLETED TASK, not a failure. Do not publish. Rename the READY file to`);
  console.log(`  ...-NOT-POSTED.txt, put a NOT PUBLISHED banner on the queue draft (the gap, the window it`);
  console.log(`  missed, what the numbers would have been), and ping the phone with the TRUTH — never the`);
  console.log(`  "is live - proofread it" ping for a post that never went out.`);
}
process.exit(code);
