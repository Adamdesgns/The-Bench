-- The Bench invite-only beta: tenant-owned report jobs, immutable reports, and
-- private PDF storage. Browser clients use only a publishable key plus the
-- signed-in user's JWT. The service_role key belongs only in a trusted worker.

create schema if not exists bench_private;
revoke all on schema bench_private from public, anon;
grant usage on schema bench_private to authenticated, service_role;

create table public.bench_beta_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid unique references auth.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  daily_report_limit integer not null default 3
    check (daily_report_limit between 1 and 100),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  expires_at timestamptz,
  check (email = lower(btrim(email))),
  check (position('@' in email) > 1),
  check (accepted_at is null or user_id is not null)
);

create unique index bench_beta_invites_active_email_key
  on public.bench_beta_invites (lower(email))
  where status = 'active';

create index bench_beta_invites_active_user_idx
  on public.bench_beta_invites (user_id)
  where status = 'active';

create table public.bench_report_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  target text not null,
  idempotency_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'attention', 'failed')),
  step text not null default 'queued',
  error text,
  report_id uuid,
  attempts integer not null default 0 check (attempts between 0 and 2),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  worker_id text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (owner_id, idempotency_key),
  check (char_length(target) between 1 and 32),
  check (target = btrim(target)),
  check (target !~ E'[\\r\\n]'),
  check (char_length(idempotency_key) between 8 and 128),
  check (worker_id is null or char_length(worker_id) between 1 and 128),
  check (
    (status = 'queued' and worker_id is null and lease_until is null and completed_at is null)
    or (status = 'running' and worker_id is not null and lease_until is not null and started_at is not null and completed_at is null)
    or (status in ('complete', 'attention', 'failed') and lease_until is null and completed_at is not null)
  )
);

create index bench_report_jobs_owner_created_idx
  on public.bench_report_jobs (owner_id, created_at desc);

create index bench_report_jobs_claim_idx
  on public.bench_report_jobs (available_at, created_at)
  where status in ('queued', 'running');

create table public.bench_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null unique references public.bench_report_jobs(id) on delete restrict,
  target text not null,
  title text not null,
  status text not null check (status in ('complete', 'attention')),
  as_of timestamptz not null,
  summary text not null default '',
  content jsonb not null,
  content_sha256 text not null,
  pdf_path text,
  created_at timestamptz not null default now(),
  check (char_length(target) between 1 and 32),
  check (char_length(title) between 1 and 240),
  check (jsonb_typeof(content) = 'object'),
  check (content_sha256 ~ '^[0-9a-f]{64}$'),
  check (pdf_path is null or pdf_path = owner_id::text || '/' || id::text || '.pdf')
);

alter table public.bench_report_jobs
  add constraint bench_report_jobs_report_id_fkey
  foreign key (report_id) references public.bench_reports(id)
  on delete restrict;

create unique index bench_report_jobs_report_id_key
  on public.bench_report_jobs (report_id)
  where report_id is not null;

create index bench_reports_owner_created_idx
  on public.bench_reports (owner_id, created_at desc);

create table public.bench_report_usage (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null unique references public.bench_report_jobs(id) on delete restrict,
  usage_day date not null,
  units integer not null default 1 check (units = 1),
  created_at timestamptz not null default now()
);

create index bench_report_usage_owner_day_idx
  on public.bench_report_usage (owner_id, usage_day);

create table bench_private.app_controls (
  singleton boolean primary key default true check (singleton),
  generation_enabled boolean not null default true,
  global_queue_limit integer not null default 25
    check (global_queue_limit between 1 and 1000),
  global_worker_limit integer not null default 2
    check (global_worker_limit between 1 and 100),
  updated_at timestamptz not null default now()
);

insert into bench_private.app_controls (
  singleton, generation_enabled, global_queue_limit, global_worker_limit
)
values (true, true, 25, 2)
on conflict (singleton) do nothing;

revoke all on bench_private.app_controls from public, anon, authenticated;

