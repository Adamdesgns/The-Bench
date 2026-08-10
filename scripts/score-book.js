// score-book.js — score every due checkpoint in the book and draft the post.
//
//   node scripts/score-book.js               # score, write archive, draft chain
//   node scripts/score-book.js --dry-run     # score and print, touch nothing
//   node scripts/score-book.js --today 2026-09-30
//   node scripts/score-book.js --no-draft    # score only, no X draft
//   node scripts/score-book.js --single      # one 280-char post, not a chain
//   node scripts/score-book.js --approve     # write to approved/ so it posts
//   node scripts/score-book.js --link URL    # add a "see the book" line
//
// The draft is a CHAIN by default (bench-daily-v1 §0 retired long form).
//
// Where it lands, and why it matters: post_next.py reads approved/ ONLY.
// A draft in queue/ is a draft nobody publishes, which is exactly what this
// script did for its first two weeks. --approve is therefore the difference
// between a recap that exists and a recap that goes out; the weekly routine
// passes it, a human running this by hand normally should not.
//
// Spec: docs/scorecard-spec.md, docs/cadence-spec-v1.md

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROOT } from "../server/config.js";
import { loadArchive } from "../server/reconcile.js";
import { scoreBook, scoreRows } from "../server/scorecard.js";
import { getDatedCloses } from "../server/dataProviders.js";
import { renderWeeklyChain, renderWeeklyPost } from "../server/scorecardPost.js";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};

const today = valueOf("--today") || new Date().toISOString().slice(0, 10);
const dryRun = has("--dry-run");
const approve = has("--approve");
const QUEUE_DIR = resolve(ROOT, "../x-poster/queue");
const APPROVED_DIR = resolve(ROOT, "../x-poster/approved");

// queue/ is provenance, approved/ is the outbox. --approve writes both: the
// annotated draft stays behind as the record of what was generated, same as
// every daily routine does.
const outDir = () => (approve ? APPROVED_DIR : QUEUE_DIR);

function nextDraftPath(dir, dateStr) {
  const existing = existsSync(dir) ? readdirSync(dir) : [];
  const used = existing
    .map((f) => new RegExp(`^${dateStr}-(\\d+)-`).exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  return resolve(dir, `${dateStr}-${n}-bench-scorecard.txt`);
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
  const link = valueOf("--link");
  const single = has("--single");
  const post = single ? renderWeeklyPost(scored, { link }) : renderWeeklyChain(scored, { link });

  if (!post) {
    console.log("\nNo draft written — nothing scorable this run. That is the correct outcome, not a failure.");
  } else {
    const parts = single ? [post] : post.split("\n---\n");
    console.log(`\n--- DRAFT (${single ? "single post" : `${parts.length}-part chain`}) ---`);
    parts.forEach((p, i) => {
      if (!single) console.log(`\n[part ${i + 1}/${parts.length} — ${p.length} chars]`);
      console.log(p);
    });
    console.log("---");

    const dir = outDir();
    if (!dryRun && existsSync(dir)) {
      const path = nextDraftPath(dir, today);
      writeFileSync(path, post + "\n", "utf8");
      console.log(
        approve
          ? `\nAPPROVED — this will publish on the next post_next.py run: ${path}`
          : `\nQueued for approval: ${path}`
      );
    } else if (!dryRun) {
      console.log(`\nx-poster ${approve ? "approved" : "queue"} dir not found at ${dir} — draft printed only.`);
    }
  }
}
