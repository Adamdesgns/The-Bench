import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createPortProbe } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeClientRegistry, initializeOwnerRegistry } from "../server/xecutor/auth.js";
import { createXecutorServer } from "../server/xecutor/server.js";

const NOW = new Date("2026-08-26T15:00:00.000Z");

async function reservePort() {
  const probe = createPortProbe();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function makeApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "the-xecutor-http-"));
  const owner = initializeOwnerRegistry(dataDir);
  const port = await reservePort();
  const app = createXecutorServer({ dataDir, host: "127.0.0.1", port, clock: () => new Date(NOW) });
  await app.listen();
  const origin = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { app, dataDir, origin, ownerCode: owner.code };
}

function handoff() {
  const createdAt = new Date(NOW.getTime() - 60_000);
  return {
    schema_version: "bench-execution-handoff-v1",
    plan_id: `B-138:${createdAt.toISOString()}`,
    row_id: "B-138",
    framework_version: "v26",
    executor_version: "bench-executor-v1",
    created_at: createdAt.toISOString(),
    expires_at: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
    account_alias: "AGENTIC-7724",
    asset_class: "equity",
    ticker: "TEST",
    action: "BUY",
    lane: "base_swing",
    structure: "long_shares",
    quantity_mode: "notional",
    quantity_value: 4.5,
    order_type: "LIMIT",
    limit_price: 22.1,
    time_in_force: "DAY",
    session: "REGULAR_HOURS_ONLY",
    invalidation_price: 21.1,
    planned_dollar_risk: 4.5,
    executor_absolute_ceiling: 5,
    maximum_price_drift: "$0.25",
    exit_owner: "MANUAL",
    concentrated: false,
    leveraged_product: false,
    conviction_bet: false,
  };
}

async function body(response) {
  return JSON.parse(await response.text());
}

function ownerHeaders(origin, csrf, ownerSession, extra = {}) {
  return { origin, "x-xecutor-csrf": csrf, "x-xecutor-owner": ownerSession, "content-type": "application/json", ...extra };
}

