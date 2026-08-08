# The Bench invite-only web beta

## What ships in v0.5

The web beta is a separate hosted mode. It reuses the Generate, Library, and Report Room interface, but it does not expose the Electron workstation's archive, challenge ledger, audit trail, settings, local keys, or command routes.

Each invited user receives:

- Supabase Auth sign-in through an invitation or secure email link;
- tenant-owned durable report jobs with idempotency and usage limits;
- ticker-only v23 reports that never read or reconcile Adam's private book;
- an RLS-protected report library; and
- PDFs in a private Storage bucket with a 60-second signed download.

Netlify holds the Supabase service-role key and model key in encrypted server-side environment variables. Neither secret is returned to the browser. A report request queues one job and invokes one background function; there is no scheduled poller and no idle model usage. A database lease and idempotency key make retries safe without creating a second report or PDF.

## Required infrastructure

1. Create a dedicated Supabase project for The Bench. Do not reuse Anvil or another application's database.
2. Apply `supabase/migrations/20260807190000_invite_only_beta.sql`.
3. In Supabase Auth, disable public and anonymous signups. Allow only the exact production origin and the local development origin as redirects; do not use wildcards.
4. Keep the `bench-report-pdfs` bucket private. The migration creates it and adds owner-only read policy; browser writes are deliberately absent.
5. Create a new, dedicated Netlify site from this package. `netlify.toml` publishes the static shell, routes `/api/*` to the synchronous API function, and runs `/internal/report-worker` only as a background function after a report is accepted.
6. Put the values from `.env.web.example` into the host's encrypted environment settings. Never put `SUPABASE_SERVICE_ROLE_KEY` or a model key into client JavaScript.

## Environment

- `BENCH_WEB_BETA=1`
- `APP_ORIGIN=https://exact-production-origin.example`
- `SUPABASE_URL=https://project-ref.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`
- `SUPABASE_SERVICE_ROLE_KEY=...` (server only)
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (server only)
- `BETA_DAILY_REPORT_LIMIT=3`
- `REPORT_DISPATCH_SECRET=...` (server only; use at least 32 random bytes)

`REPORT_WORKER_ID` and `REPORT_WORKER_POLL_MS` are needed only by the optional persistent Node deployment. Netlify does not poll.

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
- verify Netlify background retries recover without a duplicate report or PDF;
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
- Applied defense-in-depth migration: `20260807215405_enable_private_controls_rls`
- Verification: all 38 live pgTAP assertions passed inside a rolled-back transaction; the four public beta tables and private controls table have RLS enabled, the PDF bucket is private, and the database contains zero test users, invites, jobs, reports, or usage rows.

The previous `rls_disabled` security finding is cleared. The advisor now reports an informational no-policy notice for `bench_private.app_controls`; that is intentional because the table is in an unexposed private schema, all browser-role grants are revoked, and only service-side `SECURITY DEFINER` functions may use it. The advisor also flags the authenticated `SECURITY DEFINER` enqueue RPC; that warning is intentional because the function is the only client write path and performs its own active-invite, owner, quota, queue, and idempotency checks.

Auth redirect URLs, Netlify server secrets, the dedicated Netlify site, and external market-data redistribution permission remain unconfigured. Nothing is publicly deployed yet. The isolated Netlify production bundle completed successfully on 2026-08-07, packaging both `api.mjs` and `report-worker.mjs`; the full local suite passed 382 of 382 tests.
