-- 0002_views.sql — derived analytics views over the 0001 raw tables.
-- These feed scripts/facts/compute.mjs, which writes rows into `facts`.

create or replace view v_revenue_daily as
select sale_date, region, channel,
       sum(revenue) as revenue, sum(units) as units, count(*) as rows
from sales
group by sale_date, region, channel;

-- Region-level daily revenue (channels summed) — used by fact compute for trend/z-score
create or replace view v_revenue_by_region_daily as
select sale_date, region,
       sum(revenue) as revenue, sum(units) as units
from sales
group by sale_date, region;

create or replace view v_sku_velocity as
select sku_id, region,
       date_trunc('week', sale_date)::date as week,
       sum(units) as units, sum(revenue) as revenue
from sales
group by sku_id, region, date_trunc('week', sale_date);

create or replace view v_region_demand as
select region,
       date_trunc('month', sale_date)::date as month,
       sum(units) as units, sum(revenue) as revenue
from sales
group by region, date_trunc('month', sale_date);

create or replace view v_margin as
select sk.sku_id, sk.name, sk.category, sk.mrp, sk.unit_cost,
       round(sk.mrp - sk.unit_cost, 2) as unit_margin,
       round(((sk.mrp - sk.unit_cost) / nullif(sk.mrp, 0)) * 100, 2) as margin_pct
from sku sk;

create or replace view v_inventory_risk as
select i.sku_id, i.region, i.snapshot_date, i.on_hand, i.reorder_point,
       (i.on_hand <= i.reorder_point) as below_reorder,
       round(i.on_hand::numeric / nullif(i.reorder_point, 0), 2) as cover_ratio
from inventory i;

create or replace view v_competitor_pressure as
select category,
       count(*) filter (where urgent) as urgent_signals,
       count(*) as total_signals,
       max(detected_at) as latest
from competitor_signal
group by category;
