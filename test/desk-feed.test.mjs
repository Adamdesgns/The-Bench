// desk-feed.test.mjs — offline, zero-dep. node --test test/desk-feed.test.mjs
//
// The failure mode of a name extractor is not a crash. It is a quiet feed that
// either misses the day's biggest mover or collects a book id as a ticker.
// Every fixture here is a shape that actually appeared in docs/reads/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  stripIds, collectKnown, extractTickers, matchAliases, inWindow, buildDeskFeed, appendManual,
} from "../scripts/desk-feed.mjs";

const known = new Set(["HPE", "DELL", "NVDA", "SPY", "ANET", "HP", "ET", "B", "SNDK", "STX", "WDC", "ORCL"]);
const stoplist = new Set(["HP", "ET", "AI", "CEO"]);
const aliases = { SanDisk: "SNDK", Seagate: "STX", "Western Digital": "WDC", Dell: "DELL", Oracle: "ORCL" };

test("book, pattern, quant and read ids are stripped before tokenising", () => {
  const out = stripIds("That is P-032, logged with B-360, QR-019 and R-017.");
  assert.doesNotMatch(out, /B-360|P-032|QR-019|R-017/);
});

test("a book id never becomes the ticker B, and single letters are ignored", () => {
  const { hits } = extractTickers("Logged B-360. I think A is fine.", { known, stoplist });
  assert.deepEqual(hits, []);
});

test("known tickers are kept with their line number", () => {
  const { hits } = extractTickers("tape line\nHPE closed 62.08 and SPY 764.20", { known, stoplist });
  assert.deepEqual(hits, [{ symbol: "HPE", line: 2 }, { symbol: "SPY", line: 2 }]);
});

test("stoplisted and unknown tokens are reported, never kept", () => {
  const r = extractTickers("HP said ET close, CPI hot, AI capex", { known, stoplist });
  assert.deepEqual(r.hits, []);
  assert.deepEqual([...r.stoplisted].sort(), ["AI", "ET", "HP"]);
  assert.deepEqual([...r.unknown].sort(), ["CPI"]);
});

test("the 2026-09-11 closing read names storage by company, and the aliases catch it", () => {
  const line = "Storage sold off outright: SanDisk down 3.48, Seagate down 3.80, Western Digital down 2.98.";
  assert.deepEqual(matchAliases(line, aliases).map((h) => h.symbol).sort(), ["SNDK", "STX", "WDC"]);
  assert.deepEqual(extractTickers(line, { known, stoplist }).hits, []);
});

test("an alias matches a possessive but not a longer word or a different case", () => {
  assert.equal(matchAliases("Dell's gap floor", aliases).length, 1);
  assert.equal(matchAliases("Dellwood Capital", aliases).length, 0);
  assert.equal(matchAliases("the oracle of Omaha", aliases).length, 0);
});

test("collectKnown reads every shape the repo stores tickers in, and nothing else", () => {
  const k = collectKnown([
    { symbols: [{ symbol: "AAPL", band: "MEGA" }] },
    [{ id: "B-001", ticker: "MSFT", final_call: "No Trade" }],
    [{ sym: "AVGO", note: "WATCH" }],
    { layers: { buyers: { what: "The capex line", tickers: ["GOOGL", "AMZN"] } }, added: [{ sym: "MRVL" }] },
    { quotes: [{ sym: "HPQ", last: 35.4 }] },
    { _rule: "VERIFY A TICKER", note: "lower case aapl is not a ticker" },
  ]);
  assert.deepEqual([...k].sort(), ["AAPL", "AMZN", "AVGO", "GOOGL", "HPQ", "MRVL", "MSFT"]);
});

test("the window starts after the previous session, so a weekend feeds Monday", () => {
  const w = { after: "2026-09-11", through: "2026-09-14" };
  assert.equal(inWindow("2026-09-11", w), false);
  assert.equal(inWindow("2026-09-12", w), true);
  assert.equal(inWindow("2026-09-14", w), true);
  assert.equal(inWindow("2026-09-15", w), false);
  assert.equal(inWindow(undefined, w), false);
});

test("buildDeskFeed merges book, reads and manual adds and says why for each", () => {
  const feed = buildDeskFeed({
    date: "2026-09-11",
    window: { after: "2026-09-10", through: "2026-09-11" },
    archiveRows: [
      { id: "B-360", date: "2026-09-11", ticker: "DELL" },
      { id: "B-331", date: "2026-09-10", ticker: "ANET" },
    ],
    reads: [{ file: "2026-09-11-close.md", text: "HPE closed 62.08.\nSeagate down 3.80." }],
    manual: [{ symbol: "keel", note: "screen from chat" }],
    known,
    stoplist,
    aliases,
  });
  assert.deepEqual(feed.symbols.map((s) => s.symbol), ["DELL", "HPE", "KEEL", "STX"]);
  assert.deepEqual(feed.counts, { symbols: 4, book: 1, read: 2, manual: 1 });
  const stx = feed.symbols.find((s) => s.symbol === "STX");
  assert.deepEqual(stx.why, [{ source: "read", file: "2026-09-11-close.md", line: 2, via: "alias", name: "Seagate" }]);
});

test("manual adds append, dedupe within a call, and refuse anything that is not a ticker", () => {
  const p = join(mkdtempSync(join(tmpdir(), "desk-manual-")), "manual", "2026-09-14.json");
  appendManual(p, { date: "2026-09-14", symbols: ["mrvl", " COHR ", "MRVL"], note: "chat screen", addedAt: "2026-09-12T22:00:00Z" });
  const doc = appendManual(p, { date: "2026-09-14", symbols: ["AIP"], note: null, addedAt: "2026-09-12T22:05:00Z" });
  assert.deepEqual(doc.adds.map((a) => a.symbol), ["MRVL", "COHR", "AIP"]);
  assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), doc);
  assert.throws(() => appendManual(p, { date: "2026-09-14", symbols: ["B-360"], addedAt: "x" }), /not tickers/);
  assert.throws(() => appendManual(p, { date: "2026-09-14", symbols: [" ", ""], addedAt: "x" }), /no symbols/);
});
