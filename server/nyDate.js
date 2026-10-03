// The book's calendar date is the market's (America/New_York), not UTC's.
// toISOString().slice(0, 10) rolls to tomorrow at 7pm CDT, which stamped
// B-551..B-555 with 2026-09-24 when they were logged the evening of 9/23.
export function nyDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
