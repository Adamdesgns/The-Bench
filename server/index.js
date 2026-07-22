// index.js — minimal local backend. Serves the public/ dashboards and exposes
// two read endpoints. It can TRIGGER a run and return the draft, but it never
// posts anything anywhere. Publishing stays manual, by design.
//
//   GET /            -> public/index.html (or a directory listing if absent)
//   GET /api/archive -> db/archive.json
//   GET /api/run     -> runs the chain, returns the draft text (?mock=1 offline)
//
// Run: node server/index.js   (PORT env optional, default 8137)

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { ROOT, ARCHIVE_PATH } from "./config.js";
import { run } from "./reviewer.js";

const PUBLIC_DIR = resolve(ROOT, "public");
const PORT = Number(process.env.PORT || 8137);

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml"
};

function send(res, code, body, type = "text/plain") {
  res.writeHead(code, { "content-type": type });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === "/api/archive") {
      return send(res, 200, readFileSync(ARCHIVE_PATH, "utf8"), "application/json");
    }

    if (path === "/api/run") {
      const mock = url.searchParams.get("mock") === "1";
      const result = await run({ mock });
      return send(res, 200, result?.text || "no output", "text/plain");
    }

    // Static files from public/
    let file = path === "/" ? "/index.html" : path;
    const abs = resolve(PUBLIC_DIR, "." + file);
    if (!abs.startsWith(PUBLIC_DIR)) return send(res, 403, "forbidden");
    if (existsSync(abs)) {
      return send(res, 200, readFileSync(abs), MIME[extname(abs)] || "application/octet-stream");
    }
    return send(res, 404, "not found — add dashboards to public/ or hit /api/run");
  } catch (err) {
    return send(res, 500, "error: " + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`THE BENCH backend on http://localhost:${PORT}`);
  console.log(`  /api/run?mock=1  — offline chain test`);
  console.log(`  /api/archive     — the book`);
  console.log("  (drafts only — never posts)");
});
