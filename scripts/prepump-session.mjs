// prepump-session.mjs — is this a US equity trading session, and how far apart are two of them?
//
//   node scripts/prepump-session.mjs                          (today, America/New_York)
//   node scripts/prepump-session.mjs --date 2026-09-07        (Labor Day -> exit 1)
//   node scripts/prepump-session.mjs --date 2026-09-08 --json
//   node scripts/prepump-session.mjs --date 2026-09-08 --sessions-since 2026-08-24
//   node scripts/prepump-session.mjs --date 2026-09-08 --plus 10
//   node scripts/prepump-session.mjs --calendar path/to/cal.json   (tests)
//
// EXIT CODES — a caller gates on these, so they are part of the contract:
//   0  it IS a trading session
//   1  it is NOT (weekend or holiday). Normal, expected, not an error.
//   2  REFUSED — bad input, or a date outside the frozen calendar's horizon.
//
// WHY THIS EXISTS (2026-09-05)
// ----------------------------
// The Claude scheduler has NO holiday concept. Every recurring Bench task is
// currently scheduled to fire on Monday 2026-09-07, which is Labor Day. `* * 1-5`
// is not a trading-day filter — NYSE holidays fall on weekdays, and 2026-09-07 is
// the live proof. Nothing else in this repo stops a holiday run, so the guard has
// to be the first thing a collection task calls.
//
// It reads the FROZEN calendar at db/prepump/nyse-calendar-2026-2028.json, which is
// a verbatim transcription of NYSE's official 2026-2028 publication (by way of
// Hunter's versioned encoding of it). It is a table, not a formula, on purpose:
// Good Friday and the observed-weekend-holiday rules are not safely derivable, and
// a formula that is subtly wrong once a year is worse than no guard at all.
//
// The calendar ENDS 2028-12-31. Past that this REFUSES with exit 2 rather than
// falling back to a weekday check — a silent fallback would collect on Christmas.
//
// It deliberately does NOT answer "is the data settled yet?". That is a different
// question with a different answer (Robinhood daily bars are provisional for ~12h
// after the close) and it belongs to the caller, which can see the live feed.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function loadCalendar(file) {
  const path = file ?? resolve(ROOT, "db/prepump/nyse-calendar-2026-2028.json");
  const cal = JSON.parse(readFileSync(path, "utf8"));
  const closed = new Set(cal.closed_dates ?? []);
  const early = cal.early_closes ?? {};
  const start = cal._supported_range?.start;
  const end = cal._supported_range?.end;
  if (!closed.size || !start || !end) throw new Error(`calendar at ${path} is missing closed_dates or _supported_range`);
  return { closed, early, start, end, version: cal._version, source: cal._source };
}

// Dates are handled as plain YYYY-MM-DD strings on a UTC spine. Never construct a
// local Date from one: in Central, `new Date("2026-09-08")` then .getDate() can
// hand back the 7th, which would shift every row back a day.
export function toUTC(dateStr) {
  if (typeof dateStr !== "string" || !DATE_RE.test(dateStr)) throw new Error(`bad date: ${dateStr}`);
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== dateStr) throw new Error(`bad date: ${dateStr}`);
  return t;
}

export const toStr = (t) => new Date(t).toISOString().slice(0, 10);
const DAY = 86400000;

export function inHorizon(dateStr, cal) {
  return dateStr >= cal.start && dateStr <= cal.end;
}

export function isWeekend(dateStr) {
  const dow = new Date(toUTC(dateStr)).getUTCDay();
  return dow === 0 || dow === 6;
}

export function isTradingDay(dateStr, cal) {
  if (!inHorizon(dateStr, cal)) throw new Error(`${dateStr} is outside the frozen calendar (${cal.start}..${cal.end}); refusing to guess`);
  return !isWeekend(dateStr) && !cal.closed.has(dateStr);
}

export function isEarlyClose(dateStr, cal) {
  return Object.prototype.hasOwnProperty.call(cal.early, dateStr);
}

/** Why it is not a session, for a human and for the run manifest. */
export function reason(dateStr, cal) {
  if (isWeekend(dateStr)) return "weekend";
  if (cal.closed.has(dateStr)) return "market holiday";
  return null;
}

