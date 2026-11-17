-- Deny-all for anon/authenticated: RLS on every table with NO policies, and no grants.
-- Only the server (service_role key, used inside Vercel Functions) can touch data.
alter table public.blocks           enable row level security;
alter table public.block_committees enable row level security;
alter table public.config           enable row level security;
alter table public.audit_log        enable row level security;
alter table public.login_attempts   enable row level security;

revoke all on table public.blocks, public.block_committees, public.config, public.audit_log, public.login_attempts
  from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

revoke all on function public.replace_blocks(jsonb, text) from public, anon, authenticated;
revoke all on function public.get_blocks() from public, anon, authenticated;
grant execute on function public.replace_blocks(jsonb, text) to service_role;
grant execute on function public.get_blocks() to service_role;
grant all on table public.blocks, public.block_committees, public.config, public.audit_log, public.login_attempts to service_role;
grant usage, select on all sequences in schema public to service_role;
