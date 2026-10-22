// gex.test.mjs — the free gamma heat map: parsing, the gamma math, the levels, the CLI. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { parseOcc, bsGamma, buildGex, nyDate } from "../scripts/gex.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/gex.mjs");
const run = (args) => execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

const ASOF = "2026-10-16 21:00:00";
// One contract, gamma taken from Black-Scholes so the grid and the spot agree.
const c = (type, strike, oi, { exp = "261030", iv = 0.25, spot = 100 } = {}) => {
  const T = (Date.parse(`20${exp.slice(0, 2)}-${exp.slice(2, 4)}-${exp.slice(4)}T20:00:00Z`) - Date.parse(ASOF.replace(" ", "T") + "Z")) / (365 * 864e5);
  return { option: `TEST${exp}${type}${String(Math.round(strike * 1000)).padStart(8, "0")}`, open_interest: oi, iv, gamma: bsGamma(spot, strike, T, iv) };
};
const chain = (spot, options) => ({ timestamp: ASOF, data: { current_price: spot, options } });

test("parseOcc reads the root, expiry, type and strike, and refuses junk", () => {
  assert.deepEqual(parseOcc("SPY261023P00760000"), { root: "SPY", expiry: "2026-10-23", type: "P", strike: 760 });
  assert.deepEqual(parseOcc("SPXW261023C05800000"), { root: "SPXW", expiry: "2026-10-23", type: "C", strike: 5800 });
  assert.deepEqual(parseOcc("BRKB261120C00512500"), { root: "BRKB", expiry: "2026-11-20", type: "C", strike: 512.5 });
  assert.equal(parseOcc("not an option"), null);
});

test("bsGamma matches the textbook value at the money", () => {
  // S = K = 100, one year, 20% vol, r = 0: d1 = 0.1, gamma = phi(0.1) / (100 x 0.2) = 0.019848
  assert.ok(Math.abs(bsGamma(100, 100, 1, 0.2, 0) - 0.019848) < 1e-5);
  assert.equal(bsGamma(100, 100, 0, 0.2), 0, "expired contracts carry no gamma");
  assert.equal(bsGamma(100, 100, 1, 0), 0, "no implied vol, no gamma");
});

test("calls count positive, puts negative, and the king node is the biggest either way", () => {
  const g = buildGex(chain(100, [c("C", 105, 1000), c("P", 95, 5000), c("C", 100, 10)]), { window: 10, days: 60 });
  const at = (k) => g.strikes.find((s) => s.strike === k).total;
  assert.ok(at(105) > 0);
  assert.ok(at(95) < 0);
  assert.equal(g.levels.king_node.strike, 95);
  assert.equal(g.levels.call_wall.strike, 105);
  assert.equal(g.levels.put_wall.strike, 95);
  assert.ok(g.net < 0, "5,000 puts outweigh 1,000 calls at the same distance");
  assert.equal(g.regime, "negative");
});

test("dollar gamma is gamma x open interest x 100 x spot squared x 1%", () => {
  const one = c("C", 100, 1);
  const g = buildGex(chain(100, [one]), { window: 10, days: 60 });
  assert.ok(Math.abs(g.net - one.gamma * 100 * 100 * 100 * 0.01) < 1e-9);
});

test("the flip sits between a put-heavy floor and a call-heavy ceiling", () => {
  const g = buildGex(chain(100, [c("P", 95, 4000), c("C", 105, 4000)]), { window: 10, days: 60 });
  assert.ok(g.levels.flip !== null, "a sign change exists");
  assert.ok(g.levels.flip > 95 && g.levels.flip < 105, `flip ${g.levels.flip}`);
});

test("no sign change means no flip, said plainly", () => {
  const g = buildGex(chain(100, [c("C", 100, 1000), c("C", 104, 1000)]), { window: 5, days: 60 });
  assert.equal(g.levels.flip, null);
  assert.equal(g.regime, "positive");
});

test("the window and the day limit drop far strikes and far expiries, and say how many", () => {
  const g = buildGex(chain(100, [c("C", 100, 10), c("C", 150, 10), c("C", 100, 10, { exp: "270115" })]), { window: 7, days: 35 });
  assert.deepEqual(g.strikes.map((s) => s.strike), [100]);
  assert.deepEqual(g.expiries, ["2026-10-30"]);
  assert.equal(g.dropped, 2);
});

test("expired contracts and contracts with no open interest are ignored", () => {
  const g = buildGex(chain(100, [c("C", 100, 0), c("C", 101, 50, { exp: "261016" }), c("P", 99, 50)]), { window: 7, days: 35 });
  assert.deepEqual(g.strikes.map((s) => s.strike), [99]);
});

test("CLI: --file prints the levels and --write saves a dated receipt", () => {
  const dir = mkdtempSync(join(tmpdir(), "gex-"));
  const f = join(dir, "TEST.json");
  writeFileSync(f, JSON.stringify(chain(100, [c("P", 95, 4000), c("C", 105, 4000)])));
  const out = run(["--file", f, "--symbol", "TEST", "--window", "10", "--write", "--out", dir]);
  assert.match(out, /TEST/);
  assert.match(out, /KING NODE/);
  assert.match(out, /supporting evidence only/i);
  const saved = readdirSync(dir).filter((n) => n.startsWith("2026-10-16-TEST"));
  assert.equal(saved.length, 1);
  const r = JSON.parse(readFileSync(join(dir, saved[0]), "utf8"));
  assert.equal(r.kind, "gex");
  assert.equal(r.sym, "TEST");
  assert.ok(Array.isArray(r.grid) && r.grid.length === r.strikes.length);
});

test("nyDate names the session: late night and weekends belong to the last trading day", () => {
  assert.equal(nyDate("2026-10-16 21:00:00"), "2026-10-16", "5 pm ET Friday");
  assert.equal(nyDate("2026-10-17 04:30:37"), "2026-10-16", "12:30 am ET Saturday is Friday's data");
  assert.equal(nyDate("2026-10-19 12:00:00"), "2026-10-16", "8 am ET Monday, before the open");
  assert.equal(nyDate("2026-10-19 15:00:00"), "2026-10-19", "11 am ET Monday");
});

test("CLI: --json prints machine-readable output", () => {
  const dir = mkdtempSync(join(tmpdir(), "gex-"));
  const f = join(dir, "TEST.json");
  writeFileSync(f, JSON.stringify(chain(100, [c("C", 100, 100)])));
  const r = JSON.parse(run(["--file", f, "--symbol", "TEST", "--json"]));
  assert.equal(r.spot, 100);
  assert.equal(r.levels.call_wall.strike, 100);
});
