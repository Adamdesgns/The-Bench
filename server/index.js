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
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { ROOT, ARCHIVE_PATH } from "./config.js";
import { runCommand } from "./api.js";
import { runReport } from "./reviewer.js";
import { status, writeConnections } from "./settings.js";
import { setSecret } from "./secrets.js";
import { appendAudit, readAudit, verifyChain, exportCsv } from "./audit.js";

// One report at a time; the UI polls /api/report/status while it runs.
const REPORT = { running: false, step: null, started: null, result: null };
function startReport(target) {
  if (REPORT.running) return false;
  REPORT.running = true; REPORT.step = "starting"; REPORT.started = Date.now(); REPORT.result = null;
  const t0 = Date.now();
  runReport({ target, onStep: (s) => { REPORT.step = s; } })
    .then((res) => {
      REPORT.result = res;
      appendAudit({ actor: "manual", kind: "report", target: res.target, decision: res.ok ? "n/a" : "error", reason: res.errors.join(" | ") || null, output: { ok: res.ok, chars: res.report_text.length, lint: res.lint ? res.lint.ok : null }, latency_ms: Date.now() - t0 });
    })
    .catch((err) => {
      REPORT.result = { ok: false, errors: ["run crashed: " + err.message], report_text: "Run crashed: " + err.message };
      appendAudit({ actor: "manual", kind: "report", target, decision: "error", reason: err.message, latency_ms: Date.now() - t0 });
    })
    .finally(() => { REPORT.running = false; REPORT.step = "done"; });
  return true;
}

const PUBLIC_DIR = resolve(ROOT, "public");
const CHALLENGE_PATH = resolve(ROOT, "db", "challenge.json");
const PORT = Number(process.env.PORT || 8137);

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

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

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { return {}; }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

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
      const body = await readBody(req);
      const cmd = String(body.cmd || "run the market");
      const t0 = Date.now();
      const result = await runCommand(cmd, { mode: body.mode || "research" });
      appendAudit({ actor: "manual", kind: "run", target: cmd, output: { steps: result.steps?.length ?? 0 }, decision: "n/a", mode: body.mode || "research", latency_ms: Date.now() - t0 });
      return sendJSON(res, 200, result);
    }

    if (path === "/api/report") {
      if (req.method !== "POST") return methodNotAllowed(res, "POST");
      const body = await readBody(req);
      const target = String(body.target || "market");
      const started = startReport(target);
      return sendJSON(res, 200, started ? { started: true, target } : { started: false, reason: "a report is already running" });
    }
    if (path === "/api/report/status") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return sendJSON(res, 200, { running: REPORT.running, step: REPORT.step, elapsed_ms: REPORT.started ? Date.now() - REPORT.started : 0, result: REPORT.result });
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
      return sendJSON(res, 200, status());
    }

    // Static files from public/
    const file = path === "/" ? "/index.html" : path;
    const abs = resolve(PUBLIC_DIR, "." + file);
    if (!abs.startsWith(PUBLIC_DIR)) return send(res, 403, "forbidden");
    if (existsSync(abs)) return send(res, 200, readFileSync(abs), MIME[extname(abs)] || "application/octet-stream");
    return send(res, 404, "not found");
  } catch (err) {
    return sendJSON(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`THE BENCH backend on http://127.0.0.1:${PORT}`);
  console.log("  GET /api/health · /api/archive · /api/challenge · /api/settings");
  console.log("  POST /api/report · research and drafting only · no order route");
});
