// band-blocked.test.mjs — hunter calls the band turned down, matched to their scores. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { blocked, tally } from "../scripts/band-blocked.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/band-blocked.mjs");

const pred = (ticker, side, made, outcome, r) => ({ source: "options-hunter", ticker, side, made, status: outcome ? "scored" : "open",
  score: outcome ? { path: { outcome }, r_path: r } : undefined });
const ranked = [
  { asof: "2026-10-01", rejected: [{ sym: "MSFT", side: "long", why: "max loss 450 > band 338.36" }, { sym: "AIP", side: "short", why: "earnings inside expiry" }] },
  { asof: "2026-10-08", rejected: [{ sym: "NVDA", side: "short", why: "max loss 600.5 > band 340" }, { sym: "ANET", side: "long", why: "max loss 571.5 > band 338.36" }] },
];
const preds = [
  pred("MSFT", "long", "2026-10-01", "target", 2.4), pred("NVDA", "short", "2026-10-08", "stop", -1),
  pred("NVDA", "long", "2026-10-08", "stop", -1),           // other side: not a match
  pred("HIMS", "long", "2026-10-01", "timeout", 0.3),       // not blocked: counts only in the hunter total
];

test("blocked: only band rejections, each matched by ticker, side and date", () => {
  const b = blocked(ranked, preds);
  assert.deepEqual(b.map((x) => x.sym), ["MSFT", "NVDA", "ANET"]);
  assert.equal(b[0].cost, 450);
  assert.equal(b[1].prediction.side, "short");
  assert.equal(b[2].prediction, null);
  assert.deepEqual(blocked(ranked, preds, { since: "2026-10-05" }).map((x) => x.sym), ["NVDA", "ANET"]);
});

test("a name blocked again while its first call is open is a repeat, not a new call", () => {
  const more = [...ranked, { asof: "2026-10-09", rejected: [{ sym: "NVDA", side: "short", why: "max loss 610 > band 340" }] }];
  const p2 = preds.map((p) => (p.ticker === "NVDA" && p.side === "short" ? { ...p, id: "PR-9", score: { ...p.score, horizon_date: "2026-10-22" } } : p));
  const b = blocked(more, p2);
  const rep = b.find((x) => x.date === "2026-10-09");
  assert.equal(rep.prediction, null);
  assert.equal(rep.repeat_of, "PR-9");
});

test("tally: paths and average R on the ledger's own path R", () => {
  const t = tally(blocked(ranked, preds).filter((x) => x.prediction).map((x) => x.prediction));
  assert.deepEqual([t.scored, t.target, t.stop, t.timeout, t.avg_r], [2, 1, 1, 0, 0.7]);
});

test("CLI prints the blocked record beside the hunter record", () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-")), hunts = join(dir, "hunts");
  mkdirSync(hunts);
  ranked.forEach((j) => writeFileSync(join(hunts, `${j.asof}.ranked.json`), JSON.stringify(j)));
  writeFileSync(join(dir, "p.json"), JSON.stringify(preds));
  const out = execFileSync(process.execPath, [CLI, "--hunts-dir", hunts, "--predictions", join(dir, "p.json")], { encoding: "utf8" });
  assert.match(out, /3 spreads cost more than the band at one contract = 2 distinct calls \(0 were the same name re-firing.*, 1 with no prediction to score\)/);
  assert.match(out, /blocked calls\s+2 scored: 1 target, 1 stop, 0 timeout, avg \+0.7R/);
  assert.match(out, /all hunter calls 4 scored/);
  assert.match(out, /too few/);
});
