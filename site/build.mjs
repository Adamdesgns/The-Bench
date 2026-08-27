// build.mjs — THE BENCH static site generator. Zero dependencies.
//
//   node site/build.mjs        # reads db/ + site/reviews/, writes site/dist/
//
// The site is a read-only window onto the book: every call timestamped before
// the outcome, losses as loud as wins. No API, no server — the daily routines
// rebuild and redeploy (npx --yes netlify-cli deploy --prod --dir site/dist -
// the bare netlify CLI is not installed on this machine; see CLAUDE.md).
//
// Design language: a scoreboard. Condensed varsity display type, brass-gold
// accents, monospaced figures, and the season record worn in the masthead.

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
const tape = existsSync(resolve(ROOT, "db/tape.json"))
  ? JSON.parse(readFileSync(resolve(ROOT, "db/tape.json"), "utf8"))
  : { asof: "", quotes: [] };
const watchlist = existsSync(resolve(ROOT, "db/watchlist.json"))
  ? JSON.parse(readFileSync(resolve(ROOT, "db/watchlist.json"), "utf8"))
  : [];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const builtAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

// ---- data first: the record is worn in the masthead --------------------------
const checkpoints = [];
for (const row of archive) {
  for (const [horizon, cp] of Object.entries(row.checkpoints ?? {})) {
    checkpoints.push({ id: row.id, ticker: row.ticker, horizon, ...cp });
  }
}
const tally = { right: 0, wrong: 0, flat: 0, not_scorable: 0 };
for (const c of checkpoints) tally[c.verdict] = (tally[c.verdict] ?? 0) + 1;
const record = `${tally.right}–${tally.wrong}–${tally.flat}`;

