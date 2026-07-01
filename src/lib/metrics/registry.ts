// W0.2 — Metrics registry.
// Single source of truth for every metric the platform computes.
// Each entry pins: how it's computed, what unit it carries, who owns it.
// Facts rows reference these via formula_id; UI surfaces this on hover.

export type MetricLayer = "L1" | "L2" | "L3" | "L4";
export type MetricKind = "sql" | "ml" | "rule";

export interface MetricSpec {
  id: string;
  layer: MetricLayer;
  kind: MetricKind;
  unit: "INR" | "pct" | "ratio" | "count" | "days" | "score" | "boolean";
  description: string;
  formula: string;           // SQL expression or model name
  inputs: string[];          // table or fact dependencies
  freshness_window_hrs: number;
  owner: "data" | "ml" | "ops";
}

export const METRICS: Record<string, MetricSpec> = {
  // ---------- L1 DESCRIPTIVE ----------
  revenue_4w: {
    id: "revenue_4w",
    layer: "L1",
    kind: "sql",
    unit: "INR",
    description: "Trailing 4-week revenue per (sku, region).",
    formula: "sum(weekly_sales.units * weekly_sales.price) over last 4 weeks",
    inputs: ["weekly_sales_by_sku_region"],
    freshness_window_hrs: 168,
    owner: "data",
  },
  volume_delta_pct_4w: {
    id: "volume_delta_pct_4w",
    layer: "L1",
    kind: "sql",
    unit: "pct",
    description: "Units sold last 4w vs prior 4w, per (sku, region).",
    formula: "(units_last_4w - units_prior_4w) / nullif(units_prior_4w, 0)",
    inputs: ["weekly_sales_by_sku_region"],
    freshness_window_hrs: 168,
    owner: "data",
  },
  stockout_risk: {
    id: "stockout_risk",
    layer: "L1",
    kind: "sql",
    unit: "ratio",
    description: "Inventory days-of-cover vs lead time.",
    formula: "days_of_cover / nullif(lead_time_days, 0)",
    inputs: ["inventory_snapshots", "skus"],
    freshness_window_hrs: 24,
    owner: "ops",
  },
  competitor_price_delta: {
    id: "competitor_price_delta",
    layer: "L1",
    kind: "sql",
    unit: "INR",
    description: "Our price minus closest competitor price for same pack.",
    formula: "our_price - competitor_price",
    inputs: ["price_snapshots", "competitor_signals"],
    freshness_window_hrs: 48,
    owner: "data",
  },

  // ---------- L2 DIAGNOSTIC ----------
  driver_contribution: {
    id: "driver_contribution",
    layer: "L2",
    kind: "ml",
    unit: "pct",
    description: "Share of weekly volume variance explained by a driver.",
    formula: "linreg coefficient × stddev(driver) / stddev(target)",
    inputs: ["facts:volume_delta_pct_4w", "facts:competitor_price_delta", "facts:demand_signal"],
    freshness_window_hrs: 168,
    owner: "ml",
  },
  anomaly_flag: {
    id: "anomaly_flag",
    layer: "L2",
    kind: "rule",
    unit: "boolean",
    description: "True when actual − forecast > 2σ of residuals.",
    formula: "abs(actual - forecast) > 2 * residual_sigma",
    inputs: ["facts:revenue_4w", "facts:forecast_revenue_4w"],
    freshness_window_hrs: 168,
    owner: "ml",
  },

  // ---------- L3 PREDICTIVE ----------
  forecast_volume_4w: {
    id: "forecast_volume_4w",
    layer: "L3",
    kind: "ml",
    unit: "count",
    description: "P50 forecast of units for next 4 weeks.",
    formula: "ml/forecast.py v3 — Prophet on weekly_sales with covariates",
    inputs: ["weekly_sales_by_sku_region", "facts:competitor_price_delta"],
    freshness_window_hrs: 168,
    owner: "ml",
  },
  churn_risk_sku: {
    id: "churn_risk_sku",
    layer: "L3",
    kind: "ml",
    unit: "score",
    description: "Probability an SKU loses >20% volume next quarter.",
    formula: "ml/churn.py v2 — GBM",
    inputs: ["weekly_sales_by_sku_region", "facts:stockout_risk"],
    freshness_window_hrs: 720,
    owner: "ml",
  },

  // ---------- L4 PRESCRIPTIVE ----------
  recommendation_confidence: {
    id: "recommendation_confidence",
    layer: "L4",
    kind: "rule",
    unit: "score",
    description: "data_health × forecast_certainty × driver_clarity.",
    formula: "mean(data_health of cited facts) * (1 - forecast_cv) * driver_top1_share",
    inputs: ["facts:*"],
    freshness_window_hrs: 24,
    owner: "data",
  },
};

export function getMetric(id: string): MetricSpec | undefined {
  return METRICS[id];
}

export function metricsByLayer(layer: MetricLayer): MetricSpec[] {
  return Object.values(METRICS).filter((m) => m.layer === layer);
}
