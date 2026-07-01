// W1.2 — Data-health scorer.
// data_health ∈ [0,1] = freshness × completeness × source_confidence.
// freshness    : decays linearly from 1 at compute time to 0 past max_age.
// completeness : sample_n / target_n (clamped 0..1).
// source_conf  : existing `confidence` field (defaults 0.5 if absent).

const DEFAULT_FRESHNESS_HRS = 168; // 1 week
const DEFAULT_TARGET_N = 12;

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

function freshness(computedAt, maxAgeHrs, nowMs) {
  const ts = new Date(computedAt).getTime();
  if (!Number.isFinite(ts)) return 0.5;
  const ageHrs = (nowMs - ts) / 3.6e6;
  if (ageHrs <= 0) return 1;
  return clamp(1 - ageHrs / maxAgeHrs);
}

function completeness(sampleN, targetN) {
  if (!sampleN || sampleN <= 0) return 0.3;
  return clamp(sampleN / targetN);
}

export function scoreHealth(facts, registry = {}) {
  const now = Date.now();
  for (const f of facts) {
    const spec = registry[f.metric] || registry[f.formula_id] || {};
    const maxAge = spec.freshness_window_hrs ?? DEFAULT_FRESHNESS_HRS;
    const targetN = spec.target_n ?? DEFAULT_TARGET_N;

    const fr = freshness(f.computed_at, maxAge, now);
    const co = completeness(f.sample_n, targetN);
    const sc = clamp(f.confidence ?? 0.5);

    let score = fr * co * sc;
    if (f.unstable) score *= 0.5;
    f.data_health = Number(score.toFixed(3));
  }
  return facts;
}

export function healthSummary(facts) {
  const scored = facts.filter((f) => typeof f.data_health === "number");
  if (scored.length === 0) return { mean: 0, p10: 0, low_quality: 0 };
  const vals = scored.map((f) => f.data_health).sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const p10 = vals[Math.floor(vals.length * 0.1)];
  const low = scored.filter((f) => f.data_health < 0.5).length;
  return {
    mean: Number(mean.toFixed(3)),
    p10: Number(p10.toFixed(3)),
    low_quality: low,
  };
}
