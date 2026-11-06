// ntfy-paper.test.mjs - the phone gets plans and plays only, and never a paper trade (Adam, 2026-11-04). Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripPaper, PAPER_SLOTS, main } from "../scripts/ntfy-read.mjs";

const quiet = async (fn) => { const log = console.log; const out = []; console.log = (m) => out.push(String(m)); try { return { r: await fn(), out }; } finally { console.log = log; } };

test("stripPaper drops paper paragraphs and standings rows, keeps the market lines", () => {
  const read = [
    "The board is split and the split is the read. AMD 511.59 (+5.7%).",
    "",
    "On the paper book: AMZN 258.29 is through the 255.36 stop on the 231.10 short.",
    "",
    "PAPER BOOK",
    " 5. AMZN short -11.77% -326.28 (-1.12R) | 231.1 -> 258.29 | stop 255.36 | scanner short [hunt:ebcb2d94]",
    " 1. REGN long +4.1% | 917.21 -> 955 | desk buy [B-1100]",
    "  AMZN short wide twin: -0.45R, stop 263.45",
    "P-001 - the Vans Thesis paper record.",
    "Best % first. On a short, + means the stock fell.",
    "",
    "Decisions due: PWR B-1247, trigger 645.33.",
  ].join("\n");
  const { body, dropped } = stripPaper(read);
  assert.equal(dropped, 7);
  assert.equal(body, "The board is split and the split is the read. AMD 511.59 (+5.7%).\n\nDecisions due: PWR B-1247, trigger 645.33.");
});

test("a real ticket is never dropped: a PB id or a paper clause is scrubbed out of it (review findings 1 and 2)", () => {
  const cards = [
    ["BUY 5 PWR LIMIT 610.50 DAY, then SELL 5 STOP 590 GTC. Target 650. Added to the paper book as PB-021. [B-1280]", "BUY 5 PWR LIMIT 610.50 DAY, then SELL 5 STOP 590 GTC. Target 650. [B-1280]"],
    ["ENTER ANET 18 sh at 192.50 (PB-020), stop 182.50, T1 200.68 [B-1253]", "ENTER ANET 18 sh at 192.50, stop 182.50, T1 200.68 [B-1253]"],
    ["SHORT 40 AMZN at 262.10, stop 271, target 244.73 [B-1290]", "SHORT 40 AMZN at 262.10, stop 271, target 244.73 [B-1290]"],
    ["NO AMZN: the short gates fail, it leads SPY on both windows.", "NO AMZN: the short gates fail, it leads SPY on both windows."],
  ];
  for (const [card, want] of cards) assert.equal(stripPaper(card).body, want);
});

test("the P-001 slot and market-read slots are refused; plan, play, trip and pump go", async () => {
  assert.ok(PAPER_SLOTS.test("p001"));
  assert.ok(!PAPER_SLOTS.test("premarket"));
  const { r: refused, out } = await quiet(() => main(["--slot", "premarket", "--text", "SPY 765 up 1.5%.", "--dry-run"]));
  assert.equal(refused, 0);
  assert.ok(out.some((m) => /not a plan or a play/.test(m)));
  assert.equal((await quiet(() => main(["--slot", "p001", "--text", "anything", "--dry-run"]))).r, 0);
  for (const slot of ["plan", "play", "trip", "pump"]) assert.equal((await quiet(() => main(["--slot", slot, "--text", "ANET ENTER 191.27-194.14, stop 182.50 (B-1253).", "--dry-run"]))).r, 1, slot);
});

test("--asked sends what Adam asked for, paper included, unstripped", async () => {
  const { r, out } = await quiet(() => main(["--slot", "p001", "--asked", "--text", "P-001: AMZN paper short stopped at 264.97.", "--dry-run"]));
  assert.equal(r, 1);
  assert.ok(out.some((m) => /P-001: AMZN paper short/.test(m)));
});

test("a plan or play card that is all paper is NOT sent and says so (exit 4 from the CLI)", async () => {
  assert.equal((await quiet(() => main(["--slot", "play", "--text", "Paper book: META 630 is 17 from its stop.", "--dry-run"]))).r, -4);
});

test("xpost is a standing ask (Adam, 2026-11-06): sent with its image, paper lines kept", async () => {
  const text = "Vans Thesis paper trades this morning, 12 of 60 in, down $311 open.";
  const { r, out } = await quiet(() => main(["--slot", "xpost", "--image", "docs/share/2026-11-06-p001-card.png", "--text", text, "--dry-run"]));
  assert.equal(r, 1);
  assert.ok(out.some((l) => /would send image/.test(l)));
  assert.ok(out.includes(text)); // the post line went out whole, paper words and all
  assert.equal((await quiet(() => main(["--slot", "p001", "--text", text, "--dry-run"]))).r, 0); // the plain p001 slot is still refused
});
