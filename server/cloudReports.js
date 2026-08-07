// cloudReports.js - durable, tenant-isolated report jobs for the hosted beta.


import { normalizeReport } from "./reportStore.js";
import { renderReportPdf } from "./reportPdf.js";
import { runReport } from "./reviewer.js";

function cleanTicker(value) {
  const ticker = String(value || "").trim().replace(/^\$/, "").toUpperCase();
  if (!/^[A-Z^][A-Z0-9.\-]{0,9}$/.test(ticker) || ticker === "MARKET") throw Object.assign(new Error("the beta currently accepts ticker reports only"), { statusCode: 400 });
  return ticker;
}

function cleanKey(value) {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 128) throw Object.assign(new Error("idempotency key must be 8 to 128 characters"), { statusCode: 400 });
  return key;
}

async function parseResponse(response, fallback) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) throw Object.assign(new Error(response.status >= 500 ? fallback : body?.message || body?.error || fallback), { statusCode: response.status >= 500 ? 502 : response.status });
  return body;
}

function publicReport(row) {
  const content = row.content || {};
  return {
    ...content,
    id: row.id,
    owner_id: row.owner_id,
    target: row.target,
    title: row.title,
    status: row.status,
    as_of: row.as_of,
    summary: row.summary,
    content_sha256: row.content_sha256,
    created_at: row.created_at,
    pdf_ready: Boolean(row.pdf_path),
  };
}

