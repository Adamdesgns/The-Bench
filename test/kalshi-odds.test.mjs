// kalshi-odds.test.mjs — price-to-odds, the middle of a ladder, and event shapes. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { odds, middleGuess, pickEvent, summarize, line } from "../scripts/kalshi-odds.mjs";

const mk = (o) => ({ status: "active", close_time: "2026-11-10T13:29:00Z", ...o });

test("odds is the bid/ask midpoint, and chg is against the midpoint a day ago", () => {
  assert.deepEqual(
    odds({ yes_bid_dollars: "0.72", yes_ask_dollars: "0.73", previous_yes_bid_dollars: "0.70", previous_yes_ask_dollars: "0.71", previous_price_dollars: "0.50" }),
    { pct: 73, chg: 2, thin: false });
});

test("a stale last trade does not fake a move when the book has not moved", () => {
  // KXCPI-26DEC T0.3 on 11/03: book 38/40 both days, last trade 24 both days.
  const o = odds({ yes_bid_dollars: "0.38", yes_ask_dollars: "0.40", last_price_dollars: "0.24",
    previous_yes_bid_dollars: "0.38", previous_yes_ask_dollars: "0.40", previous_price_dollars: "0.24" });
  assert.equal(o.pct, 39);
  assert.equal(o.chg, 0);
});

test("a wide spread uses the last trade held inside the book, marked THIN", () => {
  const o = odds({ yes_bid_dollars: "0.02", yes_ask_dollars: "0.15", last_price_dollars: "0.90" });
  assert.equal(o.pct, 15);
  assert.equal(o.thin, true);
  assert.equal(odds({ yes_bid_dollars: "0.20", yes_ask_dollars: "0.45", last_price_dollars: "0.30" }).pct, 30);
});

test("a count ladder interpolates where it crosses 50%", () => {
  assert.deepEqual(middleGuess([{ strike: 50000, pct: 56 }, { strike: 60000, pct: 53 }, { strike: 70000, pct: 43 }]),
    { kind: "at", value: 63000 });
  assert.deepEqual(middleGuess([{ strike: 1, pct: 40 }, { strike: 2, pct: 10 }]), { kind: "below", value: 1 });
  assert.deepEqual(middleGuess([{ strike: 1, pct: 90 }, { strike: 2, pct: 70 }]), { kind: "above", value: 2 });
});

test("a one-decimal ladder names the print, not a point between rungs", () => {
  // CPI 11/03: above 0.1% 93, above 0.2% 65, above 0.3% 16 -> 0.3% is the middle, 49% on exactly it.
  assert.deepEqual(middleGuess([{ strike: 0.1, pct: 93 }, { strike: 0.2, pct: 65 }, { strike: 0.3, pct: 16 }], 0.1),
    { kind: "at", value: 0.3, exact: 49 });
  // Unemployment: above 4.1% 63, above 4.2% 26 -> 4.2%.
  assert.equal(middleGuess([{ strike: 4.1, pct: 63 }, { strike: 4.2, pct: 26 }], 0.1).value, 4.2);
});

test("a percent ladder in the summary uses the print rule and says so", () => {
  const rung = (k, p) => mk({ strike_type: "greater", floor_strike: k, yes_sub_title: `Above ${k}%`, yes_bid_dollars: String(p), yes_ask_dollars: String(p) });
  const s = summarize({ event_ticker: "KXCPI-26OCT", title: "CPI", markets: [rung(0, 0.99), rung(0.1, 0.93), rung(0.2, 0.65), rung(0.3, 0.16), rung(0.4, 0.07)] });
  assert.equal(s.shape, "ladder");
  assert.deepEqual(s.rungs.map((r) => r.strike), [0.2, 0.3]);
  assert.match(line(s), /middle 0\.3% \(49% on exactly that\)/);
});

test("the ladder keeps the four rungs nearest even money", () => {
  const rung = (k, p) => mk({ strike_type: "greater", floor_strike: k, yes_sub_title: `Above ${k}`, yes_bid_dollars: String(p), yes_ask_dollars: String(p) });
  const s = summarize({ event_ticker: "P", title: "Jobs", markets: [rung(10, 0.90), rung(20, 0.65), rung(30, 0.16), rung(40, 0.12), rung(50, 0.11)] });
  assert.deepEqual(s.rungs.map((r) => r.strike), [20, 30, 40, 50]); // 90% is 40 from even money, 11% only 39
});

test("pickEvent takes the open event that closes soonest", () => {
  const e = pickEvent([
    { event_ticker: "LATE", markets: [mk({ close_time: "2027-01-01T00:00:00Z" })] },
    { event_ticker: "SOON", markets: [mk({ close_time: "2026-12-01T00:00:00Z" })] },
    { event_ticker: "DONE", markets: [mk({ status: "settled", close_time: "2026-01-01T00:00:00Z" })] },
  ]);
  assert.equal(e.event_ticker, "SOON");
});

test("a pick-one event lists live outcomes at 3%+, best first, with the event ticker", () => {
  const s = summarize({ event_ticker: "KXFEDDECISION-26DEC", title: "Fed decision", mutually_exclusive: true, markets: [
    mk({ yes_sub_title: "Cut", yes_bid_dollars: "0.01", yes_ask_dollars: "0.02" }),
    mk({ yes_sub_title: "Hold", yes_bid_dollars: "0.26", yes_ask_dollars: "0.27" }),
    mk({ yes_sub_title: "Hike", yes_bid_dollars: "0.72", yes_ask_dollars: "0.73" }),
  ] });
  assert.equal(s.shape, "pick");
  assert.match(line(s), /Fed decision \[KXFEDDECISION-26DEC, closes Nov 10, 2026\]: Hike 73%, Hold 27%/);
});

test("a half-closed pick-one event keeps its outcome names", () => {
  const s = summarize({ event_ticker: "CONTROLH-2026", title: "House", mutually_exclusive: true, markets: [
    mk({ yes_sub_title: "Democratic Party", yes_bid_dollars: "0.93", yes_ask_dollars: "0.95" }),
    mk({ yes_sub_title: "Republican Party", status: "closed" }),
  ] });
  assert.equal(s.shape, "pick");
  assert.match(line(s), /Democratic Party 94%/);
});

test("a single market reads as yes odds", () => {
  const s = summarize({ event_ticker: "R", title: "Recession", markets: [mk({ yes_sub_title: "Starts", yes_bid_dollars: "0.02", yes_ask_dollars: "0.03" })] });
  assert.equal(s.shape, "yesno");
  assert.match(line(s), /yes 3%/);
});
