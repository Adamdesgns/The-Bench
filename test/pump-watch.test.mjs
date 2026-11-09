// pump-watch.test.mjs - the 5-minute direction read behind "watch AMZN for the pump" (2026-11-04). Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readDirection, nextAction, judgeTrip, endCard, isActive, trimToDayVolume, normalShare, NORMAL_DAY_SHARE } from "../server/pumpWatch.js";

const START = 1_793_802_600; // 09:30 ET
const END = START + 390 * 60;
const bar = (min, o, h, l, c, v) => ({ t: START + min * 60, o, h, l, c, v });
// opening range 263.85-270.76 on the first six bars, 1M shares each
const OR = [bar(0, 264.97, 266, 263.85, 265, 1e6), bar(5, 265, 268, 264.5, 267, 1e6), bar(10, 267, 270.76, 266, 270, 1e6), bar(15, 270, 270.5, 268, 269, 1e6), bar(20, 269, 270, 267.5, 268, 1e6), bar(25, 268, 269, 267, 268.5, 1e6)];
const base = { prevClose: 250.69, regStart: START, regEnd: END };

test("FORMING before the first 30 minutes close", () => {
  const r = readDirection({ ...base, bars: OR.slice(0, 3), avgVol: 40e6, now: (START + 15 * 60) * 1000 });
  assert.equal(r.read, "FORMING");
  assert.equal(r.gap_pct, 5.7);
});

test("UP on a break over the opening-range high and VWAP with heavy volume; UNCLEAR inside the range", () => {
  const now = (START + 40 * 60) * 1000; // 40 min in: a normal day has done 20.06% of its volume, so 16M is 1.99x
  const up = readDirection({ ...base, bars: [...OR, bar(30, 268.5, 272, 268.4, 271.8, 3e6)], avgVol: 40e6, dayVolume: 16e6, now });
  assert.equal(up.read, "UP", up.why);
  assert.equal(up.or_high, 270.76);
  // no gap (prior close 264.50), so the gap-and-hold rule cannot fire: inside the range is UNCLEAR
  const inside = readDirection({ ...base, prevClose: 264.5, bars: [...OR, bar(30, 268.5, 269, 268, 268.3, 3e6)], avgVol: 40e6, dayVolume: 16e6, now });
  assert.equal(inside.read, "UNCLEAR");
  assert.match(inside.why, /inside the opening range/);
});

test("a break on thin volume is UNCLEAR; DOWN mirrors UP", () => {
  const now = (START + 40 * 60) * 1000;
  const thin = readDirection({ ...base, bars: [...OR, bar(30, 268.5, 272, 268.4, 271.8, 3e6)], avgVol: 400e6, dayVolume: 9e6, now });
  assert.equal(thin.read, "UNCLEAR");
  assert.match(thin.why, /volume pace 0\.11x is under 1\.5x/);
  const down = readDirection({ ...base, bars: [...OR, bar(30, 266, 266, 261, 261.5, 4e6)], avgVol: 40e6, dayVolume: 16e6, now });
  assert.equal(down.read, "DOWN", down.why);
});

test("nextAction: one call per direction, at most two, and an end card after lunch", () => {
  const w = { ticker: "AMZN", date: "2026-11-04", until: "12:00", calls: [] };
  assert.equal(nextAction(w, { read: "UP" }, "2026-11-04", "09:05").act, "call");
  assert.equal(nextAction({ ...w, calls: [{ read: "UP" }] }, { read: "UP" }, "2026-11-04", "09:10").act, "none");
  assert.equal(nextAction({ ...w, calls: [{ read: "UP" }] }, { read: "DOWN" }, "2026-11-04", "09:10").act, "call");
  assert.equal(nextAction({ ...w, calls: [{ read: "UP" }, { read: "DOWN" }] }, { read: "UP" }, "2026-11-04", "09:30").act, "none");
  assert.equal(nextAction(w, { read: "UNCLEAR" }, "2026-11-04", "09:05").act, "none");
  assert.equal(nextAction(w, { read: "UP" }, "2026-11-04", "12:05").act, "end");
  assert.equal(nextAction(w, { read: "UP" }, "2026-11-05", "09:05").act, "none", "a watch is for its own day only");
  assert.equal(isActive(w, "2026-11-04", "11:55"), true);
  assert.equal(isActive({ ...w, ended: true }, "2026-11-04", "11:55"), false);
});

