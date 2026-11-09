#!/usr/bin/env node
// stack.mjs — THE STACK LANE (Adam, 2026-11-09: "shoulda been stacking amazon at 240" / "Build it").
//
// The swing desk asks "is this a 2:1 trade right now". This lane asks a different question: "if Adam
// wants to own this and add to it over months, where are the sensible places to add, and did owning it
// beat just owning SPY". Adam names the company and the size. The desk gives mechanical levels. There is
// no 2:1 test, no 10% risk band and no price stop here (prompts/stack-lane-v1.md).
//
// It RECORDS. It never sends an order to a broker: `buy` writes down what Adam already bought himself.
// The HODL gate answers are shown beside the name and never refuse it: his order puts a name on.
// Completely separate from the paper book. Rows here are real money or a watch, never P-001.
//
//   add X --why "..." [--tranche-dollars N] [--by adam] [--row B-###] [--kill "..."]
//         [--gate durable=x,fundamentals=x,tailwind=x,survivability=x] [--price P --spy S]
//   size X --tranche-dollars N       Adam names the dollars per add
//   buy X --shares N --price P [--date YYYY-MM-DD] [--spy S]
//   levels X                         where the adds are today, read only
//   report [--account N] [--prices '{"X":1,"SPY":2}']
//   check [--write]                  which levels a day's low has touched since the last run; refreshes the levels
//
// Zero-dep. --db <file> and --bars-file <json> for offline use. Tests: test/stack.test.mjs
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const round = (n, d = 2) => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d;
const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
const GATE_TESTS = ["durable", "fundamentals", "tailwind", "survivability"];
const MAX_LEVELS = 3;

// Simple average of the last 14 true ranges: the wider of the two ATRs the desk prints on a fast name.
export function atr14(bars) {
  if (bars.length < 15) return null;
  const tr = [];
  for (let i = bars.length - 14; i < bars.length; i++) {
    const b = bars[i], pc = bars[i - 1].c;
    tr.push(Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)));
  }
  return round(mean(tr), 4);
}

// A pivot low is strictly lower than the three bars on each side, so the newest three bars can never be one.
export function pivotLows(bars, side = 3) {
  const out = [];
  for (let i = side; i < bars.length - side; i++) {
    let ok = true;
    for (let k = 1; k <= side && ok; k++) ok = bars[i].l < bars[i - k].l && bars[i].l < bars[i + k].l;
    if (ok) out.push({ d: bars[i].d, price: round(bars[i].l) });
  }
  return out;
}

// Mechanical add levels: structure under the price, the first a full ATR down, each a full ATR apart, at most three.
export function addLevels(bars, { price = bars.at(-1).c, max = MAX_LEVELS } = {}) {
  const atr = atr14(bars);
  if (atr == null) return [];
  const closes = bars.map((b) => b.c);
  const cands = pivotLows(bars).map((p) => ({ price: p.price, kind: "pivot low", date: p.d, rank: 0 }));
  for (const n of [20, 50, 200]) if (closes.length >= n) cands.push({ price: round(mean(closes.slice(-n))), kind: `${n}-day`, rank: 1 });
  const year = bars.slice(-252);
  const low = year.reduce((p, q) => (q.l < p.l ? q : p));
  cands.push({ price: round(low.l), kind: "52-week low", date: low.d, rank: 2 });
  cands.sort((a, b) => b.price - a.price || a.rank - b.rank);
  const out = [];
  let ceiling = price - atr;
  for (const c of cands) {
    if (out.length >= max) break;
    if (c.price > ceiling) continue;
    const { rank, ...level } = c;
    out.push(level);
    ceiling = c.price - atr;
  }
  return out;
}

// Up a full ATR on the day. The HODL rule: never lump-sum into a spike. A flag, never a refusal.
export const isSpikeDay = ({ price, prevClose, atr }) => atr != null && price - prevClose >= atr;

// After the close the last settled bar IS today, so today has to be measured against the bar before it.
export function spikeRead({ settled, live, price }) {
  const base = live ? settled : settled.slice(0, -1);
  const atr = atr14(base), prevClose = base.at(-1)?.c;
  return { spike: isSpikeDay({ price, prevClose, atr }), atrs: atr ? round((price - prevClose) / atr) : null };
}

// A level written during a session starts counting the next session: that day's low happened before it existed.
export const levelsAsOf = ({ settled, live }) => live?.d ?? settled.at(-1).d;

