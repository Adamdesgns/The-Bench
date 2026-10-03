// prepump-session.test.mjs — offline, zero-dep. node --test test/prepump-session.test.mjs
//
// Drives the pure functions against the real frozen calendar. No network, no MCP.
// The cases that matter are the ones that would silently collect on a closed market.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadCalendar, isTradingDay, isWeekend, isEarlyClose, reason,
  sessionsInRange, sessionsSince, shiftSessions, lastSessionOnOrBefore, toStr, toUTC, inHorizon,
} from "../scripts/prepump-session.mjs";

const cal = loadCalendar();

test("Labor Day 2026-09-07 is NOT a session — the case the brief called out", () => {
  assert.equal(isTradingDay("2026-09-07", cal), false);
  assert.equal(reason("2026-09-07", cal), "market holiday");
});

test("a weekday holiday is not caught by a weekday check", () => {
  // This is why `* * 1-5` is not a trading-day filter.
  assert.equal(isWeekend("2026-09-07"), false);
  assert.equal(isTradingDay("2026-09-07", cal), false);
});

test("weekends are not sessions", () => {
  assert.equal(isTradingDay("2026-09-05", cal), false); // Sat
  assert.equal(isTradingDay("2026-09-06", cal), false); // Sun
  assert.equal(reason("2026-09-05", cal), "weekend");
});

test("normal weekdays are sessions", () => {
  assert.equal(isTradingDay("2026-09-08", cal), true);
  assert.equal(isTradingDay("2026-09-04", cal), true);
});

test("every 2026 NYSE holiday is closed", () => {
  for (const d of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
                   "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]) {
    assert.equal(isTradingDay(d, cal), false, `${d} should be closed`);
  }
});

test("an early close is still a full session, and is flagged", () => {
  assert.equal(isTradingDay("2026-11-27", cal), true);
  assert.equal(isEarlyClose("2026-11-27", cal), true);
  assert.equal(isEarlyClose("2026-11-30", cal), false);
});

test("session counting skips the holiday", () => {
  // 9/4 Fri, then 9/7 Labor Day, so the next session is 9/8.
  assert.deepEqual(sessionsInRange("2026-09-04", "2026-09-08", cal), ["2026-09-04", "2026-09-08"]);
  assert.equal(sessionsSince("2026-09-04", "2026-09-08", cal), 1);
});

test("sessionsSince excludes the entry date itself", () => {
  assert.equal(sessionsSince("2026-09-08", "2026-09-08", cal), 0);
});

test("shiftSessions walks over weekends and holidays", () => {
  assert.equal(shiftSessions("2026-09-04", 1, cal), "2026-09-08");
  assert.equal(shiftSessions("2026-09-08", -1, cal), "2026-09-04");
  assert.equal(shiftSessions("2026-09-08", 10, cal), "2026-09-22");
});

test("lastSessionOnOrBefore backs over the long weekend", () => {
  assert.equal(lastSessionOnOrBefore("2026-09-07", cal), "2026-09-04");
  assert.equal(lastSessionOnOrBefore("2026-09-08", cal), "2026-09-08");
});

test("dates outside the frozen horizon REFUSE rather than guess", () => {
  assert.equal(inHorizon("2029-01-02", cal), false);
  assert.throws(() => isTradingDay("2029-01-02", cal), /outside the frozen calendar/);
});

test("date handling is UTC — a Central local parse would shift the day", () => {
  assert.equal(toStr(toUTC("2026-09-08")), "2026-09-08");
});

test("malformed dates throw rather than coerce", () => {
  assert.throws(() => toUTC("9/8/2026"));
  assert.throws(() => toUTC("2026-9-8"));
});
