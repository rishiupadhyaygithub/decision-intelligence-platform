# DecisionOS — Decision Intelligence Platform

Turns Supabase operational data into **auditable recommendations**. Every displayed number cites a `facts` row; click any number to open its lineage (formula, source rows, data-health score).

## What's different

BI shows what happened. Chatbots guess what to do. DecisionOS answers all four questions and shows its work:

| Layer | Question | How |
|-------|----------|-----|
| **L1 Descriptive** | What happened? | KPIs from `facts`, each with `fact_id` + `data_health` chip |
| **L2 Diagnostic** | Why did it happen? | Ridge-regression driver decomposition + MAD anomaly detection |
| **L3 Predictive** | What will happen? | Damped exponential smoothing + bootstrap P10/P50/P90 bands, churn risk |
| **L4 Prescriptive** | What should we do? | Grounded LLM (Gemini) + strict citation gate + tradeoff generator + composite confidence |

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind
- Supabase Postgres (facts + decisions + outcomes + RLS + Auth)
- Recharts for visualization
- Gemini for LLM reasoning; deterministic fallback + skeptic pass
- Python offline trainers (`ml/forecast.py`, `ml/churn.py`) feed `facts` via `scripts/facts/ml.mjs`
- GitHub Actions cron runs the pipeline

Zero-infra: forecast/churn also run in-process via TS modules so the UI stays snappy without a Python service.

## Go-Live

```bash
npm install
cp .env.local.example .env.local   # fill in keys
npm run go-live                    # migrations + seed + facts
npm run dev
```

Required env:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ACCESS_TOKEN=
GEMINI_API_KEY=
```

**Migration 0007** (`facts_lineage`) must be applied — adds `data_health`, `formula_id`, `unstable`, `source_rows` columns. `npm run go-live` handles it; if you re-ran migrations manually, apply it explicitly:

```bash
npm run check:supabase
supabase db push   # or use the MCP apply_migration tool
```

## Endpoints

| Route | Layer | Purpose |
|-------|-------|---------|
| `GET /api/kpi` | L1 | Headline KPIs with `fact_id` + `data_health` |
| `GET /api/lineage/[factId]` | — | Fact + registry formula + source rows |
| `POST /api/diagnose` | L2 | Driver decomposition + anomalies for `{sku, region}` |
| `POST /api/forecast` | L3 | DES forecast with bootstrap bands |
| `POST /api/churn` | L3 | Churn risk score + reasons |
| `POST /api/analyze-decision` | L4 | Grounded recommendation + tradeoffs + composite confidence |

## Verify

Log in through the UI (cookies are needed), then:

```bash
curl -s -b cookies.txt localhost:3000/api/kpi?limit=6 | jq .
curl -s -b cookies.txt -X POST localhost:3000/api/diagnose \
  -H 'content-type: application/json' \
  -d '{"sku":"SC-001","region":"West"}' | jq .
curl -s -b cookies.txt -X POST localhost:3000/api/analyze-decision \
  -H 'content-type: application/json' \
  -d '{"title":"Cut SC-001 in West","proposal":"React to Gopal price war"}' | jq .
```

Pass criteria:
- `analysis.grounded === true`
- `analysis.facts_used.length >= 2`
- `analysis.confidence_composite.score > 0`
- `analysis.strict_grounding.passed === true`

## Pages

| Path | What |
|------|------|
| `/dashboard/inbox` | Open decisions sorted by urgency + recency |
| `/dashboard/decisions/[id]` | Decision detail (drop-in `<LayerTabs />` for L1–L4 view) |
| `/dashboard/retros` | Calibration table, closed decisions, pipeline health |

## Trust layer

Every number is defensible:

- **Metrics registry** (`src/lib/metrics/registry.ts`) — every metric has an id, formula, unit, freshness window, owner.
- **Fact contract** (`src/lib/metrics/schema.ts`) — zod validates every row before upsert.
- **Data-health score** (`scripts/facts/health.mjs`) — `freshness × completeness × source_conf`, halved if unstable.
- **Outlier guard** (`scripts/facts/quality.mjs`) — IQR + z-score per-metric, marks `unstable=true` (never deletes).
- **Strict grounding** (`src/lib/grounding/validate.ts`) — L4 rejects citations under health floor, past freshness, or flagged unstable.
- **Composite confidence** (`src/lib/prescribe/confidence.ts`) — `data_health × forecast_certainty × driver_clarity × coverage`.
- **Calibration audit** (`src/lib/audit/calibration.ts`) — hit-rate vs confidence, Brier score, gap per band.

## Demo Data

Synthetic Savora Foods FMCG dataset — 12 SKUs (snacks/spices/RTE), 78 weeks of sales × region, inventory + competitor + demand + supply + regulatory signals. Storylines: Gopal Snacks price war (West), Delhi NCR demand spike.

## Key Paths

- `supabase/migrations/0001_init.sql` — raw tables, facts, decisions, audit schema
- `supabase/migrations/0002_views.sql` — analytics views
- `supabase/migrations/0007_facts_lineage.sql` — lineage columns on `facts`
- `scripts/facts/{compute,quality,health,ml}.mjs` — facts pipeline
- `src/lib/{metrics,diagnose,predict,grounding,prescribe,audit}` — layer libraries
- `src/components/{L1,L2,L3,L4,lineage,LayerTabs}` — layer UI
- `src/app/api/{kpi,lineage,diagnose,forecast,churn,analyze-decision}` — layer endpoints
