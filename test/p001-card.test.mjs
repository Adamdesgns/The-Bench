import { test } from "node:test";
import assert from "node:assert/strict";
import { cardHtml, rowNote } from "../scripts/p001-card.mjs";
import { record } from "../scripts/paper-book.mjs";

const trade = (o) => ({ status: "OPEN", kind: "share", shares: 10, shares_open: 10, realized: 0, t1_done: false, entry_date: "2026-11-02", lane: "hunter-short", source_row: "B-1", ...o });
const book = { account: { start_balance: 3575.98 }, trades: [
  trade({ id: "PB-001", sym: "OLD", side: "short", entry: 50, stop: 55, t1: 40, exit_by: "2026-11-20", entry_date: "2026-10-20" }),
  trade({ id: "PB-002", sym: "AAA", side: "short", entry: 100, stop: 110, t1: 80, exit_by: "2026-11-06" }),
  trade({ id: "PB-003", sym: "BBB", side: "long", entry: 200, stop: 190, t1: 220, t2: 240, stop_after_t1: 199, t1_done: true, shares_open: 5, realized: 100, exit_by: "2026-11-13" }),
  trade({ id: "PB-004", sym: "CCC", side: "short", entry: 10, stop: 12, t1: 6, exit_by: "2026-11-19" }),
  { id: "PB-005", sym: "DDD", side: "short", lane: "hunter-short", entry_date: "2026-11-01", status: "CLOSED", realized: -50, r: -1, exit_reason: "STOPPED", exit_date: "2026-11-04", source_row: "B-2" },
] };

test("card counts only P-001 trades and shows the record's totals", () => {
  const rec = record(book, { AAA: 90, BBB: 198, CCC: 11 });
  const { html } = cardHtml(rec, book, { today: "2026-11-06", asof: "6:41 a.m. CT", spyPct: 0.36 });
  assert.equal(rec.counted, 4); // OLD was entered before 2026-10-27
  assert.ok(!html.includes(">OLD<"));
  assert.match(html, /4 of 60/);
  assert.match(html, /Fri Nov 6, 2026 · 6:41 a\.m\. CT · SPY \+0\.4% pre-market/);
  assert.match(html, /stopped Nov 4/);
});

test("notes: exit today, half sold, through the stop", () => {
  const rec = record(book, { AAA: 90, BBB: 198, CCC: 11 });
  const byId = Object.fromEntries(book.trades.map((t) => [t.id, t]));
  const note = (sym) => { const r = rec.rows.find((x) => x.sym === sym); return rowNote(r, byId[r.id], "2026-11-06"); };
  assert.deepEqual(note("AAA"), { text: "exits at today's close", warn: false });
  const b = note("BBB"); // after the half sale the stop is 199, and 198 is through it
  assert.equal(b.warn, true);
  assert.match(b.text, /half sold at target/);
  assert.match(b.text, /198\.00 is through its 199\.00 stop/);
  assert.equal(note("CCC").text, "");
});

test("unquoted names say so, and the card grows with its rows", () => {
  const rec = record(book, { AAA: 90 });
  const { html, height } = cardHtml(rec, book, { today: "2026-11-06" });
  assert.match(html, /last close, no pre-market quote|no mark yet/);
  const fewer = cardHtml(record({ ...book, trades: book.trades.slice(0, 2) }, {}), book, { today: "2026-11-06" });
  assert.ok(height > fewer.height);
});

test("text is escaped", () => {
  const evil = { ...book, trades: [trade({ id: "PB-009", sym: "<b>X", side: "short", entry: 10, stop: 12, t1: 6, exit_by: "2026-11-19" })] };
  const { html } = cardHtml(record(evil, { "<b>X": 9 }), evil, { today: "2026-11-06" });
  assert.ok(html.includes("&lt;b&gt;X"));
});
