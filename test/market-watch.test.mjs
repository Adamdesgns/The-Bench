// market-watch.test.mjs - the nag that stops at a selfie. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sideOf, ct, inWindow, nextNagOffset, nagDue, openAlarms, openOrJoin,
  isImage, applyAcks, ackAll, buildCard, unansweredCard, downCard, SELFIE_LINE,
} from "../server/marketWatch.js";

const T0 = new Date("2026-10-07T14:14:00Z"); // 09:14 CT, a Wednesday
const min = (n) => new Date(T0.getTime() + n * 60000);
const vst = { ticker: "VST", kind: "TRIGGER", price: 143.02, dir: "above", src: "B-717", key: "VST|TRIGGER|143.02|above", touched: 143.4, last: 142.5 };
const googl = { ticker: "GOOGL", kind: "STOP", price: 326, dir: "below", src: "B-663", key: "GOOGL|STOP|326|below", touched: 325.9, last: 327 };

test("sideOf: triggers and zones are BUY, stops, floors and targets are SELL", () => {
  assert.equal(sideOf("TRIGGER"), "BUY");
  assert.equal(sideOf("BUY ZONE"), "BUY");
  for (const k of ["STOP", "FLOOR", "TARGET"]) assert.equal(sideOf(k), "SELL");
  assert.equal(sideOf("WHATEVER"), "LEVEL");
});

test("ct and inWindow: Central time, weekdays, 08:25 to 15:05", () => {
  assert.deepEqual(ct(T0), { date: "2026-10-07", hhmm: "09:14", weekday: "Wed" });
  assert.equal(inWindow(T0), true);
  assert.equal(inWindow(new Date("2026-10-07T13:24:00Z")), false, "08:24 CT is before the open");
  assert.equal(inWindow(new Date("2026-10-07T13:25:00Z")), true, "08:25 CT is in");
  assert.equal(inWindow(new Date("2026-10-07T20:05:00Z")), false, "15:05 CT is out");
  assert.equal(inWindow(new Date("2026-10-10T15:00:00Z")), false, "Saturday");
});

test("the nag schedule: 0, 2, 5, 10, then every 15 minutes", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(nextNagOffset), [0, 2, 5, 10, 25, 40, 55]);
  const alarm = { opened: T0.toISOString(), sent: [], acked: null };
  assert.equal(nagDue(alarm, T0), true, "first send is immediate");
  alarm.sent.push(T0.toISOString());
  assert.equal(nagDue(alarm, min(1)), false);
  assert.equal(nagDue(alarm, min(2)), true);
  alarm.sent.push(min(2).toISOString(), min(5).toISOString(), min(10).toISOString());
  assert.equal(nagDue(alarm, min(24)), false);
  assert.equal(nagDue(alarm, min(25)), true);
  assert.equal(nagDue({ ...alarm, acked: { at: min(11).toISOString(), from: "phone", receipt: "x" } }, min(30)), false, "acked alarms never nag");
});

test("openOrJoin: one alarm per burst; a later level joins the open alarm; duplicates are ignored", () => {
  let r = openOrJoin({ alarms: [] }, [vst], T0);
  assert.equal(r.state.alarms.length, 1);
  assert.equal(r.alarm.id, "2026-10-07-0914");
  assert.deepEqual(r.added.map((l) => l.key), [vst.key]);
  assert.equal(r.alarm.levels[0].side, "BUY");
  r = openOrJoin(r.state, [vst, googl], min(3));
  assert.equal(r.state.alarms.length, 1, "joined, not opened");
  assert.deepEqual(r.added.map((l) => l.key), [googl.key]);
  assert.equal(r.state.alarms[0].levels.length, 2);
  assert.deepEqual(openOrJoin(r.state, [], min(4)).added, []);
  const acked = ackAll(r.state, { from: "pc", now: min(5) }).state;
  const again = openOrJoin(acked, [vst], min(6));
  assert.equal(again.state.alarms.length, 2, "after an ack a new hit opens a new alarm");
});

test("applyAcks: only an image attachment posted after the alarm opened clears it; text never does", () => {
  const { state } = openOrJoin({ alarms: [] }, [vst], T0);
  const text = { event: "message", time: Math.floor(min(1).getTime() / 1000), message: "ok saw it" };
  const oldPhoto = { event: "message", time: Math.floor(min(-10).getTime() / 1000), attachment: { type: "image/jpeg", url: "https://ntfy.sh/file/old.jpg" } };
  const photo = { event: "message", time: Math.floor(min(4).getTime() / 1000), attachment: { type: "image/jpeg", url: "https://ntfy.sh/file/abc.jpg" } };
  const pdf = { event: "message", time: Math.floor(min(4).getTime() / 1000), attachment: { type: "application/pdf", url: "https://ntfy.sh/file/x.pdf" } };
  assert.equal(isImage(photo), true);
  assert.equal(isImage(text), false);
  assert.equal(isImage(pdf), false);
  assert.deepEqual(applyAcks(state, [text, oldPhoto, pdf]).acked, []);
  const r = applyAcks(state, [text, oldPhoto, photo]);
  assert.deepEqual(r.acked, ["2026-10-07-0914"]);
  assert.deepEqual(r.state.alarms[0].acked, { at: min(4).toISOString(), from: "phone", receipt: "https://ntfy.sh/file/abc.jpg" });
  assert.deepEqual(openAlarms(r.state), []);
});

test("ackAll records who cleared it", () => {
  const { state } = openOrJoin({ alarms: [] }, [vst, googl], T0);
  const r = ackAll(state, { from: "chat", note: "selfie arrived in chat", now: min(7) });
  assert.deepEqual(r.acked, ["2026-10-07-0914"]);
  assert.equal(r.state.alarms[0].acked.from, "chat");
  assert.equal(r.state.alarms[0].acked.receipt, "selfie arrived in chat");
});

test("buildCard: title names the side, body lists levels, nag count, and the selfie line; Click carries the chat link", () => {
  const { state, alarm } = openOrJoin({ alarms: [] }, [vst], T0);
  const c = buildCard(alarm, "claude://claude.ai/epitaxy/local_x", T0);
  assert.equal(c.title, "THE BENCH - BUY level hit: VST 143.02");
  assert.equal(c.headers.Priority, "urgent");
  assert.equal(c.headers.Click, "claude://claude.ai/epitaxy/local_x");
  assert.match(c.body, /VST TRIGGER >= 143.02, touched 143.4 \(B-717\)/);
  assert.match(c.body, /nag 1 of many - opened 09:14 CT/);
  assert.ok(c.body.endsWith(SELFIE_LINE));
  const mixed = openOrJoin(state, [googl], min(1)).alarm;
  assert.equal(buildCard(mixed, null, min(1)).title, "THE BENCH - BUY + SELL levels hit");
  assert.equal("Click" in buildCard(mixed, null, min(1)).headers, false);
});

test("unansweredCard and downCard", () => {
  const { state } = openOrJoin({ alarms: [] }, [googl], new Date("2026-10-06T19:50:00Z"));
  const u = unansweredCard(openAlarms(state), "claude://x");
  assert.equal(u.title, "THE BENCH - UNANSWERED from 2026-10-06");
  assert.match(u.body, /GOOGL STOP <= 326/);
  assert.ok(u.body.endsWith(SELFIE_LINE));
  const d = downCard();
  assert.equal(d.title, "THE BENCH - MARKET WATCH DOWN");
  assert.equal(d.headers.Priority, "urgent");
});
