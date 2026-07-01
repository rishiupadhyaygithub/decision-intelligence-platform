"""Offline demand forecast per region -> facts (ml:holtwinters).
Holt-Winters where there is enough history; mean fallback otherwise.
Confidence derives from residual interval width (wider = less confident).

Run:  DATABASE_URL=postgres://... python ml/forecast.py
"""
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing

from _db import connect, upsert_facts


def main():
    conn = connect()
    df = pd.read_sql("select region, month, units from v_region_demand order by month", conn)
    rows = []
    for region, g in df.groupby("region"):
        s = g.set_index("month")["units"].astype(float)
        n = len(s)
        if n < 6:
            continue
        try:
            fit = ExponentialSmoothing(s, trend="add").fit()
            fc = float(fit.forecast(1).iloc[0])
            resid = float((fit.fittedvalues - s).std())
        except Exception:
            fc = float(s.tail(3).mean())
            resid = float(s.std())
        rel = resid / fc if fc else 1.0
        conf = max(0.3, min(0.9, 1 - rel))
        rows.append({
            "metric": "demand_forecast_next",
            "dims": {"region": region},
            "value": round(fc, 2),
            "window": "next_month",
            "method": "ml:holtwinters",
            "sample_n": n,
            "confidence": round(conf, 2),
        })
    if rows:
        print("upserted", upsert_facts(conn, rows), "forecast facts")
    else:
        print("no series with enough history")


if __name__ == "__main__":
    main()
