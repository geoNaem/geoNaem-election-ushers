-- Audit trail (event type, ip, short detail; no personal data) and persistent login rate limiting.
create table public.audit_log (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  action text not null,
  ip     text,
  detail text
);

create table public.login_attempts (
  ip text not null,
  at timestamptz not null default now()
);
create index login_attempts_ip_at_idx on public.login_attempts (ip, at);
