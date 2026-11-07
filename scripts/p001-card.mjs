#!/usr/bin/env node
// p001-card.mjs - the Vans Thesis P-001 card as an image (Adam, 2026-11-06: "Add it to the routine and give me an
// X post with it now and every morning"). Same numbers as `paper-book.mjs record`, drawn as the dark card first
// made by hand on 2026-11-05 (docs/share/2026-11-05-p001-card.html). Writes nothing but the card files.
// NO DOLLARS (Adam, 2026-11-06: "stop mentioning the money that doesn't exist"): there is no paper account, only a
// list of trades, so the card shows won/lost, % and R. Never put a dollar figure back on it.
//
//   node scripts/p001-card.mjs --prices '{"LITE":560.75,...}' --asof "6:41 a.m. CT" [--spy-pct 0.4] [--date YYYY-MM-DD] [--no-png]
//
// Out: docs/share/<date>-p001-card.html and .png (rendered by headless Edge or Chrome), then one JSON line with the
// totals and the png path, for the post that goes with it. Tests: test/p001-card.test.mjs.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { record } from "./paper-book.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const MAX_CLOSED_ROWS = 3; // the newest closed trades get a row; the rest are one summary line

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const minus = (s) => s.replace(/^-/, "\u2212");
const pctS = (x) => minus(`${x < 0 ? "-" : "+"}${Math.abs(x).toFixed(1)}%`);
const rS = (x) => minus(`${x < 0 ? "-" : "+"}${Math.abs(x).toFixed(2)}R`);
const px = (x) => (x == null ? "?" : Number(x).toFixed(2));
const tone = (x) => (x < 0 ? "loss" : "win");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const shortDate = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const longDate = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return `${DAYS[d.getUTCDay()]} ${shortDate(iso)}, ${iso.slice(0, 4)}`; };

// The small line under a ticker. Warnings (red) when the mark is at or past the stop or within 2% of it.
export function rowNote(row, trade, today) {
  const notes = [];
  let warn = false;
  if (trade?.t1_done) notes.push("half sold at target");
  if (row.price != null && row.to_stop_pct != null) {
    if (row.to_stop_pct <= 0) { notes.push(`${px(row.price)} is through its ${px(row.stop)} stop`); warn = true; }
    else if (row.to_stop_pct < 2) { notes.push(`stop ${row.to_stop_pct.toFixed(1)}% away`); warn = true; }
  }
  if (row.price != null && !row.quoted) notes.push("last close, no pre-market quote");
  if (row.exit_by === today) notes.push("exits at today's close");
  return { text: notes.join(" \u00b7 "), warn };
}

