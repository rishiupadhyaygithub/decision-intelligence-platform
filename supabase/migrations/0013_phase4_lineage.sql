-- 0013_phase4_lineage.sql
-- Phase 4: Fact Lineage & Feedback

-- 1. Redefine decision_facts to capture immutable citation snapshots
ALTER TABLE decision_facts DROP CONSTRAINT IF EXISTS decision_facts_pkey CASCADE;
DROP TABLE IF EXISTS decision_facts CASCADE;

CREATE TABLE decision_facts (
  decision_id text references decisions(id) on delete cascade,
  claim_index int not null,
  claim_type text not null,       -- 'claim', 'risk', 'alternative'
  fact_id text,                   -- Can be null if fact gets completely purged, though usually we keep it for reference
  fact_snapshot jsonb not null,
  captured_at timestamptz not null default now(),
  primary key (decision_id, claim_type, claim_index, fact_id)
);

-- 2. Create observational feedback table
CREATE TABLE decision_feedback (
  decision_id text primary key references decisions(id) on delete cascade,
  accepted boolean not null,
  selected_alternative text,
  user_feedback text,
  created_at timestamptz not null default now()
);

-- 3. Atomic RPC to save decision lineage
CREATE OR REPLACE FUNCTION save_decision_lineage(
  p_decision jsonb,
  p_snapshots jsonb -- Array of { claim_index, claim_type, fact_id, fact_snapshot }
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision_id text;
  v_count int;
BEGIN
  v_decision_id := p_decision->>'id';

  -- 1. Insert the decision
  INSERT INTO decisions (
    id, title, type, urgency, proposer, role, status, problem, whynow, alternatives_text, created_at
  ) VALUES (
    v_decision_id,
    p_decision->>'title',
    COALESCE(p_decision->>'type', 'Operational'),
    COALESCE(p_decision->>'urgency', 'Medium'),
    p_decision->>'proposer',
    p_decision->>'role',
    COALESCE(p_decision->>'status', 'pending'),
    p_decision->>'problem',
    p_decision->>'whynow',
    p_decision->>'alternatives_text',
    COALESCE((p_decision->>'createdAt')::timestamptz, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    status = EXCLUDED.status;

  -- 2. Insert enrichment (if provided)
  IF p_decision ? 'enrichment' THEN
    INSERT INTO decision_enrichment (
      decision_id, summary, recommendation, confidence, data_health, risk_level, model, grounded
    ) VALUES (
      v_decision_id,
      p_decision->'enrichment'->>'summary',
      p_decision->'enrichment'->>'recommendation',
      (p_decision->'enrichment'->>'confidence')::numeric,
      (p_decision->'enrichment'->>'dataHealth')::numeric,
      p_decision->'enrichment'->>'riskLevel',
      p_decision->'enrichment'->>'model',
      (p_decision->'enrichment'->>'grounded')::boolean
    )
    ON CONFLICT (decision_id) DO NOTHING;
  END IF;

  -- 3. Insert the fact snapshots
  IF jsonb_array_length(p_snapshots) > 0 THEN
    INSERT INTO decision_facts (
      decision_id, claim_index, claim_type, fact_id, fact_snapshot
    )
    SELECT 
      v_decision_id,
      (s->>'claim_index')::int,
      s->>'claim_type',
      s->>'fact_id',
      s->'fact_snapshot'
    FROM jsonb_array_elements(p_snapshots) AS s
    ON CONFLICT (decision_id, claim_type, claim_index, fact_id) DO NOTHING;
  END IF;

  SELECT count(*) INTO v_count FROM decision_facts WHERE decision_id = v_decision_id;

  RETURN jsonb_build_object(
    'decision_id', v_decision_id,
    'saved', true,
    'snapshots', v_count
  );
END;
$$;
