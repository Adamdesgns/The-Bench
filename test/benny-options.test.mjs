// benny-options.test.mjs — Benny's paper options lane: ask-in/bid-out fills, positive EV at the fill, 2% sizing,
// the 6% open-risk cap, nightly scoring at real quotes, and the VS S&P report. Offline only; never touches db/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { entryDebit, exitValue, intrinsic, evAtFill, openOption, stepOption } from "../scripts/benny-options.mjs";
import { summarize, vsSpy } from "../scripts/paper-book.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/benny-options.mjs");
const PB = resolve(HERE, "../scripts/paper-book.mjs");
const cfg = { start_balance: 10000, risk_pct: 1, options_risk_pct: 2, options_max_open_pct: 6, options_pause_drawdown_pct: 15 };
const book = (o = {}) => ({ account: { start_date: "2026-10-16", start_balance: 10000 }, trades: [], history: [], skipped: [], ...o });
// ANET 10/30 170/165 put spread, quotes from 2026-10-16: 170 bid 3.75 ask 4.10, 165 bid 2.36 ask 2.82.
const anet = (o = {}) => ({
  sym: "ANET", row: "B-999", lane: "options-hunter", structure: "put-spread", expiry: "2026-10-30", longStrike: 170, shortStrike: 165,
  debit: 1.74, target: 160, exitBy: "2026-10-26", earnings: "2026-11-04", date: "2026-10-19", pDir: 0.55, pReach: 0.4, requireEv: true, ...o,
});
const run = (cli, args) => { try { return { out: execFileSync("node", [cli, ...args], { encoding: "utf8" }), code: 0 }; } catch (e) { return { out: String(e.stdout), code: e.status }; } };
const tmp = () => mkdtempSync(join(tmpdir(), "benny-opt-"));

// ---------- fill math ----------
test("entry pays the ask and sells the bid: ANET 170/165 = 4.10 - 2.36 = 1.74; a single option is its ask", () => {
  assert.equal(entryDebit({ long: { ask: 4.1 }, short: { bid: 2.36 } }), 1.74);
  assert.equal(entryDebit({ long: { ask: 0.87 } }), 0.87);
});

test("tonight's value is long bid - short ask, floored at 0 and capped at the width; a missing field is null", () => {
  assert.equal(exitValue({ long: { bid: 3.75 }, short: { ask: 2.82 } }, 5), 0.93);
  assert.equal(exitValue({ long: { bid: 0.1 }, short: { ask: 0.3 } }, 5), 0);
  assert.equal(exitValue({ long: { bid: 6.2 }, short: { ask: 0.1 } }, 5), 5);
  assert.equal(exitValue({ long: { bid: 0.79 } }, null), 0.79);
  assert.equal(exitValue({ long: { bid: 3.75 } }, 5), null);
  assert.equal(exitValue({ long: {} }, null), null);
});

test("intrinsic at expiry: puts and calls, single and spread, capped at the width", () => {
  assert.equal(intrinsic("put-spread", 170, 165, 160), 5);
  assert.equal(intrinsic("put-spread", 170, 165, 168), 2);
  assert.equal(intrinsic("put-spread", 170, 165, 175), 0);
  assert.equal(intrinsic("call-spread", 415, 420, 418.5), 3.5);
  assert.equal(intrinsic("call", 400, null, 412.25), 12.25);
  assert.equal(intrinsic("put", 11.5, null, 12), 0);
});

test("EV per contract at the fill = p_reach x (width - debit) x 100 - (1 - p_dir) x debit x 100", () => {
  assert.equal(evAtFill({ debit: 1.74, width: 5, pDir: 0.55, pReach: 0.4 }), 52.10);
  // NI 10/16 (B-941): p_reach 0, so any debit is negative EV.
  assert.ok(evAtFill({ debit: 0.2, width: 5, pDir: 0.5435, pReach: 0 }) < 0);
});

