// session.mjs — the regular market session, in Eastern time. Shared by the
// engine (when may it buy, has the day closed) and the plan rules (is a
// sell-by time inside a session). The calendar is
// { closed: Set<date>, early: { date: 'HH:MM' }, end: date } (db/prepump).

export function etParts(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(now);
  const g = (t) => parts.find((x) => x.type === t).value;
  const hh = g('hour') === '24' ? '00' : g('hour');
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${hh}:${g('minute')}`, weekday: g('weekday') };
}

export const minusMin = (hhmm, m) => {
  const [h, mm] = hhmm.split(':').map(Number);
  const t = h * 60 + mm - m;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export const closeOf = (date, calendar) => calendar?.early?.[date] ?? '16:00';

/** A weekday the market opens, inside the frozen calendar. */
export function tradingDay({ date, weekday }, calendar) {
  if (weekday === 'Sat' || weekday === 'Sun' || calendar?.closed?.has(date)) return false;
  if (calendar?.end && date > calendar.end) return false; // past the frozen calendar: refuse to guess
  return true;
}

/** { open, entries }: is the regular session open, and may new buys start. */
export function sessionState(now, calendar, cfg) {
  const t = etParts(now);
  if (!tradingDay(t, calendar)) return { open: false, entries: false };
  const close = closeOf(t.date, calendar);
  const open = t.hhmm >= '09:30' && t.hhmm < close;
  return { open, entries: open && t.hhmm < minusMin(close, cfg?.entryCutoffMin ?? 5) };
}

/** Has the trading day that `sinceIso` fell in closed? A day order is dead after it. */
export function dayOver(sinceIso, now, calendar) {
  const a = etParts(new Date(sinceIso));
  const b = etParts(now);
  return b.date > a.date || b.hhmm >= closeOf(a.date, calendar);
}

/**
 * A sell-by time must leave the sale room to fill: inside a regular session,
 * at least `leadMin` minutes before that day's close. Returns null when it is
 * fine, or the reason it is not.
 */
export function exitByProblem(ms, calendar, leadMin = 10) {
  const t = etParts(new Date(ms));
  if (!tradingDay(t, calendar)) return `${t.date} is not a trading day`;
  const close = closeOf(t.date, calendar);
  if (t.hhmm < '09:30' || t.hhmm > minusMin(close, leadMin)) {
    return `it is ${t.hhmm} ET; it must fall between 09:30 and ${minusMin(close, leadMin)} ET that day (${leadMin} minutes before the ${close} close), or the shares are held past the bell`;
  }
  return null;
}
