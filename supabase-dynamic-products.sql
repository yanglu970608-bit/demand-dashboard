-- Compatibility upgrade only. No business data, policies, grants or rate limits change.
begin;
do $migration$
declare
  definition text;
  original text;
  names text := '^[A-Z0-9一-鿿][A-Z0-9一-鿿 +_.()-]{0,29}$';
begin
  definition := pg_get_functiondef('public.demand_shared_valid(jsonb)'::regprocedure);
  if position('DYNAMIC_PRODUCTS_V1' in definition)=0 then
    if position('jsonb_array_length(m.value->''nonSlots'') is distinct from 4' in definition)=0
      or position('if r.value->>''product'' is distinct from codes[r.ordinality]' in definition)=0 then
      raise exception 'Unexpected shared validator definition; upgrade cancelled';
    end if;
    definition:=replace(definition,
      'jsonb_array_length(m.value->''nonSlots'') is distinct from 4',
      'coalesce(jsonb_array_length(m.value->''nonSlots''),0) not between 4 and 60');
    -- Only replace the non-SLOTS occurrence; SLOTS order stays fixed.
    original:='idx:=1;codes:=array[''TU+MT'',''RD'',''DEER'',''CBR+BJO+SORT+HOLE''];';
    if position(original in definition)=0 then raise exception 'Unexpected non-SLOTS validator'; end if;
    definition:=replace(definition,original,original || '
    -- DYNAMIC_PRODUCTS_V1
    if (select count(distinct a->>''product'') from jsonb_array_elements(m.value->''nonSlots'') a)
      <>jsonb_array_length(m.value->''nonSlots'') then return false; end if;');
    original:=substring(definition from 'for r in select value from jsonb_array_elements\(m.value->''nonSlots''\) loop[[:space:]]+if r.value->>''product'' is distinct from codes\[idx\] then return false; end if;');
    if original is null then raise exception 'Unexpected non-SLOTS loop'; end if;
    definition:=replace(definition,original,format(
      'for r in select value from jsonb_array_elements(m.value->''nonSlots'') loop
      if (idx<=4 and r.value->>''product'' is distinct from codes[idx])
        or coalesce(r.value->>''product'','''') !~ %L
        or r.value->>''product''=any(array[''SLOTS'',''CC'',''CB'',''CF'',''CR'',''DF'',''JC'',''VF'',''LS''])
        then return false; end if;', names));
    definition:=replace(definition,
      'jsonb_array_length(g.value->''products'') is distinct from array_length(codes,1)',
      'coalesce(jsonb_array_length(g.value->''products''),0) not between array_length(codes,1) and 30
        or (select count(distinct a->>''product'') from jsonb_array_elements(g.value->''products'') a)<>jsonb_array_length(g.value->''products'')');
    definition:=replace(definition,
      'if r.value->>''product'' is distinct from codes[r.ordinality] then return false; end if;',
      'if (r.ordinality<=array_length(codes,1) and r.value->>''product'' is distinct from codes[r.ordinality])
        or (r.ordinality>array_length(codes,1) and not exists(
          select 1 from jsonb_array_elements(m.value->''nonSlots'') n where n->>''product''=r.value->>''product''))
        then return false; end if;');
    execute definition;
  end if;
  definition := pg_get_functiondef('public.demand_share_valid(jsonb,text,text)'::regprocedure);
  if position('DYNAMIC_PRODUCTS_V1' in definition)=0 then
    if position('jsonb_array_length(v->''nonSlots'') is distinct from 4' in definition)=0
      or position('or not ((p->>''product'')=any(codes))' in definition)=0 then
      raise exception 'Unexpected share validator definition; upgrade cancelled';
    end if;
    definition:=replace(definition,
      'jsonb_array_length(v->''nonSlots'') is distinct from 4',
      'coalesce(jsonb_array_length(v->''nonSlots''),0) not between 4 and 60');
    definition:=replace(definition,
      'or not ((r->>''product'')=any(array[''TU+MT'',''RD'',''DEER'',''CBR+BJO+SORT+HOLE'']))',
      format('or coalesce(r->>''product'','''') !~ %L
        or r->>''product''=any(array[''SLOTS'',''CC'',''CB'',''CF'',''CR'',''DF'',''JC'',''VF'',''LS''])',names));
    definition:=replace(definition,'elsif target_view=''groups'' then',
      '-- DYNAMIC_PRODUCTS_V1
    if not (array[''TU+MT'',''RD'',''DEER'',''CBR+BJO+SORT+HOLE''] <@ seen) then return false; end if;
  elsif target_view=''groups'' then');
    definition:=replace(definition,
      'jsonb_array_length(g->''products'') is distinct from array_length(codes,1)',
      'coalesce(jsonb_array_length(g->''products''),0) not between array_length(codes,1) and 30');
    definition:=replace(definition,'or not ((p->>''product'')=any(codes))',
      format('or coalesce(p->>''product'','''') !~ %L
          or (not ((p->>''product'')=any(codes)) and p->>''product''=any(array[''SLOTS'',''CC'',''CB'',''CF'',''CR'',''DF'',''JC'',''VF'',''LS'']))
          or (p->>''demand'')::numeric<0 or (p->>''demand'')::numeric<>trunc((p->>''demand'')::numeric)
          or (p->>''days'')::numeric<0 or (p->>''avgTime'')::numeric<0',names));
    definition:=replace(definition,'codes:=array[''TU+MT''];',
      'if not (codes <@ seen) then return false; end if;
      codes:=array[''TU+MT''];');
    execute definition;
  end if;
  -- Fail closed if the upgrade would invalidate any current document or published snapshot.
  if exists(select 1 from public.demand_shared_state where payload is not null and not public.demand_shared_valid(payload))
    or exists(select 1 from public.demand_published_months where not public.demand_share_valid(payload,view_id,month))
    then raise exception 'Existing data validation failed; upgrade rolled back'; end if;
end $migration$;
commit;
