// benny-wall.mjs — THE WALL: nothing from Adam's real accounts reaches Discord.
//
//   node scripts/benny-wall.mjs write --amounts 3512.31,42.17 --holdings '[{"sym":"GOOGL","shares":8,"cost":336.25}]'
//   node scripts/benny-wall.mjs check --file docs/benny/2026-10-16-premarket.md
//
// One function, checkWall(text, wall, now), shared by scripts/benny-post.mjs and benny/listener.mjs.
// A text fails if it names an account identifier, carries a real account amount (within 0.5%, or the
// exact two-decimal form under $100), puts a real holding's share count next to its ticker, carries a
// real cost basis, or says what Adam holds/bought/sold. A missing or 4-day-old wall file fails
// everything (closed, not open). Tickers alone are allowed.
// --amounts = every real account's total value and buying power. The file lives at ~/.benny/wall.json
// (BENNY_HOME overrides, for tests) and is never committed. Reasons never repeat the real value,
// because the post and Q&A logs that record them ARE committed.
// Spec: docs/superpowers/specs/2026-10-15-benny-discord-bot-design.md. Zero-dep. Tests: test/benny-wall.test.mjs.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const MAX_AGE_DAYS = 4;
export const bennyHome = () => process.env.BENNY_HOME || join(homedir(), ".benny");

const IDENTIFIERS = [
  [/\b6137\b/, "an account number"], [/\b7724\b/, "an account number"], [/\bagentic\b/i, "an account nickname"],
  [/\butma\b/i, "the custodial account"], [/\bcustodial\b/i, "the custodial account"],
  [/\bbuying\s+power\b/i, "buying power"], [/\bmargin\s+account\b/i, "the margin account"],
];
const POSSESSIVES = [
  /\badam['’]s\s+(account|accounts|position|positions|portfolio|holdings?)\b/i,
  /\bmy\s+operator['’]s\s+(account|accounts|position|positions|portfolio|holdings?)\b/i,
  /\badam\s+(holds|owns|bought|sold)\b/i,
];
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every number in the text as a value: "3,512.31" -> 3512.31, "$3.5K" -> 3500, "3512" -> 3512.
export function numbersIn(text) {
  const out = [];
  for (const m of text.matchAll(/\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?([kK])?\b/g)) {
    const raw = Number(m[1].replace(/,/g, "") + (m[2] || ""));
    out.push({ value: m[3] ? raw * 1000 : raw, text: m[0], decimals: m[2] ? m[2].length - 1 : 0 });
  }
  return out;
}

export function loadWall(home = bennyHome()) {
  const p = join(home, "wall.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

export function checkWall(text, wall, now = new Date()) {
  if (!wall) return { ok: false, reasons: ["the wall file is missing - nothing posts until a BENNY STEP refreshes it"] };
  const reasons = [];
  const age = (now - new Date(wall.asof)) / 86400000;
  if (!(age <= MAX_AGE_DAYS)) reasons.push(`the wall file is older than ${MAX_AGE_DAYS} days - a BENNY STEP must refresh it`);
  for (const [re, label] of IDENTIFIERS) if (re.test(text)) reasons.push(`names ${label}`);
  for (const re of POSSESSIVES) if (re.test(text)) reasons.push("says what Adam holds or trades");
  const nums = numbersIn(text);
  for (const v of wall.amounts || []) {
    const hit = v >= 100
      ? nums.some((n) => Math.abs(n.value - v) / v <= 0.005)
      : nums.some((n) => n.decimals === 2 && n.value.toFixed(2) === v.toFixed(2));
    if (hit) reasons.push("matches a real account amount");
  }
  for (const h of wall.holdings || []) {
    const share = new RegExp(`(?<![\\d.,])${esc(h.shares)}\\s+(?:shares?\\s+(?:of\\s+)?)?\\$?${esc(h.sym)}\\b`, "i");
    if (share.test(text)) reasons.push(`puts a real share count next to ${h.sym}`);
    if (h.cost != null && nums.some((n) => n.value.toFixed(2) === Number(h.cost).toFixed(2))) reasons.push(`carries the real cost basis of ${h.sym}`);
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

function main() {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const refuse = (m) => { console.log(`REFUSED - ${m}`); process.exit(1); };
  if (argv[0] === "write") {
    const amounts = String(val("--amounts") || "").split(",").filter(Boolean).map(Number);
    if (!amounts.length || amounts.some((x) => !(x >= 0))) refuse("pass --amounts with every real account's total value and buying power, comma-separated");
    let holdings;
    try { holdings = JSON.parse(val("--holdings") || "[]"); } catch { refuse("--holdings is not valid JSON"); }
    if (!Array.isArray(holdings) || holdings.some((h) => !h.sym || !(h.shares > 0))) refuse('--holdings must be [{"sym":"X","shares":n,"cost":avg},...]');
    const home = bennyHome();
    mkdirSync(home, { recursive: true });
    const wall = { asof: new Date().toISOString(), amounts, holdings: holdings.map((h) => ({ sym: String(h.sym).toUpperCase(), shares: Number(h.shares), cost: h.cost == null ? null : Number(h.cost) })) };
    writeFileSync(join(home, "wall.json"), JSON.stringify(wall, null, 2) + "\n");
    console.log(`WALL REFRESHED ${wall.asof}: ${amounts.length} amount(s) and ${holdings.length} holding(s) stored outside the repo. Never commit or paste them.`);
    return;
  }
  if (argv[0] === "check") {
    if (!val("--file")) refuse("pass --file");
    const r = checkWall(readFileSync(resolve(val("--file")), "utf8"), loadWall());
    if (r.ok) { console.log("WALL OK"); return; }
    console.log("WALL REFUSED"); r.reasons.forEach((x) => console.log(`  - ${x}`)); process.exit(1);
  }
  console.log("usage: benny-wall.mjs write|check  (see header)"); process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
