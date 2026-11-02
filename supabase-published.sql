-- ADDITIVE migration. No changes to demand_shared_* tables, records or permissions.
-- Intentionally public publishing, as requested. This is NOT identity-based authorization.
-- The viewer has no write UI; someone who calls the public RPC can still publish.
begin;
create table if not exists public.demand_published_control (
  view_id text primary key check (view_id in ('products','groups')),
  enabled boolean not null default true,
  last_write timestamptz,
  quota_day date not null default current_date,
  writes_today integer not null default 0
);
insert into public.demand_published_control(view_id) values ('products'),('groups')
on conflict do nothing;
create table if not exists public.demand_published_months (
  view_id text not null references public.demand_published_control(view_id),
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and month >= '2026-11'),
  payload jsonb not null,
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key(view_id,month)
);
create table if not exists public.demand_published_history (
  view_id text not null,
  month text not null,
  revision bigint not null,
  payload jsonb not null,
  published_at timestamptz not null default now(),
  primary key(view_id,month,revision)
);
alter table public.demand_published_control enable row level security;
alter table public.demand_published_months enable row level security;
alter table public.demand_published_history enable row level security;
revoke all on public.demand_published_control,public.demand_published_months,public.demand_published_history from public,anon,authenticated;
grant select on public.demand_published_months to anon,authenticated;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='demand_published_months' and policyname='published_read') then
    create policy published_read on public.demand_published_months for select to anon,authenticated using(month >= '2026-11');
  end if;
end $$;

-- Exact key sets keep unrelated private fields out of published snapshots.
create or replace function public.demand_share_keys(v jsonb, keys text[]) returns boolean
language sql immutable set search_path='' as $$
  select case when jsonb_typeof(v)='object' then
    (select array_agg(k order by k) from jsonb_object_keys(v) k)
    = (select array_agg(k order by k) from unnest(keys) k)
  else false end
$$;
create or replace function public.demand_share_numbers(v jsonb, keys text[]) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text;
begin
  foreach k in array keys loop
    if jsonb_typeof(v->k) is distinct from 'number' or abs((v->>k)::numeric)>1000000000000 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
