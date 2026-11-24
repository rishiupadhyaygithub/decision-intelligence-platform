-- 0019_lock_down_public_access.sql
-- Close what the Supabase security advisor found open to the `anon` role. The anon key
-- ships to every browser, so "anon can" means "anyone on the internet can".
--
-- 1. v_fact_* views ran as SECURITY DEFINER (0005 flipped the 0002 views to invoker, but
--    these four came later and never were), so anon could read revenue trend, SKU
--    velocity, inventory and competitor aggregates straight past row-level security.
--    As invoker they respect RLS: authenticated users still read them (raw-table
--    policies allow it); the pipeline uses service_role and is unaffected.
-- 2. publish_facts (SECURITY DEFINER) was executable by anon and authenticated: anyone
--    could overwrite or delete the facts every recommendation is grounded on. Only the
--    pipeline / import (service_role) may publish.
-- 3. save_decision_lineage: no longer called by the app (analysis is a preview since
--    0016; saving goes through save_decision_bundle). Server-only.
-- 4. check_rate_limit: signed-in users only (anon got EXECUTE from default privileges).
-- 5. get_my_role: pin search_path (advisor: function_search_path_mutable).
-- 6. Belt and braces: anon has no business reading any analytics view.

alter view v_fact_revenue_trend set (security_invoker = on);
alter view v_fact_sku_velocity  set (security_invoker = on);
alter view v_fact_inventory     set (security_invoker = on);
alter view v_fact_competitor    set (security_invoker = on);

revoke execute on function publish_facts(jsonb, text[]) from public, anon, authenticated;
grant execute on function publish_facts(jsonb, text[]) to service_role;

revoke execute on function save_decision_lineage(jsonb, jsonb) from public, anon, authenticated;
grant execute on function save_decision_lineage(jsonb, jsonb) to service_role;

revoke execute on function check_rate_limit(text, integer, integer) from public, anon;
grant execute on function check_rate_limit(text, integer, integer) to authenticated;

alter function get_my_role() set search_path = public;

revoke select on
  v_revenue_daily, v_revenue_by_region_daily, v_sku_velocity, v_region_demand, v_margin,
  v_inventory_risk, v_competitor_pressure,
  v_fact_revenue_trend, v_fact_sku_velocity, v_fact_inventory, v_fact_competitor
from anon;
