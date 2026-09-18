// scripts/facts/registry.mjs
// Health-scoring tuning for the metrics the pipeline ACTUALLY computes.
//
// Why this file exists: scoreHealth() takes a registry but compute.mjs called it
// as scoreHealth(facts) with none, so every metric fell back to target_n = 12.
// That default is wrong for snapshot metrics, where a single row is the complete
// answer rather than a 1/12th sample:
//
//   inventory_cover_ratio  n=1  ->  completeness 0.083 x conf(1)=0  ->  health 0.000
//   margin_pct             n=1  ->  completeness 0.083 x 0.99       ->  health 0.082
//
// retriever.ts gates on .gte('data_health', 0.5), so both were filtered out of
// every retrieval — two core L1 metrics that could never reach the reasoner.
//
// target_n is "how many rows constitute a complete observation of this metric",
// not "how many we would like". For a latest-snapshot metric that is 1.
//
// Keep metric ids in sync with push() in compute.mjs and "metric" in ml/*.py.
// src/lib/metrics/registry.ts is the richer UI-facing catalogue; this is the
// compute-side subset, kept as plain .mjs because compute.mjs cannot import TS.

export const FACT_REGISTRY = {
  // ---------- L1 descriptive ----------
  revenue_trend_recent: { target_n: 12, freshness_window_hrs: 168 },
  revenue_anomaly_z: { target_n: 12, freshness_window_hrs: 168 },
  // Latest margin reading per sku — one row IS the metric.
  margin_pct: { target_n: 1, freshness_window_hrs: 168 },
  // v_fact_sku_velocity requires >= 4 weeks, so 4 is a complete observation.
  sku_velocity_delta: { target_n: 4, freshness_window_hrs: 168 },
  // DISTINCT ON latest snapshot per (sku, region) — one row IS the metric.
  inventory_cover_ratio: { target_n: 1, freshness_window_hrs: 72 },
  competitor_pressure_pct: { target_n: 4, freshness_window_hrs: 72 },

  // ---------- L3 predictive (ml/*.py) ----------
  demand_forecast_next: { target_n: 6, freshness_window_hrs: 168 },
  churn_risk: { target_n: 6, freshness_window_hrs: 168 },
  signal_sentiment: { target_n: 5, freshness_window_hrs: 72 },
}

// Metric ids the pipeline can emit. Used by tests to catch drift between this
// registry, compute.mjs and ml/*.py.
export const KNOWN_METRICS = Object.keys(FACT_REGISTRY)
