// build.mjs — THE BENCH static site generator. Zero dependencies.
//
//   node site/build.mjs        # reads db/ + site/reviews/, writes site/dist/
//
// The site is a read-only window onto the book: every call timestamped before
// the outcome, losses as loud as wins. No API, no server — the daily routines
// rebuild and redeploy (netlify deploy --prod --dir site/dist).

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "site/dist");
const REVIEWS_DIR = resolve(ROOT, "site/reviews");

const archive = JSON.parse(readFileSync(resolve(ROOT, "db/archive.json"), "utf8"));
const patterns = JSON.parse(readFileSync(resolve(ROOT, "db/patterns.json"), "utf8"));
const catalysts = existsSync(resolve(ROOT, "db/catalysts.json"))
  ? JSON.parse(readFileSync(resolve(ROOT, "db/catalysts.json"), "utf8"))
  : [];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const builtAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

const CSS = `
:root { --bg:#0d1117; --panel:#161b22; --line:#30363d; --text:#e6edf3; --dim:#8b949e;
        --green:#3fb950; --red:#f85149; --amber:#d29922; --accent:#58a6ff; }
* { box-sizing:border-box; margin:0; }
body { background:var(--bg); color:var(--text); font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif; }
.wrap { max-width:1000px; margin:0 auto; padding:24px 16px 64px; }
header { border-bottom:1px solid var(--line); padding-bottom:16px; margin-bottom:24px; }
h1 { font-size:26px; letter-spacing:.5px; } h1 a { color:var(--text); text-decoration:none; }
h2 { font-size:20px; margin:28px 0 12px; } h3 { font-size:17px; margin:20px 0 8px; }
nav a { color:var(--accent); text-decoration:none; margin-right:18px; font-weight:600; }
.tag { color:var(--dim); font-size:13px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
.tablewrap { overflow-x:auto; border:1px solid var(--line); border-radius:8px; }
th,td { padding:8px 10px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top; }
th { background:var(--panel); position:sticky; top:0; }
tr:last-child td { border-bottom:none; }
.right { color:var(--green); font-weight:700; } .wrong { color:var(--red); font-weight:700; }
.flat { color:var(--amber); font-weight:700; } .dim { color:var(--dim); }
.cards { display:flex; gap:12px; flex-wrap:wrap; margin:16px 0; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px 18px; min-width:120px; }
.card b { display:block; font-size:26px; }
.callcell { max-width:520px; }
pre.review { background:var(--panel); border:1px solid var(--line); border-radius:8px;
  padding:18px; white-space:pre-wrap; word-wrap:break-word; font:14px/1.55 ui-monospace,Consolas,monospace; }
.disclaimer { margin-top:40px; padding-top:14px; border-top:1px solid var(--line); color:var(--dim); font-size:13px; }
.reviewbody { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:20px 24px; }
.reviewbody p { margin:10px 0; } .reviewbody li { margin:4px 0 4px 18px; }
.reviewbody em { color:var(--dim); }
`;

