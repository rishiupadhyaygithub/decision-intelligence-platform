-- 0016_bundle_per_claim_lineage.sql
-- Make save_decision_bundle the single persistence path for a decision.
--
-- Before: POST /api/analyze-decision persisted a decision (save_decision_lineage, random
-- UUID, default type/urgency) on every "Analyse" click, then "Save" created a SECOND
-- decision through save_decision_bundle. Every analysis left an orphan row in the inbox.
-- Analyse is now a pure preview; it only returns `analysis.lineage`, a list of
-- {claim_type, claim_index, fact_id} citations. This function persists them.
--
-- Snapshots are built HERE from the live facts row, never taken from the client:
--   * a forged or stale fact_id simply yields no row (the join drops it);
--   * every snapshot has one shape ({id, metric, dims, value, value_text, window, ...}),
--     which is what the decision detail page reads.
--
-- Backwards compatible: with no `lineage` in the payload it falls back to the
-- facts_used array exactly as 0015 did (one 'claim' row per cited fact).
-- Everything else is identical to 0015.

create or replace function save_decision_bundle(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id text := payload->>'id';
  v_analysis jsonb := payload->'analysis';
  v_lineage jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_id is null or v_analysis is null then
    raise exception 'invalid payload';
  end if;
  if coalesce((v_analysis->>'grounded')::boolean, false) is not true then
    raise exception 'analysis must be grounded';
  end if;
  if coalesce((v_analysis->'validation'->>'ok')::boolean, false) is not true then
    raise exception 'analysis failed validation';
  end if;

  insert into decisions (id, title, type, urgency, proposer, role, status, problem, whynow, user_id)
  values (
    v_id,
    payload->>'title',
    payload->>'type',
    payload->>'urgency',
    payload->>'proposer',
    coalesce(payload->>'role', 'member'),
    'pending',
    payload->>'problem',
    nullif(payload->>'whynow', ''),
    v_uid
  );

  insert into decision_enrichment (
    decision_id, summary, recommendation, confidence, data_health, risk_level, model, grounded
  ) values (
    v_id,
    v_analysis->>'summary',
    v_analysis->>'recommendation',
    (v_analysis->>'confidence')::numeric,
    (v_analysis->>'data_health_score')::numeric,
    coalesce(v_analysis->'top_risks'->0->>'severity', 'medium'),
    coalesce(v_analysis->>'model', 'gemini-2.0-flash'),
    true
  );

  insert into risks (decision_id, risk, severity, fact_id)
  select v_id, r->>'risk', r->>'severity', nullif(r->>'fact_id', '')
  from jsonb_array_elements(coalesce(v_analysis->'top_risks', '[]'::jsonb)) r;

  insert into alternatives (decision_id, option, tradeoff)
  select v_id, a->>'option', a->>'tradeoff'
  from jsonb_array_elements(coalesce(v_analysis->'alternatives', '[]'::jsonb)) a;

  v_lineage := case
    when jsonb_typeof(v_analysis->'lineage') = 'array' then v_analysis->'lineage'
    else '[]'::jsonb
  end;

  if jsonb_array_length(v_lineage) > 0 then
    -- Per-claim citations, snapshotted from the live fact row.
    insert into decision_facts (decision_id, claim_type, claim_index, fact_id, fact_snapshot)
    select distinct v_id, c.claim_type, c.claim_index, f.id,
           jsonb_build_object(
             'id', f.id, 'metric', f.metric, 'dims', f.dims,
             'value', f.value, 'value_text', f.value_text, 'window', f.time_window,
             'data_health', f.data_health, 'confidence', f.confidence,
             'computed_at', f.computed_at
           )
    from (
      select e->>'claim_type' as claim_type,
             case when e->>'claim_index' ~ '^[0-9]{1,6}$' then (e->>'claim_index')::int end as claim_index,
             e->>'fact_id' as fact_id
      from jsonb_array_elements(v_lineage) e
    ) c
    join facts f on f.id = c.fact_id
    where c.claim_type in ('claim', 'risk', 'alternative')
      and c.claim_index is not null
    on conflict (decision_id, claim_type, claim_index, fact_id) do nothing;
  else
    -- Fallback (as 0015): summary-level citations from facts_used.
    insert into decision_facts (decision_id, claim_type, claim_index, fact_id, fact_snapshot)
    select v_id, 'claim', (u.ord - 1)::int, f.id,
           jsonb_build_object(
             'id', f.id, 'metric', f.metric, 'dims', f.dims,
             'value', f.value, 'value_text', f.value_text, 'window', f.time_window,
             'data_health', f.data_health, 'confidence', f.confidence,
             'computed_at', f.computed_at
           )
    from jsonb_array_elements(coalesce(v_analysis->'facts_used', '[]'::jsonb))
         with ordinality as u(elem, ord)
    join facts f on f.id = u.elem->>'id'
    on conflict (decision_id, claim_type, claim_index, fact_id) do nothing;
  end if;

  insert into audit_log (decision_id, type, actor, detail, hash) values
    (v_id, 'proposed', payload->>'proposer', 'Decision proposed',
     encode(sha256((v_id || 'proposed')::bytea), 'hex')),
    (v_id, 'ai', 'AI Engine',
     'Grounded enrichment · ' || jsonb_array_length(coalesce(v_analysis->'facts_used', '[]'::jsonb)) || ' facts cited',
     encode(sha256((v_id || 'ai')::bytea), 'hex'));

  return v_id;
end;
$$;

revoke all on function save_decision_bundle(jsonb) from public;
grant execute on function save_decision_bundle(jsonb) to authenticated;
