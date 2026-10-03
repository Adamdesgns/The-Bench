// hunt.test.mjs — HUNTER MODE: the pure pieces of scripts/hunt.mjs and hunt-bars.mjs. No Hunter
// process, no provider, temp files only. The Hunter JSON here is the shape the parity fixture
// (research/prepump/parity/file-path-GOOGL-AMZN-CBRS.json) carries, trimmed.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseHuntArguments, fired, earningsLine, renderHunt, discoveryPrints, logFired, EXPOSURE_ODDS } from "../scripts/hunt.mjs";
import { buildBarsFile } from "../scripts/hunt-bars.mjs";

const rsa = (symbol, prev, cur, acc) => ({
  symbol,
  dimensions: [{ detector: "RELATIVE_STRENGTH_ACCELERATION", detectorVersion: "rsa-v1", measurements: [
    { name: "previousExcessReturn", value: prev, unit: "decimal" }, { name: "currentExcessReturn", value: cur, unit: "decimal" },
    { name: "acceleration", value: acc, unit: "decimal" }, { name: "threshold", value: 0.05, unit: "decimal" }] }],
});
const exposure = (symbol, status, dd, dv) => ({ symbol, status, drawdownFromHigh: dd, dollarVolumeRatio: dv, highLookbackSessions: 78, sessionsAvailable: 79 });
const coverage = (symbol, accepted = 79) => ({ symbol, deliveryStatus: accepted === 79 ? "COMPLETE" : "PARTIAL", expectedSessionCount: 79, acceptedSessionCount: accepted });

function report() {
  return {
    market: { dataThrough: "2026-09-09T20:00:00.000Z", sessionsRead: 79, regime: "NEUTRAL", scanStatus: "HEALTHY" },
    stirring: [rsa("IREN", -0.0724, 0.2659, 0.3383)],
    exposures: [exposure("IREN", "NOT_TRIGGERED", 0.62, 1.4), exposure("FTFT", "TRIGGERED", 0.10, 600.52), exposure("UBER", "NOT_TRIGGERED", 0.9, 0.8)],
    earnings: [{ symbol: "IREN", daysSince: 13, daysUntil: null, nextVerified: null }, { symbol: "FTFT", daysSince: null, daysUntil: 3, nextVerified: false }, { symbol: "UBER", daysSince: null, daysUntil: null, nextVerified: null }],
    coverage: [coverage("IREN"), coverage("FTFT"), coverage("UBER"), coverage("MGN", 78), coverage("SPY")],
    health: [{ symbol: "IREN", status: "HEALTHY", issueCodes: [] }, { symbol: "MGN", status: "REFUSED", issueCodes: ["MISSING_SESSION"] }],
    receipt: { id: "7196ad1a-0000", normalizedInputHash: "b922161d00", totalProviderCalls: 3, barsSource: "OPERATOR_BARS_FILE", barsFile: { capturedAt: "2026-09-10T06:30:00.000Z", source: "test" } },
  };
}

test("arguments: --bars is required, symbols upper-case, flags parse, universe checked", () => {
  const a = parseHuntArguments(["--bars", "b.json", "iren", "CBRS", "--log", "--universe", "ai-infra"]);
  assert.deepEqual(a.symbols, ["IREN", "CBRS"]);
  assert.equal(a.bars, "b.json"); assert.equal(a.log, true); assert.equal(a.earnings, true); assert.equal(a.universe, "ai-infra");
  assert.equal(parseHuntArguments(["--bars", "b.json", "X", "--no-earnings"]).earnings, false);
  assert.throws(() => parseHuntArguments(["IREN"]), /--bars/);
  assert.throws(() => parseHuntArguments(["--bars", "b.json"]), /at least one symbol/);
  assert.throws(() => parseHuntArguments(["--bars", "b.json", "X", "--universe", "crypto"]), /universe/);
  assert.throws(() => parseHuntArguments(["--bars", "--log", "X"]), /needs a value/);
});

