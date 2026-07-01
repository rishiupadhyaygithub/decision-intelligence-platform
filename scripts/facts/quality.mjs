// W1.1 — Outlier guard.
// Flags facts whose value sits outside expected distribution for its metric.
// Strategy: per-metric pool, drop nulls, run IQR + z-score, mark unstable
// when either trips. Conservative — only flags, never deletes.

const ZSCORE_THRESHOLD = 3.0;
const IQR_MULTIPLIER = 1.5;

const median = (sorted) => {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const quantile = (sorted, q) => {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] != null
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
};

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

export function flagOutliers(facts) {
  const byMetric = {};
  for (const f of facts) {
    if (f.value == null || !Number.isFinite(f.value)) continue;
    (byMetric[f.metric] ??= []).push(f);
  }

  let flagged = 0;
  for (const [, rows] of Object.entries(byMetric)) {
    if (rows.length < 6) continue;

    const vals = rows.map((r) => r.value).sort((a, b) => a - b);
    const q1 = quantile(vals, 0.25);
    const q3 = quantile(vals, 0.75);
    const iqr = q3 - q1;
    const lo = q1 - IQR_MULTIPLIER * iqr;
    const hi = q3 + IQR_MULTIPLIER * iqr;
    const m = mean(vals);
    const s = std(vals);

    for (const r of rows) {
      const iqrOut = r.value < lo || r.value > hi;
      const zOut = s > 0 && Math.abs((r.value - m) / s) > ZSCORE_THRESHOLD;
      if (iqrOut || zOut) {
        r.unstable = true;
        flagged += 1;
      } else {
        r.unstable = r.unstable ?? false;
      }
    }
  }
  return { flagged, totalScanned: facts.length };
}