alter table public.bench_beta_invites enable row level security;
alter table public.bench_report_jobs enable row level security;
alter table public.bench_reports enable row level security;
alter table public.bench_report_usage enable row level security;

create or replace function bench_private.has_active_beta_invite()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') <> 'true'
    and coalesce((select auth.jwt() -> 'app_metadata' ->> 'bench_beta'), '') = 'invited'
    and exists (
      select 1
      from public.bench_beta_invites i
      where i.user_id = (select auth.uid())
        and i.status = 'active'
        and (i.expires_at is null or i.expires_at > now())
    );
$$;

revoke all on function bench_private.has_active_beta_invite() from public, anon;
grant execute on function bench_private.has_active_beta_invite() to authenticated, service_role;

create policy "invited users can read their invite"
on public.bench_beta_invites
for select
to authenticated
using (
  user_id = (select auth.uid())
  and coalesce((select auth.jwt() -> 'app_metadata' ->> 'bench_beta'), '') = 'invited'
);

create policy "invited users can read their jobs"
on public.bench_report_jobs
for select
to authenticated
using (
  owner_id = (select auth.uid())
  and (select bench_private.has_active_beta_invite())
);

create policy "invited users can read their reports"
on public.bench_reports
for select
to authenticated
using (
  owner_id = (select auth.uid())
  and (select bench_private.has_active_beta_invite())
);

create policy "invited users can read their usage"
on public.bench_report_usage
for select
to authenticated
using (
  owner_id = (select auth.uid())
  and (select bench_private.has_active_beta_invite())
);

revoke all on public.bench_beta_invites from anon, authenticated;
revoke all on public.bench_report_jobs from anon, authenticated;
revoke all on public.bench_reports from anon, authenticated;
revoke all on public.bench_report_usage from anon, authenticated;

grant select on public.bench_beta_invites to authenticated;
grant select on public.bench_report_jobs to authenticated;
grant select on public.bench_reports to authenticated;
grant select on public.bench_report_usage to authenticated;

create or replace function bench_private.validate_report_job_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_day date := timezone('UTC', now())::date;
  v_daily_limit integer;
  v_used integer;
  v_active integer;
  v_generation_enabled boolean;
  v_global_queue_limit integer;
  v_global_active integer;
begin
  if v_owner is null or new.owner_id <> v_owner then
    raise exception using errcode = '42501', message = 'Report job owner must match the signed-in user';
  end if;

  if not (select bench_private.has_active_beta_invite()) then
    raise exception using errcode = '42501', message = 'An active Bench beta invitation is required';
  end if;

  -- The global lock closes the queue-limit race; the owner lock closes the
  -- idempotency, daily quota, and one-active-job races.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bench-global-queue', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text, 0));

  select c.generation_enabled, c.global_queue_limit
    into v_generation_enabled, v_global_queue_limit
  from bench_private.app_controls c
  where c.singleton
  for update;

  if not coalesce(v_generation_enabled, false) then
    raise exception using errcode = 'P0001', message = 'Report generation is temporarily disabled';
  end if;

  select count(*)::integer into v_global_active
  from public.bench_report_jobs j
  where j.status in ('queued', 'running');

  if v_global_active >= v_global_queue_limit then
    raise exception using errcode = 'P0001', message = 'The report queue is currently full';
  end if;

  select i.daily_report_limit
    into v_daily_limit
  from public.bench_beta_invites i
  where i.user_id = v_owner
    and i.status = 'active'
    and (i.expires_at is null or i.expires_at > now())
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'An active Bench beta invitation is required';
  end if;

  select coalesce(sum(u.units), 0)::integer
    into v_used
  from public.bench_report_usage u
  where u.owner_id = v_owner and u.usage_day = v_day;

  if v_used >= v_daily_limit then
    raise exception using errcode = 'P0001', message = 'Daily report quota exhausted';
  end if;

  select count(*)::integer
    into v_active
  from public.bench_report_jobs j
  where j.owner_id = v_owner
    and j.status in ('queued', 'running');

  if v_active >= 1 then
    raise exception using errcode = 'P0001', message = 'Concurrent report job limit reached';
  end if;

  new.target := btrim(new.target);
  new.status := 'queued';
  new.step := 'queued';
  new.error := null;
  new.report_id := null;
  new.attempts := 0;
  new.available_at := now();
  new.lease_until := null;
  new.worker_id := null;
  new.created_at := now();
  new.started_at := null;
  new.completed_at := null;
  return new;