// While the session is open today's daily bar is a moving target: it gives a price, never a level.
export function settledBars(bars, { nyDate, nyMinutes }) {
  const last = bars.at(-1);
  if (last && last.d === nyDate && nyMinutes < 16 * 60) return { settled: bars.slice(0, -1), live: last };
  return { settled: bars, live: null };
}

export function parseGate(text) {
  const out = {};
  for (const part of String(text).split(",").map((s) => s.trim()).filter(Boolean)) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (!GATE_TESTS.includes(k)) throw new Error(`unknown HODL gate test "${k}" (${GATE_TESTS.join(", ")})`);
    out[k] = v;
  }
  return out;
}

export function addName(db, { sym, why, date, by = "adam", price, spy, gate = {}, row = null, kill = null, tranche = null }) {
  const key = String(sym).toUpperCase();
  if (!why || !String(why).trim()) throw new Error("a stack name needs --why: the reason to own it for months");
  if (!row) throw new Error("a stack name needs --row: run the framework first, so the book shows what the desk thought that day");
  if (!(price > 0)) throw new Error("the add price must be a positive number");
  if (!(spy > 0)) throw new Error("the SPY price must be a positive number");
  if (tranche != null && !(tranche > 0)) throw new Error("the tranche must be a positive dollar amount");
  if (db.names[key]) throw new Error(`${key} is already on the stack lane`);
  const entry = { sym: key, added: date, by, why: String(why).trim(), row, kill, tranche_dollars: tranche, gate, add_price: price, add_spy: spy, buys: [], levels: [], levels_asof: null, touches: [] };
  db.names[key] = entry;
  return entry;
}

export function setTranche(entry, dollars) {
  if (!(dollars > 0)) throw new Error("the tranche must be a positive dollar amount");
  entry.tranche_dollars = dollars;
}

export function tranchePlan(entry, levels) {
  const d = entry.tranche_dollars;
  return levels.map((l) => ({ ...l, shares: d ? Math.floor((d / l.price) * 100) / 100 : null, dollars: d ?? null }));
}

export function recordBuy(entry, { shares, price, spy, date }) {
  if (!(shares > 0)) throw new Error("shares must be positive");
  if (!(price > 0)) throw new Error("price must be positive");
  if (!(spy > 0)) throw new Error("the SPY price that day is required, or the buy cannot be scored");
  entry.buys.push({ date, shares, price, spy });
}

export function position(entry) {
  const shares = entry.buys.reduce((p, b) => p + b.shares, 0);
  const cost = entry.buys.reduce((p, b) => p + b.shares * b.price, 0);
  return { shares: round(shares, 4), cost: round(cost), avg: shares ? round(cost / shares) : null };
}

const change = (now, then) => round((now / then - 1) * 100);

// Yahoo's history is adjusted for every split and what was recorded is not, so a split dated after a buy is carried onto that buy.
const splitFactor = (splits, date) => splits.filter((s) => s.d > date).reduce((p, s) => p * s.factor, 1);

export function scoreName(entry, { price, spy, account = null, splits = [] }) {
  const pct = change(price, entry.add_price / splitFactor(splits, entry.added)), spy_pct = change(spy, entry.add_spy);
  const base = { sym: entry.sym, price, pct, spy_pct, vs_spy: round(pct - spy_pct) };
  if (!entry.buys.length) return { ...base, mode: "watch", held: null, tranches: [] };
  const buys = entry.buys.map((b) => { const f = splitFactor(splits, b.date); return { ...b, shares: b.shares * f, price: b.price / f }; });
  const p = position({ buys });
  const value = round(p.shares * price);
  const spy_value = round(buys.reduce((s, b) => s + b.shares * b.price * (spy / b.spy), 0));
  const held = { shares: p.shares, avg: p.avg, cost: p.cost, value, pct: change(value, p.cost), spy_value, vs_spy_dollars: round(value - spy_value), account_pct: account ? round((value / account) * 100) : null };
  const tranches = buys.map((b) => {
    const tp = change(price, b.price), ts = change(spy, b.spy);
    return { date: b.date, shares: b.shares, price: b.price, pct: tp, spy_pct: ts, vs_spy: round(tp - ts) };
  });
  return { ...base, mode: "held", held, tranches };
}

// Only bars newer than the levels count, so a re-run on the same night adds nothing. One touch per level, the first date.
export function checkTouches(entry, bars) {
  const fresh = bars.filter((b) => b.d > (entry.levels_asof ?? ""));
  const found = [];
  for (const level of entry.levels) {
    const bar = fresh.find((b) => b.l <= level.price);
    if (bar) found.push({ date: bar.d, price: level.price, kind: level.kind, low: bar.l, close: bar.c });
  }
  entry.touches.push(...found);
  return found;
}