// ---------- the entry gate ----------
test("2% of $10,000 is $200: ANET at 1.74 buys 1 contract, WULF at 0.76 buys 2; cost is recorded", () => {
  const a = openOption(book(), cfg, anet());
  assert.equal(a.trade.contracts, 1);
  assert.equal(a.trade.cost, 174);
  assert.equal(a.trade.kind, "option");
  assert.equal(a.trade.side, "short");
  assert.equal(a.trade.width, 5);
  assert.equal(a.trade.id, "PB-001");
  const w = openOption(book(), cfg, anet({ sym: "WULF", longStrike: 11.5, shortStrike: 9, debit: 0.76, target: 8.6 }));
  assert.equal(w.trade.contracts, 2);
});

test("one contract over the cap is refused with the numbers", () => {
  const r = openOption(book(), cfg, anet({ structure: "call-spread", sym: "UNH", longStrike: 415, shortStrike: 420, debit: 2.15, target: 430 }));
  assert.match(r.refused, /one contract costs 215.*cap 200/);
});

test("a spread whose ask/bid debit is at or above its width can never pay: UNH 400/402.5 at 2.60 is refused", () => {
  const r = openOption(book(), cfg, anet({ sym: "UNH", structure: "call-spread", longStrike: 400, shortStrike: 402.5, debit: 2.6, target: 420 }));
  assert.match(r.refused, /costs as much as it can ever pay/);
});

test("negative EV at the fill is refused when the gate is on; the desk lane may skip it", () => {
  assert.match(openOption(book(), cfg, anet({ pDir: 0.5, pReach: 0 })).refused, /EV/);
  assert.ok(openOption(book(), cfg, anet({ pDir: undefined, pReach: undefined, requireEv: false, lane: "options-desk" })).trade);
  assert.match(openOption(book(), cfg, anet({ pDir: undefined, pReach: undefined, requireEv: true })).refused, /no hunter odds/);
});

test("the open-risk cap (6% = $600) cuts contracts to what fits, then refuses when full", () => {
  const held = { kind: "option", status: "OPEN", sym: "X", cost: 450, contracts: 1, entry_debit: 4.5, last_value: null };
  const b = book({ trades: [held] });
  const r = openOption(b, cfg, anet({ sym: "WULF", longStrike: 11.5, shortStrike: 9, debit: 0.76, target: 8.6 })); // 2 wanted, room $150
  assert.equal(r.trade.contracts, 1);
  const full = book({ trades: [{ ...held, cost: 590 }] });
  assert.match(openOption(full, cfg, anet()).refused, /open-risk cap/);
});

test("the drawdown pause: equity 15%+ under its peak refuses new entries", () => {
  const b = book({ history: [{ date: "2026-10-17", equity: 10000 }], trades: [{ kind: "shares", status: "CLOSED", realized: -1600, r: -1 }] });
  assert.match(openOption(b, cfg, anet()).refused, /drawdown pause/);
});

test("earnings: missing is refused, on or before expiry is refused, after expiry or none is fine", () => {
  assert.match(openOption(book(), cfg, anet({ earnings: undefined })).refused, /earnings date was not checked/);
  assert.match(openOption(book(), cfg, anet({ earnings: "2026-10-30" })).refused, /earnings 2026-10-30 fall on or before the 2026-10-30 expiry/);
  assert.ok(openOption(book(), cfg, anet({ earnings: "none" })).trade);
});

test("no Friday-close entries, no second open trade on a ticker, strikes on the right side, exit capped at expiry", () => {
  assert.match(openOption(book(), cfg, anet({ date: "2026-10-23" })).refused, /Friday/);
  const b = book(); b.trades.push(openOption(b, cfg, anet()).trade);
  assert.match(openOption(b, cfg, anet()).refused, /ANET already has an open options trade/);
  assert.match(openOption(book(), cfg, anet({ shortStrike: 175 })).refused, /wrong side/);
  assert.equal(openOption(book(), cfg, anet({ exitBy: "2026-11-06" })).trade.exit_by, "2026-10-30");
});

// ---------- the nightly step ----------
const opened = (o = {}) => ({ ...openOption(book(), cfg, anet()).trade, ...o });

test("the entry day only marks the value", () => {
  const t = stepOption(opened(), { close: 150, long: { bid: 9 }, short: { ask: 4 } }, "2026-10-19");
  assert.equal(t.status, "OPEN");
  assert.equal(t.last_value, 5);
});

