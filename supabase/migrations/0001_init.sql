-- 0001_init.sql — DecisionOS grounded schema (Savora FMCG demo, SYNTHETIC data)
-- Contract: every number a user sees must trace to a row in `facts`.
-- pgvector + RLS are deliberately NOT here (see 0003 RLS, 0004 embeddings) so this
-- migration cannot fail on a fresh free-tier project.

-- ---------- RAW (synthetic Savora data; label as synthetic in UI) ----------
create table if not exists sku (
  sku_id      text primary key,
  name        text not null,
  category    text not null,
  mrp         numeric not null,
  unit_cost   numeric not null,
  launched_on date
);

create table if not exists sales (
  id        bigserial primary key,
  sku_id    text references sku(sku_id),
  region    text not null,
  channel   text not null,                 -- modern_trade | general_trade | d2c
  sale_date date not null,
  units     int not null,
  revenue   numeric not null
);
create index if not exists sales_sku_date_idx on sales (sku_id, sale_date);

create table if not exists inventory (
  id            bigserial primary key,
  sku_id        text references sku(sku_id),
  region        text not null,
  snapshot_date date not null,
  on_hand       int not null,
  reorder_point int not null
);

create table if not exists competitor_signal (
  id          bigserial primary key,
  source      text not null,
  category    text not null,               -- Competitor | Demand | Regulatory | Supply
  body        text not null,
  impact      text not null,               -- high | medium | low
  detected_at timestamptz not null default now(),
  urgent      boolean not null default false
);

-- ---------- FACT STORE (the grounding contract) ----------
create table if not exists facts (
  id          text primary key,            -- stable id; agents cite THIS
  metric      text not null,               -- e.g. revenue_trend_30d
  dims        jsonb not null default '{}', -- {sku, region, channel, time_window}
  value       numeric,
  value_text  text,
  time_window text,                        -- '30d' | '2026-Q2' ...
  method      text not null,               -- 'sql:zscore' | 'ml:gbm' | 'rule'
  sample_n    int,
  confidence  numeric,                     -- COMPUTED, 0..1
  computed_at timestamptz not null default now()
);
create index if not exists facts_metric_idx on facts (metric);

-- ---------- DECISIONS ----------
create table if not exists decisions (
  id                text primary key,
  title             text not null,
  type              text not null,         -- Strategic | Operational | Marketing
  urgency           text not null,         -- High | Medium | Low
  proposer          text,
  role              text,
  status            text not null default 'pending', -- pending|review|approved|executing|measured
  problem           text,
  whynow            text,
  alternatives_text text,
  org_id            uuid,                  -- multi-tenant ready; null = demo
  created_at        timestamptz not null default now()
);

create table if not exists decision_enrichment (
  decision_id    text primary key references decisions(id) on delete cascade,
  summary        text,
  recommendation text,
  confidence     numeric,                  -- COMPUTED, not LLM
  data_health    numeric,                  -- COMPUTED (% non-null in used facts)
  risk_level     text,
  model          text,                     -- which LLM produced reasoning
  grounded       boolean not null default false,
  created_at     timestamptz not null default now()
);

create table if not exists decision_facts (    -- which facts a decision cited
  decision_id text references decisions(id) on delete cascade,
  fact_id     text references facts(id),
  primary key (decision_id, fact_id)
);

create table if not exists risks (
  id          bigserial primary key,
  decision_id text references decisions(id) on delete cascade,
  risk        text not null,
  severity    text not null,                -- high|medium|low
  fact_id     text references facts(id)     -- numeric claims must cite a fact
);

create table if not exists alternatives (
  id          bigserial primary key,
  decision_id text references decisions(id) on delete cascade,
  option      text not null,
  tradeoff    text
);

create table if not exists reviewers (
  id          bigserial primary key,
  decision_id text references decisions(id) on delete cascade,
  name        text,
  role        text,
  status      text not null default 'pending', -- pending|approved|flagged
  comment     text
);

create table if not exists audit_log (
  id          bigserial primary key,
  decision_id text references decisions(id) on delete cascade,
  type        text not null,                -- proposed|ai|approved|flagged|executed|measured
  actor       text not null,
  detail      text,
  hash        text,
  created_at  timestamptz not null default now()
);

-- ---------- LEARNING LOOP (the compounding IP) ----------
create table if not exists outcomes (         -- predicted vs actual = loop closure
  id          bigserial primary key,
  decision_id text references decisions(id) on delete cascade,
  metric      text not null,
  predicted   numeric,
  actual      numeric,
  horizon     text,
  measured_at timestamptz
);

create table if not exists memory (           -- institutional memory (embeddings in 0004)
  id          text primary key,
  decision_id text references decisions(id),
  title       text not null,
  decided_on  date,
  outcome     text,                           -- win|loss|mixed
  predicted   numeric,
  actual      numeric,
  lesson      text
);

create table if not exists eval_runs (        -- private evals (the sovereignty test)
  id          bigserial primary key,
  model       text not null,
  decision_id text references decisions(id),
  dimension   text not null,                  -- grounding|accuracy|calibration
  score       numeric,
  created_at  timestamptz not null default now()
);