test("judgeTrip carries the read and the catalyst; endCard says what was called", () => {
  const w = { ticker: "AMZN", date: "2026-11-04", until: "12:00", why: "election", calls: [{ read: "UP", at_ct: "09:20" }] };
  const read = { read: "UP", why: "over", last: 271.8, prev: 250.69, or_high: 270.76, or_low: 263.85, vwap: 268.9, pace: 3.1, gap_pct: 5.7 };
  const t = judgeTrip(w, read);
  assert.equal(t.kind, "PUMP");
  assert.equal(t.dir, "above");
  assert.equal(t.price, 270.76);
  assert.equal(t.pump.catalyst, "election");
  assert.match(endCard(w, read), /Called: UP at 09:20/);
  assert.match(endCard({ ...w, calls: [] }, null), /no direction call/);
});

test("gap-and-hold: a 3%+ gap still over VWAP in the top half of its range on heavy volume reads UP; under VWAP it does not", () => {
  const now = (START + 40 * 60) * 1000;
  const hold = readDirection({ ...base, bars: [...OR, bar(30, 268.5, 270.2, 268.4, 270.0, 3e6)], avgVol: 40e6, dayVolume: 16e6, now });
  assert.equal(hold.read, "UP", hold.why);
  assert.match(hold.why, /gap holding/);
  const fade = readDirection({ ...base, bars: [...OR, bar(30, 268, 268.2, 264.5, 264.6, 6e6)], avgVol: 40e6, dayVolume: 16e6, now });
  assert.equal(fade.read, "UNCLEAR", fade.why);
});

// THE 11/09 BUG (B-1362). Yahoo's 5-minute series carries junk rows: AMZN had 20.21M shares in one bar against a
// 0.47M median, and read 2.65x pace at 11:30 CT when it really ran 1.1x. These tapes have that shape.
const M = 0.47e6;
const NOW = (START + 95 * 60) * 1000; // 19 bars in: a normal day has done 33.35% of its volume
const AVG = 30.55e6; // 8.93M traded by NOW is 0.88x pace against this average (the old even clock called it 1.2x)
// an opening range of 250-252, then a slide to 247.4 that breaks the range and sits under VWAP
const sliding = () => Array.from({ length: 19 }, (_, i) => {
  const c = i < 6 ? 251 : 250 - (i - 5) * 0.2;
  return bar(i * 5, c + 0.1, i < 6 ? 252 : c + 0.3, i < 6 ? 250 : c - 0.3, c, M);
});
const withJunk = (at = 17, v = 20.21e6) => sliding().map((b, i) => (i === at ? { ...b, v } : b));
const read11 = (bars, dayVolume, extra = {}) => readDirection({ ...base, prevClose: 251, bars, avgVol: AVG, dayVolume, now: NOW, ...extra });

test("a junk 5-minute bar cannot make the pace: the day's real volume does", () => {
  const r = read11(withJunk(), 8.93e6);
  assert.equal(r.pace, 0.88);
  assert.equal(r.read, "UNCLEAR", r.why);
  assert.match(r.why, /volume pace 0\.88x is under 1\.5x/);
});

test("real heavy volume still makes the call on the same junk tape", () => {
  const r = read11(withJunk(), 20e6);
  assert.equal(r.pace, 1.96);
  assert.equal(r.read, "DOWN", r.why);
});

