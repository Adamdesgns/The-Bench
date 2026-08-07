// webBeta.js - invite-only Supabase Auth boundary for the hosted beta.
// The browser never receives the service-role key or model credentials.

const ACCESS_COOKIE = "bench_access";
const REFRESH_COOKIE = "bench_refresh";

function required(value, name) {
  const clean = String(value || "").trim();
  if (!clean) throw new Error(`${name} is required when BENCH_WEB_BETA=1`);
  return clean;
}

function parseCookies(header = "") {
  return Object.fromEntries(String(header).split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const at = part.indexOf("=");
    const key = at < 0 ? part : part.slice(0, at);
    const value = at < 0 ? "" : part.slice(at + 1);
    try { return [key, decodeURIComponent(value)]; } catch { return [key, value]; }
  }));
}

function safeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("enter a valid invited email"), { statusCode: 400 });
  return email;
}

async function jsonResponse(response, fallback) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(fallback), { statusCode: response.status >= 500 ? 502 : response.status, detail: body });
  return body;
}

export function createWebBetaAuth({ env = process.env, fetchImpl = fetch } = {}) {
  const enabled = String(env.BENCH_WEB_BETA || "") === "1";
  if (!enabled) return Object.freeze({ enabled: false });

  const supabaseUrl = required(env.SUPABASE_URL, "SUPABASE_URL").replace(/\/$/, "");
  const publishableKey = required(env.SUPABASE_PUBLISHABLE_KEY, "SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = required(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
  const appOrigin = required(env.APP_ORIGIN, "APP_ORIGIN").replace(/\/$/, "");
  let originUrl;
  try { originUrl = new URL(appOrigin); } catch { throw new Error("APP_ORIGIN must be an absolute URL"); }
  const localOrigin = ["localhost", "127.0.0.1", "::1"].includes(originUrl.hostname);
  const secure = originUrl.protocol === "https:";
  if (!secure && !localOrigin) throw new Error("APP_ORIGIN must use HTTPS outside local development");
  const dailyLimit = Math.max(1, Math.min(Number(env.BETA_DAILY_REPORT_LIMIT || 3), 20));

  async function authFetch(path, { method = "GET", token = publishableKey, body } = {}) {
    const response = await fetchImpl(`${supabaseUrl}${path}`, {
      method,
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return jsonResponse(response, "authentication service unavailable");
  }

  async function serviceRows(path) {
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/${path}`, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    return jsonResponse(response, "membership service unavailable");
  }

  async function activeMembership({ id, email }) {
    const rows = await serviceRows(`bench_beta_invites?select=user_id,email,status,daily_report_limit,expires_at&user_id=eq.${encodeURIComponent(id)}&email=eq.${encodeURIComponent(String(email || "").toLowerCase())}&limit=1`);
    const member = rows?.[0] || null;
    if (!member || member.status !== "active") return null;
    if (member.expires_at && new Date(member.expires_at).getTime() <= Date.now()) return null;
    return member;
  }

  async function verifyAccess(accessToken) {
    if (!accessToken) return null;
    const user = await authFetch("/auth/v1/user", { token: accessToken }).catch(() => null);
    if (!user?.id || !user?.email || user.app_metadata?.bench_beta !== "invited") return null;
    const membership = await activeMembership(user);
    return membership ? { user, membership, accessToken } : null;
  }

  function sessionCookies(session) {
    const suffix = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
    const accessAge = Math.max(60, Number(session.expires_in || 3600));
    return [
      `${ACCESS_COOKIE}=${encodeURIComponent(session.access_token)}; ${suffix}; Max-Age=${accessAge}`,
      `${REFRESH_COOKIE}=${encodeURIComponent(session.refresh_token)}; ${suffix}; Max-Age=2592000`,
    ];
  }

  function clearCookies() {
    const suffix = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=0`;
    return [`${ACCESS_COOKIE}=; ${suffix}`, `${REFRESH_COOKIE}=; ${suffix}`];
  }

  async function refresh(refreshToken) {
    if (!refreshToken) return null;
    const session = await authFetch("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refreshToken } }).catch(() => null);
    if (!session?.access_token || !session?.refresh_token) return null;
    const verified = await verifyAccess(session.access_token);
    return verified ? { ...verified, cookies: sessionCookies(session) } : null;
  }

  async function sessionFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    const current = await verifyAccess(cookies[ACCESS_COOKIE]);
    if (current) return current;
    return refresh(cookies[REFRESH_COOKIE]);
  }

  async function adoptSession({ access_token, refresh_token }) {
    if (!access_token || !refresh_token || String(access_token).length > 8192 || String(refresh_token).length > 8192) {
      throw Object.assign(new Error("invalid session payload"), { statusCode: 400 });
    }
    const verified = await verifyAccess(String(access_token));
    if (!verified) throw Object.assign(new Error("this account is not active in The Bench beta"), { statusCode: 403 });
    return { ...verified, cookies: sessionCookies({ access_token, refresh_token }) };
  }

  async function requestSignInLink(value) {
    const email = safeEmail(value);
    const rows = await serviceRows(`bench_beta_invites?select=user_id,status,expires_at&email=eq.${encodeURIComponent(email)}&limit=1`);
    const invite = rows?.[0];
    if (!invite || invite.status !== "active" || (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now())) {
      return { ok: true }; // Never reveal whether an address is invited.
    }
    await authFetch(`/auth/v1/otp?redirect_to=${encodeURIComponent(appOrigin)}`, {
      method: "POST",
      body: { email, create_user: false },
    });
    return { ok: true };
  }

  return Object.freeze({
    enabled: true,
    appOrigin,
    supabaseUrl,
    publishableKey,
    serviceKey,
    dailyLimit,
    publicConfig: () => ({ web_beta: true, invite_only: true, daily_report_limit: dailyLimit }),
    sessionFromRequest,
    adoptSession,
    requestSignInLink,
    clearCookies,
  });
}

export const __webBetaInternals = { parseCookies, safeEmail };