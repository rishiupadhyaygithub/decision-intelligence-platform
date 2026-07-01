"""Offline SKU/region velocity churn risk -> facts (ml:logreg).
Label = next week's units fall >15% below the trailing-3 mean. Logistic regression
on (relative level, relative volatility). Predicts risk for the latest point.

Run:  DATABASE_URL=postgres://... python ml/churn.py
"""
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

from _db import connect, upsert_facts


def main():
    conn = connect()
    df = pd.read_sql("select sku_id, region, week, units from v_sku_velocity order by week", conn)

    feats, labels = [], []
    for _, g in df.groupby(["sku_id", "region"]):
        u = g.sort_values("week")["units"].astype(float).values
        if len(u) < 6:
            continue
        for i in range(3, len(u) - 1):
            trail = u[i - 3:i]
            m = trail.mean() or 1.0
            feats.append([u[i] / m, trail.std() / m])
            labels.append(1 if u[i + 1] < m * 0.85 else 0)

    if len(set(labels)) < 2:
        print("not enough label variety to train")
        return

    clf = LogisticRegression(max_iter=500).fit(np.array(feats), np.array(labels))

    rows = []
    for (sku, region), g in df.groupby(["sku_id", "region"]):
        u = g.sort_values("week")["units"].astype(float).values
        if len(u) < 6:
            continue
        trail = u[-4:-1]
        m = trail.mean() or 1.0
        f = np.array([[u[-1] / m, trail.std() / m]])
        p = float(clf.predict_proba(f)[0, 1])
        rows.append({
            "metric": "churn_risk",
            "dims": {"sku": sku, "region": region},
            "value": round(p, 3),
            "window": "next_week",
            "method": "ml:logreg",
            "sample_n": len(u),
            "confidence": 0.7,
        })
    print("upserted", upsert_facts(conn, rows), "churn facts")


if __name__ == "__main__":
    main()
