# Fact compute job

Reads the `0002_views.sql` views from Supabase, derives **grounded facts**
deterministically (no LLM), and upserts them into the `facts` table. Every number
the agent later cites comes from here.

## Run

```bash
# from project root, after applying migrations 0001 + 0002 and loading the seed
SUPABASE_URL="https://<project>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
node scripts/facts/compute.mjs
```

Falls back to `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` while RLS
is still off (migration 0003 turns RLS on — service-role key required after that).

## Facts produced

| metric | dims | method |
|---|---|---|
| `revenue_trend_recent` | region | sql:pct |
| `revenue_anomaly_z` | region | sql:zscore |
| `margin_pct` | sku | sql |
| `sku_velocity_delta` | sku, region | sql:pct |
| `inventory_cover_ratio` | sku, region | sql |
| `competitor_pressure_pct` | category | rule |

ML-derived facts (`ml:*`) are added separately by the offline jobs in `ml/`.
