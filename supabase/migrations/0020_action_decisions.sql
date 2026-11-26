-- 0020_action_decisions.sql
-- What a person did with a proposed action (accept, with any adjustment, or dismiss),
-- plus the baseline needed to measure the result automatically from later sales.
--
-- Actions themselves are computed fresh from the data every time (src/lib/actions);
-- only the human decision is stored. action_key + week_start identifies "this action,
-- this week", so a dismissed action does not reappear until the next week's numbers.

create table if not exists action_decisions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  action_key  text not null,
  week_start  date not null,
  type        text not null check (type in ('restock', 'transfer', 'promote')),
  sku         text not null,
  region      text not null,
  from_region text,
  status      text not null check (status in ('accepted', 'dismissed')),
  quantity    numeric,
  discount    numeric,
  -- what the engine projected at decision time (impact, cover before/after, confidence)
  projected   jsonb not null default '{}'::jsonb,
  -- expected weekly units at decision time: the yardstick for the measured result
  baseline_weekly numeric,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (user_id, action_key, week_start)
);
create index if not exists action_decisions_user_created on action_decisions (user_id, created_at desc);

alter table action_decisions enable row level security;
drop policy if exists action_decisions_select_own on action_decisions;
create policy action_decisions_select_own on action_decisions for select to authenticated using (user_id = auth.uid());
drop policy if exists action_decisions_insert_own on action_decisions;
create policy action_decisions_insert_own on action_decisions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists action_decisions_delete_own on action_decisions;
create policy action_decisions_delete_own on action_decisions for delete to authenticated using (user_id = auth.uid());

revoke all on action_decisions from anon;
grant select, insert, delete on action_decisions to authenticated;
