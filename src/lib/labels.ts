// Plain-language names for metric ids, so the UI never shows `inventory_cover_ratio`.
const METRICS: Record<string, string> = {
  inventory_cover_ratio: 'Stock vs reorder level',
  sku_velocity_delta: 'Weekly sales change',
  revenue_trend_recent: '4-week revenue trend',
  revenue_anomaly_z: 'Revenue unusualness',
  margin_pct: 'Gross margin',
  competitor_pressure_pct: 'Urgent market signals',
  demand_forecast_next: 'Units expected next month',
  churn_risk: 'Chance of a sales dip',
  signal_sentiment: 'Market sentiment',
}

export function metricLabel(metric: string | null | undefined): string {
  if (!metric) return 'Unknown measure'
  return METRICS[metric] ?? metric.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

const WINDOWS: Record<string, string> = {
  latest: 'latest count',
  week: 'last week',
  next_month: 'next month',
  next_week: 'next week',
  current: 'current',
}
export const windowLabel = (w: string | null | undefined) => (w ? (WINDOWS[w] ?? w.replace(/_/g, ' ')) : null)
