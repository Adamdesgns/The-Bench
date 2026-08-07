import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createReportStore,
  getReport,
  listReports,
  normalizeReport,
  REPORT_ID_RE,
  saveReport,
} from "./reportStore.js";

const FIXED = new Date("2026-08-07T15:04:05.123Z");

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "bench-report-store-"));
}

function sample(overrides = {}) {
  return {
    ok: true,
    target: "PODD",
    stamp: "2026-08-07T15:03:00.000Z",
    angle: "The reclaim held while the invalidation stayed untouched.",
    report_text: "THE MARKET TODAY\n\nEvidence remained constructive.",
    board: [{ id: "B-034", ticker: "PODD", last: 139.3, source: "stooq", state: "Watching" }],
    ...overrides,
  };
}

test("normalizeReport produces a safe, stable id and content hash", () => {
  const left = normalizeReport(sample(), { now: FIXED });
  const right = normalizeReport(sample(), { now: FIXED });
  assert.match(left.id, REPORT_ID_RE);
  assert.equal(left.id, right.id);
  assert.equal(left.content_sha256.length, 64);
  assert.equal(left.target, "podd");
  assert.equal(left.owner_id, "local-owner");
  assert.equal(left.as_of, sample().stamp);
});

test("save and get preserve the complete original result", () => {
  const root = tempRoot();
  const store = createReportStore({ runtimeDataDir: root });
  const saved = store.save(sample(), { now: FIXED });
  const loaded = store.get(saved.id);
  assert.deepEqual(loaded, saved);
  assert.deepEqual(loaded.result.board, sample().board);
  assert.equal(loaded.result.report_text, sample().report_text);
});

test("the report JSON is immutable and refuses an overwrite", () => {
  const store = createReportStore({ runtimeDataDir: tempRoot() });
  const saved = store.save(sample(), { now: FIXED });
  assert.throws(() => store.save(sample(), { now: FIXED }), /already exists/);
  assert.equal(store.get(saved.id).content_sha256, saved.content_sha256);
});

test("IDs cannot escape the report directory", () => {
  const store = createReportStore({ runtimeDataDir: tempRoot() });
  for (const id of ["../secrets", "rpt-okay/../../bad", "C:\\temp\\bad", ""]) {
    assert.throws(() => store.get(id), /invalid report id/);
  }
});

test("get returns null for a valid but missing id", () => {
  const store = createReportStore({ runtimeDataDir: tempRoot() });
  assert.equal(store.get("rpt-20260807t150405123z-market-0123456789ab"), null);
});

test("list is newest first, compact, filterable, and bounded", () => {
  const store = createReportStore({ runtimeDataDir: tempRoot() });
  const older = store.save(sample({ target: "PODD" }), { now: new Date("2026-08-07T10:00:00.000Z") });
  const newer = store.save(sample({ target: "SPY", summary: "Second" }), { now: new Date("2026-08-07T11:00:00.000Z") });
  const all = store.list();
  assert.deepEqual(all.map((row) => row.id), [newer.id, older.id]);
  assert.equal(all[0].result, undefined, "list does not ship the full report payload");
  assert.equal(all[0].board_count, 1);
  assert.equal(all[0].owner_id, "local-owner");
  assert.deepEqual(store.list({ target: "$PODD" }).map((row) => row.id), [older.id]);
  assert.deepEqual(store.list({ limit: 1 }).map((row) => row.id), [newer.id]);
});

test("an explicit owner id is part of the immutable snapshot and hash", () => {
  const local = normalizeReport(sample(), { now: FIXED });
  const user = normalizeReport(sample({ owner_id: "user-123" }), { now: FIXED });
  assert.equal(user.owner_id, "user-123");
  assert.notEqual(user.content_sha256, local.content_sha256);
  assert.notEqual(user.id, local.id);
});

test("list ignores unrelated and malformed runtime files", () => {
  const store = createReportStore({ runtimeDataDir: tempRoot() });
  store.list();
  writeFileSync(join(store.reportsDir, "notes.txt"), "not a report");
  writeFileSync(join(store.reportsDir, "rpt-bad.json"), "{broken");
  assert.deepEqual(store.list(), []);
});

test("module-level helpers use an explicit runtime directory", () => {
  const runtimeDataDir = tempRoot();
  const saved = saveReport(sample(), { runtimeDataDir, now: FIXED });
  assert.equal(getReport(saved.id, { runtimeDataDir }).id, saved.id);
  assert.equal(listReports({ runtimeDataDir })[0].id, saved.id);
});

test("a stored filename/report id mismatch is detected", () => {
  const store = createReportStore({ runtimeDataDir: tempRoot() });
  const saved = store.save(sample(), { now: FIXED });
  const file = store.jsonPath(saved.id);
  const tampered = { ...saved, id: "rpt-20260807t150405123z-market-0123456789ab" };
  writeFileSync(file, JSON.stringify(tampered));
  assert.throws(() => store.get(saved.id), /does not match/);
});

test("saved JSON is readable and ends with a newline", () => {
  const store = createReportStore({ runtimeDataDir: tempRoot() });
  const saved = store.save(sample(), { now: FIXED });
  const raw = readFileSync(store.jsonPath(saved.id), "utf8");
  assert.ok(raw.endsWith("\n"));
  assert.equal(JSON.parse(raw).id, saved.id);
});
