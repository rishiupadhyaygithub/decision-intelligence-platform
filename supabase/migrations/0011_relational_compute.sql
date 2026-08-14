-- 0011_relational_compute.sql

-- 1. revenue_trend_recent & revenue_anomaly_z
-- Input: v_revenue_by_region_daily
-- Logic: group by region, sort by date. Last 4 = recent, rest = base.
-- delta = (mean(recent) - mean(base)) / mean(base)
-- z = (mean(recent) - mean(base)) / std(base)
CREATE OR REPLACE VIEW v_fact_revenue_trend AS
WITH ranked AS (
    SELECT sale_date, region, revenue,
           row_number() over (partition by region order by sale_date desc) as rn
    FROM v_revenue_by_region_daily
),
stats AS (
    SELECT region,
           avg(revenue) filter (where rn <= 4) as mean_recent,
           avg(revenue) filter (where rn > 4) as mean_base,
           stddev(revenue) filter (where rn > 4) as std_base,
           count(*) as total_rows
    FROM ranked
    GROUP BY region
)
SELECT region,
       CASE WHEN mean_base > 0 THEN ((mean_recent - mean_base) / mean_base) * 100 ELSE 0 END as delta_pct,
       CASE WHEN std_base > 0 THEN (mean_recent - mean_base) / std_base ELSE 0 END as z_score,
       total_rows
FROM stats
WHERE total_rows >= 6;

-- 2. sku_velocity_delta
-- Input: v_sku_velocity
-- Logic: last 1 = last, rest = prior. delta = (last - mean(prior)) / mean(prior)
CREATE OR REPLACE VIEW v_fact_sku_velocity AS
WITH ranked AS (
    SELECT sku_id, region, units,
           row_number() over (partition by sku_id, region order by week desc) as rn
    FROM v_sku_velocity
),
stats AS (
    SELECT sku_id, region,
           avg(units) filter (where rn = 1) as last_val,
           avg(units) filter (where rn > 1) as mean_prior,
           count(*) as total_rows
    FROM ranked
    GROUP BY sku_id, region
)
SELECT sku_id, region,
       CASE WHEN mean_prior > 0 THEN ((last_val - mean_prior) / mean_prior) * 100 ELSE 0 END as delta_pct,
       total_rows
FROM stats
WHERE total_rows >= 4;

-- 3. inventory_cover_ratio
-- Input: v_inventory_risk
-- Logic: Latest snapshot per sku/region.
CREATE OR REPLACE VIEW v_fact_inventory AS
SELECT DISTINCT ON (sku_id, region)
       sku_id, region, cover_ratio, below_reorder
FROM v_inventory_risk
ORDER BY sku_id, region, snapshot_date DESC;

-- 4. competitor_pressure_pct
-- Input: v_competitor_pressure
-- Logic: urgent_signals / total_signals
CREATE OR REPLACE VIEW v_fact_competitor AS
SELECT category,
       CASE WHEN total_signals > 0 THEN (urgent_signals::numeric / total_signals) * 100 ELSE 0 END as pressure_pct,
       total_signals
FROM v_competitor_pressure;
