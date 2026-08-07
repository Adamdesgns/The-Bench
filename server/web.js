// web.js - hosted, invite-only API and static shell for The Bench beta.
// This is intentionally separate from index.js so Electron remains local-only.

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { ROOT } from "./config.js";
import { createWebBetaAuth } from "./webBeta.js";
import { createCloudReports } from "./cloudReports.js";

const PORT = Number(process.env.PORT || 8138);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY_BYTES = 32 * 1024;
const PUBLIC_DIR = resolve(ROOT, "public");
const auth = createWebBetaAuth();
if (!auth.enabled) throw new Error("Set BENCH_WEB_BETA=1 to start the hosted beta server");
const reports = createCloudReports({ auth });
const stopWorker = reports.startWorker();

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", ...extra });
  res.end(JSON.stringify(body));
}

function send(res, status, body, type = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": type, ...extra });
  res.end(body);
}

function methodNotAllowed(res, allow) {
  sendJson(res, 405, { ok: false, error: `method not allowed; use ${allow}` }, { allow });
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function requireOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || origin !== auth.appOrigin) throw httpError(403, "origin not allowed");
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

async function requireUser(req, res) {
  const session = await auth.sessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "sign in required" }, { "set-cookie": auth.clearCookies() });
    return null;
  }
  if (session.cookies) res.setHeader("set-cookie", session.cookies);
  return session;
}

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, auth.appOrigin);
    const path = url.pathname;

    if (path === "/api/config") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return sendJson(res, 200, auth.publicConfig());
    }

    if (path === "/api/auth/request-link") {
      if (req.method !== "POST") return methodNotAllowed(res, "POST");
      requireOrigin(req);
      const body = await readBody(req);
      await auth.requestSignInLink(body.email);
      return sendJson(res, 200, { ok: true, message: "If this address is invited, a sign-in link is on the way." });
    }

    if (path === "/api/auth/session") {
      if (req.method !== "POST") return methodNotAllowed(res, "POST");
      requireOrigin(req);
      const session = await auth.adoptSession(await readBody(req));
      return sendJson(res, 200, { ok: true, user: { id: session.user.id, email: session.user.email } }, { "set-cookie": session.cookies });
    }

    if (path === "/api/auth/me") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      const session = await requireUser(req, res);
      if (!session) return;
      return sendJson(res, 200, { user: { id: session.user.id, email: session.user.email }, daily_report_limit: session.membership.daily_report_limit || auth.dailyLimit });
    }

    if (path === "/api/auth/logout") {
      if (req.method !== "POST") return methodNotAllowed(res, "POST");
      requireOrigin(req);
      return sendJson(res, 200, { ok: true }, { "set-cookie": auth.clearCookies() });
    }

    const session = path.startsWith("/api/") ? await requireUser(req, res) : null;
    if (path.startsWith("/api/") && !session) return;

    if (path === "/api/health") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return sendJson(res, 200, { ok: true, web_beta: true, mode: "research-only", user: session.user.email });
    }

    if (path === "/api/reports") {
      if (req.method === "GET") return sendJson(res, 200, { reports: await reports.list({ accessToken: session.accessToken, limit: url.searchParams.get("limit") }) });
      if (req.method === "POST") {
        requireOrigin(req);
        const body = await readBody(req);
        const job = await reports.enqueue({ accessToken: session.accessToken, target: body.target, idempotencyKey: req.headers["idempotency-key"] });
        const duplicate = job.created === false;
        return sendJson(res, duplicate ? 200 : 202, { started: true, duplicate, id: job.id, target: job.target });
      }
      return methodNotAllowed(res, "GET, POST");
    }

    const statusMatch = path.match(/^\/api\/reports\/([0-9a-f-]{36})\/status$/i);
    if (statusMatch) {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      const job = await reports.jobStatus({ accessToken: session.accessToken, id: statusMatch[1] });
      return job ? sendJson(res, 200, job) : sendJson(res, 404, { ok: false, error: "report job not found" });
    }

    const pdfMatch = path.match(/^\/api\/reports\/([0-9a-f-]{36})\/pdf$/i);
    if (pdfMatch) {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      const signed = await reports.signedPdf({ accessToken: session.accessToken, id: pdfMatch[1] });
      if (!signed) return sendJson(res, 404, { ok: false, error: "PDF not found" });
      res.writeHead(302, { ...SECURITY_HEADERS, location: signed, "cache-control": "private, no-store" });
      return res.end();
    }

    const reportMatch = path.match(/^\/api\/reports\/([0-9a-f-]{36})$/i);
    if (reportMatch) {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      const report = await reports.get({ accessToken: session.accessToken, id: reportMatch[1] });
      return report ? sendJson(res, 200, report) : sendJson(res, 404, { ok: false, error: "report not found" });
    }

    if (path.startsWith("/api/")) return sendJson(res, 404, { ok: false, error: "not found" });

    const allowedStatic = new Set(["/", "/index.html", "/app.js", "/styles.css"]);
    if (!allowedStatic.has(path)) return send(res, 404, "not found");
    const file = path === "/" ? "/index.html" : path;
    const absolute = resolve(PUBLIC_DIR, `.${file}`);
    if (!absolute.startsWith(PUBLIC_DIR)) return send(res, 403, "forbidden");
    if (!existsSync(absolute)) return send(res, 404, "not found");
    return send(res, 200, readFileSync(absolute), MIME[extname(absolute)] || "application/octet-stream");
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    return sendJson(res, status, { ok: false, error: status >= 500 ? "internal server error" : error.message });
  }
});

server.listen(PORT, HOST, () => console.log(`THE BENCH web beta on ${auth.appOrigin} (${HOST}:${PORT})`));

function shutdown() {
  stopWorker();
  server.close(() => process.exit(0));
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);