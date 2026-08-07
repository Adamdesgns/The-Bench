import test from "node:test";
import assert from "node:assert/strict";
import { createWebBetaAuth, __webBetaInternals } from "./webBeta.js";

const env = {
  BENCH_WEB_BETA: "1",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret-test",
  APP_ORIGIN: "https://bench.example.com",
  BETA_DAILY_REPORT_LIMIT: "3",
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("disabled web beta needs no Supabase secrets", () => {
  assert.equal(createWebBetaAuth({ env: {} }).enabled, false);
});

test("remote web beta origins must use HTTPS", () => {
  assert.throws(() => createWebBetaAuth({ env: { ...env, APP_ORIGIN: "http://bench.example.com" } }), /must use HTTPS/);
  assert.equal(createWebBetaAuth({ env: { ...env, APP_ORIGIN: "http://127.0.0.1:8138" } }).enabled, true);
});
test("cookie parser keeps opaque token values intact", () => {
  assert.deepEqual(__webBetaInternals.parseCookies("bench_access=a.b.c; bench_refresh=r%2F1"), { bench_access: "a.b.c", bench_refresh: "r/1" });
});

test("uninvited sign-in requests are indistinguishable and do not call Auth", async () => {
  const calls = [];
  const auth = createWebBetaAuth({ env, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json([]);
  } });
  assert.deepEqual(await auth.requestSignInLink("nobody@example.com"), { ok: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /bench_beta_invites/);
  assert.equal(calls[0].options.headers.authorization, "Bearer service-secret-test");
});

test("an active invited address receives an Auth OTP request without signup", async () => {
  const calls = [];
  const auth = createWebBetaAuth({ env, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.includes("bench_beta_invites")) return json([{ user_id: "u1", status: "active", expires_at: null }]);
    return json({});
  } });
  await auth.requestSignInLink("USER@example.com");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /auth\/v1\/otp/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { email: "user@example.com", create_user: false });
  assert.equal(calls[1].options.headers.authorization, "Bearer sb_publishable_test");
});

test("session adoption verifies Auth and active beta membership before setting HttpOnly cookies", async () => {
  const auth = createWebBetaAuth({ env, fetchImpl: async (url, options) => {
    if (url.endsWith("/auth/v1/user")) {
      assert.equal(options.headers.authorization, "Bearer access-token");
      return json({ id: "11111111-1111-1111-1111-111111111111", email: "user@example.com", app_metadata: { bench_beta: "invited" } });
    }
    if (url.includes("bench_beta_invites")) return json([{ user_id: "11111111-1111-1111-1111-111111111111", email: "user@example.com", status: "active", daily_report_limit: 3 }]);
    throw new Error(`unexpected URL ${url}`);
  } });
  const session = await auth.adoptSession({ access_token: "access-token", refresh_token: "refresh-token" });
  assert.equal(session.user.email, "user@example.com");
  assert.equal(session.cookies.length, 2);
  assert.match(session.cookies[0], /HttpOnly/);
  assert.match(session.cookies[0], /Secure/);
  assert.doesNotMatch(JSON.stringify(auth.publicConfig()), /service-secret/);
});

test("an active membership without the server-controlled beta claim is refused", async () => {
  const auth = createWebBetaAuth({ env, fetchImpl: async (url) => {
    if (url.endsWith("/auth/v1/user")) return json({ id: "u1", email: "user@example.com", app_metadata: {} });
    throw new Error("membership lookup must not run without the beta claim");
  } });
  await assert.rejects(() => auth.adoptSession({ access_token: "access", refresh_token: "refresh" }), /not active/);
});
test("revoked membership refuses an otherwise valid Auth token", async () => {
  const auth = createWebBetaAuth({ env, fetchImpl: async (url) => {
    if (url.endsWith("/auth/v1/user")) return json({ id: "u1", email: "user@example.com", app_metadata: { bench_beta: "invited" } });
    return json([{ user_id: "u1", email: "user@example.com", status: "revoked" }]);
  } });
  await assert.rejects(() => auth.adoptSession({ access_token: "access", refresh_token: "refresh" }), /not active/);
});