// scorecard.test.js — orchestration: which rows get scored, what gets written.
// Bars are injected, so this runs with no network and no fs.

import test from "node:test";
import assert from "node:assert/strict";

import { scoreRows } from "./scorecard.js";

// GOOGL runs +10% while SPY runs +2% over the first week of July.
const BARS = {
  GOOGL: [
    { date: "2026-07-02", close: 100 },
    { date: "2026-07-09", close: 110 }
  ],
  SPY: [
    { date: "2026-07-02", close: 500 },
    { date: "2026-07-09", close: 510 }
  ]
};

const fetchBars = async (ticker) => ({ bars: BARS[ticker] ?? [], source: BARS[ticker] ? "yahoo" : "none" });

function longRow(extra = {}) {
  return {
    id: "B-100",
    ticker: "GOOGL",
    date: "2026-07-02",
    review_price: 100,
    hodl: "Accumulate",
    final_call: "Accumulate — test row",
    outcome: null,
    ...extra
  };
}

test("a due checkpoint is scored and written onto the row", async () => {
  const rows = [longRow()];
  const { rows: out } = await scoreRows(rows, { today: "2026-07-09", fetchBars });

  const cp = out[0].checkpoints["1w"];
  assert.equal(cp.verdict, "right");
  assert.equal(cp.asset_pct, 10);
  assert.equal(cp.bench, "SPY");
  assert.equal(cp.bench_pct, 2);
  assert.equal(cp.alpha, 8);
  assert.equal(cp.source, "yahoo");
});

test("an existing checkpoint is never recomputed — scoring is append-only", async () => {
  const rows = [longRow({ checkpoints: { "1w": { verdict: "wrong", alpha: -99, note: "written earlier" } } })];
  const { rows: out } = await scoreRows(rows, { today: "2026-07-09", fetchBars });

  assert.equal(out[0].checkpoints["1w"].alpha, -99);
  assert.equal(out[0].checkpoints["1w"].note, "written earlier");
});

test("a row with no elapsed horizon is left untouched", async () => {
  const rows = [longRow()];
  const { rows: out, scored } = await scoreRows(rows, { today: "2026-07-03", fetchBars });

  assert.equal(out[0].checkpoints, undefined);
  assert.deepEqual(scored, []);
});

test("an unobservable price scores not_scorable rather than being estimated", async () => {
  const rows = [longRow({ ticker: "NOSUCH", review_price: 100 })];
  const { rows: out } = await scoreRows(rows, { today: "2026-07-09", fetchBars });

  assert.equal(out[0].checkpoints["1w"].verdict, "not_scorable");
  assert.equal(out[0].checkpoints["1w"].source, "none");
});

test("the closing horizon fills the archive's own outcome fields", async () => {
  const rows = [longRow()];
  const { rows: out } = await scoreRows(rows, { today: "2026-09-30", fetchBars });

  assert.equal(out[0].outcome, "Win");
  assert.equal(out[0].outcome_price, 110);
  assert.equal(out[0].pct_move, 10);
  assert.ok(out[0].grade_verdict);
});

test("the scorer never writes a lesson — that field stays Adam's", async () => {
  const rows = [longRow()];
  const { rows: out } = await scoreRows(rows, { today: "2026-09-30", fetchBars });

  assert.equal(out[0].lesson ?? null, null);
});

test("scored results carry what the post generator needs", async () => {
  const { scored } = await scoreRows([longRow()], { today: "2026-07-09", fetchBars });

  assert.equal(scored.length, 1);
  const s = scored[0];
  assert.equal(s.ticker, "GOOGL");
  assert.equal(s.type, "long");
  assert.equal(s.horizon, "1w");
  assert.equal(s.verdict, "right");
  assert.equal(s.bench, "SPY");
});

test("a hedge row is recorded as not_scorable and excluded from results", async () => {
  const rows = [longRow({ final_call: "Hedge — active, delta overdue", hodl: "Hold-quality — wait for value" })];
  const { rows: out, scored } = await scoreRows(rows, { today: "2026-07-09", fetchBars });

  assert.equal(out[0].checkpoints["1w"].verdict, "not_scorable");
  assert.equal(scored.filter((s) => s.verdict !== "not_scorable").length, 0);
});

