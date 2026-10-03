// predict.test.mjs — the prediction ledger scores what was said against what happened. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { scorePrediction, fromOptionsCandidates, mergeNew, calibration, addWeekdays } from "../scripts/predict.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/predict.mjs");
const run = (args) => execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

// Ten weekday sessions after Fri 2026-10-02 end on Fri 2026-10-16 (the B-695 horizon).
const DAYS = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09",
              "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
const bars = (closes, from = DAYS) => [{ date: "2026-10-02", close: 29.5 }, ...closes.map((c, i) => ({ date: from[i], close: c }))];
const HIMS = { id: "PR-001", source: "options-hunter", ticker: "HIMS", side: "long", made: "2026-10-02",
               price: 29.74, target: 33.14, stop: 28.11, sessions: 10, p_dir: 52.81, p_reach: 31.46 };

test("before the Nth session settles the prediction stays OPEN and keeps the path so far", () => {
  const s = scorePrediction(HIMS, bars([30, 31, 33.5]));
  assert.equal(s.status, "open");
  assert.equal(s.sessions_done, 3);
  assert.deepEqual(s.path, { outcome: "target", date: "2026-10-07", close: 33.5 });
});

test("target first on a close, then scored on the 10th session close: dir and reach by the hunter's definition", () => {
  const s = scorePrediction(HIMS, bars([30, 31, 33.5, 33, 32, 31, 30.5, 30.2, 30.1, 30.0]));
  assert.equal(s.status, "scored");
  assert.equal(s.horizon_date, "2026-10-16");
  assert.equal(s.horizon_close, 30.0);
  assert.equal(s.dir, true);            // 30.00 > 29.74
  assert.equal(s.reach, false);         // the hunter measures reach at the horizon close, not on the way
  assert.equal(s.path.outcome, "target");
  assert.equal(s.r_path, 2.09);         // (33.14 - 29.74) / (29.74 - 28.11)
});

test("a close under the stop before the target scores the path as STOP and R -1", () => {
  const s = scorePrediction(HIMS, bars([29, 28.0, 34, 34, 34, 34, 34, 34, 34, 34]));
  assert.equal(s.path.outcome, "stop");
  assert.equal(s.path.date, "2026-10-06");
  assert.equal(s.r_path, -1);
  assert.equal(s.reach, true);          // horizon close 34 >= 33.14 still counts for the base-rate check
});

test("neither level by the horizon is a TIMEOUT scored in R at the horizon close", () => {
  const s = scorePrediction(HIMS, bars([30, 30, 30, 30, 30, 30, 30, 30, 30, 31.37]));
  assert.equal(s.path.outcome, "timeout");
  assert.equal(s.r_path, 1);            // (31.37 - 29.74) / 1.63
});

test("short predictions score the mirror image", () => {
  const p = { ...HIMS, side: "short", price: 100, target: 90, stop: 105, ticker: "APP" };
  const s = scorePrediction(p, bars([99, 95, 89.9, 92, 93, 94, 95, 96, 97, 98]));
  assert.equal(s.path.outcome, "target");
  assert.equal(s.dir, true);            // 98 < 100
  assert.equal(s.reach, false);         // 98 is not <= 90
  assert.equal(s.r_path, 2);
});

test("the horizon is counted in sessions (bars), so a market holiday does not shorten it", () => {
  const withHoliday = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09",
                       "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19"];
  const s = scorePrediction(HIMS, bars([30, 30, 30, 30, 30, 30, 30, 30, 30, 30.5], withHoliday));
  assert.equal(s.horizon_date, "2026-10-19");
  const early = scorePrediction(HIMS, bars([30, 30, 30, 30, 30, 30, 30, 30, 30], withHoliday));
  assert.equal(early.status, "open");
});

test("addWeekdays estimates the horizon date for the decide-by line", () => {
  assert.equal(addWeekdays("2026-10-02", 10), "2026-10-16");
  assert.equal(addWeekdays("2026-10-01", 10), "2026-10-15");
});

const CANDS = {
  kind: "options-hunter-candidates", asof: "2026-10-01", id: "abc12345",
  candidates: [
    { side: "short", sym: "APP", ok: true, date: "2026-10-01", list: "READY", readiness: 60,
      geometry: { entry: 281.31, stop: 303.17, target: 234.56, rr: 2.14 },
      evidence: { horizon: 10, n: 68, grade: "A", p_dir: 47.06, p_reach: 11.76 } },
    { side: "long", sym: "HIMS", ok: true, date: "2026-10-01", list: "STALK", readiness: 60,
      geometry: { entry: 29.3, stop: 27.6, target: 33.14, rr: 2.25 },
      evidence: { horizon: 10, n: 89, grade: "A", p_dir: 52.81, p_reach: 31.46 } },
    { side: "long", sym: "NOTGT", ok: true, date: "2026-10-01", list: "DISCOVERY",
      geometry: { entry: 10, stop: 9, target: null, rr: null }, evidence: null },
    { side: "long", sym: "BAD", ok: false },
  ],
};

