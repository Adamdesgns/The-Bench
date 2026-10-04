// score-book.js — score every due checkpoint in the book and draft the post.
//
//   node scripts/score-book.js               # score, write archive, print the draft
//   node scripts/score-book.js --dry-run     # score and print, touch nothing
//   node scripts/score-book.js --today 2026-09-30
//   node scripts/score-book.js --no-draft    # score only, no draft at all
//   node scripts/score-book.js --draft       # also write the draft into x-poster/queue/
//   node scripts/score-book.js --recheck     # also audit SETTLED checkpoints for artifacts
//
// --recheck is the only path that ever touches a settled verdict. It re-fetches
// every ticker that has one and corrects two provable faults: a book label
// priced as a symbol (B-509, "CASH"), and a logged price scored against a
// series on a different share basis (B-325, MGN across a 1-for-30). The old
// verdict is kept inside the checkpoint under `supersedes`. Run it after a
// scorer fix, or now and then; it costs one fetch per ticker in the book.
//
// Nothing is written under x-poster unless --draft is passed. The X channel was
// retired 2026-09-05 and the standing order forbids routines writing there.
//
// Spec: docs/scorecard-spec.md

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROOT } from "../server/config.js";
import { loadArchive } from "../server/reconcile.js";
import { scoreBook, scoreRows } from "../server/scorecard.js";
import { getDatedCloses } from "../server/dataProviders.js";
import { renderWeeklyPost, draftDecision } from "../server/scorecardPost.js";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};

const today = valueOf("--today") || new Date().toISOString().slice(0, 10);
const dryRun = has("--dry-run");
const recheck = has("--recheck");
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

const signed = (n) => (typeof n === "number" ? `${n > 0 ? "+" : ""}${n}` : "—");

function printRows(list) {
  console.log("ID      TICK    HZN  VERDICT  ASSET     BENCH     ALPHA   NOTE");
  for (const s of list) {
    const pct = (n) => (typeof n === "number" ? `${n > 0 ? "+" : ""}${n}%` : "n/a");
    console.log(
      [
        String(s.id).padEnd(7),
        String(s.ticker).padEnd(7),
        String(s.horizon).padEnd(4),
        String(VERDICT_MARK[s.verdict] ?? s.verdict).padEnd(8),
        pct(s.assetPct).padEnd(9),
        `${s.bench} ${pct(s.benchPct)}`.padEnd(9),
        signed(s.alpha).padEnd(7),
        s.note ?? ""
      ].join(" ")
    );
    if (s.corrected) {
      console.log(`        was ${VERDICT_MARK[s.was.verdict] ?? s.was.verdict}, alpha ${signed(s.was.alpha)} — kept on the row under "supersedes"`);
    }
  }
}

function printTable(fresh) {
  if (!fresh.length) {
    console.log("Nothing was due. No checkpoint has elapsed for any open row.");
    return;
  }
  console.log(`\nSCORED ${fresh.length} checkpoint(s) as of ${today}\n`);
  printRows(fresh);

  const tally = fresh.reduce((acc, s) => ({ ...acc, [s.verdict]: (acc[s.verdict] ?? 0) + 1 }), {});
  console.log(`\n${JSON.stringify(tally)}`);
}

// Settled verdicts the audit replaced. Printed apart from the due checkpoints
// so a correction is never mistaken for a new call.
function printCorrections(corrections) {
  if (!recheck) return;
  if (!corrections.length) {
    console.log("\nRECHECK: every settled checkpoint was scored on one share basis. Nothing corrected.");
    return;
  }
  console.log(`\nRECHECK: CORRECTED ${corrections.length} settled checkpoint(s)\n`);
  printRows(corrections);
}

// A symbol with no price series used to read as a quiet "not observable".
function printFailures(failures) {
  if (!failures.length) return;
  console.log(`\nNO PRICE SERIES for ${failures.length} symbol(s) — their rows could not be scored this run:`);
  for (const f of failures) console.log(`  ${String(f.ticker).padEnd(7)} ${f.error}`);
}

const fetchBars = (t) => getDatedCloses(t);
const { scored, failures } = dryRun
  ? await scoreRows(loadArchive(), { today, recheck, fetchBars })
  : await scoreBook({ today, recheck });

// A correction is not one of this run's calls, so it stays out of the tally
// and out of the draft.
const fresh = scored.filter((s) => !s.corrected);

printTable(fresh);
printCorrections(scored.filter((s) => s.corrected));
printFailures(failures);

if (dryRun) {
  console.log("\n--dry-run: archive NOT written.");
}

if (!has("--no-draft")) {
  const post = renderWeeklyPost(fresh);
  if (!post) {
    console.log("\nNo draft written — nothing scorable this run. That is the correct outcome, not a failure.");
  } else {
    console.log(`\n--- DRAFT (${post.length} chars) ---\n${post}\n---`);
    if (draftDecision({ dryRun, draft: has("--draft"), queueExists: existsSync(QUEUE_DIR) }) === "write") {
      const path = nextDraftPath(today);
      writeFileSync(path, post + "\n", "utf8");
      console.log(`\nQueued: ${path}`);
    } else if (!dryRun) {
      console.log("\nDraft printed only. Nothing written under x-poster (retired 2026-09-05). Pass --draft to write it.");
    }
  }
}
