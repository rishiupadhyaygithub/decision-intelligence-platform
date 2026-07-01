"""Shared DB helper for the offline ML jobs. Reads DATABASE_URL from env;
never hardcodes secrets. Writes rows into the same `facts` table the agents read."""
import os
import json
import hashlib

import psycopg2
from psycopg2.extras import execute_values


def connect():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("Set DATABASE_URL (postgres connection string).")
    return psycopg2.connect(dsn)


def fact_id(metric, dims):
    h = hashlib.sha1((metric + json.dumps(dims, sort_keys=True)).encode()).hexdigest()[:16]
    return "f_" + h


def upsert_facts(conn, rows):
    """rows: list of dicts(metric, dims, value, [value_text], [window], method, [sample_n], [confidence])."""
    vals = []
    for r in rows:
        vals.append((
            fact_id(r["metric"], r["dims"]),
            r["metric"],
            json.dumps(r["dims"]),
            r.get("value"),
            r.get("value_text"),
            r.get("window"),
            r["method"],
            r.get("sample_n"),
            r.get("confidence"),
        ))
    sql = """
        insert into facts (id, metric, dims, value, value_text, time_window, method, sample_n, confidence)
        values %s
        on conflict (id) do update set
            value = excluded.value,
            value_text = excluded.value_text,
            sample_n = excluded.sample_n,
            confidence = excluded.confidence,
            computed_at = now()
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, vals)
    conn.commit()
    return len(vals)
