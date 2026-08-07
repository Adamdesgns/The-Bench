// index.js — local backend for THE BENCH app. Serves public/ and exposes the
// API the Bench OS front-end calls. It runs the analysis chain and reads/writes
// the NON-SECRET connection config. It never stores keys and never posts.
//
//   GET  /               -> public/index.html (Bench OS)
//   GET  /api/health     -> up + connection status (booleans only)
//   GET  /api/archive    -> db/archive.json
//   POST /api/run        -> runs an analysis command, returns step log JSON
//   POST /api/report     -> starts the real v23 report chain
//   GET  /api/settings   -> connection status (no secrets)
//   POST /api/settings   -> merge non-secret connection config (secrets stripped)
//
// Run: node server/index.js   (PORT env optional, default 8137)

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { ROOT, ARCHIVE_PATH } from "./config.js";
import { runCommand } from "./api.js";
import { runReport } from "./reviewer.js";
import { status, writeConnections } from "./settings.js";
import { setSecret } from "./secrets.js";
import { appendAudit, readAudit, verifyChain, exportCsv } from "./audit.js";
import { createReportStore } from "./reportStore.js";

// One report at a time in the local workstation. Completed runs are immutable
// snapshots on disk, so they survive restarts and can always regenerate a PDF.
const reportStore = createReportStore();
const REPORT_JOBS = new Map();
const IDEMPOTENCY = new Map();
let activeReportJobId = null;
let lastReportJobId = null;

function trimJobs() {
  const completed = [...REPORT_JOBS.values()].filter((job) => !job.running).sort((a, b) => b.started - a.started);
  for (const job of completed.slice(20)) REPORT_JOBS.delete(job.id);
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, record] of IDEMPOTENCY) if (record.created < cutoff) IDEMPOTENCY.delete(key);
}

function startReport(target, { idempotencyKey = null } = {}) {
  trimJobs();
  if (idempotencyKey && IDEMPOTENCY.has(idempotencyKey)) {
    const prior = REPORT_JOBS.get(IDEMPOTENCY.get(idempotencyKey).jobId);
    if (prior) return { started: prior.running, duplicate: true, job: prior };
  }
  if (activeReportJobId && REPORT_JOBS.get(activeReportJobId)?.running) {
    return { started: false, reason: "a report is already running" };
  }

  const job = { id: randomUUID(), target, running: true, step: "starting", started: Date.now(), result: null, error: null };
  REPORT_JOBS.set(job.id, job);
  activeReportJobId = job.id;
  lastReportJobId = job.id;
  if (idempotencyKey) IDEMPOTENCY.set(idempotencyKey, { jobId: job.id, created: Date.now() });
  const t0 = Date.now();
  runReport({ target, onStep: (step) => { job.step = step; } })
    .then((res) => {
      job.step = "saveReport";
      const saved = reportStore.save({
        ...res,
        sources: res.packet?.sources || res.sources || [],
        summary: res.angle || res.no_story || res.verdict?.us_read || "",
        status: res.ok ? "complete" : "attention"
      });
      job.step = "renderPdf";
      reportStore.createPdf(saved.id);
      job.result = saved;
      try {
        appendAudit({ actor: "manual", kind: "report", target: res.target, decision: res.ok ? "n/a" : "error", reason: res.errors.join(" | ") || null, output: { ok: res.ok, report_id: saved.id, chars: res.report_text.length, lint: res.lint ? res.lint.ok : null }, latency_ms: Date.now() - t0 });
      } catch {
        // The report and PDF are already durable. Audit-log availability must
        // not rewrite a successful job as a second failed report.
      }
    })
    .catch((err) => {
      job.error = "report generation or storage failed";
      job.result = { target, ok: false, status: "failed", errors: [job.error], report_text: "The report could not be completed or saved." };
      try {
        const savedFailure = reportStore.save(job.result);
        reportStore.createPdf(savedFailure.id);
        job.result = savedFailure;
      } catch {
        // Keep the failed job available in memory. A storage outage must never
        // become an unhandled rejection that takes down the workstation.
      }
      try { appendAudit({ actor: "manual", kind: "report", target, decision: "error", reason: err.message, latency_ms: Date.now() - t0 }); } catch { /* report state already carries the failure */ }
    })
    .finally(() => { job.running = false; job.step = "done"; if (activeReportJobId === job.id) activeReportJobId = null; });
  return { started: true, job };
}

