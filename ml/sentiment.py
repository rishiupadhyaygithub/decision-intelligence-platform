"""Offline rule-based sentiment over competitor_signal -> facts (ml:rule).
Lightweight lexical scorer (no paid model). Aggregated per signal category.

Run:  DATABASE_URL=postgres://... python ml/sentiment.py
"""
import pandas as pd

from _db import connect, upsert_facts

NEG = ["drop", "down", "decline", "loss", "pressure", "risk", "flash sale",
       "stockout", "squeeze", "war", "preempt"]
POS = ["up", "growth", "spike", "win", "tailwind", "first-mover", "viral",
       "opportunity", "gain"]


def score(text):
    t = text.lower()
    s = sum(w in t for w in POS) - sum(w in t for w in NEG)
    return max(-1.0, min(1.0, s / 3.0))


def main():
    conn = connect()
    df = pd.read_sql("select category, body from competitor_signal", conn)
    rows = []
    for cat, g in df.groupby("category"):
        vals = [score(b) for b in g["body"]]
        avg = sum(vals) / len(vals)
        rows.append({
            "metric": "signal_sentiment",
            "dims": {"category": cat},
            "value": round(avg, 2),
            "window": "current",
            "method": "ml:rule",
            "sample_n": len(vals),
            "confidence": 0.6,
            "value_text": "negative" if avg < 0 else "positive",
        })
    print("upserted", upsert_facts(conn, rows), "sentiment facts")


if __name__ == "__main__":
    main()
