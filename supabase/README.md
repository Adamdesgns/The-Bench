# The Bench invite-only beta schema

This directory defines the database boundary for the first hosted beta. It does
not make the current Electron server public by itself.

## Authorization contract

An account can use the beta only when both checks pass:

1. The signed-in user's immutable `app_metadata.bench_beta` claim is `invited`.
2. `bench_beta_invites` has a non-expired `active` row bound to that user ID.

Changing `user_metadata` never grants access. Revoking the database invite takes
effect immediately; changing `app_metadata` requires the user to refresh their
session before the JWT reflects it.

Users enqueue through `bench_enqueue_report`; they have no direct table insert
or update permission. The RPC atomically enforces idempotency, the invite's daily
quota (three reports by default), one active job per user, a private global queue
cap, and an emergency generation kill switch. Users can read only their own jobs,
reports, and usage. They cannot forge reports or upload PDFs. A trusted worker
claims jobs with `bench_claim_report_job`, uploads the PDF to the private
`bench-report-pdfs` bucket, then atomically finishes the job with
`bench_finish_report_job`. Those RPCs are executable by `service_role` only. The
service-role key must never appear in Electron, browser code, logs, or a shipped
environment file.

PDF keys are exactly `<owner_id>/<report_id>.pdf`. Authenticated downloads are
allowed only when the path belongs to the caller and matches a report row they
own. Prefer short-lived signed URLs produced by the trusted backend.

## Applying and testing

The migration filename was created directly because the Supabase CLI was not
installed in this worktree. Before connecting a project, install/authenticate a
current CLI, then run its documented commands:

```powershell
supabase --version
supabase start
supabase db reset
supabase test db
supabase db lint
```

`tests/001_invite_beta_rls.sql` is the database/RLS test suite.
`tests/schema-contract.test.mjs` is an offline guard that can run without Docker:

```powershell
node --test supabase/tests/schema-contract.test.mjs
```

No production project is linked, and this migration must not be pushed remotely
until the local database tests and Supabase security advisors pass.
