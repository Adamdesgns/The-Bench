// reportDispatch.js - authenticated handoff from the API function to Netlify's worker.

import { timingSafeEqual } from "node:crypto";

function required(value, name) {
  const clean = String(value || "").trim();
  if (!clean) throw new Error(`${name} is required for on-demand report dispatch`);
  return clean;
}

function sameSecret(provided, expected) {
  const left = Buffer.from(String(provided || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyDispatchRequest(request, secret) {
  return request.method === "POST" && sameSecret(request.headers.get("x-bench-dispatch-secret"), required(secret, "REPORT_DISPATCH_SECRET"));
}

export function createNetlifyDispatcher({ appOrigin, secret, fetchImpl = fetch } = {}) {
  const origin = required(appOrigin, "APP_ORIGIN").replace(/\/$/, "");
  const token = required(secret, "REPORT_DISPATCH_SECRET");
  return async function dispatchReport(job) {
    const response = await fetchImpl(`${origin}/internal/report-worker`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bench-dispatch-secret": token },
      body: JSON.stringify({ job_id: job.id }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 202) throw Object.assign(new Error("report worker dispatch unavailable"), { statusCode: 502 });
    return true;
  };
}

export const __dispatchInternals = { sameSecret };
