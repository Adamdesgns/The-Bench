// reportStore.js - immutable, local report snapshots and portable PDF exports.

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.js";
import { renderReportPdf } from "./reportPdf.js";

export const REPORT_SCHEMA_VERSION = 1;
export const REPORT_ID_RE = /^rpt-\d{8}t\d{9}z-[a-z0-9][a-z0-9-]{0,31}-[a-f0-9]{12}$/;
export const DEFAULT_RUNTIME_DATA_DIR = resolve(
  process.env.BENCH_RUNTIME_DATA_DIR || process.env.BENCH_DATA_DIR || resolve(ROOT, "db", "runtime")
);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeTarget(value) {
  const clean = String(value || "market").trim().toLowerCase().replace(/^\$/, "");
  return clean.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "market";
}

function safeId(id) {
  const value = String(id || "").toLowerCase();
  if (!REPORT_ID_RE.test(value)) throw new Error("invalid report id");
  return value;
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return clone(sources.slice(0, 100));
}

export function normalizeReport(input, { now = new Date() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("report must be an object");
  }
  const created = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(created.getTime())) throw new TypeError("now must be a valid date");
  const target = safeTarget(input.target);
  const ownerId = String(input.owner_id || "local-owner").trim() || "local-owner";
  const body = {
    schema_version: REPORT_SCHEMA_VERSION,
    created_at: created.toISOString(),
    as_of: String(input.as_of || input.stamp || input.packet?.review_stamp || created.toISOString()),
    target,
    // Authentication can replace this placeholder later without changing the
    // immutable report contract or requiring a storage migration.
    owner_id: ownerId,
    title: String(input.title || (target === "market" ? "Daily Market Report" : `$${target.toUpperCase()} Research Report`)),
    status: String(input.status || (input.ok === false ? "attention" : "complete")),
    ok: input.ok !== false,
    summary: String(input.summary || input.angle || input.no_story || ""),
    errors: Array.isArray(input.errors) ? input.errors.map(String).slice(0, 100) : [],
    report_text: String(input.report_text || ""),
    sections: Array.isArray(input.sections) ? clone(input.sections) : [],
    board: Array.isArray(input.board) ? clone(input.board) : [],
    sources: normalizeSources(input.sources),
    result: clone(input),
  };
  const contentHash = createHash("sha256").update(canonical(body)).digest("hex");
  const timePart = body.created_at.replace(/[-:.]/g, "").toLowerCase();
  return {
    ...body,
    id: `rpt-${timePart}-${target}-${contentHash.slice(0, 12)}`,
    content_sha256: contentHash,
  };
}

export function createReportStore({ runtimeDataDir = DEFAULT_RUNTIME_DATA_DIR } = {}) {
  const root = resolve(runtimeDataDir);
  const reportsDir = resolve(root, "reports");
  const pdfDir = resolve(reportsDir, "pdf");

  function ensureDirs() {
    mkdirSync(reportsDir, { recursive: true });
    mkdirSync(pdfDir, { recursive: true });
  }

  function jsonPath(id) {
    return resolve(reportsDir, `${safeId(id)}.json`);
  }

  function pdfPath(id) {
    return resolve(pdfDir, `${safeId(id)}.pdf`);
  }

  function save(input, options = {}) {
    ensureDirs();
    const report = normalizeReport(input, options);
    try {
      writeFileSync(jsonPath(report.id), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error(`report already exists: ${report.id}`);
      throw error;
    }
    return clone(report);
  }

  function get(id) {
    const file = jsonPath(id);
    if (!existsSync(file)) return null;
    const report = JSON.parse(readFileSync(file, "utf8"));
    if (report.id !== safeId(id)) throw new Error("stored report id does not match its filename");
    return report;
  }

  function list({ limit = 50, target = null } = {}) {
    ensureDirs();
    const bounded = Math.max(1, Math.min(Number(limit) || 50, 500));
    const targetFilter = target ? safeTarget(target) : null;
    return readdirSync(reportsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && REPORT_ID_RE.test(entry.name.replace(/\.json$/, "")) && entry.name.endsWith(".json"))
      .map((entry) => JSON.parse(readFileSync(resolve(reportsDir, entry.name), "utf8")))
      .filter((report) => !targetFilter || report.target === targetFilter)
      .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
      .slice(0, bounded)
      .map((report) => ({
        id: report.id,
        created_at: report.created_at,
        as_of: report.as_of,
        target: report.target,
        owner_id: report.owner_id,
        title: report.title,
        status: report.status,
        ok: report.ok,
        summary: report.summary,
        board_count: report.board?.length || 0,
        pdf_ready: existsSync(pdfPath(report.id)),
      }));
  }

  function createPdf(id) {
    ensureDirs();
    const report = get(id);
    if (!report) return null;
    const destination = pdfPath(id);
    if (existsSync(destination)) return { path: destination, created: false, bytes: readFileSync(destination).length };
    const buffer = renderReportPdf(report);
    try {
      writeFileSync(destination, buffer, { flag: "wx" });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      return { path: destination, created: false, bytes: readFileSync(destination).length };
    }
    return { path: destination, created: true, bytes: buffer.length };
  }

  return Object.freeze({ root, reportsDir, pdfDir, save, get, list, createPdf, jsonPath, pdfPath });
}

export function saveReport(input, options = {}) {
  const { runtimeDataDir, ...normalizeOptions } = options;
  return createReportStore({ runtimeDataDir }).save(input, normalizeOptions);
}

export function getReport(id, options = {}) {
  return createReportStore(options).get(id);
}

export function listReports(options = {}) {
  const { runtimeDataDir, ...listOptions } = options;
  return createReportStore({ runtimeDataDir }).list(listOptions);
}

export function createReportPdf(id, options = {}) {
  return createReportStore(options).createPdf(id);
}

export const __reportStoreInternals = { canonical, safeTarget, safeId };
