// marketWatch.js - the alarm state machine behind scripts/market-watch.mjs.
//
// An ALARM opens when a committed buy or sell level is hit (see server/tripwire.js for
// what a level is). It is nagged to the phone on a fixed schedule until a PHOTO lands on
// the private ack topic, or the PC acks it by hand. Text never clears it. The photo
// means "I saw it" and nothing else; nothing here knows how to place an order.
//
// Everything in this file is pure: the clock, the files and the network are passed in.
// Spec: docs/superpowers/specs/2026-10-07-market-watch-design.md

import { randomBytes } from "node:crypto";

export const NAG_MINUTES = [0, 2, 5, 10];
export const NAG_EVERY = 15;
export const WINDOW = { open: "08:25", close: "15:05" }; // America/Chicago
export const BUY_KINDS = new Set(["TRIGGER", "BUY ZONE"]);
export const SELL_KINDS = new Set(["STOP", "FLOOR", "TARGET"]);
export const SELFIE_LINE = "Send a selfie to stop this. It means you saw it, nothing else. Every order is yours.";

export function sideOf(kind) {
  if (BUY_KINDS.has(kind)) return "BUY";
  if (SELL_KINDS.has(kind)) return "SELL";
  return "LEVEL";
}

export function ct(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour12: false, weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t).value;
  const hh = g("hour") === "24" ? "00" : g("hour");
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hhmm: `${hh}:${g("minute")}`, weekday: g("weekday") };
}

export function inWindow(date = new Date()) {
  const { hhmm, weekday } = ct(date);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return hhmm >= WINDOW.open && hhmm < WINDOW.close;
}

export function nextNagOffset(sentCount) {
  if (sentCount < NAG_MINUTES.length) return NAG_MINUTES[sentCount];
  return NAG_MINUTES[NAG_MINUTES.length - 1] + NAG_EVERY * (sentCount - NAG_MINUTES.length + 1);
}

export function nagDue(alarm, now = new Date()) {
  if (alarm.acked) return false;
  const minutes = (now.getTime() - Date.parse(alarm.opened)) / 60000;
  return minutes >= nextNagOffset(alarm.sent.length);
}

export function openAlarms(state) { return state.alarms.filter((a) => !a.acked); }

const cloneAlarms = (state) => state.alarms.map((a) => ({ ...a, levels: [...a.levels], sent: [...a.sent] }));

export function openOrJoin(state, tripped, now = new Date()) {
  if (!tripped.length) return { state, alarm: null, added: [] };
  const alarms = cloneAlarms(state);
  let alarm = alarms.find((a) => !a.acked);
  if (!alarm) {
    const { date, hhmm } = ct(now);
    alarm = { id: `${date}-${hhmm.replace(":", "")}`, opened: now.toISOString(), levels: [], sent: [], acked: null };
    alarms.push(alarm);
  }
  const have = new Set(alarm.levels.map((l) => l.key));
  const added = [];
  for (const t of tripped) {
    if (have.has(t.key)) continue;
    const lvl = { ticker: t.ticker, kind: t.kind, side: sideOf(t.kind), price: t.price, dir: t.dir, touched: t.touched, src: t.src, key: t.key, at: now.toISOString() };
    alarm.levels.push(lvl);
    added.push(lvl);
    have.add(t.key);
  }
  return { state: { ...state, alarms }, alarm, added };
}

export function isImage(msg) {
  return Boolean(msg && msg.event === "message" && msg.attachment && String(msg.attachment.type || "").startsWith("image/"));
}

// ntfy message time is unix seconds. An image counts only if it arrived after the alarm opened.
export function applyAcks(state, messages, from = "phone") {
  const images = messages.filter(isImage);
  const acked = [];
  const alarms = state.alarms.map((a) => {
    if (a.acked) return a;
    const hit = images.find((m) => m.time * 1000 >= Date.parse(a.opened));
    if (!hit) return a;
    acked.push(a.id);
    return { ...a, acked: { at: new Date(hit.time * 1000).toISOString(), from, receipt: hit.attachment.url } };
  });
  return { state: { ...state, alarms }, acked };
}

export function ackAll(state, { from = "pc", note = "", now = new Date() } = {}) {
  const acked = [];
  const alarms = state.alarms.map((a) => {
    if (a.acked) return a;
    acked.push(a.id);
    return { ...a, acked: { at: now.toISOString(), from, receipt: note || `acked from ${from}` } };
  });
  return { state: { ...state, alarms }, acked };
}

export function fmtLevel(l) {
  return `${l.ticker} ${l.kind} ${l.dir === "below" ? "<=" : ">="} ${l.price}, touched ${l.touched} (${l.src})`;
}

const headersFor = (title, link) => {
  const h = { Title: title, Priority: "urgent", Tags: "rotating_light" };
  if (link) h.Click = link;
  return h;
};

export function buildCard(alarm, link, now = new Date()) {
  const sides = [...new Set(alarm.levels.map((l) => l.side))];
  const head = sides.length > 1 ? "BUY + SELL levels hit" : `${sides[0]} level hit: ${alarm.levels[0].ticker} ${alarm.levels[0].price}`;
  const title = `THE BENCH - ${head}`;
  const body = [
    ...alarm.levels.map(fmtLevel),
    `nag ${alarm.sent.length + 1} of many - opened ${ct(new Date(alarm.opened)).hhmm} CT`,
    SELFIE_LINE,
  ].join("\n");
  return { title, body, headers: headersFor(title, link) };
}

export function unansweredCard(alarms, link) {
  const dates = [...new Set(alarms.map((a) => a.id.slice(0, 10)))].join(", ");
  const title = `THE BENCH - UNANSWERED from ${dates}`;
  const body = [...alarms.flatMap((a) => a.levels.map(fmtLevel)), SELFIE_LINE].join("\n");
  return { title, body, headers: headersFor(title, link) };
}

export function downCard() {
  const title = "THE BENCH - MARKET WATCH DOWN";
  return {
    title,
    body: "Three ticks in a row failed. The watcher is still running and will keep trying, but levels may be going unchecked. This card does not repeat.",
    headers: { Title: title, Priority: "urgent" },
  };
}

export async function sendCard(fetchFn, topicUrl, card) {
  const res = await fetchFn(topicUrl, { method: "POST", headers: card.headers, body: card.body });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
}

// since= takes unix seconds. Poll mode returns and closes; one JSON object per line.
export async function readAckTopic(fetchFn, topic, sinceIso) {
  const since = Math.floor(Date.parse(sinceIso) / 1000);
  const res = await fetchFn(`https://ntfy.sh/${topic}/json?poll=1&since=${since}`);
  if (!res.ok) throw new Error(`ack topic ${res.status}`);
  return (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function newAckTopic() {
  return `bench-ack-${randomBytes(9).toString("hex").slice(0, 12)}`;
}
