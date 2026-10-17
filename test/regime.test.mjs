// regime.test.mjs — the daily regime stamp, offline via --bars-file. No network, no writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { classify, sma, barsFromChart } from "../scripts/regime.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/regime.mjs");

function run(args) {
  try {
    return { out: execFileSync("node", [CLI, ...args], { encoding: "utf8" }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}

// Synthetic series builders: 260 sessions, dates weekday-only from 2025-09-01.
function dates(n) {
  const out = [];
  const d = new Date("2025-09-01T12:00:00Z");
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const series = (fn, n = 260) => dates(n).map((date, i) => ({ date, close: fn(i) }));
const closes = (fn, n = 260) => Array.from({ length: n }, (_, i) => fn(i));

test("sma is the mean of the last n closes", () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1, 2], 3), null);
});

test("steady uptrend with calm VIX classifies TRENDING, risk 4", () => {
  const r = classify({
    SPY: closes((i) => 500 + i * 1.0),
    QQQ: closes((i) => 400 + i * 1.1),
    IWM: closes((i) => 200 + i * 0.4),
    VIX: closes(() => 14),
    TNX: closes(() => 4.3),
  });
  assert.equal(r.label, "TRENDING");
  assert.equal(r.market_risk, 4);
});

test("below the 50 SMA with VIX spiking classifies RISK-OFF, risk 1", () => {
  const r = classify({
    SPY: closes((i) => (i < 240 ? 700 : 700 - (i - 239) * 6)),
    QQQ: closes((i) => (i < 240 ? 600 : 600 - (i - 239) * 6)),
    IWM: closes((i) => (i < 240 ? 300 : 300 - (i - 239) * 3)),
    VIX: closes((i) => (i < 255 ? 15 : 28)),
    TNX: closes(() => 4.7),
  });
  assert.equal(r.label, "RISK-OFF");
  assert.equal(r.market_risk, 1);
});

test("flat tape inside +/-1.5% of the 20 SMA for 10 sessions classifies CHOP", () => {
  const r = classify({
    SPY: closes((i) => 600 + (i % 2 === 0 ? 1 : -1)),
    QQQ: closes((i) => 500 + (i % 2 === 0 ? 1 : -1)),
    IWM: closes((i) => 250 + (i % 2 === 0 ? 0.5 : -0.5)),
    VIX: closes(() => 17),
    TNX: closes(() => 4.2),
  });
  assert.equal(r.label, "CHOP");
  assert.equal(r.market_risk, 3);
});

test("a macro release on the next session overrides to EVENT, risk 2", () => {
  const r = classify(
    {
      SPY: closes((i) => 500 + i),
      QQQ: closes((i) => 400 + i),
      IWM: closes((i) => 200 + i * 0.4),
      VIX: closes(() => 14),
      TNX: closes(() => 4.3),
    },
    { eventNext: true }
  );
  assert.equal(r.label, "EVENT");
  assert.equal(r.market_risk, 2);
  assert.match(r.reasons[0], /overrides TRENDING/);
});

test("refuses fewer than 20 closes", () => {
  assert.throws(() => classify({ SPY: [1, 2], QQQ: [1, 2], IWM: [1, 2], VIX: [1, 2] }), /need at least 20/);
});

test("CLI reads --bars-file, honors --date, prints the stamp, writes nothing without --write", () => {
  const dir = mkdtempSync(join(tmpdir(), "regime-"));
  const f = join(dir, "bars.json");
  writeFileSync(
    f,
    JSON.stringify({
      SPY: series((i) => 500 + i),
      QQQ: series((i) => 400 + i),
      IWM: series((i) => 200 + i * 0.4),
      VIX: series(() => 14),
      TNX: series(() => 4.3),
    })
  );
  // 2026-07-01 is ~217 weekday bars in: enough history for the 200 SMA.
  const empty = join(dir, "no-catalysts.json");
  writeFileSync(empty, "[]");
  const { code, out } = run(["--bars-file", f, "--json", "--date", "2026-07-01", "--catalysts", empty]);
  assert.equal(code, 0, out);
  const j = JSON.parse(out);
  assert.equal(j.label, "TRENDING");
  assert.equal(j.asof, "2026-07-01");
  assert.equal(j.market_risk, 4);
  assert.ok(Array.isArray(j.reasons) && j.reasons.length > 0);
});

// ── Yahoo's null newest close (2026-10-14 19:10 CT) ─────────────────────────
// After the bell Yahoo returned today's bar with close = null and the settled price only in
// meta. regime.mjs skipped it and stamped "as of 2026-10-13", naming CPI instead of PPI.
const SESSION_START = Date.parse("2026-10-14T13:30:00Z") / 1000;
const SESSION_END = Date.parse("2026-10-14T20:00:00Z") / 1000;
const nullCloseChart = () => ({
  meta: {
    exchangeTimezoneName: "America/New_York",
    regularMarketPrice: 769.6,
    regularMarketTime: SESSION_END,
    currentTradingPeriod: { regular: { start: SESSION_START, end: SESSION_END } },
  },
  timestamp: [Date.parse("2026-10-13T13:30:00Z") / 1000, SESSION_START],
  indicators: { quote: [{ close: [778.01, null] }] },
});

test("barsFromChart: after the close the null newest bar is filled, so the stamp is as of today", () => {
  const bars = barsFromChart(nullCloseChart(), { now: new Date("2026-10-15T00:10:00Z") }); // 19:10 CT
  assert.deepEqual(bars.at(-1), { date: "2026-10-14", close: 769.6 });
  assert.equal(bars.length, 2);
});

test("barsFromChart: mid-session the null newest bar is dropped, never filled as a close", () => {
  const bars = barsFromChart(nullCloseChart(), { now: new Date("2026-10-14T17:00:00Z") }); // 12:00 ET
  assert.equal(bars.at(-1).date, "2026-10-13");
});

test("CLI warns on stderr when the inputs end on different sessions", () => {
  const dir = mkdtempSync(join(tmpdir(), "regime-"));
  const f = join(dir, "bars.json");
  const vix = series(() => 14).slice(0, -1); // VIX one session behind
  writeFileSync(f, JSON.stringify({ SPY: series((i) => 500 + i), QQQ: series((i) => 400 + i), IWM: series((i) => 200 + i * 0.4), VIX: vix, TNX: series(() => 4.3) }));
  const empty = join(dir, "no-catalysts.json");
  writeFileSync(empty, "[]");
  const r = spawnSync("node", [CLI, "--bars-file", f, "--json", "--catalysts", empty], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING inputs end on different sessions/);
  assert.doesNotThrow(() => JSON.parse(r.stdout));
});
