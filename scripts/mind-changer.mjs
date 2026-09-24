// mind-changer.mjs — every "what would change my mind" test gets watched.
//
//   node scripts/mind-changer.mjs add --when "META>624.80" --meaning "real repricing, not a faded gap" \
//        --source docs/reads/2026-09-09-premarket.md [--row B-296] [--when "QQQ>=747.46"] [--expires 2026-09-12]
//   node scripts/mind-changer.mjs list [--json]                 open tests + the tickers to quote
//   node scripts/mind-changer.mjs check --prices '{"META":654}' [--date YYYY-MM-DD] [--write] [--json]
//   node scripts/mind-changer.mjs check --prices-file f.json ...
//   add --db f.json to any command for an offline test file
//
// WHY THIS EXISTS (2026-09-23)
// ----------------------------
// On 2026-09-09 the pre-market read passed on META's Muse launch and wrote its
// own test: "META holding above 624.80 into the bell makes it a real
// repricing." META closed 654 that day. Nothing was watching the sentence, no
// row turned it into a ticket, and META was 748 twelve days later (B-529).
// A condition that lives only in prose only works when someone happens to
// re-read it - the B-116 lesson, a second time. This keeps the tests as data.
//
// A test is one or more conditions on official closes, ALL of which must hold
// ("PWR>650.58" + "GEV>957.27" + "QQQ>=747.46"). It fires, holds, or expires.
// A fired test is not a ticket - it is a mandatory re-look: the desk writes a
// row saying what it does about it. Zero-dep. Writes only db/mind-changers.json.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");

export function nyDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "META>624.80" -> { ticker: "META", op: ">", level: 624.8 }
export function parseWhen(s) {
  const m = String(s).replace(/\s+/g, "").match(/^([A-Za-z.\-]+)(>=|<=|>|<)(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`cannot read condition "${s}" - write it as TICKER>LEVEL, e.g. META>624.80`);
  return { ticker: m[1].toUpperCase(), op: m[2], level: Number(m[3]) };
}

const OPS = { ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b };

// One test against one set of closes on one date.
export function evaluate(mc, prices, date) {
  if (mc.expires && date > mc.expires) return { verdict: "EXPIRED", detail: `expired ${mc.expires}` };
  const parts = [];
  let allPass = true;
  for (const c of mc.when) {
    const px = prices[c.ticker];
    if (typeof px !== "number" || !isFinite(px)) return { verdict: "NO PRICE", detail: `no close for ${c.ticker}` };
    const ok = OPS[c.op](px, c.level);
    if (!ok) allPass = false;
    parts.push(`${c.ticker} ${px} ${c.op} ${c.level} ${ok ? "yes" : "no"}`);
  }
  return { verdict: allPass ? "FIRED" : "HOLDING", detail: parts.join(" | ") };
}

function load(db) {
  if (!existsSync(db)) return { items: [] };
  const j = JSON.parse(readFileSync(db, "utf8"));
  return Array.isArray(j) ? { items: j } : { items: j.items || [] };
}
const save = (db, data) => writeFileSync(db, JSON.stringify(data, null, 2) + "\n");

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const all = (f) => argv.flatMap((a, i) => (a === f ? [argv[i + 1]] : []));
  const DB = resolve(val("--db") || resolve(ROOT, "db/mind-changers.json"));
  const data = load(DB);

  if (cmd === "add") {
    const whens = all("--when");
    const meaning = val("--meaning");
    const source = val("--source");
    const problems = [];
    if (!whens.length) problems.push("at least one --when is required (TICKER>LEVEL)");
    if (!meaning) problems.push("--meaning is required: what it means if this fires");
    if (!source) problems.push("--source is required: the read or row that wrote the test");
    let when = [];
    try { when = whens.map(parseWhen); } catch (e) { problems.push(e.message); }
    if (problems.length) {
      console.log("REFUSED - this test cannot be watched as written:\n" + problems.map((p) => "  - " + p).join("\n"));
      process.exit(1);
    }
    const created = val("--date") || nyDate();
    const n = data.items.reduce((m, x) => Math.max(m, Number(String(x.id).slice(3)) || 0), 0) + 1;
    const mc = {
      id: `MC-${String(n).padStart(3, "0")}`, created, when, meaning, source,
      row: val("--row") || null, expires: val("--expires") || addDays(created, 7), status: "open",
    };
    data.items.push(mc);
    save(DB, data);
    console.log(`LOGGED ${mc.id}: ${when.map((c) => c.ticker + c.op + c.level).join(" AND ")} -> "${meaning}" (expires ${mc.expires})`);
    return;
  }

  if (cmd === "list") {
    const open = data.items.filter((x) => x.status === "open");
    const tickers = [...new Set(open.flatMap((x) => x.when.map((c) => c.ticker)))];
    if (has("--json")) { console.log(JSON.stringify({ open, tickers }, null, 2)); return; }
    if (!open.length) { console.log("MIND-CHANGERS: none open."); return; }
    console.log(`MIND-CHANGERS OPEN (${open.length}) - quote these at the close: ${tickers.join(", ")}`);
    for (const x of open) console.log(`  ${x.id}  ${x.when.map((c) => c.ticker + c.op + c.level).join(" AND ")}  -> ${x.meaning}  [${x.source}${x.row ? ", " + x.row : ""}; expires ${x.expires}]`);
    return;
  }

  if (cmd === "check") {
    const raw = val("--prices") ?? (val("--prices-file") ? readFileSync(resolve(val("--prices-file")), "utf8") : null);
    if (!raw) { console.log("REFUSED - pass --prices '{\"META\":654}' or --prices-file f.json (official closes)"); process.exit(1); }
    const prices = Object.fromEntries(Object.entries(JSON.parse(raw)).map(([k, v]) => [k.toUpperCase(), Number(v)]));
    const date = val("--date") || nyDate();
    const results = data.items.filter((x) => x.status === "open").map((x) => ({ ...x, ...evaluate(x, prices, date) }));
    if (has("--write")) {
      for (const r of results) {
        const it = data.items.find((x) => x.id === r.id);
        if (r.verdict === "FIRED") Object.assign(it, { status: "fired", fired_on: date, fired_detail: r.detail });
        if (r.verdict === "EXPIRED") Object.assign(it, { status: "expired", expired_on: date });
      }
      save(DB, data);
    }
    if (has("--json")) { console.log(JSON.stringify({ date, results }, null, 2)); return; }
    const fired = results.filter((r) => r.verdict === "FIRED");
    console.log(`MIND-CHANGER CHECK ${date}: ${fired.length} FIRED of ${results.length} open${has("--write") ? " (written)" : ""}`);
    for (const r of results) console.log(`  ${r.verdict.padEnd(8)} ${r.id}  ${r.detail}  -> ${r.meaning}${r.row ? "  [" + r.row + "]" : ""}`);
    if (fired.length) console.log("  A FIRED test is a mandatory re-look, not a ticket: log a row saying what the desk does about it.");
    return;
  }

  console.log("usage: mind-changer.mjs add|list|check  (see header)");
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
