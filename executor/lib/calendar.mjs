// calendar.mjs — when real orders may be sent. NYSE full holidays and early
// closes, written out by hand. Past CALENDAR_KNOWN_THROUGH every day reads as
// closed, so a stale list stops orders instead of guessing.
//
// VERIFY against nyse.com before relying on it. Where an early close was not
// certain, the day is listed as a half day on purpose: a wrongly listed half day
// only shortens the window, it never sends an order into a closed market.

export const CALENDAR_KNOWN_THROUGH = '2027-12-31';

export const NYSE_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18',
  '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// 13:00 New York close. 2026-07-02, 2027-07-02 and 2027-12-23 are listed to be safe.
export const NYSE_HALF_DAYS = new Set([
  '2026-07-02', '2026-11-27', '2026-12-24',
  '2027-07-02', '2027-11-26', '2027-12-23',
]);

function nyParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    minutes: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10),
  };
}

export const nyDate = (now) => nyParts(now).date;

// 'closed' | 'half' | 'full' | 'unknown' (past the end of the list)
export function dayKind(now) {
  const { date, weekday } = nyParts(now);
  if (date > CALENDAR_KNOWN_THROUGH) return 'unknown';
  if (weekday === 'Sat' || weekday === 'Sun' || NYSE_HOLIDAYS.has(date)) return 'closed';
  return NYSE_HALF_DAYS.has(date) ? 'half' : 'full';
}

// New York close in minutes, or null on a day with no session.
export function closeMinutes(now) {
  const kind = dayKind(now);
  if (kind === 'full') return 16 * 60;
  if (kind === 'half') return 13 * 60;
  return null;
}

// Orders go in from 09:30 until 15 minutes before the close.
export function realSessionOpen(now = new Date()) {
  const close = closeMinutes(now);
  if (close === null) return false;
  const { minutes } = nyParts(now);
  return minutes >= 9 * 60 + 30 && minutes <= close - 15;
}