// ---- splits, book labels and corrections (2026-10-04) ----
//
// Two artifacts were found in the stored book. B-325 (MGN) was logged at a raw
// 0.1823 and scored against a series already adjusted for a 1-for-30 reverse
// split: +1,939.96 of alpha where the split-consistent answer is -32.61.
// B-509 was a capital-allocation row under "CASH", priced as Pathward Financial.

// A price feed built from a map. Records every symbol asked for, so a test can
// prove a row was never priced at all.
function feed(map) {
  const calls = [];
  const fetch = async (ticker) => {
    calls.push(ticker);
    const hit = map[ticker];
    if (!hit) return { bars: [], splits: [], source: "none", error: "yahoo: 404" };
    return { bars: hit.bars, splits: hit.splits ?? [], source: "yahoo" };
  };
  return { fetch, calls };
}

// MGN and SPY as Yahoo serves them: closes on the post-split basis.
const SEPT = {
  MGN: {
    bars: [
      { date: "2026-09-09", close: 8.28 },
      { date: "2026-09-10", close: 5.82 },
      { date: "2026-09-16", close: 3.99 },
      { date: "2026-09-17", close: 3.72 },
      { date: "2026-09-18", close: 3.905 }
    ],
    splits: [
      { date: "2026-09-08", numerator: 1, denominator: 40 },
      { date: "2026-09-17", numerator: 1, denominator: 30 }
    ]
  },
  SPY: {
    bars: [
      { date: "2026-09-09", close: 695 },
      { date: "2026-09-10", close: 700 },
      { date: "2026-09-17", close: 704.41 },
      { date: "2026-09-18", close: 705 },
      { date: "2026-09-22", close: 700 },
      { date: "2026-09-29", close: 691.67 }
    ]
  },
  // Pathward Financial, the real company behind the symbol CASH.
  CASH: {
    bars: [
      { date: "2026-09-22", close: 74.56 },
      { date: "2026-09-29", close: 71.57 }
    ]
  }
};

function mgnRow(extra = {}) {
  return {
    id: "B-325",
    ticker: "MGN",
    date: "2026-09-10",
    review_price: 0.1823,
    call_type: "pass",
    final_call: "NO TRADE - a reverse split dressed as volume",
    outcome: null,
    ...extra
  };
}

// The 1w checkpoint exactly as the old scorer stored it.
const MGN_STORED = {
  asof: "2026-09-17",
  price: 3.72,
  asset_pct: 1940.59,
  bench: "SPY",
  bench_pct: 0.63,
  alpha: 1939.96,
  verdict: "wrong",
  note: "pass — expensive pass, it ran without us",
  source: "yahoo",
  scored_at: "2026-09-19T16:10:45.885Z"
};

function cashRow(extra = {}) {
  return {
    id: "B-509",
    ticker: "CASH",
    date: "2026-09-22",
    review_price: 1056.38,
    call_type: "pass",
    final_call: "CAPITAL DECISION: hold the 1,056.38 as powder today",
    outcome: null,
    ...extra
  };
}

test("a reverse split between the review and the checkpoint is scored on one share basis", async () => {
  const { rows: out } = await scoreRows([mgnRow()], { today: "2026-09-19", fetchBars: feed(SEPT).fetch });

  const cp = out[0].checkpoints["1w"];
  assert.equal(cp.entry, 5.469);
  assert.equal(cp.split_factor, 30);
  assert.equal(cp.asset_pct, -31.98);
  assert.equal(cp.alpha, -32.61);
  assert.equal(cp.verdict, "right");
  assert.equal(cp.note, "pass — correctly skipped");
});

test("a forward split after the review divides the logged price", async () => {
  const bars = {
    FWD: {
      bars: [
        { date: "2026-07-02", close: 10 },
        { date: "2026-07-09", close: 11 }
      ],
      splits: [{ date: "2026-07-06", numerator: 20, denominator: 1 }]
    },
    SPY: { bars: BARS.SPY }
  };
  const rows = [longRow({ ticker: "FWD", review_price: 200 })];
  const { rows: out } = await scoreRows(rows, { today: "2026-07-09", fetchBars: feed(bars).fetch });

  const cp = out[0].checkpoints["1w"];
  assert.equal(cp.entry, 10);
  assert.equal(cp.split_factor, 0.05);
  assert.equal(cp.asset_pct, 10);
  assert.equal(cp.alpha, 8);
});

test("a row that crosses no split records its entry and no split factor", async () => {
  const { rows: out } = await scoreRows([longRow()], { today: "2026-07-09", fetchBars });

  const cp = out[0].checkpoints["1w"];
  assert.equal(cp.entry, 100);
  assert.equal("split_factor" in cp, false);
});