create or replace function public.demand_share_valid(v jsonb, target_view text, target_month text) returns boolean
language plpgsql immutable set search_path='' as $$
declare r jsonb; g jsonb; p jsonb; k text; codes text[]; seen text[] := '{}';
begin
  if v is null or octet_length(v::text)>65536 or v->>'month' is distinct from target_month
    or v->>'schemaVersion' is distinct from '1' then return false; end if;
  if not public.demand_share_keys(v->'period',array['start','end','days','weeks','warning'])
    or not public.demand_share_numbers(v->'period',array['days','weeks'])
    or jsonb_typeof(v->'period'->'warning') is distinct from 'string'
    or length(v->'period'->>'warning')>250
    or jsonb_typeof(v->'period'->'start') is distinct from 'string'
    or jsonb_typeof(v->'period'->'end') is distinct from 'string'
    or (v->'period'->>'start') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (v->'period'->>'end') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (v->'period'->>'end')::date < (v->'period'->>'start')::date
    or (v->'period'->>'end')::date-(v->'period'->>'start')::date>366
    or (v->'period'->>'days')::numeric not between 0 and 367
    or (v->'period'->>'weeks')::numeric not between 0 and 74
    or (v->'period'->>'days')::numeric<>trunc((v->'period'->>'days')::numeric)
    or (v->'period'->>'weeks')::numeric<>trunc((v->'period'->>'weeks')::numeric) then return false; end if;
  if target_view='products' then
    if not public.demand_share_keys(v,array['schemaVersion','month','period','products','nonSlots'])
      or jsonb_array_length(v->'products') is distinct from 7
      or jsonb_array_length(v->'nonSlots') is distinct from 4 then return false; end if;
    for r in select value from jsonb_array_elements(v->'products') loop
      if not public.demand_share_keys(r,array['product','director','kol','plan','image','cross'])
        or not public.demand_share_numbers(r,array['director','kol','plan','image','cross'])
        or jsonb_typeof(r->'product') is distinct from 'string'
        or not ((r->>'product')=any(array['CB','CF','CR','DF','JC','VF','LS']))
        or r->>'product'=any(seen) then return false; end if;
      seen:=array_append(seen,r->>'product');
      foreach k in array array['director','kol','plan','image','cross'] loop
        if (r->>k)::numeric<0 or (r->>k)::numeric>10000000 or (r->>k)::numeric<>trunc((r->>k)::numeric) then return false; end if;
      end loop;
    end loop;
    seen:='{}';
    for r in select value from jsonb_array_elements(v->'nonSlots') loop
      if not public.demand_share_keys(r,array['product','demand','reservedTime'])
        or not public.demand_share_numbers(r,array['demand','reservedTime'])
        or jsonb_typeof(r->'product') is distinct from 'string'
        or not ((r->>'product')=any(array['TU+MT','RD','DEER','CBR+BJO+SORT+HOLE']))
        or r->>'product'=any(seen) or (r->>'demand')::numeric<0 or (r->>'reservedTime')::numeric<0
        or (r->>'demand')::numeric<>trunc((r->>'demand')::numeric) then return false; end if;
      seen:=array_append(seen,r->>'product');
    end loop;
  elsif target_view='groups' then
    if not public.demand_share_keys(v,array['schemaVersion','month','period','slotsDemand','beijing','chengdu'])
      or not public.demand_share_numbers(v,array['slotsDemand'])
      or jsonb_array_length(v->'beijing') is distinct from 4
      or jsonb_array_length(v->'chengdu') is distinct from 2 then return false; end if;
    for g in select value from jsonb_array_elements(v->'beijing') loop
      if not public.demand_share_keys(g,array['name','owner','products','demand','innovation','playable','total','chengdu','chengduWeek','actual','capacity','avgTime','people','fulltime','leave','temporary'])
        or not public.demand_share_numbers(g,array['demand','innovation','playable','total','chengdu','actual','avgTime','people','fulltime','leave','temporary'])
        or (g->'capacity'<>'null'::jsonb and not public.demand_share_numbers(g,array['capacity']))
        or (g->'chengduWeek'<>'null'::jsonb and not public.demand_share_numbers(g,array['chengduWeek']))
        or jsonb_typeof(g->'name') is distinct from 'string' or length(g->>'name')>80
        or jsonb_typeof(g->'owner') is distinct from 'string' or length(g->>'owner')>80
        or jsonb_typeof(g->'products') is distinct from 'array' or jsonb_array_length(g->'products')>7 then return false; end if;
      for p in select value from jsonb_array_elements(g->'products') loop
        if jsonb_typeof(p) is distinct from 'string' or not ((p#>>'{}')=any(array['CB','CF','CR','DF','JC','VF','LS'])) or (p#>>'{}')=any(seen) then return false; end if;
        seen:=array_append(seen,p#>>'{}');
      end loop;
    end loop;
    if array_length(seen,1) is distinct from 7 then return false; end if;
    codes:=array['SLOTS','TU+MT','RD','DEER'];
    for g in select value from jsonb_array_elements(v->'chengdu') loop
      if not public.demand_share_keys(g,array['name','owner','products','required','capacity','people','leave','participating'])
        or not public.demand_share_numbers(g,array['required','capacity','people','leave'])
        or jsonb_typeof(g->'participating') is distinct from 'boolean'
        or jsonb_typeof(g->'name') is distinct from 'string' or length(g->>'name')>80
        or jsonb_typeof(g->'owner') is distinct from 'string' or length(g->>'owner')>80
        or jsonb_typeof(g->'products') is distinct from 'array'
        or jsonb_array_length(g->'products') is distinct from array_length(codes,1)
        or (g->>'participating')::boolean is distinct from (array_length(codes,1)=4) then return false; end if;
      seen:='{}';
      for p in select value from jsonb_array_elements(g->'products') loop
        if not public.demand_share_keys(p,array['product','demand','days','avgTime'])
          or not public.demand_share_numbers(p,array['demand','days','avgTime'])
          or jsonb_typeof(p->'product') is distinct from 'string'
          or not ((p->>'product')=any(codes)) or (p->>'product')=any(seen) then return false; end if;
        seen:=array_append(seen,p->>'product');
      end loop;
      codes:=array['TU+MT'];
    end loop;
  else return false;
  end if;
  return true;
exception when others then return false;
end $$;

create or replace function public.publish_demand_month(target_view text, target_month text, expected_revision bigint, snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctl public.demand_published_control%rowtype; current_row public.demand_published_months%rowtype; result jsonb;
begin
  if target_view is null or target_view not in ('products','groups') or target_month is null
    or target_month<'2026-11' or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or public.demand_share_valid(snapshot,target_view,target_month) is distinct from true then
    raise exception 'INVALID_SHARE_PAYLOAD';
  end if;
  select * into ctl from public.demand_published_control where view_id=target_view for update;
  if not found or not ctl.enabled then raise exception 'PUBLISH_PAUSED'; end if;
  select * into current_row from public.demand_published_months where view_id=target_view and month=target_month;
  -- Identical replays do not produce extra history or erase newer publications.
  if current_row.payload=snapshot then return to_jsonb(current_row); end if;
  if expected_revision is null or expected_revision<>coalesce(current_row.revision,0) then raise exception 'VERSION_CONFLICT'; end if;
  if ctl.last_write>clock_timestamp()-interval '5 seconds' then raise exception 'RATE_LIMIT'; end if;
  if ctl.quota_day=current_date and ctl.writes_today>=100 then raise exception 'DAILY_PUBLISH_LIMIT'; end if;
  if current_row.revision is null and (select count(*) from public.demand_published_months where view_id=target_view)>=120 then raise exception 'MONTH_LIMIT'; end if;
  if (select count(*) from public.demand_published_history where view_id=target_view)>=5000 then raise exception 'HISTORY_LIMIT'; end if;
  insert into public.demand_published_months(view_id,month,payload,revision,updated_at)
    values(target_view,target_month,snapshot,coalesce(current_row.revision,0)+1,clock_timestamp())
    on conflict(view_id,month) do update set payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at
    returning to_jsonb(demand_published_months.*) into result;
  insert into public.demand_published_history(view_id,month,revision,payload,published_at)
    values(target_view,target_month,(result->>'revision')::bigint,snapshot,(result->>'updated_at')::timestamptz);
  update public.demand_published_control set last_write=clock_timestamp(),quota_day=current_date,
    writes_today=case when quota_day=current_date then writes_today+1 else 1 end where view_id=target_view;
  return result;
end $$;
revoke all on function public.demand_share_keys(jsonb,text[]),public.demand_share_numbers(jsonb,text[]),public.demand_share_valid(jsonb,text,text) from public,anon,authenticated;
revoke all on function public.publish_demand_month(text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.publish_demand_month(text,text,bigint,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
-- Verification only: no initial data is published by this migration.
select view_id,enabled from public.demand_published_control order by view_id;
