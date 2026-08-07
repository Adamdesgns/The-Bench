import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReportPdf, __pdfInternals } from "./reportPdf.js";
import { createReportStore } from "./reportStore.js";

function sample(overrides = {}) {
  return {
    ok: true,
    target: "market",
    title: "Daily Market Report",
    created_at: "2026-08-07T15:04:05.123Z",
    as_of: "2026-08-07T15:03:00.000Z",
    summary: "Leadership narrowed while the index held its opening range.",
    report_text: "THE MARKET TODAY\n\nRegime: Neutral. Market risk remained measured.\n\nTHESIS\n\nThe tape held, but breadth did not confirm the move.",
    errors: [],
    board: [
      { id: "B-034", ticker: "PODD", last: 139.3, source: "stooq", provisional: true, state: "Watching" },
      { id: "B-038", ticker: "SPY", last: 768.56, source: "robinhood", provisional: false, state: "Conditional" },
    ],
    sources: [{ label: "Robinhood fundamentals", as_of: "2026-08-07 10:03 CT" }],
    ...overrides,
  };
}

test("renderReportPdf creates a structurally complete PDF", () => {
  const pdf = renderReportPdf(sample());
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 8).toString("latin1"), "%PDF-1.4");
  assert.match(pdf.toString("latin1"), /\/Type \/Catalog/);
  assert.match(pdf.toString("latin1"), /\/MediaBox \[0 0 612 792\]/);
  assert.ok(pdf.toString("latin1").endsWith("%%EOF\n"));
  assert.ok(pdf.length > 3000);
});

test("PDF content includes branding, title, disclosures, and page numbers", () => {
  const raw = renderReportPdf(sample()).toString("latin1");
  assert.match(raw, /THE BENCH/);
  assert.match(raw, /Daily Market Report/);
  assert.match(raw, /Research only - not investment advice/);
  assert.match(raw, /PAGE 1/);
});

test("long reports paginate instead of clipping below the footer", () => {
  const report_text = Array.from({ length: 180 }, (_, index) => `Evidence line ${index + 1} preserves the original thesis and its timestamp.`).join("\n");
  const raw = renderReportPdf(sample({ report_text })).toString("latin1");
  const pageCount = Number(/\/Count (\d+)/.exec(raw)?.[1]);
  assert.ok(pageCount >= 4, `expected at least four pages, got ${pageCount}`);
  assert.match(raw, /PAGE 4/);
});

test("unicode punctuation is converted to portable ASCII", () => {
  const cleaned = __pdfInternals.ascii("Proof \u2014 not hype \u2022 don't guess \u2026");
  assert.equal(cleaned, "Proof - not hype - don't guess ...");
});

test("wrap does not drop words or emit overlong normal lines", () => {
  const lines = __pdfInternals.wrap("one two three four five six", 10);
  assert.equal(lines.join(" "), "one two three four five six");
  assert.ok(lines.every((line) => line.length <= 10));
});

test("PDF export is created once and never overwritten", () => {
  const runtimeDataDir = mkdtempSync(join(tmpdir(), "bench-report-pdf-"));
  const store = createReportStore({ runtimeDataDir });
  const saved = store.save(sample(), { now: new Date("2026-08-07T15:04:05.123Z") });
  const first = store.createPdf(saved.id);
  const bytes = readFileSync(first.path);
  const second = store.createPdf(saved.id);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.path, first.path);
  assert.deepEqual(readFileSync(second.path), bytes);
  assert.equal(store.list()[0].pdf_ready, true);
});

test("PDF export returns null for a missing saved report", () => {
  const store = createReportStore({ runtimeDataDir: mkdtempSync(join(tmpdir(), "bench-report-pdf-")) });
  assert.equal(store.createPdf("rpt-20260807t150405123z-market-0123456789ab"), null);
});

test("invalid input is refused before PDF rendering", () => {
  assert.throws(() => renderReportPdf(null), /report must be an object/);
});