test("an options-hunter candidates file becomes one prediction per candidate that has a target and stated odds", () => {
  const ps = fromOptionsCandidates(CANDS);
  assert.equal(ps.length, 2);
  const app = ps.find((p) => p.ticker === "APP");
  assert.equal(app.source, "options-hunter");
  assert.equal(app.side, "short");
  assert.equal(app.made, "2026-10-01");
  assert.equal(app.price, 281.31);
  assert.equal(app.target, 234.56);
  assert.equal(app.stop, 303.17);
  assert.equal(app.sessions, 10);
  assert.equal(app.horizon_est, "2026-10-15");
  assert.equal(app.p_dir, 47.06);
  assert.equal(app.p_reach, 11.76);
  assert.equal(app.receipt, "abc12345");
  assert.equal(app.list, "READY");
  assert.equal(app.grade, "A");
});

test("mergeNew skips a prediction already open for the same source, ticker and side, and numbers the rest", () => {
  const db = { predictions: [{ ...HIMS, status: "open" }] };
  const added = mergeNew(db, fromOptionsCandidates(CANDS));
  assert.deepEqual(added.map((p) => p.ticker), ["APP"]);
  assert.equal(added[0].id, "PR-002");
  assert.equal(db.predictions.length, 2);
});

test("calibration puts each source's stated odds beside what actually happened", () => {
  const scored = (dir, reach, outcome, r) => ({ source: "options-hunter", status: "scored", p_dir: 50, p_reach: 30,
                                                score: { dir, reach, path: { outcome }, r_path: r } });
  const c = calibration([
    scored(true, true, "target", 2), scored(true, false, "timeout", 0.5),
    scored(false, false, "stop", -1), scored(false, false, "stop", -1),
    { source: "options-hunter", status: "open", p_dir: 50, p_reach: 30 },
    { source: "desk", status: "open" },
  ]);
  const oh = c["options-hunter"];
  assert.equal(oh.scored, 4);
  assert.equal(oh.open, 1);
  assert.equal(oh.stated_p_dir, 50);
  assert.equal(oh.actual_dir, 50);
  assert.equal(oh.stated_p_reach, 30);
  assert.equal(oh.actual_reach, 25);
  assert.deepEqual(oh.paths, { target: 1, stop: 2, timeout: 1 });
  assert.equal(oh.avg_r, 0.13);
  assert.equal(c.desk.scored, 0);
});

test("CLI: add, check against a bars file, then report - nothing touches the book", () => {
  const dir = mkdtempSync(join(tmpdir(), "predict-"));
  const db = join(dir, "predictions.json");
  const out = run(["add", "--db", db, "--source", "options-hunter", "--ticker", "HIMS", "--side", "long",
                   "--made", "2026-10-02", "--price", "29.74", "--target", "33.14", "--stop", "28.11",
                   "--sessions", "10", "--p-dir", "52.81", "--p-reach", "31.46", "--row", "B-695", "--receipt", "fbc706f6"]);
  assert.match(out, /PR-001/);
  assert.match(out, /2026-10-16/);
  const bf = join(dir, "bars.json");
  writeFileSync(bf, JSON.stringify({ HIMS: bars([30, 31, 33.5, 33, 32, 31, 30.5, 30.2, 30.1, 30.0]) }));
  const chk = run(["check", "--db", db, "--bars-file", bf, "--write"]);
  assert.match(chk, /PR-001 HIMS .*SCORED/);
  const saved = JSON.parse(readFileSync(db, "utf8")).predictions[0];
  assert.equal(saved.status, "scored");
  assert.equal(saved.score.path.outcome, "target");
  const rep = run(["report", "--db", db]);
  assert.match(rep, /options-hunter/);
  assert.match(rep, /dir\s+stated 52\.81%\s+actual 100%/);
  assert.match(rep, /reach\s+stated 31\.46%\s+actual 0%/);
});

test("CLI add refuses a prediction it could never score", () => {
  const dir = mkdtempSync(join(tmpdir(), "predict-"));
  assert.throws(() => execFileSync(process.execPath, [CLI, "add", "--db", join(dir, "p.json"), "--source", "desk", "--ticker", "X",
                                   "--side", "long", "--made", "2026-10-02", "--price", "10"], { encoding: "utf8", stdio: "pipe" }),
                (e) => /--sessions is required/.test(e.stderr));
});
