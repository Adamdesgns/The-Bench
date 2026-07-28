// reconcile.js — walk the open board, apply the model's board deltas, price
// every open row, and render the printed ARCHIVE — RECONCILED block.
//
// Hard rules (daily-open-chain-spec.md §2.5):
//  - Every open row is priced every run; a row with no fresh print is marked
//    `unverified` (never carried forward on a stale number).
//  - A trigger firing / invalidation breaking closes or opens a row that run.
//  - Closing a row requires outcome, outcome_price, pct_move, lesson + verdict.
//  - New rows get a real Trade ID or are marked "Pending Archive ID" — never
//    invented. Runner-produced rows carry engine: "gpt-runner".
//  - archive.json is written under a lock so batch + single can't clobber
//    (HANDOFF-code issue #5). If the write fails, the caller HALTS — no article
//    is written against an unreconciled board.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { ARCHIVE_PATH } from "./config.js";

const LOCK_PATH = resolve(dirname(ARCHIVE_PATH), "archive.lock");

export function loadArchive() {
  return JSON.parse(readFileSync(ARCHIVE_PATH, "utf8"));
}

// A row is "open" unless it has been closed (has an outcome).
export function isOpen(row) {
  return !row.outcome;
}

function acquireLock() {
  try {
    mkdirSync(LOCK_PATH); // mkdir is atomic — fails if the lock already exists
  } catch {
    throw new Error("archive is locked (another run is writing). Serialize runs and retry.");
  }
}
function releaseLock() {
  try {
    rmSync(LOCK_PATH, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

// Exported so the scorecard writes through the same lock + backup discipline
// rather than opening a second path that can clobber the archive.
export function writeArchive(rows) {
  acquireLock();
  try {
    if (existsSync(ARCHIVE_PATH)) copyFileSync(ARCHIVE_PATH, ARCHIVE_PATH.replace(/\.json$/, ".backup.json"));
    writeFileSync(ARCHIVE_PATH, JSON.stringify(rows, null, 2) + "\n");
  } finally {
    releaseLock();
  }
}

// quotes: Map<ticker, {price, source, asof, provisional}>
// benchBoard: array of { id, ticker, state, action, note } from the verdict.
export function reconcile(archive, quotes, benchBoard = [], engine = "gpt-runner", stamp) {
  const byId = new Map(archive.map((r) => [r.id, r]));
  const boardById = new Map(benchBoard.filter((b) => b.id).map((b) => [b.id, b]));
  const changed = [];
  const noChange = [];

  for (const row of archive) {
    if (!isOpen(row)) continue;
    const q = quotes.get(row.ticker);
    const priced = q && typeof q.price === "number";
    row.last = priced ? q.price : "unverified";
    row.last_source = q ? q.source : "none";
    row.last_checked = stamp;

    const delta = boardById.get(row.id);
    if (delta && (delta.state || delta.action)) {
      const before = row.final_call;
      if (delta.state) row.state = delta.state;
      if (delta.note) row.note = delta.note;
      if (delta.action) row.final_call = delta.action;
      if (delta.action && delta.action !== before) {
        changed.push({ id: row.id, ticker: row.ticker, action: delta.action });
      } else {
        noChange.push(row.id);
      }
    } else {
      noChange.push(row.id);
    }
  }

  // New rows the model opened that aren't in the archive yet.
  const newRows = [];
  for (const b of benchBoard) {
    if (b.id && byId.has(b.id)) continue;
    if (!b.ticker) continue;
    const q = quotes.get(b.ticker);
    newRows.push({
      id: b.id || "Pending Archive ID",
      ticker: b.ticker,
      state: b.state || "Watching",
      review_price: q && typeof q.price === "number" ? q.price : "unverified",
      review_time: stamp,
      final_call: b.action || null,
      note: b.note || null,
      engine,
      outcome: null,
      not_observable: []
    });
  }

  const merged = archive.concat(newRows);
  writeArchive(merged);
  return { rows: merged, changed, noChange, newRows };
}

export function renderArchiveBlock(result, stamp) {
  const { rows, changed, noChange, newRows } = result;
  const open = rows.filter(isOpen);
  const lines = [];
  lines.push(`▦ ARCHIVE — RECONCILED [${stamp}]`);
  lines.push("");
  lines.push("OPEN ROWS");
  lines.push("B-###  TICKER   Review $   Last $        State          Final Call / Trigger");
  for (const r of open) {
    const review = r.review_price ?? "—";
    const last = r.last ?? "unverified";
    lines.push(
      `${String(r.id).padEnd(7)}${String(r.ticker).padEnd(8)} ${String(review).padEnd(10)} ${String(last).padEnd(13)} ${String(r.state || "").padEnd(14)} ${r.final_call || ""}`
    );
  }
  lines.push("");
  lines.push("CHANGED TODAY");
  if (changed.length) {
    for (const c of changed) lines.push(`- ${c.id}  ${c.ticker}  -> ${c.action}`);
  } else {
    lines.push("- none");
  }
  if (newRows.length) {
    lines.push("");
    lines.push("NEW ROWS");
    for (const r of newRows) lines.push(`${r.id}  ${r.ticker}  Review ${r.review_price} / ${stamp}`);
  }
  lines.push("");
  lines.push(`NO CHANGE: ${noChange.length ? noChange.join(", ") : "none"}`);
  return lines.join("\n");
}
