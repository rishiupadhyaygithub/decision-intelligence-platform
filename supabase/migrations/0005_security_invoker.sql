-- 0005: harden analytics views + RPC grants
-- Baseline note: 0001-0003 were applied out-of-band via GitHub auto-migration
-- and are NOT in the supabase_migrations ledger. They are the deployed baseline.
-- Do not re-run them against the live DB. 0004+ are ledger-tracked.

-- Flip all analytics views to SECURITY INVOKER so they respect the querying
-- user's RLS instead of the view creator's (fixes lint 0010, ERROR level).
alter view v_revenue_daily            set (security_invoker = on);
alter view v_revenue_by_region_daily  set (security_invoker = on);
alter view v_sku_velocity             set (security_invoker = on);
alter view v_region_demand            set (security_invoker = on);
alter view v_margin                   set (security_invoker = on);
alter view v_inventory_risk           set (security_invoker = on);
alter view v_competitor_pressure      set (security_invoker = on);

-- save_decision_bundle self-guards on null auth.uid(), but anon should never
-- reach it. Revoke to silence lint 0028 and harden (defense in depth).
revoke execute on function public.save_decision_bundle(jsonb) from anon;