/** Every trading session in [from, to], inclusive. */
export function sessionsInRange(from, to, cal) {
  if (from > to) return [];
  if (!inHorizon(from, cal) || !inHorizon(to, cal)) {
    throw new Error(`range ${from}..${to} is outside the frozen calendar (${cal.start}..${cal.end}); refusing to guess`);
  }
  const out = [];
  for (let t = toUTC(from); t <= toUTC(to); t += DAY) {
    const s = toStr(t);
    if (isTradingDay(s, cal)) out.push(s);
  }
  return out;
}

/**
 * Completed sessions strictly AFTER `from`, up to and including `to`.
 * This is the "how old is this row" question the outcomes job asks, so the
 * entry date itself is deliberately not counted.
 */
export function sessionsSince(from, to, cal) {
  return sessionsInRange(from, to, cal).filter((s) => s > from).length;
}

/** The date N trading sessions after (N>0) or before (N<0) `dateStr`. */
export function shiftSessions(dateStr, n, cal) {
  if (!Number.isInteger(n)) throw new Error(`--plus needs a whole number, got ${n}`);
  const step = n >= 0 ? DAY : -DAY;
  let left = Math.abs(n);
  let t = toUTC(dateStr);
  while (left > 0) {
    t += step;
    const s = toStr(t);
    if (!inHorizon(s, cal)) throw new Error(`walked past the frozen calendar (${cal.start}..${cal.end}) looking for ${n} sessions from ${dateStr}; refusing to guess`);
    if (isTradingDay(s, cal)) left--;
  }
  return toStr(t);
}

/** The most recent trading session at or before `dateStr`. */
export function lastSessionOnOrBefore(dateStr, cal) {
  let t = toUTC(dateStr);
  for (let i = 0; i < 15; i++) {
    const s = toStr(t);
    if (inHorizon(s, cal) && isTradingDay(s, cal)) return s;
    t -= DAY;
  }
  throw new Error(`no trading session found in the 15 days before ${dateStr}`);
}

export function todayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function refuse(msg) {
  console.error(`REFUSED — ${msg}`);
  process.exit(2);
}

function main() {
  let cal;
  try {
    cal = loadCalendar(val("--calendar"));
  } catch (e) {
    refuse(e.message);
  }

  const date = val("--date") ?? todayET();
  if (!DATE_RE.test(date)) refuse(`--date must be YYYY-MM-DD, got "${date}"`);
  if (!inHorizon(date, cal)) {
    refuse(`${date} is outside the frozen NYSE calendar (${cal.start}..${cal.end}). Transcribe the next published NYSE schedule rather than falling back to a weekday check — a weekday check collects on Christmas.`);
  }

  const trading = isTradingDay(date, cal);
  const out = {
    date,
    trading_session: trading,
    reason: trading ? null : reason(date, cal),
    early_close: trading ? isEarlyClose(date, cal) : false,
    early_close_at: isEarlyClose(date, cal) ? cal.early[date] : null,
    calendar_version: cal.version,
  };

  const since = val("--sessions-since");
  if (since !== undefined) {
    if (!DATE_RE.test(since)) refuse(`--sessions-since must be YYYY-MM-DD, got "${since}"`);
    try {
      out.sessions_since = sessionsSince(since, date, cal);
      out.sessions_since_from = since;
    } catch (e) {
      refuse(e.message);
    }
  }

  const plus = val("--plus");
  if (plus !== undefined) {
    const n = Number(plus);
    try {
      out.plus_n = n;
      out.plus_date = shiftSessions(date, n, cal);
    } catch (e) {
      refuse(e.message);
    }
  }

  if (has("--json")) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`${date}  ${trading ? "TRADING SESSION" : `NOT A SESSION (${out.reason})`}${out.early_close ? `  [EARLY CLOSE ${out.early_close_at} ET]` : ""}`);
    if (out.sessions_since !== undefined) console.log(`  completed sessions since ${since}: ${out.sessions_since}`);
    if (out.plus_date) console.log(`  ${n_label(out.plus_n)}: ${out.plus_date}`);
    if (!trading) console.log(`  -> a collection task MUST stop here. The scheduler does not know this.`);
  }

  process.exit(trading ? 0 : 1);
}

const n_label = (n) => (n >= 0 ? `${n} sessions forward` : `${Math.abs(n)} sessions back`);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
