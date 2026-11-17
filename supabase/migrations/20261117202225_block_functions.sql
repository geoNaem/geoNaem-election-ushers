-- get_blocks(): the public GET /api/blocks shape in one consistent read.
create or replace function public.get_blocks()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'version', (select value::int from public.config where key = 'blocks_version'),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'note', b.note,
        'committees', coalesce((select jsonb_agg(bc.committee order by bc.committee)
                                from public.block_committees bc where bc.block_id = b.id), '[]'::jsonb)
      ) order by b.position)
      from public.blocks b), '[]'::jsonb));
$$;

-- replace_blocks(): ONE transaction (function body): delete all, re-insert, bump version, audit, return new state.
-- The API validates first; table constraints (length, range, unique committee/name) re-check everything here.
create or replace function public.replace_blocks(p_blocks jsonb, p_ip text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  b jsonb; c jsonb; new_id bigint; pos int := 0; assigned int := 0;
begin
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'blocks must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_blocks) > 30 then
    raise exception 'too many blocks' using errcode = '22023';
  end if;

  delete from public.blocks where true; -- cascades to block_committees

  for b in select value from jsonb_array_elements(p_blocks) loop
    insert into public.blocks (name, note, position)
    values (b->>'name', coalesce(b->>'note', ''), pos)
    returning id into new_id;
    for c in select value from jsonb_array_elements(coalesce(b->'committees', '[]'::jsonb)) loop
      if jsonb_typeof(c) <> 'number' or (c#>>'{}') !~ '^[0-9]+$' then
        raise exception 'committee must be an integer' using errcode = '22023';
      end if;
      insert into public.block_committees (committee, block_id) values ((c#>>'{}')::int, new_id);
      assigned := assigned + 1;
    end loop;
    pos := pos + 1;
  end loop;

  update public.config set value = ((value::int) + 1)::text where key = 'blocks_version';
  insert into public.audit_log (action, ip, detail)
  values ('blocks.replace', p_ip, pos || ' blocks, ' || assigned || ' committees assigned');

  return public.get_blocks();
end;
$$;
