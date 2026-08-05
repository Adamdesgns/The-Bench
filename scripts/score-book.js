// score-book.js — score every due checkpoint in the book and draft the post.
//
//   node scripts/score-book.js               # score, write archive, draft post
//   node scripts/score-book.js --dry-run     # score and print, touch nothing
//   node scripts/score-book.js --today 2026-09-30
//   node scripts/score-book.js --no-draft    # score only, no X draft
//
// The draft lands in x-poster/queue/ — Adam approves it there, exactly like
// every other post. The system drafts. Adam publishes.
//
// Spec: docs/scorecard-spec.md

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROOT } from "../server/config.js";
import { loadArchive } from "../server/reconcile.js";
import { scoreBook, scoreRows } from "../server/scorecard.js";
import { getDatedCloses } from "../server/dataProviders.js";
import { renderWeeklyPost } from "../server/scorecardPost.js";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};

const today = valueOf("--today") || new Date().toISOString().slice(0, 10);
const dryRun = has("--dry-run");
const QUEUE_DIR = resolve(ROOT, "../x-poster/queue");

function nextDraftPath(dateStr) {
  const existing = existsSync(QUEUE_DIR) ? readdirSync(QUEUE_DIR) : [];
  const used = existing
    .map((f) => new RegExp(`^${dateStr}-(\\d+)-`).exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  return resolve(QUEUE_DIR, `${dateStr}-${n}-bench-scorecard.txt`);
}

const VERDICT_MARK = { right: "RIGHT", wrong: "WRONG", flat: "flat", not_scorable: "—" };

function printTable(scored) {
  if (!scored.length) {
    console.log("Nothing was due. No checkpoint has elapsed for any open row.");
    return;
  }
  console.log(`\nSCORED ${scored.length} checkpoint(s) as of ${today}\n`);
  console.log("ID      TICK    HZN  VERDICT  ASSET     BENCH     ALPHA   NOTE");
  for (const s of scored) {
    const pct = (n) => (typeof n === "number" ? `${n > 0 ? "+" : ""}${n}%` : "n/a");
    console.log(
      [
        String(s.id).padEnd(7),
        String(s.ticker).padEnd(7),
        String(s.horizon).padEnd(4),
        String(VERDICT_MARK[s.verdict] ?? s.verdict).padEnd(8),
        pct(s.assetPct).padEnd(9),
        `${s.bench} ${pct(s.benchPct)}`.padEnd(9),
        (typeof s.alpha === "number" ? `${s.alpha > 0 ? "+" : ""}${s.alpha}` : "—").padEnd(7),
        s.note ?? ""
      ].join(" ")
    );
  }

  const tally = scored.reduce((acc, s) => ({ ...acc, [s.verdict]: (acc[s.verdict] ?? 0) + 1 }), {});
  console.log(`\n${JSON.stringify(tally)}`);
}

const { scored } = dryRun
  ? await scoreRows(loadArchive(), { today, fetchBars: (t) => getDatedCloses(t) })
  : await scoreBook({ today });

printTable(scored);

if (dryRun) {
  console.log("\n--dry-run: archive NOT written.");
}

if (!has("--no-draft")) {
  const post = renderWeeklyPost(scored);
  if (!post) {
    console.log("\nNo draft written — nothing scorable this run. That is the correct outcome, not a failure.");
  } else {
    console.log(`\n--- DRAFT (${post.length} chars) ---\n${post}\n---`);
    if (!dryRun && existsSync(QUEUE_DIR)) {
      const path = nextDraftPath(today);
      writeFileSync(path, post + "\n", "utf8");
      console.log(`\nQueued for approval: ${path}`);
    } else if (!dryRun) {
      console.log(`\nx-poster queue not found at ${QUEUE_DIR} — draft printed only.`);
    }
  }
}