// ---- command line ----
const argv = process.argv.slice(2);
const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const num = (k) => (val(k) === undefined ? undefined : Number(val(k)));
const has = (k) => argv.includes(k);
const dbPath = () => (val("--db") ? resolve(val("--db")) : resolve(ROOT, "db/stack.json"));
const load = () => (existsSync(dbPath()) ? JSON.parse(readFileSync(dbPath(), "utf8")) : { schema: 1, names: {} });
const save = (db) => { const p = dbPath(), tmp = `${p}.tmp`; writeFileSync(tmp, JSON.stringify(db, null, 2) + "\n"); renameSync(tmp, p); }; // never a half-written file

function nyNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { nyDate: `${p.year}-${p.month}-${p.day}`, nyMinutes: Number(p.hour) * 60 + Number(p.minute) };
}

async function bars(sym) {
  if (val("--bars-file")) {
    const rows = JSON.parse(readFileSync(resolve(val("--bars-file")), "utf8"))[sym] ?? null;
    return rows ? { rows, splits: [] } : null;
  }
  const iso = (s) => new Date(s * 1000).toISOString().slice(0, 10);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y&events=split`, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.ok) {
        const c = (await r.json()).chart.result[0], q = c.indicators.quote[0];
        const rows = c.timestamp.map((s, n) => ({ d: iso(s), o: q.open[n], h: q.high[n], l: q.low[n], c: q.close[n], v: q.volume[n] })).filter((b) => b.c != null && b.l != null && b.h != null);
        return { rows, splits: Object.values(c.events?.splits ?? {}).map((s) => ({ d: iso(s.date), factor: s.numerator / s.denominator })) };
      }
    } catch { /* retried below */ }
    await new Promise((r) => setTimeout(r, 900));
  }
  return null;
}

async function tape(sym) {
  const got = await bars(sym);
  if (!got || got.rows.length < 15) throw new Error(`no price history for ${sym}`);
  const { settled, live } = settledBars(got.rows, nyNow());
  return { settled, live, splits: got.splits, price: live?.c ?? settled.at(-1).c };
}

const needName = (db, sym) => { const e = db.names[String(sym).toUpperCase()]; if (!e) throw new Error(`${sym} is not on the stack lane`); return e; };
const gateLine = (e) => { const k = Object.keys(e.gate); return k.length ? `HODL gate: ${k.map((x) => `${x}: ${e.gate[x]}`).join(", ")} (recorded, never a refusal)` : "HODL gate: not answered yet"; };
const money = (n) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const signed = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function printLevels(entry, levels) {
  if (!levels.length) { console.log("add levels: none under the price"); return; }
  console.log("add levels (the lane adds on weakness, each one a separate decision for Adam):");
  for (const l of tranchePlan(entry, levels)) console.log(`  ${l.price.toFixed(2)}  ${l.kind}${l.shares ? `  ${l.shares} shares for ${money(l.dollars)}` : ""}`);
  if (!entry.tranche_dollars) console.log("size: none named yet. Adam names the dollars per add.");
}

function printSpike(t, price) {
  const { spike, atrs } = spikeRead({ settled: t.settled, live: t.live, price });
  if (spike) console.log(`SPIKE DAY: up ${atrs} ATR on the day. The lane does not lump-sum into a spike.`);
}

async function main() {
  const [cmd, symArg] = argv;
  const db = load();
  const today = val("--date") ?? nyNow().nyDate;

  if (cmd === "add") {
    const sym = String(symArg).toUpperCase();
    const t = await tape(sym);
    const price = num("--price") ?? t.price;
    const spy = num("--spy") ?? (await tape("SPY")).price;
    const entry = addName(db, { sym, why: val("--why"), date: today, by: val("--by") ?? "adam", price, spy, row: val("--row") ?? null, kill: val("--kill") ?? null, tranche: num("--tranche-dollars") ?? null, gate: val("--gate") ? parseGate(val("--gate")) : {} });
    entry.levels = addLevels(t.settled, { price });
    entry.levels_asof = levelsAsOf(t);
    save(db);
    console.log(`${sym} on the stack lane, by ${entry.by}, ${today}${entry.row ? `, row ${entry.row}` : ""}`);
    console.log(`why: ${entry.why}`);
    console.log(`at ${price.toFixed(2)} with SPY ${spy.toFixed(2)}, ATR ${atr14(t.settled)}`);
    if (entry.kill) console.log(`thesis dies if: ${entry.kill}`);
    console.log(gateLine(entry));
    printSpike(t, price);
    printLevels(entry, entry.levels);
    return;
  }

  if (cmd === "size") {
    const entry = needName(db, symArg);
    setTranche(entry, num("--tranche-dollars"));
    save(db);
    console.log(`${entry.sym}: ${money(entry.tranche_dollars)} per add`);
    printLevels(entry, entry.levels);
    return;
  }

  if (cmd === "buy") {
    const entry = needName(db, symArg);
    const dateGiven = val("--date");
    if (dateGiven && !/^\d{4}-\d{2}-\d{2}$/.test(dateGiven)) throw new Error("--date must be YYYY-MM-DD");
    let spy = num("--spy");
    if (spy === undefined) {
      const got = await bars("SPY");
      spy = dateGiven ? got?.rows.find((b) => b.d === dateGiven)?.c : got?.rows.at(-1)?.c;
      if (spy === undefined) throw new Error(`no SPY close found for ${today}; pass --spy`);
    }
    recordBuy(entry, { shares: num("--shares"), price: num("--price"), spy, date: today });
    save(db);
    const p = position(entry);
    console.log(`${entry.sym}: recorded ${num("--shares")} at ${num("--price")}. Now ${p.shares} shares, average ${p.avg}, cost ${money(p.cost)}.`);
    return;
  }

  if (cmd === "levels") {
    const entry = needName(db, symArg);
    const t = await tape(entry.sym);
    console.log(`${entry.sym} at ${t.price.toFixed(2)}, ATR ${atr14(t.settled)}`);
    printSpike(t, t.price);
    printLevels(entry, addLevels(t.settled, { price: t.price }));
    return;
  }

  if (cmd === "report") {
    const names = Object.values(db.names);
    if (!names.length) { console.log("Stack lane: empty."); return; }
    const given = val("--prices") ? JSON.parse(val("--prices")) : {};
    const spy = given.SPY ?? (await tape("SPY")).price;
    console.log(`STACK LANE, ${today}. SPY ${spy.toFixed(2)}. Price return, dividends not counted.`);
    for (const e of names) {
      let price = given[e.sym], splits = [];
      if (price === undefined) {
        try { const t = await tape(e.sym); price = t.price; splits = t.splits; }
        catch (err) { console.log(`\nSTACK: ${e.sym} no data (${err.message})`); continue; }
      }
      const s = scoreName(e, { price, spy, account: num("--account") ?? null, splits });
      console.log(`\n${e.sym} (${s.mode}) ${price.toFixed(2)}. Since added ${e.added} at ${e.add_price}: ${signed(s.pct)}, SPY ${signed(s.spy_pct)}, ${signed(s.vs_spy)} vs SPY.`);
      if (s.held) {
        const h = s.held;
        console.log(`  ${h.shares} shares, average ${h.avg}, cost ${money(h.cost)}, value ${money(h.value)} (${signed(h.pct)}). The same dollars in SPY: ${money(h.spy_value)}, so ${money(h.vs_spy_dollars)} vs SPY.${h.account_pct != null ? ` ${h.account_pct}% of the account.` : ""}`);
        for (const t of s.tranches) console.log(`    ${t.date}: ${t.shares} at ${t.price}: ${signed(t.pct)}, SPY ${signed(t.spy_pct)}, ${signed(t.vs_spy)} vs SPY`);
      }
      console.log(`  ${gateLine(e)}`);
      if (e.kill) console.log(`  thesis dies if: ${e.kill}`);
      printLevels(e, e.levels);
    }
    return;
  }

  if (cmd === "check") {
    const names = Object.values(db.names);
    let touched = 0;
    for (const e of names) {
      let t;
      try { t = await tape(e.sym); } catch (err) { console.log(`STACK: ${e.sym} no data (${err.message})`); continue; }
      for (const hit of checkTouches(e, t.settled)) {
        touched++;
        console.log(`STACK: ${e.sym} touched ${hit.price.toFixed(2)} (${hit.kind}) on ${hit.date}, low ${hit.low.toFixed(2)}, closed ${hit.close.toFixed(2)}.${e.kill ? ` Thesis dies if: ${e.kill}.` : ""}`);
      }
      e.levels = addLevels(t.settled, { price: t.settled.at(-1).c });
      e.levels_asof = t.settled.at(-1).d;
    }
    if (!touched) console.log(`STACK: no add level touched (${names.length} name${names.length === 1 ? "" : "s"}).`);
    if (has("--write")) save(db);
    return;
  }

  throw new Error("usage: stack.mjs add|size|buy|levels|report|check (see the header)");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`stack: ${e.message}`); process.exit(1); });
}
