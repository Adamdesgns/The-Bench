# The Bench invite-only web beta

## What ships in v0.5

The web beta is a separate hosted mode. It reuses the Generate, Library, and Report Room interface, but it does not expose the Electron workstation's archive, challenge ledger, audit trail, settings, local keys, or command routes.

Each invited user receives:

- Supabase Auth sign-in through an invitation or secure email link;
- tenant-owned durable report jobs with idempotency and usage limits;
- ticker-only v23 reports that never read or reconcile Adam's private book;
- an RLS-protected report library; and
- PDFs in a private Storage bucket with a 60-second signed download.

The hosted Node process holds the Supabase service-role key and model key. Neither secret is returned to the browser. A database lease makes queued work restart-safe: if the worker stops, an expired job can be reclaimed without creating a second report.

## Required infrastructure

1. Create a dedicated Supabase project for The Bench. Do not reuse Anvil or another application's database.
2. Apply `supabase/migrations/20260807190000_invite_only_beta.sql`.
3. In Supabase Auth, disable public and anonymous signups. Allow only the exact production origin and the local development origin as redirects; do not use wildcards.
4. Keep the `bench-report-pdfs` bucket private. The migration creates it and adds owner-only read policy; browser writes are deliberately absent.
5. Deploy one persistent Node service from `Dockerfile`. A scale-to-zero host is acceptable for UI review, but reports wait until the worker is awake.
6. Put the values from `.env.web.example` into the host's encrypted environment settings. Never put `SUPABASE_SERVICE_ROLE_KEY` or a model key into client JavaScript.

## Environment

- `BENCH_WEB_BETA=1`
- `APP_ORIGIN=https://exact-production-origin.example`
- `SUPABASE_URL=https://project-ref.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`
- `SUPABASE_SERVICE_ROLE_KEY=...` (server only)
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (server only)
- `BETA_DAILY_REPORT_LIMIT=3`
- `REPORT_WORKER_ID=bench-web-1`
- `REPORT_WORKER_POLL_MS=2000`

## Invite one person

From a trusted terminal with the server environment loaded:

```powershell
npm run invite:beta -- person@example.com
```

That command sends the Supabase invitation, writes the server-controlled `app_metadata.bench_beta=invited` claim, and records the active database membership. It must never run in a browser or public endpoint.

## Run locally

Use a localhost `APP_ORIGIN` that exactly matches the URL in the browser:

```powershell
$env:BENCH_WEB_BETA='1'
$env:APP_ORIGIN='http://127.0.0.1:8138'
npm run start:web
```

The complete Supabase variables and one server-side model key are also required. Local Electron mode remains `npm start` / `npm run app` and does not require Supabase.

## Release gates

Before external invitations:

- run the SQL verification gate and Supabase security/performance advisors;
- prove anonymous access is denied;
- prove User A cannot read User B's job, report, or PDF;
- prove revocation blocks an existing session;
- prove one active report per user, idempotent retries, and the daily limit;
- verify worker restart recovery without a duplicate report or PDF;
- verify the signed PDF URL expires;
- add model-provider budget alerts; and
- use a market-data plan that permits multi-user redistribution.

This remains research-only. There is no order route and no automatic publishing.

## Live infrastructure record — 2026-08-07

- Supabase organization: `@adamdesgns`
- Dedicated project: `the-bench`
- Project ref: `yvvczjzndivktatdqdhh`
- Region: `us-east-1`
- API URL: `https://yvvczjzndivktatdqdhh.supabase.co`
- Applied migration: `20260807190927_invite_only_beta`
- Verification: all 37 live pgTAP assertions passed inside a rolled-back transaction; the four public beta tables have RLS enabled, the PDF bucket is private, and the database contains zero test users, invites, jobs, reports, or usage rows.

The Supabase security advisor reports one pending defense-in-depth decision: `bench_private.app_controls` does not have RLS enabled. The table is in an unexposed private schema and all `anon`/`authenticated` grants are already revoked, but enabling RLS with no client policies is recommended before deployment. The advisor also flags the authenticated `SECURITY DEFINER` enqueue RPC; that warning is intentional because the function is the only client write path and performs its own active-invite, owner, quota, queue, and idempotency checks.

Auth redirect URLs, server secrets, the persistent Node host, and external market-data redistribution permission remain unconfigured. Nothing is publicly deployed yet.
