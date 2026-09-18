-- 0015_fix_save_decision_bundle.sql
-- P0 repair: POST /api/decisions has been failing for any decision that cites facts.
--
-- 0013 dropped and recreated decision_facts with three NOT NULL columns that did
-- not exist before — claim_index, claim_type, fact_snapshot. But
-- save_decision_bundle() (defined in 0003, still the RPC behind
-- src/app/api/decisions/route.ts:63) was never updated and still runs:
--
--     insert into decision_facts (decision_id, fact_id)
--     select v_id, f->>'id' ...
--
-- so every insert violates all three NOT NULL constraints. Symptom: saving a
-- decision with zero cited facts succeeds (the select yields no rows), saving one
-- WITH cited facts returns 500 "Failed to save decision". Phase 4.5 only exercised
-- the newer save_decision_lineage() path, so this went unnoticed.
--
-- Fix: supply the new columns. facts_used entries are {id, metric, value, window},
-- which is exactly the immutable snapshot decision_facts now wants, so the element
-- is stored verbatim as fact_snapshot. claim_type is 'claim' (these are summary-level
-- citations, not per-risk ones) and claim_index is the array position.
--
-- Body is otherwise identical to 0003; only the decision_facts insert changed.

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

  -- CHANGED vs 0003: populate claim_type / claim_index / fact_snapshot.
  -- with ordinality gives a stable claim_index; ord is 1-based so shift to 0-based.
  insert into decision_facts (decision_id, claim_type, claim_index, fact_id, fact_snapshot)
  select v_id, 'claim', (f.ord - 1)::int, f.elem->>'id', f.elem
  from jsonb_array_elements(coalesce(v_analysis->'facts_used', '[]'::jsonb))
       with ordinality as f(elem, ord)
  where f.elem->>'id' is not null
  on conflict (decision_id, claim_type, claim_index, fact_id) do nothing;

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
