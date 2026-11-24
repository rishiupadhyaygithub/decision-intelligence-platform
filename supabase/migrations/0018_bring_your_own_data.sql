-- 0018_bring_your_own_data.sql
-- Lets a deployment replace the synthetic Savora demo dataset with its own data.
--
-- app_settings.data_mode:
--   'demo'   -> synthetic data; the daily pipeline appends synthetic sales so trends move.
--   'custom' -> the team's own data; the pipeline must NEVER append synthetic rows.
--
-- import_dataset() swaps all four raw tables in ONE transaction: either the whole new
-- dataset lands or nothing changes. It is callable only by service_role; the app route
-- in front of it checks the caller against ADMIN_EMAILS first, because one deployment
-- holds one shared dataset and an import replaces it for every user.
--
-- Facts are not touched here: the caller recomputes them right after, and the pipeline's
-- metric-scoped pruning removes facts for SKUs/regions that no longer exist. Decisions
-- keep their cited values through decision_facts.fact_snapshot.

create table if not exists app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
drop policy if exists app_settings_select_auth on app_settings;
create policy app_settings_select_auth on app_settings for select to authenticated using (true);

insert into app_settings (key, value) values ('data_mode', 'demo')
on conflict (key) do nothing;

create or replace function import_dataset(
  p_skus      jsonb,
  p_sales     jsonb,
  p_inventory jsonb,
  p_signals   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_sku int;
  n_sales int;
  n_inv int;
  n_sig int;
begin
  if jsonb_typeof(p_skus) is distinct from 'array' or jsonb_array_length(p_skus) = 0 then
    raise exception 'import_dataset: skus are required';
  end if;
  if jsonb_typeof(p_sales) is distinct from 'array' or jsonb_array_length(p_sales) = 0 then
    raise exception 'import_dataset: sales are required';
  end if;

  -- "where true": PostgREST sessions may load pg_safeupdate, which rejects bare DELETEs.
  delete from sales where true;
  delete from inventory where true;
  delete from competitor_signal where true;
  delete from sku where true;

  insert into sku (sku_id, name, category, mrp, unit_cost, launched_on)
  select sku_id, name, category, mrp, unit_cost, launched_on
  from jsonb_populate_recordset(null::sku, p_skus);
  get diagnostics n_sku = row_count;

  insert into sales (sku_id, region, channel, sale_date, units, revenue)
  select sku_id, region, channel, sale_date, units, revenue
  from jsonb_populate_recordset(null::sales, p_sales);
  get diagnostics n_sales = row_count;

  insert into inventory (sku_id, region, snapshot_date, on_hand, reorder_point)
  select sku_id, region, snapshot_date, on_hand, reorder_point
  from jsonb_populate_recordset(null::inventory, coalesce(p_inventory, '[]'::jsonb));
  get diagnostics n_inv = row_count;

  insert into competitor_signal (source, category, body, impact, detected_at, urgent)
  select source, category, body, impact, coalesce(detected_at, now()), coalesce(urgent, false)
  from jsonb_populate_recordset(null::competitor_signal, coalesce(p_signals, '[]'::jsonb));
  get diagnostics n_sig = row_count;

  insert into app_settings (key, value, updated_at) values ('data_mode', 'custom', now())
  on conflict (key) do update set value = 'custom', updated_at = now();

  return jsonb_build_object('skus', n_sku, 'sales', n_sales, 'inventory', n_inv, 'signals', n_sig);
end;
$$;

revoke all on function import_dataset(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function import_dataset(jsonb, jsonb, jsonb, jsonb) to service_role;
