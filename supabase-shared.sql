-- PUBLIC SHARED WORKSPACE: every visitor can read/edit the same document.
-- Run this whole file once in Supabase > SQL Editor > New query.
-- This file does NOT change the old private demand_dashboard_* tables.
begin;

create table if not exists public.demand_shared_state (
  id smallint primary key check (id=1),
  payload jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  accept_writes boolean not null default true,
  quota_date date not null default current_date,
  writes_today integer not null default 0
);
insert into public.demand_shared_state(id) values(1) on conflict(id) do nothing;
create table if not exists public.demand_shared_history (
  revision bigint primary key,
  payload jsonb not null,
  saved_at timestamptz not null default now()
);
create index if not exists demand_shared_history_saved_idx
  on public.demand_shared_history(saved_at desc);

alter table public.demand_shared_state enable row level security;
alter table public.demand_shared_history enable row level security;
revoke all on public.demand_shared_state from anon,authenticated;
revoke all on public.demand_shared_history from anon,authenticated;
grant select(id,payload,revision,updated_at) on public.demand_shared_state to anon,authenticated;
drop policy if exists shared_public_read on public.demand_shared_state;
create policy shared_public_read on public.demand_shared_state
  for select to anon,authenticated using(id=1);
-- History has no public policy: only the project administrator can restore it.