test("no usable day volume means no pace and no VWAP, never a fallback to the bars", () => {
  for (const dayVolume of [undefined, null, 0, -5, NaN, Infinity, "8930000"]) {
    const r = read11(withJunk(), dayVolume);
    assert.equal(r.pace, null, `dayVolume ${dayVolume}`);
    assert.equal(r.vwap, null, `dayVolume ${dayVolume}`);
    assert.equal(r.read, "UNCLEAR", r.why);
    assert.match(r.why, /volume pace unknown/);
    assert.doesNotMatch(r.why, /unknownx/);
  }
});

test("a junk bar cannot drag VWAP: the bars may only claim the volume that really traded", () => {
  const far = { h: 240.3, l: 239.7, c: 240 }; // a junk row far from the tape, so any weight it keeps shows
  const clean = sliding().map((b, i) => (i === 17 ? { ...b, ...far } : b));
  const junk = withJunk().map((b, i) => (i === 17 ? { ...b, ...far } : b));
  const day = 8.93e6 * 1.02; // with the junk taken out, the bars ran 98-101% of the day's total on 11/09
  const miss = Math.abs(read11(junk, day).vwap - read11(clean, day).vwap);
  assert.ok(miss < 0.25, `VWAP missed by ${miss}; on the raw bars it missed by more than 6`);
});

test("an honest heavy open is not cut for a smaller junk row, which made a false gap-and-hold UP", () => {
  const bars = Array.from({ length: 19 }, (_, i) => bar(i * 5, 270, 270.3, i === 3 ? 268.5 : 269.7, i === 18 ? 270.3 : 270, M));
  bars[0] = bar(0, 272, 272, 272, 272, 29 * M); // the real open, on a 3.8% gap
  bars[12] = bar(60, 268.6, 268.6, 268.6, 268.6, 14 * M); // a junk row, smaller than the open
  const real = bars.reduce((a, b, i) => a + (i === 12 ? M : b.v), 0);
  const r = read11(bars, real, { prevClose: 262 });
  assert.equal(r.read, "UNCLEAR", `${r.why} (vwap ${r.vwap})`);
  assert.ok(r.vwap > 271, `vwap ${r.vwap} should still carry the open`);
});

test("many junk bars: the bars end up claiming what really traded (NVDA 11/09 had about ten)", () => {
  // five junk bars of 200M at 240 whose real volume was 8M each, among real 8M bars and a 26M open at 250
  const bars = Array.from({ length: 19 }, (_, i) => {
    const junk = i % 4 === 2;
    const c = junk ? 240 : 250;
    return bar(i * 5, c, c, c, c, junk ? 200e6 : i === 0 ? 26e6 : 8e6);
  });
  assert.equal(bars.filter((b) => b.v === 200e6).length, 5);
  const real = bars.map((b) => (b.v === 200e6 ? 8e6 : b.v));
  const day = real.reduce((a, v) => a + v, 0);
  const truth = bars.reduce((a, b, i) => a + b.c * real[i], 0) / day;
  const r = read11(bars, day);
  assert.ok(Math.abs(r.vwap - truth) < 0.01, `vwap ${r.vwap} vs ${truth}`);
});

test("trimToDayVolume takes only the excess, off the biggest bars first and the opening bar last", () => {
  assert.deepEqual(trimToDayVolume([1, 10, 2], 8), [1, 5, 2], "one bar carries the whole excess");
  assert.deepEqual(trimToDayVolume([1, 20, 14, 2], 4), [1, 0, 1, 2], "the excess runs through the biggest bar into the next");
  assert.deepEqual(trimToDayVolume([1, 13, 1], 14), [1, 12, 1], "a small excess barely touches an honest big bar");
  assert.deepEqual(trimToDayVolume([29, 1, 14, 1], 31), [29, 1, 0, 1], "the open is bigger than the junk row and keeps its weight");
  assert.deepEqual(trimToDayVolume([10, 3, 2], 4), [4, 0, 0], "the open is cut only when nothing else is left");
  assert.deepEqual(trimToDayVolume([3, 1], 9), [3, 1], "bars under the day's total are left alone");
  assert.deepEqual(trimToDayVolume([3, 1], 4), [3, 1], "bars equal to the day's total are left alone");
  const input = [1, 10, 2];
  trimToDayVolume(input, 8);
  assert.deepEqual(input, [1, 10, 2], "the bars passed in are not changed");
});

