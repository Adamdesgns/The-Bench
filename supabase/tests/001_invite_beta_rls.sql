begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(37);

select has_table('public', 'bench_beta_invites', 'invite table exists');
select has_table('public', 'bench_report_jobs', 'job table exists');
select has_table('public', 'bench_reports', 'report table exists');
select has_table('public', 'bench_report_usage', 'usage table exists');

select ok((select relrowsecurity from pg_class where oid = 'public.bench_beta_invites'::regclass), 'invites use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.bench_report_jobs'::regclass), 'jobs use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.bench_reports'::regclass), 'reports use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.bench_report_usage'::regclass), 'usage uses RLS');

select is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'bench_report_jobs'), 1, 'jobs expose only an owner select policy');
select is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'bench_reports'), 1, 'reports expose only an owner select policy');
select is((select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'owners can read their Bench report PDFs'), 1, 'private PDF read policy exists');
select is((select public from storage.buckets where id = 'bench-report-pdfs'), false, 'PDF bucket is private');
select is((select allowed_mime_types from storage.buckets where id = 'bench-report-pdfs'), array['application/pdf']::text[], 'PDF bucket accepts only application/pdf');

select ok(not has_table_privilege('anon', 'public.bench_report_jobs', 'SELECT'), 'anon cannot read jobs');
select ok(not has_table_privilege('anon', 'public.bench_reports', 'SELECT'), 'anon cannot read reports');
select ok(not has_table_privilege('authenticated', 'public.bench_report_jobs', 'INSERT'), 'authenticated users cannot bypass the enqueue RPC');
select ok(not has_table_privilege('authenticated', 'public.bench_report_jobs', 'UPDATE'), 'authenticated users cannot update job state');
select ok(not has_table_privilege('authenticated', 'public.bench_reports', 'INSERT'), 'authenticated users cannot forge reports');
select ok(not has_function_privilege('authenticated', 'public.bench_claim_report_job(text,integer)', 'EXECUTE'), 'clients cannot claim jobs');
select ok(not has_function_privilege('authenticated', 'public.bench_finish_report_job(uuid,text,text,uuid,text,timestamp with time zone,text,jsonb,text,text,text)', 'EXECUTE'), 'clients cannot finish jobs');
select ok(has_function_privilege('authenticated', 'public.bench_enqueue_report(text,text)', 'EXECUTE'), 'authenticated users may call the safe enqueue RPC');
select ok(has_function_privilege('service_role', 'public.bench_claim_report_job(text,integer)', 'EXECUTE'), 'service role may claim jobs');
select ok(has_function_privilege('service_role', 'public.bench_finish_report_job(uuid,text,text,uuid,text,timestamp with time zone,text,jsonb,text,text,text)', 'EXECUTE'), 'service role may finish jobs');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.bench_beta_invites (email, user_id, daily_report_limit, accepted_at)
values
  ('owner-a@example.com', '00000000-0000-4000-8000-000000000001', 2, now()),
  ('owner-b@example.com', '00000000-0000-4000-8000-000000000002', 2, now());

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'is_anonymous', false,
    'app_metadata', jsonb_build_object('bench_beta', 'invited')
  )::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select public.bench_enqueue_report('NVDA', 'owner-a-first')$$,
  'invited owner can enqueue a report'
);
select is((select count(*)::integer from public.bench_report_jobs), 1, 'owner sees only their own queued job');
select is((select count(*)::integer from public.bench_report_usage), 1, 'enqueuing records one usage unit');
select is((select created from public.bench_enqueue_report('NVDA', 'owner-a-first')), false, 'idempotent retry returns the existing job');
select is((select count(*)::integer from public.bench_report_usage), 1, 'idempotent retry does not consume quota');

select throws_ok(
  $$insert into public.bench_report_jobs (owner_id, target, idempotency_key)
    values ('00000000-0000-4000-8000-000000000002', 'MSFT', 'cross-owner-job')$$,
  '42501',
  null,
  'owner cannot bypass RLS to enqueue for another tenant'
);

select throws_ok(
  $$select public.bench_enqueue_report('AAPL', 'owner-a-second')$$,
  'P0001',
  'Concurrent report job limit reached',
  'concurrency quota blocks a second active job'
);

reset role;
update public.bench_report_jobs
set status = 'failed', step = 'failed', completed_at = now()
where owner_id = '00000000-0000-4000-8000-000000000001';

with source_job as (
  select id from public.bench_report_jobs
  where owner_id = '00000000-0000-4000-8000-000000000001'
  order by created_at
  limit 1
)
insert into public.bench_reports (
  id, owner_id, job_id, target, title, status, as_of, summary, content, content_sha256, pdf_path
)
select
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  id,
  'NVDA',
  'NVDA test report',
  'complete',
  now(),
  'Fixture',
  '{"summary":"Fixture"}'::jsonb,
  repeat('a', 64),
  '00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001.pdf'
from source_job;
set local role authenticated;

select is((select count(*)::integer from public.bench_reports), 1, 'owner can read their own report');

select lives_ok(
  $$select public.bench_enqueue_report('AAPL', 'owner-a-second')$$,
  'owner can enqueue after the active job finishes'
);
select throws_ok(
  $$select public.bench_enqueue_report('AMD', 'owner-a-third')$$,
  'P0001',
  'Daily report quota exhausted',
  'daily quota is enforced transactionally'
);

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'is_anonymous', false,
    'app_metadata', '{}'::jsonb
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select public.bench_enqueue_report('MSFT', 'missing-app-claim')$$,
  '42501',
  'An active Bench beta invitation is required',
  'database invite alone is insufficient without app_metadata authorization'
);
select is((select count(*)::integer from public.bench_report_jobs), 0, 'uninvited JWT cannot see another owner jobs');

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'is_anonymous', false,
    'app_metadata', jsonb_build_object('bench_beta', 'invited')
  )::text,
  true
);
set local role authenticated;
select is((select count(*)::integer from public.bench_report_jobs), 0, 'second owner cannot see first owner jobs');
select is((select count(*)::integer from public.bench_reports), 0, 'second owner cannot see first owner reports');

select * from finish();
rollback;