function layout(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · THE BENCH</title><style>${CSS}</style></head><body><div class="wrap">
<header><h1><a href="index.html">THE BENCH</a> <span class="tag">proof, not hype</span></h1>
<nav><a href="index.html">Scoreboard</a><a href="book.html">The Book</a><a href="patterns.html">Patterns</a><a href="reviews.html">Reviews</a><a href="https://x.com/TheBenchTrades">@TheBenchTrades</a></nav></header>
${body}
<div class="disclaimer">Every call is timestamped and logged before the outcome is known — wins and losses both stay on the record.
This is analysis and education, not financial advice. Nothing here is a recommendation to buy or sell any security.
Built ${builtAt} from the live book.</div>
</div></body></html>`;
}

// ---- scoreboard --------------------------------------------------------------
const checkpoints = [];
for (const row of archive) {
  for (const [horizon, cp] of Object.entries(row.checkpoints ?? {})) {
    checkpoints.push({ id: row.id, ticker: row.ticker, horizon, ...cp });
  }
}
const tally = { right: 0, wrong: 0, flat: 0, not_scorable: 0 };
for (const c of checkpoints) tally[c.verdict] = (tally[c.verdict] ?? 0) + 1;

const verdictCls = { right: "right", wrong: "wrong", flat: "flat", not_scorable: "dim" };
const verdictLabel = { right: "RIGHT", wrong: "WRONG", flat: "flat", not_scorable: "—" };
const fmtPct = (n) => (typeof n === "number" ? `${n > 0 ? "+" : ""}${n}%` : "n/a");

const scoredRows = checkpoints
  .filter((c) => c.verdict !== "not_scorable")
  .sort((a, b) => (a.asof < b.asof ? 1 : -1));

const scoreTable = `<div class="tablewrap"><table><tr><th>ID</th><th>Ticker</th><th>Horizon</th><th>Verdict</th><th>Move</th><th>vs bench</th><th>Note</th></tr>
${scoredRows.map((c) => `<tr><td>${esc(c.id)}</td><td><b>${esc(c.ticker)}</b></td><td>${esc(c.horizon)}</td>
<td class="${verdictCls[c.verdict]}">${verdictLabel[c.verdict]}</td><td>${fmtPct(c.asset_pct)}</td>
<td>${esc(c.bench)} ${fmtPct(c.bench_pct)}</td><td class="dim">${esc(c.note)}</td></tr>`).join("")}
</table></div>`;

// ---- catalysts ---------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const upcoming = catalysts.filter((c) => c.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
const catalystList = upcoming.length
  ? `<div class="tablewrap"><table><tr><th>Date</th><th>Catalyst</th></tr>
${upcoming.map((c) => `<tr><td>${esc(c.date)}</td><td>${esc(c.label)}</td></tr>`).join("")}</table></div>`
  : `<p class="dim">No dated catalysts on the board.</p>`;

// ---- reviews -----------------------------------------------------------------
// Minimal renderer: #/##/### headings, **bold**, *italic*, - lists, paragraphs.
function mdToHtml(md) {
  const inline = (s) =>
    esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  const out = [];
  let inList = false;
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    if (inList && !t.startsWith("- ")) { out.push("</ul>"); inList = false; }
    if (!t) continue;
    if (t.startsWith("### ")) out.push(`<h3>${inline(t.slice(4))}</h3>`);
    else if (t.startsWith("## ")) out.push(`<h2>${inline(t.slice(3))}</h2>`);
    else if (t.startsWith("# ")) out.push(`<h2>${inline(t.slice(2))}</h2>`);
    else if (t.startsWith("- ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(t.slice(2))}</li>`);
    } else out.push(`<p>${inline(t)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

const reviewFiles = existsSync(REVIEWS_DIR)
  ? readdirSync(REVIEWS_DIR).filter((f) => f.endsWith(".md")).sort().reverse()
  : [];
const reviews = reviewFiles.map((f) => {
  const md = readFileSync(resolve(REVIEWS_DIR, f), "utf8");
  const title = (md.match(/^# (.+)$/m) ?? [null, f])[1];
  return { file: f, slug: f.replace(/\.md$/, ".html"), title, md };
});

// ---- pages -------------------------------------------------------------------
mkdirSync(DIST, { recursive: true });

const latest = reviews[0];
writeFileSync(resolve(DIST, "index.html"), layout("Scoreboard", `
<h2>The Scoreboard</h2>
<p class="dim">Every graded checkpoint from the book — a call scores at 1 week and 1 month against its benchmark.</p>
<div class="cards">
<div class="card"><b class="right">${tally.right}</b>right</div>
<div class="card"><b class="wrong">${tally.wrong}</b>wrong</div>
<div class="card"><b class="flat">${tally.flat}</b>flat</div>
<div class="card"><b class="dim">${tally.not_scorable}</b>not scorable</div>
<div class="card"><b>${archive.length}</b>calls on the book</div>
</div>
${latest ? `<h2>Latest review</h2><p><a href="${esc(latest.slug)}" style="color:var(--accent)">${esc(latest.title)}</a></p>` : ""}
<h2>Live catalysts</h2>${catalystList}
<h2>Graded checkpoints</h2>${scoreTable}`));

writeFileSync(resolve(DIST, "book.html"), layout("The Book", `
<h2>The Book — ${archive.length} calls, append-only</h2>
<p class="dim">One row per review. Logged before the outcome. A refused guess and a logged loss are both the system working.</p>
<div class="tablewrap"><table><tr><th>ID</th><th>Date</th><th>Ticker</th><th>Price</th><th>Type</th><th>Trigger</th><th>The call</th></tr>
${[...archive].reverse().map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.date)}</td><td><b>${esc(r.ticker)}</b></td>
<td>${typeof r.review_price === "number" ? "$" + r.review_price : "—"}</td><td>${esc(r.call_type ?? "—")}</td>
<td>${typeof r.trigger === "number" ? r.trigger : (r.trigger?.level ?? "—")}</td>
<td class="callcell">${esc(String(r.final_call ?? "").slice(0, 400))}${String(r.final_call ?? "").length > 400 ? "…" : ""}</td></tr>`).join("")}
</table></div>`));

writeFileSync(resolve(DIST, "patterns.html"), layout("Patterns", `
<h2>Patterns — how the tape behaves</h2>
<p class="dim">A pattern needs a falsification test to get logged and three held instances to be promoted past <i>proposed</i>.</p>
${patterns.map((p) => {
  const held = p.instances.filter((i) => i.holds).length;
  return `<h3>${esc(p.id)} · ${esc(p.status)} · ${held}/${p.instances.length} held</h3>
<p><b>${esc(p.claim)}</b></p><p class="dim">Test: ${esc(p.test)}</p>
<div class="tablewrap"><table><tr><th>Date</th><th>Ticker</th><th>Holds</th><th>Detail</th></tr>
${p.instances.map((i) => `<tr><td>${esc(i.date)}</td><td><b>${esc(i.ticker)}</b></td>
<td class="${i.holds ? "right" : "wrong"}">${i.holds ? "yes" : "NO"}</td><td class="callcell">${esc(i.detail)}</td></tr>`).join("")}
</table></div>`;
}).join("")}`));

writeFileSync(resolve(DIST, "reviews.html"), layout("Reviews", `
<h2>Reviews — every run, posted as it looked when it ran</h2>
${reviews.length ? `<ul>${reviews.map((r) => `<li><a href="${esc(r.slug)}" style="color:var(--accent)">${esc(r.title)}</a></li>`).join("")}</ul>` : `<p class="dim">First review lands with the next run.</p>`}`));

for (const r of reviews) {
  writeFileSync(resolve(DIST, r.slug), layout(r.title, `<div class="reviewbody">${mdToHtml(r.md)}</div>`));
}

console.log(`built site/dist: index, book (${archive.length} rows), patterns (${patterns.length}), ${reviews.length} review(s), ${upcoming.length} catalysts`);
