-- Additive migration. Does not modify demand_shared_state or existing business tables.
begin;
create table if not exists public.demand_ai_workers (
  id uuid primary key,
  submit_hash text not null unique,
  worker_hash text not null unique,
  enabled boolean not null default true,
  last_seen timestamptz
);
create table if not exists public.demand_ai_jobs (
  id uuid primary key,
  worker_id uuid not null references public.demand_ai_workers(id),
  input jsonb not null,
  status text not null default 'queued' check(status in ('queued','running','done','failed','cancelled','expired')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists demand_ai_jobs_worker_created on public.demand_ai_jobs(worker_id,created_at desc);
create index if not exists demand_ai_jobs_pending on public.demand_ai_jobs(worker_id,created_at) where status in ('queued','running');
alter table public.demand_ai_workers enable row level security;
alter table public.demand_ai_jobs enable row level security;
revoke all on public.demand_ai_workers,public.demand_ai_jobs from public,anon,authenticated;

create or replace function public.demand_ai_status(p_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare w public.demand_ai_workers;
begin
 select * into w from public.demand_ai_workers where enabled and submit_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found then raise exception 'AI配对码不正确'; end if;
 return jsonb_build_object('online',coalesce(w.last_seen>now()-interval '30 seconds',false));
end $$;

create or replace function public.demand_ai_submit(p_token text,p_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare w public.demand_ai_workers;
begin
 select * into w from public.demand_ai_workers where enabled and submit_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found then raise exception 'AI配对码不正确'; end if;
 if w.last_seen is null or w.last_seen<now()-interval '30 seconds' then raise exception '负责计算的电脑未连接，请先启动Codex助手'; end if;
 if jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>100000 then raise exception 'AI输入数据不合法'; end if;
 if exists(select 1 from public.demand_ai_jobs where id=p_id and worker_id=w.id) then
   return jsonb_build_object('id',p_id);
 end if;
 update public.demand_ai_jobs set status='expired',error='任务已超时',finished_at=now()
 where worker_id=w.id and ((status='queued' and created_at<now()-interval '5 minutes') or (status='running' and started_at<now()-interval '5 minutes'));
 if exists(select 1 from public.demand_ai_jobs where worker_id=w.id and status in ('queued','running')) then raise exception '已有AI任务正在处理，请稍后重试'; end if;
 if exists(select 1 from public.demand_ai_jobs where worker_id=w.id and created_at>now()-interval '10 seconds') then raise exception '请求过于频繁，请稍后重试'; end if;
 if (select count(*) from public.demand_ai_jobs where worker_id=w.id and created_at>now()-interval '1 hour')>=20 then raise exception '每小时最多20次AI请求，请稍后重试'; end if;
 insert into public.demand_ai_jobs(id,worker_id,input) values(p_id,w.id,p_input);
 return jsonb_build_object('id',p_id);
end $$;

create or replace function public.demand_ai_result(p_token text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare w public.demand_ai_workers; j public.demand_ai_jobs;
begin
 select * into w from public.demand_ai_workers where enabled and submit_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found then raise exception 'AI配对码不正确'; end if;
 select * into j from public.demand_ai_jobs where id=p_id and worker_id=w.id and created_at>now()-interval '24 hours';
 if not found then raise exception '任务不存在或已过期'; end if;
 return jsonb_build_object('status',j.status,'result',j.result,'error',j.error);
end $$;

create or replace function public.demand_ai_cancel(p_token text,p_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare w public.demand_ai_workers;
begin
 select * into w from public.demand_ai_workers where enabled and submit_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found then raise exception 'AI配对码不正确'; end if;
 update public.demand_ai_jobs set status='cancelled',finished_at=now() where worker_id=w.id and id=p_id and status in ('queued','running');
end $$;

create or replace function public.demand_ai_claim(p_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare w public.demand_ai_workers; j public.demand_ai_jobs;
begin
 select * into w from public.demand_ai_workers where enabled and worker_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found then raise exception 'AI助手凭证不正确'; end if;
 update public.demand_ai_workers set last_seen=now() where id=w.id;
 update public.demand_ai_jobs set status='expired',error='任务已超时',finished_at=now()
 where worker_id=w.id and ((status='queued' and created_at<now()-interval '5 minutes') or (status='running' and started_at<now()-interval '5 minutes'));
 if exists(select 1 from public.demand_ai_jobs where worker_id=w.id and status='running') then return null; end if;
 select * into j from public.demand_ai_jobs where worker_id=w.id and status='queued' order by created_at limit 1 for update skip locked;
 if not found then return null; end if;
 update public.demand_ai_jobs set status='running',started_at=now() where id=j.id;
 return jsonb_build_object('id',j.id,'input',j.input);
end $$;

create or replace function public.demand_ai_finish(p_token text,p_id uuid,p_result jsonb,p_error text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare w public.demand_ai_workers;
begin
 select * into w from public.demand_ai_workers where enabled and worker_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found then raise exception 'AI助手凭证不正确'; end if;
 if octet_length(coalesce(p_result::text,''))>100000 then raise exception '结果过大'; end if;
 update public.demand_ai_jobs set status=case when p_error is null then 'done' else 'failed' end,
 result=case when p_error is null then p_result else null end,error=left(p_error,500),finished_at=now()
 where id=p_id and worker_id=w.id and status='running' and started_at>now()-interval '5 minutes';
end $$;
revoke all on function public.demand_ai_status(text), public.demand_ai_submit(text,uuid,jsonb),
 public.demand_ai_result(text,uuid),public.demand_ai_cancel(text,uuid),public.demand_ai_claim(text),
 public.demand_ai_finish(text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.demand_ai_status(text), public.demand_ai_submit(text,uuid,jsonb),
 public.demand_ai_result(text,uuid),public.demand_ai_cancel(text,uuid),public.demand_ai_claim(text),
 public.demand_ai_finish(text,uuid,jsonb,text) to anon,authenticated;
commit;