// ---- the look ----------------------------------------------------------------
const CSS = `
:root {
  --ink:#0b0d10; --felt:#101319; --panel:#151a22; --panel2:#1a2029; --line:#2a313c;
  --text:#e9edf2; --dim:#98a2b0; --faint:#5c6674;
  --brass:#d4a53a; --brass-dim:#9a7826;
  --win:#41c26f; --loss:#e5544b; --push:#d9a13c;
  --display:'Oswald','Arial Narrow',system-ui,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,Consolas,monospace;
  --body:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif;
}
* { box-sizing:border-box; margin:0; }
html { background:var(--ink); }
body { background:
    radial-gradient(1200px 400px at 50% -220px, #1a2130 0%, transparent 70%),
    var(--ink);
  color:var(--text); font:15px/1.65 var(--body); }
.wrap { max-width:1060px; margin:0 auto; padding:28px 20px 72px; }

/* masthead */
.mast { display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap; gap:14px; }
.mark { font-family:var(--display); font-weight:600; font-size:46px; line-height:1;
  letter-spacing:2px; text-transform:uppercase; }
.mark a { color:var(--text); text-decoration:none; }
.mark .the { color:var(--brass); }
.motto { font-family:var(--mono); font-size:11px; letter-spacing:4px; text-transform:uppercase;
  color:var(--dim); margin-top:8px; }
.recordchip { text-align:right; }
.recordchip .lbl { font-family:var(--mono); font-size:10px; letter-spacing:3px; color:var(--faint);
  text-transform:uppercase; }
.recordchip .num { font-family:var(--display); font-size:34px; font-weight:600; letter-spacing:2px;
  color:var(--brass); line-height:1.1; }
.rail { height:3px; margin:18px 0 0;
  background:linear-gradient(90deg, var(--brass) 0%, var(--brass-dim) 55%, transparent 100%); }
nav { display:flex; gap:26px; padding:14px 0 22px; border-bottom:1px solid var(--line);
  margin-bottom:30px; flex-wrap:wrap; }
nav a { color:var(--dim); text-decoration:none; font-family:var(--display); font-size:15px;
  letter-spacing:2.5px; text-transform:uppercase; padding-bottom:3px; border-bottom:2px solid transparent; }
nav a:hover, nav a.here { color:var(--text); border-bottom-color:var(--brass); }

/* sections */
.kicker { font-family:var(--mono); font-size:10px; letter-spacing:4px; text-transform:uppercase;
  color:var(--brass); margin-bottom:6px; }
h2 { font-family:var(--display); font-weight:500; font-size:26px; letter-spacing:1px;
  text-transform:uppercase; margin:34px 0 14px; }
h2:first-of-type { margin-top:0; }
h3 { font-family:var(--display); font-weight:500; font-size:19px; letter-spacing:.5px; margin:26px 0 10px; }
p.lede { color:var(--dim); max-width:70ch; }

/* scoreboard tiles */
.board { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; margin:18px 0 8px; }
.tile { background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--line);
  border-radius:10px; padding:16px 18px 13px; box-shadow:inset 0 1px 0 rgba(255,255,255,.04); }
.tile b { display:block; font-family:var(--mono); font-weight:600; font-size:34px; line-height:1.1; }
.tile span { font-family:var(--mono); font-size:10px; letter-spacing:3px; text-transform:uppercase; color:var(--faint); }
.w { color:var(--win); } .l { color:var(--loss); } .p { color:var(--push); } .d { color:var(--dim); }

/* tables */
.tablewrap { overflow-x:auto; border:1px solid var(--line); border-radius:10px; background:var(--felt); }
table { width:100%; border-collapse:collapse; font-size:13.5px; }
th { font-family:var(--mono); font-size:10px; letter-spacing:2.5px; text-transform:uppercase;
  color:var(--brass-dim); background:var(--panel); padding:10px 12px; text-align:left;
  border-bottom:1px solid var(--line); white-space:nowrap; }
td { padding:9px 12px; border-bottom:1px solid rgba(42,49,60,.55); vertical-align:top; }
tr:nth-child(even) td { background:rgba(255,255,255,.015); }
tr:last-child td { border-bottom:none; }
td.num, td.tick { font-family:var(--mono); white-space:nowrap; }
td.tick { font-weight:600; }
.callcell { max-width:540px; color:var(--dim); }
.pill { display:inline-block; font-family:var(--mono); font-size:10.5px; font-weight:600;
  letter-spacing:1.5px; padding:2px 9px; border-radius:20px; border:1px solid; }
.pill.w { color:var(--win); border-color:rgba(65,194,111,.4); background:rgba(65,194,111,.08); }
.pill.l { color:var(--loss); border-color:rgba(229,84,75,.4); background:rgba(229,84,75,.08); }
.pill.p { color:var(--push); border-color:rgba(217,161,60,.4); background:rgba(217,161,60,.08); }
.pill.d { color:var(--faint); border-color:var(--line); }

/* review pages — the research note */
.notehead { background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--line);
  border-left:4px solid var(--brass); border-radius:10px; padding:16px 22px; margin-bottom:22px; }
.notehead .kicker { margin-bottom:2px; }
.notehead .title { font-family:var(--display); font-size:24px; font-weight:500; letter-spacing:.5px; }
.reviewbody { background:var(--felt); border:1px solid var(--line); border-radius:10px; padding:26px 30px; }
.reviewbody h2 { font-size:21px; margin:26px 0 10px; }
.reviewbody h2:first-child { margin-top:0; }
.reviewbody p { margin:11px 0; } .reviewbody li { margin:5px 0 5px 20px; }
.reviewbody em { color:var(--dim); }
.reviewbody b { color:var(--text); }
.rlist { list-style:none; }
.rlist li { margin:0 0 12px; }
.rlist a { display:block; background:var(--panel); border:1px solid var(--line); border-left:4px solid var(--brass);
  border-radius:10px; padding:14px 20px; color:var(--text); text-decoration:none;
  font-family:var(--display); font-size:18px; letter-spacing:.5px; }
.rlist a:hover { background:var(--panel2); }
a.plain { color:var(--brass); text-decoration:none; }
a.plain:hover { text-decoration:underline; }

/* ticker tape */
.tape { overflow:hidden; white-space:nowrap; background:var(--felt); border:1px solid var(--line);
  border-radius:8px; margin-bottom:20px; position:relative; }
.tape:hover .tapein { animation-play-state:paused; }
.tapein { display:inline-block; padding:8px 0; animation:tapescroll 45s linear infinite;
  font-family:var(--mono); font-size:13px; }
.tapein .q { margin:0 28px 0 0; }
.tapein .sym { color:var(--text); font-weight:600; letter-spacing:1px; }
.tapein .px { color:var(--dim); margin-left:7px; }
.tapein .up { color:var(--win); margin-left:6px; } .tapein .dn { color:var(--loss); margin-left:6px; }
.tapein .asof { color:var(--faint); font-size:11px; letter-spacing:2px; margin-right:28px; }
@keyframes tapescroll { from { transform:translateX(0); } to { transform:translateX(-50%); } }
@media (prefers-reduced-motion:reduce) { .tapein { animation:none; } }

/* fine print */
.disclaimer { margin-top:48px; padding-top:16px; border-top:1px solid var(--line);
  color:var(--faint); font-size:12px; max-width:88ch; }
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap" rel="stylesheet">`;

const NAV = [
  ["index.html", "Scoreboard"],
  ["book.html", "The Book"],
  ["patterns.html", "Patterns"],
  ["reviews.html", "Reviews"],
  ["https://x.com/TheBenchTrades", "@TheBenchTrades"]
];