export function createCloudReports({ auth, fetchImpl = fetch, runReportImpl = runReport, renderPdfImpl = renderReportPdf, workerId = process.env.REPORT_WORKER_ID || `bench-${process.pid}` } = {}) {
  if (!auth?.enabled) throw new Error("web beta auth is required");
  const base = auth.supabaseUrl.replace(/\/$/, "");

  async function rest(path, { method = "GET", token, body, headers = {} } = {}) {
    const response = await fetchImpl(`${base}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: auth.publishableKey,
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    return parseResponse(response, "report database unavailable");
  }

  async function rpc(name, body, token) {
    return rest(`rpc/${name}`, { method: "POST", token, body });
  }

  async function enqueue({ accessToken, target, idempotencyKey }) {
    const result = await rpc("bench_enqueue_report", { p_target: cleanTicker(target), p_idempotency_key: cleanKey(idempotencyKey) }, accessToken);
    const record = Array.isArray(result) ? result[0] : result;
    const job = record?.job || record;
    if (!job?.id) throw new Error("report job was not created");
    return { ...job, created: record?.created !== false };
  }

  async function list({ accessToken, limit = 100 }) {
    const bounded = Math.max(1, Math.min(Number(limit) || 100, 100));
    const rows = await rest(`bench_reports?select=id,owner_id,target,title,status,as_of,summary,content_sha256,pdf_path,created_at&order=created_at.desc&limit=${bounded}`, { token: accessToken });
    return rows.map((row) => ({ ...row, pdf_ready: Boolean(row.pdf_path) }));
  }

  async function get({ accessToken, id }) {
    const rows = await rest(`bench_reports?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, { token: accessToken });
    return rows?.[0] ? publicReport(rows[0]) : null;
  }

  async function jobStatus({ accessToken, id }) {
    const jobs = await rest(`bench_report_jobs?select=id,target,status,step,error,report_id,created_at,started_at,completed_at&id=eq.${encodeURIComponent(id)}&limit=1`, { token: accessToken });
    const job = jobs?.[0];
    if (!job) return null;
    let result = null;
    if (job.report_id) result = await get({ accessToken, id: job.report_id });
    const started = new Date(job.started_at || job.created_at).getTime();
    return {
      id: job.id,
      running: ["queued", "running"].includes(job.status),
      step: job.step || job.status,
      elapsed_ms: Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0,
      result,
      report_id: job.report_id,
      error: job.error || null,
    };
  }

  async function signedPdf({ accessToken, id }) {
    const report = await get({ accessToken, id });
    if (!report?.pdf_ready) return null;
    const rows = await rest(`bench_reports?select=pdf_path&id=eq.${encodeURIComponent(id)}&limit=1`, { token: accessToken });
    const path = rows?.[0]?.pdf_path;
    if (!path) return null;
    const response = await fetchImpl(`${base}/storage/v1/object/sign/bench-report-pdfs/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: { apikey: auth.serviceKey, authorization: `Bearer ${auth.serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: 60 }),
      signal: AbortSignal.timeout(15_000),
    });
    const signed = await parseResponse(response, "PDF download unavailable");
    const signedPath = signed?.signedURL || signed?.signedUrl || signed?.signed_url;
    return signedPath ? new URL(signedPath, base).href : null;
  }

  async function claim() {
    const result = await rpc("bench_claim_report_job", { p_worker_id: workerId, p_lease_seconds: 420 }, auth.serviceKey);
    return Array.isArray(result) ? result[0] || null : result || null;
  }

  async function touch(jobId, step) {
    await rest(`bench_report_jobs?id=eq.${encodeURIComponent(jobId)}&worker_id=eq.${encodeURIComponent(workerId)}`, {
      method: "PATCH",
      token: auth.serviceKey,
      body: { step: String(step).slice(0, 80), lease_until: new Date(Date.now() + 420_000).toISOString() },
      headers: { prefer: "return=minimal" },
    });
  }

  async function uploadPdf(path, bytes) {
    const response = await fetchImpl(`${base}/storage/v1/object/bench-report-pdfs/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: { apikey: auth.serviceKey, authorization: `Bearer ${auth.serviceKey}`, "content-type": "application/pdf", "x-upsert": "true" },
      body: bytes,
      signal: AbortSignal.timeout(30_000),
    });
    await parseResponse(response, "PDF storage unavailable");
  }

  async function finish(job, { status, report = null, reportId = null, pdfPath = null, error = null }) {
    await rpc("bench_finish_report_job", {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_status: status,
      p_report_id: reportId,
      p_title: report?.title || null,
      p_as_of: report?.as_of || null,
      p_summary: report?.summary || "",
      p_content: report || null,
      p_content_sha256: report?.content_sha256 || null,
      p_pdf_path: pdfPath,
      p_error: error,
    }, auth.serviceKey);
  }

  async function processOne() {
    const job = await claim();
    if (!job?.id) return false;
    try {
      const raw = await runReportImpl({ target: job.target, publicMode: true, onStep: (step) => { touch(job.id, step).catch(() => {}); } });
      const status = raw.ok ? "complete" : "attention";
      const normalized = normalizeReport({ ...raw, owner_id: job.owner_id, status, sources: raw.sources || raw.packet?.sources || [], summary: raw.angle || raw.no_story || raw.verdict?.us_read || "" });
      const reportId = job.id;
      const pdfPath = `${job.owner_id}/${reportId}.pdf`;
      const report = { ...normalized, id: reportId };
      const pdf = renderPdfImpl(report);
      await uploadPdf(pdfPath, pdf);
      await finish(job, { status, report, reportId, pdfPath });
    } catch (error) {
      await finish(job, { status: "failed", error: error?.name === "TimeoutError" ? "report_timeout" : "report_failed" }).catch(() => {});
    }
    return true;
  }

  function startWorker({ pollMs = Number(process.env.REPORT_WORKER_POLL_MS || 2000) } = {}) {
    let stopped = false;
    let busy = false;
    const cycle = async () => {
      if (stopped || busy) return;
      busy = true;
      try { await processOne(); } finally { busy = false; }
    };
    const timer = setInterval(() => { cycle().catch(() => {}); }, Math.max(500, pollMs));
    timer.unref?.();
    cycle().catch(() => {});
    return () => { stopped = true; clearInterval(timer); };
  }

  return Object.freeze({ enqueue, list, get, jobStatus, signedPdf, processOne, startWorker });
}

export const __cloudReportInternals = { cleanTicker, cleanKey, publicReport };