-- Validate every submitted JSON value, including fields that the current UI ignores.
create or replace function public.demand_shared_json_safe(v jsonb,depth integer default 0)
returns boolean language plpgsql immutable set search_path='' as $$
declare item record; t text;
begin
  if depth>18 then return false; end if;
  case jsonb_typeof(v)
    when 'object' then
      if (select count(*) from jsonb_object_keys(v))>150 then return false; end if;
      for item in select * from jsonb_each(v) loop
        if item.key in ('__proto__','constructor','prototype') or length(item.key)>80
          or not public.demand_shared_json_safe(item.value,depth+1) then return false; end if;
      end loop;
    when 'array' then
      if jsonb_array_length(v)>150 then return false; end if;
      for item in select value from jsonb_array_elements(v) loop
        if not public.demand_shared_json_safe(item.value,depth+1) then return false; end if;
      end loop;
    when 'string' then
      t:=v#>>'{}';
      if length(t)>200 or t ~ '[<>&"'']' then return false; end if;
    when 'number' then
      if abs((v#>>'{}')::numeric)>10000000 then return false; end if;
    when 'boolean' then null;
    when 'null' then null;
    else return false;
  end case;
  return true;
end $$;

create or replace function public.demand_shared_valid(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare m record; r record; g record; k text; idx integer; codes text[];
begin
  if p is null or octet_length(p::text)>1048576 or not public.demand_shared_json_safe(p) then return false; end if;
  if jsonb_typeof(p->'months') is distinct from 'object' or not (p->'months' ? '2026-08')
    or coalesce(p->>'selectedMonth','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or not(p->'months' ? (p->>'selectedMonth')) then return false; end if;
  if (select count(*) from jsonb_object_keys(p->'months'))>120 then return false; end if;
  for m in select * from jsonb_each(p->'months') loop
    if m.key<'2026-08' or m.key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then return false; end if;
    if jsonb_array_length(m.value->'data') is distinct from 7 or jsonb_array_length(m.value->'groups') is distinct from 4
      or jsonb_array_length(m.value->'nonSlots') is distinct from 4 or jsonb_array_length(m.value->'chengduGroups') is distinct from 2 then return false; end if;
    idx:=1;codes:=array['CB','CF','CR','DF','JC','VF','LS'];
    for r in select value from jsonb_array_elements(m.value->'data') loop
      if r.value->>'product' is distinct from codes[idx] then return false; end if;
      foreach k in array array['director','kol','plan','image','cross'] loop
        if jsonb_typeof(r.value->k) is distinct from 'number' or (r.value->>k)::numeric<0
          or (r.value->>k)::numeric<>trunc((r.value->>k)::numeric) then return false; end if;
      end loop;
      idx:=idx+1;
    end loop;
    for g in select value from jsonb_array_elements(m.value->'groups') loop
      if jsonb_typeof(g.value->'products') is distinct from 'array'
        or jsonb_typeof(g.value->'name') is distinct from 'string'
        or jsonb_typeof(g.value->'owner') is distinct from 'string' then return false; end if;
      foreach k in array array['innovation','playable','chengdu','avgTime','people','fulltime','leave','temporary'] loop
        if jsonb_typeof(g.value->k) is distinct from 'number' or (g.value->>k)::numeric<0 then return false; end if;
        if k not in ('avgTime','people') and (g.value->>k)::numeric<>trunc((g.value->>k)::numeric) then return false; end if;
      end loop;
      if (g.value->>'avgTime')::numeric<=0 then return false; end if;
      for r in select value from jsonb_array_elements(g.value->'products') loop
        if not ((r.value#>>'{}')=any(codes)) then return false; end if;
      end loop;
    end loop;
    if (select count(*) from jsonb_array_elements(m.value->'groups') a,
      jsonb_array_elements(a->'products') b)<>7 or
      (select count(distinct b) from jsonb_array_elements(m.value->'groups') a,
      jsonb_array_elements(a->'products') b)<>7 then return false; end if;
    idx:=1;codes:=array['TU+MT','RD','DEER','CBR+BJO+SORT+HOLE'];
    for r in select value from jsonb_array_elements(m.value->'nonSlots') loop
      if r.value->>'product' is distinct from codes[idx] then return false; end if;
      foreach k in array array['demand','reservedTime'] loop
        if jsonb_typeof(r.value->k) is distinct from 'number' or (r.value->>k)::numeric<0 then return false; end if;
      end loop;
      if (r.value->>'demand')::numeric<>trunc((r.value->>'demand')::numeric) then return false; end if;
      idx:=idx+1;
    end loop;
    idx:=0;
    for g in select value from jsonb_array_elements(m.value->'chengduGroups') loop
      if jsonb_typeof(g.value->'name') is distinct from 'string' or jsonb_typeof(g.value->'owner') is distinct from 'string' then return false; end if;
      foreach k in array array['people','leave'] loop
        if jsonb_typeof(g.value->k) is distinct from 'number' or (g.value->>k)::numeric<0 then return false; end if;
      end loop;
      if (g.value->>'leave')::numeric<>trunc((g.value->>'leave')::numeric) then return false; end if;
      codes:=case when idx=0 then array['SLOTS','TU+MT','RD','DEER'] else array['TU+MT'] end;
      if jsonb_array_length(g.value->'products') is distinct from array_length(codes,1) then return false; end if;
      for r in select value,ordinality from jsonb_array_elements(g.value->'products') with ordinality loop
        if r.value->>'product' is distinct from codes[r.ordinality] then return false; end if;
        foreach k in array array['demand','avgTime'] loop
          if jsonb_typeof(r.value->k) is distinct from 'number' or (r.value->>k)::numeric<0 then return false; end if;
        end loop;
        if (r.value->>'demand')::numeric<>trunc((r.value->>'demand')::numeric) then return false; end if;
      end loop;
      idx:=idx+1;
    end loop;
    if m.value ? 'dateRange' then
      if coalesce(m.value->'dateRange'->>'start','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or coalesce(m.value->'dateRange'->>'end','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
      if (m.value->'dateRange'->>'end')::date < (m.value->'dateRange'->>'start')::date
        or (m.value->'dateRange'->>'end')::date-(m.value->'dateRange'->>'start')::date>366 then return false; end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create or replace function public.save_demand_shared(expected_revision bigint,new_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row public.demand_shared_state%rowtype; result jsonb;
begin
  -- All public writes must pass through this RPC; no client table INSERT/UPDATE/DELETE grants.
  if not public.demand_shared_valid(new_payload) then raise exception 'INVALID_PAYLOAD'; end if;
  select * into current_row from public.demand_shared_state where id=1 for update;
  if not found then raise exception 'WORKSPACE_NOT_CONFIGURED'; end if;
  if not current_row.accept_writes then raise exception 'WRITES_PAUSED'; end if;
  if expected_revision<>current_row.revision or expected_revision is null then raise exception 'VERSION_CONFLICT'; end if;
  if current_row.revision>0 and current_row.updated_at>clock_timestamp()-interval '1 second' then
    raise exception 'RATE_LIMIT: retry after 1 second';
  end if;
  if current_row.quota_date=current_date and current_row.writes_today>=2000 then raise exception 'DAILY_WRITE_LIMIT'; end if;
  update public.demand_shared_state set payload=new_payload,revision=revision+1,updated_at=clock_timestamp(),
    writes_today=case when quota_date=current_date then writes_today+1 else 1 end,quota_date=current_date
    where id=1 returning jsonb_build_object('payload',payload,'revision',revision,'updated_at',updated_at) into result;
  insert into public.demand_shared_history(revision,payload) values((result->>'revision')::bigint,new_payload);
  return result;
end $$;
revoke all on function public.demand_shared_json_safe(jsonb,integer) from public,anon,authenticated;
revoke all on function public.demand_shared_valid(jsonb) from public,anon,authenticated;
revoke all on function public.save_demand_shared(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_demand_shared(bigint,jsonb) to anon,authenticated;
commit;

-- Administrator emergency stop (do NOT execute unless needed):
-- update public.demand_shared_state set accept_writes=false where id=1;
-- Public reads are intentional. "device_id" is never an authorization credential.
-- Global limits reduce accidental writes; they cannot prevent all abuse of a public app.