async function ownerLogin(origin, code) {
  const response = await fetch(`${origin}/api/owner/login`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const payload = await body(response);
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(typeof payload.owner_session, "string");
  assert.ok(payload.owner_session.length >= 32);
  return payload.owner_session;
}

test("owner mutations require the exact loopback origin, CSRF proof, JSON, and a bounded body", async (t) => {
  const { app, origin, ownerCode } = await makeApp(t);
  const ownerSession = await ownerLogin(origin, ownerCode);
  const noHeaderSession = await fetch(`${origin}/api/session`);
  assert.equal(noHeaderSession.status, 401);
  assert.equal((await body(noHeaderSession)).code, "OWNER_AUTH_REQUIRED");

  const sessionResponse = await fetch(`${origin}/api/session`, { headers: { "x-xecutor-owner": ownerSession } });
  const session = await body(sessionResponse);
  assert.equal(sessionResponse.status, 200);
  assert.equal(session.gateway.kill_switch, true);
  assert.equal(session.gateway.live_execution, false);

  const missingProof = await fetch(`${origin}/api/kill-switch`, {
    method: "POST",
    headers: { "x-xecutor-owner": ownerSession, "content-type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(missingProof.status, 403);
  assert.equal((await body(missingProof)).code, "ORIGIN_REJECTED");

  const foreignOrigin = await fetch(`${origin}/api/kill-switch`, {
    method: "POST",
    headers: ownerHeaders("https://evil.example", session.csrf, ownerSession),
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(foreignOrigin.status, 403);
  assert.equal((await body(foreignOrigin)).code, "ORIGIN_REJECTED");

  const wrongCsrf = await fetch(`${origin}/api/kill-switch`, {
    method: "POST",
    headers: ownerHeaders(origin, "wrong-proof", ownerSession),
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(wrongCsrf.status, 403);
  assert.equal((await body(wrongCsrf)).code, "CSRF_REJECTED");

  const wrongType = await fetch(`${origin}/api/kill-switch`, {
    method: "POST",
    headers: { origin, "x-xecutor-csrf": session.csrf, "x-xecutor-owner": ownerSession, "content-type": "text/plain" },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(wrongType.status, 415);
  assert.equal((await body(wrongType)).code, "CONTENT_TYPE_REQUIRED");

  const oversized = await fetch(`${origin}/api/kill-switch`, {
    method: "POST",
    headers: ownerHeaders(origin, session.csrf, ownerSession),
    body: JSON.stringify({ enabled: false, padding: "x".repeat(64 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await body(oversized)).code, "BODY_TOO_LARGE");

  const unlocked = await fetch(`${origin}/api/kill-switch`, {
    method: "POST",
    headers: ownerHeaders(origin, session.csrf, ownerSession),
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(unlocked.status, 200);
  assert.equal((await body(unlocked)).gateway.kill_switch, false);
  assert.equal(app.service.gatewayStatus().live_execution, false);
});

test("bot routes have no unauthenticated fallback and bind identity to the issued token", async (t) => {
  const { dataDir, origin, ownerCode } = await makeApp(t);
  const ownerSession = await ownerLogin(origin, ownerCode);
  const session = await body(await fetch(`${origin}/api/session`, { headers: { "x-xecutor-owner": ownerSession } }));
  await fetch(`${origin}/api/kill-switch`, {
    method: "POST",
    headers: ownerHeaders(origin, session.csrf, ownerSession),
    body: JSON.stringify({ enabled: false }),
  });
  const proposalBody = JSON.stringify({ client_submission_id: "http-order-001", handoff: handoff() });

  const unauthenticated = await fetch(`${origin}/api/bot/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: proposalBody,
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await body(unauthenticated)).code, "BOT_UNAUTHORIZED");

  const unauthenticatedMcp = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(unauthenticatedMcp.status, 401);
  assert.equal((await body(unauthenticatedMcp)).code, "BOT_UNAUTHORIZED");

  const { issued } = initializeClientRegistry(dataDir);
  const chatgpt = issued.find((client) => client.id === "chatgpt").token;
  const claude = issued.find((client) => client.id === "claude").token;
  const accepted = await fetch(`${origin}/api/bot/proposals`, {
    method: "POST",
    headers: { authorization: `Bearer ${chatgpt}`, "content-type": "application/json" },
    body: proposalBody,
  });
  const acceptedBody = await body(accepted);
  assert.equal(accepted.status, 201);
  assert.equal(acceptedBody.proposal.source_client, "chatgpt");
  assert.equal("confirmation_text" in acceptedBody.proposal, false);

  const crossSource = await fetch(`${origin}/api/bot/proposals/${acceptedBody.proposal.id}`, {
    headers: { authorization: `Bearer ${claude}` },
  });
  assert.equal(crossSource.status, 404);
  assert.equal((await body(crossSource)).code, "PROPOSAL_NOT_FOUND");
});

test("owner session details and confirmation strings are not disclosed before owner login", async (t) => {
  const { origin } = await makeApp(t);
  const response = await fetch(`${origin}/api/session`);
  const raw = await response.text();
  const payload = JSON.parse(raw);

  assert.equal(response.status, 401);
  assert.equal(payload.code, "OWNER_AUTH_REQUIRED");
  assert.doesNotMatch(raw, /csrf/i);
  assert.doesNotMatch(raw, /confirmation_text/i);
});

test("Stage 1 refuses every non-loopback bind", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "the-xecutor-nonloopback-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  assert.throws(
    () => createXecutorServer({ dataDir, host: "0.0.0.0", port: 8140, clock: () => new Date(NOW) }),
    /loopback-only/i,
  );
});

test("a second server is refused while the runtime lock is held and succeeds after close", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "the-xecutor-lock-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const first = createXecutorServer({ dataDir, host: "127.0.0.1", port: 0, clock: () => new Date(NOW) });

  assert.throws(
    () => createXecutorServer({ dataDir, host: "127.0.0.1", port: 0, clock: () => new Date(NOW) }),
    (error) => error.code === "XECUTOR_ALREADY_RUNNING",
  );
  await first.close();

  const successor = createXecutorServer({ dataDir, host: "127.0.0.1", port: 0, clock: () => new Date(NOW) });
  assert.equal(successor.service.gatewayStatus().kill_switch, true);
  await successor.close();
});

test("the local static owner page is non-cacheable, framed off, same-origin, and CSP locked", async (t) => {
  const { origin } = await makeApp(t);
  const response = await fetch(`${origin}/`);
  const html = await response.text();
  const scriptResponse = await fetch(`${origin}/app.js`);
  const script = await scriptResponse.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/html/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.match(html, /The Xecutor/i);
  assert.match(html, /simulation/i);
  assert.equal(scriptResponse.status, 200);
  assert.match(script, /["']x-xecutor-owner["']/);
  assert.doesNotMatch(script, /\bcookie\b|\blocalStorage\b|\bsessionStorage\b/i);
});
