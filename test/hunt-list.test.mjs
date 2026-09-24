// hunt-list.test.mjs — DISCOVERY / STALK / READY on top of the watchlist. Temp files only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { setHunt, clearHunt, lists, READY_CAP } from "../scripts/hunt-list.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../scripts/hunt-list.mjs");

function run(args) {
  try {
    return { out: execFileSync("node", [CLI, ...args], { encoding: "utf8" }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}

const wl = () => [
  { sym: "GOOGL", status: "OPEN-POSITION", note: "" },
  { sym: "COHR", status: "WATCH", note: "" },
  { sym: "A", status: "WATCH", note: "", hunt: "READY" },
  { sym: "B", status: "WATCH", note: "", hunt: "READY" },
  { sym: "C", status: "WATCH", note: "", hunt: "READY" },
];

test("setHunt moves a name and records history without touching status", () => {
  const { watchlist, problems } = setHunt(wl(), "cohr", "stalk", { discovered_price: 267.51, discovered_on: "2026-09-02", origin: "hunter", universe: "market", now: "2026-09-02" });
  assert.deepEqual(problems, []);
  const e = watchlist.find((x) => x.sym === "COHR");
  assert.equal(e.hunt, "STALK");
  assert.equal(e.status, "WATCH");
  assert.equal(e.discovered_price, 267.51);
  assert.equal(e.origin, "hunter");
  assert.deepEqual(e.hunt_history, [{ at: "2026-09-02", from: null, to: "STALK" }]);
});

test("discovered_price is set once and never overwritten", () => {
  let { watchlist } = setHunt(wl(), "COHR", "DISCOVERY", { discovered_price: 300, discovered_on: "2026-08-01" });
  ({ watchlist } = setHunt(watchlist, "COHR", "STALK", { discovered_price: 250, discovered_on: "2026-09-02" }));
  const e = watchlist.find((x) => x.sym === "COHR");
  assert.equal(e.discovered_price, 300);
  assert.equal(e.discovered_on, "2026-08-01");
});

test("a fourth READY is refused; demoting one frees the slot", () => {
  const first = setHunt(wl(), "COHR", "READY");
  assert.match(first.problems.join(" "), new RegExp(`READY already holds ${READY_CAP}`));
  let { watchlist } = setHunt(wl(), "A", "STALK");
  const second = setHunt(watchlist, "COHR", "READY");
  assert.deepEqual(second.problems, []);
  assert.equal(lists(second.watchlist).READY.length, READY_CAP);
});

test("re-setting a name already in READY does not count against itself", () => {
  const { problems } = setHunt(wl(), "A", "READY");
  assert.deepEqual(problems, []);
});

test("unknown state, origin, universe, or bad discovery fields are refused", () => {
  assert.match(setHunt(wl(), "COHR", "HOT").problems.join(" "), /state must be one of/);
  assert.match(setHunt(wl(), "COHR", "STALK", { origin: "twitter" }).problems.join(" "), /origin must be/);
  assert.match(setHunt(wl(), "COHR", "STALK", { universe: "crypto" }).problems.join(" "), /universe must be/);
  assert.match(setHunt(wl(), "COHR", "STALK", { discovered_price: -1 }).problems.join(" "), /discovered_price/);
  assert.match(setHunt(wl(), "COHR", "STALK", { discovered_on: "9/2" }).problems.join(" "), /discovered_on/);
});

test("a name not on the watchlist is added with status WATCH", () => {
  const { watchlist } = setHunt(wl(), "NEWCO", "DISCOVERY");
  const e = watchlist.find((x) => x.sym === "NEWCO");
  assert.equal(e.status, "WATCH");
  assert.equal(e.hunt, "DISCOVERY");
});

test("clearHunt removes the state and refuses when there is none", () => {
  const { watchlist, problems } = clearHunt(wl(), "A");
  assert.deepEqual(problems, []);
  assert.equal(watchlist.find((x) => x.sym === "A").hunt, undefined);
  assert.match(clearHunt(wl(), "GOOGL").problems.join(" "), /no hunt state/);
});

test("CLI --set writes the file and --list reports the cap", () => {
  const dir = mkdtempSync(join(tmpdir(), "hunt-"));
  const f = join(dir, "watchlist.json");
  writeFileSync(f, JSON.stringify(wl()));
  const set = run(["--file", f, "--set", "COHR", "STALK", "--discovered-price", "267.51", "--discovered-on", "2026-09-02", "--origin", "hunter"]);
  assert.equal(set.code, 0, set.out);
  const saved = JSON.parse(readFileSync(f, "utf8"));
  assert.equal(saved.find((x) => x.sym === "COHR").hunt, "STALK");
  const list = run(["--file", f, "--list"]);
  assert.match(list.out, /READY \(3\/3\)/);
  assert.match(list.out, /COHR/);
  const refused = run(["--file", f, "--set", "COHR", "READY"]);
  assert.equal(refused.code, 1);
  assert.match(refused.out, /READY already holds 3/);
});
