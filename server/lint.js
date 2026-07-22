// lint.js — post-generation house-style checks for Marquee output.
//
// All checks are HARD FLAGS. Count in code; never trust the model's estimate.
// Source: HANDOFF-code.md "House-style rules" + REPO-HANDOFF.md section 7.
//
// Usage:
//   import { lintArticle } from './lint.js';
//   const { ok, flags, charCount } = lintArticle(articleBody);

export const BANNED_PHRASES = [
  "delve",
  "tapestry",
  "testament to",
  "navigate the landscape",
  "game-changer",
  "unlock",
  "it's worth noting",
  "at the end of the day",
  "in today's fast-paced world",
  "let's dive in"
];

export const BOILERPLATE = [
  "Proof, not hype.",
  "@TheBenchTrades",
  "Not financial advice. Educational only."
];

export const CHAR_LIMIT = 3900; // X compose enforces 4000; leave buffer.
export const EM_DASH_CAP = 2;

// Count grapheme-ish length the way X does: code points, not UTF-16 units.
export function charCount(text) {
  return [...(text ?? "")].length;
}

export function lintArticle(body) {
  const text = body ?? "";
  const lower = text.toLowerCase();
  const flags = [];

  // 1. Character count <= 3900
  const chars = charCount(text);
  if (chars > CHAR_LIMIT) {
    flags.push({ rule: "char-limit", detail: `${chars} chars > ${CHAR_LIMIT} limit` });
  }

  // 2. Em dashes <= 2
  const emDashes = (text.match(/—/g) || []).length;
  if (emDashes > EM_DASH_CAP) {
    flags.push({ rule: "em-dash-cap", detail: `${emDashes} em dashes > ${EM_DASH_CAP} (AI tell)` });
  }

  // 3. No --- divider lines in body
  if (/^\s*-{3,}\s*$/m.test(text)) {
    flags.push({ rule: "divider-line", detail: "found '---' divider line in body" });
  }

  // 4. No numbered-thread patterns (1/ 2/ ...) — long-form only
  const threadHits = text.match(/(^|\s)\d{1,2}\/(\s|$)/g);
  if (threadHits) {
    flags.push({ rule: "numbered-thread", detail: `found thread markers: ${threadHits.map(s => s.trim()).join(", ")}` });
  }

  // 5. Banned phrases
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      flags.push({ rule: "banned-phrase", detail: `banned phrase: "${phrase}"` });
    }
  }

  // 6. Boilerplate present
  for (const line of BOILERPLATE) {
    if (!text.includes(line)) {
      flags.push({ rule: "missing-boilerplate", detail: `missing required line: "${line}"` });
    }
  }

  return { ok: flags.length === 0, flags, charCount: chars, emDashes };
}

// CLI: `node server/lint.js path/to/article.txt`  (or pipe via stdin)
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const path = process.argv[2];
  const body = path ? readFileSync(path, "utf8") : readFileSync(0, "utf8");
  const result = lintArticle(body);
  console.log(`chars: ${result.charCount}  em-dashes: ${result.emDashes}`);
  if (result.ok) {
    console.log("PASS — no house-style flags.");
  } else {
    console.log(`FAIL — ${result.flags.length} flag(s):`);
    for (const f of result.flags) console.log(`  [${f.rule}] ${f.detail}`);
    process.exit(1);
  }
}
