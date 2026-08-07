import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCloudReports, __cloudReportInternals } from "./cloudReports.js";
import { runReport } from "./reviewer.js";

const auth = {
  enabled: true,
  supabaseUrl: "https://example.supabase.co",
  publishableKey: "sb_publishable_test",
  serviceKey: "service-secret-test",
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("hosted reports accept tickers and categorically refuse a shared market run", () => {
  assert.equal(__cloudReportInternals.cleanTicker("$nvda"), "NVDA");
  assert.throws(() => __cloudReportInternals.cleanTicker("market"), /ticker reports only/);
});

test("public report mode refuses market before reading or mutating the local archive", async () => {
  await assert.rejects(() => runReport({ target: "market", publicMode: true }), /ticker reports only/);
});

test("enqueue uses the signed-in user JWT and an atomic database RPC", async () => {
  const calls = [];
  const reports = createCloudReports({ auth, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json({ id: "11111111-1111-1111-1111-111111111111", target: "NVDA", created: true });
  } });
  const job = await reports.enqueue({ accessToken: "user-jwt", target: "nvda", idempotencyKey: "request-123" });
  assert.equal(job.target, "NVDA");
  assert.match(calls[0].url, /rpc\/bench_enqueue_report/);
  assert.equal(calls[0].options.headers.authorization, "Bearer user-jwt");
  assert.doesNotMatch(calls[0].options.body, /service-secret/);
});

test("report list requests remain user-scoped and expose only summary fields", async () => {
  const reports = createCloudReports({ auth, fetchImpl: async (_url, options) => {
    assert.equal(options.headers.authorization, "Bearer user-jwt");
    return json([{ id: "r1", owner_id: "u1", target: "NVDA", title: "NVDA", status: "complete", as_of: "2026-08-07T00:00:00Z", summary: "Read", content_sha256: "a".repeat(64), pdf_path: "u1/r1.pdf", created_at: "2026-08-07T00:00:00Z" }]);
  } });
  const list = await reports.list({ accessToken: "user-jwt" });
  assert.equal(list[0].pdf_ready, true);
  assert.equal(list[0].content, undefined);
});

test("the hosted server source has no private archive, challenge, audit, settings, or run routes", () => {
  const source = readFileSync(new URL("./web.js", import.meta.url), "utf8");
  for (const forbidden of ["/api/archive", "/api/challenge", "/api/audit", "/api/settings", "/api/run"]) assert.equal(source.includes(forbidden), false, forbidden);
  assert.match(source, /allowedStatic/);
});
test("worker stores a deterministic private PDF and finishes atomically", async () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  const reports = createCloudReports({
    auth,
    workerId: "worker-test",
    runReportImpl: async ({ target, publicMode, onStep }) => {
      assert.equal(target, "NVDA");
      assert.equal(publicMode, true);
      onStep("callBench");
      return { ok: true, target, stamp: "2026-08-07T20:00:00.000Z", errors: [], board: [], sources: [], report_text: "TEST REPORT", angle: "Evidence first" };
    },
    renderPdfImpl: () => Buffer.from("%PDF-test"),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("rpc/bench_claim_report_job")) return json([{ id: jobId, owner_id: ownerId, target: "NVDA" }]);
      if (url.includes("bench_report_jobs?")) return new Response("", { status: 204 });
      if (url.includes("/storage/v1/object/")) return json({ Key: `${ownerId}/${jobId}.pdf` });
      if (url.includes("rpc/bench_finish_report_job")) return json(jobId);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(await reports.processOne(), true);
  const upload = calls.find((call) => call.url.includes("/storage/v1/object/"));
  assert.match(upload.url, new RegExp(`${ownerId}/${jobId}\\.pdf$`));
  assert.equal(upload.options.headers["x-upsert"], "true");
  const finish = calls.find((call) => call.url.includes("rpc/bench_finish_report_job"));
  const body = JSON.parse(finish.options.body);
  assert.equal(body.p_job_id, jobId);
  assert.equal(body.p_report_id, jobId);
  assert.equal(body.p_status, "complete");
  assert.equal(body.p_pdf_path, `${ownerId}/${jobId}.pdf`);
  assert.equal(body.p_content.owner_id, ownerId);
  assert.match(body.p_content_sha256, /^[0-9a-f]{64}$/);
  assert.equal(calls.some((call) => /\/rest\/v1\/bench_reports$/.test(call.url)), false);
});