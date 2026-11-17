-- Advisor fixes.
-- 1) rls_auto_enable() is a platform helper (event trigger) that must not be callable through the REST API.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
-- 2) login_attempts: add a primary key (no_primary_key lint).
alter table public.login_attempts add column id bigint generated always as identity primary key;
revoke all on all sequences in schema public from public, anon, authenticated;
grant usage, select on all sequences in schema public to service_role;
