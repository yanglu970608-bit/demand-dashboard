-- Run after supabase-shared.sql. Does not clear archives or change working data.
begin;
alter table public.demand_shared_archives add column if not exists name text;
create or replace function public.manage_demand_archive_v2(
  expected_revision bigint, action text, archive_id bigint default null,
  archive_month text default null, new_payload jsonb default null,
  archive_name text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.demand_shared_state%rowtype; result jsonb; a_id bigint;
begin
  select * into s from public.demand_shared_state where id=1 for update;
  if s.payload is null then raise exception 'WORKSPACE_EMPTY'; end if;
  if expected_revision is null or expected_revision<>s.revision then raise exception 'VERSION_CONFLICT'; end if;
  if archive_name is not null and (length(btrim(archive_name))<1 or length(archive_name)>80) then
    raise exception 'INVALID_ARCHIVE_NAME';
  end if;
  if action in ('create','restore') then
    result:=public.manage_demand_archive(expected_revision,action,archive_id,archive_month,new_payload);
    a_id:=(result->>'archive_id')::bigint;
    if action='create' then
      update public.demand_shared_archives set name=coalesce(btrim(archive_name),
        substring(month from 3 for 2)||substring(month from 6 for 2)||'-版本'||version) where id=a_id;
    end if;
    return result;
  elsif action='rename' then
    if archive_name is null then raise exception 'INVALID_ARCHIVE_NAME'; end if;
    if not exists(select 1 from public.demand_shared_archives where id=archive_id and not hidden) then
      raise exception 'ARCHIVE_NOT_FOUND';
    end if;
    result:=public.save_demand_shared(expected_revision,s.payload);
    update public.demand_shared_archives set name=btrim(archive_name) where id=archive_id;
  elsif action='clear' then
    result:=public.save_demand_shared(expected_revision,s.payload);
    update public.demand_shared_archives set hidden=true where not hidden;
  else raise exception 'INVALID_ACTION';
  end if;
  return jsonb_build_object('state',result,'archive_id',archive_id);
end $$;
revoke all on function public.manage_demand_archive_v2(bigint,text,bigint,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.manage_demand_archive_v2(bigint,text,bigint,text,jsonb,text) to anon,authenticated;
commit;
