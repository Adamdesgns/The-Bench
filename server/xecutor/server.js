import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClientRegistry, OwnerRegistry } from "./auth.js";
import { safeEqual, sha256 } from "./canonical.js";
import { handleMcpMessage } from "./mcp-tools.js";
import { XecutorError, XecutorService } from "./service.js";
import { XecutorStore } from "./store.js";
import { isLoopbackHost, xecutorDataDir } from "./runtime.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, "../../public/xecutor");
const MAX_BODY_BYTES = 64 * 1024;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

function securityHeaders(type = "application/json; charset=utf-8") {
  return {
    "content-type": type,
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function sendJson(res, status, value, extraHeaders = {}) {
  res.writeHead(status, { ...securityHeaders(), ...extraHeaders });
  res.end(JSON.stringify(value));
}

function sendText(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, securityHeaders(type));
  res.end(body);
}

async function readJson(req) {
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new XecutorError("CONTENT_TYPE_REQUIRED", "application/json is required", 415);
  }
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX_BODY_BYTES) throw new XecutorError("BODY_TOO_LARGE", "request body exceeds 64 KiB", 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new XecutorError("BODY_TOO_LARGE", "request body exceeds 64 KiB", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new XecutorError("JSON_INVALID", "request body is not valid JSON", 400); }
}

function publicHost(req, port) {
  const host = String(req.headers.host || "");
  const expected = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  return expected.has(host) ? host : null;
}