end;
$$;

create or replace function bench_private.record_report_job_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.bench_report_usage (owner_id, job_id, usage_day)
  values (
    new.owner_id,
    new.id,
    timezone('UTC', new.created_at)::date
  );
  return new;
end;
$$;

revoke all on function bench_private.validate_report_job_insert() from public, anon, authenticated;
revoke all on function bench_private.record_report_job_usage() from public, anon, authenticated;

create trigger bench_report_jobs_validate_insert
before insert on public.bench_report_jobs
for each row execute function bench_private.validate_report_job_insert();

create trigger bench_report_jobs_record_usage
after insert on public.bench_report_jobs
for each row execute function bench_private.record_report_job_usage();

create or replace function public.bench_enqueue_report(
  p_target text,
  p_idempotency_key text
)
returns table (job public.bench_report_jobs, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_job public.bench_report_jobs%rowtype;
begin
  if v_owner is null or not (select bench_private.has_active_beta_invite()) then
    raise exception using errcode = '42501', message = 'An active Bench beta invitation is required';
  end if;
  if p_target is null or char_length(btrim(p_target)) not between 1 and 32 or p_target ~ E'[\\r\\n]' then
    raise exception using errcode = '22023', message = 'target must be 1 to 32 characters on one line';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode = '22023', message = 'idempotency_key must be 8 to 128 characters';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bench-global-queue', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text, 0));

  select j.* into v_job
  from public.bench_report_jobs j
  where j.owner_id = v_owner and j.idempotency_key = p_idempotency_key;

  if found then
    return query select v_job, false;
    return;
  end if;

  insert into public.bench_report_jobs (owner_id, target, idempotency_key)
  values (v_owner, btrim(p_target), p_idempotency_key)
  returning * into v_job;

  return query select v_job, true;
end;
$$;

revoke all on function public.bench_enqueue_report(text, text) from public, anon;
grant execute on function public.bench_enqueue_report(text, text) to authenticated, service_role;

create or replace function public.bench_claim_report_job(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.bench_report_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation_enabled boolean;
  v_global_worker_limit integer;
  v_active_workers integer;
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'worker_id must be 1 to 128 characters';
  end if;
  if p_lease_seconds not between 30 and 900 then
    raise exception using errcode = '22023', message = 'lease_seconds must be between 30 and 900';
  end if;

  -- Serialize worker admission so parallel pollers cannot exceed the global
  -- number of active, unexpired leases.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bench-global-workers', 0));
  select c.generation_enabled, c.global_worker_limit
    into v_generation_enabled, v_global_worker_limit
  from bench_private.app_controls c
  where c.singleton
  for update;

  -- The kill switch stops workers from beginning more paid generation. Jobs
  -- already running can still finish cleanly through bench_finish_report_job.
  if not coalesce(v_generation_enabled, false) then
    return;
  end if;

  select count(*)::integer into v_active_workers
  from public.bench_report_jobs j
  where j.status = 'running' and j.lease_until > now();

  if v_active_workers >= v_global_worker_limit then
    return;
  end if;

  -- A twice-abandoned lease is terminal. Retiring it here prevents one dead
  -- worker from blocking that owner's one-active-job allowance forever.
  update public.bench_report_jobs j
  set status = 'failed',
      step = 'failed',
      error = 'Worker lease expired after maximum attempts',
      lease_until = null,
      completed_at = now()
  where j.status = 'running'
    and j.lease_until < now()
    and j.attempts >= 2;

  return query
  with candidate as (
    select j.id
    from public.bench_report_jobs j
    where j.available_at <= now()
      and j.attempts < 2
      and (
        j.status = 'queued'
        or (j.status = 'running' and j.lease_until < now())
      )
    order by j.available_at, j.created_at
    for update skip locked
    limit 1
  )
  update public.bench_report_jobs j
  set status = 'running',
      step = 'claimed',
      worker_id = btrim(p_worker_id),
      attempts = j.attempts + 1,
      started_at = coalesce(j.started_at, now()),
      lease_until = now() + make_interval(secs => p_lease_seconds),
      error = null
  from candidate c
  where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.bench_finish_report_job(
  p_job_id uuid,
  p_worker_id text,
  p_status text,
  p_report_id uuid default null,
  p_title text default null,
  p_as_of timestamptz default null,
  p_summary text default '',
  p_content jsonb default null,
  p_content_sha256 text default null,
  p_pdf_path text default null,
  p_error text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bench_report_jobs%rowtype;
  v_report_id uuid;
  v_expected_pdf_path text;
begin
  if p_status not in ('complete', 'attention', 'failed') then
    raise exception using errcode = '22023', message = 'Invalid terminal report job status';
  end if;

  select * into v_job
  from public.bench_report_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Report job not found';
  end if;

  -- Finishing is idempotent for a worker retry after the transaction committed.
  if v_job.status in ('complete', 'attention', 'failed') then
    return v_job.report_id;
  end if;

  if v_job.status <> 'running'
     or v_job.worker_id is distinct from btrim(p_worker_id)
     or v_job.lease_until <= now() then
    raise exception using errcode = '42501', message = 'Worker does not hold the active job lease';
  end if;

  if p_status = 'failed' then
    update public.bench_report_jobs
    set status = 'failed', step = 'failed', error = left(coalesce(p_error, 'Report generation failed'), 2000),
        lease_until = null, completed_at = now()
    where id = p_job_id;
    return null;
  end if;

  if p_title is null or char_length(btrim(p_title)) not between 1 and 240
     or p_as_of is null
     or p_content is null or jsonb_typeof(p_content) <> 'object'
     or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'A finished report requires title, as_of, object content, and lowercase SHA-256';
  end if;

  v_report_id := coalesce(p_report_id, gen_random_uuid());
  v_expected_pdf_path := v_job.owner_id::text || '/' || v_report_id::text || '.pdf';
  if p_pdf_path is not null and p_pdf_path <> v_expected_pdf_path then
    raise exception using errcode = '22023', message = 'PDF path must be owner_id/report_id.pdf';
  end if;

  insert into public.bench_reports (
    id, owner_id, job_id, target, title, status, as_of, summary,
    content, content_sha256, pdf_path
  ) values (
    v_report_id, v_job.owner_id, v_job.id, v_job.target, btrim(p_title), p_status,
    p_as_of, coalesce(p_summary, ''), p_content, p_content_sha256, p_pdf_path
  );

  update public.bench_report_jobs
  set status = p_status, step = 'finished', error = null, report_id = v_report_id,
      lease_until = null, completed_at = now()
  where id = p_job_id;

  return v_report_id;
end;
$$;

revoke all on function public.bench_claim_report_job(text, integer) from public, anon, authenticated;
revoke all on function public.bench_finish_report_job(uuid, text, text, uuid, text, timestamptz, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.bench_claim_report_job(text, integer) to service_role;
grant execute on function public.bench_finish_report_job(uuid, text, text, uuid, text, timestamptz, text, jsonb, text, text, text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bench-report-pdfs', 'bench-report-pdfs', false, 20971520, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owners can read their Bench report PDFs" on storage.objects;
create policy "owners can read their Bench report PDFs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'bench-report-pdfs'
  and (select bench_private.has_active_beta_invite())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.bench_reports r
    where r.owner_id = (select auth.uid())
      and r.pdf_path = name
  )
);

-- Deliberately no authenticated INSERT/UPDATE/DELETE policies on storage.objects.
-- Only the trusted worker (service_role, never shipped to a client) writes PDFs.
