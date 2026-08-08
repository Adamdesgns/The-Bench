import test from "node:test";
import assert from "node:assert/strict";
import { createNetlifyDispatcher, verifyDispatchRequest, __dispatchInternals } from "./reportDispatch.js";

test("dispatch secret comparison is exact and timing-safe length checked", () => {
  assert.equal(__dispatchInternals.sameSecret("correct-secret", "correct-secret"), true);
  assert.equal(__dispatchInternals.sameSecret("wrong-secret", "correct-secret"), false);
  assert.equal(__dispatchInternals.sameSecret("short", "correct-secret"), false);
});

test("worker accepts only POST with the server-held dispatch secret", () => {
  const good = new Request("https://bench.example/internal/report-worker", { method: "POST", headers: { "x-bench-dispatch-secret": "correct-secret" } });
  const wrong = new Request("https://bench.example/internal/report-worker", { method: "POST", headers: { "x-bench-dispatch-secret": "wrong-secret" } });
  const get = new Request("https://bench.example/internal/report-worker", { headers: { "x-bench-dispatch-secret": "correct-secret" } });
  assert.equal(verifyDispatchRequest(good, "correct-secret"), true);
  assert.equal(verifyDispatchRequest(wrong, "correct-secret"), false);
  assert.equal(verifyDispatchRequest(get, "correct-secret"), false);
});

test("dispatcher invokes the background route once without exposing the secret in its body", async () => {
  const calls = [];
  const dispatch = createNetlifyDispatcher({
    appOrigin: "https://bench.example/",
    secret: "correct-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(null, { status: 202 });
    },
  });
  await dispatch({ id: "11111111-1111-4111-8111-111111111111" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://bench.example/internal/report-worker");
  assert.equal(calls[0].options.headers["x-bench-dispatch-secret"], "correct-secret");
  assert.doesNotMatch(calls[0].options.body, /correct-secret/);
  assert.equal(JSON.parse(calls[0].options.body).job_id, "11111111-1111-4111-8111-111111111111");
});

test("dispatcher fails closed when Netlify does not accept the background invocation", async () => {
  const dispatch = createNetlifyDispatcher({
    appOrigin: "https://bench.example",
    secret: "correct-secret",
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  await assert.rejects(() => dispatch({ id: "job" }), /dispatch unavailable/);
});
