# DecisionOS — Decision Intelligence Platform

Grounded decision intelligence for a synthetic Savora Foods FMCG dataset. The app turns Supabase operational data into auditable recommendations where displayed numbers trace back to computed `facts` rows.

## Stack

- Next.js 16, React 19, TypeScript, Tailwind
- Supabase Auth, Postgres tables, analytics views
- Gemini reasoning with deterministic grounding validation
- Synthetic seed data generated in `scripts/seed/savora_seed.sql`

## Go-Live

The one-command runner uses the project in `.env.local`:

```bash
npm run go-live
```

It applies `supabase/migrations/0001_init.sql`, applies `supabase/migrations/0002_views.sql`, loads the Savora seed if it is not already present, and computes grounded facts.

Required `.env.local` keys:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ACCESS_TOKEN=
GEMINI_API_KEY=
```

Useful checks:

```bash
npm run check:supabase
npm run facts:compute
npm run dev
```

## Verify P1

```bash
curl -s localhost:3000/api/analyze-decision -X POST \
  -H 'content-type: application/json' \
  -d '{"title":"Cut SC-001 Bhujia price in West","proposal":"Respond to Gopal price war"}' | python3 -m json.tool
```

Pass means `grounded: true`, `facts_used` is non-empty, and `data_health_score` / `confidence` are computed from cited facts.

## Demo Data

The dataset is synthetic and should be labeled that way in the UI. It includes:

- 12 Savora SKUs across snacks, spices, and ready-to-eat
- 78 weeks of sales by SKU and region
- Inventory snapshots and reorder pressure
- Competitor, demand, supply, and regulatory market signals
- A Gopal Snacks price-war storyline and Delhi NCR demand spike

## Key Paths

- `supabase/migrations/0001_init.sql` — raw tables, facts, decisions, audit schema
- `supabase/migrations/0002_views.sql` — derived analytics views
- `scripts/seed/generate.mjs` — deterministic seed generator
- `scripts/facts/compute.mjs` — computes and upserts fact rows
- `scripts/apply-all.mjs` — go-live runner
- `src/app/api/analyze-decision/route.ts` — grounded analysis API
