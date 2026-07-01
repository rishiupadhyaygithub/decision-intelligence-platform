# Synthetic Savora seed

Deterministic generator for the **synthetic** Savora Foods FMCG demo dataset.
Label it as synthetic everywhere in the UI — it is fabricated, not live.

## Run

```bash
node scripts/seed/generate.mjs        # writes scripts/seed/savora_seed.sql
```

Then apply it to Supabase (after migrations 0001 + 0002):

```bash
psql "$DATABASE_URL" -f scripts/seed/savora_seed.sql
# or paste savora_seed.sql into the Supabase SQL editor
```

Then compute facts: `node scripts/facts/compute.mjs`.

## What it encodes (matches the product narrative)

- 12 SKUs across snacks / spices / ready-to-eat
- 78 weeks of sales per SKU × home regions, with seasonality + growth
- **Gopal price-war dip** on SC-001 in West around 2026-05-11 (~18% velocity drop)
- **Viral SC-003 spike** in Delhi NCR mid-May 2026 (~41%)
- **South/Karnataka growth** trend (the expansion story)
- Monthly inventory snapshots (SC-001 West runs low at the end)
- 6 competitor/demand/regulatory signals from the storyline
