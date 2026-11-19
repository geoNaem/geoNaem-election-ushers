-- "People served": one row per membership number looked up (first lookup time wins). Server-side authoritative committee.
create table public.served (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  suffix    text not null check (suffix in ('', 'ع', 'د', 'ب', 'بع', 'دب', '*')),
  n         int check (n between 1 and 999999),
  committee int check (committee between 1 and 100),   -- null = number not in the list
  constraint served_id_key unique (suffix, n),          -- NULL n (foreign '*') never conflicts: each foreign lookup is its own row
  constraint served_n_chk check ((suffix = '*' and n is null) or (suffix <> '*' and n is not null))
);
create index served_at_idx on public.served (at desc);

alter table public.served enable row level security;     -- deny-all: no policies
revoke all on table public.served from public, anon, authenticated;
grant all on table public.served to service_role;
revoke all on all sequences in schema public from public, anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

-- record_served: idempotent insert; p_ago = seconds between the lookup and now (offline queue), clamped to 0..86400.
create or replace function public.record_served(p_suffix text, p_n int, p_committee int, p_ago int default 0)
returns boolean
language plpgsql
set search_path = ''
as $$
declare ins int;
begin
  insert into public.served (at, suffix, n, committee)
  values (now() - make_interval(secs => greatest(0, least(coalesce(p_ago, 0), 86400))), p_suffix, p_n, p_committee)
  on conflict (suffix, n) do nothing;
  get diagnostics ins = row_count;
  return ins > 0;
end;
$$;

create or replace function public.served_stats()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'entries',   (select count(*) from public.served),
    'served',    (select count(*) from public.served where committee is not null and suffix <> '*'),
    'foreign',   (select count(*) from public.served where suffix = '*'),
    'not_found', (select count(*) from public.served where committee is null),
    'by_suffix', coalesce((select jsonb_object_agg(suffix, c)
                           from (select suffix, count(*) c from public.served where committee is not null and suffix <> '*' group by suffix) t), '{}'::jsonb));
$$;

-- clear_served: remove every entry (as if nothing was entered) and leave one audit row.
create or replace function public.clear_served(p_ip text)
returns int
language plpgsql
set search_path = ''
as $$
declare removed int;
begin
  delete from public.served where true;
  get diagnostics removed = row_count;
  insert into public.audit_log (action, ip, detail) values ('served.clear', p_ip, removed || ' entries removed');
  return removed;
end;
$$;

revoke all on function public.record_served(text, int, int, int) from public, anon, authenticated;
revoke all on function public.served_stats() from public, anon, authenticated;
revoke all on function public.clear_served(text) from public, anon, authenticated;
grant execute on function public.record_served(text, int, int, int) to service_role;
grant execute on function public.served_stats() to service_role;
grant execute on function public.clear_served(text) to service_role;
