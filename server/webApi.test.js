import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWebApi } from "./webApi.js";

function fixture({ dispatchReport = null } = {}) {
  const calls = [];
  const auth = {
    enabled: true,
    appOrigin: "https://bench.example",
    dailyLimit: 3,
    publicConfig: () => ({ web_beta: true, invite_only: true, daily_report_limit: 3 }),
    sessionFromRequest: async () => ({ user: { id: "u1", email: "owner@example.com" }, membership: { daily_report_limit: 3 }, accessToken: "user-token" }),
    adoptSession: async () => ({ user: { id: "u1", email: "owner@example.com" }, cookies: ["a=1", "b=2"] }),
    requestSignInLink: async () => ({ ok: true }),
    clearCookies: () => ["a=; Max-Age=0", "b=; Max-Age=0"],
  };
  const reports = {
    enqueue: async (input) => { calls.push(input); return { id: "11111111-1111-4111-8111-111111111111", target: "NVDA", created: true }; },
    list: async () => [],
    jobStatus: async () => null,
    get: async () => null,
    signedPdf: async () => null,
  };
  return { calls, handle: createWebApi({ auth, reports, dispatchReport }) };
}

test("public config loads without a session", async () => {
  const { handle } = fixture();
  const response = await handle(new Request("https://bench.example/api/config"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { web_beta: true, invite_only: true, daily_report_limit: 3 });
});

test("report enqueue dispatches exactly one on-demand worker after the database accepts the job", async () => {
  const dispatches = [];
  const { calls, handle } = fixture({ dispatchReport: async (job) => dispatches.push(job) });
  const response = await handle(new Request("https://bench.example/api/reports", {
    method: "POST",
    headers: { origin: "https://bench.example", "content-type": "application/json", "idempotency-key": "request-123" },
    body: JSON.stringify({ target: "nvda" }),
  }));
  assert.equal(response.status, 202);
  assert.equal(calls[0].accessToken, "user-token");
  assert.equal(calls[0].idempotencyKey, "request-123");
  assert.deepEqual(dispatches, [{ id: "11111111-1111-4111-8111-111111111111", target: "NVDA", duplicate: false }]);
});

test("report enqueue rejects a cross-origin request before database or worker use", async () => {
  const dispatches = [];
  const { calls, handle } = fixture({ dispatchReport: async (job) => dispatches.push(job) });
  const response = await handle(new Request("https://bench.example/api/reports", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json", "idempotency-key": "request-123" },
    body: JSON.stringify({ target: "nvda" }),
  }));
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
  assert.equal(dispatches.length, 0);
});

test("Netlify functions are on-demand and the worker route is background-only", () => {
  const api = readFileSync(new URL("../netlify/functions/api.mjs", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../netlify/functions/report-worker.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(api, /startWorker|setInterval|REPORT_WORKER_POLL_MS/);
  assert.match(api, /createNetlifyDispatcher/);
  assert.match(worker, /background:\s*true/);
  assert.match(worker, /processOne\(\)/);
  assert.match(worker, /verifyDispatchRequest/);
});
