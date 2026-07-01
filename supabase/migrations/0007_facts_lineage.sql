-- W0.1 — Lineage + trust columns on facts.
-- data_health: 0..1 freshness × completeness × source confidence
-- formula_id : FK into the application-side metrics registry (src/lib/metrics/registry.ts)
-- unstable   : true if outlier guard tripped (IQR / z-score)
-- source_rows: jsonb array of {table, pk} for click-through lineage

alter table facts
  add column if not exists data_health numeric,
  add column if not exists formula_id  text,
  add column if not exists unstable    boolean not null default false,
  add column if not exists source_rows jsonb   not null default '[]'::jsonb;

create index if not exists facts_formula_idx on facts (formula_id);
create index if not exists facts_unstable_idx on facts (unstable) where unstable = true;

-- Backfill: existing rows treated as healthy & stable until recomputed.
update facts set data_health = coalesce(data_health, confidence, 0.8) where data_health is null;
