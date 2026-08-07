import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrationsUrl = new URL("../migrations/", import.meta.url);
const sql = readdirSync(migrationsUrl)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(new URL(name, migrationsUrl), "utf8"))
  .join("\n");

test("all exposed beta tables enable row level security", () => {
  for (const table of [
    "bench_beta_invites",
    "bench_report_jobs",
    "bench_reports",
    "bench_report_usage",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
});

test("authorization uses app_metadata and never user_metadata", () => {
  assert.match(sql, /auth\.jwt\(\)\s*->\s*'app_metadata'\s*->>\s*'bench_beta'/i);
  assert.doesNotMatch(sql, /user_metadata/i);
});

test("job ownership, idempotency, daily quota, and serialization are enforced", () => {
  assert.match(sql, /unique\s*\(owner_id, idempotency_key\)/i);
  assert.match(sql, /owner_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /Daily report quota exhausted/i);
  assert.match(sql, /Concurrent report job limit reached/i);
  assert.match(sql, /attempts integer not null default 0 check \(attempts between 0 and 2\)/i);
});

test("authenticated users enqueue only through the safe RPC", () => {
  assert.doesNotMatch(sql, /grant\s+[^;]*insert[^;]*bench_report_jobs\s+to\s+authenticated/i);
  assert.match(sql, /grant execute on function public\.bench_enqueue_report\(text, text\) to authenticated/i);
  assert.doesNotMatch(sql, /grant\s+update[^;]*bench_report_jobs\s+to\s+authenticated/i);
  assert.doesNotMatch(sql, /grant\s+insert[^;]*bench_reports\s+to\s+authenticated/i);
  assert.doesNotMatch(sql, /on public\.bench_report_jobs\s+for update\s+to authenticated/i);
});

test("generation has a private kill switch and global queue cap", () => {
  assert.match(sql, /create table bench_private\.app_controls/i);
  assert.match(sql, /alter table bench_private\.app_controls enable row level security/i);
  assert.match(sql, /generation_enabled boolean not null default true/i);
  assert.match(sql, /global_queue_limit integer not null default 25/i);
  assert.match(sql, /global_worker_limit integer not null default 2/i);
  assert.match(sql, /v_active_workers >= v_global_worker_limit/i);
  assert.match(sql, /Report generation is temporarily disabled/i);
  assert.match(sql, /The report queue is currently full/i);
});

test("worker RPCs are service-role-only", () => {
  for (const rpc of ["bench_claim_report_job", "bench_finish_report_job"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${rpc}[^;]+from public, anon, authenticated`, "is"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}[^;]+to service_role`, "is"));
  }
});

test("PDF storage is private, owner-scoped, and read-only to users", () => {
  assert.match(sql, /'bench-report-pdfs', 'bench-report-pdfs', false/i);
  assert.match(sql, /array\['application\/pdf'\]/i);
  assert.match(sql, /storage\.foldername\(name\)\)\[1\]\s*=\s*\(select auth\.uid\(\)\)::text/i);
  assert.doesNotMatch(sql, /on storage\.objects\s+for (insert|update|delete)\s+to authenticated/i);
});

test("no secret or service-role credential is embedded", () => {
  assert.doesNotMatch(sql, /SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]\s*['"][A-Za-z0-9._-]+/i);
});
