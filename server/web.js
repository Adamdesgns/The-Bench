// web.js - persistent Node host for the invite-only beta.
// Netlify uses the same API handler but dispatches one background worker per job.

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { ROOT } from "./config.js";
import { createWebBetaAuth } from "./webBeta.js";
import { createCloudReports } from "./cloudReports.js";
import { createWebApi, WEB_SECURITY_HEADERS } from "./webApi.js";

const PORT = Number(process.env.PORT || 8138);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY_BYTES = 32 * 1024;
const PUBLIC_DIR = resolve(ROOT, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

const auth = createWebBetaAuth();
if (!auth.enabled) throw new Error("Set BENCH_WEB_BETA=1 to start the hosted beta server");
const reports = createCloudReports({ auth });
const stopWorker = reports.startWorker();
const handleApi = createWebApi({ auth, reports });

function nodeHeaders(source) {
  const result = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item));
    else if (value !== undefined) result.set(name, String(value));
  }
  return result;
}

async function requestBody(req) {
  if (["GET", "HEAD"].includes(req.method)) return undefined;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error("request body is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function webRequest(req) {
  return new Request(new URL(req.url, auth.appOrigin), {
    method: req.method,
    headers: nodeHeaders(req.headers),
    body: await requestBody(req),
  });
}

async function sendResponse(res, response) {
  const outgoing = {};
  for (const [name, value] of response.headers) if (name !== "set-cookie") outgoing[name] = value;
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) outgoing["set-cookie"] = cookies;
  const body = Buffer.from(await response.arrayBuffer());
  outgoing["content-length"] = body.length;
  res.writeHead(response.status, outgoing);
  res.end(body);
}

function sendStatic(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { ...WEB_SECURITY_HEADERS, "content-type": type });
  res.end(body);
}

export const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, auth.appOrigin).pathname;
    if (path.startsWith("/api/")) return sendResponse(res, await handleApi(await webRequest(req)));

    const allowedStatic = new Set(["/", "/index.html", "/app.js", "/styles.css"]);
    if (!allowedStatic.has(path)) return sendStatic(res, 404, "not found");
    const file = path === "/" ? "/index.html" : path;
    const absolute = resolve(PUBLIC_DIR, `.${file}`);
    if (!absolute.startsWith(PUBLIC_DIR)) return sendStatic(res, 403, "forbidden");
    if (!existsSync(absolute)) return sendStatic(res, 404, "not found");
    return sendStatic(res, 200, readFileSync(absolute), MIME[extname(absolute)] || "application/octet-stream");
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    return sendStatic(res, status, JSON.stringify({ ok: false, error: status >= 500 ? "internal server error" : error.message }), "application/json; charset=utf-8");
  }
});

server.listen(PORT, HOST, () => console.log(`THE BENCH web beta on ${auth.appOrigin} (${HOST}:${PORT})`));

function shutdown() {
  stopWorker();
  server.close(() => process.exit(0));
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