export function createXecutorServer({
  dataDir = xecutorDataDir(),
  host = process.env.XECUTOR_HOST || "127.0.0.1",
  port = Number(process.env.XECUTOR_PORT || 8140),
  clock = () => new Date(),
} = {}) {
  if (!isLoopbackHost(host)) throw new Error("The Xecutor Stage 1 is loopback-only; non-loopback binding is not implemented");
  const store = new XecutorStore(dataDir, { clock, processLock: true });
  let service;
  let clients;
  let owner;
  try {
    service = new XecutorService(store, { clock });
    clients = new ClientRegistry(dataDir);
    owner = new OwnerRegistry(dataDir);
  } catch (error) {
    store.releaseProcessLock({ silent: true });
    throw error;
  }
  const csrf = randomBytes(24).toString("base64url");
  let boundPort = port;
  let ownerSession = null;
  let failedOwnerLogins = [];

  const server = createServer(async (req, res) => {
    try {
      const hostHeader = publicHost(req, boundPort);
      if (!hostHeader && isLoopbackHost(host)) return sendJson(res, 421, { ok: false, code: "HOST_REJECTED", error: "untrusted Host header" });
      const url = new URL(req.url, `http://${hostHeader || `${host}:${port}`}`);
      const path = url.pathname;

      const ownerAuthenticated = () => {
        const raw = String(req.headers["x-xecutor-owner"] || "");
        if (!raw || !ownerSession || ownerSession.expires_at <= Date.now()) return false;
        return safeEqual(ownerSession.token_sha256, sha256(raw));
      };

      const requireLoopback = () => {
        if (!hostHeader) throw new XecutorError("OWNER_LOOPBACK_REQUIRED", "owner data is available only from the loopback The Xecutor window", 403);
      };

      const requireOwnerAuth = () => {
        requireLoopback();
        if (!ownerAuthenticated()) throw new XecutorError("OWNER_AUTH_REQUIRED", "enter the owner approval code", 401);
      };

      const requireOwnerMutation = () => {
        if (req.method !== "POST") throw new XecutorError("METHOD_NOT_ALLOWED", "owner mutations require POST", 405);
        requireOwnerAuth();
        const origin = String(req.headers.origin || "");
        if (origin !== `http://${hostHeader}`) throw new XecutorError("ORIGIN_REJECTED", "owner action requires the local The Xecutor origin", 403);
        if (!safeEqual(req.headers["x-xecutor-csrf"] || "", csrf)) throw new XecutorError("CSRF_REJECTED", "owner session proof is missing or stale", 403);
      };

      const requireOwnerRead = () => {
        requireOwnerAuth();
      };

      const requireBot = () => {
        const clientId = clients.authenticate(req.headers.authorization);
        if (!clientId) throw new XecutorError("BOT_UNAUTHORIZED", clients.configured() ? "invalid bot credential" : "bot credentials are not configured; run npm run xecutor:setup", 401);
        return clientId;
      };

      if (req.method === "GET" && path === "/api/health") {
        return sendJson(res, 200, { ok: true, name: "The Xecutor", mode: "SIMULATION_ONLY", live_execution: false });
      }
      if (req.method === "GET" && path === "/api/owner/status") {
        requireLoopback();
        return sendJson(res, 200, { ok: true, configured: owner.configured(), authenticated: ownerAuthenticated(), session_expires_at: ownerAuthenticated() ? new Date(ownerSession.expires_at).toISOString() : null });
      }
      if (path === "/api/owner/login" && req.method === "POST") {
        requireLoopback();
        const origin = String(req.headers.origin || "");
        if (origin !== `http://${hostHeader}`) throw new XecutorError("ORIGIN_REJECTED", "owner login requires the local The Xecutor origin", 403);
        if (!owner.configured()) throw new XecutorError("OWNER_SETUP_REQUIRED", "run npm run xecutor:setup before opening the owner desk", 428);
        const now = Date.now();
        failedOwnerLogins = failedOwnerLogins.filter((time) => now - time < 5 * 60 * 1000);
        if (failedOwnerLogins.length >= 5) throw new XecutorError("OWNER_LOGIN_THROTTLED", "too many failed owner-code attempts; wait five minutes", 429);
        const body = await readJson(req);
        if (!owner.verify(body.code)) {
          failedOwnerLogins.push(now);
          throw new XecutorError("OWNER_CODE_INVALID", "owner approval code was not accepted", 401);
        }
        failedOwnerLogins = [];
        const rawToken = randomBytes(32).toString("base64url");
        ownerSession = { token_sha256: sha256(rawToken), expires_at: now + 15 * 60 * 1000 };
        return sendJson(res, 200, {
          ok: true,
          authenticated: true,
          owner_session: rawToken,
          session_expires_at: new Date(ownerSession.expires_at).toISOString(),
        });
      }
      if (req.method === "GET" && path === "/api/session") {
        requireOwnerRead();
        return sendJson(res, 200, {
          ok: true,
          csrf,
          gateway: { ...service.gatewayStatus(), clients_configured: clients.configured() },
          proposals: service.listProposals({ includeConfirmation: true }),
          audit: service.audit({ limit: 80 }),
        });
      }
      if (req.method === "GET" && path === "/api/proposals") {
        requireOwnerRead();
        return sendJson(res, 200, { ok: true, proposals: service.listProposals({ includeConfirmation: true }) });
      }
      if (req.method === "GET" && path === "/api/audit") {
        requireOwnerRead();
        return sendJson(res, 200, { ok: true, audit: service.audit({ proposalId: url.searchParams.get("proposal_id") || null, limit: url.searchParams.get("limit") || 200 }), integrity: store.verifyAudit() });
      }
      const ownerProposal = /^\/api\/proposals\/(XEC-[A-F0-9]{16})$/.exec(path);
      if (req.method === "GET" && ownerProposal) {
        requireOwnerRead();
        return sendJson(res, 200, { ok: true, proposal: service.getProposal(ownerProposal[1], { includeConfirmation: true }) });
      }
      if (path === "/api/demo") {
        requireOwnerMutation();
        await readJson(req);
        return sendJson(res, 201, { ok: true, ...(await service.createDemoProposal()) });
      }
      if (path === "/api/kill-switch") {
        requireOwnerMutation();
        const body = await readJson(req);
        return sendJson(res, 200, { ok: true, gateway: await service.setKillSwitch(body.enabled) });
      }
      if (path === "/api/owner/logout") {
        requireOwnerMutation();
        await readJson(req);
        ownerSession = null;
        return sendJson(res, 200, { ok: true });
      }
      const ownerAction = /^\/api\/proposals\/(XEC-[A-F0-9]{16})\/(approve|reject)$/.exec(path);
      if (ownerAction) {
        requireOwnerMutation();
        const body = await readJson(req);
        const proposal = ownerAction[2] === "approve"
          ? await service.approve(ownerAction[1], { confirmation: body.confirmation })
          : await service.reject(ownerAction[1], { reason: body.reason });
        return sendJson(res, 200, { ok: true, proposal });
      }

      if (path === "/api/bot/proposals" && req.method === "POST") {
        const sourceClient = requireBot();
        const body = await readJson(req);
        return sendJson(res, 201, { ok: true, ...(await service.createProposal({ sourceClient, clientSubmissionId: body.client_submission_id, handoff: body.handoff })) });
      }
      const botProposal = /^\/api\/bot\/proposals\/(XEC-[A-F0-9]{16})$/.exec(path);
      if (botProposal && req.method === "GET") {
        const sourceClient = requireBot();
        return sendJson(res, 200, { ok: true, proposal: service.getProposal(botProposal[1], { sourceClient, includeConfirmation: false }) });
      }
      const botWithdraw = /^\/api\/bot\/proposals\/(XEC-[A-F0-9]{16})\/withdraw$/.exec(path);
      if (botWithdraw && req.method === "POST") {
        const sourceClient = requireBot();
        const body = await readJson(req);
        return sendJson(res, 200, { ok: true, proposal: await service.withdraw(botWithdraw[1], { sourceClient, reason: body.reason }) });
      }

      if (path === "/mcp" && req.method === "POST") {
        const sourceClient = requireBot();
        const message = await readJson(req);
        const reply = await handleMcpMessage(service, sourceClient, message);
        if (reply === null) { res.writeHead(202, securityHeaders("application/json; charset=utf-8")); return res.end(); }
        return sendJson(res, 200, reply);
      }

      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", error: "method not allowed" });
      requireLoopback();
      const file = path === "/" ? "index.html" : path.slice(1);
      const target = resolve(PUBLIC_DIR, file);
      if (!target.startsWith(PUBLIC_DIR) || !existsSync(target)) return sendJson(res, 404, { ok: false, code: "NOT_FOUND", error: "not found" });
      return sendText(res, 200, readFileSync(target), MIME[extname(target)] || "application/octet-stream");
    } catch (error) {
      const status = error instanceof XecutorError ? error.status : 500;
      const code = error instanceof XecutorError ? error.code : "INTERNAL_ERROR";
      const message = error instanceof XecutorError ? error.message : "The Xecutor failed closed. Check the local console.";
      if (status >= 500) {
        const diagnostic = error instanceof Error ? (error.stack || error.message) : String(error);
        process.stderr.write(`[The Xecutor] ${code}: ${diagnostic}\n`);
      }
      if (!res.headersSent) return sendJson(res, status, { ok: false, code, error: message });
      res.end();
    }
  });

  const close = async () => {
    try {
      if (server.listening) {
        await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      }
    } finally {
      store.releaseProcessLock();
    }
  };

  return {
    server,
    service,
    store,
    clients,
    host,
    get port() { return boundPort; },
    listen: () => new Promise((resolveListen, reject) => {
      const onError = (error) => {
        store.releaseProcessLock({ silent: true });
        reject(error);
      };
      server.once("error", onError);
      server.listen(port, host, () => {
        server.off("error", onError);
        boundPort = Number(server.address()?.port || port);
        resolveListen(server.address());
      });
    }),
    close,
  };
}