test("an honest heavy bar keeps its full weight when the bars do not overshoot the day's volume", () => {
  // the opening bar really can be about 29x the session median (AMD 11/04)
  const bars = sliding().map((b, i) => (i === 0 ? { ...b, v: 29 * M } : b));
  const total = bars.reduce((a, b) => a + b.v, 0);
  const weighted = bars.reduce((a, b) => a + ((b.h + b.l + b.c) / 3) * b.v, 0) / total;
  const r = read11(bars, total / 0.9); // honest bars add up to a little less than the official total
  assert.equal(r.vwap, Math.round(weighted * 100) / 100);
});

test("fetchTape reads the day's volume from Yahoo's own day total, and readNow paces on it", async () => {
  const { fetchTape, readNow } = await import("../scripts/pump-watch.mjs");
  const reply = (body) => ({ ok: true, json: async () => ({ chart: { result: [body] } }) });
  const tape = withJunk();
  const fake = (meta) => async (url) => (url.includes("interval=5m")
    ? reply({
      meta: { chartPreviousClose: 251, regularMarketTime: START + 95 * 60, currentTradingPeriod: { regular: { start: START, end: END } }, ...meta },
      timestamp: tape.map((b) => b.t),
      indicators: { quote: [{ open: tape.map((b) => b.o), high: tape.map((b) => b.h), low: tape.map((b) => b.l), close: tape.map((b) => b.c), volume: tape.map((b) => b.v) }] },
    })
    : reply({ indicators: { quote: [{ volume: [...Array(20).fill(AVG), 5e6] }] } }));
  assert.equal((await fetchTape("AMZN", fake({ regularMarketVolume: 8.93e6 }))).dayVolume, 8.93e6);
  assert.equal((await fetchTape("AMZN", fake({}))).dayVolume, null, "no day total");
  assert.equal((await fetchTape("AMZN", fake({ regularMarketVolume: 40e6, regularMarketTime: START - 3600 }))).dayVolume, null, "the last regular trade is before today's open, so that total is yesterday's");
  assert.equal((await fetchTape("AMZN", fake({ regularMarketVolume: 40e6, regularMarketTime: undefined }))).dayVolume, null, "no time on the total means it cannot be shown to be today's");
  const r = await readNow("AMZN", fake({ regularMarketVolume: 8.93e6 }), NOW);
  assert.equal(r.pace, 0.88);
  assert.equal(r.read, "UNCLEAR", r.why);
});

// THE PACE CLOCK (2026-11-09). Volume does not come in evenly: by 09:00 CT a normal day has done 17% of its volume in
// 7.7% of the session, so the old even clock read a perfectly average morning at 2.2x and the 1.5x bar meant nothing.
test("normalShare: the share of a normal day's volume normally done by a minute of the session", () => {
  for (const bad of [0, -5, NaN, undefined, null]) assert.equal(normalShare(bad), 0, `minutes ${bad}`);
  assert.equal(normalShare(30), NORMAL_DAY_SHARE[6]);
  assert.equal(normalShare(150), NORMAL_DAY_SHARE[30]);
  const mid = normalShare(32.5);
  assert.ok(Math.abs(mid - (NORMAL_DAY_SHARE[6] + NORMAL_DAY_SHARE[7]) / 2) < 1e-12, `halfway between two marks is the midpoint, got ${mid}`);
  assert.equal(normalShare(390), 1);
  assert.equal(normalShare(500), 1);
  const late = normalShare(387.5); // between the last two marks (385 and 390): still a number, never undefined
  assert.ok(late > NORMAL_DAY_SHARE[77] && late < 1, `last five minutes read ${late}`);
});

