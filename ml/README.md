# Offline ML jobs

**Not a server.** These are offline batch jobs that read the Supabase views, train
small models locally (free, OSS), and upsert `ml:*` facts back into the `facts`
table. Run manually or via cron — never on the web request path.

## Setup

```bash
cd ml
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL="postgres://postgres:<pw>@db.<project>.supabase.co:5432/postgres"
```

## Run

```bash
python forecast.py    # demand_forecast_next   (Holt-Winters, per region)
python churn.py       # churn_risk             (logistic regression, per sku/region)
python sentiment.py   # signal_sentiment       (lexical rule, per category)
```

Each writes facts with `method = ml:*`, a real `sample_n`, and a computed
`confidence`. The grounded agent then cites these exactly like SQL facts —
the model never sees a number that isn't in this table.
