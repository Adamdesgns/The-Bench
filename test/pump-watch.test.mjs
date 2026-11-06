// pump-watch.test.mjs - the 5-minute direction read behind "watch AMZN for the pump" (2026-11-04). Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readDirection, nextAction, judgeTrip, endCard, isActive } from "../server/pumpWatch.js";

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
  const now = (START + 40 * 60) * 1000; // 40 min in: 10.3% of the session
  const up = readDirection({ ...base, bars: [...OR, bar(30, 268.5, 272, 268.4, 271.8, 3e6)], avgVol: 40e6, now });
  assert.equal(up.read, "UP", up.why);
  assert.equal(up.or_high, 270.76);
  // no gap (prior close 264.50), so the gap-and-hold rule cannot fire: inside the range is UNCLEAR
  const inside = readDirection({ ...base, prevClose: 264.5, bars: [...OR, bar(30, 268.5, 269, 268, 268.3, 3e6)], avgVol: 40e6, now });
  assert.equal(inside.read, "UNCLEAR");
  assert.match(inside.why, /inside the opening range/);
});

test("a break on thin volume is UNCLEAR; DOWN mirrors UP", () => {
  const now = (START + 40 * 60) * 1000;
  const thin = readDirection({ ...base, bars: [...OR, bar(30, 268.5, 272, 268.4, 271.8, 3e6)], avgVol: 400e6, now });
  assert.equal(thin.read, "UNCLEAR");
  assert.match(thin.why, /volume pace/);
  const down = readDirection({ ...base, bars: [...OR, bar(30, 266, 266, 261, 261.5, 4e6)], avgVol: 40e6, now });
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
  const hold = readDirection({ ...base, bars: [...OR, bar(30, 268.5, 270.2, 268.4, 270.0, 3e6)], avgVol: 40e6, now });
  assert.equal(hold.read, "UP", hold.why);
  assert.match(hold.why, /gap holding/);
  const fade = readDirection({ ...base, bars: [...OR, bar(30, 268, 268.2, 264.5, 264.6, 6e6)], avgVol: 40e6, now });
  assert.equal(fade.read, "UNCLEAR", fade.why);
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
