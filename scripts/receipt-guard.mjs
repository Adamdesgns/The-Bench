// receipt-guard.mjs — only the routine owns a hunt receipt's canonical name.
//
// Receipts are named by the LAST BAR's date, not the day the script ran. So a Saturday run lands on
// Friday's file, and an interactive run on a routine day lands on the routine's file. Both happened:
// B-1177 (10/29, the 15:25 routine's candidates overwritten) and B-1208 (10/31, Friday's short and
// candidates receipts overwritten). Each time git had the original; next time it may not.
//
// The rule:
//   a run without --routine always writes <name>.<receipt id>.json beside the canonical name, whatever
//     its universe, band or source, so nothing but the routine ever takes or replaces that name
//   a --routine run (bench-hunt-close) writes the canonical name when it is free, or when it holds the
//     routine's own receipt from the same New York day (a retry); anything else - a market-holiday run
//     whose last bar is yesterday's, a repair after midnight ET - goes beside it and exits 3, so the
//     routine stops instead of reading a file it did not write
//   --overwrite replaces the canonical name on purpose, for a deliberate human choice only
// A side name never ends in .ranked.json, so band-blocked.mjs keeps reading routine ranks only.
// Zero dependencies.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function nyDay(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function sidecarPath(path, id) {
  return path.replace(/\.json$/, `.${id}.json`);
}

function ownRetry(path, receipt) {
  let prev = null;
  try { prev = JSON.parse(readFileSync(path, "utf8")); } catch { return { ok: false, was: "an unreadable file" }; }
  const ok = prev.routine === true && prev.kind === receipt.kind && !!prev.generated && nyDay(prev.generated) === nyDay(receipt.generated);
  return { ok, was: `${prev.kind ?? "?"}${prev.routine ? " (routine)" : " (not a routine run)"} generated ${prev.generated ?? "?"}` };
}

// Returns { wrote, diverted, refused }. diverted names the canonical file that was left alone;
// refused is true only for a --routine run that could not take its own name (the caller exits 3).
export function writeReceipt(path, receipt, { routine = false, overwrite = false } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  let wrote = path, diverted = null, refused = false;
  if (!routine && !overwrite) {
    wrote = sidecarPath(path, receipt.id);
    diverted = { kept: path, why: "not a --routine run: the canonical name belongs to bench-hunt-close" };
  } else if (routine && !overwrite && existsSync(path)) {
    const r = ownRetry(path, receipt);
    if (!r.ok) {
      wrote = sidecarPath(path, receipt.id); refused = true;
      diverted = { kept: path, why: `already holds ${r.was}` };
    }
  }
  writeFileSync(wrote, JSON.stringify(receipt, null, 2) + "\n");
  return { wrote, diverted, refused };
}

export function divertedNote(d, refused) {
  if (!d) return "";
  return refused
    ? `\nREFUSED: --routine could not take ${d.kept} (${d.why}). This run went beside it; later steps must not read the canonical file. Exit 3.`
    : `\nside file: ${d.kept} left alone (${d.why}).`;
}
