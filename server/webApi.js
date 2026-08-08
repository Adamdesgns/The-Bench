// webApi.js - shared invite-only API handler for Node and Netlify runtimes.

const MAX_BODY_BYTES = 32 * 1024;

export const WEB_SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

function headers(extra = {}) {
  const result = new Headers(WEB_SECURITY_HEADERS);
  for (const [name, value] of Object.entries(extra)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item));
    else if (value !== undefined && value !== null) result.set(name, String(value));
  }
  return result;
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers({ "content-type": "application/json; charset=utf-8", ...extra }),
  });
}

function methodNotAllowed(allow) {
  return json(405, { ok: false, error: `method not allowed; use ${allow}` }, { allow });
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function requireOrigin(request, appOrigin) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== appOrigin) throw httpError(403, "origin not allowed");
}

async function readBody(request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw httpError(413, "request body is too large");
  try { return JSON.parse(text || "{}"); }
  catch { throw httpError(400, "request body must be valid JSON"); }
}

function authRequest(request) {
  return { headers: { cookie: request.headers.get("cookie") || "" } };
}

export function createWebApi({ auth, reports, dispatchReport = null } = {}) {
  if (!auth?.enabled) throw new Error("web beta auth is required");
  if (!reports) throw new Error("cloud reports service is required");

  async function requireUser(request) {
    const session = await auth.sessionFromRequest(authRequest(request));
    if (!session) return { response: json(401, { ok: false, error: "sign in required" }, { "set-cookie": auth.clearCookies() }) };
    return { session, cookies: session.cookies || null };
  }

  return async function webApi(request) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/api/config") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return json(200, auth.publicConfig());
      }

      if (path === "/api/auth/request-link") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireOrigin(request, auth.appOrigin);
        const body = await readBody(request);
        await auth.requestSignInLink(body.email);
        return json(200, { ok: true, message: "If this address is invited, a sign-in link is on the way." });
      }

      if (path === "/api/auth/session") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireOrigin(request, auth.appOrigin);
        const session = await auth.adoptSession(await readBody(request));
        return json(200, { ok: true, user: { id: session.user.id, email: session.user.email } }, { "set-cookie": session.cookies });
      }

      if (path === "/api/auth/logout") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        requireOrigin(request, auth.appOrigin);
        return json(200, { ok: true }, { "set-cookie": auth.clearCookies() });
      }

      if (!path.startsWith("/api/")) return json(404, { ok: false, error: "not found" });

      const authorized = await requireUser(request);
      if (authorized.response) return authorized.response;
      const { session, cookies } = authorized;
      const cookieHeaders = cookies ? { "set-cookie": cookies } : {};

      if (path === "/api/auth/me") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return json(200, { user: { id: session.user.id, email: session.user.email }, daily_report_limit: session.membership.daily_report_limit || auth.dailyLimit }, cookieHeaders);
      }

      if (path === "/api/health") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return json(200, { ok: true, web_beta: true, mode: "research-only", user: session.user.email }, cookieHeaders);
      }

      if (path === "/api/reports") {
        if (request.method === "GET") return json(200, { reports: await reports.list({ accessToken: session.accessToken, limit: url.searchParams.get("limit") }) }, cookieHeaders);
        if (request.method === "POST") {
          requireOrigin(request, auth.appOrigin);
          const body = await readBody(request);
          const job = await reports.enqueue({ accessToken: session.accessToken, target: body.target, idempotencyKey: request.headers.get("idempotency-key") });
          const duplicate = job.created === false;
          if (dispatchReport) await dispatchReport({ id: job.id, target: job.target, duplicate });
          return json(duplicate ? 200 : 202, { started: true, duplicate, id: job.id, target: job.target }, cookieHeaders);
        }
        return methodNotAllowed("GET, POST");
      }

      const statusMatch = path.match(/^\/api\/reports\/([0-9a-f-]{36})\/status$/i);
      if (statusMatch) {
        if (request.method !== "GET") return methodNotAllowed("GET");
        const job = await reports.jobStatus({ accessToken: session.accessToken, id: statusMatch[1] });
        return job ? json(200, job, cookieHeaders) : json(404, { ok: false, error: "report job not found" }, cookieHeaders);
      }

      const pdfMatch = path.match(/^\/api\/reports\/([0-9a-f-]{36})\/pdf$/i);
      if (pdfMatch) {
        if (request.method !== "GET") return methodNotAllowed("GET");
        const signed = await reports.signedPdf({ accessToken: session.accessToken, id: pdfMatch[1] });
        if (!signed) return json(404, { ok: false, error: "PDF not found" }, cookieHeaders);
        return new Response(null, { status: 302, headers: headers({ ...cookieHeaders, location: signed, "cache-control": "private, no-store" }) });
      }

      const reportMatch = path.match(/^\/api\/reports\/([0-9a-f-]{36})$/i);
      if (reportMatch) {
        if (request.method !== "GET") return methodNotAllowed("GET");
        const report = await reports.get({ accessToken: session.accessToken, id: reportMatch[1] });
        return report ? json(200, report, cookieHeaders) : json(404, { ok: false, error: "report not found" }, cookieHeaders);
      }

      return json(404, { ok: false, error: "not found" }, cookieHeaders);
    } catch (error) {
      const status = Number(error.statusCode) || 500;
      return json(status, { ok: false, error: status >= 500 ? "internal server error" : error.message });
    }
  };
}
