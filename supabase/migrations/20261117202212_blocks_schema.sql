-- Blocks configuration: named locations and the committees assigned to each.
create table public.blocks (
  id       bigint generated always as identity primary key,
  name     text not null check (char_length(name) between 1 and 40),
  note     text not null default '' check (char_length(note) <= 120),
  position int  not null,
  constraint blocks_name_key unique (name)
);

create table public.block_committees (
  committee int primary key check (committee between 1 and 100), -- a committee belongs to at most one block
  block_id  bigint not null references public.blocks(id) on delete cascade
);
create index block_committees_block_id_idx on public.block_committees (block_id);

create table public.config (
  key   text primary key,
  value text not null
);
insert into public.config (key, value) values ('blocks_version', '0');
