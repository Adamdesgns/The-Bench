-- Defense in depth for the service-only generation controls table.
alter table bench_private.app_controls enable row level security;