test("TARGET: the close reaches the target and the spread sells at the bid", () => {
  const t = stepOption(opened(), { close: 159.5, long: { bid: 10.2 }, short: { ask: 6.1 } }, "2026-10-21");
  assert.equal(t.status, "CLOSED");
  assert.equal(t.exit_reason, "TARGET");
  assert.equal(t.exit_value, 4.1);
  assert.equal(t.realized, 236);
  assert.equal(t.r, 1.36);
});

test("EXIT-BY sells at the bid on the decide-by date; a missing quote leaves the trade alone", () => {
  const t = stepOption(opened(), { close: 171, long: { bid: 2.1 }, short: { ask: 1.6 } }, "2026-10-26");
  assert.equal(t.exit_reason, "EXIT-BY");
  assert.equal(t.realized, -124);
  const same = opened();
  assert.equal(stepOption(same, { close: 171, long: {} }, "2026-10-21"), same);
});

test("expiry pays intrinsic at the close: in the money capped at the width, out of the money 0", () => {
  const late = opened({ exit_by: "2026-10-30" });
  assert.equal(stepOption(late, { close: 150 }, "2026-10-30").realized, 326);
  const lost = stepOption(late, { close: 180 }, "2026-10-30");
  assert.equal(lost.exit_reason, "EXPIRED");
  assert.equal(lost.realized, -174);
  assert.equal(lost.r, -1);
});

// ---------- paper-book integration ----------
test("summarize counts an option's open profit; vsSpy compares Benny with SPY and the 15%/yr pace", () => {
  const b = book({ trades: [opened({ last_value: 2.5 })] });
  assert.equal(summarize(b).unrealized, 76);
  b.account.spy_start = { date: "2026-10-16", close: 763.3 };
  b.history = [{ date: "2026-11-16", equity: 10150, spy: 770 }];
  const v = vsSpy(b);
  assert.equal(v.book_pct, 1.5);
  assert.equal(v.spy_pct, 0.88);
  assert.equal(v.gap_pts, 0.62);
  assert.equal(v.pace_pct, 1.19);
  assert.equal(vsSpy(book()), null);
});

test("paper-book score leaves options trades alone; report shows them, the open risk and REVIEW DUE at 10 closed", () => {
  const d = tmp(), db = join(d, "benny-book.json");
  const closed = Array.from({ length: 10 }, (_, i) => opened({ id: `PB-1${i}`, sym: `Z${i}`, status: "CLOSED", realized: 10, r: 0.06, exit_reason: "TARGET" }));
  const b = book({ trades: [opened({ last_value: 2 }), ...closed] });
  b.account.spy_start = { date: "2026-10-16", close: 763.3 };
  writeFileSync(db, JSON.stringify(b));
  const s = run(PB, ["score", "--bars", "{}", "--date", "2026-10-21", "--db", db, "--write"]);
  assert.equal(s.code, 0);
  assert.doesNotMatch(s.out, /NO BAR/);
  assert.equal(JSON.parse(readFileSync(db, "utf8")).trades[0].last_scored, null);
  const r = run(PB, ["report", "--db", db]).out;
  assert.match(r, /OPTION PB-001 ANET put-spread 170\/165 2026-10-30 x1/);
  assert.match(r, /OPTIONS OPEN RISK 174/);
  assert.match(r, /LANE options-hunter: 10 closed .*REVIEW DUE/);
});

// ---------- CLI ----------
const ranked = {
  kind: "options-hunter-rank", asof: "2026-10-19", band: 349.45,
  top: [
    { sym: "ANET", side: "short", list: "READY", p_dir: 55, p_reach: 40, expiry: "2026-10-30", long_strike: 170, short_strike: 160, target: 160 },
    { sym: "NI", side: "long", list: "READY", p_dir: 54.35, p_reach: 0, expiry: "2026-11-20", long_strike: 45, short_strike: 50, target: 47.05 },
    { sym: "CORZ", side: "short", list: "STALK", p_dir: 41.94, p_reach: 3.23, expiry: "2026-10-23", long_strike: 13.5, short_strike: 11, target: 11.04 },
  ],
  rest: [],
};
const setup = () => {
  const d = tmp();
  writeFileSync(join(d, "benny-book.json"), JSON.stringify(book()));
  writeFileSync(join(d, "benny-config.json"), JSON.stringify(cfg));
  writeFileSync(join(d, "ranked.json"), JSON.stringify(ranked));
  return d;
};
const args = (d) => ["--db", join(d, "benny-book.json"), "--config", join(d, "benny-config.json")];

