// index.js — local backend for THE BENCH app. Serves public/ and exposes the
// API the Bench OS front-end calls. It runs the analysis chain and reads/writes
// the NON-SECRET connection config. It never stores keys and never posts.
//
//   GET  /               -> public/index.html (Bench OS)
//   GET  /api/health     -> up + connection status (booleans only)
//   GET  /api/archive    -> db/archive.json
//   GET  /api/run?cmd=   -> runs the analysis command, returns step log JSON
//   GET  /api/settings   -> connection status (no secrets)
//   POST /api/settings   -> merge non-secret connection config (secrets stripped)
//
// Run: node server/index.js   (PORT env optional, default 8137)

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { ROOT, ARCHIVE_PATH } from "./config.js";
import { runCommand } from "./api.js";
import { status, writeConnections } from "./settings.js";
import { appendAudit, readAudit, verifyChain, exportCsv } from "./audit.js";

const PUBLIC_DIR = resolve(ROOT, "public");
const PORT = Number(process.env.PORT || 8137);

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

const sendJSON = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(obj)); };
const send = (res, code, body, type = "text/plain") => { res.writeHead(code, { "content-type": type, "access-control-allow-origin": "*" }); res.end(body); };

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { return {}; }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === "/api/health") return sendJSON(res, 200, { ok: true, ...status() });
    if (path === "/api/archive") return send(res, 200, readFileSync(ARCHIVE_PATH, "utf8"), "application/json");

    if (path === "/api/run") {
      const cmd = url.searchParams.get("cmd") || "run the market";
      const t0 = Date.now();
      const result = await runCommand(cmd, { mode: url.searchParams.get("mode") });
      appendAudit({ actor: "manual", kind: "run", target: cmd, output: { steps: result.steps?.length ?? 0 }, decision: "n/a", mode: url.searchParams.get("mode"), latency_ms: Date.now() - t0 });
      return sendJSON(res, 200, result);
    }

    if (path === "/api/audit") {
      return sendJSON(res, 200, { rows: readAudit({ limit: Number(url.searchParams.get("limit") || 100), kind: url.searchParams.get("kind") || null }) });
    }
    if (path === "/api/audit/verify") return sendJSON(res, 200, verifyChain());
    if (path === "/api/audit/export.csv") return send(res, 200, exportCsv(url.searchParams.get("day")), "text/csv");

    if (path === "/api/settings") {
      if (req.method === "POST") {
        writeConnections(await readBody(req)); // secrets stripped inside
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

server.listen(PORT, () => {
  console.log(`THE BENCH backend on http://localhost:${PORT}`);
  console.log("  GET /api/health · /api/run?cmd= · /api/settings · /api/archive");
  console.log("  No keys stored. Analysis only. Buys route through the Robinhood MCP (separate, gated).");
});