test("fired: stirring and triggered exposure, never NOT_TRIGGERED, sorted", () => {
  assert.deepEqual(fired(report()), [
    { symbol: "FTFT", detectors: ["DRAWDOWN_EXPOSURE"] },
    { symbol: "IREN", detectors: ["RELATIVE_STRENGTH_ACCELERATION"] },
  ]);
});

test("earnings qualifier mirrors Hunter's windows: pre 1-5 days, post 1-10 with nothing inside 20, else silent", () => {
  assert.match(earningsLine({ daysUntil: 3, daysSince: null, nextVerified: false }), /Reports in 3 days \(date unverified\).*2\.6x/);
  assert.match(earningsLine({ daysUntil: null, daysSince: 7, nextVerified: null }), /Reported 7 days ago.*0 crashes in 1621/);
  assert.equal(earningsLine({ daysUntil: null, daysSince: 13, nextVerified: null }), null);
  assert.equal(earningsLine({ daysUntil: 15, daysSince: 7, nextVerified: true }), null);
  assert.equal(earningsLine(undefined), null);
});

test("render: names each block, restates the frozen odds, lists quiet and unreadable, ends with the desk line", () => {
  const page = renderHunt(report(), { symbols: ["IREN", "FTFT", "UBER", "MGN"] });
  assert.match(page, /HUNTER MODE - 4 names, data through 2026-09-09 \(79 sessions\), backdrop NEUTRAL, scan HEALTHY/);
  assert.match(page, /the desk's own capture at 2026-09-10T06:30:00.000Z/);
  assert.match(page, /STIRRING - 1 crossed/);
  assert.match(page, /IREN {3}ahead of SPY by 26\.6 pts over 5 sessions after trailing by 7\.2 the 5 before; swing 33\.8 vs a 5\.0 threshold/);
  assert.match(page, /EXPOSURE - 1 beaten down/);
  assert.match(page, /FTFT {3}0\.10 of its 78-session high on 600\.52x usual dollar volume/);
  assert.match(page, new RegExp(`${EXPOSURE_ODDS.dd20}x a further -20%.*${EXPOSURE_ODDS.pump}x a \\+30%.*${EXPOSURE_ODDS.crash}x a -30%`));
  assert.match(page, /Reports in 3 days/);
  assert.match(page, /QUIET - UBER/);
  assert.match(page, /COULDN'T READ - MGN/);
  assert.match(page, /MGN {4}REFUSED \(MISSING_SESSION\)/);
  assert.match(page, /FOR THE DESK: FTFT, IREN fired\. Each runs every gate with --origin hunter\. No Hunter number touches a gate\./);
  assert.match(page, /Receipt 7196ad1a {2}input b922161d {2}3 reads \(OPERATOR_BARS_FILE\), 0 account calls, 0 order calls\./);
});

test("render: a run with nothing fired says so and asks for nothing", () => {
  const r = report(); r.stirring = []; r.exposures = r.exposures.map((e) => ({ ...e, status: "NOT_TRIGGERED" })); r.coverage = r.coverage.filter((c) => c.symbol !== "MGN"); r.health = r.health.filter((h) => h.symbol !== "MGN");
  const page = renderHunt(r, { symbols: ["IREN", "FTFT", "UBER"] });
  assert.match(page, /STIRRING - none/); assert.match(page, /EXPOSURE - none/); assert.match(page, /QUIET - IREN, FTFT, UBER/);
  assert.match(page, /FOR THE DESK: nothing fired/);
});

test("discoveryPrints: the close on the through-date bar, never an interpolated one", () => {
  const bars = { historicals: [{ response: { data: { results: [
    { symbol: "IREN", bars: [{ begins_at: "2026-09-08T00:00:00Z", close_price: "46.930000" }, { begins_at: "2026-09-09T00:00:00Z", close_price: "45.370000" }] },
    { symbol: "FTFT", bars: [{ begins_at: "2026-09-09T00:00:00Z", close_price: "1.10", interpolated: true }] },
  ] }, guide: "t" } }] };
  const p = discoveryPrints(bars, "2026-09-09");
  assert.equal(p.get("IREN"), 45.37);
  assert.equal(p.has("FTFT"), false);
});

test("logFired: DISCOVERY with origin hunter, price and date; leaves STALK/READY alone; never writes a verdict", () => {
  const watchlist = [{ sym: "IREN", status: "ARMED-CONDITIONAL", hunt: "STALK", note: "B-318" }, { sym: "UBER", status: "WATCH", note: "" }];
  const prints = new Map([["FTFT", 1.1], ["IREN", 45.37]]);
  const { watchlist: next, notes } = logFired(watchlist, report(), { prints, universe: "market" });
  const ftft = next.find((e) => e.sym === "FTFT");
  assert.equal(ftft.hunt, "DISCOVERY");
  assert.equal(ftft.origin, "hunter");
  assert.equal(ftft.discovered_price, 1.1);
  assert.equal(ftft.discovered_on, "2026-09-09");
  assert.match(ftft.hunt_why, /Hunter fired DRAWDOWN_EXPOSURE on the 2026-09-09 bar \(receipt 7196ad1a\)/);
  assert.equal(ftft.status, "WATCH");
  assert.equal("grades" in ftft || "readiness" in ftft || "final_call" in ftft, false);
  assert.equal(next.find((e) => e.sym === "IREN").hunt, "STALK");
  assert.ok(notes.some((n) => /IREN: already STALK, left alone/.test(n)));
  assert.ok(notes.some((n) => /FTFT -> DISCOVERY \(origin hunter, 1\.1 on 2026-09-09\)/.test(n)));
  assert.equal(watchlist.length, 2, "input untouched");
});

test("logFired: nothing fired means the same watchlist object back", () => {
  const r = report(); r.stirring = []; r.exposures = [];
  const watchlist = [{ sym: "UBER", status: "WATCH", note: "" }];
  const { watchlist: next, notes } = logFired(watchlist, r, { prints: new Map(), universe: "market" });
  assert.equal(next, watchlist); assert.deepEqual(notes, []);
});

test("buildBarsFile: wraps raw tool results untouched, reconstructs symbols, pairs the earnings windows on the anchor", () => {
  const hist = { data: { results: [{ symbol: "IREN", interval: "day", bounds: "regular", bars: [{ begins_at: "2026-09-09T00:00:00Z", open_price: "1", close_price: "1", high_price: "1", low_price: "1", volume: 5 }] }], not_found: ["ZZZZ"] }, guide: "g" };
  const cal = { data: { results: [] }, guide: "g" };
  const body = buildBarsFile({ historicals: [hist], earningsBack: cal, earningsAhead: cal, anchor: "2026-09-09", source: "test", capturedAt: "2026-09-10T00:00:00.000Z" });
  assert.equal(body.version, "hunter-bars-file-v1");
  assert.deepEqual(body.historicals[0].request.symbols, ["IREN", "ZZZZ"]);
  assert.equal(body.historicals[0].request.start_time, "2026-09-09T00:00:00Z");
  assert.equal(body.historicals[0].response, hist, "the raw result is carried by reference, not rewritten");
  assert.deepEqual(body.earningsCalendar.map((e) => e.request), [{ start_date: "2026-09-09", days: -31 }, { start_date: "2026-09-09", days: 31 }]);
  assert.throws(() => buildBarsFile({ historicals: [hist], earningsBack: cal }), /go together/);
  assert.throws(() => buildBarsFile({ historicals: [hist], earningsBack: cal, earningsAhead: cal }), /--anchor/);
  assert.throws(() => buildBarsFile({ historicals: [{ nope: true }] }), /not a Robinhood tool result/);
  assert.throws(() => buildBarsFile({ historicals: [] }), /at least one/);
});