const tapeSeq = tape.quotes.map((q) => {
  const chg = typeof q.chg_pct === "number"
    ? `<span class="${q.chg_pct >= 0 ? "up" : "dn"}">${q.chg_pct >= 0 ? "▲" : "▼"} ${Math.abs(q.chg_pct).toFixed(2)}%</span>`
    : "";
  return `<span class="q"><span class="sym">${esc(q.sym)}</span><span class="px">${q.last}</span>${chg}</span>`;
}).join("") + `<span class="asof">TAPE AS OF ${esc(tape.asof).toUpperCase()}</span>`;
const tapeStrip = tape.quotes.length
  ? `<div class="tape"><div class="tapein">${tapeSeq}${tapeSeq}</div></div>`
  : "";

function layout(title, body, activeHref = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · THE BENCH</title>${FONTS}<style>${CSS}</style></head><body><div class="wrap">
${tapeStrip}
<div class="mast">
  <div><div class="mark"><a href="index.html"><span class="the">THE</span> BENCH</a></div>
  <div class="motto">Proof, Not Hype — Every Call On The Record Before The Outcome</div></div>
  <div class="recordchip"><div class="lbl">Season Record W–L–P</div><div class="num">${record}</div></div>
</div>
<div class="rail"></div>
<nav>${NAV.map(([href, label]) => `<a href="${href}"${href === activeHref ? ' class="here"' : ""}>${label}</a>`).join("")}</nav>
${body}
<div class="disclaimer">Every call is timestamped and logged before the outcome is known — wins and losses both stay on the record.
This is analysis and education, not financial advice. Nothing here is a recommendation to buy or sell any security.
Built ${builtAt} from the live book.</div>
</div></body></html>`;
}

// ---- shared bits -------------------------------------------------------------
const verdictPill = {
  right: '<span class="pill w">WIN</span>',
  wrong: '<span class="pill l">LOSS</span>',
  flat: '<span class="pill p">PUSH</span>',
  not_scorable: '<span class="pill d">—</span>'
};
const fmtPct = (n) => (typeof n === "number" ? `${n > 0 ? "+" : ""}${n}%` : "n/a");

const scoredRows = checkpoints
  .filter((c) => c.verdict !== "not_scorable")
  .sort((a, b) => (a.asof < b.asof ? 1 : -1));

const scoreTable = `<div class="tablewrap"><table><tr><th>ID</th><th>Ticker</th><th>Horizon</th><th>Verdict</th><th>Move</th><th>vs Bench</th><th>Note</th></tr>
${scoredRows.map((c) => `<tr><td class="num">${esc(c.id)}</td><td class="tick">${esc(c.ticker)}</td><td class="num">${esc(c.horizon)}</td>
<td>${verdictPill[c.verdict]}</td><td class="num">${fmtPct(c.asset_pct)}</td>
<td class="num">${esc(c.bench)} ${fmtPct(c.bench_pct)}</td><td class="callcell">${esc(c.note)}</td></tr>`).join("")}
</table></div>`;

const today = new Date().toISOString().slice(0, 10);
const upcoming = catalysts.filter((c) => c.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
const catalystList = upcoming.length
  ? `<div class="tablewrap"><table><tr><th>Date</th><th>Type</th><th>Catalyst</th></tr>
${upcoming.map((c) => `<tr><td class="num">${esc(c.date)}</td><td>${esc((c.type ?? "—").toUpperCase())}${c.confidence && c.confidence !== "confirmed" ? " ?" : ""}</td><td>${esc(c.label)}</td></tr>`).join("")}</table></div>`
  : `<p class="lede">No dated catalysts on the board.</p>`;

// ---- reviews -----------------------------------------------------------------
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
    else if (t.startsWith("# ")) continue; // title renders in the note header
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
  const date = (f.match(/^(\d{4}-\d{2}-\d{2})/) ?? [null, ""])[1];
  return { file: f, slug: f.replace(/\.md$/, ".html"), title, md, date };
});

// ---- pages -------------------------------------------------------------------
mkdirSync(DIST, { recursive: true });

const latest = reviews[0];
writeFileSync(resolve(DIST, "index.html"), layout("Scoreboard", `
<div class="kicker">The Record</div>
<h2>Scoreboard</h2>
<p class="lede">Every graded checkpoint from the book — a call scores at 1 week and 1 month against its benchmark. Wins and losses both stay up.</p>
<div class="board">
<div class="tile"><b class="w">${tally.right}</b><span>Wins</span></div>
<div class="tile"><b class="l">${tally.wrong}</b><span>Losses</span></div>
<div class="tile"><b class="p">${tally.flat}</b><span>Pushes</span></div>
<div class="tile"><b class="d">${tally.not_scorable}</b><span>Not Scorable</span></div>
<div class="tile"><b>${archive.length}</b><span>Calls On The Book</span></div>
</div>
${latest ? `<div class="kicker" style="margin-top:26px">Fresh Off The Bench</div>
<ul class="rlist"><li><a href="${esc(latest.slug)}">${esc(latest.title)}</a></li></ul>` : ""}
<div class="kicker" style="margin-top:26px">The Active Board</div>
<h2 style="margin-top:0">Watchlist</h2>
<div class="tablewrap"><table><tr><th>Ticker</th><th>Last</th><th>Day</th><th>Status</th><th>Why it's on the board</th></tr>
${watchlist.map((w) => {
  const q = tape.quotes.find((t) => t.sym === w.sym);
  const chg = q && typeof q.chg_pct === "number"
    ? `<span class="${q.chg_pct >= 0 ? "w" : "l"}">${q.chg_pct >= 0 ? "+" : ""}${q.chg_pct.toFixed(2)}%</span>` : "—";
  return `<tr><td class="tick">${esc(w.sym)}</td><td class="num">${q ? "$" + q.last : "—"}</td><td class="num">${chg}</td>
<td><span class="pill ${w.status === "POSITION" ? "w" : w.status === "CHECKPOINT" ? "p" : "d"}">${esc(w.status)}</span></td>
<td class="callcell">${esc(w.note)}</td></tr>`;
}).join("")}
</table></div>
<div class="kicker" style="margin-top:26px">On The Calendar</div>
<h2 style="margin-top:0">Live Catalysts</h2>${catalystList}
<div class="kicker" style="margin-top:30px">Graded</div>
<h2 style="margin-top:0">Checkpoints</h2>${scoreTable}`, "index.html"));

writeFileSync(resolve(DIST, "book.html"), layout("The Book", `
<div class="kicker">Append-Only</div>
<h2>The Book — ${archive.length} Calls</h2>
<p class="lede">One row per review, logged before the outcome. A refused guess and a logged loss are both the system working.</p>
<div class="tablewrap"><table><tr><th>ID</th><th>Date</th><th>Ticker</th><th>Price</th><th>Type</th><th>Trigger</th><th>The Call</th></tr>
${[...archive].reverse().map((r) => `<tr><td class="num">${esc(r.id)}</td><td class="num">${esc(r.date)}</td><td class="tick">${esc(r.ticker)}</td>
<td class="num">${typeof r.review_price === "number" ? "$" + r.review_price : "—"}</td><td class="num">${esc(r.call_type ?? "—")}</td>
<td class="num">${typeof r.trigger === "number" ? r.trigger : (r.trigger?.level ?? "—")}</td>
<td class="callcell">${esc(String(r.final_call ?? "").slice(0, 400))}${String(r.final_call ?? "").length > 400 ? "…" : ""}</td></tr>`).join("")}
</table></div>`, "book.html"));

writeFileSync(resolve(DIST, "patterns.html"), layout("Patterns", `
<div class="kicker">How The Tape Behaves</div>
<h2>Patterns</h2>
<p class="lede">A pattern needs a falsification test to get logged and three held instances to be promoted past <em>proposed</em>.</p>
${patterns.map((p) => {
  const held = p.instances.filter((i) => i.holds).length;
  return `<h3>${esc(p.id)} · ${esc(p.status).toUpperCase()} · ${held}/${p.instances.length} held</h3>
<p><b>${esc(p.claim)}</b></p><p class="lede">Test: ${esc(p.test)}</p>
<div class="tablewrap"><table><tr><th>Date</th><th>Ticker</th><th>Holds</th><th>Detail</th></tr>
${p.instances.map((i) => `<tr><td class="num">${esc(i.date)}</td><td class="tick">${esc(i.ticker)}</td>
<td>${i.holds ? '<span class="pill w">HOLDS</span>' : '<span class="pill l">BROKE</span>'}</td><td class="callcell">${esc(i.detail)}</td></tr>`).join("")}
</table></div>`;
}).join("")}`, "patterns.html"));

writeFileSync(resolve(DIST, "reviews.html"), layout("Reviews", `
<div class="kicker">As It Looked When It Ran</div>
<h2>Live Runs</h2>
<p class="lede">Every framework run, published verbatim — the analysis exactly as it read the moment it was made, never edited after the fact.</p>
${reviews.length ? `<ul class="rlist">${reviews.map((r) => `<li><a href="${esc(r.slug)}">${esc(r.title)}</a></li>`).join("")}</ul>` : `<p class="lede">First review lands with the next run.</p>`}`, "reviews.html"));

for (const r of reviews) {
  writeFileSync(resolve(DIST, r.slug), layout(r.title, `
<div class="notehead"><div class="kicker">Live Run · Logged As It Ran${r.date ? " · " + esc(r.date) : ""}</div>
<div class="title">${esc(r.title)}</div></div>
<div class="reviewbody">${mdToHtml(r.md)}</div>`, "reviews.html"));
}

console.log(`built site/dist: index, book (${archive.length} rows), patterns (${patterns.length}), ${reviews.length} review(s), ${upcoming.length} catalysts — record ${record}`);