test("a split on the review day is ambiguous and scores not_scorable with the reason", async () => {
  const bars = { ...SEPT, MGN: { ...SEPT.MGN, splits: [{ date: "2026-09-10", numerator: 1, denominator: 30 }] } };
  const { rows: out } = await scoreRows([mgnRow()], { today: "2026-09-19", fetchBars: feed(bars).fetch });

  const cp = out[0].checkpoints["1w"];
  assert.equal(cp.verdict, "not_scorable");
  assert.equal(cp.alpha, null);
  assert.match(cp.note, /split on the review day/);
});

test("a logged price far off the series is refused rather than scored", async () => {
  // Same numbers as B-509, under a symbol the label list does not know.
  const bars = { ...SEPT, PWDR: SEPT.CASH };
  const rows = [cashRow({ ticker: "PWDR" })];
  const { rows: out } = await scoreRows(rows, { today: "2026-09-29", fetchBars: feed(bars).fetch });

  const cp = out[0].checkpoints["1w"];
  assert.equal(cp.verdict, "not_scorable");
  assert.equal(cp.alpha, null);
  assert.match(cp.note, /share basis/);
});

test("a book label such as CASH is never priced, even when a real symbol shares the name", async () => {
  const { fetch, calls } = feed(SEPT);
  const { rows: out } = await scoreRows([cashRow()], { today: "2026-09-29", fetchBars: fetch });

  const cp = out[0].checkpoints["1w"];
  assert.equal(cp.verdict, "not_scorable");
  assert.equal(cp.price, null);
  assert.equal(cp.alpha, null);
  assert.match(cp.note, /not an instrument/);
  assert.equal(calls.includes("CASH"), false);
});

test("a book label already marked is not rewritten on every run", async () => {
  const rows = [cashRow()];
  await scoreRows(rows, { today: "2026-09-29", fetchBars: feed(SEPT).fetch });
  const first = rows[0].checkpoints["1w"].scored_at;

  const { scored } = await scoreRows(rows, { today: "2026-09-30", fetchBars: feed(SEPT).fetch });
  assert.deepEqual(scored, []);
  assert.equal(rows[0].checkpoints["1w"].scored_at, first);
});

test("without recheck a settled verdict is left alone even when it crossed a split", async () => {
  const rows = [mgnRow({ checkpoints: { "1w": { ...MGN_STORED } } })];
  const { rows: out, scored } = await scoreRows(rows, { today: "2026-10-04", fetchBars: feed(SEPT).fetch });

  assert.deepEqual(out[0].checkpoints["1w"], MGN_STORED);
  assert.deepEqual(scored, []);
});

test("recheck supersedes a settled checkpoint that crossed a split and keeps the old values on the record", async () => {
  const rows = [mgnRow({ checkpoints: { "1w": { ...MGN_STORED } } })];
  const { rows: out, scored } = await scoreRows(rows, { today: "2026-10-04", fetchBars: feed(SEPT).fetch, recheck: true });

  const cp = out[0].checkpoints["1w"];
  assert.equal(cp.verdict, "right");
  assert.equal(cp.alpha, -32.61);
  assert.equal(cp.split_factor, 30);
  assert.equal(cp.supersedes.verdict, "wrong");
  assert.equal(cp.supersedes.alpha, 1939.96);
  assert.equal(cp.supersedes.asset_pct, 1940.59);
  assert.equal(cp.supersedes.note, "pass — expensive pass, it ran without us");
  assert.equal(cp.supersedes.scored_at, "2026-09-19T16:10:45.885Z");
  assert.match(cp.supersedes.reason, /split/);

  assert.equal(scored.length, 1);
  assert.equal(scored[0].corrected, true);
  assert.deepEqual(scored[0].was, { verdict: "wrong", alpha: 1939.96 });
});