export function cardHtml(rec, book, { today, asof, spyPct } = {}) {
  const byId = Object.fromEntries((book.trades || []).map((t) => [t.id, t]));
  const sub = [`Pre-market marks ${longDate(today)}`, asof, spyPct == null ? null : `SPY ${pctS(spyPct)} pre-market`].filter(Boolean).join(" \u00b7 ");
  const lines = [];
  for (const r of rec.rows) {
    const n = rowNote(r, byId[r.id], today);
    const note = n.text ? `<span class="note${n.warn ? " warn" : ""}">${esc(n.text)}</span>` : "";
    const head = `<td><span class="sym">${esc(r.sym)}</span><span class="side">${esc(r.side)}</span>${note}</td>`;
    if (r.price == null) { lines.push(`<tr>${head}<td class="px">no mark yet</td><td class="r"></td><td class="r"></td></tr>`); continue; }
    lines.push(`<tr>${head}<td class="px"><b>${px(r.entry)}</b> \u2192 <b>${px(r.price)}</b></td><td class="r ${tone(r.pct)}">${pctS(r.pct)}</td><td class="r ${tone(r.r)}">${rS(r.r)}</td></tr>`);
  }
  const closed = [...rec.closed].sort((a, b) => String(b.exit_date).localeCompare(String(a.exit_date)));
  for (const c of closed.slice(0, MAX_CLOSED_ROWS)) {
    // A stop that closes a winner (the rest after a target, on the raised stop) is not a loss: say so, and no red.
    const won = (c.realized || 0) > 0;
    const why = c.exit_reason === "TARGET" ? `target hit ${shortDate(c.exit_date)}` : c.exit_reason === "STOPPED" ? `stopped${won ? " in profit" : ""} ${shortDate(c.exit_date)}` : `closed ${shortDate(c.exit_date)}`;
    lines.push(`<tr class="closed"><td><span class="sym">${esc(c.sym)}</span><span class="side">${esc(c.side)}</span><span class="note${c.exit_reason === "STOPPED" && !won ? " warn" : ""}">${why}</span></td><td class="px">closed</td><td class="r"></td><td class="r ${tone(c.r ?? 0)}">${c.r == null ? "" : rS(c.r)}</td></tr>`);
  }
  const rest = closed.slice(MAX_CLOSED_ROWS);
  if (rest.length) {
    const sum = rest.reduce((a, c) => a + (c.r || 0), 0);
    lines.push(`<tr class="closed"><td colspan="3"><span class="note">${rest.length} more closed trades</span></td><td class="r ${tone(sum)}">${rS(sum)}</td></tr>`);
  }
  const won = rec.won;
  // header + stats + footer, then about 100px a row. A row with a note measures ~98px; 82 let the footer run over
  // the last rows once there were 10 (found on the 2026-11-06 test render).
  const height = 740 + lines.length * 100;
  return { height, html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>P-001 card ${today}</title>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@500;600&family=Inter:wght@400;500;600&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1200px; height: ${height}px; background: #111111; }
  body { font-family: 'Inter', sans-serif; color: #E8E4DA; padding: 72px 72px 56px; position: relative; overflow: hidden; }
  .kicker { font-size: 20px; letter-spacing: 0.22em; text-transform: uppercase; color: #D4AF37; font-weight: 600; }
  h1 { font-family: 'EB Garamond', serif; font-weight: 600; font-size: 76px; line-height: 1.02; color: #F5ECCB; margin-top: 18px; }
  .sub { font-size: 22px; color: #8F8A7A; margin-top: 14px; }
  .stats { display: flex; gap: 20px; margin-top: 40px; }
  .stat { flex: 1; background: #1A1916; border: 1px solid #26241F; border-radius: 14px; padding: 22px 26px; }
  .stat .lbl { font-size: 16px; letter-spacing: 0.12em; text-transform: uppercase; color: #8F8A7A; }
  .stat .val { font-family: 'EB Garamond', serif; font-size: 50px; font-weight: 600; color: #F5ECCB; margin-top: 6px; }
  .stat .val.loss { color: #E5484D; }
  table { width: 100%; border-collapse: collapse; margin-top: 36px; }
  th { text-align: left; font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase; color: #8F8A7A; font-weight: 500; padding: 0 0 12px; border-bottom: 1px solid #26241F; }
  th.r, td.r { text-align: right; padding-left: 18px; white-space: nowrap; }
  td.px { white-space: nowrap; padding-left: 12px; }
  td { padding: 15px 0; border-bottom: 1px solid #26241F; font-size: 23px; vertical-align: middle; }
  .sym { font-family: 'EB Garamond', serif; font-size: 34px; font-weight: 600; color: #F5ECCB; }
  .side { font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase; color: #9A7E28; margin-left: 10px; font-weight: 600; }
  .px { color: #8F8A7A; }
  .px b { color: #E8E4DA; font-weight: 500; }
  .win { color: #F5ECCB; font-weight: 600; }
  .loss { color: #E5484D; font-weight: 600; }
  .note { display: block; font-size: 15px; color: #D4AF37; margin-top: 4px; letter-spacing: 0.04em; }
  .note.warn { color: #E5484D; }
  .closed td { color: #8F8A7A; }
  .closed .sym { color: #8F8A7A; }
  .closed td.loss { color: #E5484D; }
  .foot { position: absolute; left: 72px; right: 72px; bottom: 56px; display: flex; justify-content: space-between; align-items: flex-end; }
  .motto { font-family: 'EB Garamond', serif; font-style: italic; font-size: 34px; color: #D4AF37; }
  .disc { font-size: 16px; color: #8F8A7A; text-align: right; line-height: 1.5; }
  .seal { position: absolute; top: 64px; right: 72px; transform: rotate(-8deg); border: 3px solid #D4AF37; color: #D4AF37; border-radius: 10px; padding: 10px 18px; font-size: 18px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; text-align: center; line-height: 1.3; }
</style></head>
<body>
  <div class="seal">Paper<br>record</div>
  <div class="kicker">The Bench \u00b7 Vans Thesis P-001</div>
  <h1>Every call on the record,<br>before the outcome.</h1>
  <div class="sub">${esc(sub)}</div>
  <div class="stats">
    <div class="stat"><div class="lbl">Won – lost</div><div class="val">${won} – ${rec.closed.length - won}</div></div>
    <div class="stat"><div class="lbl">Closed R</div><div class="val ${rec.closed_r < 0 ? "loss" : ""}">${rS(rec.closed_r)}</div></div>
    <div class="stat"><div class="lbl">Open R</div><div class="val ${rec.open_r < 0 ? "loss" : ""}">${rS(rec.open_r)}</div></div>
    <div class="stat"><div class="lbl">Counted trades</div><div class="val">${rec.counted} of ${rec.need}</div></div>
  </div>
  <table>
    <tr><th>Call</th><th>Entry \u2192 now</th><th class="r">Move</th><th class="r">R</th></tr>
    ${lines.join("\n    ")}
  </table>
  <div class="foot">
    <div class="motto">Proof, not hype.</div>
    <div class="disc">Paper trades, no real money.<br>Losses logged as loud as wins.<br>Not financial advice. Educational only.</div>
  </div>
</body></html>
` };
}

const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];

function render(htmlPath, pngPath, height) {
  const exe = BROWSERS.find((p) => existsSync(p));
  if (!exe) throw new Error("no Edge or Chrome found to draw the card");
  execFileSync(exe, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--virtual-time-budget=6000", `--window-size=1200,${height}`,
    `--screenshot=${pngPath}`, `file:///${htmlPath.replace(/\\/g, "/")}`], { stdio: "ignore", timeout: 60000 });
  if (!existsSync(pngPath)) throw new Error("the browser ran but wrote no png");
}

function main(argv = process.argv.slice(2)) {
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  let prices = {};
  try { prices = val("--prices") ? JSON.parse(val("--prices")) : {}; } catch { throw new Error("--prices must be JSON like '{\"LITE\":560.75}'"); }
  const today = val("--date") || new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const spy = val("--spy-pct");
  const book = JSON.parse(readFileSync(resolve(ROOT, "db/paper-book.json"), "utf8"));
  const rec = record(book, prices);
  const { html, height } = cardHtml(rec, book, { today, asof: val("--asof"), spyPct: spy == null ? null : Number(spy) });
  const htmlPath = resolve(ROOT, `docs/share/${today}-p001-card.html`);
  const pngPath = resolve(ROOT, `docs/share/${today}-p001-card.png`);
  writeFileSync(htmlPath, html);
  if (!argv.includes("--no-png")) render(htmlPath, pngPath, height);
  console.log(JSON.stringify({ png: argv.includes("--no-png") ? null : pngPath, html: htmlPath, counted: rec.counted, need: rec.need,
    open: rec.rows.length, closed: rec.closed.length, won: rec.won, closed_r: rec.closed_r, open_r: rec.open_r,
    unquoted: rec.rows.filter((r) => !r.quoted).map((r) => r.sym) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`[p001-card] ${e.message}`); process.exit(1); }
}