test("the normal-day table: one point per 5 minutes, never falling, the close auction left for the last step", () => {
  assert.equal(NORMAL_DAY_SHARE.length, 79);
  assert.equal(NORMAL_DAY_SHARE[0], 0);
  NORMAL_DAY_SHARE.forEach((v, i) => { if (i) assert.ok(v >= NORMAL_DAY_SHARE[i - 1], `point ${i} falls`); });
  assert.ok(NORMAL_DAY_SHARE[78] < 1);
  assert.equal(NORMAL_DAY_SHARE[6], 0.1718); // 09:00 CT
  assert.equal(NORMAL_DAY_SHARE[42], 0.5194); // 12:00 CT
});

test("an average morning is not heavy: the break that read 2.1x on the even clock reads 1x and is UNCLEAR", () => {
  const now = (START + 35 * 60) * 1000;
  const r = readDirection({ ...base, bars: [...OR, bar(30, 268.5, 272, 268.4, 271.8, 3e6)], avgVol: 40e6, dayVolume: 40e6 * NORMAL_DAY_SHARE[7], now });
  assert.equal(r.pace, 1);
  assert.equal(r.read, "UNCLEAR", r.why);
  assert.match(r.why, /volume pace 1x is under 1\.5x/);
});

test("a day running exactly average reads 1x at every mark from the first read to past lunch", () => {
  for (let k = 6; k <= 42; k++) {
    const r = readDirection({ ...base, bars: OR, avgVol: AVG, dayVolume: AVG * NORMAL_DAY_SHARE[k], now: (START + k * 5 * 60) * 1000 });
    assert.equal(r.pace, 1, `minute ${k * 5}`);
  }
});

test("a half day is read at the same clock minute as a full one", () => {
  const args = { ...base, bars: OR, avgVol: 40e6, dayVolume: 16e6, now: (START + 40 * 60) * 1000 };
  assert.equal(readDirection({ ...args, regEnd: START + 210 * 60 }).pace, readDirection(args).pace);
  assert.equal(readDirection(args).pace, 1.99);
});

test("updateWatch reloads before saving, so a watch added meanwhile survives", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { updateWatch } = await import("../scripts/pump-watch.mjs");
  const p = join(mkdtempSync(join(tmpdir(), "pw-")), "pw.json");
  writeFileSync(p, JSON.stringify({ watches: [{ ticker: "AMZN", date: "2026-11-04", calls: [] }] }));
  const stale = JSON.parse(readFileSync(p, "utf8"));
  writeFileSync(p, JSON.stringify({ watches: [...stale.watches, { ticker: "MSFT", date: "2026-11-04", calls: [] }] }));
  updateWatch("AMZN", "2026-11-04", (x) => ({ ...x, ended: true }), p);
  const after = JSON.parse(readFileSync(p, "utf8")).watches;
  assert.deepEqual(after.map((x) => `${x.ticker}:${Boolean(x.ended)}`), ["AMZN:true", "MSFT:false"]);
});

test("v36 exception: only Adam's watch, or the 5:40a routine's before 09:00 CT, is eligible", async () => {
  const { overrideEligible } = await import("../server/pumpWatch.js");
  const w = { ticker: "APP", date: "2026-11-05" };
  assert.equal(overrideEligible({ ...w, added_by: "adam", added_at: "2026-11-05T16:52:00Z" }).ok, true);
  assert.equal(overrideEligible({ ...w, added_by: "routine", added_at: "2026-11-05T11:36:47Z" }).ok, true, "05:36 CT");
  assert.equal(overrideEligible({ ...w, added_by: "routine", added_at: "2026-11-05T15:30:00Z" }).ok, false, "09:30 CT, after the entry check");
  assert.equal(overrideEligible({ ...w, added_by: "desk", added_at: "2026-11-05T11:00:00Z" }).ok, false);
  assert.equal(overrideEligible({ ...w, added_at: "2026-11-05T11:00:00Z" }).ok, false, "no added_by = plain v33");
  const t = judgeTrip({ ...w, added_by: "desk", calls: [] }, { read: "UP", or_high: 1, or_low: 0 });
  assert.equal(t.pump.override_ok, false);
  assert.equal(t.pump.added_by, "desk");
});