const PUBLIC_DIR = resolve(ROOT, "public");
const CHALLENGE_PATH = resolve(ROOT, "db", "challenge.json");
const PORT = Number(process.env.PORT || 8137);
const MAX_BODY_BYTES = 32 * 1024;

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
};
const sendJSON = (res, code, obj) => { res.writeHead(code, { ...SECURITY_HEADERS, "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const send = (res, code, body, type = "text/plain") => { res.writeHead(code, { ...SECURITY_HEADERS, "content-type": type }); res.end(body); };
const methodNotAllowed = (res, allow) => {
  res.writeHead(405, { ...SECURITY_HEADERS, allow, "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: `method not allowed; use ${allow}` }));
};

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requireSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
  if (!allowed.has(origin)) throw httpError(403, "origin not allowed");
}

function reportTarget(value) {
  const target = String(value || "market").trim().toUpperCase();
  if (target === "MARKET") return "market";
  if (!/^[A-Z^][A-Z0-9.\-]{0,9}$/.test(target)) throw httpError(400, "target must be MARKET or a valid ticker");
  return target;
}

async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw httpError(413, "request body is too large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); }
  catch { throw httpError(400, "request body must be valid JSON"); }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === "/api/config") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return sendJSON(res, 200, { web_beta: false, invite_only: false });
    }
    if (path === "/api/health") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return sendJSON(res, 200, { ok: true, ...status() });
    }
    if (path === "/api/archive") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return send(res, 200, readFileSync(ARCHIVE_PATH, "utf8"), "application/json");
    }
    if (path === "/api/challenge") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return send(res, 200, existsSync(CHALLENGE_PATH) ? readFileSync(CHALLENGE_PATH, "utf8") : "[]", "application/json");
    }

    if (path === "/api/run") {
      if (req.method !== "POST") return methodNotAllowed(res, "POST");
      requireSameOrigin(req);
      const body = await readBody(req);
      const cmd = String(body.cmd || "run the market");
      const t0 = Date.now();
      const result = await runCommand(cmd, { mode: body.mode || "research" });
      appendAudit({ actor: "manual", kind: "run", target: cmd, output: { steps: result.steps?.length ?? 0 }, decision: "n/a", mode: body.mode || "research", latency_ms: Date.now() - t0 });
      return sendJSON(res, 200, result);
    }

    if (path === "/api/report") {
      if (req.method !== "POST") return methodNotAllowed(res, "POST");
      requireSameOrigin(req);
      const body = await readBody(req);
      const target = reportTarget(body.target);
      const started = startReport(target, { idempotencyKey: req.headers["idempotency-key"] || null });
      return sendJSON(res, 200, started.started ? { started: true, id: started.job.id, target, duplicate: Boolean(started.duplicate) } : { started: false, reason: started.reason });
    }
    if (path === "/api/report/status") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      const job = REPORT_JOBS.get(activeReportJobId || lastReportJobId);
      return sendJSON(res, 200, job ? { id: job.id, running: job.running, step: job.step, elapsed_ms: Date.now() - job.started, result: job.result?.result || job.result, report_id: job.result?.id || null } : { running: false, step: null, elapsed_ms: 0, result: null });
    }

    if (path === "/api/reports") {
      if (req.method === "GET") return sendJSON(res, 200, { reports: reportStore.list({ limit: Number(url.searchParams.get("limit") || 100), target: url.searchParams.get("target") || null }) });
      if (req.method === "POST") {
        requireSameOrigin(req);
        const body = await readBody(req);
        const target = reportTarget(body.target);
        const key = String(req.headers["idempotency-key"] || "").trim();
        if (key && (key.length < 8 || key.length > 128)) throw httpError(400, "idempotency key must be 8 to 128 characters");
        const started = startReport(target, { idempotencyKey: key || null });
        if (!started.started && !started.duplicate) return sendJSON(res, 409, { started: false, reason: started.reason });
        return sendJSON(res, started.duplicate ? 200 : 202, { started: true, duplicate: Boolean(started.duplicate), id: started.job.id, target });
      }
      return methodNotAllowed(res, "GET, POST");
    }

    const reportStatusMatch = path.match(/^\/api\/reports\/([a-zA-Z0-9-]+)\/status$/);
    if (reportStatusMatch) {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      const job = REPORT_JOBS.get(reportStatusMatch[1]);
      if (!job) return sendJSON(res, 404, { ok: false, error: "report job not found" });
      return sendJSON(res, 200, { id: job.id, running: job.running, step: job.step, elapsed_ms: Date.now() - job.started, result: job.result, report_id: job.result?.id || null, error: job.error });
    }

    const reportPdfMatch = path.match(/^\/api\/reports\/(rpt-[a-z0-9-]+)\/pdf$/);
    if (reportPdfMatch) {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      const pdf = reportStore.createPdf(reportPdfMatch[1]);
      if (!pdf) return sendJSON(res, 404, { ok: false, error: "report not found" });
      const report = reportStore.get(reportPdfMatch[1]);
      const filename = `The-Bench-${report.target}-${report.created_at.slice(0, 10)}.pdf`;
      const bytes = readFileSync(pdf.path);
      res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "application/pdf", "content-disposition": `attachment; filename="${filename}"`, "content-length": bytes.length });
      return res.end(bytes);
    }

    const reportMatch = path.match(/^\/api\/reports\/(rpt-[a-z0-9-]+)$/);
    if (reportMatch) {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      const report = reportStore.get(reportMatch[1]);
      return report ? sendJSON(res, 200, report) : sendJSON(res, 404, { ok: false, error: "report not found" });
    }

    if (path === "/api/audit") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return sendJSON(res, 200, { rows: readAudit({ limit: Number(url.searchParams.get("limit") || 100), kind: url.searchParams.get("kind") || null }) });
    }
    if (path === "/api/audit/verify") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return sendJSON(res, 200, verifyChain());
    }
    if (path === "/api/audit/export.csv") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return send(res, 200, exportCsv(url.searchParams.get("day")), "text/csv");
    }

    if (path === "/api/settings") {
      if (req.method === "POST") {
        requireSameOrigin(req);
        const body = await readBody(req);
        // Model API keys route to the LOCAL secrets file (never connections.json,
        // never committed). Only ANTHROPIC_API_KEY / OPENAI_API_KEY are accepted.
        if (body.secrets) {
          for (const [k, v] of Object.entries(body.secrets)) {
            if (k === "ANTHROPIC_API_KEY" || k === "OPENAI_API_KEY") setSecret(k, String(v || "").trim());
          }
          delete body.secrets;
        }
        writeConnections(body); // any secret-looking field here is still stripped
        return sendJSON(res, 200, { ok: true, status: status() });
      }
      if (req.method === "GET") return sendJSON(res, 200, status());
      return methodNotAllowed(res, "GET, POST");
    }

    // Static files from public/
    const file = path === "/" ? "/index.html" : path;
    const abs = resolve(PUBLIC_DIR, "." + file);
    if (!abs.startsWith(PUBLIC_DIR)) return send(res, 403, "forbidden");
    if (existsSync(abs)) return send(res, 200, readFileSync(abs), MIME[extname(abs)] || "application/octet-stream");
    return send(res, 404, "not found");
  } catch (err) {
    const statusCode = Number(err.statusCode) || 500;
    return sendJSON(res, statusCode, { ok: false, error: statusCode >= 500 ? "internal server error" : err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`THE BENCH backend on http://127.0.0.1:${PORT}`);
  console.log("  GET /api/health · /api/archive · /api/challenge · /api/settings");
  console.log("  POST /api/report · research and drafting only · no order route");
});
