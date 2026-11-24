# DecisionOS

**Open-source decision intelligence: from your sales data to an auditable recommendation, where every number cites its source.**

BI dashboards show what happened. Chatbots guess what to do. DecisionOS answers four questions in order and shows its work at every step:

| Layer | Question | How |
|-------|----------|-----|
| **L1 Descriptive** | What happened? | KPIs computed into a `facts` store; every number carries a `fact_id` and a data-health score |
| **L2 Diagnostic** | Why did it happen? | Ridge-regression driver decomposition + MAD anomaly detection |
| **L3 Predictive** | What will happen? | Damped exponential smoothing with bootstrap P10/P50/P90 bands, out-of-sample holdout skill, churn risk |
| **L4 Prescriptive** | What should we do? | Grounded LLM reasoning (Gemini) behind a strict citation gate, a skeptic pass, tradeoffs and composite confidence. Falls back to a deterministic, fully cited answer when the LLM is unavailable |

Click any number to open its lineage: formula, source rows, freshness, health. Saved decisions keep an immutable snapshot of every fact they cited, and you can record outcomes to close the loop.

## Quick start

You need Node 22.18+ (24 recommended), a free [Supabase](https://supabase.com) project and, optionally, a [Gemini API key](https://aistudio.google.com).

```bash
git clone https://github.com/rishiupadhyaygithub/decision-intelligence-platform.git
cd decision-intelligence-platform
npm install
cp .env.example .env.local     # fill in the values (comments explain each one)
npm run go-live                # applies migrations, loads the demo dataset, computes facts
npm run doctor                 # checks env, database, schema, freshness, LLM key
npm run dev                    # http://localhost:3000
```

Sign up in the app, then put your email in `ADMIN_EMAILS` (in `.env.local`) to unlock data import.

`go-live` records each applied migration in `_decisionos_migrations` and only runs new ones, so it is safe to re-run. On a database set up before this tracking existed it stops and asks you to run `BASELINE=1 npm run go-live` once, because re-running every migration (0013 rebuilds `decision_facts`) would erase decision history.

## Use your own data

DecisionOS starts on a synthetic FMCG dataset (Savora Foods: 12 SKUs, 78 weeks) so you can explore immediately. To switch to your data, open **Data** in the app (admins only):

1. **Back up** the current dataset (one CSV per table, already in import format).
2. Choose your CSVs and click **Check files**. Every row is validated server-side and nothing is written. Errors name the file, row and column.
3. Type `REPLACE` and import. The four tables are swapped in a single transaction (all or nothing), then facts are recomputed so dashboards and analyses use your data immediately. Python models run on the next pipeline run.

| File | Required | Columns |
|------|----------|---------|
| `skus.csv` | yes | `sku_id,name,category,mrp,unit_cost,launched_on` |
| `sales.csv` | yes | `sku_id,region,channel,sale_date,units,revenue` (one row per sku/region/channel/day) |
| `inventory.csv` | no | `sku_id,region,snapshot_date,on_hand,reorder_point` |
| `signals.csv` | no | `source,category,body,impact,detected_at,urgent` (`impact`: high/medium/low) |

Dates are `YYYY-MM-DD`. Give it at least 8 weeks of sales history; trends and forecasts need it. Working samples live in [`public/samples/`](public/samples). Limits: 10 MB per file, 250k rows.

After an import the deployment is in `custom` mode: the pipeline never appends synthetic rows again and the "demo data" notice disappears.

## Keep facts fresh

Facts power everything, and analyses ignore facts older than 14 days. Run the pipeline on a schedule:

- **GitHub Actions** (included, free): `.github/workflows/pipeline.yml` runs daily. Add repository secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It also runs the Python models (forecast, churn, sentiment).
- **Manually**: `npm run pipeline`.

## Deploy

Any Node host works. On Vercel: import the repo, add the variables from `.env.example`, deploy. The Data import route needs up to 60 s (`maxDuration`). The Python models do not run on serverless hosts; they run in the pipeline.

## Free-tier notes

- **Supabase pauses idle free projects.** If the pipeline logs `fetch failed`, or `npm run doctor` says the database did not respond, restore the project in the Supabase dashboard.
- **Gemini free quota is small.** The adapter walks a chain of models on quota or overload errors (`GEMINI_MODELS_SMART` / `GEMINI_MODELS_FAST`) and finally falls back to the deterministic answer. Responses report `fallback_reason` when that happens.

## Trust and security model

- **Grounding contract.** Every number in an answer must cite a `facts.id`; the validator checks id, metric, value and dimensions, and the strict gate rejects stale, unhealthy or unstable facts.
- **Data health** = freshness × completeness × confidence, per metric (`scripts/facts/health.mjs`, `registry.mjs`).
- **Row-level security** on every table. The browser only ever holds the anon key; anonymous visitors cannot read data, views or call privileged functions (migration 0019). Writes go through `SECURITY DEFINER` functions with explicit grants.
- **One dataset per deployment.** All signed-in users share it; only `ADMIN_EMAILS` can replace it. Decisions are private to their owner.
- **Rate limit**: 10 analyses per user per minute, Postgres-backed.

## Project layout

| Path | What |
|------|------|
| `supabase/migrations/` | Schema, views, RLS, RPCs (apply in order) |
| `scripts/pipeline/` | Scheduled pipeline: ingest (demo only) → recompute facts |
| `scripts/facts/` | Fact computation, health, outlier guard, metric registry |
| `ml/` | Python models (forecast, churn, sentiment) |
| `src/lib/` | Layer libraries: `diagnose`, `predict`, `prescribe`, `grounding`, `agents`, `data` |
| `src/app/api/` | `kpi`, `diagnose`, `forecast`, `churn`, `analyze-decision`, `decisions`, `lineage`, `data/*` |
| `src/app/dashboard/` | Dashboard, new decision, decision detail, inbox, retros, memory, data |

## Scripts

| Command | Does |
|---------|------|
| `npm run go-live` | Apply new migrations, seed demo data (only if empty), compute facts |
| `npm run doctor` | Health check: env, database, schema, fact freshness, LLM key |
| `npm run pipeline` | Run the pipeline once |
| `npm test` | Unit tests + fact-pipeline tests |
| `npm run typecheck` / `npm run lint` / `npm run build` | The CI gates |

## Limitations and roadmap

Honest list of what it does not do yet:

- One shared dataset per deployment (no multi-tenant workspaces).
- Data arrives by CSV import; no live connectors (ERP, Shopify, warehouses) yet.
- Fact retrieval is keyword-based; embedding search would match more phrasings.
- Competitor signals are category-level (no SKU/region columns).

Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