test("recheck turns a settled checkpoint on a book label into not_scorable", async () => {
  const stored = {
    asof: "2026-09-29",
    price: 71.57,
    asset_pct: -93.22,
    bench: "SPY",
    bench_pct: -1.19,
    alpha: -92.03,
    verdict: "right",
    note: "pass — correctly skipped",
    source: "yahoo",
    scored_at: "2026-10-03T16:11:57.508Z"
  };
  const { fetch, calls } = feed(SEPT);
  const rows = [cashRow({ checkpoints: { "1w": { ...stored } } })];
  const { rows: out, scored } = await scoreRows(rows, { today: "2026-10-04", fetchBars: fetch, recheck: true });

  const cp = out[0].checkpoints["1w"];
  assert.equal(cp.verdict, "not_scorable");
  assert.equal(cp.alpha, null);
  assert.match(cp.note, /not an instrument/);
  assert.equal(cp.supersedes.verdict, "right");
  assert.equal(cp.supersedes.alpha, -92.03);
  assert.equal(scored[0].corrected, true);
  assert.equal(calls.includes("CASH"), false);
});

test("recheck leaves a settled checkpoint alone when the split came after it was scored", async () => {
  // Scored 2026-09-09 on raw prices; the 1-for-10 on 2026-09-15 came later, so
  // the stored verdict was computed on one basis and is still right.
  const bars = {
    LATE: {
      bars: [
        { date: "2026-09-01", close: 100 },
        { date: "2026-09-08", close: 105 },
        { date: "2026-09-15", close: 110 }
      ],
      splits: [{ date: "2026-09-15", numerator: 1, denominator: 10 }]
    },
    SPY: SEPT.SPY
  };
  const stored = { asof: "2026-09-08", price: 10.5, asset_pct: 5, bench: "SPY", bench_pct: 0, alpha: 5, verdict: "wrong", note: "pass — it outran the benchmark", source: "yahoo", scored_at: "2026-09-09T12:00:00.000Z" };
  const rows = [mgnRow({ id: "B-900", ticker: "LATE", date: "2026-09-01", review_price: 10, checkpoints: { "1w": { ...stored } } })];
  const { rows: out, scored } = await scoreRows(rows, { today: "2026-09-20", fetchBars: feed(bars).fetch, recheck: true });

  assert.deepEqual(out[0].checkpoints["1w"], stored);
  assert.deepEqual(scored, []);
});

test("recheck is idempotent — a corrected checkpoint is not corrected again", async () => {
  const rows = [mgnRow({ checkpoints: { "1w": { ...MGN_STORED } } })];
  await scoreRows(rows, { today: "2026-10-04", fetchBars: feed(SEPT).fetch, recheck: true });
  const { scored } = await scoreRows(rows, { today: "2026-10-05", fetchBars: feed(SEPT).fetch, recheck: true });

  assert.deepEqual(scored, []);
  assert.equal(rows[0].checkpoints["1w"].supersedes.alpha, 1939.96);
  assert.equal(rows[0].checkpoints["1w"].supersedes.supersedes, undefined);
});

test("recheck on a closing checkpoint re-closes the row on the corrected verdict", async () => {
  const bars = {
    RS3: {
      bars: [
        { date: "2026-06-01", close: 10.5 },
        { date: "2026-08-28", close: 8 }
      ],
      splits: [{ date: "2026-07-01", numerator: 1, denominator: 10 }]
    },
    SPY: {
      bars: [
        { date: "2026-06-01", close: 500 },
        { date: "2026-08-28", close: 510 }
      ]
    }
  };
  const stored = { asof: "2026-08-30", price: 8, asset_pct: 700, bench: "SPY", bench_pct: 2, alpha: 698, verdict: "wrong", note: "pass — expensive pass, it ran without us", source: "yahoo", scored_at: "2026-08-31T12:00:00.000Z" };
  const rows = [
    mgnRow({
      id: "B-901",
      ticker: "RS3",
      date: "2026-06-01",
      review_price: 1,
      outcome: "Loss",
      outcome_price: 8,
      pct_move: 700,
      grade_verdict: stored.note,
      checkpoints: { "3m": { ...stored } }
    })
  ];
  const { rows: out } = await scoreRows(rows, { today: "2026-09-05", fetchBars: feed(bars).fetch, recheck: true });

  assert.equal(out[0].checkpoints["3m"].verdict, "right");
  assert.equal(out[0].checkpoints["3m"].alpha, -22);
  assert.equal(out[0].outcome, "Win");
  assert.equal(out[0].pct_move, -20);
  assert.equal(out[0].grade_verdict, "pass — correctly skipped");
});

