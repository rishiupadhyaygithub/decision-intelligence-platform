-- 0009_phase0_reliability.sql
-- Phase 0: Pipeline reliability and atomicity

-- 1. Idempotency for ingestion
ALTER TABLE sales ADD CONSTRAINT sales_sku_region_channel_date_key UNIQUE (sku_id, region, channel, sale_date);

-- 2. Atomic Fact Publication RPC
CREATE OR REPLACE FUNCTION publish_facts(new_facts jsonb, stale_ids text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Remove facts that are no longer generated in the current batch
    IF array_length(stale_ids, 1) > 0 THEN
        DELETE FROM facts WHERE id = ANY(stale_ids);
    END IF;

    -- Upsert the newly computed facts atomically
    IF jsonb_array_length(new_facts) > 0 THEN
        INSERT INTO facts (
            id, metric, dims, value, value_text, time_window, method, 
            sample_n, confidence, computed_at, data_health, formula_id, 
            unstable, source_rows
        )
        SELECT 
            id, metric, dims, value, value_text, time_window, method, 
            sample_n, confidence, computed_at, data_health, formula_id, 
            unstable, source_rows
        FROM jsonb_populate_recordset(null::facts, new_facts)
        ON CONFLICT (id) DO UPDATE SET
            metric = EXCLUDED.metric,
            dims = EXCLUDED.dims,
            value = EXCLUDED.value,
            value_text = EXCLUDED.value_text,
            time_window = EXCLUDED.time_window,
            method = EXCLUDED.method,
            sample_n = EXCLUDED.sample_n,
            confidence = EXCLUDED.confidence,
            computed_at = EXCLUDED.computed_at,
            data_health = EXCLUDED.data_health,
            formula_id = EXCLUDED.formula_id,
            unstable = EXCLUDED.unstable,
            source_rows = EXCLUDED.source_rows;
    END IF;
END;
$$;
