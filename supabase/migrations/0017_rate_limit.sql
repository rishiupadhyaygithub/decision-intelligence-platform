-- 0017_rate_limit.sql
-- Per-user rate limit for the LLM-backed endpoint (/api/analyze-decision makes up to
-- three Gemini calls per request). Postgres-backed because the app runs on serverless
-- instances: an in-memory counter is per-instance and resets on every cold start.
--
-- check_rate_limit() records the call and returns false once the caller has made
-- p_max calls to p_route inside the window. The table has RLS enabled and no
-- policies, so it is reachable only through this SECURITY DEFINER function, and a
-- caller can only ever count or record their own (auth.uid()) usage.

create table if not exists api_rate_events (
  user_id uuid        not null,
  route   text        not null,
  at      timestamptz not null default now()
);
create index if not exists api_rate_events_user_route_at on api_rate_events (user_id, route, at desc);
alter table api_rate_events enable row level security;

create or replace function check_rate_limit(p_route text, p_max int, p_window_secs int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    return false;
  end if;

  -- Housekeeping, scoped to this caller so it stays an index range delete.
  delete from api_rate_events
  where user_id = v_uid and route = p_route and at < now() - interval '1 day';

  select count(*) into v_n
  from api_rate_events
  where user_id = v_uid and route = p_route
    and at > now() - make_interval(secs => greatest(p_window_secs, 1));

  if v_n >= p_max then
    return false;
  end if;

  insert into api_rate_events (user_id, route) values (v_uid, p_route);
  return true;
end;
$$;

revoke all on function check_rate_limit(text, int, int) from public;
grant execute on function check_rate_limit(text, int, int) to authenticated;