test("a row logged the evening before its date starts the benchmark leg on the review session", async () => {
  const bars = {
    GOOGL: {
      bars: [
        { date: "2026-07-01", close: 100 },
        { date: "2026-07-02", close: 104 },
        { date: "2026-07-09", close: 110 }
      ]
    },
    SPY: {
      bars: [
        { date: "2026-07-01", close: 490 },
        { date: "2026-07-02", close: 500 },
        { date: "2026-07-09", close: 510 }
      ]
    }
  };
  const rows = [longRow({ review_time: "2026-07-01 20:10 CT after the close" })];
  const { rows: out } = await scoreRows(rows, { today: "2026-07-09", fetchBars: feed(bars).fetch });

  const cp = out[0].checkpoints["1w"];
  assert.equal(cp.asset_pct, 10);
  assert.equal(cp.bench_pct, 4.08); // 490 -> 510, not 500 -> 510
  assert.equal(cp.alpha, 5.92);
});

test("a conditional's trigger level is carried onto the split basis before it is tested", async () => {
  // Gate at a raw 0.25, which is 7.50 on the post-split series. No close got
  // there. Left raw, every bar would clear 0.25 and the gate would read fired.
  const rows = [mgnRow({ call_type: "conditional", final_call: "Watch - reclaim 0.25", trigger: 0.25 })];
  const { rows: out, scored } = await scoreRows(rows, { today: "2026-09-19", fetchBars: feed(SEPT).fetch });

  assert.equal(scored[0].triggerFired, false);
  assert.equal(out[0].checkpoints["1w"].note, "conditional — correctly never triggered");
});

// ---- rows closed for want of a price (B-017, HYPE) ----
// HYPE's series could not be fetched, so all three checkpoints were written
// "price not observable" and the 3m one closed the row as Unscored. A closed
// row is never due again, so fixing the symbol alone would not have scored it.

const UNOBSERVED = (asof) => ({
  asof,
  price: null,
  asset_pct: null,
  bench: "SPY",
  bench_pct: 2,
  alpha: null,
  verdict: "not_scorable",
  note: "price not observable at this checkpoint",
  source: "none",
  scored_at: "2026-09-30T12:00:00.000Z"
});

function unscoredRow(extra = {}) {
  return longRow({
    outcome: "Unscored",
    outcome_price: null,
    pct_move: null,
    grade_verdict: "price not observable at this checkpoint",
    checkpoints: { "1w": UNOBSERVED("2026-07-09"), "3m": UNOBSERVED("2026-09-30") },
    ...extra
  });
}

test("recheck scores a row that was closed as Unscored once its price series exists", async () => {
  const { rows: out, scored } = await scoreRows([unscoredRow()], { today: "2026-10-04", fetchBars, recheck: true });

  assert.equal(out[0].checkpoints["1w"].verdict, "right");
  assert.equal(out[0].checkpoints["1w"].alpha, 8);
  assert.equal(out[0].checkpoints["3m"].verdict, "right");
  assert.equal(out[0].outcome, "Win");
  assert.equal(out[0].outcome_price, 110);
  assert.equal(scored.length, 2);
});

test("without recheck a row closed as Unscored stays closed", async () => {
  const rows = [unscoredRow()];
  const { scored } = await scoreRows(rows, { today: "2026-10-04", fetchBars });

  assert.deepEqual(scored, []);
  assert.equal(rows[0].outcome, "Unscored");
});

test("recheck leaves an Unscored row alone while its price is still missing", async () => {
  const rows = [unscoredRow({ ticker: "NOSUCH" })];
  const { scored } = await scoreRows(rows, { today: "2026-10-04", fetchBars, recheck: true });

  assert.deepEqual(scored, []);
  assert.equal(rows[0].checkpoints["3m"].scored_at, "2026-09-30T12:00:00.000Z");
});

test("recheck never reopens a row a person closed", async () => {
  const rows = [unscoredRow({ outcome: "Stopped", outcome_price: 95, pct_move: -5 })];
  const { scored } = await scoreRows(rows, { today: "2026-10-04", fetchBars, recheck: true });

  assert.deepEqual(scored, []);
  assert.equal(rows[0].outcome, "Stopped");
  assert.equal(rows[0].outcome_price, 95);
});

test("a symbol with no price series is reported, not silently left unscored", async () => {
  const rows = [longRow({ ticker: "NOSUCH" })];
  const { failures } = await scoreRows(rows, { today: "2026-07-09", fetchBars: feed({ SPY: { bars: BARS.SPY } }).fetch });

  assert.deepEqual(failures, [{ ticker: "NOSUCH", error: "yahoo: 404" }]);
});
