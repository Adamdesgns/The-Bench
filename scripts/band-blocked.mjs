// band-blocked.mjs — the hunter calls the 10% band turned down, and how they scored.
//
//   node scripts/band-blocked.mjs [--since YYYY-MM-DD] [--json]
//   offline: --hunts-dir dir --predictions f.json
//
// WHY THIS EXISTS (Adam, 2026-10-21: "do you think we're missing the decent trades because of our risk
// band being too low?", then "Yes, add a weekly line to the Sunday read tallying the hunter calls that
// were blocked by the band and how they scored.")
// The band never blocks a share trade (it sets the share count). It blocks one thing: an option spread
// whose one-contract cost is more than the band. options-hunter.mjs writes those to the `rejected` list
// of db/hunts/options/<date>.ranked.json with "max loss N > band B". The prediction ledger
// (db/predictions.json) scores every options-hunter call on its own horizon whether or not anyone traded
// it, so a blocked call can be matched to its score: same ticker, side and date. This prints the blocked
// calls' record beside the hunter's overall record, so the band question is answered with a count.
// Read only. Zero-dep. Tests: test/band-blocked.test.mjs.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const r2 = (x) => +x.toFixed(2);

// Tally a set of scored predictions: target / stop / timeout and average R on the ledger's own path R.
export function tally(preds) {
  const scored = preds.filter((p) => p.status === "scored" && p.score);
  const paths = { target: 0, stop: 0, timeout: 0 };
  const rs = [];
  for (const p of scored) {
    const k = p.score.path?.outcome;
    if (k in paths) paths[k]++;
    if (p.score.r_path != null) rs.push(p.score.r_path);
  }
  return { scored: scored.length, open: preds.length - scored.length, ...paths, avg_r: rs.length ? r2(rs.reduce((a, b) => a + b, 0) / rs.length) : null, sum_r: r2(rs.reduce((a, b) => a + b, 0)) };
}

// Every band rejection in the hunt receipts, each matched to its options-hunter prediction (or none).
export function blocked(ranked, preds, { since = null } = {}) {
  const out = [];
  for (const j of ranked) {
    if (since && j.asof < since) continue;
    for (const x of j.rejected || []) {
      const m = /max loss ([\d.]+) > band ([\d.]+)/.exec(x.why || "");
      if (!m) continue;
      const same = (q) => q.source === "options-hunter" && q.ticker === x.sym && q.side === x.side;
      const p = preds.find((q) => same(q) && q.made === j.asof) || null;
      // The ledger keeps one open call per name and side, so a name blocked again while its first call is
      // still running is the same call re-firing, not a new one. It is counted once, under the first.
      const first = p ? null : preds.find((q) => same(q) && q.made < j.asof && (q.status === "open" || q.score?.horizon_date >= j.asof)) || null;
      out.push({ date: j.asof, sym: x.sym, side: x.side, cost: +m[1], band: +m[2], prediction: p, repeat_of: first?.id ?? null });
    }
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = resolve(val("--hunts-dir") || resolve(ROOT, "db/hunts/options"));
  const P = JSON.parse(readFileSync(resolve(val("--predictions") || resolve(ROOT, "db/predictions.json")), "utf8"));
  const preds = Array.isArray(P) ? P : P.predictions || P.rows || [];
  const ranked = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ranked.json")).sort()
    .map((f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; } }).filter(Boolean) : [];
  const since = val("--since") || null;
  const b = blocked(ranked, preds, { since });
  const matched = b.filter((x) => x.prediction).map((x) => x.prediction);
  const t = tally(matched), all = tally(preds.filter((p) => p.source === "options-hunter" && (!since || p.made >= since)));
  const repeats = b.filter((x) => x.repeat_of).length, lost = b.length - matched.length - repeats;
  if (argv.includes("--json")) { console.log(JSON.stringify({ since, blocked_rows: b.length, distinct: matched.length, repeats, unscorable: lost, blocked_record: t, hunter_record: all, calls: b }, null, 2)); return; }
  const rec = (x) => `${x.scored} scored: ${x.target} target, ${x.stop} stop, ${x.timeout} timeout, avg ${x.avg_r == null ? "-" : `${x.avg_r >= 0 ? "+" : ""}${x.avg_r}R`}`;
  console.log(`BAND-BLOCKED HUNTER CALLS${since ? ` since ${since}` : ""}: ${b.length} spreads cost more than the band at one contract = ${matched.length} distinct calls (${repeats} were the same name re-firing while its first call was still open${lost ? `, ${lost} with no prediction to score` : ""}).`);
  console.log(`  blocked calls  ${rec(t)}, ${t.open} still open`);
  console.log(`  all hunter calls ${rec(all)}`);
  console.log(t.scored < 20 ? `  Under 20 scored - too few to say whether the band is costing trades.`
    : `  Blocked calls ${t.avg_r > all.avg_r ? "beat" : "did not beat"} the hunter average by ${r2(Math.abs((t.avg_r ?? 0) - (all.avg_r ?? 0)))}R a call.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