test("hunt-add: a positive-EV READY spread (narrowed to 170/165) is added, negative EV is skipped and recorded, STALK is ignored", () => {
  const d = setup();
  const quotes = { ANET: { expiry: "2026-10-30", long: { strike: 170, ask: 4.1 }, short: { strike: 165, bid: 2.36 } }, NI: { expiry: "2026-11-20", long: { strike: 45, ask: 0.3 }, short: { strike: 50, bid: 0.1 } } };
  const r = run(CLI, ["hunt-add", "--ranked", join(d, "ranked.json"), "--quotes", JSON.stringify(quotes), "--earnings", '{"ANET":"2026-11-04","NI":"none"}', "--date", "2026-10-19", ...args(d)]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ADDED +PB-001 ANET put-spread 170\/165/);
  assert.match(r.out, /SKIPPED +NI .*EV/);
  assert.doesNotMatch(r.out, /CORZ/);
  const b = JSON.parse(readFileSync(join(d, "benny-book.json"), "utf8"));
  assert.equal(b.trades[0].lane, "options-hunter");
  assert.equal(b.trades[0].exit_by, "2026-10-26");
  assert.equal(b.skipped[0].kind, "option");
});

test("hunt-add refuses a quote on a different expiry or a short strike outside the hunter's spread", () => {
  const d = setup();
  const bad = { ANET: { expiry: "2026-11-06", long: { strike: 170, ask: 4.1 }, short: { strike: 165, bid: 2.36 } } };
  assert.match(run(CLI, ["hunt-add", "--ranked", join(d, "ranked.json"), "--quotes", JSON.stringify(bad), "--earnings", '{"ANET":"none"}', "--date", "2026-10-19", ...args(d)]).out, /SKIPPED +ANET .*expiry/);
  const wide = { ANET: { expiry: "2026-10-30", long: { strike: 170, ask: 4.1 }, short: { strike: 155, bid: 0.5 } } };
  assert.match(run(CLI, ["hunt-add", "--ranked", join(d, "ranked.json"), "--quotes", JSON.stringify(wide), "--earnings", '{"ANET":"none"}', "--date", "2026-10-19", ...args(d)]).out, /SKIPPED +ANET .*short strike/);
});

test("add (desk lane), need, score --write with SPY, and spy-start", () => {
  const d = setup();
  assert.equal(run(CLI, ["spy-start", "--close", "763.30", "--date", "2026-10-16", ...args(d)]).code, 0);
  const a = run(CLI, ["add", "--sym", "WULF", "--row", "B-950", "--structure", "put", "--expiry", "2026-10-30", "--long-strike", "11.5", "--long-ask", "0.87", "--target", "10", "--exit-by", "2026-10-26", "--earnings", "2026-11-06", "--date", "2026-10-19", ...args(d)]);
  assert.match(a.out, /ADDED +PB-001 WULF put 11.5 2026-10-30 x2/);
  const need = JSON.parse(run(CLI, ["need", "--json", ...args(d)]).out);
  assert.deepEqual(need, [{ id: "PB-001", sym: "WULF", expiry: "2026-10-30", type: "put", long_strike: 11.5, short_strike: null }]);
  const s = run(CLI, ["score", "--quotes", '{"PB-001":{"close":11.2,"long":{"bid":0.95,"ask":1.0}}}', "--spy", "765.10", "--date", "2026-10-20", "--write", ...args(d)]);
  assert.match(s.out, /OPEN +PB-001 WULF value 0.95/);
  const b = JSON.parse(readFileSync(join(d, "benny-book.json"), "utf8"));
  assert.deepEqual(b.account.spy_start, { date: "2026-10-16", close: 763.3 });
  assert.equal(b.history.at(-1).spy, 765.1);
  assert.equal(b.history.at(-1).equity, 10016);
});

test("the options CLI refuses Adam's own paper book", () => {
  const d = setup();
  const r = run(CLI, ["need", "--db", join(d, "paper-book.json"), "--config", join(d, "benny-config.json")]);
  assert.equal(r.code, 1);
  assert.match(r.out, /never in Adam's paper book/);
});
